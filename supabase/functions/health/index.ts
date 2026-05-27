/**
 * Health check endpoint — GET /functions/v1/health
 * Returns 200 OK with DB status for uptime monitoring (Uptime Robot, BetterStack, etc.)
 */
import { corsHeaders } from '../_shared/cors.ts'
import { adminClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const start = Date.now()
  let dbOk = false
  let dbLatencyMs = 0

  try {
    const db = adminClient()
    const t = Date.now()
    const { error } = await db.from('company_settings').select('user_id').limit(1)
    dbLatencyMs = Date.now() - t
    dbOk = !error
  } catch {
    dbOk = false
  }

  const status = dbOk ? 200 : 503
  const body = {
    status: dbOk ? 'ok' : 'degraded',
    ts: new Date().toISOString(),
    latency_ms: Date.now() - start,
    checks: {
      database: { ok: dbOk, latency_ms: dbLatencyMs },
    },
    version: Deno.env.get('SUPABASE_FUNCTION_VERSION') ?? 'unknown',
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
})
