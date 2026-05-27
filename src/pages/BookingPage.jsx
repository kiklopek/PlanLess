import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import '../styles/globals.css'
import './BookingPage.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

/* ── Helpers ── */
const CZ_MONTHS_SHORT = ['led','úno','bře','dub','kvě','čer','čec','srp','zář','říj','lis','pro']
const CZ_DAYS_FULL = ['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota']

function fmtSlotLabel(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
}
function fmtDayLabel(iso) {
  const d = new Date(iso)
  return `${CZ_DAYS_FULL[d.getDay()]} ${d.getDate()}. ${CZ_MONTHS_SHORT[d.getMonth()]}`
}

export default function BookingPage() {
  const { slug } = useParams()

  const [company, setCompany] = useState(null)
  const [services, setServices] = useState([])
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState(1) // 1=service, 2=slots, 3=info, 4=done
  const [selService, setSelService] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selSlot, setSelSlot] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Load company + services
  useEffect(() => {
    if (!slug) return
    ;(async () => {
      const { data: cs } = await supabase
        .from('company_settings')
        .select('user_id, company_name, company_description, booking_page_title, booking_page_enabled, public_phone, public_email, website_url')
        .eq('booking_slug', slug)
        .eq('booking_page_enabled', true)
        .maybeSingle()

      if (!cs) { setNotFound(true); setLoading(false); return }
      setCompany(cs)

      const { data: svcs } = await supabase
        .from('services')
        .select('id, name, duration_min, price, category, buffer_after_min')
        .eq('user_id', cs.user_id)
        .eq('is_active', true)
        .order('name')

      setServices(svcs ?? [])
      setLoading(false)
    })()
  }, [slug])

  // Load slots when service selected
  useEffect(() => {
    if (!selService || !company) return
    setSlotsLoading(true)
    setSlots([])
    setSelSlot(null)
    ;(async () => {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/check-availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: company.user_id,
            service_id: selService.id,
            preferred_date: new Date().toISOString(),
            count: 20,
          }),
        })
        const { slots: raw } = await resp.json()
        setSlots(raw ?? [])
      } catch { setSlots([]) }
      setSlotsLoading(false)
    })()
  }, [selService])

  const submitBooking = async () => {
    if (!form.name.trim()) { setError('Zadejte prosím jméno.'); return }
    if (!form.phone.trim()) { setError('Zadejte prosím telefonní číslo.'); return }
    setError('')
    setSubmitting(true)
    try {
      // Upsert customer
      const { data: cust } = await supabase
        .from('customers')
        .upsert(
          { user_id: company.user_id, phone: form.phone.trim(), name: form.name.trim() },
          { onConflict: 'user_id,phone' },
        )
        .select('id')
        .single()

      // Create booking
      const endsAt = new Date(new Date(selSlot.startsAt).getTime() + selService.duration_min * 60000)
      const { data: bk } = await supabase.from('bookings').insert({
        user_id: company.user_id,
        service_id: selService.id,
        customer_id: cust?.id ?? null,
        starts_at: selSlot.startsAt,
        ends_at: endsAt.toISOString(),
        note: form.note.trim() || `Online rezervace — ${form.name}`,
        status: 'confirmed',
      }).select('id').single()

      // Fire-and-forget SMS confirmation
      if (bk?.id) {
        fetch(`${SUPABASE_URL}/functions/v1/confirm-online-booking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bk.id }),
        }).catch(() => {})
      }

      setStep(4)
    } catch (e) {
      setError(e.message || 'Rezervaci se nepodařilo odeslat. Zkuste to prosím znovu.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="bp-wrap">
      <div className="bp-loading">Načítám…</div>
    </div>
  )

  if (notFound) return (
    <div className="bp-wrap">
      <div className="bp-not-found">
        <div className="bp-404">404</div>
        <div className="bp-404-msg">Stránka rezervací nebyla nalezena.</div>
      </div>
    </div>
  )

  // Group slots by day
  const slotsByDay = {}
  for (const s of slots) {
    const key = new Date(s.startsAt).toDateString()
    if (!slotsByDay[key]) slotsByDay[key] = []
    slotsByDay[key].push(s)
  }

  return (
    <div className="bp-wrap">
      <div className="bp-card">
        {/* Header */}
        <div className="bp-header">
          <div className="bp-logo">{(company.company_name || 'S')[0].toUpperCase()}</div>
          <div>
            <div className="bp-title">{company.booking_page_title || company.company_name}</div>
            {company.company_description && <div className="bp-desc">{company.company_description}</div>}
          </div>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="bp-steps">
            {['Služba','Termín','Kontakt'].map((l, i) => (
              <div key={i} className={`bp-step ${step > i + 1 ? 'done' : ''} ${step === i + 1 ? 'active' : ''}`}>
                <div className="bp-step-dot">{step > i + 1 ? '✓' : i + 1}</div>
                <div className="bp-step-lbl">{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — choose service */}
        {step === 1 && (
          <div>
            <div className="bp-section-title">Vyberte službu</div>
            {services.length === 0 && <div className="bp-empty">Žádné služby k dispozici.</div>}
            <div className="bp-service-grid">
              {services.map(s => (
                <button
                  key={s.id}
                  className={`bp-service-card ${selService?.id === s.id ? 'selected' : ''}`}
                  onClick={() => setSelService(s)}
                >
                  <div className="bp-svc-name">{s.name}</div>
                  <div className="bp-svc-meta">
                    {s.duration_min} min
                    {s.price != null && <> · {Number(s.price).toLocaleString('cs-CZ')} Kč</>}
                  </div>
                </button>
              ))}
            </div>
            {selService && (
              <button className="bp-btn-primary" onClick={() => setStep(2)}>
                Pokračovat →
              </button>
            )}
          </div>
        )}

        {/* Step 2 — choose slot */}
        {step === 2 && (
          <div>
            <button className="bp-back" onClick={() => { setStep(1); setSelSlot(null) }}>← Zpět</button>
            <div className="bp-section-title">Vyberte termín</div>
            <div className="bp-selected-svc">{selService.name} · {selService.duration_min} min</div>
            {slotsLoading && <div className="bp-loading">Hledám volné termíny…</div>}
            {!slotsLoading && slots.length === 0 && (
              <div className="bp-empty">Momentálně nejsou volné termíny. Kontaktujte nás přímo.</div>
            )}
            {!slotsLoading && Object.entries(slotsByDay).map(([day, daySlots]) => (
              <div key={day} className="bp-day-group">
                <div className="bp-day-label">{fmtDayLabel(daySlots[0].startsAt)}</div>
                <div className="bp-slot-row">
                  {daySlots.map(s => (
                    <button
                      key={s.startsAt}
                      className={`bp-slot ${selSlot?.startsAt === s.startsAt ? 'selected' : ''}`}
                      onClick={() => setSelSlot(s)}
                    >
                      {fmtSlotLabel(s.startsAt)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {selSlot && (
              <button className="bp-btn-primary" onClick={() => setStep(3)}>
                Pokračovat →
              </button>
            )}
          </div>
        )}

        {/* Step 3 — contact info */}
        {step === 3 && (
          <div>
            <button className="bp-back" onClick={() => { setStep(2); }}>← Zpět</button>
            <div className="bp-section-title">Vaše kontaktní údaje</div>
            <div className="bp-summary-row">
              <span className="bp-summary-label">Služba:</span> {selService.name}
            </div>
            <div className="bp-summary-row">
              <span className="bp-summary-label">Termín:</span> {selSlot.display}
            </div>
            <div className="bp-form">
              <label className="bp-label">
                Jméno a příjmení *
                <input
                  className="bp-input"
                  placeholder="Jana Nováková"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="bp-label">
                Telefonní číslo *
                <input
                  className="bp-input"
                  type="tel"
                  placeholder="+420 777 111 222"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label className="bp-label">
                Poznámka (volitelná)
                <textarea
                  className="bp-input bp-textarea"
                  placeholder="Barva vlasů, preference, dotaz…"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  rows={3}
                />
              </label>
            </div>
            {error && <div className="bp-error">{error}</div>}
            <button className="bp-btn-primary" onClick={submitBooking} disabled={submitting}>
              {submitting ? 'Odesílám…' : 'Potvrdit rezervaci'}
            </button>
          </div>
        )}

        {/* Step 4 — confirmation */}
        {step === 4 && (
          <div className="bp-confirm">
            <div className="bp-confirm-icon">✓</div>
            <div className="bp-confirm-title">Rezervace potvrzena!</div>
            <div className="bp-confirm-detail">
              <strong>{selService?.name}</strong><br />
              {selSlot?.display}
            </div>
            <div className="bp-confirm-msg">
              Brzy dostanete potvrzení na telefon. Těšíme se na vás!
            </div>
            <button className="bp-btn-secondary" onClick={() => { setStep(1); setSelService(null); setSelSlot(null); setForm({ name:'', phone:'', note:'' }) }}>
              Vytvořit další rezervaci
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="bp-footer">
          Rezervace přes <strong>PlanLess</strong>
          {company.public_phone && <> · <a href={`tel:${company.public_phone}`}>{company.public_phone}</a></>}
        </div>
      </div>
    </div>
  )
}
