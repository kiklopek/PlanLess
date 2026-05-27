/**
 * Send transactional email via Resend. Called when a booking is confirmed.
 * Body: { to: "email", subject: "...", html: "...", text?: "..." }
 * Or: { booking_id: "uuid" } — loads booking data and sends confirmation
 */
import { corsHeaders, handleOptions, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { adminClient, userFromRequest } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  const { user, error: authErr } = await userFromRequest(req)
  if (authErr || !user) return errorResponse('Unauthorized', 401)

  const db = adminClient()

  const body = await req.json()

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) return errorResponse('Resend není nakonfigurován. Přidejte RESEND_API_KEY do prostředí.', 422)

  const { data: cs } = await db
    .from('company_settings')
    .select('company_name, public_email, resend_from_email')
    .eq('user_id', user.id)
    .maybeSingle()

  const fromEmail = cs?.resend_from_email ?? `noreply@planless.app`
  const fromName  = cs?.company_name ?? 'PlanLess'

  let to: string
  let subject: string
  let html: string

  if (body.booking_id) {
    // Load booking details and compose confirmation email
    const { data: booking } = await db
      .from('bookings')
      .select('starts_at, ends_at, note, services(name), customers(name, phone)')
      .eq('id', body.booking_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!booking) return errorResponse('Rezervace nenalezena.', 404)
    if (!body.to) return errorResponse('Email zákazníka je vyžadován (pole "to").')

    to = body.to
    const serviceN = (booking.services as { name: string } | null)?.name ?? 'Rezervace'
    const customerN = (booking.customers as { name: string } | null)?.name ?? ''
    const dateStr = new Date(booking.starts_at).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Prague' })

    subject = `Potvrzení rezervace — ${serviceN}`
    html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="margin-bottom:4px">Rezervace potvrzena ✓</h2>
        ${customerN ? `<p>Dobrý den, <strong>${customerN}</strong>,</p>` : '<p>Dobrý den,</p>'}
        <p>Vaše rezervace byla úspěšně zaregistrována.</p>
        <table style="border-collapse:collapse;margin:20px 0;width:100%">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Služba</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${serviceN}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Datum a čas</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:500">${dateStr}</td></tr>
          ${booking.note ? `<tr><td style="padding:8px 0;color:#888;font-size:13px">Poznámka</td><td style="padding:8px 0">${booking.note}</td></tr>` : ''}
        </table>
        ${cs?.public_email || cs?.company_name ? `<p style="color:#888;font-size:13px">V případě změny nebo zrušení nás kontaktujte${cs?.public_email ? ` na <a href="mailto:${cs.public_email}">${cs.public_email}</a>` : ''}.</p>` : ''}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#bbb;font-size:12px">Rezervace přes <strong>PlanLess</strong></p>
      </div>
    `
  } else {
    // Direct send
    if (!body.to || !body.subject || !body.html) return errorResponse('"to", "subject" a "html" jsou povinné.')
    to = body.to
    subject = body.subject
    html = body.html
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html,
      text: body.text,
    }),
  })

  const result = await resp.json()
  if (!resp.ok) return errorResponse(result.message ?? 'Resend chyba.', 502)

  return jsonResponse({ ok: true, id: result.id })
})
