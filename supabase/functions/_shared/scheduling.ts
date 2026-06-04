/**
 * Shared scheduling utilities — slot availability for Edge Functions.
 */

interface Interval {
  startsAt: Date
  endsAt: Date
}

export interface AvailableSlot {
  startsAt: Date
  endsAt: Date
  display: string
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000)
}

function alignToStep(d: Date, stepMin: number): Date {
  const aligned = new Date(d)
  aligned.setSeconds(0, 0)
  const rem = aligned.getMinutes() % stepMin
  if (rem !== 0) aligned.setMinutes(aligned.getMinutes() + (stepMin - rem))
  return aligned
}

function computeFreeIntervals(work: Interval, busy: Interval[]): Interval[] {
  const cleaned = busy
    .filter(b => b.endsAt > b.startsAt && b.startsAt < work.endsAt && b.endsAt > work.startsAt)
    .map(b => ({
      startsAt: new Date(Math.max(b.startsAt.getTime(), work.startsAt.getTime())),
      endsAt: new Date(Math.min(b.endsAt.getTime(), work.endsAt.getTime())),
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const merged: Interval[] = []
  for (const b of cleaned) {
    if (!merged.length) { merged.push({ ...b }); continue }
    const last = merged[merged.length - 1]
    if (b.startsAt <= last.endsAt) {
      last.endsAt = new Date(Math.max(last.endsAt.getTime(), b.endsAt.getTime()))
    } else {
      merged.push({ ...b })
    }
  }

  const free: Interval[] = []
  let cursor = work.startsAt
  for (const b of merged) {
    if (cursor < b.startsAt) free.push({ startsAt: cursor, endsAt: b.startsAt })
    cursor = new Date(Math.max(cursor.getTime(), b.endsAt.getTime()))
  }
  if (cursor < work.endsAt) free.push({ startsAt: cursor, endsAt: work.endsAt })
  return free.filter(i => i.endsAt > i.startsAt)
}

function generateSlots(free: Interval[], totalMin: number, stepMin = 15): Interval[] {
  const slots: Interval[] = []
  for (const f of free) {
    const windowMin = (f.endsAt.getTime() - f.startsAt.getTime()) / 60000
    if (windowMin < totalMin) continue
    let t = alignToStep(f.startsAt, stepMin)
    while (addMinutes(t, totalMin) <= f.endsAt) {
      slots.push({ startsAt: new Date(t), endsAt: addMinutes(t, totalMin) })
      t = addMinutes(t, stepMin)
    }
  }
  return slots
}

// Convert a date+time string in a specific IANA timezone to a UTC Date.
// e.g. parseInTimezone('2026-06-04', '09:00', 'Europe/Prague') → Date at UTC 07:00
function parseInTimezone(dateStr: string, timeStr: string, timezone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  const utcBase = new Date(Date.UTC(y, m - 1, d, h, min, 0))

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(utcBase)
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)

  const localSec = get('hour') * 3600 + get('minute') * 60 + get('second')
  const targetSec = h * 3600 + min * 60
  let diffSec = localSec - targetSec
  if (diffSec > 12 * 3600) diffSec -= 24 * 3600
  if (diffSec < -12 * 3600) diffSec += 24 * 3600

  return new Date(utcBase.getTime() - diffSec * 1000)
}

function getWorkInterval(
  date: Date,
  workingHours: Record<string, Array<{ start: string; end: string }>>,
  timezone: string,
): Interval | null {
  const dayIdx = new Date(date.toLocaleString('en-US', { timeZone: timezone })).getDay()
  const dayKey = DAY_KEYS[dayIdx]
  const slots = workingHours[dayKey]
  if (!slots?.length) return null

  const { start, end } = slots[0]
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone })
  return {
    startsAt: parseInTimezone(dateStr, start, timezone),
    endsAt: parseInTimezone(dateStr, end, timezone),
  }
}

export function isWithinWorkingHours(
  workingHours: Record<string, Array<{ start: string; end: string }>>,
  timezone: string,
): boolean {
  const now = new Date()
  const interval = getWorkInterval(now, workingHours, timezone)
  if (!interval) return false
  return now >= interval.startsAt && now < interval.endsAt
}

export function nextOpeningTime(
  workingHours: Record<string, Array<{ start: string; end: string }>>,
  timezone: string,
): string {
  const now = new Date()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86400000)
    const interval = getWorkInterval(d, workingHours, timezone)
    if (!interval) continue
    if (i === 0 && now >= interval.endsAt) continue
    const open = i === 0 ? interval.startsAt : interval.startsAt
    return open.toLocaleString('cs-CZ', {
      timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit',
    })
  }
  return 'brzy'
}

export async function getAvailableSlots(
  db: any,
  userId: string,
  serviceDurationMin: number,
  bufferAfterMin: number,
  preferredDate: Date,
  timezone: string,
  workingHours: Record<string, Array<{ start: string; end: string }>>,
  leadTimeMin: number,
  maxHorizonDays: number,
  count = 5,
): Promise<AvailableSlot[]> {
  const totalMin = serviceDurationMin + bufferAfterMin
  const now = new Date()
  const earliest = new Date(now.getTime() + leadTimeMin * 60000)
  const horizon = new Date(now.getTime() + maxHorizonDays * 24 * 3600000)

  const results: AvailableSlot[] = []
  const startDay = new Date(preferredDate)
  startDay.setHours(0, 0, 0, 0)

  for (let offset = 0; offset < Math.min(maxHorizonDays, 30) && results.length < count; offset++) {
    const day = new Date(startDay.getTime() + offset * 86400000)
    if (day > horizon) break

    const work = getWorkInterval(day, workingHours, timezone)
    if (!work) continue
    if (work.endsAt <= earliest) continue

    const effectiveStart = work.startsAt < earliest ? new Date(earliest) : work.startsAt
    const effectiveWork = { startsAt: effectiveStart, endsAt: work.endsAt }

    const [{ data: bk }, { data: bl }] = await Promise.all([
      db.from('bookings')
        .select('starts_at, ends_at')
        .eq('user_id', userId)
        .gte('starts_at', work.startsAt.toISOString())
        .lte('starts_at', work.endsAt.toISOString()),
      db.from('calendar_blocks')
        .select('starts_at, ends_at')
        .eq('user_id', userId)
        .gte('starts_at', work.startsAt.toISOString())
        .lte('starts_at', work.endsAt.toISOString()),
    ])

    const busy: Interval[] = [
      ...(bk ?? []).map((b: any) => ({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) })),
      ...(bl ?? []).map((b: any) => ({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) })),
    ]

    const free = computeFreeIntervals(effectiveWork, busy)
    let daySlots = generateSlots(free, totalMin, 15)

    if (offset === 0 && preferredDate.getHours() > 0) {
      daySlots = daySlots.sort((a, b) =>
        Math.abs(a.startsAt.getTime() - preferredDate.getTime()) -
        Math.abs(b.startsAt.getTime() - preferredDate.getTime()),
      )
    }

    for (const slot of daySlots) {
      if (results.length >= count) break
      results.push({
        ...slot,
        display: slot.startsAt.toLocaleString('cs-CZ', {
          timeZone: timezone,
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit',
        }),
      })
    }
  }

  return results
}
