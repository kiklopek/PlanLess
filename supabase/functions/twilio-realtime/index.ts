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

const OPENAI_MODEL = 'gpt-4o-realtime-preview-2024-12-17'
const OPENAI_VOICE = 'alloy' // alloy | echo | shimmer | ash | coral | sage

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
  let settings: Record<string, any> | null = null
  let audioQueue: string[] = []          // buffer until OpenAI is ready
  let transcript: string[] = []          // interleaved turns in order
  let currentAiChunk = ''               // accumulate AI audio transcript
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

        // Load company settings via Twilio phone number
        const { data: cfg } = await db
          .from('company_settings')
          .select([
            'user_id', 'company_name', 'ai_greeting', 'ai_notes', 'company_description',
            'working_hours', 'timezone', 'cancellation_policy',
            'lead_time_minutes', 'max_booking_horizon_days', 'default_buffer_minutes',
            'ai_auto_book', 'ai_confirm_sms', 'allow_unknown_service',
            'escalation_phone', 'twilio_phone_number', 'twilio_account_sid', 'twilio_auth_token',
          ].join(', '))
          .eq('twilio_phone_number', to)
          .maybeSingle()

        if (!cfg) { twilioWs.close(); return }
        settings = cfg
        userId   = cfg.user_id
        const tz = cfg.timezone ?? 'Europe/Prague'

        // Parallel data fetch
        const [{ data: services }, { data: customer }] = await Promise.all([
          db.from('services').select('id, name, duration_min, price, buffer_after_min')
            .eq('user_id', userId).eq('is_active', true).limit(20),
          db.from('customers').select('id, name, notes, vip_status, last_visit_date')
            .eq('user_id', userId).eq('phone', from).maybeSingle(),
        ])

        const { data: history } = customer
          ? await db.from('bookings')
              .select('starts_at, services(name)')
              .eq('user_id', userId).eq('customer_id', customer.id)
              .order('starts_at', { ascending: false }).limit(10)
          : { data: null }

        const slotsCtx = await getUpcomingSlots(db, userId, services ?? [], cfg, tz)

        // Create call record (or find existing from twilio-voice)
        const { data: existingCall } = await db.from('calls')
          .select('id').eq('twilio_call_sid', callSid).maybeSingle()
        if (existingCall) {
          callDbId = existingCall.id
        } else {
          const { data: newCall } = await db.from('calls').insert({
            user_id: userId, customer_phone: from,
            twilio_call_sid: callSid, status: 'live',
          }).select('id').single()
          callDbId = newCall?.id ?? null
        }

        const systemPrompt = buildSystemPrompt(cfg, services ?? [], customer, history, slotsCtx, tz)

        // Connect to OpenAI Realtime API
        // Auth via WebSocket subprotocols — the only way in standard Deno WebSocket API
        openaiWs = new WebSocket(
          `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`,
          ['realtime', `openai-insecure-api-key.${apiKey}`, 'openai-beta.realtime-v1'],
        )

        openaiWs.onopen = () => {
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
              tools: buildTools(services ?? [], cfg),
              tool_choice: 'auto',
            },
          })

          // Inject greeting trigger so AI speaks first
          const greeting = cfg.ai_greeting ?? `Dobrý den, vítejte v ${cfg.company_name}. Čím vám mohu pomoci?`
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
          await handleOpenAIEvent(m, from, tz)
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

  async function handleOpenAIEvent(m: any, callerPhone: string, tz: string) {
    // Forward AI audio to caller
    if (m.type === 'response.audio.delta') {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({
          event: 'media',
          streamSid,
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

    // Track caller transcript (Whisper) — comes slightly after the turn ends
    if (m.type === 'conversation.item.input_audio_transcription.completed') {
      const t = m.transcript?.trim()
      if (t) transcript.push(`Zákazník: ${t}`)
    }

    // Tool call completed — execute it
    if (m.type === 'response.output_item.done' && m.item?.type === 'function_call') {
      const { name, call_id, arguments: rawArgs } = m.item
      let args: Record<string, string> = {}
      try { args = JSON.parse(rawArgs) } catch { /* malformed */ }

      const output = await executeTool(name, args, callerPhone, tz)
      sendToOpenAI({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output } })
      sendToOpenAI({ type: 'response.create' })
    }

    if (m.type === 'error') {
      console.error('[twilio-realtime] OpenAI error event:', m.error)
    }
  }

  // ── Tool execution ────────────────────────────────────────────────────────

  async function executeTool(name: string, args: Record<string, string>, callerPhone: string, tz: string): Promise<string> {
    if (name === 'confirm_booking') {
      try {
        const { service_name, preferred_date, customer_name } = args

        const { data: services } = await db.from('services')
          .select('id, name, duration_min, buffer_after_min')
          .eq('user_id', userId).eq('is_active', true)

        const svc = matchService(services ?? [], service_name)
        const startsAt = new Date(preferred_date)

        if (isNaN(startsAt.getTime())) return 'Chyba: neplatný formát data. Požádej zákazníka o upřesnění.'

        if (settings?.ai_auto_book !== false) {
          const slots = await getAvailableSlots(
            db, userId,
            svc?.duration_min ?? 60,
            svc?.buffer_after_min ?? settings?.default_buffer_minutes ?? 0,
            startsAt, tz,
            settings?.working_hours ?? {},
            settings?.lead_time_minutes ?? 120,
            settings?.max_booking_horizon_days ?? 60,
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

        const endsAt = new Date(startsAt.getTime() + (svc?.duration_min ?? 60) * 60000)

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
        if (callDbId) await db.from('calls').update({ customer_name: customer_name ?? null, booking_id: bookingId }).eq('id', callDbId)

        if (settings?.ai_confirm_sms !== false && settings?.twilio_account_sid) {
          sendSmsConfirmations(settings, callerPhone, service_name, startsAt, customer_name ?? null, tz)
        }

        const dateLabel = startsAt.toLocaleString('cs-CZ', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        return `Rezervace úspěšně vytvořena: ${service_name}, ${dateLabel}. Zákazník: ${customer_name ?? callerPhone}.`
      } catch (err) {
        return `Chyba: ${(err as Error).message}`
      }
    }

    if (name === 'transfer_call') {
      if (!settings?.escalation_phone) return 'Přepojení není k dispozici — není nastaven záložní telefon.'
      try {
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/Calls/${callSid}.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ Twiml: `<Response><Dial>${settings.escalation_phone}</Dial></Response>` }).toString(),
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

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  cfg: Record<string, any>,
  services: any[],
  customer: any,
  history: any[] | null,
  slotsCtx: string,
  tz: string,
): string {
  const companyName = cfg.company_name ?? 'salonu'
  const servicesText = services.length
    ? services.map(s => `- ${s.name} (${s.duration_min} min, ${s.price ?? '?'} Kč)`).join('\n')
    : 'Žádné služby momentálně k dispozici.'

  const customerCtx = customer ? (() => {
    const lines = [`Vracející se zákazník: ${customer.name || '(neznámé jméno)'}`]
    if (customer.vip_status) lines.push('VIP zákazník — věnuj zvláštní pozornost.')
    if (customer.notes) lines.push(`Poznámky: ${customer.notes}`)
    if (customer.last_visit_date) lines.push(`Poslední návštěva: ${customer.last_visit_date}`)
    if (history?.length) {
      const svcNames = [...new Set(history.map((b: any) => b.services?.name).filter(Boolean))]
      if (svcNames.length) lines.push(`Oblíbené služby: ${svcNames.join(', ')}`)
      const preferredTime = getPreferredTimeOfDay(history.map((b: any) => b.starts_at), tz)
      if (preferredTime) lines.push(`Zákazník obvykle rezervuje ${preferredTime} — navrhni termíny v tento čas.`)
    }
    return lines.join('\n')
  })() : null

  const extras = [
    cfg.company_description ? `O nás: ${cfg.company_description}` : null,
    cfg.cancellation_policy ? `Storno podmínky: ${cfg.cancellation_policy}` : null,
    cfg.ai_notes ? `Interní poznámky: ${cfg.ai_notes}` : null,
    `Nejdříve lze rezervovat: za ${cfg.lead_time_minutes ?? 120} minut od teď.`,
    cfg.escalation_phone ? 'Přepojení na recepci: k dispozici (funkce transfer_call).' : null,
    customerCtx,
    slotsCtx,
  ].filter(Boolean).join('\n')

  return `Jsi Nikola, AI recepční pro ${companyName}. Mluvíš česky, přátelsky a přirozeně.
${customer?.name ? `Zákazník se jmenuje ${customer.name} — oslovuj ho jménem.` : ''}
Dnešní datum: ${new Date().toLocaleDateString('cs-CZ', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })}.

Dostupné služby:
${servicesText}

${extras}

Instrukce:
- Mluv přirozeně a stručně (telefonní hovor). Nepřednášej dlouhé monology.
- Zjisti jméno zákazníka, požadovanou službu a preferovaný termín.
- Aktivně nabídni konkrétní volné termíny ze seznamu výše — neříkej jen "co vám vyhovuje?".
- Jakmile zákazník potvrdí termín, zavolej funkci confirm_booking — systém ověří dostupnost.
- Pokud zákazník chce přepojit na recepci, zavolej funkci transfer_call.
- Pokud se ptají na cenu nebo délku, řekni jim.`
}

// ─── OpenAI tools ─────────────────────────────────────────────────────────────

function buildTools(services: any[], cfg: Record<string, any>) {
  const serviceEnum = services.map(s => s.name)
  return [
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
    ...(cfg.escalation_phone ? [{
      type: 'function',
      name: 'transfer_call',
      description: 'Přepojí hovor na živou recepci pokud zákazník chce mluvit s člověkem.',
      parameters: { type: 'object', properties: {} },
    }] : []),
  ]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchService(services: any[], name: string) {
  const n = name.toLowerCase()
  return services.find(s => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase())) ?? null
}

function getPreferredTimeOfDay(startsAtList: string[], tz: string): string | null {
  if (!startsAtList.length) return null
  const hours = startsAtList.map(s =>
    parseInt(new Date(s).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }), 10),
  )
  const avg = hours.reduce((a, b) => a + b, 0) / hours.length
  if (avg < 11) return 'dopoledne'
  if (avg < 14) return 'okolo poledne'
  if (avg < 17) return 'odpoledne'
  return 'pozdě odpoledne nebo večer'
}

async function getUpcomingSlots(db: any, userId: string, services: any[], cfg: any, tz: string): Promise<string> {
  try {
    const durationMin = services[0]?.duration_min ?? 60
    const bufferMin   = cfg.default_buffer_minutes ?? 0
    const today       = new Date()
    const lines: string[] = []

    for (let offset = 0; offset < 5 && lines.length < 4; offset++) {
      const day   = new Date(today.getTime() + offset * 86400000)
      const slots = await getAvailableSlots(
        db, userId, durationMin, bufferMin, day, tz,
        cfg.working_hours ?? {},
        cfg.lead_time_minutes ?? 120,
        cfg.max_booking_horizon_days ?? 60,
        6,
      )
      if (!slots.length) continue
      const dayLabel = day.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
      const times    = slots.slice(0, 5).map(s =>
        s.startsAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      )
      lines.push(`${dayLabel}: ${times.join(', ')}`)
    }

    return lines.length
      ? `Aktuálně volné termíny (nabídni je aktivně):\n${lines.join('\n')}`
      : 'Momentálně nejsou volné termíny v nejbližší době.'
  } catch {
    return ''
  }
}

function sendSmsConfirmations(cfg: any, to: string, service: string, startsAt: Date, customerName: string | null, tz: string) {
  const base  = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilio_account_sid}/Messages.json`
  const auth  = `Basic ${btoa(`${cfg.twilio_account_sid}:${cfg.twilio_auth_token}`)}`
  const label = startsAt.toLocaleString('cs-CZ', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

  fetch(base, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: cfg.twilio_phone_number, Body: `Potvrzení rezervace: ${service}, ${label}. Těšíme se na vás! — ${cfg.company_name}` }).toString(),
  }).catch(() => {})

  if (cfg.escalation_phone) {
    fetch(base, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: cfg.escalation_phone, From: cfg.twilio_phone_number, Body: `Nikola zarezervovala: ${service}, ${label}. Zákazník: ${customerName ?? to}` }).toString(),
    }).catch(() => {})
  }
}
