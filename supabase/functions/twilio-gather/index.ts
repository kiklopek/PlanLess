/**
 * Twilio Gather Webhook — called after caller speaks.
 * AI provider router: Gemini (free) → OpenAI → Claude, whichever key is set.
 * Voice: ElevenLabs if configured, else Polly.Maja fallback.
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
    'elevenlabs_voice_id', 'ai_language',
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
    const fallbackLang = (settings as any)?.ai_language === 'en-US' ? 'en-US' : 'cs-CZ'
    const fallbackMsg = fallbackLang === 'en-US'
      ? 'Sorry, this line is currently unavailable.'
      : 'Omlouváme se, tato linka není momentálně dostupná.'
    return twimlSpeak(fallbackMsg, null, false, fallbackLang)
  }

  const { user_id: userId, company_name: companyName } = settings
  const voiceId: string | null = settings.elevenlabs_voice_id ?? null
  const sayLang: string = settings.ai_language === 'en-US' ? 'en-US' : 'cs-CZ'
  const isEN: boolean = sayLang === 'en-US'

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
    const limitSummary = isEN ? 'Call ended — question limit exceeded.' : 'Hovor ukončen — překročen limit otázek.'
    const limitMsg = isEN ? 'Please try calling again or contact us another way. Goodbye.' : 'Zkuste prosím zavolat znovu nebo nás kontaktujte jinak. Nashledanou.'
    await finalizeCall(db, callSid, userId, from, state, limitSummary)
    return twimlSpeak(limitMsg, voiceId, true, sayLang)
  }

  const systemPrompt = buildGatherSystemPrompt(ctx)
  const messages = state.turns.map(t => ({ role: t.role, content: t.content }))

  let action: AIAction = await callAI(systemPrompt, messages, sayLang)

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
        action = await callAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })), sayLang)
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
        action = await callAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })), sayLang)
      } else if (slots.length === 0) {
        state.turns.push({
          role: 'user',
          content: '[systém: v navrhovaném termínu ani v blízkém okolí není žádný volný čas. Informuj zákazníka a nabídni zavolání zpět nebo přepojení.]',
        })
        action = await callAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })), sayLang)
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
    return twimlSpeak(action.speak, voiceId, true, sayLang)
  }

  if (action.done && action.transfer && ctx.company.escalationPhone) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlTransfer(action.speak, ctx.company.escalationPhone, voiceId, sayLang)
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
    return twimlSpeak(action.speak, voiceId, true, sayLang)
  }

  if (action.done) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlSpeak(action.speak, voiceId, true, sayLang)
  }

  await db.from('calls')
    .update({ conversation_state: state, customer_name: extractedName ?? null })
    .eq('twilio_call_sid', callSid)

  const gatherUrl = escapeXml(`${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`)
  const isEN = ctx.company.language === 'en-US'
  const sayLang = isEN ? 'en-US' : 'cs-CZ'
  const notHeard = isEN ? "Sorry, I didn't hear you." : 'Promiňte, neslyšela jsem vás.'
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST"
          timeout="5" speechTimeout="auto" language="${sayLang}"
          actionOnEmptyResult="true">
    ${speak(action.speak, voiceId, sayLang)}
  </Gather>
  ${speak(notHeard, voiceId, sayLang)}
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
})

// ─── AI ─────────────────────────────────────────────────────────────────────

function techError(lang: string): AIAction {
  return {
    speak: lang === 'en-US'
      ? "Sorry, I'm having technical issues right now. Please call again."
      : 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.',
    done: true,
  }
}

/**
 * Provider router — tries each configured provider in order until one succeeds.
 * Order: Gemini → Groq (both free tier) → OpenAI → Claude. Set the matching env secret.
 */
async function callAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  lang = 'cs-CZ',
): Promise<AIAction> {
  const providers: Array<() => Promise<AIAction | null>> = []
  if (Deno.env.get('GEMINI_API_KEY'))    providers.push(() => callOpenAICompatible(systemPrompt, messages, 'gemini'))
  if (Deno.env.get('GROQ_API_KEY'))      providers.push(() => callOpenAICompatible(systemPrompt, messages, 'groq'))
  if (Deno.env.get('OPENAI_API_KEY'))    providers.push(() => callOpenAICompatible(systemPrompt, messages, 'openai'))
  if (Deno.env.get('ANTHROPIC_API_KEY')) providers.push(() => callClaude(systemPrompt, messages))

  for (const provider of providers) {
    try {
      const result = await provider()
      if (result) return result
    } catch (err) {
      console.error('[twilio-gather] provider failed, trying next:', err)
    }
  }
  return techError(lang)
}

// OpenAI, Gemini and Groq all share the /chat/completions request shape.
// Gemini and Groq expose OpenAI-compatible endpoints, so one function covers all three.
async function callOpenAICompatible(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  provider: 'openai' | 'gemini' | 'groq',
): Promise<AIAction | null> {
  const cfg = provider === 'gemini'
    ? {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        key: Deno.env.get('GEMINI_API_KEY')!,
        model: 'gemini-2.0-flash',
      }
    : provider === 'groq'
    ? {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: Deno.env.get('GROQ_API_KEY')!,
        model: 'llama-3.3-70b-versatile',
      }
    : {
        url: 'https://api.openai.com/v1/chat/completions',
        key: Deno.env.get('OPENAI_API_KEY')!,
        model: 'gpt-4o',
      }

  const resp = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  })
  const body = await resp.json()
  if (!resp.ok) {
    console.error(`[twilio-gather] ${provider} HTTP ${resp.status}:`, JSON.stringify(body))
    throw new Error(body.error?.message ?? `${provider} error`)
  }
  return parseAIResponse(body.choices?.[0]?.message?.content ?? '{}')
}

async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<AIAction | null> {
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
  if (!resp.ok) throw new Error(body.error?.message ?? 'Claude error')
  return parseAIResponse(body.content?.[0]?.text ?? '{}')
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

function speak(text: string, voiceId: string | null, lang = 'cs-CZ'): string {
  if (voiceId) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/tts?t=${encodeURIComponent(text)}&v=${encodeURIComponent(voiceId)}`
    return `<Play>${escapeXml(url)}</Play>`
  }
  const voice = lang === 'en-US' ? 'Polly.Joanna' : FALLBACK_VOICE
  return `<Say voice="${voice}" language="${lang}">${escapeXml(text)}</Say>`
}

function twimlSpeak(text: string, voiceId: string | null, hangup = false, lang = 'cs-CZ') {
  const close = hangup ? '<Hangup/>' : ''
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(text, voiceId, lang)}${close}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function twimlTransfer(speakText: string, dialNumber: string, voiceId: string | null, lang = 'cs-CZ') {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(speakText, voiceId, lang)}<Dial>${escapeXml(dialNumber)}</Dial></Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
