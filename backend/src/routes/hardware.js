import { Router } from 'express';
import { db } from '../db.js';
import { ok } from '../utils/helpers.js';

const router = Router();

const TABLES = {
  cpus: { label: 'CPU', columns: 'id, name, brand, socket, cores, threads, base_clock_ghz, boost_clock_ghz, tdp_watts, performance_index, integrated_graphics, price_usd, price_eur, price_gbp, price_date, release_year, source_id' },
  gpus: { label: 'GPU', columns: 'id, name, brand, chipset, vram_gb, length_mm, slot_width, power_connectors, tdp_watts, performance_index, pcie_version, supports_upscaling, price_usd, price_eur, price_gbp, price_date, release_year, source_id' },
  motherboards: { label: 'Motherboard', columns: 'id, name, brand, socket, chipset, ram_type, ram_slots, max_ram_gb, max_ram_speed_mhz, form_factor, m2_slots, pcie_version, bios_notes, price_usd, price_eur, price_gbp, price_date, source_id' },
  ram: { label: 'RAM', columns: 'id, name, brand, type, capacity_gb, speed_mhz, modules, price_usd, price_eur, price_gbp, price_date, source_id' },
  storage: { label: 'Storage', columns: 'id, name, brand, interface, form_factor, capacity_gb, read_mbps, price_usd, price_eur, price_gbp, price_date, source_id' },
  psus: { label: 'PSU', columns: 'id, name, brand, wattage, efficiency_rating, modular, pcie_connectors_8pin, eps_connectors, has_12vhpwr, price_usd, price_eur, price_gbp, price_date, source_id' },
  cases: { label: 'Case', columns: 'id, name, brand, form_factors, max_gpu_length_mm, max_cooler_height_mm, radiator_support, price_usd, price_eur, price_gbp, price_date, source_id' },
  coolers: { label: 'Cooler', columns: 'id, name, brand, type, socket_support, height_mm, radiator_size_mm, price_usd, price_eur, price_gbp, price_date, source_id' },
};

const COLUMN_MAP = {
  cpus: 'cpus', gpus: 'gpus', motherboards: 'motherboards',
  ram: 'memory_modules', storage: 'storage', psus: 'psus', cases: 'cases', coolers: 'coolers',
};

// GET /api/hardware?category=...&q=...&sort=price|index
router.get('/', (req, res) => {
  const { category, q = '', sort = '' } = req.query;
  if (category) {
    const table = TABLES[category];
    if (!table) return ok(res, { items: [], label: null, message: 'Unknown hardware category.' });
    const col = COLUMN_MAP[category];
    let sql = `SELECT ${table.columns} FROM ${col} WHERE enabled=1`;
    const params = [];
    if (q) {
      sql += ' AND name LIKE ?';
      params.push(`%${q}%`);
    }
    if (sort === 'price') sql += ' ORDER BY price_usd ASC';
    else if (sort === 'price_desc') sql += ' ORDER BY price_usd DESC';
    else if (sort === 'index' && (col === 'cpus' || col === 'gpus')) sql += ' ORDER BY performance_index DESC';
    else sql += ' ORDER BY name ASC';
    const items = db.prepare(sql).all(...params);
    return ok(res, { items, label: table.label, priceNote: 'Prices are approximate aggregate street estimates (USD/EUR/GBP) dated 2025-06-15.' });
  }
  // list all categories with counts
  const list = Object.entries(TABLES).map(([key, t]) => {
    const col = COLUMN_MAP[key];
    const c = db.prepare(`SELECT COUNT(*) c FROM ${col} WHERE enabled=1`).get().c;
    return { key, label: t.label, count: c };
  });
  ok(res, { categories: list });
});

// GET /api/hardware/:category/:id
router.get('/:category/:id', (req, res) => {
  const { category } = req.params;
  const table = TABLES[category];
  const col = COLUMN_MAP[category];
  if (!table || !col) return ok(res, { item: null, message: 'Unknown category.' });
  const item = db.prepare(`SELECT ${table.columns} FROM ${col} WHERE id=? AND enabled=1`).get(req.params.id);
  if (!item) return ok(res, { item: null, message: 'Not found.' });
  const source = db.prepare('SELECT name FROM data_sources WHERE id=?').get(item.source_id || item.sourceId);
  return ok(res, { item, source: source ? source.name : null });
});

export default router;
