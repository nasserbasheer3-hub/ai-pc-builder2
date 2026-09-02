import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, useToast, Modal } from '../components/ui.jsx';

export default function Settings() {
  const { user, profile, refresh, logout } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [delPassword, setDelPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    if (!pw.currentPassword || pw.newPassword.length < 8) return toast.err(t('settings.passwordMinErr'));
    setBusy(true);
    try {
      await api.post('/auth/change-password', pw);
      toast.ok(t('settings.passwordUpdated'));
      setPw({ currentPassword: '', newPassword: '' });
    } catch (e) { toast.err(e.message); } finally { setBusy(false); }
  };

  const changeEmail = async () => {
    if (!email) return;
    if (!emailPassword) return toast.err(t('settings.enterCurrentPassword'));
    setBusy(true);
    try {
      await api.post('/auth/change-email', { newEmail: email, password: emailPassword, appUrl: window.location.origin });
      toast.ok(t('settings.verificationSent'));
      setEmail('');
      setEmailPassword('');
    } catch (e) { toast.err(e.message); } finally { setBusy(false); }
  };

  const togglePrivacy = async (k, v) => {
    try {
      await api.put('/profile', { [k]: v });
      await refresh();
      toast.ok(t('settings.saved'));
    } catch (e) { toast.err(e.message); }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api.raw('DELETE', '/auth/account', { password: delPassword });
      toast.ok(t('settings.accountDeleted'));
      logout();
      navigate('/');
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('settings.title')}</h1>
          <span className="sub">{t('settings.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>🔐 {t('settings.password')}</>} />
          <div className="field"><label>{t('settings.currentPassword')}</label><input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div className="field"><label>{t('settings.newPasswordMin')}</label><input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={savePassword}>{t('settings.updatePassword')}</button>
        </Card>

        <Card>
          <CardHead title={<>✉️ {t('settings.emailAddress')}</>} />
          <p style={{ fontSize: '0.86rem' }}>{t('settings.current')}: <b>{user.email}</b></p>
          <div className="field"><label>{t('settings.newEmail')}</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label>{t('settings.currentPassword')}</label><input className="input" type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={changeEmail}>{t('settings.changeEmail')}</button>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 10 }}>{t('settings.verifyNote')}</p>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHead title={<>🕶️ {t('settings.privacy')}</>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['privacy_winrate', t('settings.shareWinrate')],
            ['privacy_kd', t('settings.shareKd')],
            ['privacy_gametime', t('settings.shareGametime')],
            ['privacy_compare', t('settings.allowCompare')],
            ['notifications_enabled', t('settings.enableNotifications')],
          ].map(([k, label]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', padding: '8px 0' }}>
              <input type="checkbox" checked={Boolean(profile?.[k])} onChange={(e) => togglePrivacy(k, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 18, borderColor: 'rgba(244,63,94,0.4)' }}>
        <CardHead title={<>🗑️ {t('settings.dangerZone')}</>} />
        <p style={{ fontSize: '0.86rem', marginBottom: 12 }}>{t('settings.dangerText')}</p>
        <button className="btn btn-danger" onClick={() => setConfirm(true)}>{t('settings.deleteMyAccount')}</button>
      </Card>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('settings.deleteAccount')}>
        <p style={{ fontSize: '0.9rem' }}>{t('settings.typePasswordToDelete')}</p>
        <div className="field" style={{ marginTop: 10 }}><input className="input" type="password" value={delPassword} onChange={(e) => setDelPassword(e.target.value)} placeholder={t('settings.passwordPlaceholder')} /></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
          <button className="btn btn-danger" style={{ flex: 1 }} disabled={busy} onClick={deleteAccount}>{t('settings.deleteForever')}</button>
        </div>
      </Modal>
    </div>
  );
}
