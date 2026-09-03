import { db } from '../db.js';
import { checkCompatibility } from './compatibility.js';
import { estimateFps } from './fps.js';
import { storeSearchLinks } from '../utils/partStore.js';
import { applyAmazonLive } from '../services/amazonPrices.js';

const FX = { USD: 1, EUR: 1.09, GBP: 1.27 };

function price(row, currency) {
  if (currency === 'EUR' && row.price_eur != null) return row.price_eur;
  if (currency === 'GBP' && row.price_gbp != null) return row.price_gbp;
  return row.price_usd; // USD fallback for other currencies
}

function allEnabled(table, currency, maxPrice) {
  return db.prepare(`SELECT * FROM ${table} WHERE enabled = 1 ORDER BY price_usd`).all().map((r) => ({ ...r, p: price(r, currency) }));
}

export function buildPc(input) {
  const {
    budget = 1500, currency = 'USD', games = [], resolution = '1080p',
    targetFps = 60, rgb = false, caseSize = 'ATX', noisePreference = 'balanced',
    cpuPreference = 'any', gpuPreference = 'any', ramGb = 32, storageGb = 1000,
    upgradeOf = null, // optional { cpu_id, gpu_id, ... } to upgrade existing
  } = input;

  if (!budget || budget <= 0) return { status: 'error', message: 'A positive budget is required.' };

  const gameRows = games.map((id) => db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(id)).filter(Boolean);

  let cpus = allEnabled('cpus', currency);
  let gpus = allEnabled('gpus', currency);
  if (cpuPreference === 'intel') cpus = cpus.filter((c) => c.brand === 'Intel');
  if (cpuPreference === 'amd') cpus = cpus.filter((c) => c.brand === 'AMD');
  if (gpuPreference === 'nvidia') gpus = gpus.filter((g) => g.brand === 'NVIDIA');
  if (gpuPreference === 'amd') gpus = gpus.filter((g) => g.brand === 'AMD');

  if (!gpus.length) return { status: 'error', message: 'No GPUs match the selected preference within the catalog.' };

  // Preselect a platform based on the best CPU affordable within a target share.
  // GPU gets the largest share, CPU the next.
  const candidateGpus = gpus.filter((g) => g.p <= budget * 0.48).sort((a, b) => b.performance_index - a.performance_index);
  if (!candidateGpus.length) return { status: 'error', message: 'The budget is too low for a discrete GPU in the catalog.' };

  const tryCombos = [];
  for (const gpu of candidateGpus) {
    const cpuBudget = Math.min(budget * 0.25, gpu.p * 0.9);
    const cpuCandidates = cpus.filter((c) => c.p <= cpuBudget).sort((a, b) => b.performance_index - a.performance_index);
    if (!cpuCandidates.length) continue;
    // prefer X3D / high game index
    const cpu = cpuCandidates[0];

    // Motherboard: cheapest that supports cpu socket + chosen RAM type
    const mbs = allEnabled('motherboards', currency).filter((m) => m.socket === cpu.socket && m.ram_type === (ramGb >= 32 ? 'DDR5' : 'DDR4')).sort((a, b) => a.p - b.p);
    if (!mbs.length) continue;
    const mb = mbs.find((m) => ['ATX', 'microATX', 'mini-ITX'].includes(m.form_factor));

    const ram = allEnabled('memory_modules', currency)
      .filter((r) => r.type === mb.ram_type && r.capacity_gb >= ramGb)
      .sort((a, b) => a.p - b.p)[0];
    if (!ram) continue;

    const storage = allEnabled('storage', currency)
      .filter((s) => s.capacity_gb >= storageGb && s.interface.includes('NVMe'))
      .sort((a, b) => a.p - b.p)[0] || allEnabled('storage', currency).filter((s) => s.capacity_gb >= storageGb).sort((a, b) => a.p - b.p)[0];
    if (!storage) continue;

    const requiredWatts = cpu.tdp_watts + gpu.tdp_watts + 150;
    const psu = allEnabled('psus', currency).filter((p) => p.wattage >= requiredWatts && p.wattage <= requiredWatts + 350).sort((a, b) => a.p - b.p)[0];
    if (!psu) continue;

    const cases = allEnabled('cases', currency).filter((c) => {
      let ff = [];
      try { ff = JSON.parse(c.form_factors); } catch { /* keep empty */ }
      return ff.includes(mb.form_factor) && c.max_gpu_length_mm >= gpu.length_mm;
    }).sort((a, b) => a.p - b.p);
    if (!cases.length) continue;
    const pcCase = cases[0];

    const coolers = allEnabled('coolers', currency).filter((c) => {
      let sockets = [];
      try { sockets = JSON.parse(c.socket_support); } catch { /* keep empty */ }
      return sockets.includes(cpu.socket);
    }).sort((a, b) => a.p - b.p);
    const cpuNeedsStrong = cpu.tdp_watts >= 120;
    let cooler = cpuNeedsStrong && coolers.find((c) => c.type === 'liquid') ? coolers.find((c) => c.type === 'liquid') : coolers[0];
    if (!cooler) cooler = coolers[0];
    if (!cooler) continue;

    const total = [gpu, cpu, mb, ram, storage, psu, pcCase, cooler].reduce((s, x) => s + (x.p || 0), 0);
    tryCombos.push({ parts: { gpu, cpu, mb, ram, storage, psu, pcCase, cooler }, total });
  }

  const affordable = tryCombos.filter((t) => t.total <= budget);
  if (!affordable.length) {
    const cheapest = tryCombos.length ? Math.min(...tryCombos.map((t) => t.total)) : null;
    return {
      status: 'error',
      message: cheapest != null
        ? `The budget is too low to assemble a complete build from the verified catalog. The cheapest valid build is approximately ${cheapest} ${currency}.`
        : 'Could not assemble a build from the verified catalog for these preferences.',
    };
  }
  // Prefer the highest-performance GPU that still fits the budget.
  const pick = affordable.sort((a, b) => b.parts.gpu.performance_index - a.parts.gpu.performance_index)[0];

  const { parts, total } = pick;
  const config = {
    cpu: parts.cpu.id, gpu: parts.gpu.id, motherboard: parts.mb.id, ram: parts.ram.id,
    storage: parts.storage.id, psu: parts.psu.id, case: parts.pcCase.id, cooler: parts.cooler.id,
  };
  const compatibility = checkCompatibility(config);

  const expectedFps = gameRows.map((g) => {
    const est = estimateFps({ gameId: g.id, cpuId: parts.cpu.id, gpuId: parts.gpu.id, resolution, quality: 'Ultra' });
    return { game: g.name, resolution, fps: est.avgFps, label: est.label, message: est.message };
  });

  const explanations = [
    { category: 'cpu', text: `${parts.cpu.name} — ${parts.cpu.cores}C/${parts.cpu.threads}T, boost ${parts.cpu.boost_clock_ghz}GHz. Chosen as the strongest gaming CPU fitting ${Math.round(parts.cpu.p)} ${currency} of the budget.` },
    { category: 'gpu', text: `${parts.gpu.name} — ${parts.gpu.vram_gb}GB VRAM, relative performance index ${parts.gpu.performance_index}. Largest budget share because it dominates gaming FPS.` },
    { category: 'motherboard', text: `${parts.mb.name} — ${parts.mb.form_factor}, ${parts.mb.ram_type} with ${parts.mb.ram_slots} slots. Cheapest board matching the ${parts.cpu.socket} socket.` },
    { category: 'ram', text: `${parts.ram.name} — ${parts.ram.capacity_gb}GB ${parts.ram.type} @ ${parts.ram.speed_mhz}MHz. ${parts.ram.modules} module(s).` },
    { category: 'storage', text: `${parts.storage.name} — ${Math.round(parts.storage.capacity_gb / 1000)}TB ${parts.storage.interface}.` },
    { category: 'psu', text: `${parts.psu.name} — ${parts.psu.wattage}W ${parts.psu.efficiency_rating}. Sized for ~${parts.cpu.tdp_watts + parts.gpu.tdp_watts + 150}W estimated draw.` },
    { category: 'case', text: `${parts.pcCase.name} — supports ${parts.mb.form_factor}; ${parts.pcCase.max_gpu_length_mm}mm GPU clearance.` },
    { category: 'cooler', text: `${parts.cooler.name} (${parts.cooler.type}) — supports ${parts.cpu.socket}.${parts.cpu.tdp_watts >= 120 ? ' Selected as liquid/high-airflow option for a high-TDP CPU.' : ''}` },
  ];

  const built = {
    status: 'ready',
    config,
    parts: {
      cpu: { id: parts.cpu.id, name: parts.cpu.name, price: parts.cpu.p, price_date: parts.cpu.price_date || null, store: storeSearchLinks(parts.cpu.name, currency), reason: explanations[0].text },
      gpu: { id: parts.gpu.id, name: parts.gpu.name, price: parts.gpu.p, price_date: parts.gpu.price_date || null, store: storeSearchLinks(parts.gpu.name, currency), reason: explanations[1].text },
      motherboard: { id: parts.mb.id, name: parts.mb.name, price: parts.mb.p, price_date: parts.mb.price_date || null, store: storeSearchLinks(parts.mb.name, currency), reason: explanations[2].text },
      ram: { id: parts.ram.id, name: parts.ram.name, price: parts.ram.p, price_date: parts.ram.price_date || null, store: storeSearchLinks(parts.ram.name, currency), reason: explanations[3].text },
      storage: { id: parts.storage.id, name: parts.storage.name, price: parts.storage.p, price_date: parts.storage.price_date || null, store: storeSearchLinks(parts.storage.name, currency), reason: explanations[4].text },
      psu: { id: parts.psu.id, name: parts.psu.name, price: parts.psu.p, price_date: parts.psu.price_date || null, store: storeSearchLinks(parts.psu.name, currency), reason: explanations[5].text },
      case: { id: parts.pcCase.id, name: parts.pcCase.name, price: parts.pcCase.p, price_date: parts.pcCase.price_date || null, store: storeSearchLinks(parts.pcCase.name, currency), reason: explanations[6].text },
      cooler: { id: parts.cooler.id, name: parts.cooler.name, price: parts.cooler.p, price_date: parts.cooler.price_date || null, store: storeSearchLinks(parts.cooler.name, currency), reason: explanations[7].text },
    },
    totalPrice: Math.round(total),
    budget,
    currency,
    withinBudget: total <= budget,
    compatibility: { status: compatibility.status, summary: compatibility.summary, errors: compatibility.checks.filter((c) => c.status === 'error').length },
    expectedFps,
    label: 'Estimated',
    priceLabel: 'Estimated price',
    note: 'Component selection is made from the verified hardware catalog. Prices are approximate street estimates with a date.',
  };

  const amazonCount = applyAmazonLive(built.parts, currency);
  if (amazonCount > 0) {
    const amazonTotal = Math.round(Object.values(built.parts).reduce((s, p) => s + (Number(p.price) || 0), 0));
    built.totalPrice = amazonTotal;
    built.withinBudget = amazonTotal <= budget;
    built.priceLabel = 'Price basis: Amazon where live, reference otherwise';
    built.note = `${amazonCount} of ${Object.keys(built.parts).length} part prices were fetched live from Amazon and are current as of the dates shown on each part. The remaining parts use catalog reference estimates with their own dates. Always confirm the final price in store before buying.`;
  }

  return built;
}
