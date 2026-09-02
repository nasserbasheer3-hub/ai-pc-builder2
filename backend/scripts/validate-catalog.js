// Catalog integrity gate. Run before an ad campaign or any release that
// touches hardware data. It validates the canonical built-in catalog
// (seed-data.js) and, when a database path is reachable, the seeded rows.
//
// Usage:
//   node scripts/validate-catalog.js            # validate seed-data only
//   DATABASE_PATH=/var/data/gaming_platform.db node scripts/validate-catalog.js
//
// Exits non-zero when anomalies are found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, '..', 'src', 'seed-data.js');

const seed = await import(seedPath);

const JSON_COLUMNS = {
  gpus: ['power_connectors', 'supports_upscaling'],
  cases: ['form_factors', 'radiator_support'],
  coolers: ['socket_support'],
};

const ARRAYS = {
  cpus: seed.cpus,
  gpus: seed.gpus,
  motherboards: seed.motherboards,
  memory_modules: seed.memoryModules,
  storage: seed.storageDevices,
  psus: seed.psus,
  cases: seed.cases,
  coolers: seed.coolers,
};

let problems = 0;
const report = (...args) => { console.log(...args); problems += 1; };

console.log(`Validating built-in catalog (${Object.values(ARRAYS).reduce((s, a) => s + a.length, 0)} items across ${Object.keys(ARRAYS).length} categories)...`);

for (const [table, items] of Object.entries(ARRAYS)) {
  const seen = new Map();
  for (const it of items) {
    seen.set(it.name, (seen.get(it.name) || 0) + 1);
    for (const col of JSON_COLUMNS[table] || []) {
      const v = it[col];
      if (typeof v === 'string') {
        try { JSON.parse(v); } catch { report(`  [${table}] malformed JSON in '${col}' for '${it.name}'`); }
      }
    }
    const zeroPrice = !Number(it.price_usd) || !Number(it.price_eur) || !Number(it.price_gbp);
    const bundled = table === 'coolers' && /wraith/i.test(it.name);
    if (zeroPrice && !bundled) report(`  [${table}] missing/zero price for '${it.name}'`);
    if (table === 'memory_modules' && it.capacity_gb % it.modules !== 0) {
      report(`  [${table}] capacity ${it.capacity_gb}GB not divisible by ${it.modules} modules for '${it.name}'`);
    }
    if ((table === 'cpus' || table === 'gpus') && !Number(it.performance_index)) {
      report(`  [${table}] missing performance_index for '${it.name}'`);
    }
  }
  const dups = [...seen].filter(([, c]) => c > 1);
  if (dups.length) report(`  [${table}] duplicate names: ${dups.map(([n]) => n).join(', ')}`);
  console.log(`  [${table}] ${items.length} items OK`);
}

const dbPath = process.env.DATABASE_PATH;
if (dbPath && fs.existsSync(dbPath)) {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });
  console.log(`\nChecking seeded database rows at ${dbPath}...`);
  for (const [table] of Object.entries(ARRAYS)) {
    try {
      const dup = db.prepare(`SELECT name, COUNT(*) c FROM ${table} GROUP BY name HAVING c > 1`).all();
      if (dup.length) report(`  [${table}] DB duplicate names: ${dup.map((d) => d.name).join(', ')}`);
      const { c } = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE enabled = 1`).get();
      console.log(`  [${table}] ${c} enabled rows`);
    } catch (e) {
      report(`  [${table}] could not read table: ${e.message}`);
    }
  }
  db.close();
}

if (problems) {
  console.error(`\nCatalog validation FAILED with ${problems} issue(s).`);
  process.exit(1);
}
console.log('\nCatalog validation passed.');
