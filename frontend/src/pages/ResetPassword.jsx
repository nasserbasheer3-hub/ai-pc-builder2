import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <AuthShell>
        <h1>{t('auth.invalidResetLink')}</h1>
        <p style={{ margin: '10px 0' }}>{t('auth.invalidResetSub')}</p>
        <Link to="/forgot-password" className="btn btn-primary btn-block">{t('auth.requestNewLink')}</Link>
      </AuthShell>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError(t('auth.passwordsNoMatch'));
    if (pw.length < 8) return setError(t('auth.passwordMin8'));
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password: pw });
      toast.ok(t('auth.passwordUpdated'));
      navigate('/login');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.5rem' }}>{t('auth.chooseNewPassword')}</h1>
      <p style={{ margin: '6px 0 20px' }}>{t('auth.minLengthNote')}</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t('auth.newPassword')}</label>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
        </div>
        <div className="field">
          <label>{t('auth.confirmNewPassword')}</label>
          <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} />
        </div>
        {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? t('auth.updating') : t('auth.updatePassword')}</button>
      </form>
    </AuthShell>
  );
}
