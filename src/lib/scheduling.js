function assertValidInterval(i) {
  if (!(i.startsAt instanceof Date) || !(i.endsAt instanceof Date)) throw new Error('Invalid interval dates')
  if (i.endsAt <= i.startsAt) throw new Error('Interval ends before it starts')
}

function overlaps(a, b) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

function minutesBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 60000)
}

function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60000)
}

function alignToStep(d, stepMin) {
  const aligned = new Date(d)
  aligned.setSeconds(0, 0)
  const minutes = aligned.getMinutes()
  const remainder = minutes % stepMin
  if (remainder !== 0) aligned.setMinutes(minutes + (stepMin - remainder))
  return aligned
}

export function computeFreeIntervals({ work, busy }) {
  assertValidInterval(work)

  const cleaned = [...busy]
    .filter(b => { try { assertValidInterval(b); return overlaps(b, work) } catch { return false } })
    .map(b => ({
      startsAt: new Date(Math.max(b.startsAt.getTime(), work.startsAt.getTime())),
      endsAt: new Date(Math.min(b.endsAt.getTime(), work.endsAt.getTime())),
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const merged = []
  for (const b of cleaned) {
    if (merged.length === 0) { merged.push(b); continue }
    const last = merged[merged.length - 1]
    if (b.startsAt <= last.endsAt) {
      last.endsAt = new Date(Math.max(last.endsAt.getTime(), b.endsAt.getTime()))
    } else {
      merged.push(b)
    }
  }

  const free = []
  let cursor = work.startsAt
  for (const b of merged) {
    if (cursor < b.startsAt) free.push({ startsAt: cursor, endsAt: b.startsAt })
    cursor = new Date(Math.max(cursor.getTime(), b.endsAt.getTime()))
  }
  if (cursor < work.endsAt) free.push({ startsAt: cursor, endsAt: work.endsAt })

  return free.filter(i => i.endsAt > i.startsAt)
}

export function generateSlots({ free, serviceMin, bufferAfterMin, stepMin }) {
  const totalMin = serviceMin + bufferAfterMin
  if (totalMin <= 0) throw new Error('Invalid service duration')
  if (stepMin <= 0) throw new Error('Invalid step')

  const out = []
  for (const f of free) {
    assertValidInterval(f)
    const windowMin = minutesBetween(f.startsAt, f.endsAt)
    if (windowMin < totalMin) continue

    let t = alignToStep(f.startsAt, stepMin)
    while (addMinutes(t, totalMin) <= f.endsAt) {
      out.push({ startsAt: new Date(t), endsAt: addMinutes(t, totalMin) })
      t = addMinutes(t, stepMin)
    }
  }
  return out
}

function computeBusyMerged(busy) {
  const cleaned = busy
    .filter(b => b?.startsAt && b?.endsAt)
    .map(b => ({ startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) }))
    .filter(b => b.endsAt > b.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const merged = []
  for (const b of cleaned) {
    if (merged.length === 0) merged.push(b)
    else {
      const last = merged[merged.length - 1]
      if (b.startsAt <= last.endsAt) {
        last.endsAt = new Date(Math.max(last.endsAt.getTime(), b.endsAt.getTime()))
      } else merged.push(b)
    }
  }
  return merged
}

function computeAdjacencyBonus(slot, busy) {
  let bonus = 0
  for (const b of busy) {
    if (minutesBetween(slot.endsAt, b.startsAt) === 0) bonus += 5
    if (minutesBetween(b.endsAt, slot.startsAt) === 0) bonus += 5
  }
  return bonus
}

function computeEdgeBonus(work, slot) {
  const distToStart = Math.abs(minutesBetween(work.startsAt, slot.startsAt))
  const distToEnd = Math.abs(minutesBetween(slot.endsAt, work.endsAt))
  const startBonus = Math.max(0, 8 - Math.floor(distToStart / 30))
  const endBonus = Math.max(0, 1 - Math.floor(distToEnd / 120))
  return startBonus + endBonus
}

function computeFragmentationPenalty(work, busy, slot) {
  const beforeFree = computeFreeIntervals({ work, busy }).length
  const afterFree = computeFreeIntervals({ work, busy: [...busy, slot] }).length
  return Math.max(0, afterFree - beforeFree) * 10
}

export function rankSlotsDensityFirst({ slots, work, busy }) {
  assertValidInterval(work)
  const busyMerged = computeBusyMerged(busy)

  const scored = slots.map(s => {
    const adjacencyBonus = computeAdjacencyBonus(s, busyMerged)
    const fragmentationPenalty = computeFragmentationPenalty(work, busyMerged, s)
    const edgeBonus = computeEdgeBonus(work, s)
    const score = fragmentationPenalty - adjacencyBonus - edgeBonus
    return { ...s, score, scoreBreakdown: { fragmentationPenalty, adjacencyBonus, edgeBonus } }
  })

  scored.sort((a, b) => a.score - b.score || a.startsAt.getTime() - b.startsAt.getTime())
  return scored
}
