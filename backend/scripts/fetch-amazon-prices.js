// Refresh real Amazon prices for the hardware catalog using the Product
// Advertising API (PA-API v5). Requires AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY
// and AMAZON_PARTNER_TAG to be set (see .env.example).
//
// Usage:
//   npm run prices:amazon -- --currency=USD     # default: USD
//   npm run prices:amazon -- --currency=EUR
//   npm run prices:amazon -- --currency=USD --fresh  # ignore cache, refetch all
//
// It respects the standard ~1 request/second PA-API rate limit, only rewrites
// prices that are missing or older than AMAZON_PRICE_TTL_HOURS, and marks
// failures per part instead of failing the run. Nothing is ever fabricated:
// if Amazon returns no buyable offer the part keeps its dated reference price.

import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { ensureAmazonPricesTable, saveAmazonPrice, freshAmazonPrice, isAmazonConfigured } from '../src/services/amazonPrices.js';
import { searchAmazon, marketplaceFor } from '../src/utils/amazon.js';

const PTYPES = ['cpus', 'gpus', 'motherboards', 'ram', 'storage', 'psus', 'cases', 'coolers'];

const args = process.argv.slice(2);
const currency = (args.find((a) => a.startsWith('--currency=')) || '--currency=USD').split('=')[1].toUpperCase();
const fresh = args.includes('--fresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!['USD', 'EUR', 'GBP'].includes(currency)) {
    console.log(`Unsupported currency ${currency}. Use USD, EUR or GBP.`);
    process.exit(1);
  }
  if (!isAmazonConfigured()) {
    console.log('Amazon PA-API is not configured. Set AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY and AMAZON_PARTNER_TAG (see .env.example) to enable real prices. Nothing changed.');
    process.exit(0);
  }
  const mp = marketplaceFor(currency);
  if (!mp) {
    console.log(`No Amazon marketplace for ${currency}.`);
    process.exit(1);
  }

  ensureAmazonPricesTable();

  const queue = [];
  for (const ptype of PTYPES) {
    const table = {
      cpus: 'cpus', gpus: 'gpus', motherboards: 'motherboards', ram: 'memory_modules',
      storage: 'storage', psus: 'psus', cases: 'cases', coolers: 'coolers',
    }[ptype];
    const rows = db.prepare(`SELECT id, name FROM ${table} WHERE enabled = 1 ORDER BY id`).all();
    for (const row of rows) {
      const cached = fresh ? null : freshAmazonPrice(ptype, row.id, currency);
      if (cached) continue; // still within TTL, keep it
      queue.push({ ptype, table, id: row.id, name: row.name });
    }
  }

  console.log(`[amazon] fetching ${queue.length} part(s) on ${mp.host} (${currency}), ttl ${config.amazon.ttlHours}h`);
  let ok = 0, noOffer = 0, errors = 0;
  const started = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const { ptype, id, name } = queue[i];
    try {
      const result = await searchAmazon({
        accessKey: config.amazon.accessKey, secretKey: config.amazon.secretKey,
        partnerTag: config.amazon.partnerTag, currency, keywords: name,
      });
      if (result && result.price != null) {
        saveAmazonPrice({ ptype, partId: id, currency, result });
        ok += 1;
        console.log(`  [${i + 1}/${queue.length}] OK   ${name} -> ${result.display} (${result.asin})`);
      } else {
        saveAmazonPrice({ ptype, partId: id, currency, result: null, error: 'no buyable offer returned' });
        noOffer += 1;
        console.log(`  [${i + 1}/${queue.length}] NO   ${name} (no buyable offer)`);
      }
    } catch (e) {
      saveAmazonPrice({ ptype, partId: id, currency, result: null, error: e.message });
      errors += 1;
      console.log(`  [${i + 1}/${queue.length}] ERR  ${name}: ${e.message}`);
    }
    if (i < queue.length - 1) await sleep(1100); // respect ~1 req/s limit
  }

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`[amazon] done in ${secs}s: ${ok} priced, ${noOffer} no offer, ${errors} errors.`);
  process.exit(errors && !ok ? 1 : 0);
}

main().catch((e) => {
  console.error('[amazon] fatal:', e.message);
  process.exit(1);
});
