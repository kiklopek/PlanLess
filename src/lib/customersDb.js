import { supabase } from './supabase.js'

const CACHE_TTL_MS = 30000
let cachedCustomers = null

export function getCachedCustomers() {
  return cachedCustomers?.data ?? null
}

export function clearCachedCustomers() {
  cachedCustomers = null
}

function cacheIsFresh() {
  return cachedCustomers && Date.now() - cachedCustomers.ts < CACHE_TTL_MS
}

function setCachedCustomers(data) {
  cachedCustomers = { data, ts: Date.now() }
}

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('Not authenticated')
  return user
}

export async function fetchCustomers() {
  if (cacheIsFresh()) return cachedCustomers.data
  try {
    const user = await requireUser()
    const { data, error } = await supabase
      .from('customers')
      .select('id, phone, name, notes, vip_status, last_visit_date, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    const rows = data ?? []
    setCachedCustomers(rows)
    return rows
  } catch (err) {
    console.error('Error fetching customers:', err)
    return cachedCustomers?.data ?? []
  }
}

export async function upsertCustomer(payload) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('customers')
    .upsert(
      {
        user_id: user.id,
        phone: payload.phone,
        name: payload.name ?? null,
        notes: payload.notes ?? null,
        vip_status: payload.vip_status ?? false,
        last_visit_date: payload.last_visit_date ?? null,
      },
      { onConflict: 'user_id,phone' }
    )
    .select('id, phone, name, notes, vip_status, last_visit_date, created_at')
    .single()

  if (error) throw error
  if (cachedCustomers) {
    setCachedCustomers([data, ...cachedCustomers.data.filter(c => c.id !== data.id)])
  }
  return data
}

export async function updateCustomerByPhone(phone, patch) {
  const user = await requireUser()
  const { error } = await supabase
    .from('customers')
    .update(patch)
    .eq('phone', phone)
    .eq('user_id', user.id)

  if (error) throw error
  if (cachedCustomers) {
    setCachedCustomers(cachedCustomers.data.map(c => c.phone === phone ? { ...c, ...patch } : c))
  }
}

export async function deleteCustomerByPhone(phone) {
  const user = await requireUser()
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('phone', phone)
    .eq('user_id', user.id)

  if (error) throw error
  if (cachedCustomers) {
    setCachedCustomers(cachedCustomers.data.filter(c => c.phone !== phone))
  }
}
