import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/globals.css';
import './Login.css';
import { Icons as I } from '../components/Icons.jsx';
import { supabase } from '../lib/supabase.js';

function validatePassword(pw) {
  if (pw.length < 8) return 'Heslo musí mít alespoň 8 znaků.'
  if (!/[A-Z]/.test(pw)) return 'Heslo musí obsahovat velké písmeno.'
  if (!/[a-z]/.test(pw)) return 'Heslo musí obsahovat malé písmeno.'
  if (!/[0-9]/.test(pw)) return 'Heslo musí obsahovat číslici.'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Heslo musí obsahovat speciální znak.'
  return null
}

export default function Register() {
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    const pwError = validatePassword(password);
    if (pwError) { toast.error(pwError); return; }
    if (password !== confirm) { toast.error('Hesla se neshodují.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <>
        <div className="ambient" />
        <div className="login-stage" style={{ placeItems: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 24 }}>✉️</div>
            <h1 className="login-h1" style={{ fontSize: 34 }}>
              Zkontrolujte <span className="it">e-mail</span>.
            </h1>
            <p className="login-lead">
              Odeslali jsme vám odkaz pro ověření adresy <strong style={{ color: 'var(--ink)' }}>{email}</strong>.
              Po kliknutí na odkaz budete přesměrováni k přihlášení.
            </p>
            <button className="login-submit" onClick={() => navigate('/login')}>
              Přejít na přihlášení <I.ArrowR s={16} />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ambient" />

      <div className="login-stage">
        {/* LEFT: form */}
        <div className="login-form-side">
          <div className="login-top-bar">
            <a href="/" className="brand">
              <div className="brand-mark">P</div>
              <div>
                <div className="brand-name">PlanLess</div>
                <div className="login-brand-sub">AI recepční</div>
              </div>
            </a>
            <div className="login-alt-cta">
              Máte účet?{' '}
              <a href="/login">Přihlásit se</a>
            </div>
          </div>

          <div className="login-form-wrap">
            <div className="login-form-box">
              <div className="login-eyebrow">Nový účet</div>
              <h1 className="login-h1">
                Začněte <span className="it">zdarma</span>.
              </h1>
              <p className="login-lead">
                14 dní bez závazků. Kreditní karta až po skončení zkušební doby.
              </p>

              <div className="login-sso">
                <button type="button" className="login-sso-btn" onClick={async () => {
                  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/app` } });
                  if (error) toast.error(error.message);
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Registrovat přes Google
                </button>
              </div>

              <div className="login-divider">nebo e-mailem</div>

              <form onSubmit={handleSubmit}>
                <div className="login-field">
                  <div className="login-label">E-mail</div>
                  <input
                    className="login-input"
                    type="email"
                    placeholder="vas@email.cz"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="login-field">
                  <div className="login-label">Heslo</div>
                  <div className="login-password-wrap">
                    <input
                      className="login-input login-pw-input"
                      type={showPw ? 'text' : 'password'}
                      placeholder="Alespoň 8 znaků, číslo, symbol"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="login-pw-toggle"
                      onClick={() => setShowPw(v => !v)}
                    >
                      {showPw ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="login-field">
                  <div className="login-label">Potvrdit heslo</div>
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
                    <button
                      type="button"
                      className="login-pw-toggle"
                      onClick={() => setShowConfirm(v => !v)}
                    >
                      {showConfirm ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit" disabled={loading}>
                  {loading ? 'Zakládám účet…' : 'Vytvořit účet zdarma'}
                  {!loading && <I.ArrowR s={16} />}
                </button>
              </form>

              <div className="login-bottom-text">
                Registrací souhlasíte s{' '}
                <a href="#">obchodními podmínkami</a> a <a href="#">zpracováním osobních údajů</a>.
              </div>
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

        {/* RIGHT: marketing */}
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
                    {[1,2,3,4,5].map(n => (
                      <I.StarF key={n} s={12} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="login-m-stats">
              <div className="login-m-stat">
                <div className="n">14 dní</div>
                <div className="l">zdarma, bez karty</div>
              </div>
              <div className="login-m-stat">
                <div className="n">10 min</div>
                <div className="l">nastavení AI</div>
              </div>
              <div className="login-m-stat">
                <div className="n">24/7</div>
                <div className="l">dostupná recepční</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
