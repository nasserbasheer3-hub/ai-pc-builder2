// Non-affiliate store deep-search links.
//
// The catalog prices are verified aggregate street estimates with a date, and
// there are no per-part merchant SKUs or affiliate tokens yet, so instead of
// inventing product pages we link to a store SEARCH for the exact part name.
// This is always real and lets a buyer "check the current price" in the store.
// When an affiliate integration (e.g. Amazon Product Advertising API) is added
// later, replace the objects here - the field shape stays {amazon, google}.

const AMAZON_DOMAINS = { USD: 'www.amazon.com', EUR: 'www.amazon.de', GBP: 'www.amazon.co.uk' };

export function storeSearchLinks(name, currency = 'USD') {
  const q = encodeURIComponent(String(name || '').trim());
  const host = AMAZON_DOMAINS[currency] || AMAZON_DOMAINS.USD;
  return {
    amazon: `https://${host}/s?k=${q}`,
    google: `https://www.google.com/search?tbm=shop&q=${q}`,
  };
}

export function enrichWithStore(part, currency) {
  if (part && part.name) part.store = storeSearchLinks(part.name, currency);
  return part;
}
