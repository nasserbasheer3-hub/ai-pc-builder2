// Display-currency helpers for visitors in the UK (payment stays in SEK —
// Stripe charges the stored SEK price; the GBP figure is an approximation).
export const SEK_TO_GBP = 0.07734;

export function prefersGbp() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz === 'Europe/London') return true;
    const lang = String(navigator.language || '').toLowerCase();
    if (lang === 'en-gb' || lang.startsWith('en-gb-')) return true;
  } catch { /* keep SEK default */ }
  return false;
}

export function resolveCurrencyMode(searchParams) {
  const forced = String(searchParams?.get('currency') || '').toUpperCase();
  if (forced === 'GBP') return true;
  if (forced === 'SEK') return false;
  return prefersGbp();
}

// Approximate SEK -> GBP conversion used only when the server response has not
// been updated yet; live responses carry exact price_gbp fields.
export function fxGbp(sek) {
  return Math.round((Number(sek) || 0) * SEK_TO_GBP * 100) / 100;
}

export function fmtGbp(n) {
  return `£${(Number(n) || 0).toFixed(2)}`;
}
