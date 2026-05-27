import { supabase } from './supabase.js'

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('Not authenticated')
  return user
}

export async function createFollowup({ call_id = null, customer_id = null, channel = 'sms', message }) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('followups')
    .insert({ user_id: user.id, call_id, customer_id, channel, message, status: 'queued' })
    .select('id, status, created_at')
    .single()
  if (error) throw error
  return data
}

export async function listFollowupsForCall(callId) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('followups')
    .select('id, status, channel, message, scheduled_at, sent_at, created_at, attempt_count, last_error, next_retry_at')
    .eq('user_id', user.id)
    .eq('call_id', callId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function cancelFollowup(id) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('followups')
    .update({ status: 'cancelled', locked_at: null, next_retry_at: null })
    .eq('user_id', user.id)
    .eq('id', id)
    .in('status', ['queued', 'failed'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Follow-up nelze zrušit (už není ve frontě).')
}

export async function retryFollowup(id) {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('followups')
    .update({ status: 'queued', last_error: null, next_retry_at: null, locked_at: null, scheduled_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('id', id)
    .in('status', ['failed', 'cancelled'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Follow-up nelze znovu zařadit.')
}
