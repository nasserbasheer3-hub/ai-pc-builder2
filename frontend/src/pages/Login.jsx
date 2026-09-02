import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, LanguageSwitcher } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.6rem' }}>{t('auth.welcomeBack')}</h1>
      <p style={{ margin: '6px 0 22px' }}>{t('auth.signInSub')}</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t('auth.email')}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label>{t('auth.password')}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? t('auth.signingIn') : t('auth.signIn')}</button>
      </form>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
        <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
        <Link to="/signup">{t('auth.createAccount')}</Link>
      </div>
      <div className="pill-row" style={{ marginTop: 18, justifyContent: 'center' }}>
        <LanguageSwitcher />
      </div>
    </AuthShell>
  );
}

export function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 32 }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div className="logo" style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary-grad)', display: 'grid', placeItems: 'center', fontWeight: 700, fontFamily: 'var(--font-display)', color: '#fff' }}>&gt;_</div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)' }}>LevelCore</span>
          </div>
        </Link>
        {children}
      </div>
    </div>
  );
}
