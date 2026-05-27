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
const CardIc   = (p) => <Ic {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></Ic>

function formatCardNum(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 16)
  return digits.match(/.{1,4}/g)?.join(' ') || ''
}

function detectBrand(num) {
  const n = num.replace(/\s/g, '')
  if (/^4/.test(n)) return 'VISA'
  if (/^5[1-5]/.test(n)) return 'MC'
  if (/^3[47]/.test(n)) return 'AMEX'
  return ''
}

function formatExpiry(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length > 2) return digits.slice(0, 2) + ' / ' + digits.slice(2)
  return digits
}

const INCLUDES = [
  'Až 500 hovorů / měsíc',
  'CZ, SK, EN, DE jazyky',
  'Rezervace + SMS + e-mail potvrzení',
  'Pokročilá pravidla a integrace',
  'Prioritní česká podpora',
]

export default function Payment() {
  const navigate = useNavigate()
  const [billing, setBilling] = useState('yearly')
  const [cardNum, setCardNum] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [cardHolder, setCardHolder] = useState('Svatopluk Velíšek')
  const [companyName, setCompanyName] = useState('Salon Svatopluk s.r.o.')
  const [email, setEmail] = useState('svatopluk@salon.cz')
  const [ico, setIco] = useState('08 415 290')
  const [dic, setDic] = useState('')
  const [street, setStreet] = useState('Dlouhá 21')
  const [city, setCity] = useState('Praha 1')
  const [zip, setZip] = useState('110 00')
  const [country, setCountry] = useState('CZ')

  const brand = detectBrand(cardNum)

  const monthlyPrice = 2490
  const yearlyMonthly = 1990
  const yearlyTotal = yearlyMonthly * 12
  const discount = monthlyPrice * 12 - yearlyTotal
  const vat = Math.round(yearlyTotal * 0.21)

  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 14)
  const trialEndStr = trialEnd.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) { navigate('/login'); return }

      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, is_subscribed: true }, { onConflict: 'id' })

      if (error) { toast.error('Chyba při aktivaci: ' + error.message); return }

      toast.success('Zkušební doba aktivována!')
      navigate('/app')
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
            Vyplňte fakturační údaje a kartu. Prvních 14 dní je zdarma — kartu strhneme až poté,
            a teprve s vaším výslovným souhlasem.
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

          {/* 2. Billing info */}
          <div className="pay-card">
            <div className="pay-card-head">
              <div className="t"><span className="num">2</span> Fakturační údaje</div>
            </div>
            <div className="pay-field-grid">
              <div className="pay-field full">
                <div className="pay-label">Název firmy / jméno</div>
                <input className="pay-input" type="text" placeholder="Salon Svatopluk s.r.o."
                  value={companyName} onChange={e => setCompanyName(e.target.value)} />
              </div>
              <div className="pay-field full">
                <div className="pay-label">E-mail pro faktury</div>
                <input className="pay-input" type="email" placeholder="ucetni@salon.cz"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="pay-field">
                <div className="pay-label">IČO</div>
                <input className="pay-input" type="text" placeholder="08 415 290"
                  value={ico} onChange={e => setIco(e.target.value)} />
              </div>
              <div className="pay-field">
                <div className="pay-label">DIČ <span className="opt">volitelné</span></div>
                <input className="pay-input" type="text" placeholder="CZ08415290"
                  value={dic} onChange={e => setDic(e.target.value)} />
              </div>
              <div className="pay-field full">
                <div className="pay-label">Adresa</div>
                <input className="pay-input" type="text" placeholder="Dlouhá 21"
                  value={street} onChange={e => setStreet(e.target.value)} />
              </div>
              <div className="pay-field">
                <div className="pay-label">Město</div>
                <input className="pay-input" type="text" placeholder="Praha 1"
                  value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div className="pay-field">
                <div className="pay-label">PSČ</div>
                <input className="pay-input" type="text" placeholder="110 00"
                  value={zip} onChange={e => setZip(e.target.value)} />
              </div>
              <div className="pay-field full">
                <div className="pay-label">Země</div>
                <select className="pay-select" value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="CZ">Česká republika</option>
                  <option value="SK">Slovenská republika</option>
                  <option value="PL">Polsko</option>
                  <option value="DE">Německo</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. Card */}
          <div className="pay-card">
            <div className="pay-card-head">
              <div className="t"><span className="num">3</span> Platební karta</div>
              <div className="pay-card-brands">
                <div className="brand-tag">VISA</div>
                <div className="brand-tag">MASTERCARD</div>
                <div className="brand-tag">AMEX</div>
              </div>
            </div>

            <div className="pay-field full">
              <div className="pay-label">Číslo karty</div>
              <div className="card-input-wrap">
                <input
                  className="pay-input mono"
                  type="text" placeholder="0000 0000 0000 0000"
                  value={cardNum}
                  style={brand ? { paddingRight: 70 } : {}}
                  onChange={e => setCardNum(formatCardNum(e.target.value))}
                />
                {brand && (
                  <div className="card-brands-detected">
                    <div className="brand-tag active">{brand}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="pay-field-grid">
              <div className="pay-field">
                <div className="pay-label">Platí do</div>
                <input className="pay-input mono" type="text" placeholder="MM / RR"
                  value={expiry} onChange={e => setExpiry(formatExpiry(e.target.value))} />
              </div>
              <div className="pay-field">
                <div className="pay-label">CVC <span className="opt">3 čísla</span></div>
                <input className="pay-input mono" type="text" placeholder="123" maxLength={4}
                  value={cvc} onChange={e => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
            </div>
            <div className="pay-field full">
              <div className="pay-label">Jméno na kartě</div>
              <input className="pay-input" type="text" placeholder="Vaše jméno"
                value={cardHolder} onChange={e => setCardHolder(e.target.value)} />
            </div>

            <div className="trust-strip">
              <div className="item"><LockIc s={13} /> Šifrováno 256-bit SSL</div>
              <div className="item"><ShieldIc s={13} /> PCI DSS Level 1</div>
              <div className="item"><CardIc s={13} /> Stripe</div>
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
            {submitting ? 'Aktivuji…' : 'Aktivovat zkušební dobu'} {!submitting && <ArrowR s={16} />}
          </button>

          <div className="fine">
            Pokračováním souhlasíte s <a>obchodními podmínkami</a> a <a>zpracováním osobních údajů</a>.
            Předplatné se obnovuje automaticky a kdykoliv ho můžete zrušit v nastavení.
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
