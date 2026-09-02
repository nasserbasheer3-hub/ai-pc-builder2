import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

export default function AdminLogin() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) return toast.err(t('admin.enterCredentials'));
    setBusy(true);
    try {
      const r = await api.post('/admin/login', form);
      localStorage.setItem('gpp_admin_token', r.token);
      toast.ok(t('admin.authOk'));
      navigate('/admin');
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.5rem' }}>{t('adminLogin.title')}</h1>
      <p style={{ margin: '6px 0 20px' }}>{t('adminLogin.sub')}</p>
      <div className="field"><label>{t('adminLogin.adminEmail')}</label>
        <input className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="field"><label>{t('adminLogin.password')}</label>
        <input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>{busy ? t('adminLogin.signingIn') : t('adminLogin.signIn')}</button>
      <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 12, textAlign: 'center' }}>{t('adminLogin.note')}</p>
    </AuthShell>
  );
}
