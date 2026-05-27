/**
 * Twilio Gather Webhook — called after caller speaks.
 * Uses GPT-4o for reasoning, ElevenLabs for voice (Polly.Maja fallback).
 * Smart context: shows AI the next available slots + customer's preferred booking time.
 */
import { adminClient } from '../_shared/supabase.ts'
import { getAvailableSlots, isWithinWorkingHours } from '../_shared/scheduling.ts'

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
  booking?: {
    service_name: string
    preferred_date: string // ISO
    customer_name?: string
  }
  transfer?: boolean
  update_summary?: string
}

Deno.serve(async (req) => {
  const form = await req.formData()
  const speech  = (form.get('SpeechResult') as string) ?? ''
  const from    = (form.get('From')         as string) ?? ''
  const to      = (form.get('To')           as string) ?? ''
  const callSid = (form.get('CallSid')      as string) ?? ''

  const db = adminClient()

  const { data: settings } = await db
    .from('company_settings')
    .select([
      'user_id', 'company_name', 'ai_notes', 'company_description',
      'working_hours', 'timezone', 'cancellation_policy',
      'lead_time_minutes', 'max_booking_horizon_days', 'default_buffer_minutes',
      'ai_auto_book', 'ai_confirm_sms', 'allow_unknown_service',
      'escalation_phone', 'twilio_phone_number', 'twilio_account_sid', 'twilio_auth_token',
      'elevenlabs_voice_id',
    ].join(', '))
    .eq('twilio_phone_number', to)
    .maybeSingle()

  if (!settings) {
    return twimlSpeak('Omlouváme se, tato linka není momentálně dostupná.', null)
  }

  const { user_id: userId, company_name: companyName } = settings
  const tz = settings.timezone ?? 'Europe/Prague'
  const voiceId = settings.elevenlabs_voice_id ?? null

  const { data: services } = await db
    .from('services')
    .select('id, name, duration_min, price, buffer_after_min')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(20)

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

  // Customer memory: look up returning customer and booking history
  const { data: existingCustomer } = await db
    .from('customers')
    .select('id, name, notes, vip_status, last_visit_date')
    .eq('user_id', userId)
    .eq('phone', from)
    .maybeSingle()

  const { data: recentBookings } = existingCustomer ? await db
    .from('bookings')
    .select('starts_at, services(name)')
    .eq('user_id', userId)
    .eq('customer_id', existingCustomer.id)
    .order('starts_at', { ascending: false })
    .limit(10) : { data: null }

  // Detect customer's preferred time of day from booking history
  const preferredTime = recentBookings?.length
    ? getPreferredTimeOfDay(recentBookings.map((b: any) => b.starts_at), tz)
    : null

  const customerMemory = existingCustomer ? (() => {
    const lines = [`Vracející se zákazník: ${existingCustomer.name || from}`]
    if (existingCustomer.vip_status) lines.push('VIP zákazník — věnuj zvláštní pozornost.')
    if (existingCustomer.notes) lines.push(`Poznámky o zákazníkovi: ${existingCustomer.notes}`)
    if (existingCustomer.last_visit_date) lines.push(`Poslední návštěva: ${existingCustomer.last_visit_date}`)
    if (recentBookings?.length) {
      const svcNames = [...new Set(recentBookings.map((b: any) => (b.services as { name: string } | null)?.name).filter(Boolean))]
      if (svcNames.length) lines.push(`Oblíbené služby: ${svcNames.join(', ')}`)
    }
    if (preferredTime) lines.push(`Preferovaný čas rezervací: ${preferredTime} — navrhni termín v tomto čase pokud je volno.`)
    return lines.join('\n')
  })() : null

  // Proactive slot availability — fetch next available slots across 4 days
  const slotsContext = await getUpcomingSlots(db, userId, services ?? [], settings, tz)

  const servicesText = (services ?? [])
    .map(s => `- ${s.name} (${s.duration_min} min, ${s.price ?? '?'} Kč)`)
    .join('\n') || 'Žádné služby momentálně k dispozici.'

  const whSummary = buildWorkingHoursSummary(settings.working_hours, tz)

  const extraContext = [
    settings.company_description ? `O nás: ${settings.company_description}` : null,
    settings.cancellation_policy ? `Storno podmínky: ${settings.cancellation_policy}` : null,
    settings.ai_notes ? `Poznámky: ${settings.ai_notes}` : null,
    `Provozní doba: ${whSummary}`,
    `Nejdříve lze rezervovat: za ${settings.lead_time_minutes ?? 120} minut od teď.`,
    `Rezervace možná max. ${settings.max_booking_horizon_days ?? 60} dní dopředu.`,
    settings.escalation_phone ? `Přepojení na recepci: k dispozici` : null,
    customerMemory,
    slotsContext,
  ].filter(Boolean).join('\n')

  const systemPrompt = `Jsi Nikola, AI recepční pro ${companyName}. Mluvíš česky, přátelsky a stručně.
Tvůj úkol: pomoct volajícímu rezervovat termín nebo zodpovědět dotaz o salonu.
${existingCustomer?.name ? `Zákazník se jmenuje ${existingCustomer.name} — oslovuj ho jménem.` : ''}

Dostupné služby:
${servicesText}

${extraContext}

Pravidla:
- Max 2 věty na odpověď (telefonní hovor).
- Zjisti: jméno zákazníka, požadovanou službu, preferovaný termín (den + čas).
- Aktivně nabídni konkrétní volné termíny ze seznamu výše — neřekej jen "co vám vyhovuje".
- Jakmile zákazník potvrdí čas, použij done=true a vyplň booking.
- Pokud se ptají na cenu/délku, řekni jim.
- Nabídni přepojení (transfer: true) pokud to zákazník chce nebo nemůžeš pomoci.
- Datum vždy uváděj jako ISO (YYYY-MM-DDTHH:MM:SS), dnešní datum: ${new Date().toLocaleDateString('cs-CZ', { timeZone: tz })}.

Odpovídej VŽDY jako JSON:
{
  "speak": "<text pro zákazníka>",
  "done": false,
  "booking": null,
  "transfer": false,
  "update_summary": null
}
Při potvrzení rezervace (done=true):
{
  "speak": "<potvrzení>",
  "done": true,
  "booking": { "service_name": "...", "preferred_date": "YYYY-MM-DDTHH:MM:SS", "customer_name": "..." },
  "transfer": false,
  "update_summary": "<stručné shrnutí>"
}
Při přepojení:
{
  "speak": "Přepojuji vás na recepci, okamžik prosím.",
  "done": true,
  "booking": null,
  "transfer": true,
  "update_summary": "Zákazník požadoval přepojení."
}`

  const messages = state.turns.map(t => ({ role: t.role, content: t.content }))

  let action: AIAction = await callOpenAI(systemPrompt, messages)

  // When booking proposed, verify slot availability
  if (action.done && action.booking && settings.ai_auto_book !== false) {
    const svc = matchService(services ?? [], action.booking.service_name)

    const durationMin = svc?.duration_min ?? 60
    const bufferMin = svc?.buffer_after_min ?? settings.default_buffer_minutes ?? 0
    const proposedDate = new Date(action.booking.preferred_date)

    if (!isNaN(proposedDate.getTime())) {
      const slots = await getAvailableSlots(
        db, userId, durationMin, bufferMin, proposedDate, tz,
        settings.working_hours ?? {},
        settings.lead_time_minutes ?? 120,
        settings.max_booking_horizon_days ?? 60,
        4,
      )

      const proposedMs = proposedDate.getTime()
      const exactMatch = slots.find(s => Math.abs(s.startsAt.getTime() - proposedMs) <= 15 * 60000)

      if (!exactMatch && slots.length > 0) {
        const altList = slots.slice(0, 3).map(s => s.display).join(', ')
        const injectedMsg = `[systém: navrhovaný čas (${proposedDate.toLocaleString('cs-CZ', { timeZone: tz })}) není volný. Nejbližší volné termíny: ${altList}. Nabídni zákazníkovi tyto alternativy.]`
        state.turns.push({ role: 'user', content: injectedMsg })
        action = await callOpenAI(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      } else if (slots.length === 0) {
        const injectedMsg = `[systém: v navrhovaném termínu ani v blízkém okolí není žádný volný čas. Informuj zákazníka a nabídni zavolání zpět nebo přepojení.]`
        state.turns.push({ role: 'user', content: injectedMsg })
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

  if (action.done && action.transfer && settings.escalation_phone) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlTransfer(action.speak, settings.escalation_phone, voiceId)
  }

  if (action.done && action.booking) {
    const svc = matchService(services ?? [], action.booking.service_name)
    const startsAt = new Date(action.booking.preferred_date)
    const endsAt = new Date(startsAt.getTime() + (svc?.duration_min ?? 60) * 60000)

    let bookingId: string | null = null
    if (!isNaN(startsAt.getTime())) {
      const { data: cust } = await db.from('customers')
        .upsert(
          { user_id: userId, phone: from, name: action.booking.customer_name ?? null },
          { onConflict: 'user_id,phone' },
        )
        .select('id')
        .single()

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

    if (settings.ai_confirm_sms !== false && settings.twilio_account_sid && settings.twilio_auth_token) {
      sendSmsConfirmations(settings, from, action.booking, tz)
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

  const gatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`
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

async function callOpenAI(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIAction> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!apiKey) {
    // Fallback to Claude if OpenAI key not configured
    return callClaude(systemPrompt, messages)
  }
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    })
    const body = await resp.json()
    if (!resp.ok) throw new Error(body.error?.message ?? 'OpenAI error')
    const raw = body.choices?.[0]?.message?.content ?? '{}'
    return JSON.parse(raw)
  } catch (err) {
    console.error('OpenAI error:', err)
    return { speak: 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.', done: true }
  }
}

async function callClaude(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIAction> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    })
    const body = await resp.json()
    const raw = body.content?.[0]?.text ?? ''
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  } catch {
    return { speak: 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.', done: true }
  }
}

// ─── Smart context ────────────────────────────────────────────────────────────

/** Analyse past booking start times and return the customer's preferred time of day in Czech */
function getPreferredTimeOfDay(startsAtList: string[], tz: string): string | null {
  if (!startsAtList.length) return null
  const hours = startsAtList.map(s => {
    const d = new Date(s)
    return parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }), 10)
  })
  const avg = hours.reduce((a, b) => a + b, 0) / hours.length
  if (avg < 11) return 'dopoledne'
  if (avg < 14) return 'okolo poledne'
  if (avg < 17) return 'odpoledne'
  return 'pozdě odpoledne nebo večer'
}

/** Fetch next available slots across the next 4 days and format for the AI prompt */
async function getUpcomingSlots(
  db: any,
  userId: string,
  services: any[],
  settings: any,
  tz: string,
): Promise<string> {
  try {
    const durationMin = services[0]?.duration_min ?? 60
    const bufferMin = settings.default_buffer_minutes ?? 0
    const today = new Date()
    const lines: string[] = []

    for (let offset = 0; offset < 5 && lines.length < 4; offset++) {
      const day = new Date(today.getTime() + offset * 86400000)
      const slots = await getAvailableSlots(
        db, userId, durationMin, bufferMin, day, tz,
        settings.working_hours ?? {},
        settings.lead_time_minutes ?? 120,
        settings.max_booking_horizon_days ?? 60,
        6,
      )
      if (!slots.length) continue
      const dayLabel = day.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
      const times = slots.slice(0, 5).map(s =>
        s.startsAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      )
      lines.push(`${dayLabel}: ${times.join(', ')}`)
    }

    return lines.length
      ? `Aktuálně volné termíny (nabídni je zákazníkovi aktivně):\n${lines.join('\n')}`
      : 'Momentálně nejsou volné termíny v nejbližší době.'
  } catch {
    return ''
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchService(services: any[], name: string) {
  const n = name.toLowerCase()
  return services.find(s =>
    s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase()),
  ) ?? null
}

function buildWorkingHoursSummary(
  wh: Record<string, Array<{ start: string; end: string }>> | null,
  _tz: string,
): string {
  if (!wh) return 'dle aktuálního nastavení'
  const days: Record<string, string> = { mon: 'Po', tue: 'Út', wed: 'St', thu: 'Čt', fri: 'Pá', sat: 'So', sun: 'Ne' }
  return Object.entries(days).map(([key, label]) => {
    const slots = wh[key]
    if (!slots?.length) return null
    return `${label} ${slots[0].start}–${slots[0].end}`
  }).filter(Boolean).join(', ') || 'viz web'
}

function sendSmsConfirmations(settings: any, from: string, booking: AIAction['booking']!, tz: string) {
  if (!settings.twilio_account_sid || !settings.twilio_auth_token) return
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/Messages.json`
  const auth = `Basic ${btoa(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`)}`
  const dateLabel = new Date(booking.preferred_date).toLocaleString('cs-CZ', {
    timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  fetch(twilioBase, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      To: from, From: settings.twilio_phone_number,
      Body: `Potvrzení rezervace: ${booking.service_name}, ${dateLabel}. Těšíme se na vás! — ${settings.company_name}`,
    }).toString(),
  }).catch(() => {})

  if (settings.escalation_phone) {
    fetch(twilioBase, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: settings.escalation_phone, From: settings.twilio_phone_number,
        Body: `Nikola zarezervovala: ${booking.service_name}, ${dateLabel}. Zákazník: ${booking.customer_name || from}`,
      }).toString(),
    }).catch(() => {})
  }
}

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

  const hasUserSpeech = state.turns.some(t => t.role === 'user' && t.content && !t.content.startsWith('[systém:'))

  await db.from('calls').update({
    status:             bookingId ? 'booked' : hasUserSpeech ? 'info' : 'missed',
    customer_name:      customerName ?? null,
    summary:            summary ?? null,
    transcript_full:    fullTranscript,
    booking_id:         bookingId ?? null,
    conversation_state: null,
  }).eq('twilio_call_sid', callSid)

  if (summary && phone) {
    const { data: cust } = await db.from('customers').select('id, notes').eq('user_id', userId).eq('phone', phone).maybeSingle()
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
