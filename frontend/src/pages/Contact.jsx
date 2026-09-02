import { useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { useSeo } from '../hooks/useSeo.js';

export default function Contact() {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', message: '', _trap: '' });
  const [busy, setBusy] = useState(false);

  useSeo({
    title: `${t('contact.title')} — LevelCore`,
    description: t('contact.sub'),
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || form.message.trim().length < 10) {
      return toast.err(t('contact.validation'));
    }
    setBusy(true);
    try {
      await api.post('/public/contact', form);
      toast.ok(t('contact.success'));
      setForm({ name: '', email: '', message: '', _trap: '' });
    } catch (err) {
      toast.err(err.message || t('contact.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720, margin: '0 auto', padding: '44px 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="kicker">{t('contact.kicker')}</div>
      <h1>{t('contact.title')}</h1>
      <p style={{ color: 'var(--text-dim)', maxWidth: 560 }}>{t('contact.sub')}</p>

      <div className="card" style={{ padding: 22, marginTop: 18 }}>
        <form onSubmit={submit}>
          <div className="field">
            <label>{t('contact.name')} *</label>
            <input className="input" value={form.name} maxLength={80} autoComplete="name"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('contact.email')} *</label>
            <input className="input" type="email" value={form.email} autoComplete="email"
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field" style={{ position: 'absolute', left: -9999, top: -9999 }}>
            <input className="input" value={form._trap} onChange={(e) => setForm({ ...form, _trap: e.target.value })} tabIndex={-1} aria-hidden="true" />
          </div>
          <div className="field">
            <label>{t('contact.message')} *</label>
            <textarea className="input" rows={6} value={form.message} maxLength={4000}
              onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? t('contact.sending') : t('contact.send')}
          </button>
          <p style={{ color: 'var(--text-faint)', fontSize: '0.74rem', marginTop: 12 }}>{t('contact.privacyNote')}</p>
        </form>
      </div>
    </div>
  );
}
