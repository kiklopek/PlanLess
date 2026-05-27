import { supabase } from './supabase.js'

const CACHE_TTL_MS = 30000
let cachedServices = null

export function getCachedServices() {
  return cachedServices?.data ?? null
}

export function clearCachedServices() {
  cachedServices = null
}

function cacheIsFresh() {
  return cachedServices && Date.now() - cachedServices.ts < CACHE_TTL_MS
}

function setCachedServices(data) {
  cachedServices = { data, ts: Date.now() }
}

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('Not authenticated')
  return user
}

export async function fetchServices() {
  if (cacheIsFresh()) return cachedServices.data
  const user = await requireUser()
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, duration_min, buffer_after_min, category, is_active, description, prep_note, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  const rows = data ?? []
  setCachedServices(rows)
  return rows
}

export async function createService(payload) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('services')
    .insert({
      user_id: user.id,
      name: payload.name,
      price: payload.price,
      duration_min: payload.duration_min,
      buffer_after_min: payload.buffer_after_min ?? 0,
      category: payload.category ?? null,
      is_active: payload.is_active !== false,
      description: payload.description ?? null,
      prep_note: payload.prep_note ?? null,
    })
    .select('id, name, price, duration_min, buffer_after_min, category, is_active, description, prep_note, created_at')
    .single()

  if (error) throw error
  if (cachedServices) {
    setCachedServices([data, ...cachedServices.data.filter(s => s.id !== data.id)])
  }
  return data
}

export async function updateService(serviceId, patch) {
  const user = await requireUser()
  const { error } = await supabase
    .from('services')
    .update(patch)
    .eq('id', serviceId)
    .eq('user_id', user.id)

  if (error) throw error
  if (cachedServices) {
    setCachedServices(cachedServices.data.map(s => s.id === serviceId ? { ...s, ...patch } : s))
  }
}

export async function deleteService(serviceId) {
  const user = await requireUser()
  const { error } = await supabase
    .from('services')
    .delete()
    .eq('id', serviceId)
    .eq('user_id', user.id)

  if (error) throw error
  if (cachedServices) {
    setCachedServices(cachedServices.data.filter(s => s.id !== serviceId))
  }
}
