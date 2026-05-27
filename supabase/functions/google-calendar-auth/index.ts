/**
 * Google Calendar OAuth — initiates or handles the OAuth callback.
 *
 * GET  ?action=authorize  → redirect to Google consent screen
 * GET  ?code=...&state=... → OAuth callback, store tokens, redirect to /app
 */
import { corsHeaders, handleOptions, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { adminClient, userFromRequest } from '../_shared/supabase.ts'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  const url   = new URL(req.url)
  const action = url.searchParams.get('action')
  const code   = url.searchParams.get('code')
  const state  = url.searchParams.get('state') // user_id encoded

  const clientId     = Deno.env.get('GOOGLE_CLIENT_ID')!
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!
  const redirectUri  = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-calendar-auth`

  // ── Step 1: redirect to Google ──────────────────────────────
  if (action === 'authorize') {
    const { user } = await userFromRequest(req)
    if (!user) return errorResponse('Unauthorized', 401)

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         SCOPES,
      access_type:   'offline',
      prompt:        'consent',
      state:         user.id,
    })

    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  }

  // ── Step 2: OAuth callback ───────────────────────────────────
  if (code && state) {
    const db = adminClient()

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    })

    if (!tokenResp.ok) {
      return Response.redirect(`${Deno.env.get('APP_URL') ?? 'https://planless.cz'}/app?gcal=error`)
    }

    const tokens = await tokenResp.json()

    await db.from('company_settings').update({
      gcal_access_token:  tokens.access_token,
      gcal_refresh_token: tokens.refresh_token,
      gcal_token_expiry:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }).eq('user_id', state)

    return Response.redirect(`${Deno.env.get('APP_URL') ?? 'https://planless.cz'}/app?gcal=connected`)
  }

  return errorResponse('Invalid request')
})
