/**
 * Twilio Voice Webhook — entry point for all incoming calls.
 * Configure in Twilio Console: A call comes in → Webhook → POST this URL.
 * Returns TwiML that greets caller (or plays out-of-hours message) and gathers speech.
 *
 * Uses ElevenLabs TTS if elevenlabs_voice_id is configured, otherwise falls back to Polly.Maja.
 * NOTE: This function must have JWT verification disabled in Supabase Dashboard.
 */
import { adminClient } from '../_shared/supabase.ts'
import { isWithinWorkingHours, nextOpeningTime } from '../_shared/scheduling.ts'

const FALLBACK_VOICE = 'Polly.Maja'

Deno.serve(async (req) => {
  const form = await req.formData()
  const from    = (form.get('From')    as string) ?? ''
  const to      = (form.get('To')      as string) ?? ''
  const callSid = (form.get('CallSid') as string) ?? ''

  const db = adminClient()

  const { data: settings } = await db
    .from('company_settings')
    .select('user_id, company_name, ai_greeting, working_hours, timezone, ai_paused, escalation_phone, elevenlabs_voice_id')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  const userId   = settings?.user_id ?? null
  const company  = settings?.company_name ?? 'salonu'
  const tz       = settings?.timezone ?? 'Europe/Prague'
  const wh       = settings?.working_hours ?? null
  const voiceId  = settings?.elevenlabs_voice_id ?? null

  if (settings?.ai_paused) {
    if (settings.escalation_phone) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response>${speak('Přepojuji vás na recepci, okamžik prosím.', voiceId)}<Dial>${escapeXml(settings.escalation_phone)}</Dial></Response>`,
        { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
      )
    }
    return twimlSpeak('Omlouváme se, recepce je momentálně nedostupná. Zavolejte prosím později.', voiceId, true)
  }

  if (wh) {
    const open = isWithinWorkingHours(wh, tz)
    if (!open) {
      const nextOpen = nextOpeningTime(wh, tz)
      const msg = `Dobrý den, ${company}. Momentálně jsme mimo provozní dobu. Jsme tu pro vás ${nextOpen}. Zavolejte nám prosím tehdy, rádi vám pomůžeme.`
      return twimlSpeak(msg, voiceId, true)
    }
  }

  const greeting = settings?.ai_greeting
    ?? `Dobrý den, vítejte v ${company}. Čím vám mohu pomoci?`

  if (userId) {
    await db.from('calls').insert({
      user_id:         userId,
      customer_phone:  from,
      twilio_call_sid: callSid,
      status:          'live',
    })
  }

  const gatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-gather`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST"
          timeout="5" speechTimeout="auto" language="cs-CZ"
          actionOnEmptyResult="true">
    ${speak(greeting, voiceId)}
  </Gather>
  ${speak('Promiňte, neslyšela jsem vás. Zkuste zavolat znovu, ráda vám pomohu.', voiceId)}
</Response>`

  return new Response(twiml, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
})

/** Returns a TwiML <Play> for ElevenLabs or <Say> for Polly fallback */
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

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
