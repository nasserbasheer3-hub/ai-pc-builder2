const CONSENT_KEY = 'gpp_cookie_consent';
const UTM_KEY = 'gpp_utm';
const UID_KEY = 'gpp_uid';
const GA_ID = 'G-FVYC4ER34V';

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gclsrc', 'gbraid', 'wbraid', 'fbclid', 'ttclid'];

export function consentState() {
  try { return localStorage.getItem(CONSENT_KEY) || 'unknown'; } catch { return 'unknown'; }
}

export function analyticsAllowed() {
  return consentState() === 'accepted';
}

export function getUtm() {
  try { return JSON.parse(localStorage.getItem(UTM_KEY) || '{}'); } catch { return {}; }
}

// Read campaign parameters from the landing URL once and remember them for the
// whole visit. Pure reading of the URL - no cookies, no sending until consent.
export function captureUtm() {
  try {
    const params = new URLSearchParams(window.location.search);
    const want = {};
    for (const f of UTM_FIELDS) {
      const v = params.get(f);
      if (v) want[f] = String(v).slice(0, 200);
    }
    if (!Object.keys(want).length) return getUtm();
    const merged = { ...getUtm(), ...want };
    localStorage.setItem(UTM_KEY, JSON.stringify(merged));
    return merged;
  } catch { return getUtm(); }
}

// Remember who the signed-in user is so accepted analytics events can be
// joined to the account (accurate conversions for ad platforms).
export function setUserId(id) {
  if (id == null) return;
  try { localStorage.setItem(UID_KEY, String(id)); } catch { /* ignore */ }
  if (analyticsAllowed() && typeof window.gtag === 'function') {
    window.gtag('config', GA_ID, { user_id: String(id) });
  }
}

function pushLayer(obj) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(obj);
}

// Fire a GA4 event only when the visitor accepted analytics cookies.
export function track(event, params = {}) {
  if (!analyticsAllowed()) return;
  const utm = getUtm();
  const payload = {
    ...params,
    ...(utm.utm_source ? { utm_source: utm.utm_source } : {}),
    ...(utm.utm_medium ? { utm_medium: utm.utm_medium } : {}),
    ...(utm.utm_campaign ? { utm_campaign: utm.utm_campaign } : {}),
    ...(utm.utm_content ? { utm_content: utm.utm_content } : {}),
  };
  if (typeof window.gtag === 'function') window.gtag('event', event, payload);
  // Mirror to dataLayer so consent-gated pixels (Meta/Google Ads/TikTok) can
  // subscribe later without code changes.
  pushLayer({ event, ...payload });
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
  if (granted) {
    try {
      const uid = localStorage.getItem(UID_KEY);
      if (uid) window.gtag('config', GA_ID, { user_id: uid });
    } catch { /* ignore */ }
  }
}

// GA4 ecommerce-style conversion (maps to the "purchase" event in Google Ads).
export function trackPurchase({ transaction_id, value, currency = 'SEK', plan }) {
  track('purchase', {
    transaction_id: String(transaction_id),
    value: Number(value) || 0,
    currency,
    ...(plan ? { item_name: plan } : {}),
  });
}
