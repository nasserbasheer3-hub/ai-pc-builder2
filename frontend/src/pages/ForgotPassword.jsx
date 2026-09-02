import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

export default function ForgotPassword() {
  const toast = useToast();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.post('/auth/forgot-password', { email, appUrl: window.location.origin });
      if (d.debugLink) toast.info(`Development link: ${d.debugLink}`);
      setSent(true);
    } catch (err) {
      toast.err(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.5rem' }}>{t('auth.resetPassword')}</h1>
      <p style={{ margin: '6px 0 20px' }}>{t('auth.resetSub')}</p>
      {sent ? (
        <div>
          <div className="badge badge-ok" style={{ marginBottom: 14 }}>{t('auth.emailSent')}</div>
          <p>{t('auth.resetLinkOnWay')}</p>
          <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 16, textDecoration: 'none' }}>{t('auth.backToSignIn')}</Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label>{t('auth.email')}</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? t('auth.sending') : t('auth.sendResetLink')}</button>
        </form>
      )}
      <div style={{ marginTop: 16, textAlign: 'center', fontSize: '0.88rem' }}>
        <Link to="/login">{t('auth.backToSignIn')}</Link>
      </div>
    </AuthShell>
  );
}
