/**
 * Twilio Voice Webhook — entry point for all incoming calls.
 * Configure in Twilio Console: A call comes in → Webhook → POST this URL.
 * Returns TwiML that greets caller and gathers speech input.
 */
import { adminClient } from '../_shared/supabase.ts'

const CZECH_VOICE = 'Polly.Maja'

Deno.serve(async (req) => {
  const form = await req.formData()
  const from  = (form.get('From')  as string) ?? ''
  const to    = (form.get('To')    as string) ?? ''
  const callSid = (form.get('CallSid') as string) ?? ''

  const db = adminClient()

  // Look up company by the Twilio number they're calling
  const { data: settings } = await db
    .from('company_settings')
    .select('user_id, company_name, ai_greeting')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  const userId    = settings?.user_id ?? null
  const company   = settings?.company_name ?? 'salonu'
  const greeting  = settings?.ai_greeting
    ?? `Dobrý den, vítejte v ${company}. Čím vám mohu pomoci?`

  // Log the incoming call
  if (userId) {
    await db.from('calls').insert({
      user_id:        userId,
      customer_phone: from,
      twilio_call_sid: callSid,
      status:         'live',
    })
  }

  const gatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST"
          timeout="5" speechTimeout="auto" language="cs-CZ"
          actionOnEmptyResult="true">
    <Say voice="${CZECH_VOICE}" language="cs-CZ">${escapeXml(greeting)}</Say>
  </Gather>
  <Say voice="${CZECH_VOICE}" language="cs-CZ">Promiňte, neslyšela jsem vás. Zkuste zavolat znovu, ráda vám pomohu.</Say>
</Response>`

  return new Response(twiml, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
})

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
