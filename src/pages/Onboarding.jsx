import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/globals.css';
import './Onboarding.css';
import { Icons as I, Wave } from '../components/Icons.jsx';
import { supabase } from '../lib/supabase.js';
import { saveCompanySettings } from '../lib/companySettings.js';
import { createService } from '../lib/servicesDb.js';

/* ── helpers ── */
const cx = (...a) => a.filter(Boolean).join(' ');

/* ── Step definitions ── */
const STEPS = [
  { id: 'welcome', title: 'Vítejte' },
  { id: 'biz',     title: 'O firmě' },
  { id: 'hours',   title: 'Otevírací doba' },
  { id: 'svcs',    title: 'Služby' },
  { id: 'team',    title: 'Tým' },
  { id: 'phone',   title: 'Telefon' },
  { id: 'voice',   title: 'Hlas' },
  { id: 'done',    title: 'Hotovo' },
];

/* ── Business types ── */
const BIZ_TYPES = [
  { id: 'salon', name: 'Kadeřnictví / salon', desc: 'Stříhání, barvení, kosmetika', icon: I.Scissors },
  { id: 'doc',   name: 'Lékař / zubař',       desc: 'Ordinace, klinika',           icon: I.Stethoscope },
  { id: 'rest',  name: 'Restaurace / kavárna', desc: 'Rezervace stolů',             icon: I.Utensils },
  { id: 'law',   name: 'Advokát / konzultace', desc: 'Konzultace na čas',           icon: I.Briefcase },
  { id: 'fit',   name: 'Fitness / studio',     desc: 'Lekce, tréninky',             icon: I.Dumbbell },
  { id: 'other', name: 'Něco jiného',          desc: 'Řekněte mi víc',              icon: I.MoreH },
];

/* ── Days of week ── */
const DAYS = [
  { id: 'po', label: 'Pondělí' },
  { id: 'ut', label: 'Úterý' },
  { id: 'st', label: 'Středa' },
  { id: 'ct', label: 'Čtvrtek' },
  { id: 'pa', label: 'Pátek' },
  { id: 'so', label: 'Sobota' },
  { id: 'ne', label: 'Neděle' },
];

/* ── Voices ── */
const VOICES = [
  { id: 'nikola', name: 'Nikola', desc: 'Teplá, konverzační, ženský hlas' },
  { id: 'petra',  name: 'Petra',  desc: 'Profesionální, jasná' },
  { id: 'david',  name: 'David',  desc: 'Klidný, důvěryhodný, mužský' },
];

const TONE_SAMPLES = {
  warm:   '„Dobrý den, salon Svatopluk, Nikola u telefonu. Jak vám mohu pomoci?"',
  formal: '„Dobrý den, salon Svatopluk, u telefonu Nikola. S čím mohu posloužit?"',
  short:  '„Salon Svatopluk, dobrý den."',
};

/* ── Default wizard state ── */
const DEFAULT_DATA = {
  bizName: '',
  bizType: '',
  bizAddress: '',
  hours: {
    po: { on: true,  from: '10:00', to: '19:00' },
    ut: { on: true,  from: '09:00', to: '19:00' },
    st: { on: true,  from: '09:00', to: '19:00' },
    ct: { on: true,  from: '09:00', to: '20:00' },
    pa: { on: true,  from: '09:00', to: '20:00' },
    so: { on: true,  from: '08:00', to: '14:00' },
    ne: { on: false, from: '—',     to: '—'      },
  },
  services: [
    { name: '', duration: '', price: '' },
    { name: '', duration: '', price: '' },
  ],
  teamMode: 'solo',
  team: [{ name: '', role: '' }],
  phoneMode: 'new',
  existingPhone: '',
  voice: 'nikola',
  tone: 'warm',
};

/* ── Nikola says callout ── */
function NikolaSays({ children }) {
  return (
    <div className="ob-nikola-says">
      <div className="av">N</div>
      <div>
        <div className="who">Nikola říká</div>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

/* ── Step 0: Welcome ── */
function StepWelcome({ onNext }) {
  return (
    <div className="ob-welcome">
      <div className="ob-nikola-portrait">N</div>
      <div className="greet">
        Dobrý den. Já jsem <span className="it">Nikola</span>.
      </div>
      <div className="intro">
        Budu vaše AI recepční. Pojďme se za pět minut domluvit, jak mám klientům odpovídat — co děláte, kdy máte otevřeno, kdo u vás pracuje. Až skončíme, můžete mi rovnou zavolat na zkoušku.
      </div>
      <div className="stats-row">
        <div className="stat"><div className="n">~5</div><div className="l">minut nastavení</div></div>
        <div className="stat"><div className="n">8</div><div className="l">jednoduchých kroků</div></div>
        <div className="stat"><div className="n">0</div><div className="l">technické znalosti</div></div>
      </div>
      <button
        className="ob-btn ob-btn-accent"
        style={{ padding: '14px 28px', fontSize: 15 }}
        onClick={onNext}
      >
        Pojďme na to <I.ArrowR s={16} />
      </button>
      <div style={{ marginTop: 18 }}>
        <button className="ob-skip-link" style={{ marginRight: 0 }}>Vyplním později →</button>
      </div>
    </div>
  );
}

/* ── Step 1: Business info ── */
function StepBusiness({ data, set }) {
  return (
    <>
      <div className="ob-eyebrow">krok 2 — o firmě</div>
      <h1 className="ob-title">
        Jak se vaše firma <span className="it">jmenuje</span>?
      </h1>
      <p className="ob-sub">
        Použiju to při pozdravu — třeba „Dobrý den, {data.bizName || 'salon Svatopluk'}, Nikola u telefonu."
      </p>

      <div className="ob-field-group">
        <div className="ob-field">
          <input
            className="ob-input"
            placeholder="Salon Svatopluk"
            value={data.bizName}
            onChange={e => set({ bizName: e.target.value })}
            autoFocus
          />
        </div>

        <div className="ob-field">
          <div className="ob-field-label">A co děláte?</div>
          <div className="ob-tiles">
            {BIZ_TYPES.map(t => {
              const Ico = t.icon;
              return (
                <div
                  key={t.id}
                  className={cx('ob-tile', data.bizType === t.id && 'on')}
                  onClick={() => set({ bizType: t.id })}
                >
                  <div className="ob-tile-ic"><Ico s={16} /></div>
                  <div>
                    <div className="ob-tile-name">{t.name}</div>
                    <div className="ob-tile-desc">{t.desc}</div>
                  </div>
                  <div className="ob-tile-check"><I.Check s={11} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ob-field">
          <div className="ob-field-label">
            Adresa{' '}
            <span className="serif-it" style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span>
          </div>
          <input
            className="ob-input"
            placeholder="Dlouhá 21, Praha 1"
            value={data.bizAddress}
            onChange={e => set({ bizAddress: e.target.value })}
          />
          <div className="ob-field-hint">Pomůže mi, když se klienti zeptají na cestu.</div>
        </div>
      </div>
    </>
  );
}

/* ── Step 2: Hours ── */
function StepHours({ data, set }) {
  const toggle = (id) => {
    const next = { ...data.hours, [id]: { ...data.hours[id], on: !data.hours[id].on } };
    set({ hours: next });
  };
  const setTime = (id, k, v) => {
    const next = { ...data.hours, [id]: { ...data.hours[id], [k]: v } };
    set({ hours: next });
  };
  return (
    <>
      <div className="ob-eyebrow">krok 3 — otevírací doba</div>
      <h1 className="ob-title">Kdy máte <span className="it">otevřeno</span>?</h1>
      <p className="ob-sub">Nikola podle toho rozhoduje, jaké termíny klientům nabídnout. Kdykoliv můžete změnit.</p>

      <div className="ob-hours">
        {DAYS.map(d => {
          const h = data.hours[d.id];
          return (
            <div key={d.id} className={cx('ob-hours-row', !h.on && 'off')}>
              <div className="ob-hours-dow">{d.label}</div>
              <div className="ob-hours-time">
                {h.on ? (
                  <>
                    <input
                      className="t"
                      value={h.from}
                      onChange={e => setTime(d.id, 'from', e.target.value)}
                    />
                    <span className="ob-sep-dash">—</span>
                    <input
                      className="t"
                      value={h.to}
                      onChange={e => setTime(d.id, 'to', e.target.value)}
                    />
                  </>
                ) : (
                  <span style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 14 }}>
                    zavřeno
                  </span>
                )}
              </div>
              <div className={cx('ob-sw', h.on && 'on')} onClick={() => toggle(d.id)} />
            </div>
          );
        })}
      </div>

      <NikolaSays>
        Když někdo zavolá <strong>mimo otevírací dobu</strong>, nabídnu mu termín na další den nebo přijmu vzkaz. Můžete to později upravit v Pravidlech.
      </NikolaSays>
    </>
  );
}

/* ── Step 3: Services ── */
function StepServices({ data, set }) {
  const update = (i, k, v) => {
    const next = [...data.services];
    next[i] = { ...next[i], [k]: v };
    set({ services: next });
  };
  const remove = (i) => set({ services: data.services.filter((_, j) => j !== i) });
  const add = () => set({ services: [...data.services, { name: '', duration: '', price: '' }] });

  return (
    <>
      <div className="ob-eyebrow">krok 4 — služby</div>
      <h1 className="ob-title">Co u vás <span className="it">nabízíte</span>?</h1>
      <p className="ob-sub">Stačí <em>3–6 hlavních</em> služeb pro začátek. Zbytek doděláme později ve službách.</p>

      <div className="ob-svc-list">
        {data.services.map((s, i) => (
          <div key={i} className="ob-svc-row">
            <input
              className="ob-input"
              placeholder="Název služby"
              value={s.name}
              onChange={e => update(i, 'name', e.target.value)}
            />
            <input
              className="ob-input"
              placeholder="45 min"
              value={s.duration}
              onChange={e => update(i, 'duration', e.target.value)}
            />
            <input
              className="ob-input"
              placeholder="650 Kč"
              value={s.price}
              onChange={e => update(i, 'price', e.target.value)}
            />
            <button className="ob-btn-del" onClick={() => remove(i)} title="Odebrat">
              <I.X s={14} />
            </button>
          </div>
        ))}
        <button className="ob-add-row" onClick={add}>
          <I.Plus s={14} /> Přidat další službu
        </button>
      </div>
    </>
  );
}

/* ── Step 4: Team ── */
function StepTeam({ data, set }) {
  const updateMember = (i, k, v) => {
    const next = [...data.team];
    next[i] = { ...next[i], [k]: v };
    set({ team: next });
  };
  const removeMember = (i) => set({ team: data.team.filter((_, j) => j !== i) });
  const addMember = () => set({ team: [...data.team, { name: '', role: '' }] });

  return (
    <>
      <div className="ob-eyebrow">krok 5 — tým</div>
      <h1 className="ob-title">Kdo u vás <span className="it">pracuje</span>?</h1>
      <p className="ob-sub">
        Když mi řeknete kdo, budu klientům umět nabídnout konkrétní osobu — třeba „chcete u Terezy jako minule?"
      </p>

      <div className="ob-tiles" style={{ marginBottom: 24 }}>
        <div
          className={cx('ob-tile', data.teamMode === 'solo' && 'on')}
          onClick={() => set({ teamMode: 'solo' })}
        >
          <div className="ob-tile-ic"><I.User s={16} /></div>
          <div>
            <div className="ob-tile-name">Jsem sám/sama</div>
            <div className="ob-tile-desc">Všechno dělám já</div>
          </div>
          <div className="ob-tile-check"><I.Check s={11} /></div>
        </div>
        <div
          className={cx('ob-tile', data.teamMode === 'team' && 'on')}
          onClick={() => set({ teamMode: 'team' })}
        >
          <div className="ob-tile-ic"><I.Users s={16} /></div>
          <div>
            <div className="ob-tile-name">Máme více lidí</div>
            <div className="ob-tile-desc">2 a více kolegů</div>
          </div>
          <div className="ob-tile-check"><I.Check s={11} /></div>
        </div>
      </div>

      {data.teamMode === 'team' && (
        <div className="ob-team-list">
          <div className="ob-field-label" style={{ marginBottom: 4 }}>Členové týmu</div>
          {data.team.map((m, i) => (
            <div key={i} className="ob-team-row">
              <input
                className="ob-input"
                placeholder="Jméno"
                value={m.name}
                onChange={e => updateMember(i, 'name', e.target.value)}
              />
              <input
                className="ob-input"
                placeholder="Role / co dělá"
                value={m.role}
                onChange={e => updateMember(i, 'role', e.target.value)}
              />
              <button className="ob-btn-del" onClick={() => removeMember(i)}>
                <I.X s={14} />
              </button>
            </div>
          ))}
          <button className="ob-add-row" onClick={addMember}>
            <I.Plus s={14} /> Přidat člena týmu
          </button>
        </div>
      )}
    </>
  );
}

/* ── Step 5: Phone ── */
function StepPhone({ data, set }) {
  return (
    <>
      <div className="ob-eyebrow">krok 6 — telefon</div>
      <h1 className="ob-title">Jak mě mají klienti <span className="it">zastihnout</span>?</h1>
      <p className="ob-sub">
        Doporučuji nové číslo PlanLess — můžete si nechat vyhledat krásné číslo a kdykoliv ho mít kdykoliv změnit.
      </p>

      <div className="ob-phone-tiles">
        <div
          className={cx('ob-phone-tile', data.phoneMode === 'new' && 'on')}
          onClick={() => set({ phoneMode: 'new' })}
        >
          <div className="check"><I.Check s={12} /></div>
          <div className="label">Nové číslo PlanLess <span className="badge">Doporučeno</span></div>
          <div className="desc">
            Vybereme vám hezké pražské nebo brněnské číslo. Zařídíme i to, aby vás klienti našli na Google.
          </div>
          <div className="num">
            +420 277 140 220{' '}
            <span style={{ color: 'var(--ink-3)', fontSize: 12.5, marginLeft: 8 }}>navrženo</span>
          </div>
        </div>

        <div
          className={cx('ob-phone-tile', data.phoneMode === 'forward' && 'on')}
          onClick={() => set({ phoneMode: 'forward' })}
        >
          <div className="check"><I.Check s={12} /></div>
          <div className="label">Přesměrovat moje stávající číslo</div>
          <div className="desc">
            Hovory na vaše telefonní číslo budou tiše přesměrovány na Nikolu, když to nestihnete. Vy zvedáte normálně.
          </div>
          {data.phoneMode === 'forward' && (
            <input
              className="ob-input"
              style={{ marginTop: 14, maxWidth: 280 }}
              placeholder="Vaše stávající číslo"
              value={data.existingPhone}
              onChange={e => set({ existingPhone: e.target.value })}
            />
          )}
        </div>
      </div>

      <NikolaSays>
        Není to nic technického — vše nastavíme my. Vy jen řeknete, kterou variantu chcete.
      </NikolaSays>
    </>
  );
}

/* ── Step 6: Voice ── */
function StepVoice({ data, set }) {
  return (
    <>
      <div className="ob-eyebrow">krok 7 — hlas</div>
      <h1 className="ob-title">Jak mám <span className="it">znít</span>?</h1>
      <p className="ob-sub">Vyberte hlas a tón. Klikněte na ▶ pro ukázku. Kdykoliv změníte v nastavení.</p>

      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Hlas</div>
          <div className="ob-voice-grid">
            {VOICES.map(v => (
              <div
                key={v.id}
                className={cx('ob-voice-card', data.voice === v.id && 'on')}
                onClick={() => set({ voice: v.id })}
              >
                <div className="top">
                  <div className="nm">{v.name}</div>
                  <button
                    className="ob-play-btn"
                    onClick={e => e.stopPropagation()}
                  >
                    <I.Play s={11} />
                  </button>
                </div>
                <div className="ds">{v.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <div className="ob-field-label">Tón pozdravu</div>
          <div className="ob-seg">
            {[
              { v: 'warm',   l: 'Vřelý' },
              { v: 'formal', l: 'Formální' },
              { v: 'short',  l: 'Krátký' },
            ].map(o => (
              <button
                key={o.v}
                className={cx(data.tone === o.v && 'on')}
                onClick={() => set({ tone: o.v })}
              >
                {o.l}
              </button>
            ))}
          </div>

          <div className="ob-preview-card">
            <div className="ic"><I.Phone s={14} /></div>
            <div style={{ flex: 1 }}>
              <div className="lbl">Náhled, jak Nikola pozdraví</div>
              <div className="body">{TONE_SAMPLES[data.tone]}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Step 7: Done ── */
function StepDone({ data, goTo }) {
  const bizTypeName = BIZ_TYPES.find(t => t.id === data.bizType)?.name || '—';
  const openDays = DAYS.filter(d => data.hours[d.id]?.on);
  const voiceName = VOICES.find(v => v.id === data.voice)?.name;
  const toneNames = { warm: 'Vřelý', formal: 'Formální', short: 'Krátký' };

  return (
    <>
      <div className="ob-eyebrow">krok 8 — hotovo</div>
      <h1 className="ob-title">
        <span className="it">Hotovo.</span><br />Nikola je připravená.
      </h1>
      <p className="ob-sub">
        Tady je, co jsem si o vás zapamatovala. Můžete cokoliv ještě upravit, nebo rovnou vyzkoušet první hovor.
      </p>

      <div className="ob-summary">
        <div className="ob-summary-row">
          <div className="k">Firma</div>
          <div className="v">
            <div>{data.bizName || '—'}</div>
            <div className="secondary">
              {bizTypeName}{data.bizAddress && ' · ' + data.bizAddress}
            </div>
          </div>
          <button className="ob-edit-link" onClick={() => goTo(1)}>Upravit</button>
        </div>

        <div className="ob-summary-row">
          <div className="k">Otevírací doba</div>
          <div className="v">
            {openDays.length === 0
              ? '—'
              : openDays.map(d => (
                  <div key={d.id}>
                    {d.label}: <span className="mono">{data.hours[d.id].from}—{data.hours[d.id].to}</span>
                  </div>
                ))
            }
          </div>
          <button className="ob-edit-link" onClick={() => goTo(2)}>Upravit</button>
        </div>

        <div className="ob-summary-row">
          <div className="k">Služby</div>
          <div className="v">
            {data.services.filter(s => s.name).length === 0
              ? <span style={{ color: 'var(--ink-3)' }}>zatím žádné — doplníte později</span>
              : data.services.filter(s => s.name).map((s, i) => (
                  <div key={i}>
                    {s.name}{s.price && ' · ' + s.price}{s.duration && ' · ' + s.duration}
                  </div>
                ))
            }
          </div>
          <button className="ob-edit-link" onClick={() => goTo(3)}>Upravit</button>
        </div>

        <div className="ob-summary-row">
          <div className="k">Tým</div>
          <div className="v">
            {data.teamMode === 'solo'
              ? 'Pracuji sám/sama'
              : data.team.filter(m => m.name).length === 0
                ? <span style={{ color: 'var(--ink-3)' }}>—</span>
                : data.team.filter(m => m.name).map((m, i) => (
                    <div key={i}>{m.name}{m.role && ' · ' + m.role}</div>
                  ))
            }
          </div>
          <button className="ob-edit-link" onClick={() => goTo(4)}>Upravit</button>
        </div>

        <div className="ob-summary-row">
          <div className="k">Telefon</div>
          <div className="v">
            {data.phoneMode === 'new'
              ? <div>Nové číslo PlanLess <span className="mono" style={{ color: 'var(--accent)' }}>+420 277 140 220</span></div>
              : <div>Přesměrované číslo {data.existingPhone && <span className="mono">{data.existingPhone}</span>}</div>
            }
          </div>
          <button className="ob-edit-link" onClick={() => goTo(5)}>Upravit</button>
        </div>

        <div className="ob-summary-row">
          <div className="k">Hlas</div>
          <div className="v">
            {voiceName} · <span style={{ color: 'var(--ink-3)' }}>{toneNames[data.tone]}</span>
          </div>
          <button className="ob-edit-link" onClick={() => goTo(6)}>Upravit</button>
        </div>
      </div>

      <div className="ob-test-card">
        <div className="ic">N</div>
        <div className="body">
          <div className="head">Zavolejte si na zkoušku</div>
          <div className="sub">
            Zavoláme vám teď na vaše soukromé číslo. Nikola se vám představí jako klient, který chce rezervaci — vyzkoušíte si, jak to bude znít.
          </div>
        </div>
        <button className="ob-btn ob-btn-accent">
          <I.Phone s={14} /> Spustit testovací hovor
        </button>
      </div>
    </>
  );
}

/* ── Header ── */
function Header({ step }) {
  return (
    <div className="ob-header">
      <a href="/" className="brand">
        <div className="brand-mark">P</div>
        <div>
          <div className="brand-name">PlanLess</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Nastavení účtu
          </div>
        </div>
      </a>
      <div className="spacer" />
      <div className="right">
        <div className="ob-progress">
          <span className="step-label">krok {step + 1} z {STEPS.length}</span>
          <span className="ob-dots">
            {STEPS.map((s, i) => (
              <i key={s.id} className={cx(i < step && 'done', i === step && 'cur')} />
            ))}
          </span>
        </div>
        <a href="#" className="ob-help-link">Pomoc</a>
      </div>
    </div>
  );
}

/* ── Footer navigation ── */
function Footer({ step, onBack, onNext, nextLabel, nextDisabled, showSkip, onSkip }) {
  return (
    <div className="ob-footer">
      <button
        className="ob-btn ob-btn-ghost"
        onClick={onBack}
        disabled={step === 0}
      >
        <I.ArrowL s={16} /> Zpět
      </button>
      <div style={{ flex: 1 }} />
      {showSkip && (
        <button className="ob-skip-link" onClick={onSkip}>
          Vyplním později
        </button>
      )}
      <button
        className="ob-btn ob-btn-accent"
        onClick={onNext}
        disabled={nextDisabled}
      >
        {nextLabel || 'Pokračovat'} <I.ArrowR s={16} />
      </button>
    </div>
  );
}

const DAY_MAP = { po: 'mon', ut: 'tue', st: 'wed', ct: 'thu', pa: 'fri', so: 'sat', ne: 'sun' };

function buildWorkingHours(hours) {
  const wh = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  for (const [czDay, info] of Object.entries(hours)) {
    const key = DAY_MAP[czDay];
    if (key && info.on && info.from !== '—' && info.to !== '—') {
      wh[key] = [{ start: info.from, end: info.to }];
    }
  }
  return wh;
}

/* ── Main Onboarding component ── */
export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(DEFAULT_DATA);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setData(d => ({ ...d, ...patch }));

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const goTo = (i) => setStep(i);

  async function handleFinish() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      const working_hours = buildWorkingHours(data.hours);

      await saveCompanySettings(user.id, {
        company_name: data.bizName,
        ai_notes: data.bizAddress || null,
        timezone: 'Europe/Prague',
        working_hours,
        lead_time_minutes: 120,
        max_booking_horizon_days: 60,
        onboarding_completed: true,
      });

      const validServices = data.services.filter(s => s.name.trim());
      await Promise.all(validServices.map(s =>
        createService({
          name: s.name.trim(),
          price: parseInt(s.price, 10) || 0,
          duration_min: parseInt(s.duration, 10) || 60,
          buffer_after_min: 0,
        })
      ));

      navigate('/payment');
    } catch (err) {
      toast.error('Nepodařilo se uložit nastavení: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const renderStep = () => {
    switch (step) {
      case 0: return <StepWelcome onNext={next} />;
      case 1: return <StepBusiness data={data} set={set} />;
      case 2: return <StepHours data={data} set={set} />;
      case 3: return <StepServices data={data} set={set} />;
      case 4: return <StepTeam data={data} set={set} />;
      case 5: return <StepPhone data={data} set={set} />;
      case 6: return <StepVoice data={data} set={set} />;
      case 7: return <StepDone data={data} goTo={goTo} />;
      default: return null;
    }
  };

  const isLastStep = step === STEPS.length - 1;
  const nextLabel = isLastStep ? (saving ? 'Ukládám…' : 'Otevřít aplikaci') : 'Pokračovat';
  const nextDisabled = (step === 1 ? (!data.bizName || !data.bizType) : false) || saving;
  const showFooter = step !== 0;
  const showSkip = step >= 3 && step <= 4;

  return (
    <>
      <div className="ambient" />
      <div className="ob-stage">
        <Header step={step} />
        <div className="ob-main">
          <div className="ob-col">
            {renderStep()}
          </div>
        </div>
        {showFooter ? (
          <Footer
            step={step}
            onBack={back}
            onNext={isLastStep ? handleFinish : next}
            nextLabel={nextLabel}
            nextDisabled={nextDisabled}
            showSkip={showSkip}
            onSkip={next}
          />
        ) : (
          <div style={{ height: 32 }} />
        )}
      </div>
    </>
  );
}
