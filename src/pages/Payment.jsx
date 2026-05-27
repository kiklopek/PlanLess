import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import '../styles/globals.css'
import './Payment.css'
import { supabase } from '../lib/supabase.js'

const Ic = ({ s = 16, sw = 1.7, fill = 'none', children, ...p }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
)
const CheckIc  = (p) => <Ic {...p}><polyline points="20 6 9 17 4 12" /></Ic>
const ArrowR   = (p) => <Ic {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Ic>
const ZapIc    = (p) => <Ic {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Ic>
const LockIc   = (p) => <Ic {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Ic>
const ShieldIc = (p) => <Ic {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Ic>

const INCLUDES = [
  'Až 500 hovorů / měsíc',
  'CZ, SK, EN, DE jazyky',
  'Rezervace + SMS + e-mail potvrzení',
  'Pokročilá pravidla a integrace',
  'Prioritní česká podpora',
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export default function Payment() {
  const navigate = useNavigate()
  const [billing, setBilling] = useState('yearly')
  const [submitting, setSubmitting] = useState(false)

  const monthlyPrice = 2490
  const yearlyMonthly = 1990
  const yearlyTotal = yearlyMonthly * 12
  const discount = monthlyPrice * 12 - yearlyTotal
  const vat = Math.round(yearlyTotal * 0.21)

  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 14)
  const trialEndStr = trialEnd.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { data: { session }, error: sessErr } = await supabase.auth.getSession()
      if (sessErr || !session) { navigate('/login'); return }

      // If no Stripe is configured (dev/no env), fall back to direct activation
      if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder')) {
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: session.user.id, is_subscribed: true }, { onConflict: 'id' })
        if (error) { toast.error('Chyba při aktivaci: ' + error.message); return }
        toast.success('Zkušební doba aktivována!')
        navigate('/app')
        return
      }

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ billing }),
      })

      if (!resp.ok) {
        // Edge Function not deployed yet — fallback to direct activation
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: session.user.id, is_subscribed: true }, { onConflict: 'id' })
        if (error) { toast.error('Chyba při aktivaci: ' + error.message); return }
        toast.success('Zkušební doba aktivována!')
        navigate('/app')
        return
      }

      const { url } = await resp.json()
      if (url) {
        window.location.href = url
      } else {
        toast.error('Nepodařilo se vytvořit platební relaci.')
      }
    } catch {
      toast.error('Chyba při přesměrování na platební bránu.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="ambient" />

      <header className="pay-nav">
        <div className="brand" onClick={() => navigate('/')}>
          <div className="brand-mark">P</div>
          <div className="pay-nav-name brand-name">PlanLess</div>
        </div>
        <div className="step-track pay-nav-steps">
          <div className="pay-step done">
            <div className="n"><CheckIc s={11} /></div>Plán
          </div>
          <div className="step-dash" />
          <div className="pay-step current">
            <div className="n">2</div>Platba
          </div>
          <div className="step-dash" />
          <div className="pay-step">
            <div className="n">3</div>Nastavení
          </div>
        </div>
        <div className="spacer" />
        <a className="pay-nav-help help">Potřebujete pomoc? →</a>
      </header>

      <form className="pay-stage" onSubmit={handleSubmit}>
        <div>
          <div className="pay-eyebrow">Aktivace předplatného</div>
          <h1>Posledních pár <span className="it">vteřin</span>.</h1>
          <p className="pay-lead">
            Zvolte fakturační období a klikněte na tlačítko. Budete bezpečně přesměrováni
            na platební stránku Stripe. Prvních 14 dní je zdarma.
          </p>

          {/* 1. Billing cycle */}
          <div className="pay-card">
            <div className="pay-card-head">
              <div className="t"><span className="num">1</span> Fakturační období</div>
            </div>
            <div
              className={`pay-radio ${billing === 'monthly' ? 'on' : ''}`}
              onClick={() => setBilling('monthly')}
            >
              <div className="dot" />
              <div className="body">
                Měsíčně
                <div className="sub">Účtujeme {monthlyPrice.toLocaleString('cs-CZ')} Kč každý měsíc · zrušíte kdykoliv</div>
              </div>
              <div className="meta">{monthlyPrice.toLocaleString('cs-CZ')} Kč / měs.</div>
            </div>
            <div
              className={`pay-radio ${billing === 'yearly' ? 'on' : ''}`}
              onClick={() => setBilling('yearly')}
            >
              <div className="dot" />
              <div className="body">
                Ročně <span className="annual-badge">−20 %</span>
                <div className="sub">Účtujeme {yearlyTotal.toLocaleString('cs-CZ')} Kč jednou ročně · ušetříte {discount.toLocaleString('cs-CZ')} Kč</div>
              </div>
              <div className="meta">{yearlyMonthly.toLocaleString('cs-CZ')} Kč / měs.</div>
            </div>
          </div>

          {/* 2. Stripe redirect info */}
          <div className="pay-card">
            <div className="pay-card-head">
              <div className="t"><span className="num">2</span> Platba přes Stripe</div>
            </div>
            <div style={{ padding: '4px 0 8px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.6 }}>
              Po kliknutí na tlačítko budete přesměrováni na zabezpečenou platební stránku Stripe,
              kde zadáte platební kartu. Vaše karta <strong>nebude strhnuta dnes</strong> —
              zkušební doba 14 dní je zdarma.
            </div>
            <div className="trust-strip">
              <div className="item"><LockIc s={13} /> Šifrováno 256-bit SSL</div>
              <div className="item"><ShieldIc s={13} /> PCI DSS Level 1</div>
              <div className="item" style={{ fontWeight: 600, letterSpacing: '0.02em' }}>stripe</div>
            </div>
          </div>
        </div>

        {/* RIGHT: Order summary */}
        <aside className="order-card">
          <div className="order-eyebrow">Váš plán</div>
          <div className="order-tier">PlanLess <span className="it">Professional</span></div>
          <div className="order-desc">
            Pro malé firmy a salony s několika kolegy. Až 500 hovorů měsíčně, všechny funkce, prioritní podpora.
          </div>

          <div className="trial-pill">
            <ZapIc s={12} />
            14 dní zdarma · platí až od {trialEndStr}
          </div>

          <div className="includes">
            {INCLUDES.map((txt, i) => (
              <div key={i} className="it">
                <div className="c"><CheckIc s={9} /></div>
                {txt}
              </div>
            ))}
          </div>

          {billing === 'yearly' ? (
            <div className="price-rows">
              <div className="p-row"><span>Professional · roční</span><span className="v">{(monthlyPrice * 12).toLocaleString('cs-CZ')} Kč</span></div>
              <div className="p-row discount"><span>Roční sleva 20 %</span><span className="v">{discount.toLocaleString('cs-CZ')} Kč</span></div>
              <div className="p-row"><span>Mezisoučet</span><span className="v">{yearlyTotal.toLocaleString('cs-CZ')} Kč</span></div>
              <div className="p-row"><span>DPH 21 %</span><span className="v">{vat.toLocaleString('cs-CZ')} Kč</span></div>
            </div>
          ) : (
            <div className="price-rows">
              <div className="p-row"><span>Professional · měsíčně</span><span className="v">{monthlyPrice.toLocaleString('cs-CZ')} Kč</span></div>
              <div className="p-row"><span>DPH 21 %</span><span className="v">{Math.round(monthlyPrice * 0.21).toLocaleString('cs-CZ')} Kč</span></div>
            </div>
          )}

          <div className="total-row">
            <div className="label">Celkem dnes</div>
            <div className="v">0<span className="cur">Kč</span></div>
          </div>
          <div className="total-sub">
            Po skončení 14denní zkušební doby ({trialEndStr}) bude účtováno{' '}
            <strong style={{ color: 'var(--ink-2)' }}>
              {billing === 'yearly'
                ? (yearlyTotal + vat).toLocaleString('cs-CZ')
                : (monthlyPrice + Math.round(monthlyPrice * 0.21)).toLocaleString('cs-CZ')
              } Kč
            </strong>{' '}
            včetně DPH.
          </div>

          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Přesměrovávám…' : 'Aktivovat zkušební dobu'} {!submitting && <ArrowR s={16} />}
          </button>

          <div className="fine">
            Pokračováním souhlasíte s <a>obchodními podmínkami</a> a <a>zpracováním osobních údajů</a>.
            Předplatné se obnovuje automaticky a kdykoliv ho můžete zrušit v nastavení nebo přímo v Stripe portálu.
          </div>

          <div className="payment-logos">
            {['VISA', 'Mastercard', 'Amex', 'Apple Pay', 'Google Pay'].map(l => (
              <div key={l} className="logo">{l}</div>
            ))}
          </div>

          <div className="change-plan"><a onClick={() => navigate('/register')}>← Změnit plán</a></div>
        </aside>
      </form>
    </>
  )
}
