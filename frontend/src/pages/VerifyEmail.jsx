import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';
import { setToken } from '../api/client.js';

function localLink(debugLink) {
  if (!debugLink) return null;
  try {
    const u = new URL(debugLink);
    return `${window.location.origin}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const need = params.get('need');
  const email = params.get('email') || '';
  const debug = params.get('debug') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const [state, setState] = useState(token ? 'verifying' : 'idle');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(localLink(debug));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (token) {
      api.post('/auth/verify-email', { token })
        .then((d) => {
          setToken(d.token);
          setState('done');
          toast.ok('Email verified! Setting up your profile...');
          setTimeout(() => navigate('/onboarding'), 900);
        })
        .catch((e) => { setState('failed'); setError(e.message); });
    }
  }, [token]);

  const copy = async () => {
    if (!devLink) return;
    try {
      await navigator.clipboard.writeText(devLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const resend = async () => {
    try {
      const d = await api.post('/auth/resend-verification', { email, appUrl: window.location.origin });
      if (d.debugLink) setDevLink(localLink(d.debugLink));
      setSent(true);
      toast.ok('Verification email sent.');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AuthShell>
      <h1 style={{ fontSize: '1.5rem' }}>
        {state === 'verifying' ? t('auth.verifyingEmail') : state === 'done' ? t('auth.emailVerified') : t('auth.verifyYourEmail')}
      </h1>
      {state === 'verifying' && <p style={{ marginTop: 10 }}>{t('auth.checkingToken')}</p>}
      {state === 'done' && <p style={{ marginTop: 10 }}>{t('auth.redirectingOnboarding')}</p>}
      {(state === 'idle' || state === 'failed') && (
        <>
          <p style={{ margin: '10px 0 16px' }}>
            {need ? t('auth.requiresVerified') : t('auth.pleaseVerify')}
            {email && ` ${t('auth.weSentLink').replace('{email}', email)}`}
          </p>
          {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
          {devLink && (
            <div className="card" style={{ padding: 14, marginBottom: 14, background: 'rgba(124,92,255,0.07)', borderColor: 'rgba(124,92,255,0.4)' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 8 }}>{t('auth.devVerifyHint')}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  readOnly
                  value={devLink}
                  onFocus={(e) => e.target.select()}
                  style={{ fontSize: '0.78rem', flex: 1 }}
                />
                <button className="btn btn-ghost" onClick={copy} style={{ whiteSpace: 'nowrap' }}>{copied ? t('auth.linkCopied') : t('auth.copyLink')}</button>
              </div>
            </div>
          )}
          <button className="btn btn-primary btn-block" onClick={resend} disabled={sent}>
            {sent ? t('auth.sentCheckInbox') : t('auth.resendVerification')}
          </button>
          <Link to="/login" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: '0.88rem' }}>{t('auth.backToSignIn')}</Link>
        </>
      )}
    </AuthShell>
  );
}
