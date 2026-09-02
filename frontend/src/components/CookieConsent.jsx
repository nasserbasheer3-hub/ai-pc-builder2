import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';
import { syncConsent } from '../utils/analytics.js';

const KEY = 'gpp_cookie_consent';

export default function CookieConsent() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
      else syncConsent();
    } catch { /* ignore */ }
  }, []);

  const decide = (value) => {
    try { localStorage.setItem(KEY, value); } catch { /* ignore */ }
    syncConsent();
    if (value === 'accepted' && typeof window.gtag === 'function') {
      window.gtag('event', 'consent_accepted');
    }
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70,
      background: 'rgba(15,13,26,0.96)', borderTop: '1px solid rgba(255,255,255,0.1)',
      padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
    }}>
      <div style={{ flex: '1 1 320px', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        {t('cookie.text')}{' '}
        <Link to="/privacy" style={{ color: 'var(--accent)' }}>{t('cookie.more')}</Link>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => decide('declined')}>{t('cookie.decline')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => decide('accepted')}>{t('cookie.accept')}</button>
      </div>
    </div>
  );
}
