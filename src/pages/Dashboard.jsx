import { useState, useEffect, useCallback, useMemo } from 'react';
import { Icons as I, Wave } from '../components/Icons.jsx';
import '../styles/globals.css';
import './Dashboard.css';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchCalls } from '../lib/callsDb.js';
import { fetchCustomers, upsertCustomer, deleteCustomerByPhone } from '../lib/customersDb.js';
import { fetchServices, createService, updateService, deleteService } from '../lib/servicesDb.js';
import { fetchBookings } from '../lib/bookingsDb.js';
import { getCompanySettings, saveCompanySettings } from '../lib/companySettings.js';
import toast from 'react-hot-toast';

/* ============================================================
   Data
   ============================================================ */
const TODAY_STATS = { live: 1, booked: 8, missed: 1, attn: 2, totalCalls: 14, aiBookings: 7 };

let CALLS = [
  {
    id: 'c1', who: 'Klára Svobodová', phone: '+420 724 118 220', t: '14:52', rel: 'právě teď', live: true,
    sub: 'Rezervuje barvení + střih · pátek 10:00',
    outcome: { kind: 'live', label: 'Hovor právě probíhá', sub: 'Klára si rezervuje barvení + střih na pátek u Terezy', service: 'Barvení + střih', staff: 'Tereza', price: 1900, when: 'Pá 24. 4. v 10:00' },
    summary: 'Stálá klientka, alergie na amoniak (potvrzená). Vybírá pátek dopoledne, preferuje Terezu.',
    tags: ['VIP', 'rezervace', 'alergie'], vip: true,
  },
  {
    id: 'c2', who: 'Marek Dvořák', phone: '+420 607 221 668', t: '14:31', rel: 'před 21 min', status: 'booked',
    sub: 'Pánský střih · pondělí 17:00',
    outcome: { kind: 'booking', label: 'Rezervace vytvořena', sub: 'Pánský střih · Po 27. 4. v 17:00 u Lucie', service: 'Pánský střih', staff: 'Lucie', price: 450, when: 'Po 27. 4. v 17:00' },
    summary: 'Pravidelný klient, žádné komplikace. AI nabídla 3 termíny, vybral si pondělní podvečer.',
    tags: ['rezervace'],
  },
  {
    id: 'c3', who: 'Neznámé číslo', phone: '+420 608 441 902', t: '13:08', rel: 'před 2 h', status: 'new',
    sub: 'Nová klientka · dámský střih',
    outcome: { kind: 'booking', label: 'Nová klientka — rezervace', sub: 'Střih dámský · Út 28. 4. v 16:30', service: 'Dámský střih', staff: 'Lucie', price: 650, when: 'Út 28. 4. v 16:30' },
    summary: 'Klientka našla salon přes Google. AI vytvořila profil, ověřila telefonní číslo, rezervovala střih.',
    tags: ['nový klient', 'rezervace'],
  },
  {
    id: 'c4', who: 'Jana Horáková', phone: '+420 775 103 211', t: '11:44', rel: 'dopoledne', status: 'resched',
    sub: 'Přesun rezervace · pátek → čtvrtek',
    outcome: { kind: 'resched', label: 'Přesunutá rezervace', sub: 'Střih · z Pá 24. 4. 15:00 → Čt 23. 4. 11:00' },
    summary: 'Klientka má v pátek pracovní cestu. AI nabídla 3 alternativy, vybrala čtvrtek dopoledne.',
    tags: ['přesun'],
  },
  {
    id: 'c5', who: 'Ondřej Novák', phone: '+420 602 734 556', t: '10:17', rel: 'dopoledne', status: 'info',
    sub: 'Dotaz na ceník · odpověděla AI',
    outcome: { kind: 'info', label: 'Dotaz vyřízen', sub: 'AI poslala ceník pánských služeb SMS' },
    summary: 'Dotaz na ceny pánských služeb. AI poslala ceník, nabídla rezervaci. Klient zatím nereagoval.',
    tags: ['info'],
  },
  {
    id: 'c6', who: 'Neznámé číslo', phone: '+420 733 882 104', t: '09:42', rel: 'ráno', status: 'missed',
    sub: 'Klient nezanechal vzkaz',
    outcome: { kind: 'missed', label: 'Volajícího se nepodařilo zachytit', sub: 'Hovor 9:42, AI požádala o vzkaz, klient zavěsil' },
    summary: 'Krátký hovor, klient nereagoval na pozdrav, zavěsil po 4 vteřinách. Doporučujeme zavolat zpět.',
    tags: ['mimo dobu'],
  },
  {
    id: 'c7', who: 'Tereza Malá', phone: '+420 728 451 990', t: 'včera 16:40', rel: 'včera', status: 'cancel',
    sub: 'Zrušení · pondělí 14:00',
    outcome: { kind: 'cancel', label: 'Zrušená rezervace', sub: 'Střih · Po 20. 4. 14:00' },
    summary: 'Klientka zrušila kvůli nemoci. AI nabídla alternativní termín příští týden — neobjednala.',
    tags: ['zrušeno'],
  },
];

const TRANSCRIPT = [
  { t: '00:00', who: 'ai',     text: 'Dobrý den, salon Svatopluk, Nikola u telefonu. Jak vám mohu pomoci?' },
  { t: '00:04', who: 'client', text: 'Dobrý den, Klára Svobodová. Chtěla bych se objednat na barvení.' },
  { t: '00:09', who: 'ai',     text: 'Ráda vás slyším, paní Svobodová. Máte u nás zaznamenanou alergii na amoniak — platí to pořád?' },
  { t: '00:14', who: 'client', text: 'Ano, prosím bez amoniaku.' },
  { t: '00:18', who: 'ai',     text: 'Poznamenáno. Preferujete jako minule u Terezy?' },
  { t: '00:21', who: 'client', text: 'Ano, Tereza prosím. Nejlépe tento pátek dopoledne.' },
  { t: '00:27', who: 'ai',     text: 'Pátek 24. dubna u Terezy — volno je v 10:00 nebo 13:30. Přidat i střih?' },
  { t: '00:34', who: 'client', text: 'Deset ráno a ano, i střih. Děkuju.' },
];

let CLIENTS = [
  { id: 'u1', name: 'Klára Svobodová',   phone: '+420 724 118 220', visits: 14, last: 'dnes',          vip: true, ini: 'KS', spend: 32400, fav: 'Barvení + střih',       note: 'Alergie na amoniak. Preferuje Terezu, vždy ráno.' },
  { id: 'u2', name: 'Marek Dvořák',      phone: '+420 607 221 668', visits: 8,  last: 'dnes',                     ini: 'MD', spend: 5800,  fav: 'Pánský střih' },
  { id: 'u3', name: 'Jana Horáková',     phone: '+420 775 103 211', visits: 8,  last: 'před 2 týdny',             ini: 'JH', spend: 11200, fav: 'Dámský střih',           note: 'Často přesouvá termíny.' },
  { id: 'u4', name: 'Ondřej Novák',      phone: '+420 602 734 556', visits: 22, last: 'dnes',          vip: true, ini: 'ON', spend: 28900, fav: 'Pánský střih + vousy',   note: 'Kafe černé, bez cukru.' },
  { id: 'u5', name: 'Tereza Malá',       phone: '+420 728 451 990', visits: 6,  last: 'před měsícem',             ini: 'TM', spend: 4800,  fav: 'Střih' },
  { id: 'u6', name: 'Lenka Procházková', phone: '+420 604 229 117', visits: 11, last: 'před týdnem',              ini: 'LP', spend: 14800, fav: 'Melír' },
  { id: 'u7', name: 'Adéla Vávrová',     phone: '+420 778 556 302', visits: 2,  last: 'před 2 měsíci',            ini: 'AV', spend: 1700,  fav: 'Foukaná' },
  { id: 'u8', name: 'Petr Kolář',        phone: '+420 603 887 441', visits: 19, last: 'před týdnem',   vip: true, ini: 'PK', spend: 24500, fav: 'Pánský střih' },
];

let SERVICES = [
  { id: 's1',  name: 'Dámský střih',         cat: 'Střih',   d: 45,  p: 650,  st: ['Tereza', 'Lucie'],  on: true,  b: 48 },
  { id: 's2',  name: 'Pánský střih',         cat: 'Střih',   d: 30,  p: 450,  st: ['Lucie', 'Honza'],   on: true,  b: 62 },
  { id: 's3',  name: 'Pánský střih + vousy', cat: 'Střih',   d: 45,  p: 650,  st: ['Honza'],            on: true,  b: 31 },
  { id: 's4',  name: 'Dětský střih',         cat: 'Střih',   d: 30,  p: 350,  st: ['Tereza', 'Lucie'],  on: true,  b: 14 },
  { id: 's5',  name: 'Barvení — krátké',     cat: 'Barvení', d: 90,  p: 1400, st: ['Tereza'],           on: true,  b: 22 },
  { id: 's6',  name: 'Barvení — dlouhé',     cat: 'Barvení', d: 120, p: 1900, st: ['Tereza'],           on: true,  b: 17 },
  { id: 's7',  name: 'Melír',                cat: 'Barvení', d: 120, p: 2200, st: ['Tereza'],           on: true,  b: 9  },
  { id: 's8',  name: 'Balayage',             cat: 'Barvení', d: 180, p: 3400, st: ['Tereza'],           on: true,  b: 5  },
  { id: 's9',  name: 'Foukaná',              cat: 'Styling', d: 30,  p: 450,  st: ['Tereza', 'Lucie'],  on: true,  b: 28 },
  { id: 's10', name: 'Slavnostní účes',      cat: 'Styling', d: 90,  p: 1800, st: ['Tereza'],           on: false, b: 2  },
];

const WEEK = [
  { s: 'Po', d: 21 }, { s: 'Út', d: 22 }, { s: 'St', d: 23 },
  { s: 'Čt', d: 24 }, { s: 'Pá', d: 25 }, { s: 'So', d: 26 }, { s: 'Ne', d: 27 },
];
const TODAY_COL = 1; // Út

let EVENTS = [
  { col: 0, s: 9,    e: 10,    t: 'Lenka P. — Foukaná',          who: 'Lucie' },
  { col: 0, s: 10.5, e: 12,    t: 'Klára S. — Melír',            who: 'Tereza',  c: 'green' },
  { col: 0, s: 14,   e: 14.75, t: 'Walk-in — Pánský',            who: 'Honza',   c: 'info' },
  { col: 1, s: 9,    e: 9.5,   t: 'Marek D. — Pánský',           who: 'Lucie' },
  { col: 1, s: 10,   e: 10.75, t: 'Ondřej N. — Střih+vousy',     who: 'Honza' },
  { col: 1, s: 11.5, e: 12.25, t: 'Adéla V. — Foukaná',          who: 'Tereza',  c: 'info' },
  { col: 1, s: 14,   e: 15.5,  t: 'Jana H. — Barvení',           who: 'Tereza',  c: 'green' },
  { col: 1, s: 16.5, e: 17.25, t: 'Nová — Střih',                who: 'Lucie' },
  { col: 2, s: 9.5,  e: 11.5,  t: 'Balayage — Petra N.',         who: 'Tereza',  c: 'green' },
  { col: 2, s: 13,   e: 13.5,  t: 'Pánský — Karel Š.',           who: 'Honza' },
  { col: 2, s: 15,   e: 16,    t: 'Melír — Zuzana K.',           who: 'Tereza',  c: 'green' },
  { col: 3, s: 9,    e: 10.5,  t: 'Jana H. — Střih (přesun)',    who: 'Tereza',  c: 'warn' },
  { col: 3, s: 11,   e: 11.75, t: 'Střih — Eva Š.',              who: 'Lucie' },
  { col: 3, s: 14.5, e: 15.25, t: 'Střih — Tomáš R.',            who: 'Honza' },
  { col: 4, s: 10,   e: 12,    t: 'Klára S. — Barvení+střih',    who: 'Tereza',  c: 'green' },
  { col: 4, s: 13,   e: 13.5,  t: 'Pánský — Jan V.',             who: 'Honza' },
  { col: 4, s: 15,   e: 16.5,  t: 'Melír — Martina O.',          who: 'Tereza',  c: 'green' },
  { col: 4, s: 17,   e: 17.5,  t: 'Marek D. — Pánský',           who: 'Lucie' },
  { col: 5, s: 9,    e: 10,    t: 'Foukaná — Lenka P.',          who: 'Lucie' },
  { col: 5, s: 10.5, e: 12,    t: 'Slavnostní účes',             who: 'Tereza',  c: 'info' },
  { col: 1, s: 13,   e: 13.75, t: 'AI navrhuje · Petr K.',       who: 'volný slot', ai: true },
];

/* ============================================================
   Utilities
   ============================================================ */
const cx = (...a) => a.filter(Boolean).join(' ');
const fmtPrice = (n) => n.toLocaleString('cs-CZ') + ' Kč';
const fmtTime = (h) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return hh + ':' + String(mm).padStart(2, '0');
};
const getInitials = (name) =>
  name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('');

/* ============================================================
   Atoms
   ============================================================ */
const Avatar = ({ ini, size = '', vip = false }) => (
  <div className={cx('av', size, vip && 'vip')}>{ini}</div>
);

const Tag = ({ children, variant = '' }) => (
  <span className={cx('tag', variant && 'tag-' + variant)}>{children}</span>
);

const Btn = ({ children, variant = '', size = '', icon: Ico, onClick, style, disabled, ...p }) => (
  <button
    className={cx('btn', variant && 'btn-' + variant, size && 'btn-' + size)}
    onClick={onClick}
    style={style}
    disabled={disabled}
    {...p}
  >
    {Ico && <Ico />}
    {children}
  </button>
);

const Seg = ({ items, value, onChange }) => (
  <div className="seg">
    {items.map((it) => (
      <button key={it.v} className={cx(value === it.v && 'on')} onClick={() => onChange(it.v)}>
        {it.l}
      </button>
    ))}
  </div>
);

const Switch = ({ on, onChange }) => (
  <div className={cx('sw', on && 'on')} onClick={() => onChange(!on)} />
);

/* ============================================================
   Nav config
   ============================================================ */
const NAV = [
  { id: 'today',    label: 'Dnes',     icon: I.Today },
  { id: 'inbox',    label: 'Hovory',   icon: I.Inbox, badge: true },
  { id: 'calendar', label: 'Kalendář', icon: I.Calendar },
  { id: 'clients',  label: 'Klienti',  icon: I.Users },
  { id: 'services', label: 'Služby',   icon: I.Scissors },
];

/* ============================================================
   Rail
   ============================================================ */
const Rail = ({ nav, setNav, onSignOut }) => (
  <aside className="rail">
    <div className="mark">P</div>
    <nav className="rail-nav">
      {NAV.map((n) => {
        const Ico = n.icon;
        return (
          <div key={n.id} className={cx('rail-item', nav === n.id && 'on')} onClick={() => setNav(n.id)}>
            <Ico s={18} />
            {n.badge && <span className="dot" />}
            <span className="lbl">{n.label}</span>
          </div>
        );
      })}
    </nav>
    <div className="rail-foot">
      <div className={cx('rail-item', nav === 'settings' && 'on')} onClick={() => setNav('settings')}>
        <I.Settings s={18} />
        <span className="lbl">Nastavení</span>
      </div>
      <div className="rail-item" title="Odhlásit se" onClick={onSignOut} style={{ cursor: 'pointer' }}>
        <I.LogOut s={18} />
        <span className="lbl">Odhlásit</span>
      </div>
    </div>
  </aside>
);

/* ============================================================
   Dock (topbar)
   ============================================================ */
const AiPres = ({ aiOn }) => (
  <div className="ai-pres" title={aiOn ? 'AI Nikola má službu' : 'AI je pozastavená'}>
    <div className="av">N</div>
    <div className="lbl">
      <div className="who row gap-2" style={{ alignItems: 'center' }}>
        Nikola
        {aiOn
          ? <span style={{ color: 'var(--live)' }}><Wave size={11} /></span>
          : <span className="tag tag-warn" style={{ padding: '1px 7px', fontSize: 10 }}>pauza</span>}
      </div>
      <div className="sub">{aiOn ? 'má službu · poslouchá' : 'pozastavená'}</div>
    </div>
  </div>
);

const Dock = ({ title, crumb, right, aiOn }) => (
  <header className="dock">
    <div className="col">
      <div className="dock-title">{title}</div>
      {crumb && <div className="dock-crumb">{crumb}</div>}
    </div>
    <div className="spacer" />
    {right}
    <AiPres aiOn={aiOn} />
  </header>
);

/* ============================================================
   Today view
   ============================================================ */
const TodayView = () => {
  const liveCall = CALLS.find((c) => c.live);
  const upcoming = EVENTS.filter((e) => e.col === TODAY_COL && e.s >= 14.5).slice(0, 4);
  const attn = CALLS.filter((c) => ['missed', 'resched'].includes(c.status));

  return (
    <div className="col gap-6">
      <div className="hero-card">
        <div className="hero-text">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Úterý 22. dubna · 14:52</div>
          <div className="greet">
            Dobré odpoledne, <span className="it">Svatopluku</span>.<br />
            Nikola dnes vyřídila <span className="it">{TODAY_STATS.totalCalls} hovorů</span><br />
            a získala <span className="it">{TODAY_STATS.aiBookings} rezervací</span>.
          </div>
          <div className="muted" style={{ fontSize: 14, marginTop: 14, maxWidth: 540, lineHeight: 1.55 }}>
            Vše je v pořádku. Dvě věci čekají na vaši pozornost — zmeškaný hovor a žádost o přesun.
          </div>
        </div>
        <div className="kpi-row">
          <div className="kpi accent">
            <div className="n">{TODAY_STATS.live}</div>
            <div className="l">právě v hovoru</div>
          </div>
          <div className="kpi">
            <div className="n">{TODAY_STATS.booked}</div>
            <div className="l">rezervací dnes</div>
          </div>
          <div className="kpi">
            <div className="n">{TODAY_STATS.attn}</div>
            <div className="l">k pozornosti</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: liveCall ? '1.1fr 1fr' : '1fr', gap: 24 }}>
        {liveCall && (
          <div className="live-card">
            <div className="hd">
              <div style={{ position: 'relative' }}>
                <Avatar ini="KS" size="md" vip />
                <div className="pulse" style={{ position: 'absolute', inset: -3, pointerEvents: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="name">{liveCall.who}</div>
                <div className="ph">{liveCall.phone}</div>
              </div>
              <Tag variant="live"><Wave size={9} />LIVE</Tag>
            </div>
            <div className="what">
              <div className="lab">Co Nikola právě řeší</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                Domlouvá <strong>barvení + střih</strong> na <strong>pátek 10:00 u Terezy</strong>. Alergie na amoniak je potvrzená v profilu.
              </div>
            </div>
            <div className="row gap-2">
              <Btn variant="accent" icon={I.Volume} size="sm">Poslouchat živě</Btn>
              <Btn variant="ghost" icon={I.PhoneOff} size="sm">Převzít</Btn>
            </div>
          </div>
        )}

        <div className="card">
          <div className="section-hd">
            <div>
              <div className="eyebrow">Zbytek odpoledne</div>
              <div className="h-section" style={{ marginTop: 8, fontSize: 18 }}>Co vás dnes čeká</div>
            </div>
            <Btn variant="ghost" size="sm">Celý kalendář</Btn>
          </div>
          <div className="col gap-3">
            {upcoming.map((e, i) => (
              <div key={i} className="row gap-3" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--accent)', minWidth: 64 }}>{fmtTime(e.s)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{e.t}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{e.who} · {fmtTime(e.e)} konec</div>
                </div>
                <Btn variant="ghost" size="sm" icon={I.MoreH} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {attn.length > 0 && (
        <div>
          <div className="section-hd">
            <div>
              <div className="eyebrow">Vyžaduje pozornost</div>
              <div className="h-section" style={{ marginTop: 8 }}>{attn.length} věci, na které byste se měl/a podívat</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            {attn.map((c) => (
              <div key={c.id} className="card thin">
                <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    {c.status === 'missed' ? <I.PhoneOff s={14} /> : <I.Clock s={14} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.outcome.label}</div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{c.outcome.sub}</div>
                    <div className="row gap-2" style={{ marginTop: 10 }}>
                      <Btn size="sm">Otevřít</Btn>
                      {c.status === 'missed' && <Btn variant="ghost" size="sm" icon={I.Phone}>Zavolat zpět</Btn>}
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card lg" style={{ background: 'linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--paper)', borderColor: 'var(--accent-ring)' }}>
        <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
          <div className="ai-pres" style={{ padding: 4, borderRadius: 50 }}>
            <div className="av" style={{ width: 40, height: 40, fontSize: 14 }}>N</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Nikola si všimla</div>
            <div className="h-section" style={{ fontSize: 18, marginBottom: 8 }}>
              Pátek je <span className="serif-it" style={{ color: 'var(--accent)' }}>vyprodaný</span>. Sobota má 4 volná místa dopoledne.
            </div>
            <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 640 }}>
              Když budou klienti volat na pátek, automaticky jim nabídnu sobotu. Pokud chcete, můžeme oslovit 3 stálé klientky, které obvykle chodí v pátek — pošlu jim SMS s nabídkou.
            </div>
            <div className="row gap-2" style={{ marginTop: 16 }}>
              <Btn variant="accent" size="sm">Poslat SMS klientkám</Btn>
              <Btn variant="ghost" size="sm">Zatím ne</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   Inbox view
   ============================================================ */
const STATUS_META = {
  live:    { label: 'Probíhá',       v: 'live'   },
  booked:  { label: 'Rezervace',     v: 'accent' },
  new:     { label: 'Nová klientka', v: 'accent' },
  resched: { label: 'Přesunuto',     v: 'warn'   },
  info:    { label: 'Info',          v: 'info'   },
  missed:  { label: 'Zmeškáno',      v: 'bad'    },
  cancel:  { label: 'Zrušeno',       v: ''       },
};

const callStatus = (c) => c.live ? 'live' : (c.status || 'booked');

const CallRow = ({ call, on, onClick }) => {
  const st = STATUS_META[callStatus(call)];
  const ini = getInitials(call.who);
  return (
    <div className={cx('row-call', on && 'on')} onClick={onClick}>
      <Avatar ini={ini} size="sm" vip={call.vip} />
      <div style={{ minWidth: 0 }}>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <div className="who">{call.who}</div>
          {call.live && <span style={{ color: 'var(--live)' }}><Wave size={10} /></span>}
        </div>
        <div className="sub">{call.sub}</div>
      </div>
      <div className="right">
        <div className="t">{call.t}</div>
        <Tag variant={st.v}><span className="d" />{st.label}</Tag>
      </div>
    </div>
  );
};

const TranscriptTurn = ({ turn }) => (
  <div className="tr-turn">
    <div className="tr-meta">{turn.t}</div>
    <div>
      <div className="tr-label">{turn.who === 'ai' ? '— Nikola' : '— Klientka'}</div>
      <div className={cx('tr-bubble', turn.who === 'ai' ? 'ai' : 'client')}>{turn.text}</div>
    </div>
  </div>
);

const CallDetail = ({ call }) => {
  if (!call) return null;
  const o = call.outcome;
  return (
    <div className="detail">
      <div className="detail-hd">
        <div className="row gap-4" style={{ alignItems: 'center', marginBottom: 18 }}>
          <Avatar ini={getInitials(call.who)} size="lg" vip={call.vip} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="h-display" style={{ fontSize: 28 }}>{call.who}</div>
              {call.vip && <Tag variant="accent"><I.StarF s={10} />VIP</Tag>}
              {call.live && <Tag variant="live"><span className="d" />LIVE · 0:42</Tag>}
            </div>
            <div className="row gap-3 muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              <span className="mono">{call.phone}</span>
              <span>·</span>
              <span>{call.rel}</span>
            </div>
          </div>
          <div className="row gap-2">
            <Btn icon={I.Phone} size="sm">Zavolat zpět</Btn>
            <Btn icon={I.Message} size="sm">SMS</Btn>
            <Btn variant="ghost" icon={I.MoreH} size="sm" />
          </div>
        </div>

        <div className={cx('outcome', call.live && 'live')}>
          <div className="ic">
            {o.kind === 'live'    && <I.Phone s={16} />}
            {o.kind === 'booking' && <I.Calendar s={16} />}
            {o.kind === 'resched' && <I.Clock s={16} />}
            {o.kind === 'info'    && <I.Message s={16} />}
            {o.kind === 'missed'  && <I.PhoneOff s={16} />}
            {o.kind === 'cancel'  && <I.X s={16} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{o.label}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>{o.sub}</div>
            {(o.kind === 'booking' || o.kind === 'live') && (
              <div className="row gap-2" style={{ marginTop: 12 }}>
                <Btn size="sm">Otevřít v kalendáři</Btn>
                <Btn variant="ghost" icon={I.Edit} size="sm">Upravit</Btn>
              </div>
            )}
            {o.kind === 'missed' && (
              <Btn size="sm" icon={I.Phone} style={{ marginTop: 12 }}>Zavolat zpět</Btn>
            )}
            {o.kind === 'resched' && (
              <Btn size="sm" style={{ marginTop: 12 }}>Zobrazit nový termín</Btn>
            )}
          </div>
        </div>
      </div>

      <div className="detail-body">
        <div style={{ marginBottom: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Nikolino shrnutí</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink)' }}>{call.summary}</div>
          <div className="row gap-2" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            {call.tags.map((t) => <Tag key={t}>#{t}</Tag>)}
          </div>
        </div>

        {(o.service || o.when) && (
          <div style={{ marginBottom: 28 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Detail rezervace</div>
            <div className="kv">
              {o.service && (<><div className="k">Služba</div><div className="v">{o.service}</div></>)}
              {o.when    && (<><div className="k">Termín</div><div className="v">{o.when}</div></>)}
              {o.staff   && (<><div className="k">Kolega/yně</div><div className="v">{o.staff}</div></>)}
              {o.price   && (<><div className="k">Cena</div><div className="v mono">{fmtPrice(o.price)}</div></>)}
            </div>
          </div>
        )}

        {call.live && (
          <div>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="eyebrow">
                Přepis hovoru <span style={{ color: 'var(--live)', marginLeft: 10 }}><Wave size={11} /> živě</span>
              </div>
              <div className="row gap-2">
                <Btn variant="ghost" icon={I.Volume} size="sm">Poslouchat</Btn>
                <Btn variant="ghost" icon={I.Download} size="sm">Stáhnout</Btn>
              </div>
            </div>
            <div className="tr">
              {TRANSCRIPT.map((t, i) => <TranscriptTurn key={i} turn={t} />)}
              <div className="tr-turn">
                <div className="tr-meta" style={{ color: 'var(--accent)' }}>00:42</div>
                <div>
                  <div className="tr-label" style={{ color: 'var(--accent)' }}>— Nikola odpovídá</div>
                  <div className="tr-bubble ai" style={{ color: 'var(--ink-3)', fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Wave size={11} /> rezervuji…
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TodayHero = () => {
  const liveCall = CALLS.find((c) => c.live);
  return (
    <div className="today-hero">
      <div className="hero-card">
        <div className="hero-text">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Úterý 22. dubna · 14:52</div>
          <div className="greet">
            Dobré odpoledne, <span className="it">Svatopluku</span>.<br />
            Nikola dnes vyřídila <span className="it">{TODAY_STATS.totalCalls} hovorů</span> a získala <span className="it">{TODAY_STATS.aiBookings} rezervací</span>.
          </div>
          <div className="muted" style={{ fontSize: 14, marginTop: 14, maxWidth: 540, lineHeight: 1.55 }}>
            Vše je v pořádku. Dvě věci čekají na vaši pozornost — zmeškaný hovor a žádost o přesun.
          </div>
        </div>
        <div className="kpi-row">
          <div className="kpi accent">
            <div className="n">{TODAY_STATS.live}</div>
            <div className="l">právě teď v hovoru</div>
          </div>
          <div className="kpi">
            <div className="n">{TODAY_STATS.booked}</div>
            <div className="l">nových rezervací dnes</div>
          </div>
          <div className="kpi">
            <div className="n">{TODAY_STATS.attn}</div>
            <div className="l">potřebují pozornost</div>
          </div>
        </div>
      </div>

      {liveCall && (
        <div className="live-card">
          <div className="hd">
            <div style={{ position: 'relative' }}>
              <Avatar ini="KS" size="md" vip />
              <div className="pulse" style={{ position: 'absolute', inset: -3, pointerEvents: 'none' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{liveCall.who}</div>
              <div className="ph">{liveCall.phone}</div>
            </div>
            <Tag variant="live"><span className="d" /><Wave size={9} /> LIVE</Tag>
          </div>
          <div className="what">
            <div className="lab">Co se právě děje</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              Nikola domlouvá <strong>barvení + střih</strong> na <strong>pátek 10:00 u Terezy</strong>. Klientka má alergii na amoniak (potvrzeno).
            </div>
          </div>
          <div className="row gap-2">
            <Btn variant="accent" icon={I.Volume} size="sm">Poslouchat živě</Btn>
            <Btn variant="ghost" icon={I.PhoneOff} size="sm">Převzít hovor</Btn>
          </div>
        </div>
      )}
    </div>
  );
};

const InboxView = ({ selId, setSelId }) => {
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => {
    if (filter === 'all') return CALLS;
    if (filter === 'attn') return CALLS.filter((c) => ['missed', 'resched', 'cancel'].includes(c.status));
    if (filter === 'book') return CALLS.filter((c) => c.live || c.status === 'booked' || c.status === 'new');
    if (filter === 'missed') return CALLS.filter((c) => c.status === 'missed');
    return CALLS;
  }, [filter]);
  const sel = CALLS.find((c) => c.id === selId) || CALLS[0];

  return (
    <div>
      <TodayHero />
      <div className="section-hd">
        <div>
          <div className="eyebrow">Záznamy</div>
          <div className="h-section" style={{ marginTop: 8 }}>Všechny hovory</div>
        </div>
        <div className="row gap-2">
          <Seg
            items={[
              { v: 'all',    l: 'Vše' },
              { v: 'book',   l: 'Rezervace' },
              { v: 'attn',   l: 'Pozornost' },
              { v: 'missed', l: 'Zmeškané' },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </div>

      <div className="inbox">
        <div className="list">
          <div className="list-hd">
            <div className="field">
              <I.Search />
              <input placeholder="Hledat v přepisech, jménech, číslech…" />
              <span className="kbd">⌘K</span>
            </div>
          </div>
          <div className="list-body">
            {filtered.map((c) => (
              <CallRow key={c.id} call={c} on={sel?.id === c.id} onClick={() => setSelId(c.id)} />
            ))}
          </div>
        </div>
        <CallDetail call={sel} />
      </div>
    </div>
  );
};

/* ============================================================
   Calendar view
   ============================================================ */
const CalendarView = ({ aiOn }) => {
  const [staff, setStaff] = useState('all');
  const [view, setView] = useState('week');
  const ROW_H = 60;
  const START_H = 9;
  const END_H = 19;
  const hours = [];
  for (let h = START_H; h <= END_H; h++) hours.push(h);

  const now = 14 + 52 / 60;
  const nowTop = (now - START_H) * ROW_H;

  const events = EVENTS.filter((e) => staff === 'all' || e.who.toLowerCase().includes(staff));

  return (
    <div>
      <div className="cal-toolbar">
        <div className="row gap-3" style={{ alignItems: 'center' }}>
          <Btn variant="ghost" icon={I.ChevLeft} size="sm" />
          <div className="cal-month">Duben <span className="it">2026</span></div>
          <Btn variant="ghost" icon={I.ChevRight} size="sm" />
          <Btn variant="ghost" size="sm">Dnes</Btn>
        </div>
        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <Seg
            items={[{ v: 'day', l: 'Den' }, { v: 'week', l: 'Týden' }, { v: 'month', l: 'Měsíc' }]}
            value={view}
            onChange={setView}
          />
          <Seg
            items={[{ v: 'all', l: 'Všichni' }, { v: 'tereza', l: 'Tereza' }, { v: 'lucie', l: 'Lucie' }, { v: 'honza', l: 'Honza' }]}
            value={staff}
            onChange={setStaff}
          />
          <Btn variant="accent" icon={I.Plus} size="sm">Nová rezervace</Btn>
        </div>
      </div>

      {aiOn && (
        <div className="ai-banner">
          <div className="av" style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 12, display: 'grid', placeItems: 'center' }}>N</div>
          <div className="body">
            <span className="it">Nikola</span> navrhuje rezervaci v <strong>úterý 13:00 u Lucie</strong> pro Petra K. — viděla v jeho historii vzor.
          </div>
          <Btn variant="ghost" size="sm">Zamítnout</Btn>
          <Btn size="sm" variant="accent">Přijmout</Btn>
        </div>
      )}

      <div className="cal">
        <div className="cal-h gut" />
        {WEEK.map((w, i) => (
          <div key={i} className={cx('cal-h', i === TODAY_COL && 'today')}>
            <div>{w.s}</div>
            <div className="d">{w.d}</div>
          </div>
        ))}

        <div className="cal-rail">
          {hours.map((h) => <div key={h} className="cal-row-time">{h}:00</div>)}
        </div>

        {WEEK.map((w, col) => {
          const dim = col === 6;
          return (
            <div key={col} className={cx('cal-col', dim && 'dim')}>
              {hours.map((h) => <div key={h} className="cal-cell" />)}
              {events.filter((e) => e.col === col).map((e, i) => {
                const top = (e.s - START_H) * ROW_H;
                const height = (e.e - e.s) * ROW_H - 4;
                return (
                  <div
                    key={i}
                    className={cx('evt', e.c, e.ai && 'ai-suggest')}
                    style={{ top, height }}
                  >
                    <div className="t">{e.t}</div>
                    <div className="s">{fmtTime(e.s)}–{fmtTime(e.e)} · {e.who}</div>
                  </div>
                );
              })}
              {col === TODAY_COL && (
                <div className="now-line" style={{ top: nowTop }}>
                  <div className="ball" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row gap-4" style={{ marginTop: 18, flexWrap: 'wrap' }}>
        <Tag variant="accent"><span className="d" />Standardní rezervace</Tag>
        <Tag variant="live"><span className="d" />Barvení / dlouhé</Tag>
        <Tag variant="warn"><span className="d" />Přesunuté</Tag>
        <Tag variant="info"><span className="d" />Styling / účes</Tag>
        <Tag><span className="d" style={{ background: 'var(--accent)' }} />Návrh AI (čekací)</Tag>
      </div>
    </div>
  );
};

/* ============================================================
   Clients view
   ============================================================ */
const ClientRow = ({ c, on, onClick }) => (
  <div className={cx('client-row', on && 'on')} onClick={onClick}>
    <Avatar ini={c.ini} vip={c.vip} />
    <div style={{ minWidth: 0 }}>
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <div className="nm">{c.name}</div>
        {c.vip && <I.StarF s={10} style={{ color: 'var(--accent)' }} />}
      </div>
      <div className="sb">{c.visits} návštěv · {c.last}</div>
    </div>
  </div>
);

const ClientsView = () => {
  const [sel, setSel] = useState('u1');
  const [q, setQ] = useState('');
  const filtered = q ? CLIENTS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : CLIENTS;
  const client = CLIENTS.find((c) => c.id === sel) || CLIENTS[0];

  return (
    <div className="clients">
      <div className="list">
        <div className="list-hd">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="h-section" style={{ fontSize: 18 }}>Klienti</div>
            <Btn variant="ghost" icon={I.Plus} size="sm" />
          </div>
          <div className="field">
            <I.Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat…" />
          </div>
        </div>
        <div className="list-body">
          {filtered.map((c) => (
            <ClientRow key={c.id} c={c} on={sel === c.id} onClick={() => setSel(c.id)} />
          ))}
        </div>
      </div>

      <div className="profile">
        <div className="card lg">
          <div className="profile-hd">
            <Avatar ini={client.ini} size="xl" vip={client.vip} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">
                {client.name}
                {client.vip && <span className="it">VIP</span>}
              </div>
              <div className="row gap-4 muted" style={{ fontSize: 13, marginTop: 10, flexWrap: 'wrap' }}>
                <span className="row gap-2"><I.Phone s={12} /><span className="mono">{client.phone}</span></span>
                <span className="row gap-2"><I.Clock s={12} />Poslední: {client.last}</span>
                <span className="row gap-2"><I.Scissors s={12} />{client.fav}</span>
              </div>
            </div>
            <div className="row gap-2">
              <Btn icon={I.Phone} size="sm">Zavolat</Btn>
              <Btn variant="accent" icon={I.Plus} size="sm">Rezervovat</Btn>
            </div>
          </div>
          {client.note && (
            <div className="note" style={{ marginTop: 22 }}>
              <div className="ic"><I.Sparkle s={16} /></div>
              <div className="body"><strong>Co si Nikola pamatuje:</strong> {client.note}</div>
            </div>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat"><div className="n">{client.visits}</div><div className="l">návštěv celkem</div></div>
          <div className="stat"><div className="n">{fmtPrice(client.spend)}</div><div className="l">útrata u vás</div></div>
          <div className="stat"><div className="n">42 <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>dní</span></div><div className="l">průměr mezi návštěvami</div></div>
          <div className="stat"><div className="n">98 <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>%</span></div><div className="l">dochvilnost</div></div>
        </div>

        <div className="card">
          <div className="section-hd">
            <div className="h-section" style={{ fontSize: 18 }}>Aktivita</div>
            <Btn variant="ghost" size="sm">Zobrazit vše</Btn>
          </div>
          <div className="tl">
            <div className="tl-item">
              <div className="tl-d accent"><I.Calendar /></div>
              <div className="tl-t">Rezervace vytvořena</div>
              <div className="tl-x">Barvení + střih · Pá 24. 4. v 10:00 · Tereza · 1 900 Kč</div>
              <div className="tl-w">dnes 14:49 · přes AI hovor</div>
            </div>
            <div className="tl-item">
              <div className="tl-d"><I.Phone /></div>
              <div className="tl-t">Příchozí hovor — 48 vteřin</div>
              <div className="tl-x">Nikola potvrdila alergii na amoniak, Tereza k dispozici.</div>
              <div className="tl-w">dnes 14:48</div>
            </div>
            <div className="tl-item">
              <div className="tl-d"><I.Message /></div>
              <div className="tl-t">SMS potvrzení odesláno</div>
              <div className="tl-x">„Potvrzujeme rezervaci na Pá 24. 4. v 10:00…"</div>
              <div className="tl-w">dnes 14:49</div>
            </div>
            <div className="tl-item">
              <div className="tl-d warn"><I.Star /></div>
              <div className="tl-t">Přidán VIP status</div>
              <div className="tl-x">Manuálně přidal: Svatopluk V.</div>
              <div className="tl-w">před 2 týdny</div>
            </div>
            <div className="tl-item">
              <div className="tl-d"><I.Calendar /></div>
              <div className="tl-t">Rezervace — Barvení</div>
              <div className="tl-x">Út 8. 4. · dokončeno · 1 400 Kč</div>
              <div className="tl-w">před 3 týdny</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   Services view
   ============================================================ */
const ServicesView = () => {
  const [cat, setCat] = useState('all');
  const cats = ['all', ...Array.from(new Set(SERVICES.map((s) => s.cat)))];
  const rows = cat === 'all' ? SERVICES : SERVICES.filter((s) => s.cat === cat);

  return (
    <div>
      <div className="cal-toolbar" style={{ marginBottom: 22 }}>
        <div className="seg">
          {cats.map((c) => (
            <button key={c} className={cx(cat === c && 'on')} onClick={() => setCat(c)}>
              {c === 'all' ? 'Vše' : c}
            </button>
          ))}
        </div>
        <div className="row gap-2">
          <Btn variant="ghost" icon={I.Upload} size="sm">Import</Btn>
          <Btn variant="accent" icon={I.Plus} size="sm">Nová služba</Btn>
        </div>
      </div>

      <div className="svc-table">
        <table>
          <thead>
            <tr>
              <th>Služba</th>
              <th style={{ width: 110 }}>Délka</th>
              <th style={{ width: 130 }}>Cena</th>
              <th>Kdo dělá</th>
              <th style={{ width: 130, textAlign: 'right' }}>Rezervace (30d)</th>
              <th style={{ width: 110 }}>Stav</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="svc-name">{s.name}</div>
                  <div className="svc-cat">{s.cat}</div>
                </td>
                <td className="num muted">{s.d} min</td>
                <td className="num" style={{ fontWeight: 500 }}>{fmtPrice(s.p)}</td>
                <td><div className="svc-tags">{s.st.map((p) => <Tag key={p}>{p}</Tag>)}</div></td>
                <td className="num muted" style={{ textAlign: 'right' }}>{s.b}</td>
                <td>
                  {s.on
                    ? <Tag variant="live"><span className="d" />Aktivní</Tag>
                    : <Tag><span className="d" />Neaktivní</Tag>}
                </td>
                <td><Btn variant="ghost" icon={I.MoreH} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ============================================================
   Settings view
   ============================================================ */
const SetAI = () => {
  const [voice, setVoice] = useState('nikola');
  const [tone, setTone] = useState('warm');
  const [autoBook, setAutoBook] = useState(true);
  const [confirmSms, setConfirmSms] = useState(true);
  const [record, setRecord] = useState(true);

  const voices = [
    { id: 'nikola', name: 'Nikola', ds: 'Teplý, konverzační',   tg: ['CZ', 'ženský', 'neutrální'] },
    { id: 'petra',  name: 'Petra',  ds: 'Profesionální, jasný', tg: ['CZ', 'ženský', 'formální'] },
    { id: 'david',  name: 'David',  ds: 'Klidný, důvěryhodný',  tg: ['CZ', 'mužský'] },
  ];

  return (
    <div className="card lg">
      <div className="eyebrow">Vaše recepční</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>
        Jak má <span className="serif-it" style={{ color: 'var(--accent)' }}>Nikola</span> mluvit s klienty
      </div>

      <div className="form-row">
        <div>
          <div className="lbl">Hlas</div>
          <div className="desc">Jak Nikola zní. Klikněte na ▶ pro ukázku.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {voices.map((v) => (
            <div key={v.id} className={cx('voice-card', voice === v.id && 'on')} onClick={() => setVoice(v.id)}>
              <div className="h">
                <div className="nm">{v.name}</div>
                <Btn variant="ghost" size="sm" icon={I.Play} onClick={(e) => e.stopPropagation()} />
              </div>
              <div className="ds">{v.ds}</div>
              <div className="tgs">{v.tg.map((t) => <Tag key={t}>{t}</Tag>)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div>
          <div className="lbl">Úvodní pozdrav</div>
          <div className="desc">Co Nikola řekne, když někdo zavolá.</div>
        </div>
        <div className="col gap-3">
          <Seg items={[{ v: 'warm', l: 'Vřelý' }, { v: 'formal', l: 'Formální' }, { v: 'short', l: 'Krátký' }]} value={tone} onChange={setTone} />
          <div className="card thin" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Náhled</div>
            <div className="serif-it" style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)' }}>
              {tone === 'warm'   && '„Dobrý den, salon Svatopluk, Nikola u telefonu. Jak vám mohu pomoci?"'}
              {tone === 'formal' && '„Dobrý den, salon Svatopluk, u telefonu Nikola. S čím mohu posloužit?"'}
              {tone === 'short'  && '„Salon Svatopluk, dobrý den."'}
            </div>
          </div>
        </div>
      </div>

      <div className="form-row">
        <div>
          <div className="lbl">Automatická rezervace</div>
          <div className="desc">Nikola sama potvrdí termín bez vaší kontroly, pokud je volno.</div>
        </div>
        <Switch on={autoBook} onChange={setAutoBook} />
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">SMS potvrzení</div>
          <div className="desc">Po rezervaci automaticky odešle SMS s detaily termínu.</div>
        </div>
        <Switch on={confirmSms} onChange={setConfirmSms} />
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Nahrávání hovorů</div>
          <div className="desc">Uchováváme přepisy 90 dní, zvuk 30 dní. Klient je informován.</div>
        </div>
        <Switch on={record} onChange={setRecord} />
      </div>
    </div>
  );
};

const SetHours = () => {
  const [days, setDays] = useState([
    { d: 'Pondělí', on: true,  from: '10:00', to: '19:00' },
    { d: 'Úterý',   on: true,  from: '09:00', to: '19:00' },
    { d: 'Středa',  on: true,  from: '09:00', to: '19:00' },
    { d: 'Čtvrtek', on: true,  from: '09:00', to: '20:00' },
    { d: 'Pátek',   on: true,  from: '09:00', to: '20:00' },
    { d: 'Sobota',  on: true,  from: '08:00', to: '14:00' },
    { d: 'Neděle',  on: false, from: '—',     to: '—'     },
  ]);
  const toggle = (i) => {
    const n = [...days];
    n[i] = { ...n[i], on: !n[i].on };
    setDays(n);
  };

  return (
    <div className="card lg">
      <div className="eyebrow">Provozní doba</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>Kdy přijímáte klienty</div>
      {days.map((d, i) => (
        <div key={d.d} className="hours-row">
          <div className="dow">{d.d}</div>
          {d.on ? (
            <div className="row gap-2">
              <div className="field" style={{ padding: '6px 12px', fontSize: 13, minWidth: 90 }}>
                <span className="mono">{d.from}</span>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>až</span>
              <div className="field" style={{ padding: '6px 12px', fontSize: 13, minWidth: 90 }}>
                <span className="mono">{d.to}</span>
              </div>
              <Btn variant="ghost" size="sm" icon={I.Plus}>Pauza</Btn>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>Zavřeno</div>
          )}
          <Switch on={d.on} onChange={() => toggle(i)} />
        </div>
      ))}
      <div className="row gap-2" style={{ marginTop: 18 }}>
        <Btn size="sm" icon={I.Plus}>Přidat výjimku / svátek</Btn>
      </div>
    </div>
  );
};

const SetRules = () => {
  const [rules, setRules] = useState([
    { id: 'r1', t: 'Barvení pouze u Terezy',         x: 'Všechny barvicí služby Nikola nabízí jen v termínech Terezy.',                       on: true  },
    { id: 'r2', t: 'Nepřijímat rezervace po 19:30',  x: 'Nikola odmítne termíny končící po 19:30, i kdyby bylo otevřeno déle.',               on: true  },
    { id: 'r3', t: 'Přidat 15 min buffer po barvení',x: 'Automaticky přidá 15 minut úklidu za barvicí službou.',                              on: true  },
    { id: 'r4', t: 'Nové klienty ověřit SMS',         x: 'Pošle rezervační SMS, kterou musí klient potvrdit do 1 hodiny.',                      on: false },
    { id: 'r5', t: 'VIP preferují Terezu',            x: 'Pokud je volno, Nikola nabídne VIP klientům nejdřív Terezu.',                        on: true  },
  ]);
  const toggle = useCallback((id) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, on: !r.on } : r));
  }, []);

  return (
    <div className="card lg">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Pravidla</div>
          <div className="h-section" style={{ marginTop: 8, fontSize: 22 }}>
            Jak Nikola <span className="serif-it" style={{ color: 'var(--accent)' }}>rozhoduje</span>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 480 }}>
            Jednoduchá pravidla — když platí podmínka, Nikola se podle nich zařídí. Žádné programování.
          </div>
        </div>
        <Btn variant="accent" icon={I.Plus} size="sm">Nové pravidlo</Btn>
      </div>
      <div className="col gap-2" style={{ marginTop: 24 }}>
        {rules.map((r) => (
          <div key={r.id} className={cx('rule', r.on && 'on')}>
            <div className="rule-ic"><I.Sparkle s={14} /></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.t}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.55 }}>{r.x}</div>
            </div>
            <Switch on={r.on} onChange={() => toggle(r.id)} />
          </div>
        ))}
      </div>
    </div>
  );
};

const SetInteg = () => {
  const items = [
    { id: 'gcal',  n: 'Google Calendar',   d: 'Synchronizace rezervací do vašeho kalendáře', i: I.Calendar,   on: true,  acc: 'svatopluk@salon.cz' },
    { id: 'res',   n: 'Reservio',           d: 'Import stávajících rezervací a klientů',       i: I.Globe,      on: true,  acc: 'salon-svatopluk' },
    { id: 'tw',    n: 'Twilio (telefonie)', d: 'Telefonní číslo +420 277 140 220',             i: I.Phone,      on: true,  acc: '+420 277 140 220' },
    { id: 'pos',   n: 'Storyous POS',       d: 'Propojit platby a útratu klientů',             i: I.CreditCard, on: false },
    { id: 'mch',   n: 'Mailchimp',          d: 'Klienti do e-mailových kampaní',               i: I.Mail,       on: false },
    { id: 'slack', n: 'Slack',              d: 'Notifikace o důležitých hovorech',             i: I.Bell,       on: false },
  ];

  return (
    <div className="card lg">
      <div className="eyebrow">Propojení</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>Co všechno máte připojené</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        {items.map((it) => {
          const Ico = it.i;
          return (
            <div key={it.id} className="card thin" style={{ padding: 18 }}>
              <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Ico s={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{it.n}</div>
                    {it.on
                      ? <Tag variant="live"><I.Check s={10} />Propojeno</Tag>
                      : <Btn variant="ghost" size="sm">Připojit</Btn>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{it.d}</div>
                  {it.acc && <div className="mono" style={{ fontSize: 11.5, marginTop: 8, color: 'var(--ink-3)' }}>{it.acc}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SetBilling = () => (
  <div className="col gap-4">
    <div className="card lg" style={{ background: 'linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--paper)', borderColor: 'var(--accent-ring)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="eyebrow">Váš plán</div>
          <div className="h-display" style={{ marginTop: 10, fontSize: 38 }}>Professional</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>Až 500 hovorů / měsíc · všechny funkce · prioritní podpora</div>
        </div>
        <div className="col gap-2" style={{ alignItems: 'flex-end' }}>
          <div className="h-display" style={{ fontSize: 30 }}>2 490 Kč <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>/ měsíc</span></div>
          <Btn variant="ghost" size="sm">Změnit plán</Btn>
        </div>
      </div>
      <div style={{ height: 1, background: 'var(--line)', margin: '24px 0 20px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Hovory tento měsíc</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 6 }}>
            <div className="h-display" style={{ fontSize: 26 }}>184</div>
            <div className="muted" style={{ fontSize: 12 }}>/ 500</div>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ width: '36.8%', height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Příští platba</div>
          <div className="h-display" style={{ fontSize: 26, marginTop: 6 }}>12. 5. 2026</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Visa •••• 4221</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Rezervací z Nikoly</div>
          <div className="h-display" style={{ fontSize: 26, marginTop: 6 }}>142</div>
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--live)' }}>+18 % oproti minulému měsíci</div>
        </div>
      </div>
    </div>

    <div className="card lg">
      <div className="h-section" style={{ fontSize: 18, marginBottom: 14 }}>Faktury</div>
      <div className="svc-table" style={{ border: 0, background: 'transparent' }}>
        <table>
          <thead>
            <tr><th>Datum</th><th>Popis</th><th>Částka</th><th /></tr>
          </thead>
          <tbody>
            {[
              { d: '12. 4. 2026', n: 'Professional · duben',  v: '2 490 Kč' },
              { d: '12. 3. 2026', n: 'Professional · březen', v: '2 490 Kč' },
              { d: '12. 2. 2026', n: 'Professional · únor',   v: '2 490 Kč' },
              { d: '12. 1. 2026', n: 'Starter · leden',       v: '890 Kč'   },
            ].map((r, i) => (
              <tr key={i}>
                <td className="muted">{r.d}</td>
                <td>{r.n}</td>
                <td className="num" style={{ fontWeight: 500 }}>{r.v}</td>
                <td style={{ textAlign: 'right' }}><Btn variant="ghost" size="sm" icon={I.Download}>PDF</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const SettingsView = () => {
  const [tab, setTab] = useState('ai');
  const tabs = [
    { id: 'ai',           label: 'AI recepční',    icon: I.Brain      },
    { id: 'hours',        label: 'Otevírací doba', icon: I.Clock      },
    { id: 'rules',        label: 'Pravidla',       icon: I.Sparkle    },
    { id: 'integrations', label: 'Integrace',      icon: I.Link       },
    { id: 'billing',      label: 'Předplatné',     icon: I.CreditCard },
  ];

  return (
    <div className="settings">
      <nav className="settings-nav">
        {tabs.map((t) => {
          const Ico = t.icon;
          return (
            <button key={t.id} className={cx(tab === t.id && 'on')} onClick={() => setTab(t.id)}>
              <Ico />{t.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tab === 'ai'           && <SetAI />}
        {tab === 'hours'        && <SetHours />}
        {tab === 'rules'        && <SetRules />}
        {tab === 'integrations' && <SetInteg />}
        {tab === 'billing'      && <SetBilling />}
      </div>
    </div>
  );
};

/* ============================================================
   Tweaks panel
   ============================================================ */
const HUES = [
  { v: 18,  name: 'Cihla'  },
  { v: 330, name: 'Růžová' },
  { v: 45,  name: 'Med'    },
  { v: 155, name: 'Mech'   },
  { v: 230, name: 'Modrá'  },
  { v: 280, name: 'Lila'   },
];

const TweaksPanel = ({ active, values, onChange }) => {
  if (!active) return null;
  return (
    <div className="tweaks">
      <div className="ht">
        <div className="t">Tweaks</div>
        <Tag variant="live"><Wave size={9} />živě</Tag>
      </div>
      <div style={{ height: 1, background: 'var(--line)' }} />
      <div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
          Akcentní barva · H {values.accentHue}°
        </div>
        <div className="swatches">
          {HUES.map((h) => (
            <div
              key={h.v}
              className={cx('sw-c', Math.abs(values.accentHue - h.v) < 4 && 'on')}
              title={h.name}
              style={{ background: `oklch(0.74 0.13 ${h.v})` }}
              onClick={() => onChange({ accentHue: h.v })}
            />
          ))}
        </div>
        <input
          type="range" min="0" max="360" step="1" value={values.accentHue}
          style={{ width: '100%', marginTop: 12, accentColor: 'var(--accent)' }}
          onChange={(e) => onChange({ accentHue: +e.target.value })}
        />
      </div>
      <div style={{ height: 1, background: 'var(--line)' }} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Hustota</div>
        <Seg
          items={[{ v: 'airy', l: 'Vzdušné' }, { v: 'compact', l: 'Kompakt.' }]}
          value={values.density}
          onChange={(v) => onChange({ density: v })}
        />
      </div>
    </div>
  );
};

/* ============================================================
   View metadata
   ============================================================ */
const VIEW_META = {
  today:    { title: 'Dnes',      crumb: 'Úterý 22. dubna · živý přehled' },
  inbox:    { title: 'Hovory',    crumb: 'Všechny příchozí — dnes, včera, dřív' },
  calendar: { title: 'Kalendář',  crumb: 'Týdenní rozvrh rezervací' },
  clients:  { title: 'Klienti',   crumb: '248 lidí · 19 nových tento měsíc' },
  services: { title: 'Služby',    crumb: 'Katalog a ceny' },
  settings: { title: 'Nastavení', crumb: 'Konfigurace AI, provozu a integrací' },
};

/* ============================================================
   Dashboard (main export)
   ============================================================ */
export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [nav, setNav] = useState(() => {
    try { return localStorage.getItem('pl:nav') || 'today'; } catch { return 'today'; }
  });
  const [aiOn] = useState(true);
  const [tweaks, setTweaks] = useState({ accentHue: 45, density: 'compact' });
  const [tweaksActive, setTweaksActive] = useState(false);
  const [callSel, setCallSel] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    try { localStorage.setItem('pl:nav', nav); } catch { /* ignore */ }
  }, [nav]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', tweaks.accentHue);
    document.body.setAttribute('data-density', tweaks.density);
  }, [tweaks]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode')   setTweaksActive(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksActive(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const setTw = useCallback((patch) => {
    setTweaks((prev) => {
      const next = { ...prev, ...patch };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.allSettled([
      fetchCalls().then(rows => {
        if (rows.length > 0) {
          CALLS = rows.map(r => ({
            id: r.id, who: r.customer_name || r.customer_phone || 'Neznámé číslo',
            phone: r.customer_phone || '', t: new Date(r.created_at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
            rel: new Date(r.created_at).toLocaleDateString('cs-CZ'),
            status: r.status, sub: r.summary || '',
            summary: r.transcript_full || r.summary || '',
            tags: [r.status], vip: false,
            outcome: { kind: r.status, label: r.status, sub: r.summary || '' },
          }));
        }
      }),
      fetchCustomers().then(rows => {
        if (rows.length > 0) {
          CLIENTS = rows.map(r => ({
            id: r.id, name: r.name || r.phone, phone: r.phone,
            vip: r.vip_status, note: r.notes || '',
            ini: (r.name || r.phone).slice(0, 2).toUpperCase(),
            visits: 0, last: r.last_visit_date || '—', spend: 0, fav: '—',
          }));
        }
      }),
      fetchServices().then(rows => {
        if (rows.length > 0) {
          SERVICES = rows.map(r => ({
            id: r.id, name: r.name, cat: 'Služby',
            d: r.duration_min, p: r.price, b: 0, on: true,
          }));
        }
      }),
      fetchBookings().then(rows => {
        if (rows.length > 0) {
          EVENTS = rows.map(r => {
            const start = new Date(r.starts_at);
            const end = new Date(r.ends_at);
            const h = start.getHours() + start.getMinutes() / 60;
            const e2 = end.getHours() + end.getMinutes() / 60;
            return { col: 0, s: h, e: e2, t: r.note || 'Rezervace', who: '—', id: r.id };
          });
        }
      }),
    ]).then(() => setDataVersion(v => v + 1));
  }, [user]);

  const refreshServices = useCallback(async () => {
    const rows = await fetchServices();
    if (rows.length > 0) {
      SERVICES = rows.map(r => ({
        id: r.id, name: r.name, cat: 'Služby',
        d: r.duration_min, p: r.price, b: 0, on: true,
      }));
    }
    setDataVersion(v => v + 1);
  }, []);

  const refreshCustomers = useCallback(async () => {
    const rows = await fetchCustomers();
    if (rows.length > 0) {
      CLIENTS = rows.map(r => ({
        id: r.id, name: r.name || r.phone, phone: r.phone,
        vip: r.vip_status, note: r.notes || '',
        ini: (r.name || r.phone).slice(0, 2).toUpperCase(),
        visits: 0, last: r.last_visit_date || '—', spend: 0, fav: '—',
      }));
    }
    setDataVersion(v => v + 1);
  }, []);

  const m = VIEW_META[nav];

  const right = (
    <div className="field" style={{ width: 280, maxWidth: '40vw' }}>
      <I.Search />
      <input placeholder="Hledat klienta, službu, číslo…" />
      <span className="kbd">⌘K</span>
    </div>
  );

  return (
    <>
      <div className="ambient" />
      <div className="app">
        <Rail nav={nav} setNav={setNav} onSignOut={signOut} />
        <div className="col-main">
          <Dock title={m.title} crumb={m.crumb} right={right} aiOn={aiOn} />
          <div className="view">
            {nav === 'today'    && <TodayView />}
            {nav === 'inbox'    && <InboxView selId={callSel} setSelId={setCallSel} />}
            {nav === 'calendar' && <CalendarView aiOn={aiOn} />}
            {nav === 'clients'  && <ClientsView />}
            {nav === 'services' && <ServicesView />}
            {nav === 'settings' && <SettingsView />}
          </div>
        </div>
        <TweaksPanel active={tweaksActive} values={tweaks} onChange={setTw} />
      </div>
    </>
  );
}
