/**
 * Booking reminder worker.
 * Called on a schedule (e.g., daily or every hour via Supabase Cron).
 * Queues SMS reminders for bookings starting in the next 24 hours.
 */
import { adminClient } from '../_shared/supabase.ts'

const REMINDER_WINDOW_H = 24  // remind 24h before
const REMINDER_EARLY_H  = 48  // but not earlier than 48h before (so we catch 24-48h window)

Deno.serve(async (_req) => {
  const db = adminClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() + REMINDER_WINDOW_H * 3600000)
  const windowEnd   = new Date(now.getTime() + REMINDER_EARLY_H  * 3600000)

  // Find bookings needing a reminder: starts_at in [now+24h, now+48h], reminder_sent_at IS NULL
  const { data: bookings } = await db
    .from('bookings')
    .select('id, user_id, starts_at, ends_at, customer_id, customers(name, phone), services(name)')
    .gte('starts_at', windowStart.toISOString())
    .lte('starts_at', windowEnd.toISOString())
    .is('reminder_sent_at', null)
    .eq('status', 'confirmed')

  if (!bookings?.length) {
    return Response.json({ queued: 0 })
  }

  // Group by user_id to check reminder_enabled per company
  const userIds = [...new Set(bookings.map(b => b.user_id))]
  const { data: settings } = await db
    .from('company_settings')
    .select('user_id, reminder_enabled, company_name, timezone')
    .in('user_id', userIds)

  const settingsMap = Object.fromEntries((settings ?? []).map(s => [s.user_id, s]))

  let queued = 0
  const remindedIds: string[] = []

  for (const b of bookings) {
    const cs = settingsMap[b.user_id]
    if (!cs || cs.reminder_enabled === false) continue

    const customer = b.customers as { name?: string; phone?: string } | null
    const phone = customer?.phone
    if (!phone) continue

    const svcName = (b.services as { name?: string } | null)?.name ?? 'rezervace'
    const tz = cs.timezone ?? 'Europe/Prague'
    const dateLabel = new Date(b.starts_at).toLocaleString('cs-CZ', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    })
    const custName = customer?.name ? `, ${customer.name}` : ''

    await db.from('followups').insert({
      user_id:      b.user_id,
      customer_id:  b.customer_id,
      channel:      'sms',
      message:      `Připomínka${custName}: ${svcName} zítra ${dateLabel}. Těšíme se! — ${cs.company_name}`,
      status:       'queued',
      scheduled_at: now.toISOString(),
      metadata:     { to: phone, booking_id: b.id, type: 'reminder' },
    })

    remindedIds.push(b.id)
    queued++
  }

  // Mark as reminded so we don't send twice
  if (remindedIds.length) {
    await db.from('bookings')
      .update({ reminder_sent_at: now.toISOString() })
      .in('id', remindedIds)
  }

  return Response.json({ queued })
})
