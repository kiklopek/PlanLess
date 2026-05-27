/**
 * Called after a successful online booking (public booking page).
 * Sends confirmation SMS to customer and optional notification to business owner.
 * Public — no JWT required. Rate-limited per IP.
 *
 * POST { booking_id: string }
 */
import { adminClient } from '../_shared/supabase.ts'

const rateLimitMap = new Map<string, number[]>()

function rateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const times = (rateLimitMap.get(key) ?? []).filter(t => now - t < 60000)
  if (times.length >= maxPerMinute) return false
  times.push(now)
  rateLimitMap.set(key, times)
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!rateLimit(`sms:${ip}`, 5)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  let booking_id: string | undefined
  try { ({ booking_id } = await req.json()) } catch { /* ignore */ }
  if (!booking_id) return Response.json({ error: 'booking_id required' }, { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })

  const db = adminClient()

  // Get booking with related data
  const { data: booking } = await db
    .from('bookings')
    .select('id, user_id, starts_at, status, created_at, customers(phone, name), services(name)')
    .eq('id', booking_id)
    .maybeSingle()

  if (!booking) return Response.json({ ok: false, error: 'Booking not found' }, { headers: { 'Access-Control-Allow-Origin': '*' } })

  // Only send for bookings created in the last 10 minutes (prevent replay)
  const createdAt = new Date(booking.created_at)
  if (Date.now() - createdAt.getTime() > 10 * 60 * 1000) {
    return Response.json({ ok: false, error: 'Booking too old' }, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const { data: cfg } = await db
    .from('company_settings')
    .select('company_name, timezone, twilio_phone_number, twilio_account_sid, twilio_auth_token, ai_confirm_sms, escalation_phone')
    .eq('user_id', booking.user_id)
    .maybeSingle()

  if (!cfg?.twilio_account_sid || !cfg?.twilio_auth_token || !cfg?.twilio_phone_number) {
    return Response.json({ ok: true, sms: false, reason: 'Twilio not configured' }, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const customerPhone = (booking.customers as any)?.phone
  const customerName  = (booking.customers as any)?.name ?? ''
  const serviceName   = (booking.services  as any)?.name ?? 'rezervaci'
  const tz            = cfg.timezone ?? 'Europe/Prague'

  const dateLabel = new Date(booking.starts_at).toLocaleString('cs-CZ', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilio_account_sid}/Messages.json`
  const auth = `Basic ${btoa(`${cfg.twilio_account_sid}:${cfg.twilio_auth_token}`)}`

  const results = await Promise.allSettled([
    // Customer confirmation
    customerPhone ? fetch(twilioBase, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: customerPhone,
        From: cfg.twilio_phone_number,
        Body: `Potvrzení online rezervace: ${serviceName}, ${dateLabel}. Těšíme se na vás! — ${cfg.company_name}`,
      }).toString(),
    }) : Promise.resolve(),

    // Business owner notification
    cfg.escalation_phone ? fetch(twilioBase, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: cfg.escalation_phone,
        From: cfg.twilio_phone_number,
        Body: `Nová online rezervace: ${serviceName}, ${dateLabel}. Zákazník: ${customerName || customerPhone || '?'}`,
      }).toString(),
    }) : Promise.resolve(),
  ])

  const allOk = results.every(r => r.status === 'fulfilled')
  return Response.json({ ok: allOk }, { headers: { 'Access-Control-Allow-Origin': '*' } })
})
