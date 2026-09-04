// Cache + lookup for Amazon PA-API prices.
//
// The cache table lives in the same SQLite database as the catalog so reads at
// request time are cheap and need no network. A fresh row means the listing
// was verified against Amazon within config.amazon.ttlHours; outside that
// window lookups return null (reference price + store links shown instead)
// until `npm run prices:amazon` refetches.

import { db } from '../db.js';
import { config } from '../config.js';
import { searchAmazon } from '../utils/amazon.js';

export function isAmazonConfigured() {
  return Boolean(config.amazon?.accessKey && config.amazon?.secretKey && config.amazon?.partnerTag);
}

// ptype uses the hardware route naming so it works across catalog and builder.
export const PTYPE_BY_PART_KEY = {
  cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'ram',
  storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers',
};
export const PART_KEY_BY_PTYPE = Object.fromEntries(Object.entries(PTYPE_BY_PART_KEY).map(([k, v]) => [v, k]));
export const TABLE_BY_PTYPE = {
  cpus: 'cpus', gpus: 'gpus', motherboards: 'motherboards', ram: 'memory_modules',
  storage: 'storage', psus: 'psus', cases: 'cases', coolers: 'coolers',
};

export function ensureAmazonPricesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS amazon_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ptype TEXT NOT NULL,
      part_id INTEGER NOT NULL,
      currency TEXT NOT NULL,
      asin TEXT,
      title TEXT,
      url TEXT,
      price REAL,
      display TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      fetched_at TEXT NOT NULL,
      UNIQUE(ptype, part_id, currency)
    );
  `);
}

export function isFresh(row) {
  if (!row) return false;
  const ttlMs = (config.amazon?.ttlHours || 72) * 3600 * 1000;
  return Date.now() - new Date(row.fetched_at).getTime() <= ttlMs;
}

export function freshAmazonPrice(ptype, partId, currency) {
  if (!isAmazonConfigured()) return null;
  const row = db.prepare(
    'SELECT * FROM amazon_prices WHERE ptype=? AND part_id=? AND currency=? AND status=?'
  ).get(ptype, Number(partId), currency, 'ok');
  if (!row || !isFresh(row)) return null;
  return row;
}

export function saveAmazonPrice({ ptype, partId, currency, result, error = null }) {
  db.prepare(`
    INSERT INTO amazon_prices (ptype, part_id, currency, asin, title, url, price, display, available, status, error, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ptype, part_id, currency) DO UPDATE SET
      asin=excluded.asin, title=excluded.title, url=excluded.url,
      price=excluded.price, display=excluded.display, available=excluded.available,
      status=excluded.status, error=excluded.error, fetched_at=excluded.fetched_at
  `).run(
    ptype, Number(partId), currency,
    result?.asin || null, result?.title || null, result?.url || null,
    result?.price ?? null, result?.display || null,
    result ? (result.available === false ? 0 : 1) : 0,
    error ? 'error' : 'ok', error, new Date().toISOString(),
  );
}

export function staleAmazonPrices(currency) {
  if (!isAmazonConfigured()) return [];
  const ttlMs = (config.amazon?.ttlHours || 72) * 3600 * 1000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  return db.prepare(
    'SELECT ptype, part_id, currency FROM amazon_prices WHERE currency=? AND status=? AND fetched_at < ? ORDER BY fetched_at ASC LIMIT 200'
  ).all(currency, 'ok', cutoff);
}

// Apply fresh, still-valid Amazon prices onto a parts map (keyed by builder
// part keys like cpu/gpu/...) for one build currency. Returns how many parts
// now carry a real Amazon price. When no Amazon key is configured or nothing
// is cached/fresh it leaves the reference prices untouched - the site never
// claims a live price it does not have.
export function applyAmazonLive(parts, currency) {
  if (!isAmazonConfigured() || !parts) return 0;
  let applied = 0;
  for (const key of Object.keys(parts)) {
    const part = parts[key];
    if (!part || !part.id) continue;
    const ptype = PTYPE_BY_PART_KEY[key];
    if (!ptype) continue;
    const row = freshAmazonPrice(ptype, part.id, currency);
    if (!row || row.price == null) continue;
    part.price = Math.round(row.price);
    part.price_date = (row.fetched_at || '').slice(0, 10) || null;
    part.price_source = 'amazon';
    part.live = { asin: row.asin, url: row.url, title: row.title };
    if (row.url && part.store) part.store.amazon = row.url;
    applied += 1;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// On-demand warming.
//
// A single in-process runner serves every request (builds, shared pages,
// catalog browsing) so PA-API is never called more than ~1x/second no matter
// how many visitors are online. Only parts that are missing a still-fresh row
// are enqueued; failed lookups are retried no sooner than 30 minutes so a bad
// credential cannot cause a request loop. Serving never waits on the network:
// this fills the cache in the background and later requests show live prices.
// ---------------------------------------------------------------------------

const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 1100;
const QUEUE_CAP = 600;

const queue = new Map(); // key `${currency}:${ptype}:${id}` -> { currency, ptype, id, name }
let runner = null;
let nextAllowedAt = 0;

function shouldFetch(currency, ptype, id) {
  if (!isAmazonConfigured()) return false;
  if (freshAmazonPrice(ptype, id, currency)) return false;
  const err = db.prepare(
    "SELECT fetched_at FROM amazon_prices WHERE ptype=? AND part_id=? AND currency=? AND status='error'"
  ).get(ptype, Number(id), currency);
  if (err && Date.now() - new Date(err.fetched_at).getTime() < RETRY_AFTER_ERROR_MS) return false;
  return true;
}

export function warmPrices(currency, entries) {
  if (!isAmazonConfigured()) return 0;
  const mpCurrency = ['USD', 'EUR', 'GBP'].includes(currency) ? currency : null;
  if (!mpCurrency) return 0;
  let added = 0;
  for (const e of entries || []) {
    const ptype = PTYPE_BY_PART_KEY[e.key] || e.ptype;
    const name = e.name;
    const id = Number(e.id);
    if (!ptype || !id || !name) continue;
    const key = `${mpCurrency}:${ptype}:${id}`;
    if (queue.has(key) || !shouldFetch(mpCurrency, ptype, id)) continue;
    if (queue.size >= QUEUE_CAP) break;
    queue.set(key, { currency: mpCurrency, ptype, id, name });
    added += 1;
  }
  if (added && !runner) runner = drain();
  return added;
}

async function drain() {
  while (queue.size) {
    const [key, job] = queue.entries().next().value;
    queue.delete(key);
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextAllowedAt = Date.now() + MIN_GAP_MS;
    try {
      const result = await searchAmazon({
        accessKey: config.amazon.accessKey, secretKey: config.amazon.secretKey,
        partnerTag: config.amazon.partnerTag, currency: job.currency, keywords: job.name,
      });
      saveAmazonPrice({ ptype: job.ptype, partId: job.id, currency: job.currency, result });
      console.log(`[amazon] warm ${job.currency} ${job.name} -> ${result?.display || 'no offer'}`);
    } catch (e) {
      saveAmazonPrice({ ptype: job.ptype, partId: job.id, currency: job.currency, result: null, error: e.message });
      console.log(`[amazon] warm ${job.currency} ${job.name} FAILED: ${e.message}`);
    }
  }
  runner = null;
  if (queue.size) runner = drain();
}

// Lightweight transparency for admins: what is configured and how healthy is
// the price cache. Used by the public /api/pc/price-status endpoint.
export function getAmazonPriceStatus() {
  const counts = {};
  for (const currency of ['USD', 'EUR', 'GBP']) {
    const row = db.prepare(
      `SELECT
         SUM(status='ok') AS ok, SUM(status='error') AS err
       FROM amazon_prices WHERE currency=?`
    ).get(currency);
    counts[currency] = { ok: row.ok || 0, error: row.err || 0, queue: 0 };
  }
  const entries = [...queue.values()];
  for (const q of entries) counts[q.currency] = counts[q.currency] || { ok: 0, error: 0, queue: 0 };
  for (const q of entries) counts[q.currency].queue += 1;
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recentErrors = db.prepare(
    "SELECT error, COUNT(*) AS n FROM amazon_prices WHERE status='error' AND fetched_at >= ? GROUP BY error ORDER BY n DESC LIMIT 6"
  ).all(cutoff);
  return {
    configured: isAmazonConfigured(),
    partnerTag: isAmazonConfigured() ? config.amazon.partnerTag : '',
    ttlHours: config.amazon?.ttlHours || 72,
    counts,
    recentErrors,
  };
}
