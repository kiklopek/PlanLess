import { supabase } from './supabase.js'
import { getCompanySettings } from './companySettings.js'
import { computeFreeIntervals, generateSlots, rankSlotsDensityFirst } from './scheduling.js'

function dayKeyFromDate(date) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()]
}

function overlapsInterval(a, b) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

export async function suggestSlots({ date, serviceId, stepMin = 10, userId }) {
  if (!userId) throw new Error('Not authenticated')

  const settings = await getCompanySettings(userId)
  if (!settings || !settings.onboarding_completed) throw new Error('ONBOARDING_INCOMPLETE')

  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id,duration_min,buffer_after_min')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr) throw new Error(svcErr.message)
  if (!service) throw new Error('Služba nenalezena')

  const serviceMin = Number(service.duration_min)
  const bufferAfterMin = Number(service.buffer_after_min ?? 0)

  const dateRef = new Date(`${date}T12:00:00`)
  const dayKey = dayKeyFromDate(dateRef)
  const windows = (settings.working_hours ?? {})[dayKey] ?? []

  if (windows.length === 0) throw new Error('Pro vybraný den není nastavena pracovní doba.')

  const workIntervals = windows.map(w => ({
    startsAt: new Date(`${date}T${w.start}:00`),
    endsAt: new Date(`${date}T${w.end}:00`),
  }))

  const dayStart = workIntervals.reduce((min, i) => i.startsAt < min ? i.startsAt : min, workIntervals[0].startsAt)
  const dayEnd = workIntervals.reduce((max, i) => i.endsAt > max ? i.endsAt : max, workIntervals[0].endsAt)

  const now = new Date()
  const minStart = new Date(now.getTime() + (settings.lead_time_minutes ?? 0) * 60000)
  const horizonEnd = new Date(now.getTime() + (settings.max_booking_horizon_days ?? 30) * 24 * 60 * 60000)

  const [bookingsRes, blocksRes] = await Promise.all([
    supabase.from('bookings').select('starts_at,ends_at')
      .lt('starts_at', dayEnd.toISOString())
      .gt('ends_at', dayStart.toISOString()),
    supabase.from('calendar_blocks').select('starts_at,ends_at')
      .lt('starts_at', dayEnd.toISOString())
      .gt('ends_at', dayStart.toISOString()),
  ])

  if (bookingsRes.error) throw new Error(bookingsRes.error.message)
  if (blocksRes.error) throw new Error(blocksRes.error.message)

  const busy = [
    ...(bookingsRes.data ?? []).map(r => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) })),
    ...(blocksRes.data ?? []).map(r => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) })),
  ]

  const free = workIntervals.flatMap(work => {
    const effective = minStart > work.startsAt && minStart < work.endsAt
      ? { startsAt: minStart, endsAt: work.endsAt }
      : work
    if (effective.endsAt <= effective.startsAt) return []
    return computeFreeIntervals({ work: effective, busy })
  })

  const slots = generateSlots({ free, serviceMin, bufferAfterMin, stepMin })
    .filter(s => s.startsAt >= minStart && s.startsAt <= horizonEnd)
    .filter(s => !busy.some(b => overlapsInterval(s, b)))

  const ranked = rankSlotsDensityFirst({ slots, work: { startsAt: dayStart, endsAt: dayEnd }, busy })

  return {
    recommendedSlots: ranked.slice(0, 5).map(s => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      score: s.score,
    })),
    allSlotsCount: ranked.length,
  }
}
