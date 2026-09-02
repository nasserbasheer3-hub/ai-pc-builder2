const CONSENT_KEY = 'gpp_cookie_consent';

export function consentState() {
  try { return localStorage.getItem(CONSENT_KEY) || 'unknown'; } catch { return 'unknown'; }
}

export function analyticsAllowed() {
  return consentState() === 'accepted';
}

// Fire a GA4 event only when the visitor accepted analytics cookies.
export function track(event, params = {}) {
  if (!analyticsAllowed()) return;
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', event, params);
}

// Reflect the visitor's stored choice into gtag consent mode (kept in sync by
// the cookie banner; set as 'denied' by default in index.html until accepted).
export function syncConsent() {
  if (typeof window.gtag !== 'function') return;
  const granted = analyticsAllowed();
  window.gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: 'denied',
  });
}
