/**
 * Followup SMS queue worker.
 * Called on a schedule (e.g., every 5 minutes via Supabase Cron or pg_cron).
 * Picks up queued followups and sends them via Twilio.
 * Handles retry with backoff (30m, 2h, 8h).
 */
import { adminClient } from '../_shared/supabase.ts'

const RETRY_DELAYS_MIN = [30, 120, 480] // 30 min, 2h, 8h
const MAX_ATTEMPTS = 3
const LOCK_TTL_MIN = 5

Deno.serve(async (_req) => {
  const db = adminClient()
  const now = new Date()

  // Pick up to 50 queued followups ready to send (not locked by another worker)
  const { data: followups } = await db
    .from('followups')
    .select('id, user_id, message, metadata, attempt_count, channel')
    .eq('status', 'queued')
    .lte('scheduled_at', now.toISOString())
    .or(`locked_at.is.null,locked_at.lt.${new Date(now.getTime() - LOCK_TTL_MIN * 60000).toISOString()}`)
    .limit(50)

  if (!followups?.length) {
    return Response.json({ processed: 0 })
  }

  // Lock all fetched rows atomically
  const ids = followups.map(f => f.id)
  await db.from('followups')
    .update({ status: 'sending', locked_at: now.toISOString() })
    .in('id', ids)

  let sent = 0
  let failed = 0

  for (const f of followups) {
    if (f.channel !== 'sms') {
      // Future: email, push, etc.
      await db.from('followups').update({ status: 'cancelled' }).eq('id', f.id)
      continue
    }

    const to: string | null = f.metadata?.to ?? null
    if (!to) {
      await db.from('followups').update({ status: 'failed', last_error: 'No recipient phone' }).eq('id', f.id)
      failed++
      continue
    }

    // Load Twilio credentials for this user
    const { data: cs } = await db
      .from('company_settings')
      .select('twilio_phone_number, twilio_account_sid, twilio_auth_token')
      .eq('user_id', f.user_id)
      .maybeSingle()

    const accountSid = cs?.twilio_account_sid ?? Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken  = cs?.twilio_auth_token  ?? Deno.env.get('TWILIO_AUTH_TOKEN')
    const fromPhone  = cs?.twilio_phone_number ?? Deno.env.get('TWILIO_PHONE_NUMBER')

    if (!accountSid || !authToken || !fromPhone) {
      await db.from('followups').update({
        status: 'failed',
        last_error: 'Twilio credentials not configured',
        attempt_count: (f.attempt_count ?? 0) + 1,
      }).eq('id', f.id)
      failed++
      continue
    }

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        },
        body: new URLSearchParams({ To: to, From: fromPhone, Body: f.message }).toString(),
      },
    )

    const result = await resp.json()

    if (resp.ok) {
      await db.from('followups').update({
        status: 'sent',
        sent_at: now.toISOString(),
        provider_message_id: result.sid,
        attempt_count: (f.attempt_count ?? 0) + 1,
        locked_at: null,
      }).eq('id', f.id)
      sent++
    } else {
      const attempts = (f.attempt_count ?? 0) + 1
      const shouldRetry = attempts < MAX_ATTEMPTS
      const delayMin = RETRY_DELAYS_MIN[attempts - 1] ?? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1]
      const nextRetry = new Date(now.getTime() + delayMin * 60000)

      await db.from('followups').update({
        status:       shouldRetry ? 'queued' : 'failed',
        last_error:   result.message ?? 'Twilio error',
        attempt_count: attempts,
        next_retry_at: shouldRetry ? nextRetry.toISOString() : null,
        scheduled_at:  shouldRetry ? nextRetry.toISOString() : undefined,
        locked_at:     null,
      }).eq('id', f.id)
      failed++
    }
  }

  return Response.json({ processed: followups.length, sent, failed })
})
