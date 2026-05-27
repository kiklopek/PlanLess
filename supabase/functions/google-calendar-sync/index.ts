/**
 * Sync PlanLess bookings → Google Calendar.
 * Called after a booking is created/deleted, or on a schedule.
 * Body: { action: "push" | "pull", booking_id?: string }
 */
import { corsHeaders, handleOptions, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { adminClient, userFromRequest } from '../_shared/supabase.ts'

const CALENDAR_ID = 'primary'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  const { user, error: authErr } = await userFromRequest(req)
  if (authErr || !user) return errorResponse('Unauthorized', 401)

  const db = adminClient()

  // Load tokens
  const { data: settings } = await db
    .from('company_settings')
    .select('gcal_access_token, gcal_refresh_token, gcal_token_expiry, google_client_id, google_client_secret, company_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.gcal_access_token) {
    return errorResponse('Google Calendar není propojený. Přejděte do Nastavení → Integrace.', 422)
  }

  let accessToken = settings.gcal_access_token
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!

  // Refresh token if expired
  if (new Date(settings.gcal_token_expiry) < new Date()) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: settings.gcal_refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    })
    const tok = await r.json()
    accessToken = tok.access_token
    await db.from('company_settings').update({
      gcal_access_token: accessToken,
      gcal_token_expiry: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    }).eq('user_id', user.id)
  }

  const { action, booking_id } = await req.json()

  if (action === 'push') {
    const query = db.from('bookings')
      .select('*, services(name), customers(name, phone)')
      .eq('user_id', user.id)

    if (booking_id) query.eq('id', booking_id)
    else query.gte('starts_at', new Date().toISOString()).limit(50)

    const { data: bookings } = await query

    const created: string[] = []
    for (const b of bookings ?? []) {
      const svcName = (b.services as { name: string } | null)?.name ?? 'Rezervace'
      const custName = (b.customers as { name: string; phone: string } | null)?.name
        || (b.customers as { name: string; phone: string } | null)?.phone
        || ''
      const event = {
        summary:     custName ? `${svcName} — ${custName}` : svcName,
        description: b.note ?? '',
        start:       { dateTime: b.starts_at, timeZone: 'Europe/Prague' },
        end:         { dateTime: b.ends_at,   timeZone: 'Europe/Prague' },
        sendUpdates: 'none',
      }

      const gcalResp = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        },
      )

      if (gcalResp.ok) {
        const gcalEvent = await gcalResp.json()
        await db.from('bookings').update({ gcal_event_id: gcalEvent.id }).eq('id', b.id)
        created.push(gcalEvent.id)
      }
    }

    return jsonResponse({ pushed: created.length, ids: created })
  }

  if (action === 'delete') {
    const { data: booking } = await db.from('bookings')
      .select('gcal_event_id')
      .eq('id', booking_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (booking?.gcal_event_id) {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events/${booking.gcal_event_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
      )
      await db.from('bookings').update({ gcal_event_id: null }).eq('id', booking_id)
    }
    return jsonResponse({ deleted: !!booking?.gcal_event_id })
  }

  if (action === 'pull') {
    // Import events from Google Calendar that don't exist in PlanLess
    const now = new Date().toISOString()
    const gcalResp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events?timeMin=${now}&maxResults=50&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!gcalResp.ok) return errorResponse('Chyba při čtení Google Kalendáře', 502)

    const { items } = await gcalResp.json()
    return jsonResponse({ events: items?.length ?? 0 })
  }

  return errorResponse('Unknown action. Use "push" or "pull".')
})
