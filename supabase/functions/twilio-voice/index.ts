/**
 * Twilio Voice Webhook — entry point for all incoming calls.
 * Configure in Twilio Console: A call comes in → Webhook → POST this URL.
 *
 * Returns TwiML <Connect><Stream> to open a bidirectional WebSocket with
 * twilio-realtime, which proxies audio to OpenAI Realtime API (gpt-4o).
 *
 * Out-of-hours and AI-paused cases still use TTS (ElevenLabs or Polly.Maja).
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

  const db = adminClient()

  const { data: settings } = await db
    .from('company_settings')
    .select('user_id, company_name, ai_greeting, working_hours, timezone, ai_paused, escalation_phone, elevenlabs_voice_id')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  const voiceId = settings?.elevenlabs_voice_id ?? null
  const company = settings?.company_name ?? 'salonu'
  const tz      = settings?.timezone ?? 'Europe/Prague'
  const wh      = settings?.working_hours ?? null

  // AI manually paused — forward to escalation or hang up
  if (settings?.ai_paused) {
    if (settings.escalation_phone) {
      return xml(`<Say ${sayAttrs(voiceId)}>Přepojuji vás na recepci, okamžik prosím.</Say><Dial>${esc(settings.escalation_phone)}</Dial>`)
    }
    return xml(`<Say ${sayAttrs(voiceId)}>Omlouváme se, recepce je momentálně nedostupná. Zavolejte prosím později.</Say><Hangup/>`)
  }

  // Out of working hours
  if (wh) {
    const open = isWithinWorkingHours(wh, tz)
    if (!open) {
      const nextOpen = nextOpeningTime(wh, tz)
      const msg = `Dobrý den, ${company}. Momentálně jsme mimo provozní dobu. Jsme tu pro vás ${nextOpen}. Zavolejte nám prosím tehdy, rádi vám pomůžeme.`
      return xml(`<Say ${sayAttrs(voiceId)}>${esc(msg)}</Say><Hangup/>`)
    }
  }

  // Pre-create call record so twilio-realtime can find it quickly
  if (settings?.user_id) {
    await db.from('calls').insert({
      user_id:         settings.user_id,
      customer_phone:  from,
      twilio_call_sid: callSid,
      status:          'live',
    }).select('id').maybeSingle()   // ignore conflict if already exists
  }

  // WebSocket URL for twilio-realtime (https → wss)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const wsUrl = supabaseUrl.replace('https://', 'wss://') + '/functions/v1/twilio-realtime'

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${esc(wsUrl)}">
      <Parameter name="from" value="${esc(from)}"/>
      <Parameter name="to" value="${esc(to)}"/>
    </Stream>
  </Connect>
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sayAttrs(voiceId: string | null): string {
  if (voiceId) {
    // When using ElevenLabs, Twilio cannot directly fetch from Supabase without JWT.
    // For fallback messages (out of hours, paused), we use Polly.Maja.
    // Full ElevenLabs quality is handled inside twilio-realtime via OpenAI voice.
  }
  return `voice="${FALLBACK_VOICE}" language="cs-CZ"`
}

function xml(body: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  )
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
