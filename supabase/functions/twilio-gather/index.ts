/**
 * Twilio Gather Webhook — called after caller speaks.
 * Uses GPT-4o for reasoning, ElevenLabs for voice (Polly.Maja fallback).
 * Falls back to Claude Haiku if OPENAI_API_KEY not set.
 *
 * IMPORTANT: Disable JWT verification for this function in Supabase Dashboard.
 */
import { adminClient } from '../_shared/supabase.ts'
import { getAvailableSlots } from '../_shared/scheduling.ts'
import { buildAIContext, matchService, sendSmsConfirmations, sendSmsCancellation } from '../_shared/aiContext.ts'
import { buildGatherSystemPrompt } from '../_shared/systemPrompt.ts'

const FALLBACK_VOICE = 'Polly.Maja'
const MAX_TURNS = 8

interface ConvState {
  turns: Array<{ role: 'user' | 'assistant'; content: string }>
  customerName?: string
  customerPhone: string
  userId: string
  companyName: string
  callSid: string
}

interface AIAction {
  speak: string
  done: boolean
  action?: string | null
  booking_id?: string | null
  slot_request?: { service_name?: string; preferred_date?: string } | null
  booking?: {
    service_name: string
    preferred_date: string
    customer_name?: string
  } | null
  transfer?: boolean
  update_summary?: string | null
}

Deno.serve(async (req) => {
  const form = await req.formData()
  const speech  = (form.get('SpeechResult') as string) ?? ''
  const from    = (form.get('From')         as string) ?? ''
  const to      = (form.get('To')           as string) ?? ''
  const callSid = (form.get('CallSid')      as string) ?? ''

  const db = adminClient()

  // Route lookup — try multiple phone number formats (Twilio may send with/without spaces, +, etc.)
  const COLS = [
    'user_id', 'company_name', 'ai_greeting', 'ai_notes', 'company_description',
    'working_hours', 'timezone', 'cancellation_policy',
    'lead_time_minutes', 'max_booking_horizon_days', 'default_buffer_minutes',
    'ai_auto_book', 'ai_confirm_sms', 'allow_unknown_service',
    'escalation_phone', 'twilio_phone_number', 'twilio_account_sid', 'twilio_auth_token',
    'elevenlabs_voice_id',
  ].join(', ')

  const phoneVariants = [to, to.replace(/\s/g, ''), to.replace(/^\+/, ''), `+${to.replace(/^\+/, '')}`]
  let settings: any = null
  for (const variant of phoneVariants) {
    const { data } = await db.from('company_settings').select(COLS).eq('twilio_phone_number', variant).maybeSingle()
    if (data) { settings = data; break }
  }

  console.log('[twilio-gather] settings lookup', { found: !!settings, to, callSid })

  if (!settings) {
    console.error('[twilio-gather] NO COMPANY FOUND for phone number', to)
    return twimlSpeak('Omlouváme se, tato linka není momentálně dostupná.', null)
  }

  const { user_id: userId, company_name: companyName } = settings
  const voiceId: string | null = settings.elevenlabs_voice_id ?? null

  // Build full AI context (pre-pass settings to skip second DB fetch)
  const ctx = await buildAIContext(db, userId, from, settings)

  const { data: callRow } = await db
    .from('calls')
    .select('id, conversation_state, customer_name')
    .eq('twilio_call_sid', callSid)
    .maybeSingle()

  const state: ConvState = callRow?.conversation_state ?? {
    turns: [],
    customerPhone: from,
    userId,
    companyName,
    callSid,
  }

  if (speech) {
    state.turns.push({ role: 'user', content: speech })
  }

  if (state.turns.filter(t => t.role === 'user').length > MAX_TURNS) {
    await finalizeCall(db, callSid, userId, from, state, 'Hovor ukončen — překročen limit otázek.')
    return twimlSpeak('Zkuste prosím zavolat znovu nebo nás kontaktujte jinak. Nashledanou.', voiceId, true)
  }

  const systemPrompt = buildGatherSystemPrompt(ctx)
  const messages = state.turns.map(t => ({ role: t.role, content: t.content }))

  let action: AIAction = await callOpenAI(systemPrompt, messages)

  // Handle get_more_slots — inject fresh slots and re-query AI
  if (!action.done && action.action === 'get_more_slots' && action.slot_request) {
    const req2 = action.slot_request ?? {}
    const svc = req2.service_name ? matchService(ctx.services, req2.service_name) : ctx.services[0]
    const targetDate = req2.preferred_date ? new Date(req2.preferred_date) : new Date()

    if (!isNaN(targetDate.getTime())) {
      try {
        const slots = await getAvailableSlots(
          db, userId,
          svc?.durationMin ?? 60,
          svc?.bufferAfterMin ?? ctx.company.defaultBufferMinutes,
          targetDate, ctx.company.timezone,
          ctx.company.workingHours,
          ctx.company.leadTimeMinutes,
          ctx.company.maxHorizonDays,
          8,
        )
        const dayLabel = targetDate.toLocaleDateString('cs-CZ', {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: ctx.company.timezone,
        })
        const times = slots.slice(0, 6).map(s =>
          s.startsAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: ctx.company.timezone }),
        )
        const slotsMsg = slots.length
          ? `[systém: volné termíny ${dayLabel}: ${times.join(', ')}. Nabídni zákazníkovi tyto termíny.]`
          : `[systém: ${dayLabel} nemáme volné termíny. Doporuč jiný den.]`
        state.turns.push({ role: 'user', content: slotsMsg })
        action = await callOpenAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      } catch { /* fall through with original action */ }
    }
  }

  // Verify slot availability when booking proposed
  if (action.done && action.booking && ctx.company.aiAutoBook) {
    const svc = matchService(ctx.services, action.booking.service_name)
    const proposedDate = new Date(action.booking.preferred_date)

    if (!isNaN(proposedDate.getTime())) {
      const slots = await getAvailableSlots(
        db, userId,
        svc?.durationMin ?? 60,
        svc?.bufferAfterMin ?? ctx.company.defaultBufferMinutes,
        proposedDate, ctx.company.timezone,
        ctx.company.workingHours,
        ctx.company.leadTimeMinutes,
        ctx.company.maxHorizonDays,
        4,
      )

      const exactMatch = slots.find(s => Math.abs(s.startsAt.getTime() - proposedDate.getTime()) <= 15 * 60000)

      if (!exactMatch && slots.length > 0) {
        const altList = slots.slice(0, 3).map(s => s.display).join(', ')
        state.turns.push({
          role: 'user',
          content: `[systém: navrhovaný čas (${proposedDate.toLocaleString('cs-CZ', { timeZone: ctx.company.timezone })}) není volný. Nejbližší volné termíny: ${altList}. Nabídni zákazníkovi tyto alternativy.]`,
        })
        action = await callOpenAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      } else if (slots.length === 0) {
        state.turns.push({
          role: 'user',
          content: '[systém: v navrhovaném termínu ani v blízkém okolí není žádný volný čas. Informuj zákazníka a nabídni zavolání zpět nebo přepojení.]',
        })
        action = await callOpenAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      }
    }
  }

  state.turns.push({ role: 'assistant', content: action.speak })

  const extractedName = action.booking?.customer_name ?? state.customerName
  if (extractedName && extractedName !== state.customerName) {
    state.customerName = extractedName
    await db.from('calls').update({ customer_name: extractedName }).eq('twilio_call_sid', callSid)
  }

  if (action.done && action.action === 'cancel_booking') {
    const bookingId = action.booking_id ?? null
    if (bookingId) {
      const { data: bk } = await db.from('bookings')
        .select('id, starts_at, status, services(name)')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .single()

      if (bk && bk.status !== 'cancelled') {
        await db.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId).eq('user_id', userId)

        const startsAt = new Date(bk.starts_at)
        const serviceName = (bk.services as any)?.name ?? 'služba'

        if (ctx.company.aiConfirmSms) {
          sendSmsCancellation(
            {
              twilio_account_sid: ctx.company.twilioAccountSid,
              twilio_auth_token: ctx.company.twilioAuthToken,
              twilio_phone_number: ctx.company.twilioPhoneNumber,
              company_name: ctx.company.name,
              escalation_phone: ctx.company.escalationPhone,
            },
            from, serviceName, startsAt, extractedName ?? null, ctx.company.timezone,
          )
        }
      }
    }
    await finalizeCall(db, callSid, userId, from, state, action.update_summary ?? 'Zákazník zrušil rezervaci.', extractedName)
    return twimlSpeak(action.speak, voiceId, true)
  }

  if (action.done && action.transfer && ctx.company.escalationPhone) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlTransfer(action.speak, ctx.company.escalationPhone, voiceId)
  }

  if (action.done && action.booking) {
    const svc = matchService(ctx.services, action.booking.service_name)
    const startsAt = new Date(action.booking.preferred_date)
    const endsAt = new Date(startsAt.getTime() + (svc?.durationMin ?? 60) * 60000)

    let bookingId: string | null = null
    if (!isNaN(startsAt.getTime())) {
      const { data: cust } = await db.from('customers')
        .upsert(
          { user_id: userId, phone: from, name: action.booking.customer_name ?? null },
          { onConflict: 'user_id,phone' },
        )
        .select('id').single()

      const { data: bk } = await db.from('bookings').insert({
        user_id: userId,
        service_id: svc?.id ?? null,
        customer_id: cust?.id ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        note: 'Rezervace přes AI recepční',
      }).select('id').single()

      bookingId = bk?.id ?? null
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
        from,
        action.booking.service_name,
        new Date(action.booking.preferred_date),
        action.booking.customer_name ?? null,
        ctx.company.timezone,
      )
    }

    await finalizeCall(db, callSid, userId, from, state, action.update_summary, action.booking.customer_name, bookingId)
    return twimlSpeak(action.speak, voiceId, true)
  }

  if (action.done) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlSpeak(action.speak, voiceId, true)
  }

  await db.from('calls')
    .update({ conversation_state: state, customer_name: extractedName ?? null })
    .eq('twilio_call_sid', callSid)

  const gatherUrl = escapeXml(`${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST"
          timeout="5" speechTimeout="auto" language="cs-CZ"
          actionOnEmptyResult="true">
    ${speak(action.speak, voiceId)}
  </Gather>
  ${speak('Promiňte, neslyšela jsem vás.', voiceId)}
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
})

// ─── AI ─────────────────────────────────────────────────────────────────────

async function callOpenAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<AIAction> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) return callClaude(systemPrompt, messages)
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const body = await resp.json()
    if (!resp.ok) throw new Error(body.error?.message ?? 'OpenAI error')
    return parseAIResponse(body.choices?.[0]?.message?.content ?? '{}')
  } catch (err) {
    console.error('[twilio-gather] OpenAI error:', err)
    // Fall back to Claude if available (e.g. OpenAI quota exhausted)
    if (Deno.env.get('ANTHROPIC_API_KEY')) {
      console.log('[twilio-gather] falling back to Claude')
      return callClaude(systemPrompt, messages)
    }
    return { speak: 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.', done: true }
  }
}

async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<AIAction> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    })
    const body = await resp.json()
    return parseAIResponse(body.content?.[0]?.text ?? '{}')
  } catch {
    return { speak: 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.', done: true }
  }
}

// 4-stage fallback JSON parser — handles markdown fences, partial JSON, etc.
function parseAIResponse(raw: string): AIAction {
  try { return JSON.parse(raw) } catch {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
  if (fence) try { return JSON.parse(fence) } catch {}
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) } catch {}
  }
  return { speak: 'Omlouvám se, mám technický problém. Přepojím vás.', done: true, transfer: true }
}

// ─── Call finalization ────────────────────────────────────────────────────────

async function finalizeCall(
  db: ReturnType<typeof adminClient>,
  callSid: string,
  userId: string,
  phone: string,
  state: ConvState,
  summary?: string | null,
  customerName?: string | null,
  bookingId?: string | null,
) {
  const fullTranscript = state.turns
    .filter(t => !t.content.startsWith('[systém:'))
    .map(t => `${t.role === 'user' ? 'Zákazník' : 'Nikola'}: ${t.content}`)
    .join('\n')

  const hasUserSpeech = state.turns.some(
    t => t.role === 'user' && t.content && !t.content.startsWith('[systém:'),
  )

  await db.from('calls').update({
    status:             bookingId ? 'booked' : hasUserSpeech ? 'info' : 'missed',
    customer_name:      customerName ?? null,
    summary:            summary ?? null,
    transcript_full:    fullTranscript,
    booking_id:         bookingId ?? null,
    conversation_state: null,
  }).eq('twilio_call_sid', callSid)

  if (summary && phone) {
    const { data: cust } = await db.from('customers')
      .select('id, notes').eq('user_id', userId).eq('phone', phone).maybeSingle()
    if (cust) {
      const date = new Date().toLocaleDateString('cs-CZ')
      const newNote = `[${date}] ${summary}`
      const updatedNotes = cust.notes ? `${cust.notes}\n${newNote}` : newNote
      await db.from('customers').update({ notes: updatedNotes.slice(0, 2000) }).eq('id', cust.id)
    }
  }
}

// ─── TwiML ───────────────────────────────────────────────────────────────────

function speak(text: string, voiceId: string | null): string {
  if (voiceId) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/tts?t=${encodeURIComponent(text)}&v=${encodeURIComponent(voiceId)}`
    return `<Play>${escapeXml(url)}</Play>`
  }
  return `<Say voice="${FALLBACK_VOICE}" language="cs-CZ">${escapeXml(text)}</Say>`
}

function twimlSpeak(text: string, voiceId: string | null, hangup = false) {
  const close = hangup ? '<Hangup/>' : ''
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(text, voiceId)}${close}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function twimlTransfer(speakText: string, dialNumber: string, voiceId: string | null) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(speakText, voiceId)}<Dial>${escapeXml(dialNumber)}</Dial></Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
