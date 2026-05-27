import { supabase } from './supabase.js'

const CACHE_TTL_MS = 30000
let cachedBookings = null

export function getCachedBookings() {
  return cachedBookings?.data ?? null
}

export function clearCachedBookings() {
  cachedBookings = null
}

function cacheIsFresh() {
  return cachedBookings && Date.now() - cachedBookings.ts < CACHE_TTL_MS
}

function setCachedBookings(data) {
  cachedBookings = { data, ts: Date.now() }
}

function upsertBookingCache(row) {
  if (!cachedBookings) { setCachedBookings([row]); return }
  const next = [...cachedBookings.data.filter(b => b.id !== row.id), row]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  setCachedBookings(next)
}

export async function fetchBookings({ from, to } = {}) {
  if (!from && !to && cacheIsFresh()) return cachedBookings.data

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .from('bookings')
    .select('*')
    .eq('user_id', user.id)
    .order('starts_at', { ascending: true })

  if (from) query = query.gte('starts_at', from)
  if (to)   query = query.lt('starts_at', to)
  if (!from && !to) query = query.limit(500)

  const { data, error } = await query
  if (error) throw error
  const rows = data ?? []
  if (!from && !to) setCachedBookings(rows)
  return rows
}

export async function createBooking(payload) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id: user.id,
      call_id: payload.call_id ?? null,
      customer_id: payload.customer_id ?? null,
      service_id: payload.service_id,
      staff_id: payload.staff_id ?? null,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      note: payload.note ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  upsertBookingCache(data)
  return data
}

export async function deleteBooking(id) {
  const { error } = await supabase.from('bookings').delete().eq('id', id)
  if (error) throw error
  if (cachedBookings) {
    setCachedBookings(cachedBookings.data.filter(b => b.id !== id))
  }
}
