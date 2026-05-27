/**
 * Twilio Gather Webhook — called after caller speaks.
 * Sends transcript to Claude with full context (services, availability, company info).
 * Handles booking confirmation with real slot verification, transfer, and info-only calls.
 */
import { adminClient } from '../_shared/supabase.ts'
import { getAvailableSlots, isWithinWorkingHours } from '../_shared/scheduling.ts'

const CZECH_VOICE = 'Polly.Maja'
const MAX_TURNS = 8

interface ConvState {
  turns: Array<{ role: 'user' | 'assistant'; content: string }>
  customerName?: string
  customerPhone: string
  userId: string
  companyName: string
  callSid: string
}

interface ClaudeAction {
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
    ].join(', '))
    .eq('twilio_phone_number', to)
    .maybeSingle()

  if (!settings) {
    return twimlSay('Omlouváme se, tato linka není momentálně dostupná.')
  }

  const { user_id: userId, company_name: companyName } = settings
  const tz = settings.timezone ?? 'Europe/Prague'

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
    return twimlSay('Zkuste prosím zavolat znovu nebo nás kontaktujte jinak. Nashledanou.', true)
  }

  // Build working hours summary for context
  const whSummary = buildWorkingHoursSummary(settings.working_hours, tz)

  const servicesText = (services ?? [])
    .map(s => `- ${s.name} (${s.duration_min} min, ${s.price ?? '?'} Kč)`)
    .join('\n') || 'Žádné služby momentálně k dispozici.'

  // Customer memory: look up returning customer
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
    .limit(3) : { data: null }

  const customerMemory = existingCustomer ? (() => {
    const lines = [`Vracející se zákazník: ${existingCustomer.name || from}`]
    if (existingCustomer.vip_status) lines.push('VIP zákazník — věnuj zvláštní pozornost.')
    if (existingCustomer.notes) lines.push(`Poznámky o zákazníkovi: ${existingCustomer.notes}`)
    if (existingCustomer.last_visit_date) lines.push(`Poslední návštěva: ${existingCustomer.last_visit_date}`)
    if (recentBookings?.length) {
      const svcNames = recentBookings.map(b => (b.services as { name: string } | null)?.name).filter(Boolean)
      if (svcNames.length) lines.push(`Oblíbené služby: ${svcNames.join(', ')}`)
    }
    return lines.join('\n')
  })() : null

  const extraContext = [
    settings.company_description ? `O nás: ${settings.company_description}` : null,
    settings.cancellation_policy ? `Storno podmínky: ${settings.cancellation_policy}` : null,
    settings.ai_notes ? `Poznámky: ${settings.ai_notes}` : null,
    `Provozní doba: ${whSummary}`,
    `Nejdříve lze rezervovat: za ${settings.lead_time_minutes ?? 120} minut od teď.`,
    `Rezervace možná max. ${settings.max_booking_horizon_days ?? 60} dní dopředu.`,
    settings.escalation_phone ? `Přepojení na recepci: k dispozici` : null,
    customerMemory,
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
- Jakmile máš vše, navrhni reservaci — systém ověří dostupnost.
- Pokud se ptají na cenu/délku, řekni jim.
- Nabídni přepojení (transfer: true) pokud to zákazník chce nebo nemůžeš pomoci.
- Datum vždy uváděj jako ISO (YYYY-MM-DDTHH:MM:SS), berte v úvahu dnešní datum: ${new Date().toLocaleDateString('cs-CZ', { timeZone: tz })}.

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

  let action: ClaudeAction = await callClaude(systemPrompt, messages)

  // When booking proposed, verify slot availability
  if (action.done && action.booking && settings.ai_auto_book !== false) {
    const svc = (services ?? []).find(s =>
      s.name.toLowerCase().includes(action.booking!.service_name.toLowerCase()) ||
      action.booking!.service_name.toLowerCase().includes(s.name.toLowerCase()),
    ) ?? null

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
        // Slot not available — offer alternatives via second Claude call
        const altList = slots.slice(0, 3).map(s => s.display).join(', ')
        const injectedMsg = `[systém: navrhovaný čas (${proposedDate.toLocaleString('cs-CZ', { timeZone: tz })}) není volný. Nejbližší volné termíny: ${altList}. Nabídni zákazníkovi tyto alternativy.]`
        state.turns.push({ role: 'user', content: injectedMsg })
        action = await callClaude(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      } else if (slots.length === 0) {
        const injectedMsg = `[systém: v navrhovaném termínu ani v blízkém okolí není žádný volný čas. Informuj zákazníka a nabídni zavolání zpět nebo přepojení.]`
        state.turns.push({ role: 'user', content: injectedMsg })
        action = await callClaude(systemPrompt, state.turns.map(t => ({ role: t.role, content: t.content })))
      }
    }
  }

  state.turns.push({ role: 'assistant', content: action.speak })

  // Update customer_name in calls table progressively
  const extractedName = action.booking?.customer_name ?? state.customerName
  if (extractedName && extractedName !== state.customerName) {
    state.customerName = extractedName
    await db.from('calls').update({ customer_name: extractedName }).eq('twilio_call_sid', callSid)
  }

  // Handle transfer
  if (action.done && action.transfer && settings.escalation_phone) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlTransfer(action.speak, settings.escalation_phone)
  }

  // Confirm and create booking
  if (action.done && action.booking) {
    const svc = (services ?? []).find(s =>
      s.name.toLowerCase().includes(action.booking!.service_name.toLowerCase()) ||
      action.booking!.service_name.toLowerCase().includes(s.name.toLowerCase()),
    ) ?? null

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

    // SMS confirmations (fire-and-forget)
    if (settings.ai_confirm_sms !== false && settings.twilio_account_sid && settings.twilio_auth_token) {
      const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/Messages.json`
      const auth = `Basic ${btoa(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`)}`
      const dateLabel = new Date(action.booking.preferred_date).toLocaleString('cs-CZ', {
        timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      })

      fetch(twilioBase, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          To: from, From: settings.twilio_phone_number,
          Body: `Potvrzení rezervace: ${action.booking.service_name}, ${dateLabel}. Těšíme se na vás! — ${companyName}`,
        }).toString(),
      }).catch(() => {})

      if (settings.escalation_phone) {
        fetch(twilioBase, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            To: settings.escalation_phone, From: settings.twilio_phone_number,
            Body: `Nikola zarezervovala: ${action.booking.service_name}, ${dateLabel}. Zákazník: ${action.booking.customer_name || from}`,
          }).toString(),
        }).catch(() => {})
      }
    }

    await finalizeCall(db, callSid, userId, from, state, action.update_summary, action.booking.customer_name, bookingId)
    return twimlSay(action.speak, true)
  }

  if (action.done) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary, extractedName)
    return twimlSay(action.speak, true)
  }

  // Save updated state and ask for next input
  await db.from('calls')
    .update({ conversation_state: state, customer_name: extractedName ?? null })
    .eq('twilio_call_sid', callSid)

  const gatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST"
          timeout="5" speechTimeout="auto" language="cs-CZ"
          actionOnEmptyResult="true">
    <Say voice="${CZECH_VOICE}" language="cs-CZ">${escapeXml(action.speak)}</Say>
  </Gather>
  <Say voice="${CZECH_VOICE}" language="cs-CZ">Promiňte, neslyšela jsem vás.</Say>
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
})

async function callClaude(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<ClaudeAction> {
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

  // Auto-update customer notes with AI summary (append, don't overwrite)
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

function twimlSay(text: string, hangup = false) {
  const close = hangup ? '<Hangup/>' : ''
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${CZECH_VOICE}" language="cs-CZ">${escapeXml(text)}</Say>${close}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function twimlTransfer(speak: string, dialNumber: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${CZECH_VOICE}" language="cs-CZ">${escapeXml(speak)}</Say><Dial>${escapeXml(dialNumber)}</Dial></Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
