/**
 * Release a Twilio phone number when user cancels subscription.
 * - Lists IncomingPhoneNumbers on the subaccount, deletes any matching saved number
 * - Clears the columns in company_settings
 *
 * Called by stripe-webhook on subscription deleted/paused.
 */
import { adminClient } from '../_shared/supabase.ts'

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let payload: { user_id?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const userId = payload.user_id
  if (!userId) return json({ error: 'user_id_required' }, 400)

  const db = adminClient()

  const { data: cs } = await db
    .from('company_settings')
    .select('twilio_phone_number, twilio_account_sid, twilio_auth_token')
    .eq('user_id', userId)
    .maybeSingle()

  if (!cs?.twilio_phone_number || !cs.twilio_account_sid || !cs.twilio_auth_token) {
    return json({ released: false, reason: 'no_number' })
  }

  const subAuth = 'Basic ' + btoa(`${cs.twilio_account_sid}:${cs.twilio_auth_token}`)

  // Find the IncomingPhoneNumber SID for this number
  const listResp = await fetch(
    `${TWILIO_API}/Accounts/${cs.twilio_account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(cs.twilio_phone_number)}`,
    { headers: { Authorization: subAuth } },
  )
  const list = await listResp.json()
  const numberSid = list.incoming_phone_numbers?.[0]?.sid

  if (numberSid) {
    const delResp = await fetch(
      `${TWILIO_API}/Accounts/${cs.twilio_account_sid}/IncomingPhoneNumbers/${numberSid}.json`,
      { method: 'DELETE', headers: { Authorization: subAuth } },
    )
    if (!delResp.ok && delResp.status !== 404) {
      console.error('[release] Twilio DELETE failed', delResp.status, await delResp.text())
    }
  }

  await db.from('company_settings').update({
    twilio_phone_number: null,
    twilio_account_sid: null,
    twilio_auth_token: null,
    phone_provisioned_at: null,
  }).eq('user_id', userId)

  console.log('[release] released', { userId, number: cs.twilio_phone_number })
  return json({ released: true })
})
