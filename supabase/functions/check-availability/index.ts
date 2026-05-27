/**
 * Check slot availability for a service on a given date.
 * No auth required — intended for internal calls (twilio-gather) and frontend.
 * Body: { user_id, service_id?, service_name?, preferred_date: ISO string, count?: number }
 */
import { adminClient } from '../_shared/supabase.ts'
import { getAvailableSlots } from '../_shared/scheduling.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  const { user_id, service_id, service_name, preferred_date, count = 5 } = await req.json()
  if (!user_id || !preferred_date) {
    return Response.json({ error: 'user_id and preferred_date required' }, { status: 400 })
  }

  const db = adminClient()

  const { data: settings } = await db
    .from('company_settings')
    .select('working_hours, timezone, lead_time_minutes, max_booking_horizon_days, default_buffer_minutes')
    .eq('user_id', user_id)
    .maybeSingle()

  if (!settings) return Response.json({ error: 'Company not found' }, { status: 404 })

  let durationMin = 60
  let bufferMin = settings.default_buffer_minutes ?? 0

  if (service_id) {
    const { data: svc } = await db
      .from('services')
      .select('duration_min, buffer_after_min')
      .eq('id', service_id)
      .maybeSingle()
    if (svc) { durationMin = svc.duration_min; bufferMin = svc.buffer_after_min ?? bufferMin }
  } else if (service_name) {
    const { data: svc } = await db
      .from('services')
      .select('duration_min, buffer_after_min')
      .eq('user_id', user_id)
      .ilike('name', `%${service_name}%`)
      .maybeSingle()
    if (svc) { durationMin = svc.duration_min; bufferMin = svc.buffer_after_min ?? bufferMin }
  }

  const slots = await getAvailableSlots(
    db, user_id, durationMin, bufferMin,
    new Date(preferred_date),
    settings.timezone ?? 'Europe/Prague',
    settings.working_hours ?? {},
    settings.lead_time_minutes ?? 120,
    settings.max_booking_horizon_days ?? 60,
    Number(count),
  )

  return Response.json({
    slots: slots.map(s => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      display: s.display,
    })),
  }, { headers: { 'Access-Control-Allow-Origin': '*' } })
})
