import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { suggestSlots } from '../lib/suggestSlots.js'
import { getCompanySettings } from '../lib/companySettings.js'

function formatSlot(dt) {
  return new Date(dt).toLocaleString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function overlaps(a, b) {
  const aS = new Date(a.startsAt).getTime(), aE = new Date(a.endsAt).getTime()
  const bS = new Date(b.startsAt).getTime(), bE = new Date(b.endsAt).getTime()
  return aS < bE && bS < aE
}

export function SuggestedSlots({ serviceId, busy = [], initialDate, onBookSlot }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [date, setDate] = useState(() => initialDate || new Date().toISOString().slice(0, 10))
  const [suggested, setSuggested] = useState([])
  const [loading, setLoading] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookedSlot, setBookedSlot] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    getCompanySettings(user.id).then(s => setSettings(s)).catch(() => {})
  }, [user])

  const dateLimits = (() => {
    if (!settings) return { min: '', max: '' }
    const now = new Date()
    const min = new Date(now.getTime() + (settings.lead_time_minutes ?? 0) * 60000)
    const max = new Date(now.getTime() + (settings.max_booking_horizon_days ?? 30) * 24 * 60 * 60000)
    return { min: min.toISOString().slice(0, 10), max: max.toISOString().slice(0, 10) }
  })()

  const workingHoursLabel = (() => {
    if (!settings?.working_hours) return null
    const dateRef = new Date(`${date}T12:00:00`)
    const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateRef.getDay()]
    const intervals = settings.working_hours[key] || []
    if (intervals.length === 0) return 'Žádná pracovní doba pro vybraný den.'
    return intervals.map(i => `${i.start}–${i.end}`).join(', ')
  })()

  async function suggest() {
    if (!serviceId || !user) return
    setLoading(true)
    setError('')
    setSuggested([])
    setBookedSlot(null)
    try {
      const result = await suggestSlots({ date, serviceId, stepMin: 5, userId: user.id })
      const slots = (result.recommendedSlots || []).filter(s => !busy.some(b => overlaps(s, b)))
      setSuggested(slots)
      if (slots.length === 0) setError('Žádné volné termíny pro vybraný den.')
    } catch (e) {
      setError(
        e.message === 'ONBOARDING_INCOMPLETE' ? 'Dokončete onboarding v Nastavení.' :
        e.message || 'Nepodařilo se načíst termíny.'
      )
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)',
    background: 'var(--paper)', fontSize: 13, color: 'var(--ink)', outline: 'none',
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Doporučené termíny</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>Klikněte pro okamžitou rezervaci.</div>

      {error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Datum</span>
          <input
            type="date"
            value={date}
            min={dateLimits.min}
            max={dateLimits.max}
            onChange={e => setDate(e.target.value)}
            style={inputStyle}
          />
        </label>
        {workingHoursLabel && (
          <div style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)', fontSize: 12, color: 'var(--ink-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>Pracovní doba</div>
            {workingHoursLabel}
          </div>
        )}
      </div>

      <button
        onClick={suggest}
        disabled={loading || !serviceId}
        style={{
          padding: '7px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12, cursor: loading || !serviceId ? 'not-allowed' : 'pointer',
          border: 'none', background: loading || !serviceId ? 'var(--paper-2, rgba(255,255,255,0.05))' : 'var(--accent)',
          color: loading || !serviceId ? 'var(--ink-3)' : 'white',
        }}
      >
        {loading ? 'Počítám…' : 'Navrhnout termíny'}
      </button>

      {!serviceId && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>Nejdřív vyberte službu.</div>}

      <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
        {suggested.length === 0 && !loading && !error && (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Zvolte datum a klikněte „Navrhnout termíny".</div>
        )}
        {suggested.map(s => (
          <button
            key={s.startsAt}
            onClick={() => {
              if (!onBookSlot || booking || !serviceId) return
              setBooking(true)
              Promise.resolve(onBookSlot(s))
                .then(() => setBookedSlot(s.startsAt))
                .catch(e => setError(e?.message || 'Rezervace selhala.'))
                .finally(() => setBooking(false))
            }}
            disabled={booking || !serviceId}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)',
              background: bookedSlot === s.startsAt ? 'var(--accent-soft)' : 'var(--paper)',
              cursor: booking || !serviceId ? 'not-allowed' : 'pointer',
              textAlign: 'left', width: '100%',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{formatSlot(s.startsAt)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>do {formatSlot(s.endsAt)}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: bookedSlot === s.startsAt ? 'var(--accent)' : 'var(--ink-2)' }}>
              {bookedSlot === s.startsAt ? 'Potvrzeno ✓' : 'Rezervovat'}
            </span>
          </button>
        ))}
      </div>

      {bookedSlot && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)' }}>
          Termín uložen: {new Date(bookedSlot).toLocaleString('cs-CZ')}
        </div>
      )}
    </div>
  )
}
