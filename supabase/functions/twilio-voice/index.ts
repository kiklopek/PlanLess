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
      .select('user_id, company_name, ai_greeting, working_hours, timezone, ai_paused, escalation_phone, elevenlabs_voice_id, twilio_phone_number, ai_language')
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

  // Gate on subscription — inactive accounts cannot receive AI calls
  const { data: profile } = await db
    .from('profiles')
    .select('is_subscribed')
    .eq('id', settings.user_id)
    .maybeSingle()
  if (!profile?.is_subscribed) {
    console.warn('[twilio-voice] subscription inactive', { userId: settings.user_id })
    const inactiveLang = settings.ai_language === 'en-US' ? 'en-US' : 'cs-CZ'
    const inactiveVoice = inactiveLang === 'en-US' ? 'Polly.Joanna' : FALLBACK_VOICE
    const inactiveMsg = inactiveLang === 'en-US'
      ? 'This line is currently inactive. Please contact the business owner.'
      : 'Tato linka je momentálně neaktivní. Kontaktujte prosím majitele.'
    return xml(`<Say voice="${inactiveVoice}" language="${inactiveLang}">${esc(inactiveMsg)}</Say><Hangup/>`)
  }

  const voiceId = settings.elevenlabs_voice_id ?? null
  const company = settings.company_name ?? 'salonu'
  const tz      = settings.timezone ?? 'Europe/Prague'
  const wh      = settings.working_hours ?? null
  const lang    = settings.ai_language ?? 'cs-CZ'
  const isEN    = lang === 'en-US'
  const sayLang = isEN ? 'en-US' : 'cs-CZ'
  const sayVoice = isEN ? 'Polly.Joanna' : FALLBACK_VOICE

  const msgs = isEN ? {
    transferring: 'Transferring you to reception, one moment please.',
    receptionUnavailable: "Sorry, reception is currently unavailable. Please call back later.",
    outsideHoursPrefix: (c: string, t: string) => `Hello, this is ${c}. We are currently outside business hours. We are here for you ${t}. Please call us back then, we'll be happy to help.`,
    fallbackGreeting: (c: string) => `Hello, welcome to ${c}. How can I help you?`,
    notHeard: "Sorry, I didn't hear you. Please call back again.",
  } : {
    transferring: 'Přepojuji vás na recepci, okamžik prosím.',
    receptionUnavailable: 'Omlouváme se, recepce je momentálně nedostupná. Zavolejte prosím později.',
    outsideHoursPrefix: (c: string, t: string) => `Dobrý den, ${c}. Momentálně jsme mimo provozní dobu. Jsme tu pro vás ${t}. Zavolejte nám prosím tehdy, rádi vám pomůžeme.`,
    fallbackGreeting: (c: string) => `Dobrý den, vítejte v ${c}. Čím vám mohu pomoci?`,
    notHeard: 'Promiňte, neslyšela jsem vás. Zavolejte nám prosím znovu.',
  }

  // AI manually paused
  if (settings.ai_paused) {
    console.log('[twilio-voice] AI paused → escalation or hangup')
    if (settings.escalation_phone) {
      return xml(`<Say voice="${sayVoice}" language="${sayLang}">${esc(msgs.transferring)}</Say><Dial>${esc(settings.escalation_phone)}</Dial>`)
    }
    return xml(`<Say voice="${sayVoice}" language="${sayLang}">${esc(msgs.receptionUnavailable)}</Say><Hangup/>`)
  }

  // Out of working hours
  if (wh && Object.keys(wh).length > 0) {
    const open = isWithinWorkingHours(wh, tz)
    console.log('[twilio-voice] working hours check', { open, tz })
    if (!open) {
      const nextOpen = nextOpeningTime(wh, tz)
      const msg = msgs.outsideHoursPrefix(company, nextOpen)
      return xml(`<Say voice="${sayVoice}" language="${sayLang}">${esc(msg)}</Say><Hangup/>`)
    }
  }

  // Pre-create call record
  await db.from('calls').insert({
    user_id:         settings.user_id,
    customer_phone:  from,
    twilio_call_sid: callSid,
    status:          'live',
  }).select('id').maybeSingle()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const gatherUrl = supabaseUrl + '/functions/v1/twilio-gather'
  const greeting = settings.ai_greeting ?? msgs.fallbackGreeting(company)

  console.log('[twilio-voice] routing to gather', { gatherUrl, greeting, voiceId: !!voiceId, lang })

  const greetingTwiml = voiceId
    ? `<Play>${esc(`${supabaseUrl}/functions/v1/tts?t=${encodeURIComponent(greeting)}&v=${encodeURIComponent(voiceId)}`)}</Play>`
    : `<Say voice="${sayVoice}" language="${sayLang}">${esc(greeting)}</Say>`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${esc(gatherUrl)}" method="POST"
          timeout="5" speechTimeout="auto" language="${sayLang}"
          actionOnEmptyResult="true">
    ${greetingTwiml}
  </Gather>
  <Say voice="${sayVoice}" language="${sayLang}">${esc(msgs.notHeard)}</Say>
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
