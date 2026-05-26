import { useState, useEffect, useRef } from 'react';
import { Icons as I } from '../components/Icons.jsx';
import '../styles/globals.css';
import './Landing.css';

/* ─── Nav ─────────────────────────────────────────────────── */
const Nav = () => (
  <header className="l-nav">
    <div className="brand">
      <div className="brand-mark">P</div>
      <div className="brand-name">PlanLess</div>
    </div>
    <nav className="links">
      <a href="#features">Funkce</a>
      <a href="#journey">Jak to funguje</a>
      <a href="#pricing">Ceník</a>
      <a href="#faq">Otázky</a>
    </nav>
    <div className="spacer" />
    <div className="cta-row">
      <a href="/login" className="btn">Přihlásit se</a>
      <a href="/register" className="btn accent">Vyzkoušet zdarma</a>
    </div>
  </header>
);

/* ─── Hero ───────────────────────────────────────────────── */
const Hero = () => (
  <section className="hero">
    <div className="wrap">
      <div className="hero-grid">
        {/* Left column */}
        <div>
          <div className="l-eyebrow">AI recepční · pro malé firmy v ČR</div>
          <h1>
            Telefon, který nikdy nezmešká{' '}
            <span className="it">hovor</span>.
          </h1>
          <p className="lead">
            PlanLess zvedá telefon za vás. Domluví termín, odpoví na ceník,
            pošle SMS. Vy se soustředíte na práci, klienti dostanou rychlou
            odpověď. Žádné IT, žádné kódy — jen 5 minut nastavení.
          </p>
          <div className="hero-ctas">
            <button className="btn accent lg">Začít zdarma — 14 dní</button>
            <button className="btn ghost lg">
              <I.Play s={12} /> Sledovat ukázku (60s)
            </button>
          </div>
          <div className="hero-trust">
            <div className="av-stack">
              <div className="a av-0">JS</div>
              <div className="a av-1">ON</div>
              <div className="a av-2">TR</div>
              <div className="a av-3">MK</div>
            </div>
            <div>
              Důvěřuje{' '}
              <strong style={{ color: 'var(--ink)' }}>200+ malých firem</strong>{' '}
              v ČR a SR
            </div>
            <div style={{ flex: 1 }} />
            <div className="stars" style={{ display: 'flex', gap: 2, color: 'var(--accent)', alignItems: 'center' }}>
              <I.StarF s={11} />
              <I.StarF s={11} />
              <I.StarF s={11} />
              <I.StarF s={11} />
              <I.StarF s={11} />
              <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>4.9 / 5</span>
            </div>
          </div>
        </div>

        {/* Right column — editorial daily-report card */}
        <div className="hero-report-wrap">
          <div className="hero-report">
            <div className="stamp">Dnes · 16:30</div>
            <div className="r-eyebrow">Zápis ode dne 22. dubna</div>
            <h3 className="r-greet">
              Dobrý den, <span className="it">Svatopluku</span>.
            </h3>
            <p className="r-body">
              Dnes jsem za vás vyřídila{' '}
              <span className="num">14 hovorů</span> a vytvořila{' '}
              <span className="num">7 nových rezervací</span>. Nikdo nečekal
              déle než 6 vteřin. Tady je přehled dne.
            </p>
            <div className="r-stats">
              <div className="r-stat accent">
                <div className="n">14</div>
                <div className="l">hovorů</div>
              </div>
              <div className="r-stat">
                <div className="n">7</div>
                <div className="l">rezervací</div>
              </div>
              <div className="r-stat">
                <div className="n">0</div>
                <div className="l">zmeškaných</div>
              </div>
            </div>
            <div className="r-list">
              <div className="r-item">
                <div className="t">14:52</div>
                <div className="b">
                  <strong>Klára Svobodová</strong>
                  <div className="x">Barvení + střih · Pá 24. 4.</div>
                </div>
                <div className="pill">
                  <span className="d" />
                  LIVE
                </div>
              </div>
              <div className="r-item">
                <div className="t">14:31</div>
                <div className="b">
                  <strong>Marek Dvořák</strong>
                  <div className="x">Pánský střih · Po 27. 4.</div>
                </div>
              </div>
              <div className="r-item">
                <div className="t">13:08</div>
                <div className="b">
                  <strong>Jana Horáková</strong>
                  <div className="x">Přesun · pátek → čtvrtek</div>
                </div>
              </div>
            </div>
            <div className="r-sig">
              — Nikola{' '}
              <div className="wv">
                <i /><i /><i /><i /><i />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Problem ────────────────────────────────────────────── */
const Problem = () => (
  <section className="problem">
    <div className="wrap">
      <div className="problem-head">
        <div className="l-eyebrow">Proč PlanLess</div>
        <h2>
          Tři čísla, která ničí{' '}
          <span className="it">vaše tržby</span>.
        </h2>
        <p className="sub">
          Každý zmeškaný hovor je klient, který jde ke konkurenci. Tady je,
          kolik to ve skutečnosti stojí.
        </p>
      </div>
      <div className="problem-stats">
        <div className="problem-stat">
          <div className="n">
            38<span className="unit">%</span>
          </div>
          <div className="t">Hovorů malých firem skončí bez odpovědi</div>
          <div className="x">
            Když zákazník nedovolá, ve většině případů zavolá konkurenci — a
            už se nevrátí.
          </div>
        </div>
        <div className="problem-stat">
          <div className="n">
            63<span className="unit">%</span>
          </div>
          <div className="t">Zákazníků nenechá vzkaz na záznamníku</div>
          <div className="x">
            Hlasovou schránku už nikdo neposlouchá. SMS, e-mail nebo živý hlas
            — to je dnes standard.
          </div>
        </div>
        <div className="problem-stat">
          <div className="n">~24k</div>
          <div className="t">Kč měsíčně, které vám utíkají</div>
          <div className="x">
            Průměrný malý salon přijde každý měsíc o 8–12 rezervací jen kvůli
            neodbavenému telefonu.
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Journey — 3D phone sub-component ──────────────────── */
const Phone3D = ({ stage, progress }) => (
  <div className="j-3d" data-stage={stage} style={{ '--p': progress }}>

    {/* Floaters */}
    <div className="float-l float-l-0">
      <div className="float-label" style={{ color: 'var(--red)' }}>Pondělí 10:32</div>
      <div className="float-title">3 zmeškané hovory za hodinu</div>
    </div>
    <div className="float-r float-r-0">
      <div className="float-label">Ztráta</div>
      <div className="float-title" style={{ fontFamily: 'Newsreader, serif', fontSize: 18, color: 'var(--accent)' }}>~2 400 Kč</div>
    </div>

    <div className="float-l float-l-1">
      <div className="float-label">5 minut</div>
      <div className="float-title">Otevírací doba, služby, hlas asistenta</div>
    </div>
    <div className="float-r float-r-1">
      <div className="float-label">Bez kódu</div>
      <div className="float-title" style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}>Zvládne to každý</div>
    </div>

    <div className="float-l float-l-2">
      <div className="float-label">Příchozí</div>
      <div className="float-title">Klára Svobodová volá poprvé</div>
    </div>
    <div className="float-r float-r-2">
      <div className="float-label">Zvedáno za</div>
      <div className="float-title" style={{ fontFamily: 'Newsreader, serif', fontSize: 22, color: 'var(--accent)' }}>1 zazvonění</div>
    </div>

    <div className="float-l float-l-3">
      <div className="float-label">PlanLess si pamatuje</div>
      <div className="float-title" style={{ fontSize: 12 }}>Alergie na amoniak — bez ní žádné barvení</div>
    </div>
    <div className="float-r float-r-3">
      <div className="float-label">Vy mezitím</div>
      <div className="float-title" style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}>Stříháte v klidu</div>
    </div>

    <div className="float-l float-l-4">
      <div className="float-label">Kalendář</div>
      <div className="float-title">Pá 24. 4. · 10:00 · Tereza</div>
    </div>
    <div className="float-r float-r-4">
      <div className="float-label">SMS odeslána</div>
      <div className="float-title" style={{ fontSize: 12 }}>„Potvrzujeme rezervaci…"</div>
    </div>

    <div className="float-l float-l-5">
      <div className="float-label">Měsíc s PlanLess</div>
      <div className="float-title">+18 rezervací oproti minulému měsíci</div>
    </div>
    <div className="float-r float-r-5">
      <div className="float-label">Návratnost</div>
      <div className="float-title" style={{ fontFamily: 'Newsreader, serif', fontSize: 22, color: 'var(--accent)' }}>12× náklady</div>
    </div>

    {/* Phone frame */}
    <div className="j-phone">
      <div className="btn-mute" />
      <div className="btn-vol-up" />
      <div className="btn-vol-dn" />
      <div className="btn-power" />
      <div className="j-screen">
        <div className="j-notch" />

        {/* Stage 0 — Missed calls (before PlanLess) */}
        <div className="j-state j-state-0">
          <div className="lab-eyebrow">Bez PlanLess · dnes dopoledne</div>
          <div className="big-loss">3 zmeškané hovory</div>
          <div className="loss-sub">Za poslední 2 hodiny. Každý z nich byla potenciální rezervace.</div>
          {[
            { n: 'Neznámé číslo', s: '10:32 · ztráta klientky', t: '10:32' },
            { n: 'Klára S.',       s: '10:48 · zavolá konkurenci', t: '10:48' },
            { n: 'Neznámé číslo', s: '11:14 · žádný vzkaz', t: '11:14' },
          ].map((m, i) => (
            <div key={i} className="j-miss">
              <div className="ic-x"><I.PhoneOff s={12} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="who">{m.n}</div>
                <div className="sub">{m.s}</div>
              </div>
              <div className="time">{m.t}</div>
            </div>
          ))}
          <div className="foot-total">
            <div className="lbl">Odhadovaná ztráta</div>
            <div className="v">7 200 Kč</div>
          </div>
        </div>

        {/* Stage 1 — Onboarding */}
        <div className="j-state j-state-1">
          <div className="j-onb-top">
            <div className="j-onb-progress-bar"><i style={{ width: '25%' }} /></div>
            <div className="j-onb-step">2 / 8</div>
          </div>
          <div className="j-onb-eyebrow">Vaše firma</div>
          <div className="j-onb-q">
            Jak se vaše firma <span className="it">jmenuje</span>?
          </div>
          <div className="j-onb-input">Salon Svatopluk</div>
          <div className="j-onb-label">A co děláte?</div>
          <div className="j-onb-tile on">
            <div className="b"><I.Check s={11} /></div>
            Kadeřnictví / salon
          </div>
          <div className="j-onb-tile">
            <div className="b" />
            Lékař / zubař
          </div>
          <div className="j-onb-tile">
            <div className="b" />
            Restaurace
          </div>
        </div>

        {/* Stage 2 — Incoming call */}
        <div className="j-state j-state-2">
          <div className="pickup-tag">PlanLess zvedá za 1 zazvonění</div>
          <div className="j-call-av">N</div>
          <div className="j-call-status">Příchozí hovor</div>
          <div className="j-call-name">Klára Svobodová</div>
          <div className="j-call-num">+420 724 118 220 · mobilní</div>
          <div className="j-call-actions">
            <div style={{ textAlign: 'center' }}>
              <div className="j-call-btn decline"><I.PhoneOff s={20} /></div>
              <div className="j-call-btn-lbl">odmítnout</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="j-call-btn accept"><I.Phone s={20} /></div>
              <div className="j-call-btn-lbl">přijímám</div>
            </div>
          </div>
        </div>

        {/* Stage 3 — Transcript */}
        <div className="j-state j-state-3">
          <div className="j-tr-head">
            <div className="av">N</div>
            <div className="who">
              Klára Svobodová
              <div className="sub">živý přepis hovoru</div>
            </div>
            <div className="dur">0:42</div>
          </div>
          <div className="j-bubble ai">Dobrý den, salon Svatopluk. Jak vám mohu pomoci?</div>
          <div className="j-bubble cl">Chtěla bych barvení tento pátek.</div>
          <div className="j-bubble ai">Vidím u vás alergii na amoniak — platí to?</div>
          <div className="j-bubble cl">Ano, prosím bez amoniaku.</div>
          <div className="j-bubble ai">Pátek 10:00 u Terezy — vyhovuje?</div>
          <div className="j-bubble cl typing"><i /><i /><i /></div>
        </div>

        {/* Stage 4 — Booking confirmed */}
        <div className="j-state j-state-4">
          <div className="j-confirm">
            <div className="ic"><I.Check s={20} /></div>
            <div className="head">Rezervace vytvořena</div>
          </div>
          <div className="j-cal-card">
            <div className="date-block">
              <div className="m">Dub</div>
              <div className="d">24</div>
            </div>
            <div>
              <div className="title">Barvení + střih</div>
              <div className="meta">10:00–12:00 · Tereza · 1 900 Kč</div>
            </div>
          </div>
          <div className="j-sms">
            <div className="lbl">SMS klientce</div>
            Potvrzujeme: Pá 24. 4. v 10:00, Tereza. Salon Svatopluk.
          </div>
          <div className="foot-note">Bez vašeho zásahu · trvalo 53 vteřin</div>
        </div>

        {/* Stage 5 — Revenue */}
        <div className="j-state j-state-5">
          <div className="j-rev-eyebrow">Tento měsíc s PlanLess</div>
          <div className="j-rev-n">
            <span className="plus">+</span>42 720<span className="cur">Kč</span>
          </div>
          <div className="j-rev-l">
            přidané tržby z rezervací, které byste jinak propásli
          </div>
          <div className="j-rev-chart">
            {[18, 28, 22, 38, 32, 46, 42, 56, 48, 62, 58, 72].map((h, i) => (
              <i key={i} style={{ height: h + '%' }} />
            ))}
          </div>
          <div className="j-rev-trend">
            <I.ArrowR s={11} /> +18 % oproti minulému
          </div>
        </div>

      </div>
    </div>
  </div>
);

/* ─── Journey section ────────────────────────────────────── */
const Journey = () => {
  const stageRef = useRef(null);
  const [stage, setStage]       = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = stageRef.current;
      if (!el) return;
      const rect   = el.getBoundingClientRect();
      const total  = rect.height - window.innerHeight;
      const scrolled = -rect.top;
      const p = Math.max(0, Math.min(1, scrolled / total));
      setProgress(p);
      const s = Math.max(0, Math.min(5, Math.floor(p * 6 * 1.001)));
      setStage(s);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const steps = [
    {
      n: 'Před PlanLess',
      h: <>Hovory padají do <span className="it">prázdna</span>.</>,
      p: (
        <>
          Klienti volají, ale vy zrovna stříháte, jste v ordinaci, na
          schůzce. Záznamník nikdo neposlouchá — a klient zavolá{' '}
          <strong>někomu jinému</strong>. Každý takový telefon je{' '}
          <strong>800 až 2 400 Kč</strong>, které vám utečou.
        </>
      ),
    },
    {
      n: 'Krok 1 — Nastavení',
      h: <>5 minut a váš telefon je <span className="it">připravený</span>.</>,
      p: (
        <>
          Postupně se vás zeptáme na pár věcí: jak se firma jmenuje, kdy máte
          otevřeno, jaké služby nabízíte. Žádný IT-jazyk, žádné kódy. Pak si
          vyberete hlas a jste hotoví.
        </>
      ),
    },
    {
      n: 'Krok 2 — Klient volá',
      h: <>Klient volá. <span className="it">Zvedáme za 1 zazvonění.</span></>,
      p: (
        <>
          Vaše telefonní číslo zvoní v PlanLess přesně tak, jak by zvonilo u
          vás — ale zvedneme ho každý den, kdykoliv. Klient slyší příjemný
          lidský hlas, který se představí jménem vaší firmy.
        </>
      ),
    },
    {
      n: 'Krok 3 — AI rozumí',
      h: <>PlanLess si pamatuje <span className="it">všechno</span>.</>,
      p: (
        <>
          Zná vaše služby, ceny, otevírací dobu, kdo dělá co. Zná i historii
          klientů — alergie, preference, kdy byli naposled. Ptá se klidně,
          navrhuje termíny, nabídne kávu. Mezitím vy{' '}
          <strong>můžete v klidu pracovat</strong>.
        </>
      ),
    },
    {
      n: 'Krok 4 — Rezervace',
      h: <>Termín v <span className="it">kalendáři</span>, SMS odeslána.</>,
      p: (
        <>
          PlanLess sám vytvoří rezervaci ve vašem kalendáři. Klientovi pošle
          potvrzovací SMS. Vy uvidíte v aplikaci shrnutí: kdo, co, kdy, za
          kolik. Nemusíte se ničeho dotknout.
        </>
      ),
    },
    {
      n: 'Krok 5 — Profit',
      h: <>Za měsíc <span className="it">10×</span> víc rezervací.</>,
      p: (
        <>
          Průměrná firma s PlanLess přijme měsíčně o{' '}
          <strong>15–25 rezervací víc</strong>. Při průměrné útratě 1 600 Kč
          to dělá <strong>+24 000 Kč tržeb</strong>. Při ceně 2 490 Kč/měsíc
          je to 10× návratnost.
        </>
      ),
    },
  ];

  return (
    <section className="journey" id="journey">
      <div className="wrap">
        <div className="journey-head">
          <div className="l-eyebrow">Jak to celé funguje</div>
          <h2>
            Od propásnutého hovoru
            <br />k <span className="it">předem placené rezervaci</span>.
          </h2>
          <p className="sub">
            Scrollujte. Ukážu vám, jak se z prvního nastavení během 5 minut
            stane stabilní zdroj nových klientů.
          </p>
        </div>
      </div>

      <div className="journey-stage" ref={stageRef}>
        <div
          className="journey-sticky"
          data-stage={stage}
          style={{ '--p': progress }}
        >
          {/* Progress dots */}
          <div className="j-progress">
            {steps.map((_, i) => (
              <div key={i} className={`p-dot p-${i}`} />
            ))}
          </div>

          {/* 3D phone */}
          <Phone3D stage={stage} progress={progress} />

          {/* Right-side step text */}
          <div className="j-text">
            {steps.map((st, i) => (
              <div key={i} className={`j-step j-step-${i}`}>
                <div className="num-row">
                  <div className="big-num">{String(i + 1).padStart(2, '0')}</div>
                  <div className="num">{st.n}</div>
                </div>
                <h3>{st.h}</h3>
                <p className="p">{st.p}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

/* ─── Features ───────────────────────────────────────────── */
const Features = () => {
  const items = [
    { Icon: I.Phone,    t: 'Hovory 24/7',                      p: 'PlanLess zvedne každý hovor, i v noci a o víkendech. Klient vždy slyší živý hlas, ne záznamník.' },
    { Icon: I.Brain,    t: 'Pamatuje si klienty',              p: 'Alergie, preference, historii — všechno zůstává dostupné. Klient si připadá osobně přivítaný.' },
    { Icon: I.Calendar, t: 'Sama rezervuje',                   p: 'Vytváří termíny v kalendáři podle vašich pravidel. Konflikty řeší sama, vy už jen pracujete.' },
    { Icon: I.Message,  t: 'SMS potvrzení',                    p: 'Po rezervaci automaticky pošle potvrzení s detaily. Klient ví, kdy a kde má být.' },
    { Icon: I.Globe,    t: 'Mluví česky, slovensky i anglicky', p: 'Rozumí různým přízvukům a vyrovná se i s šuměním ulice. Plynně přepíná jazyky.' },
    { Icon: I.Bell,     t: 'Upozorní vás, když je potřeba',    p: 'Důležitý hovor, urgentní žádost o přesun, VIP klient — PlanLess vás upozorní v aplikaci nebo SMS.' },
    { Icon: I.Users,    t: 'Pro celý tým',                     p: 'Pokud vás je víc, PlanLess rozdělí klienty mezi vás podle jejich preferencí a vaší dostupnosti.' },
    { Icon: I.Bell,     t: 'Vaše data jsou v ČR',              p: 'Hovory, klienti, rezervace — všechno na serverech v Praze. GDPR splňujeme do detailu.' },
    { Icon: I.X,        t: 'Bez závazku, kdykoliv ukončíte',   p: 'Žádné dlouhé smlouvy, žádné nastavovací poplatky. Jeden klik a předplatné je pryč.' },
  ];

  // Correct icons for each item
  const icons = [I.Phone, I.Brain, I.Calendar, I.Message, I.Globe, I.Bell, I.Users, I.Bell, I.X];

  return (
    <section className="features" id="features">
      <div className="wrap">
        <div className="features-head">
          <div className="l-eyebrow">Co všechno PlanLess umí</div>
          <h2>
            AI, která se chová jako <span className="it">živá recepční</span>.
          </h2>
          <p className="sub">
            Není to chatbot v okně. Je to recepční, která zvedá telefon, mluví
            s klienty, vytváří rezervace a vrací vám čas.
          </p>
        </div>
        <div className="features-grid">
          {[
            { Icon: I.Phone,    t: 'Hovory 24/7',                       p: 'PlanLess zvedne každý hovor, i v noci a o víkendech. Klient vždy slyší živý hlas, ne záznamník.' },
            { Icon: I.Brain,    t: 'Pamatuje si klienty',               p: 'Alergie, preference, historii — všechno zůstává dostupné. Klient si připadá osobně přivítaný.' },
            { Icon: I.Calendar, t: 'Sama rezervuje',                    p: 'Vytváří termíny v kalendáři podle vašich pravidel. Konflikty řeší sama, vy už jen pracujete.' },
            { Icon: I.Message,  t: 'SMS potvrzení',                     p: 'Po rezervaci automaticky pošle potvrzení s detaily. Klient ví, kdy a kde má být.' },
            { Icon: I.Globe,    t: 'Mluví česky, slovensky i anglicky', p: 'Rozumí různým přízvukům a vyrovná se i s šuměním ulice. Plynně přepíná jazyky.' },
            { Icon: I.Bell,     t: 'Upozorní vás, když je potřeba',    p: 'Důležitý hovor, urgentní žádost o přesun, VIP klient — PlanLess vás upozorní v aplikaci nebo SMS.' },
            { Icon: I.Users,    t: 'Pro celý tým',                      p: 'Pokud vás je víc, PlanLess rozdělí klienty mezi vás podle jejich preferencí a vaší dostupnosti.' },
            { Icon: I.Lock,     t: 'Vaše data jsou v ČR',               p: 'Hovory, klienti, rezervace — všechno na serverech v Praze. GDPR splňujeme do detailu.' },
            { Icon: I.X,        t: 'Bez závazku, kdykoliv ukončíte',    p: 'Žádné dlouhé smlouvy, žádné nastavovací poplatky. Jeden klik a předplatné je pryč.' },
          ].map(({ Icon, t, p }, i) => (
            <div key={i} className="feature">
              <div className="ic"><Icon s={18} /></div>
              <h4>{t}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── Testimonial ────────────────────────────────────────── */
const Testimonial = () => (
  <section className="testi">
    <div className="wrap">
      <div className="testi-card">
        <div className="quote">
          „Před PlanLess jsme propásli skoro každý druhý hovor. Teď zvedáme
          všechny — a AI vyřídí 70 % rezervací sama. Tržby nahoru o čtvrtinu,
          a já mám klid stříhat."
        </div>
        <div className="author">
          <div className="av-testi">SV</div>
          <div>
            <div className="who">Svatopluk Velíšek</div>
            <div className="role">Majitel · Salon Svatopluk, Praha</div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Pricing ─────────────────────────────────────────────── */
const cx = (...a) => a.filter(Boolean).join(' ');

const Pricing = () => {
  const [yearly, setYearly] = useState(false);

  const tiers = [
    {
      name: 'Starter',
      desc: 'Pro freelancery a jednoosobové firmy, kteří chtějí PlanLess vyzkoušet.',
      priceM: 890, priceY: 712,
      cta: 'Začít zdarma — 14 dní',
      features: [
        ['Až 100 hovorů / měsíc', true],
        ['Český jazyk', true],
        ['Rezervace + SMS', true],
        ['Základní Tweaks (hlas, tón)', true],
        ['Vlastní pravidla AI', false],
        ['Integrace s kalendářem', false],
      ],
    },
    {
      name: 'Professional',
      desc: 'Pro malé firmy a salony s několika kolegy. Nejprodávanější.',
      priceM: 2490, priceY: 1990,
      cta: 'Vyzkoušet 14 dní zdarma',
      featured: true, popular: true,
      features: [
        ['Až 500 hovorů / měsíc', true],
        ['CZ, SK, EN, DE', true],
        ['Rezervace + SMS + e-mail', true],
        ['Pokročilé Tweaks a pravidla', true],
        ['Google Calendar, Reservio', true],
        ['Prioritní podpora', true],
      ],
    },
    {
      name: 'Business',
      desc: 'Pro provozy s vyšším objemem hovorů a vlastními požadavky.',
      priceM: 5490, priceY: 4390,
      cta: 'Domluvit hovor',
      features: [
        ['Neomezené hovory', true],
        ['Vlastní jazyky a hlas', true],
        ['API a vlastní integrace', true],
        ['Dedikovaný manažer', true],
        ['SLA 99,9 % dostupnost', true],
        ['On-prem nasazení (volitelné)', true],
      ],
    },
  ];

  return (
    <section className="pricing" id="pricing">
      <div className="wrap">
        <div className="pricing-head">
          <div className="l-eyebrow">Cena</div>
          <h2>
            Jeden klient měsíčně{' '}
            <span className="it">a máte zaplaceno</span>.
          </h2>
          <p className="sub">
            14 dní zdarma. Bez kreditky. Bez závazku. Předplatné kdykoliv
            zrušíte.
          </p>
          <div className="bill-toggle">
            <button
              className={cx(!yearly && 'on')}
              onClick={() => setYearly(false)}
            >
              Měsíčně
            </button>
            <button
              className={cx(yearly && 'on')}
              onClick={() => setYearly(true)}
            >
              Ročně <span className="save">−20 %</span>
            </button>
          </div>
        </div>

        <div className="pricing-grid">
          {tiers.map((t) => (
            <div key={t.name} className={cx('tier', t.featured && 'featured')}>
              {t.popular && <div className="pop">Nejoblíbenější</div>}
              <div className="tier-name">{t.name}</div>
              <div className="tier-desc">{t.desc}</div>
              <div className="tier-price">
                {(yearly ? t.priceY : t.priceM).toLocaleString('cs-CZ')}
                <span className="cur">Kč</span>
                <span className="per">/ měsíc</span>
              </div>
              <div className="tier-billing">
                {yearly ? 'fakturováno ročně' : 'fakturováno měsíčně'} · bez DPH
              </div>
              <div className="tier-cta">
                <button className={cx('btn', t.featured ? 'accent' : 'primary')}>
                  {t.cta}
                </button>
              </div>
              <div className="tier-features">
                {t.features.map(([txt, on], i) => (
                  <div key={i} className={cx('row', !on && 'dim')}>
                    <div className="c"><I.Check s={9} /></div>
                    <div>{txt}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 32, fontSize: 13, color: 'var(--ink-3)' }}>
          Potřebujete víc než 5000 hovorů měsíčně?{' '}
          <a style={{ color: 'var(--accent)', cursor: 'pointer' }}>Napište nám →</a>
        </div>
      </div>
    </section>
  );
};

/* ─── FAQ ─────────────────────────────────────────────────── */
const FAQ = () => {
  const [open, setOpen] = useState(0);

  const items = [
    {
      q: 'Jak rychle můžu začít?',
      a: 'Registrace a nastavení trvá kolem 5 minut. Po dokončení vás PlanLess zavolá na vaše soukromé číslo, abyste si ověřili, jak zní v reálu. Pak jen přepojíme telefon a začínáte.',
    },
    {
      q: 'Musím mít nové telefonní číslo?',
      a: 'Ne. Můžete buď dostat nové PlanLess číslo, nebo přesměrovat hovory ze stávajícího čísla — fungují obě varianty. Stávající číslo dál vlastníte vy, my jen převezmeme to, co nestihnete zvednout.',
    },
    {
      q: 'Co když AI něčemu neporozumí?',
      a: 'V takovém případě vám hovor zaznamená do aplikace s upozorněním. Můžete pak klientovi zavolat zpět. V praxi se to stává zhruba u 5 % hovorů — většinou když klient mluví příliš nezřetelně nebo se ptá na něco mimo váš obor.',
    },
    {
      q: 'Komu patří data klientů?',
      a: 'Vám. Jsou uložené na serverech v Praze, šifrované, splňujeme GDPR. Můžete je kdykoliv exportovat nebo smazat. My je nepoužíváme k tréninku AI ani je nedáváme nikomu třetímu.',
    },
    {
      q: 'Funguje to i o víkendu a v noci?',
      a: 'Ano, 24 hodin denně, 7 dní v týdnu. Můžete určit, že mimo otevírací dobu PlanLess jen vezme vzkaz a pošle vám SMS — nebo že nabídne rezervaci na další otevřený den.',
    },
    {
      q: 'Co když chci skončit?',
      a: 'Jeden klik v nastavení. Žádná výpovědní lhůta, žádné penále. Vaše data si můžete stáhnout, klientský seznam je váš.',
    },
    {
      q: 'Můžu PlanLess vyzkoušet zdarma?',
      a: 'Ano, 14 dní úplně zdarma. Nemusíte zadávat platební kartu. Po 14 dnech buď zaplatíte, nebo přestaneme. Žádné kličky.',
    },
    {
      q: 'Jak vypadá podpora?',
      a: 'Český e-mail a chat, odpovídáme do 4 hodin v pracovní době, do 24 hodin o víkendu. Plán Business má dedikovaného manažera s telefonem na pohotovostní linku.',
    },
  ];

  return (
    <section className="faq" id="faq">
      <div className="wrap">
        <div className="faq-head">
          <div className="l-eyebrow">Otázky</div>
          <h2>
            Co se nás <span className="it">obvykle ptají</span>.
          </h2>
        </div>
        <div className="faq-list">
          {items.map((it, i) => (
            <div key={i} className={cx('faq-item', open === i && 'open')}>
              <div
                className="faq-q"
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                <span>{it.q}</span>
                <span className="icq"><I.Plus s={13} /></span>
              </div>
              <div className="faq-a">
                <div className="faq-a-body">{it.a}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 32, fontSize: 13.5, color: 'var(--ink-3)' }}>
          Máte jinou otázku?{' '}
          <a style={{ color: 'var(--accent)', cursor: 'pointer' }}>Napište nám →</a>
        </div>
      </div>
    </section>
  );
};

/* ─── Final CTA ───────────────────────────────────────────── */
const FinalCTA = () => (
  <section className="final-cta">
    <div className="wrap">
      <div className="final-card">
        <div className="l-eyebrow" style={{ justifyContent: 'center', display: 'inline-flex' }}>
          Začneme dnes?
        </div>
        <h2>
          Zítra v tuhle dobu už mohli mít vaši klienti{' '}
          <span className="it">rezervaci</span>.
        </h2>
        <div className="p">
          14 dní zdarma · bez kreditky · nastavení za 5 minut.
        </div>
        <div className="ctas">
          <button className="btn accent lg">Vyzkoušet zdarma</button>
          <button className="btn ghost lg">
            <I.Play s={12} /> Sledovat ukázku (60s)
          </button>
        </div>
      </div>
    </div>
  </section>
);

/* ─── Footer ──────────────────────────────────────────────── */
const Footer = () => (
  <footer className="l-footer">
    <div className="foot-grid">
      <div className="foot-brand">
        <div className="b">
          <div className="brand-mark">P</div>
          <div className="brand-name">PlanLess</div>
        </div>
        <div className="blurb">
          AI recepční pro malé firmy v Česku a na Slovensku. Telefon, který
          nikdy nezmešká hovor.
        </div>
      </div>
      <div className="foot-col">
        <h5>Produkt</h5>
        <ul>
          <li><a href="#features">Funkce</a></li>
          <li><a href="#journey">Jak to funguje</a></li>
          <li><a href="#pricing">Ceník</a></li>
          <li><a href="#">Pro koho je</a></li>
          <li><a href="#">Změny</a></li>
        </ul>
      </div>
      <div className="foot-col">
        <h5>Firma</h5>
        <ul>
          <li><a href="#">O nás</a></li>
          <li><a href="#">Kontakt</a></li>
          <li><a href="#">Blog</a></li>
          <li><a href="#">Kariéra</a></li>
        </ul>
      </div>
      <div className="foot-col">
        <h5>Právní</h5>
        <ul>
          <li><a href="#">Podmínky</a></li>
          <li><a href="#">Zpracování dat</a></li>
          <li><a href="#">GDPR</a></li>
          <li><a href="#">Bezpečnost</a></li>
        </ul>
      </div>
    </div>
    <div className="foot-bottom">
      <div>© 2026 PlanLess s.r.o. · IČO 08 415 290</div>
      <div>Praha · Brno · Bratislava</div>
    </div>
  </footer>
);

/* ─── Page export ─────────────────────────────────────────── */
export default function Landing() {
  return (
    <>
      <div className="ambient" />
      <Nav />
      <Hero />
      <Problem />
      <Journey />
      <Features />
      <Testimonial />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </>
  );
}
