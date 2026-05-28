/**
 * Twilio Voice Webhook — entry point for all incoming calls.
 * Configure in Twilio Console: A call comes in → Webhook → POST this URL.
 *
 * Returns TwiML <Gather> pointing to twilio-gather (gpt-4o HTTP flow).
 *
 * NOTE: Disable JWT verification for this function in Supabase Dashboard.
 */
import { adminClient } from '../_shared/supabase.ts'
import { isWithinWorkingHours, nextOpeningTime } from '../_shared/scheduling.ts'

const FALLBACK_VOICE = 'Polly.Maja'

Deno.serve(async (req) => {
  const form    = await req.formData()
  const from    = (form.get('From')    as string) ?? ''
  const to      = (form.get('To')      as string) ?? ''
  const callSid = (form.get('CallSid') as string) ?? ''

  console.log('[twilio-voice] invoked', { from, to, callSid })

  const db = adminClient()

  // Try multiple phone number formats (Twilio may send with/without spaces, country code, etc)
  const phoneVariants = [to, to.replace(/\s/g, ''), to.replace(/^\+/, ''), `+${to.replace(/^\+/, '')}`]
  let settings: any = null
  for (const variant of phoneVariants) {
    const { data } = await db
      .from('company_settings')
      .select('user_id, company_name, ai_greeting, working_hours, timezone, ai_paused, escalation_phone, elevenlabs_voice_id, twilio_phone_number')
      .eq('twilio_phone_number', variant)
      .maybeSingle()
    if (data) { settings = data; break }
  }

  console.log('[twilio-voice] settings lookup', {
    found: !!settings,
    triedVariants: phoneVariants,
    matchedNumber: settings?.twilio_phone_number,
  })

  // If no settings found, the phone number isn't configured in the app
  if (!settings) {
    console.error('[twilio-voice] NO COMPANY FOUND for phone number', to)
    return xml(`<Say voice="${FALLBACK_VOICE}" language="cs-CZ">Tato linka není správně nakonfigurována. Kontaktujte prosím správce.</Say><Hangup/>`)
  }

  const voiceId = settings.elevenlabs_voice_id ?? null
  const company = settings.company_name ?? 'salonu'
  const tz      = settings.timezone ?? 'Europe/Prague'
  const wh      = settings.working_hours ?? null

  // AI manually paused
  if (settings.ai_paused) {
    console.log('[twilio-voice] AI paused → escalation or hangup')
    if (settings.escalation_phone) {
      return xml(`<Say voice="${FALLBACK_VOICE}" language="cs-CZ">Přepojuji vás na recepci, okamžik prosím.</Say><Dial>${esc(settings.escalation_phone)}</Dial>`)
    }
    return xml(`<Say voice="${FALLBACK_VOICE}" language="cs-CZ">Omlouváme se, recepce je momentálně nedostupná. Zavolejte prosím později.</Say><Hangup/>`)
  }

  // Out of working hours
  if (wh && Object.keys(wh).length > 0) {
    const open = isWithinWorkingHours(wh, tz)
    console.log('[twilio-voice] working hours check', { open, tz })
    if (!open) {
      const nextOpen = nextOpeningTime(wh, tz)
      const msg = `Dobrý den, ${company}. Momentálně jsme mimo provozní dobu. Jsme tu pro vás ${nextOpen}. Zavolejte nám prosím tehdy, rádi vám pomůžeme.`
      return xml(`<Say voice="${FALLBACK_VOICE}" language="cs-CZ">${esc(msg)}</Say><Hangup/>`)
    }
  }

  // Pre-create call record
  await db.from('calls').insert({
    user_id:         settings.user_id,
    customer_phone:  from,
    twilio_call_sid: callSid,
    status:          'live',
  }).select('id').maybeSingle()

  // Route to gather (gpt-4o HTTP polling — works on all OpenAI accounts)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const gatherUrl = supabaseUrl + '/functions/v1/twilio-gather'
  const greeting = settings.ai_greeting ?? `Dobrý den, vítejte v ${company}. Čím vám mohu pomoci?`

  console.log('[twilio-voice] routing to gather', { gatherUrl, greeting })

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${esc(gatherUrl)}" method="POST"
          timeout="5" speechTimeout="auto" language="cs-CZ"
          actionOnEmptyResult="true">
    <Say voice="${FALLBACK_VOICE}" language="cs-CZ">${esc(greeting)}</Say>
  </Gather>
  <Say voice="${FALLBACK_VOICE}" language="cs-CZ">Promiňte, neslyšela jsem vás. Zavolejte nám prosím znovu.</Say>
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xml(body: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
