import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getCompanySettings } from '../lib/companySettings.js'
import { supabase } from '../lib/supabase.js'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const [checking, setChecking] = useState(true)
  const [destination, setDestination] = useState(null)

  useEffect(() => {
    if (loading) return

    if (!user) {
      setDestination('/login')
      setChecking(false)
      return
    }

    const devSkip = import.meta.env.VITE_DEV_SKIP_PAYMENT === 'true'

    const localSkip = (() => { try { return localStorage.getItem('pl:onboarding_skipped') === '1'; } catch { return false; } })();

    getCompanySettings(user.id)
      .then(async settings => {
        if (!localSkip && (!settings || !settings.onboarding_completed)) {
          setDestination('/onboarding')
        } else if (!devSkip) {
          const { data } = await supabase.from('profiles').select('is_subscribed').eq('id', user.id).maybeSingle()
          if (!data?.is_subscribed) setDestination('/payment')
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [user, loading])

  if (loading || checking) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--ink-3)', fontSize: 14 }}>
        Načítám…
      </div>
    )
  }

  if (destination) return <Navigate to={destination} replace />

  return children
}
