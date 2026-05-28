/**
 * Twilio Media Streams ↔ OpenAI Realtime API WebSocket proxy.
 *
 * Architecture:
 *   Twilio <Stream> → this WebSocket handler → OpenAI Realtime (gpt-4o-realtime-preview)
 *
 * OpenAI handles STT + reasoning + TTS in one bidirectional audio stream.
 * Latency: ~300–500 ms vs 3–5 s with the Gather/HTTP approach.
 *
 * Audio format: g711_ulaw (μ-law 8 kHz) — Twilio's native format, no conversion needed.
 *
 * IMPORTANT: Disable JWT verification for this function in Supabase Dashboard.
 */

import { adminClient } from '../_shared/supabase.ts'
import { getAvailableSlots } from '../_shared/scheduling.ts'
import { buildAIContext, matchService, sendSmsConfirmations, sendSmsCancellation } from '../_shared/aiContext.ts'
import type { AIContext } from '../_shared/aiContext.ts'
import { buildSystemPrompt } from '../_shared/systemPrompt.ts'

const OPENAI_MODEL = 'gpt-4o-realtime-preview-2024-12-17'
const OPENAI_VOICE = 'alloy' // alloy | echo | shimmer | ash | coral | sage
const OPENAI_WS_TIMEOUT_MS = 4000

Deno.serve(async (req) => {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket required', { status: 426 })
  }
  const { socket, response } = Deno.upgradeWebSocket(req)
  handleCall(socket).catch((err) => {
    console.error('[twilio-realtime] fatal:', err)
    try { socket.close() } catch { /* ignore */ }
  })
  return response
})

// ─── Main call handler ────────────────────────────────────────────────────────

async function handleCall(twilioWs: WebSocket) {
  const db = adminClient()
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) { twilioWs.close(); return }

  // Mutable call state
  let openaiWs: WebSocket | null = null
  let streamSid = ''
  let callSid = ''
  let callDbId: string | null = null
  let userId = ''
  let ctx: AIContext | null = null
  let audioQueue: string[] = []       // buffer until OpenAI is ready
  let transcript: string[] = []       // interleaved turns in order
  let currentAiChunk = ''            // accumulate AI audio transcript
  let bookingId: string | null = null
  let finalized = false

  // ── Twilio events ────────────────────────────────────────────────────────

  twilioWs.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data as string)

      // ── START — call begins, load context, connect OpenAI ──────────────
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid
        callSid   = msg.start.callSid
        const params = msg.start.customParameters ?? {}
        const from   = params.from ?? ''
        const to     = params.to  ?? ''

        // Minimal lookup to get user_id from Twilio number
        const { data: cfg } = await db
          .from('company_settings')
          .select([
            'user_id', 'company_name', 'ai_greeting', 'ai_notes', 'company_description',
            'working_hours', 'timezone', 'cancellation_policy',
            'lead_time_minutes', 'max_booking_horizon_days', 'default_buffer_minutes',
            'ai_auto_book', 'ai_confirm_sms', 'allow_unknown_service',
            'escalation_phone', 'twilio_phone_number', 'twilio_account_sid', 'twilio_auth_token',
            'elevenlabs_voice_id',
          ].join(', '))
          .eq('twilio_phone_number', to)
          .maybeSingle()

        if (!cfg) { twilioWs.close(); return }
        userId = cfg.user_id

        // Build full AI context (services, customer, slots — all parallel)
        ctx = await buildAIContext(db, userId, from, cfg)

        // Create call record (or find existing from twilio-voice)
        const { data: existingCall } = await db.from('calls')
          .select('id').eq('twilio_call_sid', callSid).maybeSingle()
        if (existingCall) {
          callDbId = existingCall.id
        } else {
          const { data: newCall } = await db.from('calls').insert({
            user_id: userId,
            customer_phone: from,
            twilio_call_sid: callSid,
            status: 'live',
          }).select('id').single()
          callDbId = newCall?.id ?? null
        }

        // Snapshot what AI knows (for debugging)
        if (callDbId) {
          db.from('calls').update({
            ai_context_snapshot: {
              services: ctx.services.map(s => s.name),
              customer: {
                isReturning: ctx.customer.isReturning,
                isVip: ctx.customer.isVip,
                name: ctx.customer.name,
                favoriteService: ctx.customer.favoriteService,
              },
              slotsOffered: ctx.availability.slots.length,
              timestamp: new Date().toISOString(),
            },
          }).eq('id', callDbId).then(() => {})
        }

        const systemPrompt = buildSystemPrompt(ctx)

        // Connect to OpenAI Realtime API
        openaiWs = new WebSocket(
          `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`,
          ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1'],
        )

        // Fail fast if OpenAI WS doesn't open in time
        const wsTimeout = setTimeout(() => {
          if (openaiWs?.readyState !== WebSocket.OPEN) {
            console.error('[twilio-realtime] OpenAI WS timeout — closing Twilio connection')
            if (callDbId) {
              db.from('calls').update({ status: 'missed' }).eq('id', callDbId).then(() => {})
            }
            twilioWs.close()
          }
        }, OPENAI_WS_TIMEOUT_MS)

        openaiWs.onopen = () => {
          clearTimeout(wsTimeout)

          // Configure the session
          sendToOpenAI({
            type: 'session.update',
            session: {
              instructions: systemPrompt,
              voice: OPENAI_VOICE,
              input_audio_format: 'g711_ulaw',
              output_audio_format: 'g711_ulaw',
              input_audio_transcription: { model: 'whisper-1' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 700,
              },
              tools: buildTools(ctx!),
              tool_choice: 'auto',
            },
          })

          // Inject greeting trigger so AI speaks first
          const greeting = ctx?.company.aiGreeting
            ?? `Dobrý den, vítejte v ${ctx?.company.name ?? 'salonu'}. Čím vám mohu pomoci?`
          sendToOpenAI({
            type: 'conversation.item.create',
            item: {
              type: 'message', role: 'user',
              content: [{ type: 'input_text', text: `[SYSTEM: Zavolal zákazník. Pozdrav ho přesně takto: "${greeting}"]` }],
            },
          })
          sendToOpenAI({ type: 'response.create' })

          // Flush buffered audio
          for (const payload of audioQueue) {
            sendToOpenAI({ type: 'input_audio_buffer.append', audio: payload })
          }
          audioQueue = []
        }

        openaiWs.onmessage = async (oaiEvent) => {
          const m = JSON.parse(oaiEvent.data as string)
          await handleOpenAIEvent(m, from)
        }

        openaiWs.onclose = () => finalizeCall()
        openaiWs.onerror = (e) => console.error('[twilio-realtime] OpenAI WS error:', e)
      }

      // ── MEDIA — audio chunk from caller ────────────────────────────────
      if (msg.event === 'media') {
        if (openaiWs?.readyState === WebSocket.OPEN) {
          sendToOpenAI({ type: 'input_audio_buffer.append', audio: msg.media.payload })
        } else {
          audioQueue.push(msg.media.payload)
        }
      }

      // ── STOP — call ended ──────────────────────────────────────────────
      if (msg.event === 'stop') {
        await finalizeCall()
        openaiWs?.close()
      }
    } catch (err) {
      console.error('[twilio-realtime] onmessage error:', err)
    }
  }

  twilioWs.onclose = () => {
    finalizeCall()
    openaiWs?.close()
  }

  // ── OpenAI event dispatcher ───────────────────────────────────────────────

  async function handleOpenAIEvent(m: any, callerPhone: string) {
    // Forward AI audio to caller
    if (m.type === 'response.audio.delta') {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: 'media', streamSid,
          media: { payload: m.delta },
        }))
      }
    }

    // Track AI speech transcript
    if (m.type === 'response.audio_transcript.delta') {
      currentAiChunk += m.delta
    }
    if (m.type === 'response.audio_transcript.done') {
      if (currentAiChunk.trim()) transcript.push(`Nikola: ${currentAiChunk.trim()}`)
      currentAiChunk = ''
    }

    // Track caller transcript (Whisper)
    if (m.type === 'conversation.item.input_audio_transcription.completed') {
      const t = m.transcript?.trim()
      if (t) transcript.push(`Zákazník: ${t}`)
    }

    // Tool call completed — execute it
    if (m.type === 'response.output_item.done' && m.item?.type === 'function_call') {
      const { name, call_id, arguments: rawArgs } = m.item
      let args: Record<string, string> = {}
      try { args = JSON.parse(rawArgs) } catch { /* malformed */ }

      const output = await executeTool(name, args, callerPhone)
      sendToOpenAI({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output } })
      sendToOpenAI({ type: 'response.create' })
    }

    if (m.type === 'error') {
      console.error('[twilio-realtime] OpenAI error event:', m.error)
    }
  }

  // ── Tool execution ────────────────────────────────────────────────────────

  async function executeTool(name: string, args: Record<string, string>, callerPhone: string): Promise<string> {
    if (!ctx) return 'Kontext není k dispozici.'
    const tz = ctx.company.timezone

    if (name === 'cancel_booking') {
      try {
        const { booking_id } = args
        if (!booking_id) return 'Chybí ID rezervace. Zkontroluj sekci Existující rezervace zákazníka v kontextu.'

        const { data: bk } = await db.from('bookings')
          .select('id, starts_at, status, services(name)')
          .eq('id', booking_id)
          .eq('user_id', userId)
          .single()

        if (!bk) return 'Rezervace nenalezena nebo nepatří tomuto zákazníkovi.'
        if (bk.status === 'cancelled') return 'Tato rezervace již byla dříve zrušena.'

        await db.from('bookings').update({ status: 'cancelled' }).eq('id', booking_id).eq('user_id', userId)

        const startsAt = new Date(bk.starts_at)
        const serviceName = (bk.services as any)?.name ?? 'služba'
        const dateLabel = startsAt.toLocaleString('cs-CZ', {
          timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        })

        if (ctx.company.aiConfirmSms) {
          sendSmsCancellation(
            {
              twilio_account_sid: ctx.company.twilioAccountSid,
              twilio_auth_token: ctx.company.twilioAuthToken,
              twilio_phone_number: ctx.company.twilioPhoneNumber,
              company_name: ctx.company.name,
              escalation_phone: ctx.company.escalationPhone,
            },
            callerPhone, serviceName, startsAt, ctx.customer.name, tz,
          )
        }

        if (callDbId) {
          await db.from('calls').update({ status: 'resched' }).eq('id', callDbId)
        }

        return `Rezervace ${serviceName} na ${dateLabel} byla úspěšně zrušena.`
      } catch (err) {
        return `Chyba při rušení rezervace: ${(err as Error).message}`
      }
    }

    if (name === 'get_more_slots') {
      try {
        const { service_name, preferred_date } = args
        const svc = service_name ? matchService(ctx.services, service_name) : ctx.services[0]
        const targetDate = new Date(preferred_date)
        if (isNaN(targetDate.getTime())) return 'Neplatné datum. Použij formát YYYY-MM-DD.'

        const slots = await getAvailableSlots(
          db, userId,
          svc?.durationMin ?? 60,
          svc?.bufferAfterMin ?? ctx.company.defaultBufferMinutes,
          targetDate, tz,
          ctx.company.workingHours,
          ctx.company.leadTimeMinutes,
          ctx.company.maxHorizonDays,
          8,
        )

        const dayLabel = targetDate.toLocaleDateString('cs-CZ', {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
        })

        if (!slots.length) return `${dayLabel} nemáme volné termíny. Zkus navrhnout jiný den.`
        const times = slots.slice(0, 6).map(s =>
          s.startsAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
        )
        return `Volné termíny ${dayLabel}: ${times.join(', ')}`
      } catch (err) {
        return `Chyba při načítání termínů: ${(err as Error).message}`
      }
    }

    if (name === 'confirm_booking') {
      try {
        const { service_name, preferred_date, customer_name } = args

        const svc = matchService(ctx.services, service_name)
        const startsAt = new Date(preferred_date)
        if (isNaN(startsAt.getTime())) return 'Chyba: neplatný formát data. Požádej zákazníka o upřesnění.'

        if (ctx.company.aiAutoBook) {
          const slots = await getAvailableSlots(
            db, userId,
            svc?.durationMin ?? 60,
            svc?.bufferAfterMin ?? ctx.company.defaultBufferMinutes,
            startsAt, tz,
            ctx.company.workingHours,
            ctx.company.leadTimeMinutes,
            ctx.company.maxHorizonDays,
            4,
          )
          const match = slots.find(s => Math.abs(s.startsAt.getTime() - startsAt.getTime()) <= 15 * 60000)
          if (!match && slots.length > 0) {
            const alts = slots.slice(0, 3).map(s => s.display).join(', ')
            return `Termín ${startsAt.toLocaleString('cs-CZ', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} není volný. Nabídni zákazníkovi tyto alternativy: ${alts}`
          }
          if (!match && slots.length === 0) {
            return 'V navrhovaném termínu ani v blízkém okolí není žádný volný čas. Informuj zákazníka a nabídni přepojení nebo zavolání zpět.'
          }
        }

        const endsAt = new Date(startsAt.getTime() + (svc?.durationMin ?? 60) * 60000)

        const { data: cust } = await db.from('customers')
          .upsert({ user_id: userId, phone: callerPhone, name: customer_name ?? null }, { onConflict: 'user_id,phone' })
          .select('id').single()

        const { data: bk, error: bkErr } = await db.from('bookings').insert({
          user_id: userId,
          service_id: svc?.id ?? null,
          customer_id: cust?.id ?? null,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          note: 'Rezervace přes AI recepční',
        }).select('id').single()

        if (bkErr) return `Rezervaci se nepodařilo uložit: ${bkErr.message}`

        bookingId = bk?.id ?? null
        if (callDbId) {
          await db.from('calls')
            .update({ customer_name: customer_name ?? null, booking_id: bookingId })
            .eq('id', callDbId)
        }

        if (ctx.company.aiConfirmSms) {
          sendSmsConfirmations(
            {
              twilio_account_sid: ctx.company.twilioAccountSid,
              twilio_auth_token: ctx.company.twilioAuthToken,
              twilio_phone_number: ctx.company.twilioPhoneNumber,
              company_name: ctx.company.name,
              escalation_phone: ctx.company.escalationPhone,
            },
            callerPhone, service_name, startsAt, customer_name ?? null, tz,
          )
        }

        const dateLabel = startsAt.toLocaleString('cs-CZ', {
          timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        })
        return `Rezervace úspěšně vytvořena: ${service_name}, ${dateLabel}. Zákazník: ${customer_name ?? callerPhone}.`
      } catch (err) {
        return `Chyba: ${(err as Error).message}`
      }
    }

    if (name === 'transfer_call') {
      if (!ctx.company.escalationPhone) return 'Přepojení není k dispozici — není nastaven záložní telefon.'
      try {
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${ctx.company.twilioAccountSid}/Calls/${callSid}.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${ctx.company.twilioAccountSid}:${ctx.company.twilioAuthToken}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              Twiml: `<Response><Dial>${ctx.company.escalationPhone}</Dial></Response>`,
            }).toString(),
          },
        )
        return 'Přepojení zahájeno.'
      } catch {
        return 'Přepojení se nepodařilo.'
      }
    }

    return 'Neznámá funkce.'
  }

  // ── Call finalization ─────────────────────────────────────────────────────

  async function finalizeCall() {
    if (finalized || !callDbId) return
    finalized = true
    const fullTranscript = transcript.join('\n') || null
    const hasUserSpeech = transcript.some(l => l.startsWith('Zákazník'))
    await db.from('calls').update({
      status: bookingId ? 'booked' : hasUserSpeech ? 'info' : 'missed',
      transcript_full: fullTranscript,
      booking_id: bookingId,
      conversation_state: null,
    }).eq('id', callDbId)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function sendToOpenAI(msg: object) {
    if (openaiWs?.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify(msg))
    }
  }
}

// ─── OpenAI tools ─────────────────────────────────────────────────────────────

function buildTools(ctx: AIContext) {
  const serviceEnum = ctx.services.map(s => s.name)
  const bookingIds = ctx.customer.upcomingBookings.map(b => b.id)
  return [
    ...(bookingIds.length ? [{
      type: 'function',
      name: 'cancel_booking',
      description: 'Zruší existující rezervaci zákazníka. Volej POUZE po explicitním potvrzení zákazníkem.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: {
            type: 'string',
            description: 'ID rezervace ze sekce Existující rezervace zákazníka',
            ...(bookingIds.length ? { enum: bookingIds } : {}),
          },
        },
        required: ['booking_id'],
      },
    }] : []),
    {
      type: 'function',
      name: 'get_more_slots',
      description: 'Načti další volné termíny. Volej když zákazník odmítne navrhované termíny nebo chce jiný den.',
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Název požadované služby' },
          preferred_date: { type: 'string', description: 'Preferované datum ve tvaru YYYY-MM-DD' },
        },
        required: ['preferred_date'],
      },
    },
    {
      type: 'function',
      name: 'confirm_booking',
      description: 'Vytvoří rezervaci jakmile zákazník potvrdí službu, termín a své jméno.',
      parameters: {
        type: 'object',
        properties: {
          service_name: {
            type: 'string',
            description: 'Název služby',
            ...(serviceEnum.length ? { enum: serviceEnum } : {}),
          },
          preferred_date: {
            type: 'string',
            description: 'ISO datetime YYYY-MM-DDTHH:MM:SS v lokálním čase',
          },
          customer_name: {
            type: 'string',
            description: 'Celé jméno zákazníka',
          },
        },
        required: ['service_name', 'preferred_date', 'customer_name'],
      },
    },
    ...(ctx.company.escalationPhone ? [{
      type: 'function',
      name: 'transfer_call',
      description: 'Přepojí hovor na živou recepci pokud zákazník chce mluvit s člověkem.',
      parameters: { type: 'object', properties: {} },
    }] : []),
  ]
}
