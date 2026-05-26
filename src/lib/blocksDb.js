import { supabase } from './supabase.js'

const CACHE_TTL_MS = 30000
let cachedBlocks = null

export function getCachedBlocks() {
  return cachedBlocks?.data ?? null
}

export function clearCachedBlocks() {
  cachedBlocks = null
}

function cacheIsFresh() {
  return cachedBlocks && Date.now() - cachedBlocks.ts < CACHE_TTL_MS
}

function setCachedBlocks(data) {
  cachedBlocks = { data, ts: Date.now() }
}

function upsertBlockCache(row) {
  if (!cachedBlocks) { setCachedBlocks([row]); return }
  const next = [...cachedBlocks.data.filter(b => b.id !== row.id), row]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  setCachedBlocks(next)
}

export async function fetchBlocks() {
  if (cacheIsFresh()) return cachedBlocks.data
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('id, starts_at, ends_at, reason, created_at')
    .order('starts_at', { ascending: true })

  if (error) throw error
  const rows = data ?? []
  setCachedBlocks(rows)
  return rows
}

export async function createBlock(payload) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert({
      user_id: user.id,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      reason: payload.reason ?? null,
    })
    .select('id, starts_at, ends_at, reason, created_at')
    .single()

  if (error) throw error
  upsertBlockCache(data)
  return data
}

export async function deleteBlock(id) {
  const { error } = await supabase.from('calendar_blocks').delete().eq('id', id)
  if (error) throw error
  if (cachedBlocks) {
    setCachedBlocks(cachedBlocks.data.filter(b => b.id !== id))
  }
}
