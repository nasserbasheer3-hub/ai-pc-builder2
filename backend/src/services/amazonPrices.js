// Cache + lookup for Amazon PA-API prices.
//
// The cache table lives in the same SQLite database as the catalog so reads at
// request time are cheap and need no network. A fresh row means the listing
// was verified against Amazon within config.amazon.ttlHours; outside that
// window lookups return null (reference price + store links shown instead)
// until `npm run prices:amazon` refetches.

import { db } from '../db.js';
import { config } from '../config.js';

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
