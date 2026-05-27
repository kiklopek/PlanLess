import { createClient } from 'npm:@supabase/supabase-js@2'

export function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )
}

export async function userFromRequest(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { user: null, error: 'No token' }
  const supabase = adminClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  return { user, error: error?.message ?? null }
}
