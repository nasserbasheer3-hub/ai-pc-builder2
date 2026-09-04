// Store deep-search links for a part.
//
// Amazon links carry the site's real Amazon Associates tag when the operator
// has set AMAZON_PARTNER_TAG, so qualifying purchases are credited to the
// account that will later unlock the Product Advertising API. When no tag is
// configured the links are plain, non-affiliate searches. Google Shopping is
// always a plain (non-affiliate) fallback. All links point at a live search
// for the exact part name - nothing is ever fabricated.

import { config } from '../config.js';

const AMAZON_DOMAINS = { USD: 'www.amazon.com', EUR: 'www.amazon.de', GBP: 'www.amazon.co.uk' };

export function storeSearchLinks(name, currency = 'USD') {
  const q = encodeURIComponent(String(name || '').trim());
  const host = AMAZON_DOMAINS[currency] || AMAZON_DOMAINS.USD;
  const tag = config.amazon?.partnerTag ? `&tag=${encodeURIComponent(config.amazon.partnerTag)}` : '';
  return {
    amazon: `https://${host}/s?k=${q}${tag}`,
    google: `https://www.google.com/search?tbm=shop&q=${q}`,
  };
}

export function enrichWithStore(part, currency) {
  if (part && part.name) part.store = storeSearchLinks(part.name, currency);
  return part;
}
