/**
 * Simple in-process rate limiter using a Map.
 * Good for single-instance Edge Functions; for multi-region use Supabase KV.
 */
const store = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now()
  const entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return true // allowed
  }
  if (entry.count >= limit) return false // blocked
  entry.count++
  return true // allowed
}

/** Cleanup stale entries to prevent unbounded memory growth */
export function pruneRateLimitStore() {
  const now = Date.now()
  for (const [key, val] of store.entries()) {
    if (val.resetAt < now) store.delete(key)
  }
}
