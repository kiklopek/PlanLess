import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

async function loadProfile(userId) {
  const { data } = await supabase.from('profiles').select('is_subscribed, stripe_customer_id').eq('id', userId).maybeSingle()
  return data
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [stripeCustomerId, setStripeCustomerId] = useState(null)

  const refreshProfile = useCallback(async (uid) => {
    if (!uid) return
    const profile = await loadProfile(uid)
    setIsSubscribed(profile?.is_subscribed ?? false)
    setStripeCustomerId(profile?.stripe_customer_id ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // If user logged in with "don't remember me" and this is a fresh browser session
      if (session && localStorage.getItem('pl:no_persist') === '1' && !sessionStorage.getItem('pl:session_guard')) {
        supabase.auth.signOut().then(() => {
          localStorage.removeItem('pl:no_persist')
          setSession(null)
          setUser(null)
          setLoading(false)
        })
        return
      }
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) refreshProfile(session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) refreshProfile(session.user.id)
      else { setIsSubscribed(false); setStripeCustomerId(null) }
    })

    return () => subscription.unsubscribe()
  }, [refreshProfile])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, isSubscribed, stripeCustomerId, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
