import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

export default function AdminSetup() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState({ adminExists: null, setupTokenActive: false });
  const [form, setForm] = useState({ token: params.get('token') || '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/setup-status').then((r) => setState(r)).catch(() => setState({ adminExists: true, setupTokenActive: false }));
  }, []);

  if (state.adminExists === true) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: '1.5rem' }}>{t('admin.setupAlready')}</h1>
        <Link className="btn btn-primary btn-block" style={{ marginTop: 16 }} to="/admin/login">{t('admin.setupGoLogin')}</Link>
      </AuthShell>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return toast.err(t('admin.enterCredentials'));
    if (form.password !== form.confirm) return toast.err(t('admin.setupConfirmMismatch'));
    setBusy(true);
    try {
      const r = await api.post('/admin/setup', { token: form.token, email: form.email, password: form.password });
      localStorage.setItem('gpp_admin_token', r.token);
      toast.ok(t('admin.setupDone'));
      navigate('/admin');
    } catch (err) {
      toast.err(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.5rem' }}>{t('admin.setupTitle')}</h1>
      <p style={{ margin: '6px 0 20px', fontSize: '0.85rem' }}>{t('admin.setupSub')}</p>
      <form onSubmit={submit}>
        <div className="field"><label>{t('admin.setupToken')}</label>
          <input className="input" type="text" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="token from server logs" />
        </div>
        <div className="field"><label>{t('adminLogin.adminEmail')}</label>
          <input className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field"><label>{t('adminLogin.password')}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field"><label>{t('admin.setupConfirm')}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? t('adminLogin.signingIn') : t('admin.setupCreate')}
        </button>
      </form>
    </AuthShell>
  );
}
