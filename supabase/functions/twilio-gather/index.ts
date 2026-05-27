/**
 * Twilio Gather Webhook — called after caller speaks.
 * Sends transcript to Claude, gets a response, and either:
 *   - Asks a follow-up question (loops back to gather)
 *   - Creates a booking
 *   - Reads info and hangs up
 */
import { adminClient } from '../_shared/supabase.ts'

const CZECH_VOICE = 'Polly.Maja'
const MAX_TURNS = 6

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
  const speech   = (form.get('SpeechResult')  as string) ?? ''
  const from     = (form.get('From')           as string) ?? ''
  const to       = (form.get('To')             as string) ?? ''
  const callSid  = (form.get('CallSid')        as string) ?? ''

  const db = adminClient()

  // Look up company
  const { data: settings } = await db
    .from('company_settings')
    .select('user_id, company_name, ai_notes, working_hours')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  if (!settings) {
    return twimlSay('Omlouváme se, tato linka není momentálně dostupná.')
  }

  const { user_id: userId, company_name: companyName } = settings

  // Load available services for context
  const { data: services } = await db
    .from('services')
    .select('name, duration_min, price')
    .eq('user_id', userId)
    .limit(20)

  // Load existing call record + conversation state
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

  // Guard against infinite loops
  if (state.turns.filter(t => t.role === 'user').length > MAX_TURNS) {
    await finalizeCall(db, callSid, userId, from, state, 'Zkuste prosím zavolat znovu nebo nás kontaktujte jinak. Nashledanou.')
    return twimlSay('Zkuste prosím zavolat znovu nebo nás kontaktujte jinak. Nashledanou.')
  }

  // Build Claude prompt
  const servicesText = (services ?? [])
    .map(s => `- ${s.name} (${s.duration_min} min, ${s.price} Kč)`)
    .join('\n') || 'Žádné služby momentálně k dispozici.'

  const systemPrompt = `Jsi Nikola, AI recepční pro ${companyName}. Mluvíš česky.
Tvůj úkol: pomoct volajícímu rezervovat termín nebo zodpovědět dotaz.

Dostupné služby:
${servicesText}

Pravidla:
- Buď přátelská a stručná (max 2 věty na odpověď — jde o telefonní hovor).
- Zjisti jméno zákazníka, požadovanou službu a preferovaný termín.
- Jakmile máš všechno, potvrď rezervaci a ukonči hovor.
- Pokud se ptají na cenu/dobu, řekni jim.
- Pokud nevíš, nabídni přepojení.

Vždy odpovídej jako JSON (ne jako prostý text):
{
  "speak": "<text který přečteš volajícímu>",
  "done": false,
  "booking": null,
  "update_summary": null
}
Nebo při potvrzené rezervaci:
{
  "speak": "<potvrzení rezervace>",
  "done": true,
  "booking": { "service_name": "...", "preferred_date": "YYYY-MM-DDTHH:MM:SS", "customer_name": "..." },
  "update_summary": "<krátké shrnutí hovoru>"
}`

  const messages = state.turns.map(t => ({ role: t.role, content: t.content }))

  let action: ClaudeAction
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
        max_tokens: 256,
        system: systemPrompt,
        messages,
      }),
    })
    const body = await resp.json()
    const raw = body.content?.[0]?.text ?? ''
    action = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  } catch {
    action = {
      speak: 'Omlouváme se, momentálně mám technické potíže. Zavolejte prosím znovu.',
      done: true,
    }
  }

  state.turns.push({ role: 'assistant', content: action.speak })

  // Save booking if confirmed
  if (action.done && action.booking) {
    const { data: svc } = await db
      .from('services')
      .select('id, duration_min')
      .eq('user_id', userId)
      .ilike('name', `%${action.booking.service_name}%`)
      .maybeSingle()

    const startsAt = new Date(action.booking.preferred_date)
    const endsAt = new Date(startsAt.getTime() + (svc?.duration_min ?? 60) * 60000)

    if (!isNaN(startsAt.getTime())) {
      // Upsert customer by phone so we have a customer_id FK
      const { data: cust } = await db.from('customers')
        .upsert(
          { user_id: userId, phone: from, name: action.booking.customer_name ?? null },
          { onConflict: 'user_id,phone' },
        )
        .select('id')
        .single()

      await db.from('bookings').insert({
        user_id: userId,
        service_id: svc?.id ?? null,
        customer_id: cust?.id ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        note: `Rezervace přes AI recepční`,
      })
    }

    // SMS confirmation to customer + owner notification (fire-and-forget)
    const { data: ownerCfg } = await db.from('company_settings')
      .select('escalation_phone, twilio_phone_number, twilio_account_sid, twilio_auth_token')
      .eq('user_id', userId).maybeSingle()

    if (ownerCfg?.twilio_account_sid && ownerCfg?.twilio_auth_token && ownerCfg?.twilio_phone_number) {
      const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${ownerCfg.twilio_account_sid}/Messages.json`
      const auth = `Basic ${btoa(`${ownerCfg.twilio_account_sid}:${ownerCfg.twilio_auth_token}`)}`

      // Confirmation SMS to customer
      const dateLabel = new Date(action.booking.preferred_date).toLocaleString('cs-CZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      fetch(twilioBase, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: from, From: ownerCfg.twilio_phone_number, Body: `Potvrzení rezervace: ${action.booking.service_name}, ${dateLabel}. Těšíme se na vás!` }).toString(),
      }).catch(() => {})

      // Notification SMS to owner
      if (ownerCfg.escalation_phone) {
        fetch(twilioBase, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: ownerCfg.escalation_phone, From: ownerCfg.twilio_phone_number, Body: `Nikola zarezervovala: ${action.booking.service_name}, ${dateLabel}. Zákazník: ${action.booking.customer_name || from}` }).toString(),
        }).catch(() => {})
      }
    }

    await finalizeCall(db, callSid, userId, from, state, action.update_summary, action.booking.customer_name)
    return twimlSay(action.speak, true)
  }

  if (action.done) {
    await finalizeCall(db, callSid, userId, from, state, action.update_summary)
    return twimlSay(action.speak, true)
  }

  // Save updated conversation state
  await db.from('calls')
    .update({ conversation_state: state })
    .eq('twilio_call_sid', callSid)

  // Gather next input
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

async function finalizeCall(
  db: ReturnType<typeof adminClient>,
  callSid: string,
  userId: string,
  phone: string,
  state: ConvState,
  summary?: string | null,
  customerName?: string,
) {
  const fullTranscript = state.turns
    .map(t => `${t.role === 'user' ? 'Zákazník' : 'Nikola'}: ${t.content}`)
    .join('\n')

  await db.from('calls').update({
    status:        state.turns.some(t => t.role === 'user' && t.content) ? 'booked' : 'missed',
    customer_name: customerName ?? null,
    summary:       summary ?? null,
    transcript_full: fullTranscript,
    conversation_state: null,
  }).eq('twilio_call_sid', callSid)
}

function twimlSay(text: string, hangup = false) {
  const close = hangup ? '<Hangup/>' : ''
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${CZECH_VOICE}" language="cs-CZ">${escapeXml(text)}</Say>${close}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
