const CONSENT_KEY = 'gpp_cookie_consent';
const UTM_KEY = 'gpp_utm';
const UID_KEY = 'gpp_uid';
const GA_ID = 'G-FVYC4ER34V';
const TIKTOK_PIXEL_ID = 'DACR06JC77UBCVGL294G';

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gclsrc', 'gbraid', 'wbraid', 'fbclid', 'ttclid'];

// Internal events that map to TikTok standard conversion events.
const TIKTOK_EVENTS = {
  begin_checkout: 'InitiateCheckout',
  sign_up: 'CompleteRegistration',
};

let tiktokReady = false;

export function consentState() {
  try { return localStorage.getItem(CONSENT_KEY) || 'unknown'; } catch { return 'unknown'; }
}

export function analyticsAllowed() {
  return consentState() === 'accepted';
}

export function getUtm() {
  try { return JSON.parse(localStorage.getItem(UTM_KEY) || '{}'); } catch { return {}; }
}

// Build a same-site path decorated with blog campaign parameters so visitors
// who click from the blog into product pages stay attributable. Existing UTM
// values on the target are never overwritten.
export function sitePathWithUtm(path, { medium = 'article', campaign, content } = {}) {
  try {
    const url = new URL(String(path), window.location.origin);
    if (!url.searchParams.get('utm_source')) url.searchParams.set('utm_source', 'blog');
    if (!url.searchParams.get('utm_medium')) url.searchParams.set('utm_medium', medium);
    if (campaign && !url.searchParams.get('utm_campaign')) url.searchParams.set('utm_campaign', campaign);
    if (content && !url.searchParams.get('utm_content')) url.searchParams.set('utm_content', content);
    return url.pathname + url.search + (url.hash || '');
  } catch { return String(path); }
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

function ttq() {
  try { return typeof window !== 'undefined' ? window.ttq : undefined; } catch { return undefined; }
}

// Load the official TikTok base code and fire the initial page view. Called
// only after the visitor accepted (applyPixelConsent) so nothing is loaded,
// stored or sent before explicit consent.
function loadTikTok() {
  if (tiktokReady || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!analyticsAllowed()) return;
  try {
    const w = window;
    const d = document;
    w.TiktokAnalyticsObject = 'ttq';
    const queue = (w.ttq = w.ttq || []);
    const methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
    queue.setAndDefer = (obj, method) => {
      obj[method] = function () {
        obj.push([method].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (const m of methods) queue.setAndDefer(queue, m);
    queue.load = (id, opts) => {
      const src = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      queue._i = queue._i || {};
      queue._i[id] = [];
      queue._i[id]._u = src;
      queue._t = queue._t || {};
      queue._t[id] = +new Date();
      queue._o = queue._o || {};
      queue._o[id] = opts || {};
      const s = d.createElement('script');
      s.type = 'text/javascript';
      s.async = true;
      s.src = src + '?sdkid=' + id + '&lib=ttq';
      const first = d.getElementsByTagName('script')[0];
      if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    };
    queue.load(TIKTOK_PIXEL_ID);
    queue.page();
    tiktokReady = true;
  } catch { /* never break the page */ }
}

function tiktokEvent(standard, params = {}) {
  const api = ttq();
  if (tiktokReady && api && typeof api.track === 'function') {
    try { api.track(standard, params); } catch { /* never break the page */ }
  }
}

// Apply the visitor's stored consent to third-party pixels: accepted loads the
// TikTok pixel, declined disables it if it was somehow already active.
export function applyPixelConsent() {
  if (analyticsAllowed()) {
    loadTikTok();
  } else {
    tiktokReady = false;
    const api = ttq();
    if (api && typeof api.disable === 'function') {
      try { api.disableCookie(); api.disable(); } catch { /* ignore */ }
    }
  }
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
  // Standard TikTok conversion events, fired through the loaded pixel.
  const tiktokStandard = TIKTOK_EVENTS[event];
  if (tiktokStandard) {
    const tparams = {};
    const value = Number(params.value);
    if (Number.isFinite(value) && value > 0) tparams.value = value;
    if (params.currency) tparams.currency = params.currency;
    if (params.plan || params.plan_name) tparams.content_name = params.plan || params.plan_name;
    if (params.transaction_id) tparams.content_id = String(params.transaction_id);
    tiktokEvent(tiktokStandard, tparams);
  }
}

// Reflect the visitor's stored choice into gtag consent mode (kept in sync by
// the cookie banner; set as 'denied' by default in index.html until accepted).
export function syncConsent() {
  if (typeof window.gtag !== 'function') return;
  const granted = analyticsAllowed();
  window.gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: granted ? 'granted' : 'denied',
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
  // TikTok CompletePayment with the same order data.
  const tparams = {
    transaction_id: String(transaction_id),
    value: Number(value) || 0,
    currency,
  };
  if (plan) tparams.content_name = plan;
  tiktokEvent('CompletePayment', tparams);
}
