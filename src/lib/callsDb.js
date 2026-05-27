import { supabase } from './supabase.js'

const CACHE_TTL_MS = 30000
let cachedCalls = null

export function getCachedCalls() {
  return cachedCalls?.data ?? null
}

export function clearCachedCalls() {
  cachedCalls = null
}

function cacheIsFresh() {
  return cachedCalls && Date.now() - cachedCalls.ts < CACHE_TTL_MS
}

function setCachedCalls(data) {
  cachedCalls = { data, ts: Date.now() }
}

export async function fetchCalls() {
  if (cacheIsFresh()) return cachedCalls.data
  const { data, error } = await supabase
    .from('calls')
    .select('id, created_at, customer_phone, customer_name, service_id, preferred_date, booking_id, summary, transcript_full, status, recording_url, conversation_state, bookings(starts_at, services(name))')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  const rows = data ?? []
  setCachedCalls(rows)
  return rows
}

export async function createCall(payload) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('calls')
    .insert({
      user_id: user.id,
      customer_phone: payload.customer_phone ?? null,
      customer_name: payload.customer_name ?? null,
      summary: payload.summary ?? null,
      transcript_full: payload.transcript_full ?? null,
      recording_url: payload.recording_url ?? null,
      status: payload.status ?? 'query',
    })
    .select('id, created_at, customer_phone, customer_name, service_id, preferred_date, booking_id, summary, transcript_full, status')
    .single()

  if (error) throw error
  if (cachedCalls) {
    setCachedCalls([data, ...cachedCalls.data.filter(c => c.id !== data.id)])
  }
  return data
}

export async function updateCallStatus(callId, status) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError

  const { error } = await supabase
    .from('calls')
    .update({ status })
    .eq('id', callId)
    .eq('user_id', user.id)

  if (error) throw error
  if (cachedCalls) {
    setCachedCalls(cachedCalls.data.map(c => c.id === callId ? { ...c, status } : c))
  }
}

export async function updateCall(callId, patch) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError

  const { data, error } = await supabase
    .from('calls')
    .update(patch)
    .eq('id', callId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) throw error
  if (cachedCalls) {
    setCachedCalls(cachedCalls.data.map(c => c.id === callId ? { ...c, ...data } : c))
  }
  return data
}
