import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/globals.css';
import './Login.css';
import { Icons as I } from '../components/Icons.jsx';
import { supabase } from '../lib/supabase.js';

function validatePassword(pw) {
  if (pw.length < 8) return 'Heslo musí mít alespoň 8 znaků.';
  if (!/[A-Z]/.test(pw)) return 'Heslo musí obsahovat velké písmeno.';
  if (!/[a-z]/.test(pw)) return 'Heslo musí obsahovat malé písmeno.';
  if (!/[0-9]/.test(pw)) return 'Heslo musí obsahovat číslici.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Heslo musí obsahovat speciální znak.';
  return null;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase embeds the recovery token in the URL hash.
    // onAuthStateChange fires PASSWORD_RECOVERY once the session is set.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });

    // Also handle the case where the user arrives with a hash directly
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) setReady(true);

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validatePassword(password);
    if (err) { toast.error(err); return; }
    if (password !== confirm) { toast.error('Hesla se neshodují.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) { toast.error(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <>
        <div className="ambient" />
        <div className="login-stage" style={{ placeItems: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 24 }}>✅</div>
            <h1 className="login-h1" style={{ fontSize: 34 }}>
              Heslo <span className="it">změněno</span>.
            </h1>
            <p className="login-lead">
              Vaše nové heslo je aktivní. Přihlaste se.
            </p>
            <button className="login-submit" onClick={() => navigate('/login')}>
              Přejít na přihlášení <I.ArrowR s={16} />
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!ready) {
    return (
      <>
        <div className="ambient" />
        <div className="login-stage" style={{ placeItems: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 24 }}>🔗</div>
            <h1 className="login-h1" style={{ fontSize: 34 }}>
              Neplatný <span className="it">odkaz</span>.
            </h1>
            <p className="login-lead">
              Tento odkaz pro reset hesla je neplatný nebo vypršel. Požádejte o nový.
            </p>
            <button className="login-submit" onClick={() => navigate('/login')}>
              Zpět na přihlášení <I.ArrowR s={16} />
            </button>
          </div>
        </div>
      </>
    );
  }

  const eyeIcon = (show) => show ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );

  return (
    <>
      <div className="ambient" />
      <div className="login-stage">
        <div className="login-form-side">
          <div className="login-top-bar">
            <a href="/" className="brand">
              <div className="brand-mark">P</div>
              <div>
                <div className="brand-name">PlanLess</div>
                <div className="login-brand-sub">AI recepční</div>
              </div>
            </a>
          </div>

          <div className="login-form-wrap">
            <div className="login-form-box">
              <div className="login-eyebrow">Zabezpečení</div>
              <h1 className="login-h1">
                Nové <span className="it">heslo</span>.
              </h1>
              <p className="login-lead">
                Zadejte nové heslo pro váš účet PlanLess.
              </p>

              <form onSubmit={handleSubmit}>
                <div className="login-field">
                  <div className="login-label">Nové heslo</div>
                  <div className="login-password-wrap">
                    <input
                      className="login-input login-pw-input"
                      type={showPw ? 'text' : 'password'}
                      placeholder="Alespoň 8 znaků, číslo, symbol"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoFocus
                    />
                    <button type="button" className="login-pw-toggle" onClick={() => setShowPw(v => !v)}>
                      {eyeIcon(showPw)}
                    </button>
                  </div>
                </div>

                <div className="login-field">
                  <div className="login-label">Potvrdit nové heslo</div>
                  <div className="login-password-wrap">
                    <input
                      className="login-input login-pw-input"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Zopakujte heslo"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                    />
                    <button type="button" className="login-pw-toggle" onClick={() => setShowConfirm(v => !v)}>
                      {eyeIcon(showConfirm)}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit" disabled={loading}>
                  {loading ? 'Měním heslo…' : 'Nastavit nové heslo'}
                  {!loading && <I.ArrowR s={16} />}
                </button>
              </form>
            </div>
          </div>

          <div className="login-footnote">
            <span>© 2026 PlanLess s.r.o.</span>
            <span>·</span>
            <a href="#">Podmínky</a>
            <a href="#">Soukromí</a>
            <a href="#">Pomoc</a>
          </div>
        </div>

        <div className="login-marketing">
          <div className="login-marketing-inner">
            <div className="login-quote-card">
              <div className="login-quote-mark">"</div>
              <div className="login-quote-text">
                Nastavení zabralo 10 minut. Druhý den PlanLess zvedla první hovor a zarezervovala klientku sama. Nevěřila jsem vlastním uším.
              </div>
              <div className="login-quote-meta">
                <div className="login-q-av">MN</div>
                <div>
                  <div className="login-q-name">Markéta Nováková</div>
                  <div className="login-q-role">Majitelka · Kosmetický salon, Brno</div>
                  <div className="login-q-stars">
                    {[1,2,3,4,5].map(n => <I.StarF key={n} s={12} />)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
