import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { AuthShell } from './Login.jsx';
import { getDeviceId } from '../utils/device.js';

export default function Signup() {
  const { register } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '', referralCode: params.get('ref') || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError(t('auth.passwordsNoMatch'));
    if (form.password.length < 8) return setError(t('auth.passwordMin8'));
    setBusy(true);
    try {
      await register({
        username: form.username,
        email: form.email,
        password: form.password,
        referralCode: form.referralCode?.trim() || undefined,
        deviceId: getDeviceId(),
      });
      navigate('/onboarding');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.6rem' }}>{t('auth.createAccountBtn')}</h1>
      <p style={{ margin: '6px 0 22px' }}>{t('signup.sub')}</p>
      <div style={{ textAlign: 'center', marginBottom: 16 }}><span className="badge badge-ok">{t('signup.noVerify')}</span></div>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t('auth.username')}</label>
          <input className="input" value={form.username} onChange={set('username')} required minLength={3} maxLength={32} autoComplete="username" />
        </div>
        <div className="field">
          <label>{t('auth.email')}</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </div>
        <div className="field">
          <label>{t('auth.password')}</label>
          <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t('auth.confirmPassword')}</label>
          <input className="input" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t('signup.referralCode')}</label>
          <input className="input" value={form.referralCode} onChange={set('referralCode')} placeholder="e.g. NOVA16" autoComplete="off" maxLength={20} />
          {form.referralCode && <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 4 }}>{t('signup.referralHint')}</p>}
        </div>
        {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? t('auth.creatingAccount') : t('auth.createAccountBtn')}</button>
      </form>
      <div style={{ marginTop: 16, textAlign: 'center', fontSize: '0.88rem' }}>
        {t('auth.alreadyHave')} <Link to="/login">{t('auth.signIn')}</Link>
      </div>
    </AuthShell>
  );
}
