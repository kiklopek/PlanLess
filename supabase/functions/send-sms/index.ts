/**
 * Send SMS via Twilio. Called by the followup worker or directly from the app.
 * Body: { to: "+420...", message: "...", followup_id?: "uuid" }
 */
import { corsHeaders, handleOptions, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { adminClient, userFromRequest } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  const { user, error: authErr } = await userFromRequest(req)
  if (authErr || !user) return errorResponse('Unauthorized', 401)

  const db = adminClient()

  const { to, message, followup_id } = await req.json()
  if (!to || !message) return errorResponse('to and message are required')

  // Look up company's Twilio credentials
  const { data: settings } = await db
    .from('company_settings')
    .select('twilio_phone_number, twilio_account_sid, twilio_auth_token')
    .eq('user_id', user.id)
    .maybeSingle()

  const accountSid = settings?.twilio_account_sid ?? Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken  = settings?.twilio_auth_token  ?? Deno.env.get('TWILIO_AUTH_TOKEN')
  const from       = settings?.twilio_phone_number ?? Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !from) {
    return errorResponse('Twilio není nakonfigurováno. Přidejte číslo v Nastavení → Integrace.', 422)
  }

  const formData = new URLSearchParams({ To: to, From: from, Body: message })
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
      body: formData.toString(),
    },
  )

  const result = await resp.json()
  if (!resp.ok) {
    if (followup_id) {
      const { data: cur } = await db.from('followups').select('attempt_count').eq('id', followup_id).single()
      await db.from('followups').update({
        status: 'failed',
        last_error: result.message ?? 'Twilio error',
        attempt_count: (cur?.attempt_count ?? 0) + 1,
      }).eq('id', followup_id)
    }
    return errorResponse(result.message ?? 'SMS se nepodařilo odeslat', 502)
  }

  if (followup_id) {
    await db.from('followups').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', followup_id)
  }

  return jsonResponse({ sid: result.sid, status: result.status })
})
