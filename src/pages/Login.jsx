import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/globals.css';
import './Login.css';
import { Icons as I } from '../components/Icons.jsx';
import { supabase } from '../lib/supabase.js';

export default function Login() {
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message === 'Invalid login credentials'
        ? 'Nesprávný e-mail nebo heslo.'
        : error.message);
      return;
    }
    navigate('/app');
  }

  async function handleOAuth(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) toast.error(error.message);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!email) { toast.error('Zadejte e-mail pro reset hesla.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success('Odkaz na reset hesla byl odeslán na váš e-mail.');
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
              Ještě nemáte účet?{' '}
              <a href="/register">Registrovat se</a>
            </div>
          </div>

          <div className="login-form-wrap">
            <div className="login-form-box">
              <div className="login-eyebrow">Vítejte zpět</div>
              <h1 className="login-h1">
                Vitejte <span className="it">zpět</span>.
              </h1>
              <p className="login-lead">
                Vaše AI recepční je připravená. Po přihlášení se vrátíte přesně tam, kde jste skončili.
              </p>

              {/* SSO */}
              <div className="login-sso">
                <button type="button" className="login-sso-btn" onClick={() => handleOAuth('google')}>
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Pokračovat přes Google
                </button>
                <button type="button" className="login-sso-btn" onClick={() => handleOAuth('apple')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.93 2.71-3.495 2.71-1.56 0-1.96-.93-3.77-.93-1.766 0-2.4.96-3.83.96-1.57 0-2.66-1.36-3.6-2.7-1.91-2.78-3.39-7.84-1.42-11.27.97-1.69 2.71-2.77 4.59-2.79 1.51-.04 2.95.95 3.97.95 1 0 2.74-.95 4.62-.95.79 0 3.01.12 4.44 2.36-.12.07-2.66 1.59-2.62 4.74.05 3.79 3.36 5.04 3.4 5.05z"/>
                  </svg>
                  Pokračovat přes Apple
                </button>
              </div>

              <div className="login-divider">nebo e-mailem</div>

              <form onSubmit={handleSubmit}>
                <div className="login-field">
                  <div className="login-label">E-mail</div>
                  <input
                    className="login-input"
                    type="email"
                    placeholder="svatopluk@salon.cz"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="login-field">
                  <div className="login-label-row">
                    <span className="login-label">Heslo</span>
                    <a href="#" onClick={handleForgotPassword}>Zapomenuté heslo?</a>
                  </div>
                  <div className="login-password-wrap">
                    <input
                      className="login-input login-pw-input"
                      type={showPw ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="login-pw-toggle"
                      title={showPw ? 'Skrýt heslo' : 'Zobrazit heslo'}
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

                <div className="login-options">
                  <div
                    className={`login-checkbox${remember ? ' on' : ''}`}
                    onClick={() => setRemember(v => !v)}
                  >
                    <div className="box">
                      <I.Check s={12} />
                    </div>
                    Zůstat přihlášený 30 dní
                  </div>
                </div>

                <button type="submit" className="login-submit" disabled={loading}>
                  {loading ? 'Přihlašuji…' : 'Přihlásit se'}
                  {!loading && <I.ArrowR s={16} />}
                </button>
              </form>

              <div className="login-bottom-text">
                Nemáte ještě účet?{' '}
                <a href="/register">Začněte 14 dní zdarma →</a>
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
                Před PlanLess jsme propasli skoro každý druhý hovor. Teď zvedáme všechny — a AI vyřídí 70 % rezervací sama. Tržby nahoru o čtvrtinu, a já mám klid stříhat.
              </div>
              <div className="login-quote-meta">
                <div className="login-q-av">SV</div>
                <div>
                  <div className="login-q-name">Svatopluk Velíšek</div>
                  <div className="login-q-role">Majitel · Salon Svatopluk, Praha</div>
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
                <div className="n">200+</div>
                <div className="l">firem v ČR a SR</div>
              </div>
              <div className="login-m-stat">
                <div className="n">98%</div>
                <div className="l">zvedaných hovorů</div>
              </div>
              <div className="login-m-stat">
                <div className="n">4.9</div>
                <div className="l">průměrné hodnocení</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
