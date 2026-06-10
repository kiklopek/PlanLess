/**
 * Provision a Twilio phone number for a subscribed user.
 *
 * Flow:
 *  1. Verify user has active subscription
 *  2. Skip if already has a number
 *  3. Create Twilio subaccount under master account
 *  4. Search for available CZ mobile number (fallback to other countries if none)
 *  5. Purchase number with webhook pointing at twilio-voice
 *  6. Save SID/token/number into company_settings
 *
 * Called by stripe-webhook on checkout.session.completed,
 * or manually from dashboard if user is subscribed but missing a number.
 *
 * IMPORTANT: This function requires service-role authentication.
 */
import { adminClient } from '../_shared/supabase.ts'

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function findAvailableNumber(subSid: string, subToken: string, country: string): Promise<string | null> {
  const auth = 'Basic ' + btoa(`${subSid}:${subToken}`)
  // Try Mobile first, then Local — CZ doesn't always have mobile inventory
  for (const kind of ['Mobile', 'Local']) {
    const resp = await fetch(
      `${TWILIO_API}/Accounts/${subSid}/AvailablePhoneNumbers/${country}/${kind}.json?VoiceEnabled=true&SmsEnabled=true&Limit=1`,
      { headers: { Authorization: auth } },
    )
    if (!resp.ok) continue
    const body = await resp.json()
    const num = body.available_phone_numbers?.[0]?.phone_number
    if (num) return num
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let payload: { user_id?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const userId = payload.user_id
  if (!userId) return json({ error: 'user_id_required' }, 400)

  const db = adminClient()

  // 1. Verify subscription
  const { data: profile } = await db
    .from('profiles')
    .select('is_subscribed')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.is_subscribed) return json({ error: 'subscription_required' }, 402)

  // 2. Skip if already provisioned
  const { data: cs } = await db
    .from('company_settings')
    .select('twilio_phone_number')
    .eq('user_id', userId)
    .maybeSingle()
  if (cs?.twilio_phone_number) {
    return json({ phone: cs.twilio_phone_number, already_provisioned: true })
  }

  const masterSid = Deno.env.get('TWILIO_MASTER_SID')
  const masterToken = Deno.env.get('TWILIO_MASTER_TOKEN')
  if (!masterSid || !masterToken) return json({ error: 'twilio_not_configured' }, 500)

  const masterAuth = 'Basic ' + btoa(`${masterSid}:${masterToken}`)

  // 3. Create subaccount
  const subResp = await fetch(`${TWILIO_API}/Accounts.json`, {
    method: 'POST',
    headers: { Authorization: masterAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ FriendlyName: `PlanLess ${userId}` }),
  })
  const sub = await subResp.json()
  if (!subResp.ok || !sub.sid) {
    console.error('[provision] subaccount create failed', sub)
    return json({ error: 'subaccount_failed', detail: sub }, 500)
  }
  const subSid: string = sub.sid
  const subToken: string = sub.auth_token

  // 4. Find available number — try CZ first, then SK, then US as last resort
  let phoneNumber: string | null = null
  let foundCountry = ''
  for (const country of ['CZ', 'SK', 'US']) {
    phoneNumber = await findAvailableNumber(subSid, subToken, country)
    if (phoneNumber) { foundCountry = country; break }
  }
  if (!phoneNumber) {
    console.error('[provision] no numbers available in any country')
    return json({ error: 'no_numbers_available' }, 503)
  }

  // 5. Purchase number + configure webhook
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-voice`
  const subAuth = 'Basic ' + btoa(`${subSid}:${subToken}`)
  const buyResp = await fetch(`${TWILIO_API}/Accounts/${subSid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { Authorization: subAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      PhoneNumber: phoneNumber,
      VoiceUrl: webhookUrl,
      VoiceMethod: 'POST',
    }),
  })
  const bought = await buyResp.json()
  if (!buyResp.ok || !bought.sid) {
    console.error('[provision] purchase failed', bought)
    return json({ error: 'purchase_failed', detail: bought }, 500)
  }

  // 6. Save into company_settings (upsert in case row doesn't exist yet)
  await db.from('company_settings').upsert(
    {
      user_id: userId,
      twilio_phone_number: phoneNumber,
      twilio_account_sid: subSid,
      twilio_auth_token: subToken,
      phone_provisioned_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  console.log('[provision] success', { userId, phoneNumber, country: foundCountry })
  return json({ phone: phoneNumber, country: foundCountry })
})
