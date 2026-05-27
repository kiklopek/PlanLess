import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/globals.css';
import './Onboarding.css';
import { Icons as I } from '../components/Icons.jsx';
import { supabase } from '../lib/supabase.js';
import { saveCompanySettings } from '../lib/companySettings.js';
import { createService } from '../lib/servicesDb.js';
import { createStaff } from '../lib/staffDb.js';

const cx = (...a) => a.filter(Boolean).join(' ');

const STEPS = [
  { id: 'welcome',   title: 'Vítejte' },
  { id: 'name',      title: 'Název' },
  { id: 'type',      title: 'Typ firmy' },
  { id: 'location',  title: 'Poloha' },
  { id: 'story',     title: 'Váš příběh' },
  { id: 'languages', title: 'Jazyky' },
  { id: 'practical', title: 'Praktické info' },
  { id: 'clients',   title: 'Zákazníci' },
  { id: 'deposit',   title: 'Záloha & storno' },
  { id: 'timing',    title: 'Termíny' },
  { id: 'notes',     title: 'Pokyny' },
  { id: 'hours',     title: 'Otevírací doba' },
  { id: 'svcs',      title: 'Služby' },
  { id: 'team',      title: 'Tým' },
  { id: 'voice',     title: 'Hlas' },
  { id: 'phone',     title: 'Telefon' },
  { id: 'done',      title: 'Hotovo' },
];

const BIZ_TYPES = [
  { id: 'salon', name: 'Kadeřnictví / salon',  desc: 'Stříhání, barvení, kosmetika', icon: I.Scissors },
  { id: 'doc',   name: 'Lékař / zubař',        desc: 'Ordinace, klinika',            icon: I.Stethoscope },
  { id: 'rest',  name: 'Restaurace / kavárna', desc: 'Rezervace stolů',              icon: I.Utensils },
  { id: 'law',   name: 'Advokát / konzultace', desc: 'Konzultace na čas',            icon: I.Briefcase },
  { id: 'fit',   name: 'Fitness / studio',     desc: 'Lekce, tréninky',             icon: I.Dumbbell },
  { id: 'other', name: 'Něco jiného',          desc: 'Řekněte mi víc',              icon: I.MoreH },
];

const DAYS = [
  { id: 'po', label: 'Pondělí' },
  { id: 'ut', label: 'Úterý' },
  { id: 'st', label: 'Středa' },
  { id: 'ct', label: 'Čtvrtek' },
  { id: 'pa', label: 'Pátek' },
  { id: 'so', label: 'Sobota' },
  { id: 'ne', label: 'Neděle' },
];

const VOICES = [
  { id: 'nikola', name: 'Nikola', desc: 'Teplá, konverzační, ženský hlas' },
  { id: 'petra',  name: 'Petra',  desc: 'Profesionální, jasná' },
  { id: 'david',  name: 'David',  desc: 'Klidný, důvěryhodný, mužský' },
];

const LANGUAGES = [
  { id: 'cs', l: 'Čeština' },
  { id: 'en', l: 'Angličtina' },
  { id: 'sk', l: 'Slovenština' },
  { id: 'de', l: 'Němčina' },
  { id: 'fr', l: 'Francouzština' },
];

const DEFAULT_DATA = {
  bizName: '',
  bizType: '',
  bizAddress: '',
  transport: '',
  bizDescription: '',
  certifications: '',
  languages: ['cs'],
  giftVouchers: null,
  faq: { parking: null, parkingNote: '', payment: 'both', wheelchair: null },
  newClients: 'always',
  childrenPolicy: 'welcome',
  deposit: 'none',
  depositThreshold: '2000',
  cancellationPolicy: '24',
  cancellationCustom: '',
  leadTimeMinutes: '120',
  escalationPhone: '',
  specialRules: '',
  aiNotes: '',
  hours: {
    po: { on: true,  from: '09:00', to: '18:00' },
    ut: { on: true,  from: '09:00', to: '18:00' },
    st: { on: true,  from: '09:00', to: '18:00' },
    ct: { on: true,  from: '09:00', to: '18:00' },
    pa: { on: true,  from: '09:00', to: '18:00' },
    so: { on: true,  from: '08:00', to: '14:00' },
    ne: { on: false, from: '—',     to: '—'      },
  },
  services: [
    { name: '', duration: '', price: '', description: '', prepNote: '' },
    { name: '', duration: '', price: '', description: '', prepNote: '' },
  ],
  teamMode: 'solo',
  team: [{ name: '', role: '' }],
  voice: 'nikola',
  tone: 'warm',
  twilioPhone: '',
};

/* ── Shared ── */
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

function FaqToggle({ label, value, onChange, options }) {
  return (
    <div className="ob-faq-row">
      <span className="ob-faq-q">{label}</span>
      <div className="ob-faq-opts">
        {options.map(o => (
          <button key={o.v} className={cx('ob-faq-btn', value === o.v && 'on')} onClick={() => onChange(value === o.v ? null : o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Eyebrow({ step, label }) {
  return <div className="ob-eyebrow">krok {step} — {label}</div>;
}

/* ── Step 0: Welcome ── */
function StepWelcome({ onNext, onSkip }) {
  return (
    <div className="ob-welcome">
      <div className="ob-nikola-portrait">N</div>
      <div className="greet">Dobrý den. Já jsem <span className="it">Nikola</span>.</div>
      <div className="intro">
        Budu vaše AI recepční. Za pár minut mi řekněte vše o vaší firmě — čím víc toho vím, tím lépe odpovím zákazníkům.
      </div>
      <div className="stats-row">
        <div className="stat"><div className="n">~8</div><div className="l">minut nastavení</div></div>
        <div className="stat"><div className="n">15</div><div className="l">rychlých kroků</div></div>
        <div className="stat"><div className="n">0</div><div className="l">technické znalosti</div></div>
      </div>
      <button className="ob-btn ob-btn-accent" style={{ padding: '14px 28px', fontSize: 15 }} onClick={onNext}>
        Pojďme na to <I.ArrowR s={16} />
      </button>
      <div style={{ marginTop: 18 }}>
        <button className="ob-skip-link" onClick={onSkip}>Vyplním později →</button>
      </div>
    </div>
  );
}

/* ── Step 1: Name ── */
function StepName({ data, set }) {
  return (
    <>
      <Eyebrow step={1} label="název firmy" />
      <h1 className="ob-title">Jak se vaše firma <span className="it">jmenuje</span>?</h1>
      <p className="ob-sub">Použiju to při každém pozdravu — zákazník ihned ví, kam volá.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <input
            className="ob-input"
            placeholder="Salon Petra"
            value={data.bizName}
            onChange={e => set({ bizName: e.target.value })}
            autoFocus
            style={{ fontSize: 20, padding: '16px 20px' }}
          />
        </div>
        {data.bizName && (
          <div className="ob-preview-card">
            <div className="ic"><I.Phone s={14} /></div>
            <div style={{ flex: 1 }}>
              <div className="lbl">Takto se zákazníkovi představím</div>
              <div className="body">„Dobrý den, {data.bizName}, Nikola u telefonu."</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Step 2: Type ── */
function StepType({ data, set }) {
  return (
    <>
      <Eyebrow step={2} label="typ firmy" />
      <h1 className="ob-title">Co <span className="it">děláte</span>?</h1>
      <p className="ob-sub">Přizpůsobím slovník a příklady vašemu oboru.</p>
      <div className="ob-tiles">
        {BIZ_TYPES.map(t => {
          const Ico = t.icon;
          return (
            <div key={t.id} className={cx('ob-tile', data.bizType === t.id && 'on')} onClick={() => set({ bizType: t.id })}>
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
    </>
  );
}

/* ── Step 3: Location ── */
function StepLocation({ data, set }) {
  return (
    <>
      <Eyebrow step={3} label="poloha" />
      <h1 className="ob-title">Kde vás <span className="it">najdou</span>?</h1>
      <p className="ob-sub">„Kde jste?" a „jak se k vám dostanu?" — zákazníci se ptají každý den.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Adresa <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span></div>
          <input
            className="ob-input"
            placeholder="Dlouhá 21, Praha 1"
            value={data.bizAddress}
            onChange={e => set({ bizAddress: e.target.value })}
            autoFocus
          />
        </div>
        <div className="ob-field">
          <div className="ob-field-label">Doprava & orientace <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span></div>
          <input
            className="ob-input"
            placeholder="3 minuty od metra Florenc, tramvaj č. 8 zastávka Hlavní nádraží"
            value={data.transport}
            onChange={e => set({ transport: e.target.value })}
          />
          <div className="ob-field-hint">Zákazníkům toto sdělím, kdykoli se zeptají jak se k vám dostat.</div>
        </div>
      </div>
      <NikolaSays>
        Adresu a trasu si zapamatuji. Zákazníkům ji sdělím přesně — bez nutnosti, abyste to vysvětlovali vy.
      </NikolaSays>
    </>
  );
}

/* ── Step 4: Story ── */
function StepStory({ data, set }) {
  const ph = {
    salon: 'Jsme rodinné kadeřnictví s 15 lety zkušeností. Specializujeme se na balayage a moderní střihy. Pracujeme výhradně s prémiovou kosmetikou Schwarzkopf.',
    doc:   'Jsme soukromá zubní ordinace s moderním vybavením. Přijímáme pacienty bez registrace. Specializujeme se na estetickou stomatologii a bělení zubů.',
    fit:   'Jsme butikové fitness studio s maximálně 8 lidmi na lekci. Nabízíme personal training, pilates a funkční trénink. Každý klient dostane individuální program.',
    law:   'Poskytujeme právní poradenství v oblasti pracovního a obchodního práva. Nabízíme první konzultaci zdarma. Pracujeme rychle a transparentně.',
  };
  return (
    <>
      <Eyebrow step={4} label="váš příběh" />
      <h1 className="ob-title">Čím jste <span className="it">výjimeční</span>?</h1>
      <p className="ob-sub">Zákazník se ptá „proč u vás?" — co mu řeknu?</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <textarea
            className="ob-input"
            rows={4}
            placeholder={ph[data.bizType] || 'Popište vaši firmu — co nabízíte, co vás odlišuje od konkurence, jaká je atmosféra...'}
            value={data.bizDescription}
            onChange={e => set({ bizDescription: e.target.value })}
            autoFocus
          />
          <div className="ob-field-hint">2–4 věty. Zákazníkům toto řeknu, když se ptají co nabízíte nebo proč zrovna vy.</div>
        </div>
        <div className="ob-field">
          <div className="ob-field-label">
            Certifikáty, ocenění, reference{' '}
            <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span>
          </div>
          <input
            className="ob-input"
            placeholder="Certified Balayage Expert · Salon roku 2023 · 500+ spokojených zákazníků"
            value={data.certifications}
            onChange={e => set({ certifications: e.target.value })}
          />
          <div className="ob-field-hint">Zvyšuje důvěru zákazníků — sdělím to, když se ptají na vaše zkušenosti.</div>
        </div>
      </div>
      <NikolaSays>
        „Proč u vás?" — zákazníci se ptají, zejména poprvé. S vaším příběhem jim dám jistou a přesvědčivou odpověď.
      </NikolaSays>
    </>
  );
}

/* ── Step 5: Languages ── */
function StepLanguages({ data, set }) {
  const toggleLang = (id) => {
    const next = data.languages.includes(id) ? data.languages.filter(l => l !== id) : [...data.languages, id];
    if (next.length === 0) return;
    set({ languages: next });
  };
  return (
    <>
      <Eyebrow step={5} label="jazyky & poukazy" />
      <h1 className="ob-title">Jakými jazyky <span className="it">komunikujete</span>?</h1>
      <p className="ob-sub">„Mluvíte anglicky?" je jednou z nejčastějších otázek nových zákazníků.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-faq-opts" style={{ flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGES.map(l => (
              <button
                key={l.id}
                className={cx('ob-faq-btn', data.languages.includes(l.id) && 'on')}
                onClick={() => toggleLang(l.id)}
                style={{ padding: '10px 20px', fontSize: 14 }}
              >
                {l.l}
              </button>
            ))}
          </div>
          <div className="ob-field-hint">Zákazníkům v jiném jazyce řeknu, zda s vámi mohou komunikovat.</div>
        </div>
        <div className="ob-field" style={{ marginTop: 8 }}>
          <div className="ob-field-label">Dárkové poukazy</div>
          <FaqToggle
            label="Prodáváte dárkové poukazy?"
            value={data.giftVouchers}
            onChange={v => set({ giftVouchers: v })}
            options={[{ v: 'yes', l: 'Ano, prodáváme' }, { v: 'no', l: 'Neprodáváme' }]}
          />
          <div className="ob-field-hint">Zákazníci se ptají zejména kolem Vánoc a Dne matek.</div>
        </div>
      </div>
    </>
  );
}

/* ── Step 6: Practical ── */
function StepPractical({ data, set }) {
  const setFaq = (k, v) => set({ faq: { ...data.faq, [k]: v } });
  return (
    <>
      <Eyebrow step={6} label="praktické info" />
      <h1 className="ob-title">Než zákazník <span className="it">přijde</span>…</h1>
      <p className="ob-sub">Tyto otázky dostávám nejčastěji — odpovím za vás, bez přepojování.</p>
      <div className="ob-faq-grid">
        <FaqToggle
          label="Parkování"
          value={data.faq.parking}
          onChange={v => setFaq('parking', v)}
          options={[{ v: 'yes', l: 'K dispozici' }, { v: 'no', l: 'Není' }]}
        />
        {data.faq.parking === 'yes' && (
          <input
            className="ob-input"
            style={{ marginTop: 6 }}
            placeholder={'Kde přesně? (volitelné — "v ulici za rohem zdarma")'}
            value={data.faq.parkingNote}
            onChange={e => setFaq('parkingNote', e.target.value)}
          />
        )}
        <div className="ob-faq-row">
          <span className="ob-faq-q">Platba</span>
          <div className="ob-faq-opts">
            {[{ v: 'both', l: 'Hotovost i karta' }, { v: 'cash', l: 'Jen hotovost' }, { v: 'card', l: 'Jen karta' }].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.faq.payment === o.v && 'on')} onClick={() => setFaq('payment', o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <FaqToggle
          label="Bezbariérový přístup"
          value={data.faq.wheelchair}
          onChange={v => setFaq('wheelchair', v)}
          options={[{ v: 'yes', l: 'Ano' }, { v: 'no', l: 'Ne' }]}
        />
      </div>
    </>
  );
}

/* ── Step 7: Clients ── */
function StepClients({ data, set }) {
  return (
    <>
      <Eyebrow step={7} label="zákazníci" />
      <h1 className="ob-title">Koho <span className="it">přijímáte</span>?</h1>
      <p className="ob-sub">Zákazníci se ptají ještě před rezervací — odpovím jim přesně a okamžitě.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Nový zákazník</div>
          <div className="ob-faq-opts" style={{ flexWrap: 'wrap' }}>
            {[
              { v: 'always',       l: 'Kohokoliv přijímáme' },
              { v: 'consultation', l: 'Nejprve konzultace' },
              { v: 'closed',       l: 'Momentálně nepřijímáme' },
            ].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.newClients === o.v && 'on')} onClick={() => set({ newClients: o.v })}>{o.l}</button>
            ))}
          </div>
          {data.newClients === 'consultation' && <div className="ob-field-hint">Zákazníkovi řeknu, že pro první návštěvu je potřeba nejprve domluvit konzultaci.</div>}
          {data.newClients === 'closed' && <div className="ob-field-hint">Zákazníkovi sdělím, že momentálně nové zákazníky nepřijímáme.</div>}
        </div>
        <div className="ob-field">
          <div className="ob-field-label">Děti</div>
          <div className="ob-faq-opts">
            {[
              { v: 'welcome', l: '✓ Vítány' },
              { v: 'adult',   l: 'Jen s dospělým' },
              { v: 'no',      l: 'Nevhodné pro děti' },
            ].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.childrenPolicy === o.v && 'on')} onClick={() => set({ childrenPolicy: o.v })}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Step 8: Deposit & cancellation ── */
function StepDeposit({ data, set }) {
  return (
    <>
      <Eyebrow step={8} label="záloha & storno" />
      <h1 className="ob-title">Záloha a <span className="it">storno</span></h1>
      <p className="ob-sub">Podmínky zákazníci chtějí vědět ještě před rezervací — řeknu jim to místo vás.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Záloha</div>
          <div className="ob-faq-opts" style={{ flexWrap: 'wrap' }}>
            {[
              { v: 'none',      l: 'Bez zálohy' },
              { v: 'firstTime', l: 'Při první návštěvě' },
              { v: 'large',     l: 'U dražších termínů' },
              { v: 'always',    l: 'Vždy vyžadujeme' },
            ].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.deposit === o.v && 'on')} onClick={() => set({ deposit: o.v })}>{o.l}</button>
            ))}
          </div>
          {data.deposit === 'large' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>Záloha u rezervací nad</span>
              <input className="ob-input" style={{ maxWidth: 110, padding: '9px 12px' }} placeholder="2000" value={data.depositThreshold} onChange={e => set({ depositThreshold: e.target.value })} />
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Kč</span>
            </div>
          )}
        </div>
        <div className="ob-field">
          <div className="ob-field-label">Storno podmínky</div>
          <div className="ob-faq-opts" style={{ flexWrap: 'wrap' }}>
            {[
              { v: 'free',   l: 'Kdykoli zdarma' },
              { v: '24',     l: '24 h předem' },
              { v: '48',     l: '48 h předem' },
              { v: '72',     l: '72 h předem' },
              { v: 'custom', l: 'Vlastní text' },
            ].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.cancellationPolicy === o.v && 'on')} onClick={() => set({ cancellationPolicy: o.v })}>{o.l}</button>
            ))}
          </div>
          {data.cancellationPolicy === 'custom' && (
            <input className="ob-input" style={{ marginTop: 10 }} placeholder="Rezervaci lze zrušit nejpozději 3 dny předem bez poplatku." value={data.cancellationCustom} onChange={e => set({ cancellationCustom: e.target.value })} />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Step 9: Timing & escalation ── */
function StepTiming({ data, set }) {
  return (
    <>
      <Eyebrow step={9} label="termíny & kontakt" />
      <h1 className="ob-title">Jak rychle lze <span className="it">zarezervovat</span>?</h1>
      <p className="ob-sub">Nastavte minimální předskok a záložní číslo pro složitější dotazy.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Nejkratší termín rezervace</div>
          <div className="ob-faq-opts" style={{ flexWrap: 'wrap' }}>
            {[
              { v: '60',   l: '1 hodina' },
              { v: '120',  l: '2 hodiny' },
              { v: '240',  l: '4 hodiny' },
              { v: '1440', l: 'Druhý den' },
            ].map(o => (
              <button key={o.v} className={cx('ob-faq-btn', data.leadTimeMinutes === o.v && 'on')} onClick={() => set({ leadTimeMinutes: o.v })}>{o.l}</button>
            ))}
          </div>
          <div className="ob-field-hint">Jak brzy dopředu může zákazník nejdříve zarezervovat?</div>
        </div>
        <div className="ob-field">
          <div className="ob-field-label">
            Záložní telefon{' '}
            <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span>
          </div>
          <input
            className="ob-input"
            type="tel"
            placeholder="+420 777 000 111"
            value={data.escalationPhone}
            onChange={e => set({ escalationPhone: e.target.value })}
            style={{ maxWidth: 280 }}
          />
          <div className="ob-field-hint">Přepojím sem zákazníky, kteří chtějí mluvit s člověkem nebo mají složitý dotaz.</div>
        </div>
      </div>
    </>
  );
}

/* ── Step 10: Internal notes ── */
function StepNotes({ data, set }) {
  return (
    <>
      <Eyebrow step={10} label="interní pokyny" />
      <h1 className="ob-title">Moje <span className="it">tajné instrukce</span></h1>
      <p className="ob-sub">Zákazníci toto nevidí — ale já se tím vždy přesně řídím.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">
            Zvláštní pravidla{' '}
            <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span>
          </div>
          <textarea
            className="ob-input"
            rows={3}
            placeholder={'Nepřijímáme zákazníky se psy v salonu.\nPrvní schůzka trvá vždy 90 minut.\nDěti pod 12 let potřebují souhlas rodiče.'}
            value={data.specialRules}
            onChange={e => set({ specialRules: e.target.value })}
            autoFocus
          />
          <div className="ob-field-hint">Každé pravidlo na nový řádek.</div>
        </div>
        <div className="ob-field">
          <div className="ob-field-label">
            Pokyny pro mě{' '}
            <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>volitelné</span>
          </div>
          <textarea
            className="ob-input"
            rows={3}
            placeholder={'Zákazník Petr Novák – VIP, vždy přepojen na vás osobně.\nPři objednávce barvení se vždy zeptej na délku vlasů.\nNepřijímat rezervace v pátek po 17:00.'}
            value={data.aiNotes}
            onChange={e => set({ aiNotes: e.target.value })}
          />
        </div>
      </div>
      <NikolaSays>
        Toto jsou moje tajné instrukce. Zákazníci je neuvidí, ale já se jimi vždy řídím — přesně a bez výjimky.
      </NikolaSays>
    </>
  );
}

/* ── Step 11: Hours ── */
function StepHours({ data, set }) {
  const toggle  = (id) => set({ hours: { ...data.hours, [id]: { ...data.hours[id], on: !data.hours[id].on } } });
  const setTime = (id, k, v) => set({ hours: { ...data.hours, [id]: { ...data.hours[id], [k]: v } } });
  return (
    <>
      <Eyebrow step={11} label="otevírací doba" />
      <h1 className="ob-title">Kdy máte <span className="it">otevřeno</span>?</h1>
      <p className="ob-sub">Nabídnu správné termíny. Kdykoliv změníte v Nastavení.</p>
      <div className="ob-hours">
        {DAYS.map(d => {
          const h = data.hours[d.id];
          return (
            <div key={d.id} className={cx('ob-hours-row', !h.on && 'off')}>
              <div className="ob-hours-dow">{d.label}</div>
              <div className="ob-hours-time">
                {h.on ? (
                  <>
                    <input className="t" value={h.from} onChange={e => setTime(d.id, 'from', e.target.value)} />
                    <span className="ob-sep-dash">—</span>
                    <input className="t" value={h.to}   onChange={e => setTime(d.id, 'to',   e.target.value)} />
                  </>
                ) : (
                  <span style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 14 }}>zavřeno</span>
                )}
              </div>
              <div className={cx('ob-sw', h.on && 'on')} onClick={() => toggle(d.id)} />
            </div>
          );
        })}
      </div>
      <NikolaSays>
        Když někdo zavolá mimo provozní dobu, řeknu mu kdy jsme tu pro něj příště, a nabídnu rezervaci.
      </NikolaSays>
    </>
  );
}

/* ── Step 12: Services ── */
function StepServices({ data, set }) {
  const [expanded, setExpanded] = useState({});
  const update  = (i, k, v) => { const n = [...data.services]; n[i] = { ...n[i], [k]: v }; set({ services: n }); };
  const remove  = (i) => set({ services: data.services.filter((_, j) => j !== i) });
  const add     = () => set({ services: [...data.services, { name: '', duration: '', price: '', description: '', prepNote: '' }] });
  const toggleX = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  const phs = {
    salon: [['Dámský střih', '60', '650'], ['Barvení — balayage', '120', '1200'], ['Foukaná', '30', '350'], ['Barvení celé', '150', '1800']],
    doc:   [['Konzultace', '30', ''], ['Čištění zubů', '45', ''], ['Plomba', '60', ''], ['RTG snímek', '15', '']],
    fit:   [['Osobní trénink', '60', '800'], ['Skupinová lekce', '45', '350'], ['Pilates', '60', '400'], ['Diagnostika', '90', '1200']],
    rest:  [['Stůl pro 2', '120', ''], ['Stůl pro 4', '120', ''], ['Soukromý salonek', '180', ''], ['Firemní akce', '240', '']],
  };
  const ph = phs[data.bizType] ?? [['Název služby', '45', '500']];

  const descPh = {
    salon: ['Zahrnuje konzultaci, střih a finální styling.', 'Balayage technika, zahrnuje mytí, barvení a tónování.'],
    doc:   ['Komplexní vyšetření + plán léčby.', 'Profesionální čištění + fluoridace.'],
    fit:   ['Individuální tréninkový plán, záloha výsledků.', 'Max. 8 lidí, všechny úrovně zdatnosti.'],
  };
  const prepPh = {
    salon: ['Přijďte s čistými, suchými vlasy.', 'Vyhněte se mytí vlasů 2 dny před barvením.'],
    doc:   ['Přineste kartičku pojišťovny a průkaz.', 'Přijďte nalačno (nejíst 2 hodiny předem).'],
    fit:   ['Pohodlné oblečení a sportovní obuv.', 'Přineste si ručník a láhev vody.'],
  };

  return (
    <>
      <Eyebrow step={12} label="služby" />
      <h1 className="ob-title">Co u vás <span className="it">nabízíte</span>?</h1>
      <p className="ob-sub">3–8 hlavních služeb. Popis a pokyny výrazně zlepší odpovědi zákazníkům.</p>
      <div className="ob-svc-list">
        {data.services.map((s, i) => (
          <div key={i} className="ob-svc-card">
            <div className="ob-svc-row">
              <input className="ob-input" placeholder={ph[i]?.[0] ?? 'Název služby'} value={s.name} onChange={e => update(i, 'name', e.target.value)} />
              <input className="ob-input" placeholder={ph[i] ? `${ph[i][1]} min` : '45 min'} value={s.duration} onChange={e => update(i, 'duration', e.target.value)} />
              <input className="ob-input" placeholder={ph[i] ? `${ph[i][2]} Kč` : 'Cena'} value={s.price} onChange={e => update(i, 'price', e.target.value)} />
              <button className="ob-btn-del" onClick={() => remove(i)} title="Odebrat"><I.X s={14} /></button>
            </div>
            {expanded[i] && (
              <div className="ob-svc-details">
                <input className="ob-input" placeholder={descPh[data.bizType]?.[i] || 'Co je zahrnuto, pro koho je vhodná... (volitelné)'} value={s.description} onChange={e => update(i, 'description', e.target.value)} />
                <input className="ob-input" placeholder={prepPh[data.bizType]?.[i] || 'Příprava zákazníka před návštěvou... (volitelné)'} value={s.prepNote} onChange={e => update(i, 'prepNote', e.target.value)} />
              </div>
            )}
            <button className="ob-svc-expand-btn" onClick={() => toggleX(i)}>
              {expanded[i] ? '↑ Skrýt detaily' : '+ Přidat popis a pokyny pro zákazníka'}
            </button>
          </div>
        ))}
        <button className="ob-add-row" onClick={add}><I.Plus s={14} /> Přidat další službu</button>
      </div>
      <NikolaSays>
        Popis „co je zahrnuto" a pokyny „přijďte s čistými vlasy" výrazně snižují dotazy zákazníků před návštěvou.
      </NikolaSays>
    </>
  );
}

/* ── Step 13: Team ── */
function StepTeam({ data, set }) {
  const updateMember = (i, k, v) => { const n = [...data.team]; n[i] = { ...n[i], [k]: v }; set({ team: n }); };
  const removeMember = (i) => set({ team: data.team.filter((_, j) => j !== i) });
  const addMember    = ()  => set({ team: [...data.team, { name: '', role: '' }] });
  return (
    <>
      <Eyebrow step={13} label="tým" />
      <h1 className="ob-title">Kdo u vás <span className="it">pracuje</span>?</h1>
      <p className="ob-sub">Zákazníkům umím nabídnout konkrétní osobu — „chcete u Terezy jako minule?"</p>
      <div className="ob-tiles" style={{ marginBottom: 24 }}>
        <div className={cx('ob-tile', data.teamMode === 'solo' && 'on')} onClick={() => set({ teamMode: 'solo' })}>
          <div className="ob-tile-ic"><I.User s={16} /></div>
          <div><div className="ob-tile-name">Jsem sám/sama</div><div className="ob-tile-desc">Všechno dělám já</div></div>
          <div className="ob-tile-check"><I.Check s={11} /></div>
        </div>
        <div className={cx('ob-tile', data.teamMode === 'team' && 'on')} onClick={() => set({ teamMode: 'team' })}>
          <div className="ob-tile-ic"><I.Users s={16} /></div>
          <div><div className="ob-tile-name">Máme více lidí</div><div className="ob-tile-desc">2 a více kolegů</div></div>
          <div className="ob-tile-check"><I.Check s={11} /></div>
        </div>
      </div>
      {data.teamMode === 'team' && (
        <div className="ob-team-list">
          <div className="ob-field-label" style={{ marginBottom: 8 }}>Členové týmu</div>
          {data.team.map((m, i) => (
            <div key={i} className="ob-team-row">
              <input className="ob-input" placeholder="Jméno" value={m.name} onChange={e => updateMember(i, 'name', e.target.value)} />
              <input className="ob-input" placeholder="Specialita nebo role (volitelné)" value={m.role} onChange={e => updateMember(i, 'role', e.target.value)} />
              <button className="ob-btn-del" onClick={() => removeMember(i)}><I.X s={14} /></button>
            </div>
          ))}
          <button className="ob-add-row" onClick={addMember}><I.Plus s={14} /> Přidat člena týmu</button>
        </div>
      )}
      <NikolaSays>
        {data.teamMode === 'solo'
          ? 'Perfektní — budu zákazníkům říkat, že se mohou objednat přímo k vám.'
          : 'Zapamatuji si, kdo co dělá, a při rezervaci zákazníkovi nabídnu správného člověka.'
        }
      </NikolaSays>
    </>
  );
}

/* ── Step 14: Voice ── */
function StepVoice({ data, set }) {
  const companyName = data.bizName || 'váš salon';
  const TONE_SAMPLES = {
    warm:   `„Dobrý den, ${companyName}, Nikola u telefonu. Jak vám mohu pomoci?"`,
    formal: `„Dobrý den, ${companyName}, u telefonu Nikola. S čím mohu posloužit?"`,
    short:  `„${companyName}, dobrý den."`,
  };
  return (
    <>
      <Eyebrow step={14} label="hlas & tón" />
      <h1 className="ob-title">Jak mám <span className="it">znít</span>?</h1>
      <p className="ob-sub">Vyberte hlas a tón. Kdykoliv změníte v Nastavení → AI.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Hlas</div>
          <div className="ob-voice-grid">
            {VOICES.map(v => (
              <div key={v.id} className={cx('ob-voice-card', data.voice === v.id && 'on')} onClick={() => set({ voice: v.id })}>
                <div className="top">
                  <div className="nm">{v.name}</div>
                  <button className="ob-play-btn" onClick={e => e.stopPropagation()}><I.Play s={11} /></button>
                </div>
                <div className="ds">{v.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="ob-field">
          <div className="ob-field-label">Tón pozdravu</div>
          <div className="ob-seg">
            {[{ v: 'warm', l: 'Vřelý' }, { v: 'formal', l: 'Formální' }, { v: 'short', l: 'Krátký' }].map(o => (
              <button key={o.v} className={cx(data.tone === o.v && 'on')} onClick={() => set({ tone: o.v })}>{o.l}</button>
            ))}
          </div>
          <div className="ob-preview-card">
            <div className="ic"><I.Phone s={14} /></div>
            <div style={{ flex: 1 }}>
              <div className="lbl">Náhled pozdravu</div>
              <div className="body">{TONE_SAMPLES[data.tone]}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Step 15: Phone ── */
function StepPhone({ data, set }) {
  return (
    <>
      <Eyebrow step={15} label="telefon" />
      <h1 className="ob-title">Připojte <span className="it">Twilio</span> číslo</h1>
      <p className="ob-sub">Přes Twilio přijímám hovory. Tento krok můžete přeskočit a doplnit v Nastavení → Integrace.</p>
      <div className="ob-field-group">
        <div className="ob-field">
          <div className="ob-field-label">Twilio telefonní číslo</div>
          <input className="ob-input" placeholder="+420277140220" value={data.twilioPhone} onChange={e => set({ twilioPhone: e.target.value })} style={{ maxWidth: 300 }} type="tel" />
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
            Ještě nemáte Twilio?{' '}
            <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Vytvořte bezplatný účet →</a>
          </div>
        </div>
        <div className="ob-field">
          <div className="ob-field-label">Jak propojit</div>
          <ol style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.9, paddingLeft: 20, margin: '8px 0 0' }}>
            <li>Twilio Console → Phone Numbers → Active Numbers → klikněte na číslo</li>
            <li>Voice Configuration → A call comes in → Webhook</li>
            <li>URL zkopírujte z Nastavení → Integrace → Twilio (po dokončení)</li>
            <li>Method: <strong>HTTP POST</strong> → uložit</li>
          </ol>
        </div>
      </div>
      <NikolaSays>Stačí jedno číslo. Webhook URL vám ukáži hned po dokončení nastavení.</NikolaSays>
    </>
  );
}

/* ── Step 16: Done ── */
function StepDone({ data, goTo }) {
  const bizTypeName   = BIZ_TYPES.find(t => t.id === data.bizType)?.name || '—';
  const openDays      = DAYS.filter(d => data.hours[d.id]?.on);
  const voiceName     = VOICES.find(v => v.id === data.voice)?.name;
  const cancelLabels  = { free: 'Kdykoli zdarma', '24': '24 h předem', '48': '48 h předem', '72': '72 h předem', custom: data.cancellationCustom || 'Vlastní' };
  const paymentLabels = { both: 'Hotovost i karta', cash: 'Jen hotovost', card: 'Jen karta' };
  const toneNames     = { warm: 'Vřelý', formal: 'Formální', short: 'Krátký' };
  const depositLabels = { none: 'Bez zálohy', firstTime: 'Při první návštěvě', large: `Nad ${data.depositThreshold} Kč`, always: 'Vždy' };
  const newClientsLabels = { always: 'Kohokoliv přijímáme', consultation: 'Nejprve konzultace', closed: 'Momentálně nepřijímáme' };
  const childrenLabels = { welcome: 'Děti vítány', adult: 'Jen s dospělým', no: 'Nevhodné pro děti' };
  const langNames     = { cs: 'CS', en: 'EN', sk: 'SK', de: 'DE', fr: 'FR' };

  const Row = ({ label, children, editStep }) => (
    <div className="ob-summary-row">
      <div className="k">{label}</div>
      <div className="v">{children}</div>
      <button className="ob-edit-link" onClick={() => goTo(editStep)}>Upravit</button>
    </div>
  );

  return (
    <>
      <div className="ob-eyebrow">hotovo</div>
      <h1 className="ob-title"><span className="it">Hotovo.</span><br />Nikola je připravená.</h1>
      <p className="ob-sub">Tady je, co jsem si o vás zapamatovala. Vše můžete kdykoliv upravit.</p>
      <div className="ob-summary">
        <Row label="Firma" editStep={1}>
          <div>{data.bizName || '—'}</div>
          <div className="secondary">{bizTypeName}{data.bizAddress && ' · ' + data.bizAddress}</div>
        </Row>
        <Row label="Popis" editStep={4}>
          {data.bizDescription
            ? <div style={{ fontSize: 13, lineHeight: 1.55 }}>{data.bizDescription.slice(0, 140)}{data.bizDescription.length > 140 ? '…' : ''}</div>
            : <span style={{ color: 'var(--ink-3)' }}>Nevyplněno</span>
          }
          {data.certifications && <div className="secondary" style={{ marginTop: 4 }}>{data.certifications}</div>}
        </Row>
        <Row label="Jazyky & info" editStep={5}>
          <div>{data.languages.map(l => langNames[l]).join(' · ')}</div>
          <div className="secondary">
            {paymentLabels[data.faq.payment]}
            {data.faq.parking === 'yes' && ' · Parkování'}
            {data.giftVouchers === 'yes' && ' · Dárkové poukazy'}
          </div>
        </Row>
        <Row label="Zákazníci" editStep={7}>
          <div>{newClientsLabels[data.newClients]}</div>
          <div className="secondary">{childrenLabels[data.childrenPolicy]}</div>
        </Row>
        <Row label="Záloha & storno" editStep={8}>
          <div>{depositLabels[data.deposit]}</div>
          <div className="secondary">{cancelLabels[data.cancellationPolicy]}</div>
        </Row>
        <Row label="Otevírací doba" editStep={11}>
          {openDays.length === 0 ? '—' : openDays.map(d => (
            <div key={d.id}>{d.label}: <span className="mono">{data.hours[d.id].from}—{data.hours[d.id].to}</span></div>
          ))}
        </Row>
        <Row label="Služby" editStep={12}>
          {data.services.filter(s => s.name).length === 0
            ? <span style={{ color: 'var(--ink-3)' }}>zatím žádné</span>
            : data.services.filter(s => s.name).map((s, i) => (
                <div key={i}>
                  {s.name}
                  {s.price && ' · ' + s.price + ' Kč'}
                  {s.duration && ' · ' + s.duration + ' min'}
                  {s.description && <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>✓ popis</span>}
                </div>
              ))
          }
        </Row>
        <Row label="Tým" editStep={13}>
          {data.teamMode === 'solo' ? 'Pracuji sám/sama'
            : data.team.filter(m => m.name).map((m, i) => <div key={i}>{m.name}{m.role && ' · ' + m.role}</div>)
          }
        </Row>
        <Row label="Hlas" editStep={14}>
          {voiceName} · <span style={{ color: 'var(--ink-3)' }}>{toneNames[data.tone]}</span>
        </Row>
        <Row label="Telefon" editStep={15}>
          {data.twilioPhone
            ? <span className="mono" style={{ color: 'var(--accent)' }}>{data.twilioPhone}</span>
            : <span style={{ color: 'var(--ink-3)' }}>Nezadáno</span>
          }
        </Row>
        {data.escalationPhone && (
          <Row label="Záložní tel." editStep={9}>
            <span className="mono">{data.escalationPhone}</span>
          </Row>
        )}
      </div>
      <div className="ob-test-card">
        <div className="ic">N</div>
        <div className="body">
          <div className="head">Zavolejte si na zkoušku</div>
          <div className="sub">Zavolejte na vaše Twilio číslo — Nikola pozdraví a vy si vyzkoušíte celý průběh.</div>
        </div>
        <button
          className="ob-btn ob-btn-accent"
          disabled={!data.twilioPhone}
          title={data.twilioPhone ? '' : 'Nejprve zadejte Twilio číslo'}
          onClick={() => data.twilioPhone && window.open(`tel:${data.twilioPhone}`, '_self')}
        >
          <I.Phone s={14} /> {data.twilioPhone ? 'Zavolat si' : 'Zadejte Twilio číslo'}
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
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Nastavení účtu</div>
        </div>
      </a>
      <div className="spacer" />
      <div className="right">
        <div className="ob-progress">
          <span className="step-label">krok {step + 1} z {STEPS.length}</span>
          <span className="ob-dots">
            {STEPS.map((s, i) => <i key={s.id} className={cx(i < step && 'done', i === step && 'cur')} />)}
          </span>
        </div>
        <a href="#" className="ob-help-link">Pomoc</a>
      </div>
    </div>
  );
}

function Footer({ step, onBack, onNext, nextLabel, nextDisabled, showSkip, onSkip }) {
  return (
    <div className="ob-footer">
      <button className="ob-btn ob-btn-ghost" onClick={onBack} disabled={step === 0}>
        <I.ArrowL s={16} /> Zpět
      </button>
      <div style={{ flex: 1 }} />
      {showSkip && <button className="ob-skip-link" onClick={onSkip}>Přeskočit</button>}
      <button className="ob-btn ob-btn-accent" onClick={onNext} disabled={nextDisabled}>
        {nextLabel || 'Pokračovat'} <I.ArrowR s={16} />
      </button>
    </div>
  );
}

/* ── Data builders ── */
const DAY_MAP = { po: 'mon', ut: 'tue', st: 'wed', ct: 'thu', pa: 'fri', so: 'sat', ne: 'sun' };

function buildWorkingHours(hours) {
  const wh = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  for (const [czDay, info] of Object.entries(hours)) {
    const key = DAY_MAP[czDay];
    if (key && info.on && info.from !== '—' && info.to !== '—') wh[key] = [{ start: info.from, end: info.to }];
  }
  return wh;
}

function buildCompanyDescription(data) {
  const parts = [];
  if (data.bizDescription) parts.push(data.bizDescription);
  if (data.certifications)  parts.push(`Certifikáty a ocenění: ${data.certifications}.`);
  if (data.bizAddress)      parts.push(`Adresa: ${data.bizAddress}.`);
  if (data.transport)       parts.push(`Doprava: ${data.transport}.`);
  const { faq } = data;
  if (faq.parking === 'yes') parts.push(faq.parkingNote ? `Parkování: ${faq.parkingNote}.` : 'Parkování k dispozici.');
  if (faq.parking === 'no')  parts.push('Parkování u nás není k dispozici.');
  const pm = { both: 'Přijímáme hotovost i kartu.', cash: 'Přijímáme pouze hotovost.', card: 'Přijímáme pouze platbu kartou.' };
  if (pm[faq.payment]) parts.push(pm[faq.payment]);
  if (faq.wheelchair === 'yes') parts.push('Bezbariérový přístup.');
  if (faq.wheelchair === 'no')  parts.push('Přístup není bezbariérový.');
  const langNames = { cs: 'čeština', en: 'angličtina', sk: 'slovenština', de: 'němčina', fr: 'francouzština' };
  const langs = data.languages.map(l => langNames[l] || l);
  if (langs.length) parts.push(`Komunikační jazyky: ${langs.join(', ')}.`);
  if (data.giftVouchers === 'yes') parts.push('Nabízíme dárkové poukazy.');
  if (data.giftVouchers === 'no')  parts.push('Dárkové poukazy neposkytujeme.');
  return parts.join(' ') || null;
}

function buildAiNotes(data) {
  const parts = [];
  if (data.teamMode === 'team') {
    const members = data.team.filter(m => m.name);
    if (members.length) parts.push(`Zaměstnanci: ${members.map(m => m.role ? `${m.name} (${m.role})` : m.name).join(', ')}.`);
  }
  const newClientsMap = {
    always: 'Přijímáme nové zákazníky bez omezení.',
    consultation: 'Noví zákazníci musí nejprve absolvovat konzultaci — teprve pak mohou rezervovat.',
    closed: 'V současné době nepřijímáme nové zákazníky.',
  };
  if (newClientsMap[data.newClients]) parts.push(newClientsMap[data.newClients]);
  const childrenMap = { welcome: 'Děti jsou vítány.', adult: 'Děti pouze v doprovodu dospělé osoby.', no: 'Provozovna není vhodná pro děti.' };
  if (childrenMap[data.childrenPolicy]) parts.push(childrenMap[data.childrenPolicy]);
  const depositMap = {
    none: 'Záloha není vyžadována.',
    firstTime: 'Záloha je vyžadována při první rezervaci.',
    large: `Záloha je vyžadována u rezervací nad ${data.depositThreshold || '2000'} Kč.`,
    always: 'Záloha je vyžadována u každé rezervace.',
  };
  if (depositMap[data.deposit]) parts.push(depositMap[data.deposit]);
  if (data.specialRules) parts.push(data.specialRules);
  if (data.aiNotes)      parts.push(data.aiNotes);
  return parts.join('\n') || null;
}

function buildCancellationPolicy(data) {
  const map = {
    free: 'Rezervace lze zrušit kdykoliv bez poplatku.',
    '24': 'Rezervaci lze zrušit bezplatně nejpozději 24 hodin předem.',
    '48': 'Rezervaci lze zrušit bezplatně nejpozději 48 hodin předem.',
    '72': 'Rezervaci lze zrušit bezplatně nejpozději 72 hodin předem.',
    custom: data.cancellationCustom || null,
  };
  return map[data.cancellationPolicy] || null;
}

/* ── Main ── */
export default function Onboarding() {
  const navigate  = useNavigate();
  const [step, setStep]     = useState(0);
  const [data, setData]     = useState(DEFAULT_DATA);
  const [saving, setSaving] = useState(false);

  const set  = (patch) => setData(d => ({ ...d, ...patch }));
  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const goTo = (i) => setStep(i);

  async function handleSkip() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await saveCompanySettings(user.id, { onboarding_completed: true });
    } catch {
      try { localStorage.setItem('pl:onboarding_skipped', '1'); } catch { /* ignore */ }
    }
    navigate('/app');
  }

  async function handleFinish() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      await saveCompanySettings(user.id, {
        company_name:             data.bizName || null,
        company_description:      buildCompanyDescription(data),
        ai_notes:                 buildAiNotes(data),
        cancellation_policy:      buildCancellationPolicy(data),
        escalation_phone:         data.escalationPhone || null,
        lead_time_minutes:        parseInt(data.leadTimeMinutes) || 120,
        max_booking_horizon_days: 60,
        timezone:                 'Europe/Prague',
        working_hours:            buildWorkingHours(data.hours),
        ai_voice:                 data.voice,
        ai_tone:                  data.tone,
        onboarding_completed:     true,
        ...(data.twilioPhone ? { twilio_phone_number: data.twilioPhone } : {}),
      });

      const validServices = data.services.filter(s => s.name.trim());
      await Promise.all(validServices.map(s =>
        createService({
          name:             s.name.trim(),
          price:            parseFloat(s.price) || null,
          duration_min:     parseInt(s.duration) || 60,
          buffer_after_min: 0,
          description:      s.description.trim() || null,
          prep_note:        s.prepNote.trim() || null,
        })
      ));

      if (data.teamMode === 'team') {
        const validMembers = data.team.filter(m => m.name.trim());
        await Promise.all(validMembers.map(m =>
          createStaff({ name: m.name.trim(), notes: m.role || null }).catch(() => {})
        ));
      }

      navigate('/payment');
    } catch (err) {
      toast.error('Nepodařilo se uložit: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const renderStep = () => {
    switch (step) {
      case 0:  return <StepWelcome   onNext={next} onSkip={handleSkip} />;
      case 1:  return <StepName      data={data} set={set} />;
      case 2:  return <StepType      data={data} set={set} />;
      case 3:  return <StepLocation  data={data} set={set} />;
      case 4:  return <StepStory     data={data} set={set} />;
      case 5:  return <StepLanguages data={data} set={set} />;
      case 6:  return <StepPractical data={data} set={set} />;
      case 7:  return <StepClients   data={data} set={set} />;
      case 8:  return <StepDeposit   data={data} set={set} />;
      case 9:  return <StepTiming    data={data} set={set} />;
      case 10: return <StepNotes     data={data} set={set} />;
      case 11: return <StepHours     data={data} set={set} />;
      case 12: return <StepServices  data={data} set={set} />;
      case 13: return <StepTeam      data={data} set={set} />;
      case 14: return <StepVoice     data={data} set={set} />;
      case 15: return <StepPhone     data={data} set={set} />;
      case 16: return <StepDone      data={data} goTo={goTo} />;
      default: return null;
    }
  };

  const isLastStep   = step === STEPS.length - 1;
  const nextDisabled = (step === 1 && !data.bizName) || (step === 2 && !data.bizType) || saving;
  const showFooter   = step !== 0;
  const showSkip     = step >= 3 && step <= 15;

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
            nextLabel={isLastStep ? (saving ? 'Ukládám…' : 'Otevřít aplikaci') : 'Pokračovat'}
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
