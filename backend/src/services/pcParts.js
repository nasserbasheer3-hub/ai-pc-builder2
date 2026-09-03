import { db } from '../db.js';
import { storeSearchLinks } from '../utils/partStore.js';

export const PART_TABLES = {
  cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'memory_modules',
  storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers',
};

export const PART_LABELS = {
  cpu: 'CPU', gpu: 'GPU', motherboard: 'Motherboard', ram: 'Memory', storage: 'Storage',
  psu: 'PSU', case: 'Case', cooler: 'Cooler',
};

export function resolvePart(key, id) {
  const table = PART_TABLES[key];
  if (!table) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(id)) || null;
}

function specLine(key, row) {
  if (!row) return '';
  switch (key) {
    case 'cpu': return `${row.cores}C/${row.threads}T · ${row.boost_clock_ghz}GHz boost · ${row.tdp_watts}W`;
    case 'gpu': return `${row.vram_gb}GB VRAM · ${row.tdp_watts}W · ${row.chipset || ''}`.replace(/·\s*$/, '');
    case 'motherboard': return `${row.socket} · ${row.form_factor} · ${row.chipset || ''}`.replace(/·\s*$/, '');
    case 'ram': return `${row.capacity_gb}GB ${row.type} ${row.speed_mhz}MHz (${row.modules}×${Math.round(row.capacity_gb / row.modules)}GB)`;
    case 'storage': return `${row.capacity_gb}GB · ${row.interface}`;
    case 'psu': return `${row.wattage}W · ${row.efficiency_rating}`;
    case 'case': return `${row.form_factors ? JSON.parse(row.form_factors || '[]').join(', ') : ''}`.trim() || null;
    case 'cooler': return `${row.type}${row.radiator_size_mm ? ` ${row.radiator_size_mm}mm` : ''}`;
    default: return '';
  }
}

function localPrice(row, currency) {
  if (currency === 'EUR' && row.price_eur != null) return row.price_eur;
  if (currency === 'GBP' && row.price_gbp != null) return row.price_gbp;
  return row.price_usd;
}

export function partsDetail(config, currency) {
  const parts = {};
  for (const key of Object.keys(PART_TABLES)) {
    const id = Number(config?.[key]);
    if (!id) continue;
    const row = resolvePart(key, id);
    if (!row) continue;
    parts[key] = {
      id, name: row.name, price_usd: row.price_usd, spec: specLine(key, row) || null,
      price: currency ? Math.round(localPrice(row, currency)) : row.price_usd,
      price_date: row.price_date || null,
      store: storeSearchLinks(row.name, currency || 'USD'),
    };
  }
  return parts;
}

export function totalPrice(config) {
  const parts = partsDetail(config);
  return Object.values(parts).reduce((sum, p) => sum + (Number(p.price_usd) || 0), 0);
}

export function categoryOfPartType(partType) {
  const map = { cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'memory_modules', storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers' };
  return map[partType] || null;
}

// Return the part rows in build order for the public shared build view.
export function buildSummary(config) {
  const detail = partsDetail(config);
  const order = ['cpu', 'gpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'];
  return {
    parts: detail,
    total: totalPrice(config),
    count: Object.keys(detail).length,
    order,
  };
}
