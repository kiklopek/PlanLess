import { supabase } from './supabase.js'

const CACHE_TTL_MS = 60000
let cachedStaff = null

export function getCachedStaff() {
  return cachedStaff?.data ?? null
}

export function clearCachedStaff() {
  cachedStaff = null
}

function cacheIsFresh() {
  return cachedStaff && Date.now() - cachedStaff.ts < CACHE_TTL_MS
}

function setCachedStaff(data) {
  cachedStaff = { data, ts: Date.now() }
}

export async function fetchStaff() {
  if (cacheIsFresh()) return cachedStaff.data
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = data ?? []
  setCachedStaff(rows)
  return rows
}

export async function createStaff(payload) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const initials = (payload.name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const { data, error } = await supabase
    .from('staff')
    .insert({
      user_id: user.id,
      name: payload.name,
      color: payload.color ?? '#6366f1',
      initials: payload.initials ?? initials,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      notes: payload.notes ?? null,
      working_hours: payload.working_hours ?? null,
      is_active: payload.is_active !== false,
    })
    .select('*')
    .single()

  if (error) throw error
  if (cachedStaff) setCachedStaff([...cachedStaff.data, data])
  return data
}

export async function updateStaff(id, patch) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError

  if (patch.name && !patch.initials) {
    patch.initials = patch.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  const { data, error } = await supabase
    .from('staff')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) throw error
  if (cachedStaff) setCachedStaff(cachedStaff.data.map(s => s.id === id ? { ...s, ...data } : s))
  return data
}

export async function deleteStaff(id) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('staff').delete().eq('id', id).eq('user_id', user.id)
  if (error) throw error
  if (cachedStaff) setCachedStaff(cachedStaff.data.filter(s => s.id !== id))
}
