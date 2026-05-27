import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Icons as I, Wave } from '../components/Icons.jsx';
import '../styles/globals.css';
import './Dashboard.css';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchCalls, updateCallStatus, clearCachedCalls } from '../lib/callsDb.js';
import { fetchStaff, createStaff, updateStaff, deleteStaff, clearCachedStaff } from '../lib/staffDb.js';
import { fetchCustomers, upsertCustomer, deleteCustomerByPhone, fetchCustomerStats } from '../lib/customersDb.js';
import { fetchServices, createService, updateService, deleteService } from '../lib/servicesDb.js';
import { fetchBookings, createBooking, deleteBooking, clearCachedBookings } from '../lib/bookingsDb.js';
import { fetchBlocks, createBlock, deleteBlock, clearCachedBlocks } from '../lib/blocksDb.js';
import { createFollowup } from '../lib/followupsDb.js';
import { getCompanySettings, saveCompanySettings } from '../lib/companySettings.js';
import { supabase } from '../lib/supabase.js';
import { SuggestedSlots } from '../components/SuggestedSlots.jsx';
import toast from 'react-hot-toast';

/* ============================================================
   Data
   ============================================================ */
let CALLS = [];
let CLIENTS = [];
let SERVICES = [];
let EVENTS = [];
let STAFF = [];
let BLOCKS = [];

/* ── Week helpers ── */
const CZ_DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const CZ_MONTHS = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
const CZ_MONTH_NAMES = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];

function getCurrentWeek() {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  return {
    days: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return { s: CZ_DAYS[i], d: d.getDate(), date: d };
    }),
    todayCol: dayOfWeek,
    weekStart,
  };
}

function formatRelTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 60000);
  if (diff < 2) return 'právě teď';
  if (diff < 60) return `před ${diff} min`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `před ${h} h`;
  return date.toLocaleDateString('cs-CZ');
}

function getDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Dobré ráno';
  if (h < 18) return 'Dobré odpoledne';
  return 'Dobrý večer';
}

function getTodayLabel() {
  const now = new Date();
  return `${CZ_DAYS[(now.getDay() + 6) % 7]} ${now.getDate()}. ${CZ_MONTHS[now.getMonth()]} · ${now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
}

function mapCallRow(r) {
  const d = r.created_at ? new Date(r.created_at) : new Date();
  const isLive = r.status === 'live';
  const turns = (r.conversation_state?.turns ?? []).filter(t => !t.content?.startsWith('[systém:'));
  const lastAiTurn = [...turns].reverse().find(t => t.role === 'assistant');
  return {
    id: r.id,
    who: r.customer_name || r.customer_phone || 'Neznámé číslo',
    phone: r.customer_phone || '',
    t: d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
    rel: formatRelTime(d),
    status: r.status,
    live: isLive,
    sub: isLive ? (lastAiTurn?.content || 'Nikola vyřizuje hovor…') : (r.summary || ''),
    summary: r.transcript_full || r.summary || '',
    transcript: turns,
    tags: [r.status].filter(Boolean),
    vip: false,
    created_at: r.created_at,
    recording_url: r.recording_url || null,
    outcome: {
      kind: r.status,
      label: r.status === 'booked' ? 'Rezervace vytvořena' : r.status === 'missed' ? 'Zmeškaný hovor' : isLive ? 'Probíhá hovor' : 'Dotaz zákazníka',
      sub: r.summary || '',
      service: r.bookings?.services?.name ?? null,
      when: r.bookings?.starts_at ? new Date(r.bookings.starts_at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null,
    },
  };
}

function mapCustomerRow(r) {
  const ini = (r.name || r.phone || '?').slice(0, 2).toUpperCase();
  return {
    id: r.id,
    name: r.name || r.phone,
    phone: r.phone,
    vip: r.vip_status,
    note: r.notes || '',
    ini,
    visits: 0,
    last: r.last_visit_date ? new Date(r.last_visit_date).toLocaleDateString('cs-CZ') : '—',
    spend: 0,
    fav: '—',
  };
}

function mapServiceRow(r) {
  return {
    id: r.id,
    name: r.name,
    cat: r.category || 'Ostatní',
    d: r.duration_min,
    p: r.price,
    on: r.is_active !== false,
    buffer_after_min: r.buffer_after_min || 0,
  };
}

function mapBookingToEvent(r) {
  const start = new Date(r.starts_at);
  const end = new Date(r.ends_at);
  const col = (start.getDay() + 6) % 7; // Mon=0
  return {
    id: r.id,
    col,
    s: start.getHours() + start.getMinutes() / 60,
    e: end.getHours() + end.getMinutes() / 60,
    t: r.customers?.name || r.note || 'Rezervace',
    who: r.customers?.name || r.customers?.phone || '—',
    starts_at: r.starts_at,
    staff_id: r.staff_id ?? null,
    customer_id: r.customer_id ?? null,
    service_id: r.service_id ?? null,
    service_name: r.services?.name ?? null,
  };
}

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
   Loading skeleton
   ============================================================ */
const Skeleton = ({ h = 18, w = '100%', r = 8, style }) => (
  <div style={{ height: h, width: w, borderRadius: r, background: 'var(--paper-2)', opacity: 0.7, animation: 'pulse 1.4s ease-in-out infinite', flexShrink: 0, ...style }} />
);
const SkeletonCard = ({ rows = 3 }) => (
  <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
    {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={14} w={i === 0 ? '60%' : i === rows - 1 ? '40%' : '85%'} />)}
  </div>
);
const LoadingView = () => (
  <div className="col gap-4" style={{ padding: '8px 0' }}>
    <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }`}</style>
    <SkeletonCard rows={2} />
    <SkeletonCard rows={4} />
    <SkeletonCard rows={3} />
  </div>
);

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
  { id: 'today',     label: 'Dnes',      icon: I.Today },
  { id: 'inbox',     label: 'Hovory',    icon: I.Inbox, badge: true },
  { id: 'calendar',  label: 'Kalendář',  icon: I.Calendar },
  { id: 'clients',   label: 'Klienti',   icon: I.Users },
  { id: 'services',  label: 'Služby',    icon: I.Scissors },
  { id: 'analytics', label: 'Statistiky', icon: I.BarChart },
];

/* ============================================================
   Rail
   ============================================================ */
const Rail = ({ nav, setNav, onSignOut, missedCount }) => (
  <aside className="rail">
    <div className="mark">P</div>
    <nav className="rail-nav">
      {NAV.map((n) => {
        const Ico = n.icon;
        return (
          <div key={n.id} className={cx('rail-item', nav === n.id && 'on')} onClick={() => setNav(n.id)}>
            <Ico s={18} />
            {n.badge && missedCount > 0 && <span className="dot" />}
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
const AiPres = ({ aiOn, onToggle }) => (
  <div
    className="ai-pres"
    title={aiOn ? 'Nikola má službu — kliknutím pozastavit' : 'AI je pozastavená — kliknutím obnovit'}
    onClick={onToggle}
    style={{ cursor: onToggle ? 'pointer' : 'default' }}
  >
    <div className="av" style={{ opacity: aiOn ? 1 : 0.45 }}>N</div>
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

const Dock = ({ title, crumb, right, aiOn, onToggleAi }) => (
  <header className="dock">
    <div className="col">
      <div className="dock-title">{title}</div>
      {crumb && <div className="dock-crumb">{crumb}</div>}
    </div>
    <div className="spacer" />
    {right}
    <AiPres aiOn={aiOn} onToggle={onToggleAi} />
  </header>
);

/* ============================================================
   Today view
   ============================================================ */
const TodayView = ({ setNav, setCallSel, onNavCalendar, onRefresh }) => {
  const week = getCurrentWeek();
  const [menuId, setMenuId] = useState(null);
  const liveCall = CALLS.find((c) => c.live);
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const upcoming = EVENTS.filter((e) => e.col === week.todayCol && e.s >= nowH).slice(0, 4);
  const todayCalls = CALLS.filter((c) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const booked = todayCalls.filter(c => c.status === 'booked').length;
  const missed = todayCalls.filter(c => c.status === 'missed').length;
  const attn = CALLS.filter((c) => ['missed', 'resched'].includes(c.status));

  return (
    <div className="col gap-6">
      <div className="hero-card">
        <div className="hero-text">
          <div className="eyebrow" style={{ marginBottom: 14 }}>{getTodayLabel()}</div>
          <div className="greet">
            {getDayGreeting()}.<br />
            {todayCalls.length > 0
              ? <>Nikola dnes vyřídila <span className="it">{todayCalls.length} hovorů</span> a získala <span className="it">{booked} rezervací</span>.</>
              : <>Žádné hovory dnes zatím. <span className="it">Nikola</span> čeká na první hovor.</>
            }
          </div>
          {attn.length > 0 && (
            <div className="muted" style={{ fontSize: 14, marginTop: 14, maxWidth: 540, lineHeight: 1.55 }}>
              {attn.length} {attn.length === 1 ? 'věc čeká' : 'věci čekají'} na vaši pozornost.
            </div>
          )}
        </div>
        <div className="kpi-row">
          <div className="kpi accent">
            <div className="n">{CALLS.filter(c => c.live).length}</div>
            <div className="l">právě v hovoru</div>
          </div>
          <div className="kpi">
            <div className="n">{booked}</div>
            <div className="l">rezervací dnes</div>
          </div>
          <div className="kpi">
            <div className="n">{attn.length}</div>
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
            {liveCall.summary && (
              <div className="what">
                <div className="lab">Co Nikola právě řeší</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{liveCall.summary}</div>
              </div>
            )}
            <div className="row gap-2">
              <Btn variant="ghost" icon={I.Volume} size="sm" disabled title="Živý odposlech bude dostupný po propojení s Twilio">Poslouchat živě</Btn>
            </div>
          </div>
        )}

        <div className="card">
          <div className="section-hd">
            <div>
              <div className="eyebrow">Zbytek odpoledne</div>
              <div className="h-section" style={{ marginTop: 8, fontSize: 18 }}>Co vás dnes čeká</div>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => setNav('calendar')}>Celý kalendář</Btn>
          </div>
          <div className="col gap-3">
            {upcoming.length === 0 && (
              <div className="muted" style={{ fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Dnes žádné další rezervace.</div>
            )}
            {upcoming.map((e, i) => (
              <div key={i} className="row gap-3" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', alignItems: 'center', position: 'relative' }}>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--accent)', minWidth: 64 }}>{fmtTime(e.s)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{e.t}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{e.who} · {fmtTime(e.e)} konec</div>
                </div>
                <Btn variant="ghost" size="sm" icon={I.MoreH} onClick={() => setMenuId(menuId === e.id ? null : e.id)} />
                {menuId === e.id && (
                  <div className="card" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 30, padding: '6px 0', minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    <button onClick={() => { setNav('calendar'); setMenuId(null); }} style={{ display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: 'var(--ink)', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>Otevřít v kalendáři</button>
                    <button onClick={async () => { try { await deleteBooking(e.id); toast.success('Rezervace zrušena.'); setMenuId(null); onRefresh?.(); } catch { toast.error('Chyba při rušení.'); } }} style={{ display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#f87171', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>Zrušit rezervaci</button>
                  </div>
                )}
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
                      <Btn size="sm" onClick={() => { setCallSel(c.id); setNav('inbox'); }}>Otevřít</Btn>
                      {c.status === 'missed' && c.phone && (
                        <a href={`tel:${c.phone}`} style={{ textDecoration: 'none' }}>
                          <Btn variant="ghost" size="sm" icon={I.Phone}>Zavolat zpět</Btn>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {missed > 0 && (
        <div className="card lg" style={{ background: 'linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--paper)', borderColor: 'var(--accent-ring)' }}>
          <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
            <div className="ai-pres" style={{ padding: 4, borderRadius: 50 }}>
              <div className="av" style={{ width: 40, height: 40, fontSize: 14 }}>N</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Vyžaduje pozornost</div>
              <div className="h-section" style={{ fontSize: 18, marginBottom: 8 }}>
                Dnes <span className="serif-it" style={{ color: 'var(--accent)' }}>{missed} zmeškaných</span> hovorů.
              </div>
              <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 640 }}>
                Podívejte se na příchozí hovory a zavolejte klientům zpět.
              </div>
              <div className="row gap-2" style={{ marginTop: 16 }}>
                <Btn variant="accent" size="sm" onClick={() => setNav('inbox')}>Přejít do Inboxu</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   Inbox view
   ============================================================ */
const STATUS_META = {
  live:     { label: 'Probíhá',       v: 'live'   },
  booked:   { label: 'Rezervace',     v: 'accent' },
  new:      { label: 'Nová klientka', v: 'accent' },
  resched:  { label: 'Přesunuto',     v: 'warn'   },
  info:     { label: 'Info',          v: 'info'   },
  missed:   { label: 'Zmeškáno',      v: 'bad'    },
  cancel:   { label: 'Zrušeno',       v: ''       },
  query:    { label: 'Dotaz',         v: 'info'   },
  resolved: { label: 'Vyřešeno',      v: ''       },
};

const callStatus = (c) => c.live ? 'live' : (c.status || 'booked');

const CallRow = ({ call, on, onClick }) => {
  const st = STATUS_META[callStatus(call)] ?? { label: call.status || 'Hovor', v: 'info' };
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

const CallDetail = ({ call, onBookingCreated, onNavCalendar }) => {
  const { user } = useAuth();
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [smsModal, setSmsModal] = useState(false);
  const [smsText, setSmsText] = useState('');
  const [smsSending, setSmsSending] = useState(false);

  useEffect(() => {
    setSelectedServiceId('');
    setBookNote('');
    setSmsModal(false);
  }, [call?.id]);

  if (!call) return null;
  const o = call.outcome;

  async function handleBookSlot(slot) {
    const svc = SERVICES.find(s => s.id === selectedServiceId);
    if (!svc) return false;
    await createBooking({
      call_id: call.id,
      service_id: selectedServiceId,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      note: bookNote || null,
    });
    if (onBookingCreated) onBookingCreated();
    return true;
  }

  async function sendSms() {
    if (!smsText.trim()) return;
    setSmsSending(true);
    try {
      await createFollowup({ call_id: call.id, channel: 'sms', message: smsText.trim() });
      toast.success('SMS zařazena do fronty.');
      setSmsModal(false);
      setSmsText('');
    } catch (e) {
      toast.error(e.message || 'Chyba při odesílání SMS.');
    } finally {
      setSmsSending(false);
    }
  }

  async function markResolved() {
    try {
      await updateCallStatus(call.id, 'resolved');
      toast.success('Hovor označen jako vyřešený.');
    } catch (e) {
      toast.error(e.message || 'Chyba.');
    }
  }

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  return (
    <div className="detail">
      <div className="detail-hd">
        <div className="row gap-4" style={{ alignItems: 'center', marginBottom: 18 }}>
          <Avatar ini={getInitials(call.who)} size="lg" vip={call.vip} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="h-display" style={{ fontSize: 28 }}>{call.who}</div>
              {call.vip && <Tag variant="accent"><I.StarF s={10} />VIP</Tag>}
              {call.live && <Tag variant="live"><span className="d" />LIVE</Tag>}
            </div>
            <div className="row gap-3 muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              <span className="mono">{call.phone}</span>
              <span>·</span>
              <span>{call.rel}</span>
            </div>
          </div>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {call.phone && (
              <a href={`tel:${call.phone}`} style={{ textDecoration: 'none' }}>
                <Btn icon={I.Phone} size="sm">Zavolat zpět</Btn>
              </a>
            )}
            <Btn icon={I.Message} size="sm" onClick={() => { setSmsText(`Dobrý den, ${call.who}, zde ${''}`); setSmsModal(v => !v); }}>SMS</Btn>
            <Btn variant="ghost" icon={I.Check} size="sm" onClick={markResolved}>Vyřešeno</Btn>
          </div>
        </div>

        {smsModal && (
          <div className="card" style={{ marginBottom: 16, padding: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Odeslat SMS klientovi</div>
            <div className="field" style={{ padding: '8px 12px', marginBottom: 10 }}>
              <textarea value={smsText} onChange={e => setSmsText(e.target.value)} rows={3} placeholder="Text zprávy…" style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div className="row gap-2">
              <Btn variant="accent" size="sm" onClick={sendSms} disabled={smsSending || !smsText.trim()}>{smsSending ? 'Odesílám…' : 'Zařadit do fronty'}</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setSmsModal(false)}>Zrušit</Btn>
            </div>
          </div>
        )}


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
                <Btn size="sm" onClick={() => onNavCalendar?.()}>Otevřít v kalendáři</Btn>
              </div>
            )}
            {o.kind === 'missed' && call.phone && (
              <a href={`tel:${call.phone}`} style={{ textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>
                <Btn size="sm" icon={I.Phone}>Zavolat zpět</Btn>
              </a>
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
                <Btn variant="ghost" icon={I.Volume} size="sm" disabled title="Dostupné po propojení s Twilio">Poslouchat</Btn>
              </div>
            </div>
            <div className="tr">
              {(call.transcript || []).length === 0
                ? <div className="muted" style={{ padding: '12px 0', fontSize: 13 }}>Nikola vyřizuje hovor…</div>
                : (call.transcript || []).map((t, i) => <TranscriptTurn key={i} turn={t} />)
              }
            </div>
          </div>
        )}

        {!call.live && (call.transcript || []).length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Přepis hovoru</div>
            <div className="tr">
              {(call.transcript || []).map((t, i) => <TranscriptTurn key={i} turn={t} />)}
            </div>
          </div>
        )}

        {call.recording_url && (
          <div style={{ marginBottom: 28 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Nahrávka hovoru</div>
            <div className="card thin" style={{ padding: '14px 16px' }}>
              <audio
                controls
                src={call.recording_url}
                style={{ width: '100%', height: 36, accentColor: 'var(--accent)' }}
              />
              <div style={{ marginTop: 10 }}>
                <a
                  href={call.recording_url}
                  download
                  style={{ fontSize: 12.5, color: 'var(--ink-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <I.Download s={13} /> Stáhnout nahrávku
                </a>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Vytvořit rezervaci</div>
          <label style={{ display: 'grid', gap: 4, marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Služba</span>
            <select
              value={selectedServiceId}
              onChange={e => setSelectedServiceId(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', fontSize: 13, color: 'var(--ink)', outline: 'none' }}
            >
              <option value="">Vyberte službu…</option>
              {SERVICES.map(s => (
                <option key={s.id} value={s.id}>{s.name} · {s.d} min · {s.p} Kč</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Poznámka (volitelně)</span>
            <input
              value={bookNote}
              onChange={e => setBookNote(e.target.value)}
              placeholder="Poznámka k rezervaci…"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', fontSize: 13, color: 'var(--ink)', outline: 'none' }}
            />
          </label>
          <SuggestedSlots
            serviceId={selectedServiceId}
            onBookSlot={handleBookSlot}
          />
        </div>
      </div>
    </div>
  );
};

const TodayHero = () => {
  const liveCall = CALLS.find((c) => c.live);
  const now = new Date();
  const todayCalls = CALLS.filter(c => c.created_at && new Date(c.created_at).toDateString() === now.toDateString());
  const booked = todayCalls.filter(c => c.status === 'booked').length;
  const attn = CALLS.filter(c => ['missed', 'resched'].includes(c.status)).length;

  return (
    <div className="today-hero">
      <div className="hero-card">
        <div className="hero-text">
          <div className="eyebrow" style={{ marginBottom: 14 }}>{getTodayLabel()}</div>
          <div className="greet">
            {getDayGreeting()}.<br />
            {todayCalls.length > 0
              ? <>Nikola dnes vyřídila <span className="it">{todayCalls.length} hovorů</span> a získala <span className="it">{booked} rezervací</span>.</>
              : <>Žádné hovory dnes zatím. <span className="it">Nikola</span> je připravena.</>
            }
          </div>
          {attn > 0 && (
            <div className="muted" style={{ fontSize: 14, marginTop: 14, maxWidth: 540, lineHeight: 1.55 }}>
              {attn} {attn === 1 ? 'věc čeká' : 'věci čekají'} na vaši pozornost.
            </div>
          )}
        </div>
        <div className="kpi-row">
          <div className="kpi accent">
            <div className="n">{CALLS.filter(c => c.live).length}</div>
            <div className="l">právě teď v hovoru</div>
          </div>
          <div className="kpi">
            <div className="n">{booked}</div>
            <div className="l">nových rezervací dnes</div>
          </div>
          <div className="kpi">
            <div className="n">{attn}</div>
            <div className="l">potřebují pozornost</div>
          </div>
        </div>
      </div>

      {liveCall && (
        <div className="live-card">
          <div className="hd">
            <div style={{ position: 'relative' }}>
              <Avatar ini={getInitials(liveCall.who)} size="md" vip={liveCall.vip} />
              <div className="pulse" style={{ position: 'absolute', inset: -3, pointerEvents: 'none' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{liveCall.who}</div>
              <div className="ph">{liveCall.phone}</div>
            </div>
            <Tag variant="live"><span className="d" /><Wave size={9} /> LIVE</Tag>
          </div>
          <div className="what">
            <div className="lab">Probíhající hovor</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{liveCall.sub || 'Nikola vyřizuje hovor…'}</div>
          </div>
          <div className="row gap-2">
            <Btn variant="accent" icon={I.Volume} size="sm" disabled title="Dostupné po propojení s Twilio">Poslouchat živě</Btn>
            <Btn variant="ghost" icon={I.PhoneOff} size="sm" disabled title="Dostupné po propojení s Twilio">Převzít hovor</Btn>
          </div>
        </div>
      )}
    </div>
  );
};

const InboxView = ({ selId, setSelId, onBookingCreated, onNavCalendar, dataVersion }) => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    let list = CALLS;
    if (filter === 'attn') list = list.filter((c) => ['missed', 'resched', 'cancel', 'query'].includes(c.status));
    else if (filter === 'book') list = list.filter((c) => c.live || c.status === 'booked' || c.status === 'new');
    else if (filter === 'missed') list = list.filter((c) => c.status === 'missed');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.who?.toLowerCase().includes(q) || c.phone?.includes(q) || c.summary?.toLowerCase().includes(q));
    }
    return list;
  }, [filter, search, dataVersion]);
  const sel = CALLS.find((c) => c.id === selId) ?? CALLS[0];

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
              <input placeholder="Hledat v přepisech, jménech, číslech…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="list-body">
            {filtered.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                {search ? 'Žádné výsledky.' : 'Žádné hovory zatím. Nikola je připravená.'}
              </div>
            )}
            {filtered.map((c) => (
              <CallRow key={c.id} call={c} on={sel?.id === c.id} onClick={() => setSelId(c.id)} />
            ))}
          </div>
        </div>
        <CallDetail call={sel} onBookingCreated={onBookingCreated} onNavCalendar={onNavCalendar} />
      </div>
    </div>
  );
};

/* ============================================================
   Google Calendar sync (fire-and-forget)
   ============================================================ */
async function syncGcal(action, bookingId) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-sync`
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, booking_id: bookingId }),
    }).catch(() => {})
  } catch { /* ignore */ }
}

/* ============================================================
   Calendar view
   ============================================================ */
function getWeekFromDate(anchorDate) {
  const d = new Date(anchorDate);
  const dayOfWeek = (d.getDay() + 6) % 7;
  const weekStart = new Date(d);
  weekStart.setDate(weekStart.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  return {
    days: Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(weekStart);
      dd.setDate(dd.getDate() + i);
      return { s: CZ_DAYS[i], d: dd.getDate(), date: dd };
    }),
    todayCol: (new Date().getDay() + 6) % 7,
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

const CalendarView = ({ onRefresh, prefillClient, onPrefillUsed }) => {
  const { user } = useAuth();
  const [staff, setStaff] = useState('all');
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [bookingModal, setBookingModal] = useState(false);
  const [selEvent, setSelEvent] = useState(null);
  const [bForm, setBForm] = useState({ date: '', time: '09:00', serviceId: '', staffId: '', note: '' });
  const [bSaving, setBSaving] = useState(false);

  useEffect(() => {
    if (prefillClient) {
      const today = new Date().toISOString().slice(0, 10);
      setBForm(f => ({ ...f, date: today, note: prefillClient.note || prefillClient.name || '' }));
      setBookingModal(true);
      onPrefillUsed?.();
    }
  }, [prefillClient]);

  const ROW_H = 60;
  const START_H = 9;
  const END_H = 19;
  const hours = [];
  for (let h = START_H; h <= END_H; h++) hours.push(h);

  const nowDate = new Date();
  const nowH = nowDate.getHours() + nowDate.getMinutes() / 60;
  const nowTop = (nowH - START_H) * ROW_H;

  const week = getWeekFromDate(anchor);
  const isCurrentWeek = week.weekStart.toDateString() === getWeekFromDate(new Date()).weekStart.toDateString();
  const monthLabel = CZ_MONTH_NAMES[anchor.getMonth()];

  const events = EVENTS.filter((e) => {
    if (!e.starts_at) return false;
    const es = new Date(e.starts_at);
    return es >= week.weekStart && es < week.weekEnd;
  }).map(e => {
    const start = new Date(e.starts_at);
    return { ...e, col: (start.getDay() + 6) % 7, s: start.getHours() + start.getMinutes() / 60 };
  }).filter((e) => staff === 'all' || e.staff_id === staff);

  const navigate = (dir) => {
    setAnchor(a => {
      const d = new Date(a);
      d.setDate(d.getDate() + dir * 7);
      return d;
    });
  };

  const openBooking = () => {
    const today = new Date().toISOString().slice(0, 10);
    setBForm({ date: today, time: '09:00', serviceId: SERVICES[0]?.id ?? '', staffId: '', note: '' });
    setBookingModal(true);
  };

  const saveBooking = async () => {
    if (!bForm.date || !bForm.serviceId) { toast.error('Vyplňte datum a službu.'); return; }
    const service = SERVICES.find(s => s.id === bForm.serviceId);
    if (!service) { toast.error('Služba nenalezena.'); return; }
    const starts = new Date(`${bForm.date}T${bForm.time}:00`);
    const ends = new Date(starts.getTime() + service.d * 60000);
    setBSaving(true);
    try {
      const newBooking = await createBooking({ user_id: user.id, service_id: bForm.serviceId, staff_id: bForm.staffId || null, starts_at: starts.toISOString(), ends_at: ends.toISOString(), note: bForm.note });
      toast.success('Rezervace vytvořena.');
      setBookingModal(false);
      setAnchor(starts);
      await onRefresh();
      syncGcal('push', newBooking.id);
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setBSaving(false);
    }
  };

  const deleteEvt = async (id) => {
    try {
      syncGcal('delete', id);
      await deleteBooking(id);
      toast.success('Rezervace smazána.');
      setSelEvent(null);
      await onRefresh();
    } catch (e) {
      toast.error(e.message || 'Chyba při mazání.');
    }
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  return (
    <div>
      <div className="cal-toolbar">
        <div className="row gap-3" style={{ alignItems: 'center' }}>
          <Btn variant="ghost" icon={I.ChevLeft} size="sm" onClick={() => navigate(-1)} />
          <div className="cal-month">{monthLabel} <span className="it">{anchor.getFullYear()}</span></div>
          <Btn variant="ghost" icon={I.ChevRight} size="sm" onClick={() => navigate(1)} />
          {!isCurrentWeek && <Btn variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Dnes</Btn>}
        </div>
        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <Seg items={[{ v: 'week', l: 'Týden' }]} value={view} onChange={setView} />
          <Seg
            items={[{ v: 'all', l: 'Všichni' }, ...STAFF.filter(s => s.is_active).map(s => ({ v: s.id, l: s.name.split(' ')[0] }))]}
            value={staff}
            onChange={setStaff}
          />
          <Btn variant="accent" icon={I.Plus} size="sm" onClick={openBooking}>Nová rezervace</Btn>
        </div>
      </div>

      {bookingModal && (
        <div className="card lg" style={{ marginBottom: 16, padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Nová rezervace</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label className="col gap-2">
              <span className="lbl">Datum</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="date" value={bForm.date} onChange={e => setBForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">Čas</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="time" value={bForm.time} onChange={e => setBForm(f => ({ ...f, time: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2" style={{ gridColumn: '1 / -1' }}>
              <span className="lbl">Služba</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <select value={bForm.serviceId} onChange={e => setBForm(f => ({ ...f, serviceId: e.target.value }))} style={{ ...inputStyle }}>
                  <option value="">— vyberte —</option>
                  {SERVICES.map(s => <option key={s.id} value={s.id}>{s.name} ({s.d} min)</option>)}
                </select>
              </div>
            </label>
            {STAFF.length > 0 && (
              <label className="col gap-2" style={{ gridColumn: '1 / -1' }}>
                <span className="lbl">Zaměstnanec</span>
                <div className="field" style={{ padding: '8px 12px' }}>
                  <select value={bForm.staffId} onChange={e => setBForm(f => ({ ...f, staffId: e.target.value }))} style={{ ...inputStyle }}>
                    <option value="">Kdokoli je dostupný</option>
                    {STAFF.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </label>
            )}
            <label className="col gap-2" style={{ gridColumn: '1 / -1' }}>
              <span className="lbl">Poznámka (volitelná)</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Poznámka k rezervaci…" value={bForm.note} onChange={e => setBForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} />
              </div>
            </label>
          </div>
          <div className="row gap-2">
            <Btn variant="accent" size="sm" onClick={saveBooking} disabled={bSaving}>{bSaving ? 'Ukládám…' : 'Vytvořit rezervaci'}</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setBookingModal(false)}>Zrušit</Btn>
          </div>
        </div>
      )}

      {selEvent && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{selEvent.t}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{fmtTime(selEvent.s)} – {fmtTime(selEvent.e)}</div>
              {selEvent.staff_id && (() => { const sm = STAFF.find(s => s.id === selEvent.staff_id); return sm ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sm.name}</div> : null; })()}
            </div>
            <div className="row gap-2">
              <Btn variant="ghost" size="sm" icon={I.X} onClick={() => deleteEvt(selEvent.id)}>Zrušit rezervaci</Btn>
              <Btn variant="ghost" size="sm" icon={I.X} onClick={() => setSelEvent(null)} />
            </div>
          </div>
        </div>
      )}

      <div className="cal">
        <div className="cal-h gut" />
        {week.days.map((w, i) => (
          <div key={i} className={cx('cal-h', i === week.todayCol && isCurrentWeek && 'today')}>
            <div>{w.s}</div>
            <div className="d">{w.d}</div>
          </div>
        ))}

        <div className="cal-rail">
          {hours.map((h) => <div key={h} className="cal-row-time">{h}:00</div>)}
        </div>

        {events.length === 0 && (
          <div style={{ gridColumn: '2 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--ink-3)', fontSize: 13, padding: '60px 0' }}>
            <span>Tento týden žádné rezervace.</span>
            <Btn variant="ghost" size="sm" icon={I.Plus} onClick={openBooking}>Přidat rezervaci</Btn>
          </div>
        )}
        {week.days.map((w, col) => {
          const dim = col === 6;
          const colEvents = events.filter((e) => e.col === col);
          return (
            <div key={col} className={cx('cal-col', dim && 'dim')}>
              {hours.map((h) => <div key={h} className="cal-cell" />)}
              {colEvents.map((e, i) => {
                const top = (e.s - START_H) * ROW_H;
                const height = Math.max((e.e - e.s) * ROW_H - 4, 20);
                return (
                  <div
                    key={i}
                    className={cx('evt', e.c, e.ai && 'ai-suggest', selEvent?.id === e.id && 'on')}
                    style={{ top, height, cursor: 'pointer' }}
                    onClick={() => setSelEvent(selEvent?.id === e.id ? null : e)}
                  >
                    <div className="t">{e.t}</div>
                    <div className="s">{fmtTime(e.s)}–{fmtTime(e.e)}</div>
                  </div>
                );
              })}
              {col === week.todayCol && isCurrentWeek && (
                <div className="now-line" style={{ top: nowTop }}>
                  <div className="ball" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row gap-4" style={{ marginTop: 18, flexWrap: 'wrap' }}>
        <Tag variant="accent"><span className="d" />Rezervace</Tag>
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

const ClientsView = ({ onRefresh, onNavigate }) => {
  const { user } = useAuth();
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', vip: false });
  const [saving, setSaving] = useState(false);
  const [clientStats, setClientStats] = useState({ visits: 0, spend: 0 });
  const filtered = q
    ? CLIENTS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q))
    : CLIENTS;
  const client = CLIENTS.find((c) => c.id === sel) ?? (CLIENTS.length > 0 ? CLIENTS[0] : null);

  const clientBookings = client ? EVENTS.filter(e => e.customer_id === client.id).slice(0, 5) : [];
  const clientCalls = client ? CALLS.filter(c => c.phone === client.phone).slice(0, 5) : [];

  useEffect(() => {
    if (!client) return;
    fetchCustomerStats(client.id).then(setClientStats).catch(() => {});
  }, [client?.id]);

  const saveClient = async () => {
    if (!form.phone.trim()) { toast.error('Zadejte telefonní číslo.'); return; }
    setSaving(true);
    try {
      await upsertCustomer({ user_id: user.id, name: form.name.trim() || form.phone, phone: form.phone.trim(), notes: '', vip_status: form.vip });
      toast.success('Klient přidán.');
      setAddModal(false);
      setForm({ name: '', phone: '', email: '', vip: false });
      await onRefresh();
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

  const removeClient = async (phone) => {
    try {
      await deleteCustomerByPhone(phone);
      toast.success('Klient smazán.');
      setSel(null);
      await onRefresh();
    } catch (e) {
      toast.error(e.message || 'Chyba při mazání.');
    }
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  return (
    <div className="clients">
      <div className="list">
        <div className="list-hd">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="h-section" style={{ fontSize: 18 }}>Klienti</div>
            <Btn variant="ghost" icon={I.Plus} size="sm" onClick={() => setAddModal(true)} />
          </div>
          <div className="field">
            <I.Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat…" />
          </div>
        </div>

        {addModal && (
          <div className="card" style={{ margin: '0 0 12px', padding: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Nový klient</div>
            <div className="col gap-2" style={{ marginBottom: 12 }}>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Jméno" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} autoFocus />
              </div>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Telefon *" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} />
              </div>
              <div className="row gap-2" style={{ alignItems: 'center', fontSize: 13 }}>
                <Switch on={form.vip} onChange={v => setForm(f => ({ ...f, vip: v }))} />
                <span className="muted">VIP klient</span>
              </div>
            </div>
            <div className="row gap-2">
              <Btn variant="accent" size="sm" onClick={saveClient} disabled={saving}>{saving ? 'Ukládám…' : 'Přidat'}</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setAddModal(false)}>Zrušit</Btn>
            </div>
          </div>
        )}

        <div className="list-body">
          {filtered.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {q ? 'Žádné výsledky.' : 'Zatím žádní klienti. Přidají se automaticky po prvním hovoru nebo je přidejte ručně.'}
            </div>
          )}
          {filtered.map((c) => (
            <ClientRow key={c.id} c={c} on={sel === c.id} onClick={() => setSel(c.id)} />
          ))}
        </div>
      </div>

      <div className="profile">
        {!client ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ink-3)', fontSize: 13 }}>
            Vyberte klienta ze seznamu.
          </div>
        ) : (<>
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
                  {client.last !== '—' && <span className="row gap-2"><I.Clock s={12} />Poslední: {client.last}</span>}
                </div>
              </div>
              <div className="row gap-2">
                {client.phone && (
                  <a href={`tel:${client.phone}`} style={{ textDecoration: 'none' }}>
                    <Btn icon={I.Phone} size="sm">Zavolat</Btn>
                  </a>
                )}
                <Btn variant="accent" icon={I.Plus} size="sm" onClick={() => onNavigate('calendar', { note: client.name, phone: client.phone })}>Rezervovat</Btn>
                <Btn variant="ghost" icon={I.X} size="sm" onClick={() => removeClient(client.phone)} />
              </div>
            </div>
            {client.note && (
              <div className="note" style={{ marginTop: 22 }}>
                <div className="ic"><I.Sparkle s={16} /></div>
                <div className="body"><strong>Poznámka:</strong> {client.note}</div>
              </div>
            )}
          </div>

          <div className="stat-grid">
            <div className="stat"><div className="n">{clientStats.visits}</div><div className="l">rezervací celkem</div></div>
            <div className="stat"><div className="n">{clientCalls.length}</div><div className="l">hovorů celkem</div></div>
            <div className="stat"><div className="n">{clientStats.spend > 0 ? fmtPrice(clientStats.spend) : '—'}</div><div className="l">celkové výdaje</div></div>
            <div className="stat"><div className="n">{client?.last !== '—' ? client.last : '—'}</div><div className="l">poslední návštěva</div></div>
          </div>

          <div className="card">
            <div className="section-hd">
              <div className="h-section" style={{ fontSize: 18 }}>Aktivita</div>
            </div>
            <div className="tl">
              {clientBookings.length === 0 && clientCalls.length === 0 && (
                <div className="tl-item">
                  <div className="tl-d"><I.Calendar /></div>
                  <div className="tl-t">Zatím žádná aktivita</div>
                  <div className="tl-x">Rezervace a hovory se zobrazí automaticky.</div>
                </div>
              )}
              {clientBookings.map((e, i) => (
                <div key={i} className="tl-item">
                  <div className="tl-d"><I.Calendar /></div>
                  <div className="tl-t">{e.t}</div>
                  <div className="tl-x">Rezervace</div>
                  <div className="tl-w">{fmtTime(e.s)}</div>
                </div>
              ))}
              {clientCalls.map((c) => (
                <div key={c.id} className="tl-item">
                  <div className="tl-d"><I.Phone /></div>
                  <div className="tl-t">{c.outcome?.label ?? 'Hovor'}</div>
                  <div className="tl-x">{c.summary || ''}</div>
                  <div className="tl-w">{c.t}</div>
                </div>
              ))}
            </div>
          </div>
        </>)}
      </div>
    </div>
  );
};

/* ============================================================
   Services view
   ============================================================ */
const ServicesView = ({ onRefresh }) => {
  const { user } = useAuth();
  const [cat, setCat] = useState('all');
  const [modal, setModal] = useState(null); // null | {} (new) | {...service} (edit)
  const [menuId, setMenuId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', duration_min: 30, price: '', buffer_after_min: 0, category: '' });

  const cats = ['all', ...Array.from(new Set(SERVICES.map((s) => s.cat).filter(c => c && c !== 'Ostatní'))), 'Ostatní'].filter((v, i, a) => a.indexOf(v) === i);
  const rows = cat === 'all' ? SERVICES : SERVICES.filter((s) => s.cat === cat);
  const svcBookingCount = useMemo(() => {
    const counts = {};
    EVENTS.forEach(e => { if (e.service_id) counts[e.service_id] = (counts[e.service_id] || 0) + 1; });
    return counts;
  }, []);

  const openNew = () => { setForm({ name: '', duration_min: 30, price: '', buffer_after_min: 0, category: '' }); setModal({}); };
  const openEdit = (s) => { setForm({ name: s.name, duration_min: s.d, price: s.p ?? '', buffer_after_min: s.buffer_after_min ?? 0, category: s.cat === 'Ostatní' ? '' : (s.cat || '') }); setModal(s); setMenuId(null); };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Zadejte název služby.'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), duration_min: Number(form.duration_min) || 30, price: form.price !== '' ? Number(form.price) : null, buffer_after_min: Number(form.buffer_after_min) || 0, category: form.category.trim() || null };
      if (modal?.id) {
        await updateService(modal.id, payload);
        toast.success('Služba upravena.');
      } else {
        await createService({ user_id: user.id, ...payload });
        toast.success('Služba přidána.');
      }
      setModal(null);
      await onRefresh();
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setMenuId(null);
    try {
      await deleteService(id);
      toast.success('Služba smazána.');
      await onRefresh();
    } catch (e) {
      toast.error(e.message || 'Chyba při mazání.');
    }
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

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
          <Btn variant="accent" icon={I.Plus} size="sm" onClick={openNew}>Nová služba</Btn>
        </div>
      </div>

      {modal !== null && (
        <div className="card lg" style={{ marginBottom: 20, padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>{modal?.id ? 'Upravit službu' : 'Nová služba'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label className="col gap-2" style={{ gridColumn: '1 / -1' }}>
              <span className="lbl">Název</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Např. Střih + foukaná" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} autoFocus />
              </div>
            </label>
            <label className="col gap-2" style={{ gridColumn: '1 / -1' }}>
              <span className="lbl">Kategorie</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Vlasy, Barva, Péče, Nehty…" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">Délka (min)</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="number" min="5" step="5" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">Cena (Kč)</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="number" min="0" placeholder="nepovinné" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">Buffer po službě (min)</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="number" min="0" step="5" value={form.buffer_after_min} onChange={e => setForm(f => ({ ...f, buffer_after_min: e.target.value }))} style={inputStyle} />
              </div>
            </label>
          </div>
          {modal?.id && (
            <div className="row gap-3" style={{ alignItems: 'center' }}>
              <Switch on={modal.on ?? true} onChange={async (v) => {
                try { await updateService(modal.id, { is_active: v }); setModal(m => ({ ...m, on: v })); await onRefresh(); } catch {}
              }} />
              <span className="lbl" style={{ fontWeight: 400 }}>{modal.on ?? true ? 'Aktivní' : 'Neaktivní'}</span>
            </div>
          )}
          <div className="row gap-2">
            <Btn variant="accent" size="sm" onClick={save} disabled={saving}>{saving ? 'Ukládám…' : modal?.id ? 'Uložit změny' : 'Přidat službu'}</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setModal(null)}>Zrušit</Btn>
          </div>
        </div>
      )}

      <div className="svc-table">
        <table>
          <thead>
            <tr>
              <th>Služba</th>
              <th style={{ width: 110 }}>Délka</th>
              <th style={{ width: 130 }}>Cena</th>
              <th style={{ width: 110 }}>Stav</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-3)', fontSize: 13 }}>
                Zatím žádné služby. Klikněte + Nová služba.
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="svc-name">{s.name}</div>
                  <div className="svc-cat">{s.cat}{s.buffer_after_min > 0 ? ` · +${s.buffer_after_min} min buffer` : ''}</div>
                </td>
                <td className="num muted">{s.d} min</td>
                <td className="num" style={{ fontWeight: 500 }}>{s.p != null ? fmtPrice(s.p) : '—'}</td>
                <td>
                  {s.on
                    ? <Tag variant="live"><span className="d" />Aktivní</Tag>
                    : <Tag>Neaktivní</Tag>
                  }
                </td>
                <td style={{ position: 'relative' }}>
                  <Btn variant="ghost" icon={I.MoreH} size="sm" onClick={() => setMenuId(menuId === s.id ? null : s.id)} />
                  {menuId === s.id && (
                    <div className="card" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, padding: '6px 0', minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                      <button onClick={() => openEdit(s)} style={{ display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: 'var(--ink)', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>Upravit</button>
                      <button onClick={() => remove(s.id)} style={{ display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: '#f87171', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>Smazat</button>
                    </div>
                  )}
                </td>
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
const SetAI = ({ user, companySettings, onSettingsSaved }) => {
  const [voice, setVoice] = useState(() => companySettings?.ai_voice ?? 'nikola');
  const [tone, setTone] = useState(() => companySettings?.ai_tone ?? 'warm');
  const [autoBook, setAutoBook] = useState(() => companySettings?.ai_auto_book ?? true);
  const [confirmSms, setConfirmSms] = useState(() => companySettings?.ai_confirm_sms ?? true);
  const [reminderEnabled, setReminderEnabled] = useState(() => companySettings?.reminder_enabled !== false);
  const [aiPaused, setAiPaused] = useState(() => companySettings?.ai_paused ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companySettings) return;
    setVoice(companySettings.ai_voice ?? 'nikola');
    setTone(companySettings.ai_tone ?? 'warm');
    setAutoBook(companySettings.ai_auto_book ?? true);
    setConfirmSms(companySettings.ai_confirm_sms ?? true);
    setReminderEnabled(companySettings.reminder_enabled !== false);
    setAiPaused(companySettings.ai_paused ?? false);
  }, [companySettings]);

  const companyName = companySettings?.company_name || 'váš salon';

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const saved = await saveCompanySettings(user.id, { ...(companySettings ?? {}), ai_voice: voice, ai_tone: tone, ai_auto_book: autoBook, ai_confirm_sms: confirmSms, reminder_enabled: reminderEnabled, ai_paused: aiPaused });
      onSettingsSaved?.(saved);
      toast.success('Nastavení AI uloženo.');
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

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
          <div className="desc">Výběr hlasu bude dostupný po propojení s telefonií.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {voices.map((v) => (
            <div key={v.id} className={cx('voice-card', voice === v.id && 'on')} onClick={() => setVoice(v.id)}>
              <div className="h">
                <div className="nm">{v.name}</div>
                <Btn variant="ghost" size="sm" icon={I.Play} disabled title="Ukázky hlasů budou dostupné po propojení s Twilio" onClick={(e) => e.stopPropagation()} />
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
              {tone === 'warm'   && `„Dobrý den, ${companyName}, Nikola u telefonu. Jak vám mohu pomoci?"`}
              {tone === 'formal' && `„Dobrý den, ${companyName}, u telefonu Nikola. S čím mohu posloužit?"`}
              {tone === 'short'  && `„${companyName}, dobrý den."`}
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
          <div className="lbl">Připomínky rezervací</div>
          <div className="desc">SMS zákazníkovi den před termínem.</div>
        </div>
        <Switch on={reminderEnabled} onChange={setReminderEnabled} />
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Pozastavit AI recepční</div>
          <div className="desc">Hovory se přepojí přímo na váš telefon.</div>
        </div>
        <Switch on={aiPaused} onChange={setAiPaused} />
      </div>
      <div className="form-row">
        <div style={{ marginTop: 8 }}>
          <Btn variant="accent" size="sm" onClick={save} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit nastavení'}</Btn>
        </div>
      </div>
    </div>
  );
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];

function workingHoursToDays(wh) {
  return DAY_KEYS.map((key, i) => {
    const intervals = (wh ?? {})[key] ?? [];
    const first = intervals[0];
    return { d: DAY_LABELS[i], key, on: intervals.length > 0, from: first?.start ?? '09:00', to: first?.end ?? '17:00' };
  });
}

function daysToWorkingHours(days) {
  return Object.fromEntries(days.map(d => [d.key, d.on ? [{ start: d.from, end: d.to }] : []]));
}

const SetHours = ({ user, companySettings, onSettingsSaved }) => {
  const [days, setDays] = useState(() => workingHoursToDays(companySettings?.working_hours));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDays(workingHoursToDays(companySettings?.working_hours));
  }, [companySettings]);

  const toggle = (i) => {
    setDays(prev => { const n = [...prev]; n[i] = { ...n[i], on: !n[i].on }; return n; });
  };
  const setTime = (i, field, val) => {
    setDays(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: val }; return n; });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveCompanySettings(user.id, { ...(companySettings ?? {}), working_hours: daysToWorkingHours(days) });
      onSettingsSaved(saved);
      toast.success('Provozní doba uložena.');
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: 60 };

  return (
    <div className="card lg">
      <div className="eyebrow">Provozní doba</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>Kdy přijímáte klienty</div>
      {days.map((d, i) => (
        <div key={d.key} className="hours-row">
          <div className="dow">{d.d}</div>
          {d.on ? (
            <div className="row gap-2">
              <div className="field" style={{ padding: '6px 12px', fontSize: 13, minWidth: 90 }}>
                <input className="mono" type="time" value={d.from} onChange={e => setTime(i, 'from', e.target.value)} style={inputStyle} />
              </div>
              <span className="muted" style={{ fontSize: 12 }}>až</span>
              <div className="field" style={{ padding: '6px 12px', fontSize: 13, minWidth: 90 }}>
                <input className="mono" type="time" value={d.to} onChange={e => setTime(i, 'to', e.target.value)} style={inputStyle} />
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>Zavřeno</div>
          )}
          <Switch on={d.on} onChange={() => toggle(i)} />
        </div>
      ))}
      <div className="row gap-2" style={{ marginTop: 18 }}>
        <Btn variant="accent" size="sm" onClick={save} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit změny'}</Btn>
      </div>
    </div>
  );
};

const SetRules = ({ user, companySettings, onSettingsSaved }) => {
  const parseRules = (settings) => {
    try { return JSON.parse(settings?.ai_notes ?? '[]'); } catch { return []; }
  };
  const [rules, setRules] = useState(() => parseRules(companySettings));
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setRules(parseRules(companySettings)); }, [companySettings]);

  const persist = async (next) => {
    if (!user) return;
    setSaving(true);
    try {
      const saved = await saveCompanySettings(user.id, { ...(companySettings ?? {}), ai_notes: JSON.stringify(next) });
      onSettingsSaved?.(saved);
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = useCallback((id) => {
    setRules((prev) => {
      const next = prev.map((r) => r.id === id ? { ...r, on: !r.on } : r);
      persist(next);
      return next;
    });
  }, [companySettings, user]);

  const addRule = async () => {
    if (!newTitle.trim()) return;
    const next = [...rules, { id: Date.now().toString(), t: newTitle.trim(), x: newDesc.trim(), on: true }];
    setRules(next);
    await persist(next);
    setNewTitle(''); setNewDesc(''); setAdding(false);
  };

  const removeRule = (id) => {
    const next = rules.filter(r => r.id !== id);
    setRules(next);
    persist(next);
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

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
        <Btn variant="accent" icon={I.Plus} size="sm" onClick={() => setAdding(true)}>Nové pravidlo</Btn>
      </div>

      {adding && (
        <div className="card thin" style={{ marginTop: 16, padding: 16 }}>
          <div className="col gap-2">
            <div className="field" style={{ padding: '8px 12px' }}>
              <input placeholder="Název pravidla…" value={newTitle} onChange={e => setNewTitle(e.target.value)} style={inputStyle} autoFocus />
            </div>
            <div className="field" style={{ padding: '8px 12px' }}>
              <input placeholder="Popis (volitelný)…" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={inputStyle} />
            </div>
            <div className="row gap-2">
              <Btn variant="accent" size="sm" onClick={addRule} disabled={saving || !newTitle.trim()}>Přidat</Btn>
              <Btn variant="ghost" size="sm" onClick={() => { setAdding(false); setNewTitle(''); setNewDesc(''); }}>Zrušit</Btn>
            </div>
          </div>
        </div>
      )}

      <div className="col gap-2" style={{ marginTop: 24 }}>
        {rules.length === 0 && !adding && (
          <div className="muted" style={{ fontSize: 13, padding: '12px 0' }}>Zatím žádná pravidla. Klikněte + Nové pravidlo.</div>
        )}
        {rules.map((r) => (
          <div key={r.id} className={cx('rule', r.on && 'on')}>
            <div className="rule-ic"><I.Sparkle s={14} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.t}</div>
              {r.x && <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.55 }}>{r.x}</div>}
            </div>
            <Switch on={r.on} onChange={() => toggle(r.id)} />
            <Btn variant="ghost" size="sm" icon={I.X} onClick={() => removeRule(r.id)} />
          </div>
        ))}
      </div>
    </div>
  );
};

const SetInteg = ({ user, companySettings, onSettingsSaved }) => {
  const [expanded, setExpanded]   = useState(null);
  const [twilioPhone, setTwilioPhone]   = useState(companySettings?.twilio_phone_number ?? '');
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [gcalConnected, setGcalConnected] = useState(!!(companySettings?.gcal_access_token));
  const [syncingGcal, setSyncingGcal] = useState(false);

  useEffect(() => {
    setTwilioPhone(companySettings?.twilio_phone_number ?? '');
    setGcalConnected(!!(companySettings?.gcal_access_token));
  }, [companySettings]);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
  const twilioWebhookUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/twilio-voice` : '';

  async function saveTwilioPhone() {
    if (!user) return;
    setSavingTwilio(true);
    try {
      await saveCompanySettings(user.id, { twilio_phone_number: twilioPhone.trim() || null });
      toast.success('Twilio číslo uloženo.');
      if (onSettingsSaved) onSettingsSaved();
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSavingTwilio(false);
    }
  }

  async function connectGoogleCalendar() {
    if (!user || !SUPABASE_URL) { toast.error('Konfigurace není dostupná.'); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    window.location.href = `${SUPABASE_URL}/functions/v1/google-calendar-auth?action=authorize`;
  }

  async function syncGcal() {
    if (!user || !SUPABASE_URL) return;
    setSyncingGcal(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/google-calendar-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'push' }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);
      toast.success(`Synchronizováno ${result.pushed} rezervací do Google Kalendáře.`);
    } catch (e) {
      toast.error(e.message || 'Chyba při synchronizaci.');
    } finally {
      setSyncingGcal(false);
    }
  }

  const soonItems = [
    { id: 'res',   n: 'Reservio',      d: 'Import stávajících rezervací a klientů', i: I.Globe      },
    { id: 'pos',   n: 'Storyous POS',  d: 'Propojit platby a útratu klientů',       i: I.CreditCard },
    { id: 'mch',   n: 'Mailchimp',     d: 'Klienti do e-mailových kampaní',         i: I.Mail       },
    { id: 'slack', n: 'Slack',         d: 'Notifikace o důležitých hovorech',       i: I.Bell       },
  ];

  const inputSt = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%', fontFamily: 'inherit' };

  return (
    <div className="col gap-4">
      {/* ── Twilio ──────────────────────────────────────────────── */}
      <div className="card lg">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div className="eyebrow">Telefonie</div>
            <div className="h-section" style={{ fontSize: 20, marginTop: 6 }}>Twilio · AI recepční</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <I.Phone s={18} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Propojte Twilio číslo, aby AI recepční Nikola přijímala hovory a rezervovala termíny.
        </div>

        <div className="col gap-3">
          <div>
            <div className="lbl" style={{ marginBottom: 6 }}>Vaše Twilio telefonní číslo</div>
            <div className="row gap-2">
              <input
                style={inputSt}
                value={twilioPhone}
                onChange={e => setTwilioPhone(e.target.value)}
                placeholder="+420 XXX XXX XXX"
              />
              <Btn variant="accent" size="sm" onClick={saveTwilioPhone} disabled={savingTwilio}>
                {savingTwilio ? 'Ukládám…' : 'Uložit'}
              </Btn>
            </div>
          </div>

          {twilioWebhookUrl && (
            <div>
              <div className="lbl" style={{ marginBottom: 6 }}>Voice Webhook URL <span className="muted">(nastavte v Twilio Console)</span></div>
              <div className="field row gap-2" style={{ padding: '8px 12px', alignItems: 'center' }}>
                <span className="mono muted" style={{ fontSize: 12, flex: 1, wordBreak: 'break-all' }}>{twilioWebhookUrl}</span>
                <Btn variant="ghost" size="sm" icon={I.Copy} onClick={() => { navigator.clipboard.writeText(twilioWebhookUrl); toast.success('Zkopírováno'); }} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.55 }}>
                V Twilio Console → Phone Numbers → Active Numbers → vyberte číslo → Voice Configuration → nastavte tento URL jako webhook při příchozím hovoru (HTTP POST).
              </div>
            </div>
          )}

          <div className="card thin" style={{ padding: '12px 16px', background: 'var(--accent-soft)' }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Jak to funguje</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              Zákazník zavolá na vaše Twilio číslo → Nikola (AI) se představí a zeptá se, co zákazník potřebuje → Claude zpracuje odpověď a zarezervuje termín → Zákazník dostane SMS potvrzení.
            </div>
          </div>
        </div>
      </div>

      {/* ── Google Calendar ─────────────────────────────────────── */}
      <div className="card lg">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div className="eyebrow">Kalendář</div>
            <div className="h-section" style={{ fontSize: 20, marginTop: 6 }}>Google Calendar</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {gcalConnected && <Tag variant="live"><I.Check s={10} />Propojeno</Tag>}
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <I.Calendar s={18} />
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Synchronizujte rezervace z PlanLess do Google Kalendáře. Propojení vyžaduje Google účet.
        </div>

        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {!gcalConnected ? (
            <Btn variant="accent" icon={I.Link} onClick={connectGoogleCalendar}>
              Propojit Google Kalendář
            </Btn>
          ) : (
            <>
              <Btn variant="accent" icon={I.Calendar} onClick={syncGcal} disabled={syncingGcal}>
                {syncingGcal ? 'Synchronizuji…' : 'Synchronizovat teď'}
              </Btn>
              <Btn variant="ghost" icon={I.X} onClick={async () => {
                await saveCompanySettings(user.id, { gcal_access_token: null, gcal_refresh_token: null });
                setGcalConnected(false);
                toast.success('Google Kalendář odpojen.');
              }}>Odpojit</Btn>
            </>
          )}
        </div>
      </div>

      {/* ── Připravujeme ────────────────────────────────────────── */}
      <div className="card lg">
        <div className="eyebrow" style={{ marginBottom: 16 }}>Připravujeme</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          {soonItems.map((it) => {
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
                      <Tag>Připravujeme</Tag>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{it.d}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const PLAN_FEATURES = [
  'Neomezené rezervace a klienti',
  'AI recepční Nikola (telefonní hovory)',
  'SMS potvrzení a připomínky',
  'Google Calendar synchronizace',
  'Správa zaměstnanců',
  'Statistiky a CSV export',
];

const SetBilling = () => {
  const { user, isSubscribed, stripeCustomerId, refreshProfile } = useAuth();
  const [billing, setBilling] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';

  const callsCount = CALLS.length;
  const bookingsCount = EVENTS.length;
  const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  // Check for payment success in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      toast.success('Platba proběhla úspěšně! Váš účet je nyní aktivní.');
      refreshProfile?.(user?.id);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const startCheckout = async () => {
    if (!user || !SUPABASE_URL) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing }),
      });
      const { url, error } = await resp.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch (e) {
      toast.error(e.message || 'Nepodařilo se otevřít platební bránu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col gap-4">
      <div className="card lg" style={{ background: 'linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--paper)', borderColor: 'var(--accent-ring)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow">Váš plán</div>
            <div className="h-display" style={{ marginTop: 10, fontSize: 38 }}>
              {isSubscribed ? 'Pro' : 'Zkušební verze'}
            </div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>
              {isSubscribed ? 'Plný přístup ke všem funkcím.' : 'Plné funkce · zdarma během testování'}
            </div>
          </div>
          <div className="col gap-2" style={{ alignItems: 'flex-end' }}>
            <Tag variant={isSubscribed ? 'live' : 'warn'}><I.Check s={10} />{isSubscribed ? 'Aktivní předplatné' : 'Zkušební verze'}</Tag>
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--line)', margin: '24px 0 20px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Hovory celkem</div>
            <div className="h-display" style={{ fontSize: 26, marginTop: 6 }}>{callsCount}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Rezervace celkem</div>
            <div className="h-display" style={{ fontSize: 26, marginTop: 6 }}>{bookingsCount}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Zákazník od</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 6 }}>{memberSince}</div>
          </div>
        </div>
      </div>

      {!isSubscribed && (
        <div className="card lg">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="h-section" style={{ fontSize: 18, marginBottom: 4 }}>Aktivovat předplatné</div>
              <div className="muted" style={{ fontSize: 13 }}>Plný přístup ke všem funkcím PlanLess</div>
            </div>
            <Seg items={[{ v: 'monthly', l: 'Měsíčně' }, { v: 'yearly', l: 'Ročně −20 %' }]} value={billing} onChange={setBilling} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
            {PLAN_FEATURES.map(f => (
              <div key={f} className="row gap-2" style={{ fontSize: 13.5, color: 'var(--ink-2)', alignItems: 'center' }}>
                <I.Check s={14} style={{ color: 'var(--accent)', flexShrink: 0 }} /> {f}
              </div>
            ))}
          </div>

          <div className="row gap-3" style={{ alignItems: 'center' }}>
            <Btn variant="accent" onClick={startCheckout} disabled={loading}>
              {loading ? 'Přesměrovávám…' : billing === 'yearly' ? 'Aktivovat za 990 Kč/rok' : 'Aktivovat za 99 Kč/měsíc'}
            </Btn>
            <div className="muted" style={{ fontSize: 12 }}>14 dní zdarma · zrušení kdykoliv · platba kartou přes Stripe</div>
          </div>
        </div>
      )}

      {isSubscribed && stripeCustomerId && (
        <div className="card lg">
          <div className="h-section" style={{ fontSize: 18, marginBottom: 8 }}>Správa předplatného</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
            Faktury, změna platební metody nebo zrušení předplatného přes Stripe portál.
          </div>
          <Btn variant="ghost" size="sm" icon={I.ArrowR} onClick={() => window.open('https://billing.stripe.com/p/login', '_blank')}>
            Otevřít Stripe portál
          </Btn>
        </div>
      )}
    </div>
  );
};

const SetCompany = ({ user, companySettings, onSettingsSaved }) => {
  const [form, setForm] = useState({
    company_name:        companySettings?.company_name        ?? '',
    public_phone:        companySettings?.public_phone        ?? '',
    public_email:        companySettings?.public_email        ?? '',
    website_url:         companySettings?.website_url         ?? '',
    address_line1:       companySettings?.address_line1       ?? '',
    city:                companySettings?.city                ?? '',
    postal_code:         companySettings?.postal_code         ?? '',
    company_description: companySettings?.company_description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!companySettings) return;
    setForm({
      company_name:        companySettings.company_name        ?? '',
      public_phone:        companySettings.public_phone        ?? '',
      public_email:        companySettings.public_email        ?? '',
      website_url:         companySettings.website_url         ?? '',
      address_line1:       companySettings.address_line1       ?? '',
      city:                companySettings.city                ?? '',
      postal_code:         companySettings.postal_code         ?? '',
      company_description: companySettings.company_description ?? '',
    });
  }, [companySettings]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    try {
      if (file.name.endsWith('.txt')) {
        const text = await file.text();
        setForm(p => ({ ...p, company_description: text.trim() }));
        toast.success('Textový soubor načten.');
      } else if (file.name.endsWith('.docx')) {
        const buf = await file.arrayBuffer();
        const { extractDocxText } = await import('../lib/docxReader.js');
        const text = await extractDocxText(buf);
        setForm(p => ({ ...p, company_description: text.trim() }));
        toast.success('Dokument načten a text extrahován.');
      } else {
        toast.error('Podporované formáty: .txt, .docx');
      }
    } catch (err) {
      toast.error('Nepodařilo se načíst soubor: ' + err.message);
    } finally {
      setFileLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  const save = async () => {
    if (!form.company_name.trim()) { toast.error('Zadejte název firmy.'); return; }
    setSaving(true);
    try {
      const saved = await saveCompanySettings(user.id, { ...(companySettings ?? {}), ...form });
      onSettingsSaved?.(saved);
      toast.success('Profil firmy uložen.');
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };
  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  return (
    <div className="card lg">
      <div className="eyebrow">Firma</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>
        Profil <span className="serif-it" style={{ color: 'var(--accent)' }}>vaší firmy</span>
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Název firmy</div>
          <div className="desc">Nikola toto jméno používá při představování zákazníkům po telefonu.</div>
        </div>
        <div className="field" style={{ padding: '8px 12px' }}>
          <input placeholder="Salon Krása s.r.o." value={form.company_name} onChange={f('company_name')} style={inputStyle} autoFocus />
        </div>
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Telefonní číslo</div>
          <div className="desc">Veřejné číslo zobrazené zákazníkům.</div>
        </div>
        <div className="field" style={{ padding: '8px 12px' }}>
          <input type="tel" placeholder="+420 111 222 333" value={form.public_phone} onChange={f('public_phone')} style={inputStyle} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">E-mail</div>
          <div className="desc">Kontaktní e-mail pro zákazníky a notifikace.</div>
        </div>
        <div className="field" style={{ padding: '8px 12px' }}>
          <input type="email" placeholder="info@salon.cz" value={form.public_email} onChange={f('public_email')} style={inputStyle} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Webová stránka</div>
          <div className="desc">URL vašeho webu nebo sociálních sítí.</div>
        </div>
        <div className="field" style={{ padding: '8px 12px' }}>
          <input type="url" placeholder="https://salon.cz" value={form.website_url} onChange={f('website_url')} style={inputStyle} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <div className="lbl">Adresa</div>
          <div className="desc">Kde zákazníci salon najdou — Nikola ji sdělí při rezervaci.</div>
        </div>
        <div className="col gap-2" style={{ flex: 1 }}>
          <div className="field" style={{ padding: '8px 12px' }}>
            <input placeholder="Ulice a číslo popisné" value={form.address_line1} onChange={f('address_line1')} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
            <div className="field" style={{ padding: '8px 12px' }}>
              <input placeholder="Město" value={form.city} onChange={f('city')} style={inputStyle} />
            </div>
            <div className="field" style={{ padding: '8px 12px' }}>
              <input placeholder="PSČ" value={form.postal_code} onChange={f('postal_code')} style={inputStyle} />
            </div>
          </div>
        </div>
      </div>
      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="lbl">Popis firmy pro AI</div>
          <div className="desc">Nahrjte Word dokument nebo vložte text — Nikola ho použije při odpovídání klientům. Čím víc ví, tím lépe poradí.</div>
        </div>
        <div className="col gap-2" style={{ flex: 1 }}>
          <textarea
            value={form.company_description}
            onChange={e => setForm(p => ({ ...p, company_description: e.target.value }))}
            placeholder="Popište svou firmu, speciality, ceny, pravidla objednávání, co dělat v případě alergie, jak probíhá konzultace…"
            rows={6}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
          />
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept=".txt,.docx" style={{ display: 'none' }} onChange={handleFileUpload} />
            <Btn variant="ghost" size="sm" icon={I.Plus} onClick={() => fileRef.current?.click()} disabled={fileLoading}>
              {fileLoading ? 'Načítám…' : 'Nahrát .txt nebo .docx'}
            </Btn>
            {form.company_description && (
              <span className="muted" style={{ fontSize: 12 }}>{form.company_description.length} znaků</span>
            )}
          </div>
        </div>
      </div>
      <div className="form-row">
        <div style={{ marginTop: 8 }}>
          <Btn variant="accent" size="sm" onClick={save} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit profil'}</Btn>
        </div>
      </div>
    </div>
  );
};

const SetAccount = ({ user }) => {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const changePw = async () => {
    if (pw.length < 8) { toast.error('Heslo musí mít alespoň 8 znaků.'); return; }
    if (pw !== pw2) { toast.error('Hesla se neshodují.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success('Heslo bylo změněno.');
      setPw(''); setPw2('');
    } catch (e) {
      toast.error(e.message || 'Chyba při změně hesla.');
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_user');
      if (error) throw error;
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (e) {
      toast.error(e.message || 'Chyba při mazání účtu.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  return (
    <div className="col gap-4">
      <div className="card lg">
        <div className="eyebrow">Účet</div>
        <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>
          Vaše <span className="serif-it" style={{ color: 'var(--accent)' }}>přihlašovací údaje</span>
        </div>
        <div className="form-row">
          <div>
            <div className="lbl">E-mail</div>
            <div className="desc">Váš přihlašovací e-mail nelze změnit přímo — kontaktujte podporu.</div>
          </div>
          <div className="field" style={{ padding: '8px 12px', opacity: 0.6, cursor: 'not-allowed' }}>
            <input value={user?.email ?? ''} readOnly style={{ ...inputStyle, cursor: 'not-allowed' }} />
          </div>
        </div>
        <div className="form-row">
          <div>
            <div className="lbl">Nové heslo</div>
            <div className="desc">Alespoň 8 znaků, velké písmeno, číslice a symbol.</div>
          </div>
          <div className="col gap-2" style={{ flex: 1 }}>
            <div className="field" style={{ padding: '8px 12px' }}>
              <input type="password" placeholder="Nové heslo" value={pw} onChange={e => setPw(e.target.value)} style={inputStyle} autoComplete="new-password" />
            </div>
            <div className="field" style={{ padding: '8px 12px' }}>
              <input type="password" placeholder="Potvrdit nové heslo" value={pw2} onChange={e => setPw2(e.target.value)} style={inputStyle} autoComplete="new-password" />
            </div>
            <div>
              <Btn variant="accent" size="sm" onClick={changePw} disabled={saving || !pw}>{saving ? 'Ukládám…' : 'Změnit heslo'}</Btn>
            </div>
          </div>
        </div>
      </div>

      <div className="card lg">
        <div className="h-section" style={{ fontSize: 18, marginBottom: 8 }}>Nebezpečná zóna</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          Smazání účtu je nevratné. Všechna data (klienti, rezervace, hovory) budou trvale odstraněna.
        </div>
        {!confirmDelete ? (
          <Btn variant="ghost" size="sm" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }} onClick={() => setConfirmDelete(true)}>
            Smazat účet
          </Btn>
        ) : (
          <div className="card thin" style={{ padding: 16, borderColor: 'rgba(248,113,113,0.3)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 8, color: '#f87171' }}>Opravdu chcete smazat účet?</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Tato akce je nevratná. Všechna data budou smazána.</div>
            <div className="row gap-2">
              <Btn size="sm" style={{ background: '#f87171', color: '#fff', border: 'none' }} onClick={deleteAccount} disabled={deleting}>
                {deleting ? 'Mažu…' : 'Ano, smazat navždy'}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Zrušit</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const STAFF_COLORS = ['#6366f1', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6'];

const SetStaff = ({ user }) => {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', color: '#6366f1' });
  const [saving, setSaving] = useState(false);
  const inputStyle = { background: 'transparent', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)', width: '100%' };

  useEffect(() => {
    if (!user) return;
    fetchStaff().then(rows => { STAFF = rows; setStaffList(rows); }).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const openAdd = () => {
    setEditId(null);
    setForm({ name: '', email: '', phone: '', color: '#6366f1' });
    setModal(true);
  };

  const openEdit = (s) => {
    setEditId(s.id);
    setForm({ name: s.name, email: s.email || '', phone: s.phone || '', color: s.color || '#6366f1' });
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Zadejte jméno.'); return; }
    setSaving(true);
    try {
      if (editId) {
        const updated = await updateStaff(editId, { name: form.name, email: form.email || null, phone: form.phone || null, color: form.color });
        STAFF = STAFF.map(s => s.id === editId ? updated : s);
      } else {
        const created = await createStaff({ name: form.name, email: form.email || null, phone: form.phone || null, color: form.color });
        STAFF = [...STAFF, created];
      }
      setStaffList([...STAFF]);
      setModal(false);
      toast.success(editId ? 'Zaměstnanec uložen.' : 'Zaměstnanec přidán.');
    } catch (e) {
      toast.error(e.message || 'Chyba při ukládání.');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    try {
      await deleteStaff(id);
      STAFF = STAFF.filter(s => s.id !== id);
      setStaffList([...STAFF]);
      toast.success('Zaměstnanec smazán.');
    } catch (e) {
      toast.error(e.message || 'Chyba při mazání.');
    }
  };

  const toggleActive = async (s) => {
    try {
      const updated = await updateStaff(s.id, { is_active: !s.is_active });
      STAFF = STAFF.map(m => m.id === s.id ? updated : m);
      setStaffList([...STAFF]);
    } catch (e) {
      toast.error(e.message || 'Chyba.');
    }
  };

  return (
    <div className="card lg">
      <div className="eyebrow">Tým</div>
      <div className="h-section" style={{ marginTop: 8, marginBottom: 22, fontSize: 22 }}>
        Správa <span className="serif-it" style={{ color: 'var(--accent)' }}>zaměstnanců</span>
      </div>

      {loading ? (
        <div className="muted" style={{ fontSize: 13 }}>Načítám...</div>
      ) : (
        <div className="col gap-3" style={{ marginBottom: 20 }}>
          {staffList.length === 0 && !modal && (
            <div className="muted" style={{ fontSize: 13, padding: '12px 0' }}>Zatím žádní zaměstnanci. Přidejte prvního.</div>
          )}
          {staffList.map(s => (
            <div key={s.id} className="card thin" style={{ padding: '12px 16px' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="row gap-3" style={{ alignItems: 'center' }}>
                  <div className="av" style={{ background: s.color || 'var(--accent)', color: '#fff', fontWeight: 600 }}>
                    {s.initials || s.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{s.email || s.phone || 'Bez kontaktu'}</div>
                  </div>
                </div>
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <Switch on={s.is_active} onChange={() => toggleActive(s)} />
                  <Btn variant="ghost" size="sm" onClick={() => openEdit(s)}>Upravit</Btn>
                  <Btn variant="ghost" size="sm" onClick={() => del(s.id)}><I.X s={14} /></Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="card thin" style={{ padding: 20, marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>{editId ? 'Upravit' : 'Přidat'} zaměstnance</div>
          <div className="col gap-3">
            <label className="col gap-2">
              <span className="lbl">Jméno *</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input placeholder="Jana Nováková" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} autoFocus />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">E-mail</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="email" placeholder="jana@salon.cz" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label className="col gap-2">
              <span className="lbl">Telefon</span>
              <div className="field" style={{ padding: '8px 12px' }}>
                <input type="tel" placeholder="+420 777 111 222" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} />
              </div>
            </label>
            <div className="col gap-2">
              <span className="lbl">Barva v kalendáři</span>
              <div className="row gap-2">
                {STAFF_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                      outline: form.color === c ? '3px solid var(--accent)' : '3px solid transparent',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="row gap-2">
              <Btn variant="accent" size="sm" onClick={save} disabled={saving}>{saving ? 'Ukládám…' : editId ? 'Uložit' : 'Přidat'}</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setModal(false)}>Zrušit</Btn>
            </div>
          </div>
        </div>
      )}

      <Btn variant="ghost" size="sm" icon={I.Plus} onClick={openAdd}>Přidat zaměstnance</Btn>
    </div>
  );
};

/* ============================================================
   Analytics View
   ============================================================ */
const AnalyticsView = () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1); weekStart.setHours(0,0,0,0);

  const monthEvents = EVENTS.filter(e => new Date(e.starts_at) >= monthStart);
  const weekEvents  = EVENTS.filter(e => new Date(e.starts_at) >= weekStart);
  const monthCalls  = CALLS.filter(c => c.created_at && new Date(c.created_at) >= monthStart);

  const revenue = monthEvents.reduce((sum, e) => {
    const svc = SERVICES.find(s => s.id === e.service_id);
    return sum + (svc?.p ?? 0);
  }, 0);
  const weekRevenue = weekEvents.reduce((sum, e) => {
    const svc = SERVICES.find(s => s.id === e.service_id);
    return sum + (svc?.p ?? 0);
  }, 0);

  const booked = monthCalls.filter(c => c.status === 'booked').length;
  const convRate = monthCalls.length > 0 ? Math.round((booked / monthCalls.length) * 100) : 0;

  // 14-day bar chart data
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now); d.setDate(now.getDate() - 13 + i); d.setHours(0,0,0,0);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const count = EVENTS.filter(e => { const s = new Date(e.starts_at); return s >= d && s < next; }).length;
    return { date: d, count, label: d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) };
  });
  const maxCount = Math.max(...days14.map(d => d.count), 1);

  // Top services
  const svcCounts = SERVICES.map(s => ({
    ...s,
    bookings: EVENTS.filter(e => e.service_id === s.id).length,
    monthRev: EVENTS.filter(e => e.service_id === s.id && new Date(e.starts_at) >= monthStart).reduce((sum) => sum + (s.p ?? 0), 0),
  })).filter(s => s.bookings > 0).sort((a, b) => b.bookings - a.bookings).slice(0, 5);

  // CSV export
  const exportCsv = () => {
    const rows = [
      ['Termín', 'Zákazník', 'Služba', 'Cena'],
      ...EVENTS.map(e => {
        const svc = SERVICES.find(s => s.id === e.service_id);
        return [
          new Date(e.starts_at).toLocaleString('cs-CZ'),
          e.who || '—',
          svc?.name || e.service_name || '—',
          svc?.p ?? '',
        ];
      }),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `planless-rezervace-${now.toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const StatCard = ({ label, value, sub, color }) => (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? 'var(--ink)', margin: '8px 0 4px', letterSpacing: -1 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="col gap-4" style={{ padding: '8px 0' }}>
      <div className="row gap-3" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
        <StatCard label="Tržby tento měsíc" value={`${revenue.toLocaleString('cs-CZ')} Kč`} sub={`Tento týden: ${weekRevenue.toLocaleString('cs-CZ')} Kč`} color="var(--accent)" />
        <StatCard label="Rezervace tento měsíc" value={monthEvents.length} sub={`Tento týden: ${weekEvents.length}`} />
        <StatCard label="Hovory tento měsíc" value={monthCalls.length} sub={`Zmeškaných: ${monthCalls.filter(c => c.status === 'missed').length}`} />
        <StatCard label="Konverzní poměr" value={`${convRate} %`} sub={`${booked} z ${monthCalls.length} hovorů vedlo k rezervaci`} />
      </div>

      <div className="card lg">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div className="eyebrow">Rezervace — posledních 14 dní</div>
          </div>
          <Btn variant="ghost" size="sm" icon={I.Download} onClick={exportCsv}>Exportovat CSV</Btn>
        </div>
        <svg viewBox={`0 0 ${14 * 40 - 4} 80`} style={{ width: '100%', height: 80, overflow: 'visible' }}>
          {days14.map((d, i) => {
            const barH = maxCount > 0 ? Math.max(4, Math.round((d.count / maxCount) * 72)) : 4;
            const isToday = d.date.toDateString() === now.toDateString();
            return (
              <g key={i}>
                <rect
                  x={i * 40}
                  y={80 - barH}
                  width={36}
                  height={barH}
                  rx={6}
                  fill={isToday ? 'var(--accent)' : d.count > 0 ? 'var(--ink-3)' : 'var(--paper-2)'}
                  style={{ transition: 'all 0.2s' }}
                />
                {d.count > 0 && (
                  <text x={i * 40 + 18} y={80 - barH - 5} textAnchor="middle" fontSize={10} fill="var(--ink-2)">{d.count}</text>
                )}
              </g>
            );
          })}
        </svg>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(14, 1fr)`, marginTop: 6 }}>
          {days14.map((d, i) => (
            <div key={i} style={{ fontSize: 10, color: d.date.toDateString() === now.toDateString() ? 'var(--accent)' : 'var(--ink-3)', textAlign: 'center' }}>
              {d.label}
            </div>
          ))}
        </div>
      </div>

      {svcCounts.length > 0 && (
        <div className="card lg">
          <div className="eyebrow" style={{ marginBottom: 16 }}>Top služby</div>
          <div className="col gap-2">
            {svcCounts.map((s, i) => (
              <div key={s.id} className="row gap-3" style={{ alignItems: 'center', padding: '10px 0', borderBottom: i < svcCounts.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{s.d} min{s.p ? ` · ${s.p.toLocaleString('cs-CZ')} Kč` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.bookings}×</div>
                  {s.monthRev > 0 && <div className="muted" style={{ fontSize: 12 }}>{s.monthRev.toLocaleString('cs-CZ')} Kč/měs</div>}
                </div>
                <div style={{ width: 80 }}>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--paper-2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.round((s.bookings / svcCounts[0].bookings) * 100)}%`, transition: 'width 0.4s' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {monthCalls.length === 0 && monthEvents.length === 0 && (
        <div className="card lg" style={{ textAlign: 'center', padding: '48px 0' }}>
          <I.BarChart s={32} style={{ color: 'var(--ink-3)', marginBottom: 12 }} />
          <div style={{ color: 'var(--ink-2)', fontSize: 15 }}>Zatím žádná data pro tento měsíc.</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Statistiky se zobrazí po prvních rezervacích a hovorech.</div>
        </div>
      )}
    </div>
  );
};

const SettingsView = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState('company');
  const [companySettings, setCompanySettings] = useState(null);

  useEffect(() => {
    if (!user) return;
    getCompanySettings(user.id).then(s => setCompanySettings(s)).catch(() => {});
  }, [user]);

  const tabs = [
    { id: 'company',       label: 'Firma',          icon: I.Globe      },
    { id: 'ai',           label: 'AI recepční',    icon: I.Brain      },
    { id: 'hours',        label: 'Otevírací doba', icon: I.Clock      },
    { id: 'rules',        label: 'Pravidla',       icon: I.Sparkle    },
    { id: 'staff',        label: 'Tým',            icon: I.Users      },
    { id: 'integrations', label: 'Integrace',      icon: I.Link       },
    { id: 'billing',      label: 'Předplatné',     icon: I.CreditCard },
    { id: 'account',      label: 'Účet',           icon: I.Lock       },
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
        {tab === 'company'      && <SetCompany user={user} companySettings={companySettings} onSettingsSaved={setCompanySettings} />}
        {tab === 'ai'           && <SetAI user={user} companySettings={companySettings} onSettingsSaved={setCompanySettings} />}
        {tab === 'hours'        && <SetHours user={user} companySettings={companySettings} onSettingsSaved={setCompanySettings} />}
        {tab === 'rules'        && <SetRules user={user} companySettings={companySettings} onSettingsSaved={setCompanySettings} />}
        {tab === 'staff'        && <SetStaff user={user} />}
        {tab === 'integrations' && <SetInteg user={user} companySettings={companySettings} onSettingsSaved={setCompanySettings} />}
        {tab === 'billing'      && <SetBilling />}
        {tab === 'account'      && <SetAccount user={user} />}
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
   Global search
   ============================================================ */
const GlobalSearch = ({ searchRef, onNavigate, setCallSel }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const q = query.toLowerCase().trim();
  const results = q ? [
    ...CALLS.filter(c => c.who?.toLowerCase().includes(q) || c.phone?.includes(q) || c.summary?.toLowerCase().includes(q))
      .slice(0, 3).map(c => ({ type: 'call', id: c.id, label: c.who, sub: c.status === 'missed' ? 'Zmeškaný hovor' : 'Hovor', Icon: I.Phone, action: () => { setCallSel(c.id); onNavigate('inbox'); } })),
    ...CLIENTS.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q))
      .slice(0, 3).map(c => ({ type: 'client', id: c.id, label: c.name, sub: c.phone, Icon: I.Users, action: () => onNavigate('clients') })),
    ...SERVICES.filter(s => s.name?.toLowerCase().includes(q))
      .slice(0, 3).map(s => ({ type: 'service', id: s.id, label: s.name, sub: `${s.d} min${s.p != null ? ` · ${fmtPrice(s.p)}` : ''}`, Icon: I.Scissors, action: () => onNavigate('services') })),
  ] : [];

  const ddStyle = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' };
  const rowBase = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 280, maxWidth: '40vw' }}>
      <div className="field">
        <I.Search />
        <input
          ref={searchRef}
          placeholder="Hledat klienta, službu, číslo…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {query
          ? <button onClick={() => { setQuery(''); setOpen(false); }} style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: '0 2px', display: 'flex' }}><I.X s={14} /></button>
          : <span className="kbd">⌘K</span>}
      </div>
      {open && results.length > 0 && (
        <div className="card" style={ddStyle}>
          {results.map((r) => {
            const Ico = r.Icon;
            return (
              <button key={r.type + r.id} style={rowBase} onClick={() => { r.action(); setQuery(''); setOpen(false); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <Ico s={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && q && results.length === 0 && (
        <div className="card" style={{ ...ddStyle, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Žádné výsledky pro „{q}".</div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   View metadata
   ============================================================ */
function getViewMeta(nav) {
  const todayStr = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  const missedToday = CALLS.filter(c => {
    if (c.status !== 'missed' || !c.created_at) return false;
    return new Date(c.created_at).toDateString() === new Date().toDateString();
  }).length;
  const crumbs = {
    today:    `${todayStr}${missedToday > 0 ? ` · ${missedToday} zmeškaných` : ' · žádné zmešk.'}`,
    inbox:    `Všechny příchozí · ${CALLS.length} celkem`,
    calendar: `Rezervace · ${EVENTS.length} celkem`,
    clients:  `${CLIENTS.length} klientů celkem`,
    services: `${SERVICES.length} služeb · katalog a ceny`,
    settings: 'Konfigurace AI, provozu a integrací',
  };
  const titles = { today: 'Dnes', inbox: 'Hovory', calendar: 'Kalendář', clients: 'Klienti', services: 'Služby', analytics: 'Statistiky', settings: 'Nastavení' };
  return { title: titles[nav] ?? nav, crumb: crumbs[nav] ?? '' };
}

/* ============================================================
   Dashboard (main export)
   ============================================================ */
export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [nav, setNav] = useState(() => {
    try { return localStorage.getItem('pl:nav') || 'today'; } catch { return 'today'; }
  });
  const [mainSettings, setMainSettings] = useState(null);
  const aiOn = !mainSettings?.ai_paused;
  const [tweaks, setTweaks] = useState({ accentHue: 45, density: 'compact' });
  const [tweaksActive, setTweaksActive] = useState(false);
  const [callSel, setCallSel] = useState(null);
  const [calPrefill, setCalPrefill] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef(null);

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
    setLoading(true);
    Promise.allSettled([
      fetchCalls().then(rows => { CALLS = rows.map(mapCallRow); }),
      fetchCustomers().then(rows => { CLIENTS = rows.map(mapCustomerRow); }),
      fetchServices().then(rows => { SERVICES = rows.map(mapServiceRow); }),
      fetchBookings().then(rows => { EVENTS = rows.map(mapBookingToEvent); }),
      fetchStaff().then(rows => { STAFF = rows; }),
      getCompanySettings(user.id).then(s => setMainSettings(s)).catch(() => {}),
    ]).then(() => { setLoading(false); setDataVersion(v => v + 1); });
  }, [user]);

  // Realtime: auto-refresh when Nikola creates calls or bookings
  useEffect(() => {
    if (!user) return;
    const prevMissed = { count: CALLS.filter(c => c.status === 'missed').length };

    const prevLive = { count: 0 };

    const channel = supabase.channel(`dashboard:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls',    filter: `user_id=eq.${user.id}` }, async () => {
        clearCachedCalls();
        CALLS = (await fetchCalls()).map(mapCallRow);
        const newMissed = CALLS.filter(c => c.status === 'missed').length;
        if (newMissed > prevMissed.count) {
          const latest = CALLS.find(c => c.status === 'missed');
          if (latest) toast(`📞 Zmeškaný hovor — ${latest.who}`, { duration: 6000 });
        }
        prevMissed.count = newMissed;
        const newLive = CALLS.filter(c => c.live).length;
        if (newLive > prevLive.count) {
          const lc = CALLS.find(c => c.live);
          if (lc) toast(`📞 Příchozí hovor — ${lc.who}`, { duration: 10000 });
        }
        prevLive.count = newLive;
        setDataVersion(v => v + 1);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${user.id}` }, async () => {
        clearCachedBookings();
        EVENTS = (await fetchBookings()).map(mapBookingToEvent);
        setDataVersion(v => v + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const refreshServices = useCallback(async () => {
    SERVICES = (await fetchServices()).map(mapServiceRow);
    setDataVersion(v => v + 1);
  }, []);

  const refreshCustomers = useCallback(async () => {
    CLIENTS = (await fetchCustomers()).map(mapCustomerRow);
    setDataVersion(v => v + 1);
  }, []);

  const refreshBookings = useCallback(async () => {
    const rows = await fetchBookings();
    EVENTS = rows.map(mapBookingToEvent);
    setDataVersion(v => v + 1);
  }, []);

  const refreshCalls = useCallback(async () => {
    CALLS = (await fetchCalls()).map(mapCallRow);
    setDataVersion(v => v + 1);
  }, []);

  const refreshStaff = useCallback(async () => {
    clearCachedStaff();
    STAFF = await fetchStaff();
    setDataVersion(v => v + 1);
  }, []);

  const toggleAi = useCallback(async () => {
    if (!user || !mainSettings) return;
    const next = { ...mainSettings, ai_paused: !mainSettings.ai_paused };
    setMainSettings(next);
    try {
      await saveCompanySettings(user.id, next);
      toast(next.ai_paused ? 'AI recepční pozastavena.' : 'AI recepční obnovena.');
    } catch {
      setMainSettings(mainSettings);
      toast.error('Nepodařilo se změnit stav AI.');
    }
  }, [user, mainSettings]);

  const m = getViewMeta(nav);

  const right = (
    <GlobalSearch searchRef={searchRef} onNavigate={setNav} setCallSel={setCallSel} />
  );

  return (
    <>
      <div className="ambient" />
      <div className="app">
        <Rail nav={nav} setNav={setNav} onSignOut={signOut} missedCount={CALLS.filter(c => c.status === 'missed').length} />
        <div className="col-main">
          <Dock title={m.title} crumb={m.crumb} right={right} aiOn={aiOn} onToggleAi={toggleAi} />
          <div className="view">
            {loading ? <LoadingView /> : <>
              {nav === 'today'     && <TodayView setNav={setNav} setCallSel={setCallSel} onRefresh={refreshBookings} />}
              {nav === 'inbox'     && <InboxView selId={callSel} setSelId={setCallSel} onBookingCreated={refreshBookings} onNavCalendar={() => setNav('calendar')} dataVersion={dataVersion} />}
              {nav === 'calendar'  && <CalendarView onRefresh={refreshBookings} prefillClient={calPrefill} onPrefillUsed={() => setCalPrefill(null)} />}
              {nav === 'clients'   && <ClientsView onRefresh={refreshCustomers} onNavigate={(view, prefill) => { if (prefill) setCalPrefill(prefill); setNav(view); }} />}
              {nav === 'services'  && <ServicesView onRefresh={refreshServices} />}
              {nav === 'analytics' && <AnalyticsView />}
              {nav === 'settings' && <SettingsView />}
            </>}
          </div>
        </div>
        <TweaksPanel active={tweaksActive} values={tweaks} onChange={setTw} />
      </div>
    </>
  );
}
