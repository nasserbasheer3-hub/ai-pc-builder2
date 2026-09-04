// Amazon Product Advertising API v5 client (no SDK dependency).
//
// Only constructs signed requests when the operator has supplied
// AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG. Until then the
// site shows catalog reference prices with dates and store-check links only.
//
// Marketplace is chosen from the build currency so a fetched price always
// matches the currency the user is building in.

import crypto from 'node:crypto';

const MARKETPLACE = {
  USD: { host: 'webservices.amazon.com', region: 'us-east-1', marketplace: 'www.amazon.com' },
  EUR: { host: 'webservices.amazon.de', region: 'eu-west-1', marketplace: 'www.amazon.de' },
  GBP: { host: 'webservices.amazon.co.uk', region: 'eu-west-1', marketplace: 'www.amazon.co.uk' },
};

const SERVICE = 'ProductAdvertisingAPI';
const PATH = '/paapi5/searchitems';

export function marketplaceFor(currency) {
  return MARKETPLACE[currency] || null;
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function signRequest({ accessKey, secretKey, host, region, payload, date }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

  const canonicalHeaders = [
    'content-type:application/json; charset=utf-8',
    `host:${host}`,
    `x-amz-date:${amzDate}`,
  ].join('\n');
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = ['POST', PATH, '', canonicalHeaders, '', signedHeaders, hashedPayload].join('\n');

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// Returns { title, asin, url, price, currency, display, available } for the
// best offer Amazon returns for a keyword search, or null when no buyable
// listing exists. Throws on transport/auth errors so callers can log honestly.
export async function searchAmazon(opts) {
  const out = await searchAmazonVerbose(opts);
  if (out.error) throw out.error;
  return out.result;
}

// Same call but never throws: returns the raw outcome plus the exact HTTP
// status/body from Amazon so credential/eligibility issues are diagnosable.
export async function searchAmazonVerbose(opts) {
  const { accessKey, secretKey, partnerTag, currency, keywords } = opts;
  const mp = marketplaceFor(currency);
  if (!mp) return { result: null, error: new Error(`No Amazon marketplace for currency ${currency}`), status: 0, body: '' };
  if (!accessKey || !secretKey || !partnerTag) return { result: null, error: new Error('Amazon PA-API is not configured (missing keys/tag).'), status: 0, body: '' };

  const base = {
    Keywords: String(keywords).slice(0, 512),
    PartnerTag: partnerTag,
    PartnerType: 'Associates',
    Marketplace: mp.marketplace,
    ItemCount: 3,
  };
  const fullPayload = JSON.stringify({ ...base, Resources: ['ItemInfo.Title', 'Offers.Listings.Availability.Type', 'Offers.Listings.Price', 'Offers.Summaries.LowestPrice'] });
  const minimalPayload = JSON.stringify({ ...base, Resources: ['Offers.Listings.Price', 'Offers.Listings.Availability.Type'] });

  let last = null;
  for (const payload of [fullPayload, minimalPayload]) {
    const raw = await doSearchRaw({ accessKey, secretKey, host: mp.host, region: mp.region, payload, marketplace: mp.marketplace, currency, keywords });
    if (raw.error) { last = raw; if (!/coral|InternalFailure/i.test(raw.error.message)) return raw; continue; }
    return raw;
  }
  return last || { result: null, error: new Error('Amazon request failed'), status: 0, body: '' };
}

async function doSearchRaw({ accessKey, secretKey, host, region, payload, marketplace, currency, keywords }) {
  const date = new Date();
  const auth = signRequest({ accessKey, secretKey, host, region, payload, date });

  let res;
  try {
    res = await fetch(`https://${host}${PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-Amz-Date': date.toISOString().replace(/[:-]|\.\d{3}/g, ''),
        'Authorization': auth,
      },
      body: payload,
    });
  } catch (e) {
    return { result: null, error: new Error(`Amazon request transport error: ${e.message}`), status: 0, body: '' };
  }

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }

  if (!res.ok || !json || json.Errors) {
    const code = json?.Errors?.[0]?.Code || `HTTP ${res.status}`;
    const msg = json?.Errors?.[0]?.Message || text.slice(0, 300);
    return { result: null, error: new Error(`Amazon search failed (${code}): ${msg}`), status: res.status, body: text };
  }

  const items = Array.isArray(json.SearchResult?.Items) ? json.SearchResult.Items.filter((it) => it) : [];
  let best = null;
  for (const item of items) {
    const listing = item.Offers?.Listings?.find((l) => l?.Price?.DisplayAmount);
    if (!listing) continue;
    const price = parseDisplayAmount(listing.Price.DisplayAmount);
    if (price == null) continue;
    const asin = item.ASIN;
    if (!best || price < best.price) {
      best = {
        asin,
        title: item.ItemInfo?.Title?.DisplayValue || keywords,
        url: `https://${marketplace}/dp/${asin}`,
        price,
        currency,
        display: listing.Price.DisplayAmount,
        available: listing.Availability?.Type !== 'Currently unavailable',
      };
    }
  }
  return { result: best, error: null, status: res.status, body: text };
}

// Amounts arrive as localized strings like "US$1,999.99", "EUR 2.099,00",
// "£1,949.99" or "CDN$ 3,999.00". Parse the digits into a number.
export function parseDisplayAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  const isEuroFormat = /,\d{2}\b/.test(s) && !/\.\d{2}\b/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  s = isEuroFormat ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
