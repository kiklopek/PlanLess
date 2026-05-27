import Stripe from 'npm:stripe@14'
import { corsHeaders, handleOptions, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { adminClient, userFromRequest } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  const { user, error: authErr } = await userFromRequest(req)
  if (authErr || !user) return errorResponse('Unauthorized', 401)

  const { billing } = await req.json()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)

  const priceId = billing === 'yearly'
    ? Deno.env.get('STRIPE_PRICE_ID_YEARLY')!
    : Deno.env.get('STRIPE_PRICE_ID_MONTHLY')!

  const origin = req.headers.get('origin') || 'https://planless.cz'

  const session = await stripe.checkout.sessions.create({
    customer_email: user.email,
    client_reference_id: user.id,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    subscription_data: { trial_period_days: 14 },
    success_url: `${origin}/app?payment=success`,
    cancel_url: `${origin}/payment?canceled=1`,
    locale: 'cs',
    metadata: { user_id: user.id },
    allow_promotion_codes: true,
  })

  return jsonResponse({ url: session.url })
})
