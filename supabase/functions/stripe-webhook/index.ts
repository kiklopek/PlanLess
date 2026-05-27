import Stripe from 'npm:stripe@14'
import { adminClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  const db = adminClient()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    )
  } catch (err) {
    console.error('Webhook signature failed:', err)
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id ?? session.client_reference_id
    if (userId) {
      await db.from('profiles').upsert(
        { id: userId, is_subscribed: true, stripe_customer_id: session.customer as string },
        { onConflict: 'id' },
      )
    }
  }

  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    const sub = event.data.object as Stripe.Subscription
    const { data } = await db
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()
    if (data?.id) {
      await db.from('profiles').update({ is_subscribed: false }).eq('id', data.id)
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const active = sub.status === 'active' || sub.status === 'trialing'
    const { data } = await db
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()
    if (data?.id) {
      await db.from('profiles').update({ is_subscribed: active }).eq('id', data.id)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
