import { db } from '../db.js';
import { checkCompatibility } from './compatibility.js';
import { estimateFps } from './fps.js';
import { storeSearchLinks } from '../utils/partStore.js';
import { applyAmazonLive, warmPrices } from '../services/amazonPrices.js';

// Diversity-focused PC configuration engine.
//
// Older versions returned one "best" build for a request (fastest GPU that
// fit the budget + the cheapest everything else), so unrelated requests and
// budgets produced almost identical builds. This engine instead enumerates a
// wide set of DISTINCT valid configurations that draw on the whole verified
// catalog (both CPU platforms, several GPU tiers per budget, different board /
// RAM / storage / PSU / case / cooler picks) and ranks them factually. A
// caller may take just the top plan (backwards compatible, same object shape
// as before) or request many alternatives to present the user.

const FX = { USD: 1, EUR: 1.09, GBP: 1.27 };
const GAMING_CASE_FFS = ['ATX', 'microATX'];

function price(row, currency) {
  if (currency === 'EUR' && row.price_eur != null) return row.price_eur;
  if (currency === 'GBP' && row.price_gbp != null) return row.price_gbp;
  return row.price_usd;
}

function pool(table, currency) {
  return db.prepare(`SELECT * FROM ${table} WHERE enabled = 1 ORDER BY price_usd`).all()
    .map((r) => ({ ...r, p: price(r, currency) }));
}

function parseList(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { return JSON.parse(v); } catch { return []; }
}

function pickRamTypeFor(socket, mbPool, wantDdr5) {
  // Prefer DDR5 when the socket has boards for it (faster kits), fall back to
  // DDR4 for older platforms that never got DDR5 boards.
  const types = [...new Set(mbPool.filter((m) => m.socket === socket).map((m) => m.ram_type))];
  const order = wantDdr5 ? ['DDR5', 'DDR4'] : ['DDR4', 'DDR5'];
  for (const t of order) if (types.includes(t)) return t;
  return types[0] || null;
}

// --- CPU selection ---------------------------------------------------------
// Different use cases weight different real columns: gaming uses the relative
// gaming index, streaming wants at least an 8-core/16-thread chip, content
// creation prefers the highest core/thread counts that stay in budget.
function orderCpus(cpus, purpose) {
  if (purpose === 'content') {
    return [...cpus].sort((a, b) => (b.threads - a.threads) || (b.performance_index - a.performance_index) || (a.p - b.p));
  }
  if (purpose === 'streaming') {
    const strong = cpus.filter((c) => c.cores >= 8 && c.threads >= 16);
    const base = strong.length ? strong : cpus;
    return [...base].sort((a, b) => (b.performance_index - a.performance_index) || (a.p - b.p));
  }
  return [...cpus].sort((a, b) => (b.performance_index - a.performance_index) || (a.p - b.p));
}

// A spread of CPUs per GPU: the fastest affordable options plus mid-tier and
// entry alternatives, so the menu spans different totals and both platforms.
function pickCpus(cpus, cap, purpose) {
  const ok = cpus.filter((c) => c.p <= cap);
  if (!ok.length) return [];
  const ordered = orderCpus(ok, purpose);
  const picks = [];
  const add = (c) => { if (c && !picks.some((x) => x.id === c.id)) picks.push(c); };
  ordered.slice(0, 3).forEach(add);
  if (ok.length > 3) add(ok[Math.floor(ok.length / 2)]);
  const cheapest = [...ok].sort((a, b) => a.p - b.p).slice(0, 2);
  cheapest.forEach(add);
  return picks.slice(0, 6);
}

function allowedBoardForms(caseSize) {
  if (caseSize === 'microATX') return ['microATX'];
  if (caseSize === 'ATX') return GAMING_CASE_FFS; // a full tower also hosts smaller boards
  return GAMING_CASE_FFS; // auto
}

function pickBoard(mbPool, cpu, ramType, wantedForms) {
  return mbPool
    .filter((m) => m.socket === cpu.socket && m.ram_type === ramType && wantedForms.includes(m.form_factor))
    .sort((a, b) => a.p - b.p)[0] || null;
}

function pickRam(ramPool, mb, ramGb) {
  return ramPool
    .filter((r) => r.type === mb.ram_type && r.capacity_gb >= ramGb)
    .sort((a, b) => a.p - b.p)[0] || null;
}

function pickStorage(storagePool, storageGb, storageType) {
  const want = storageType === 'nvme' ? 'NVMe' : storageType === 'sata' ? 'SATA' : null;
  const cands = want
    ? storagePool.filter((s) => s.capacity_gb >= storageGb && s.interface.includes(want))
    : storagePool.filter((s) => s.capacity_gb >= storageGb);
  let chosen = cands.sort((a, b) => a.p - b.p)[0] || null;
  if (!chosen) {
    // Honest fallback to any interface that meets the capacity when the
    // preferred bus has no such drive in the verified catalog.
    chosen = storagePool.filter((s) => s.capacity_gb >= storageGb).sort((a, b) => a.p - b.p)[0] || null;
  }
  return chosen;
}

function pickPsu(psuPool, requiredWatts, quiet) {
  const cands = psuPool.filter((p) => p.wattage >= requiredWatts && p.wattage <= requiredWatts + 350);
  if (!cands.length) return null;
  if (!quiet) return [...cands].sort((a, b) => a.p - b.p)[0];
  // Quiet preference: prefer fully-modular Gold units, then cheapest.
  return [...cands].sort((a, b) => {
    const score = (x) => (x.efficiency_rating === '80 Plus Gold' ? 0 : 1) + (x.modular === 'fully' ? 0 : 1);
    return (score(a) - score(b)) || (a.p - b.p);
  })[0];
}

function pickCase(casePool, boardForm, gpu) {
  return casePool
    .filter((c) => parseList(c.form_factors).includes(boardForm) && c.max_gpu_length_mm >= (gpu.length_mm || 0))
    .sort((a, b) => a.p - b.p)[0] || null;
}

function pickCooler(coolerPool, cpu, pcCase) {
  const cands = coolerPool.filter((c) => parseList(c.socket_support).includes(cpu.socket));
  const strong = cpu.tdp_watts >= 120;
  let liquid = cands.filter((c) => c.type === 'liquid').sort((a, b) => a.p - b.p)[0];
  const air = cands
    .filter((c) => c.type !== 'liquid' && (!c.height_mm || !pcCase || c.height_mm <= pcCase.max_cooler_height_mm))
    .sort((a, b) => a.p - b.p)[0];
  if (strong && liquid) return liquid;
  return air || liquid || null;
}

// Enumerate the GPU shortlist: the fastest affordable GPUs plus a few entry
// cards so low-cost plans exist even for large budgets.
function gpuShortlist(gpus, budget) {
  const affordable = gpus.filter((g) => g.p <= budget * 0.52);
  const ordered = [...affordable].sort((a, b) => b.performance_index - a.performance_index);
  const top = ordered.slice(0, 18);
  const entry = [...gpus].sort((a, b) => a.p - b.p).slice(0, 3);
  for (const g of entry) if (!top.some((x) => x.id === g.id)) top.push(g);
  return top;
}

// --- Plan generation -------------------------------------------------------
// A "plan" is a complete, logically valid set of parts for one (GPU, CPU)
// pairing. Compatibility is re-verified with the shared engine before a plan
// is ever shown, and only plans that stay inside the budget are returned.
export function generatePlans(input, { includeFpsGames = 8 } = {}) {
  const {
    budget = 1500, currency = 'USD', resolution = '1080p', targetFps = 60,
    purpose = 'gaming', rgb = false, caseSize = 'auto', noisePreference = 'balanced',
    cpuPreference = 'any', gpuPreference = 'any', ramGb = 32, storageGb = 1000,
    storageType = 'nvme', games = [], _quiet = null,
  } = input;
  const quiet = _quiet != null ? _quiet : noisePreference === 'quiet';

  if (!budget || budget <= 0) return { status: 'error', message: 'A positive budget is required.' };

  let cpus = pool('cpus', currency);
  let gpus = pool('gpus', currency);
  if (cpuPreference === 'intel') cpus = cpus.filter((c) => c.brand === 'Intel');
  if (cpuPreference === 'amd') cpus = cpus.filter((c) => c.brand === 'AMD');
  if (gpuPreference === 'nvidia') gpus = gpus.filter((g) => g.brand === 'NVIDIA');
  if (gpuPreference === 'amd') gpus = gpus.filter((g) => g.brand === 'AMD');
  if (gpuPreference === 'intel') gpus = gpus.filter((g) => g.brand === 'Intel');

  const mbPool = pool('motherboards', currency);
  const ramPool = pool('memory_modules', currency);
  const storagePool = pool('storage', currency);
  const psuPool = pool('psus', currency);
  const casePool = pool('cases', currency);
  const coolerPool = pool('coolers', currency);

  if (!gpus.length) return { status: 'error', message: 'No GPUs match the selected preference within the catalog.' };
  const wantedForms = allowedBoardForms(caseSize);
  const plans = [];
  const seen = new Set();

  for (const gpu of gpuShortlist(gpus, budget)) {
    const cpuBudget = Math.min(budget * (purpose === 'content' ? 0.32 : 0.27), gpu.p * 0.95);
    for (const cpu of pickCpus(cpus, cpuBudget, purpose)) {
      const ramType = pickRamTypeFor(cpu.socket, mbPool, ramGb >= 32);
      const mb = pickBoard(mbPool, cpu, ramType, wantedForms);
      if (!mb) continue;
      const ram = pickRam(ramPool, mb, ramGb);
      if (!ram) continue;
      const storage = pickStorage(storagePool, storageGb, storageType);
      if (!storage) continue;
      const requiredWatts = cpu.tdp_watts + gpu.tdp_watts + 150;
      const psu = pickPsu(psuPool, requiredWatts, quiet);
      if (!psu) continue;
      const pcCase = pickCase(casePool, mb.form_factor, gpu);
      if (!pcCase) continue;
      const cooler = pickCooler(coolerPool, cpu, pcCase);
      if (!cooler) continue;

      const total = [gpu, cpu, mb, ram, storage, psu, pcCase, cooler].reduce((s, x) => s + x.p, 0);
      if (total > budget) continue;

      const key = [gpu, cpu, mb, ram, storage, psu, pcCase, cooler].map((x) => x.id).join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      plans.push({
        parts: { gpu, cpu, mb, ram, storage, psu, pcCase, cooler },
        config: { cpu: cpu.id, gpu: gpu.id, motherboard: mb.id, ram: ram.id, storage: storage.id, psu: psu.id, case: pcCase.id, cooler: cooler.id },
        total,
        gpuIndex: gpu.performance_index || 0,
        threads: cpu.threads || 0,
      });
    }
  }

  if (!plans.length) {
    // Honest fallback error: find the cheapest valid combination so the
    // message states a real number instead of guessing.
    const cheapest = cheapestPlan({ cpus, gpus, mbPool, ramPool, storagePool, psuPool, casePool, coolerPool, ramGb, storageGb, storageType, wantedForms, quiet, games: [], budget: Infinity });
    return {
      status: 'error',
      message: cheapest.total != null
        ? `The budget is too low to assemble a complete build from the verified catalog. The cheapest valid build is approximately ${Math.round(cheapest.total)} ${currency}.`
        : 'Could not assemble a build from the verified catalog for these preferences.',
    };
  }

  const ordered = [...plans].sort((a, b) => {
    if (purpose === 'content') {
      return (b.threads - a.threads) || (b.gpuIndex - a.gpuIndex) || (a.total - b.total);
    }
    return (b.gpuIndex - a.gpuIndex) || (b.threads - a.threads) || (a.total - b.total);
  });

  return {
    status: 'ready',
    plans: ordered,
    count: ordered.length,
    resolution,
    targetFps,
    _meta: { includeFpsGames: Math.max(1, includeFpsGames) },
  };
}

function cheapestPlan(ctx) {
  const { cpus, gpus, mbPool, ramPool, storagePool, psuPool, casePool, coolerPool, ramGb, storageGb, storageType, wantedForms } = ctx;
  const gpuCands = [...gpus].sort((a, b) => a.p - b.p).slice(0, 8);
  let best = null;
  for (const gpu of gpuCands) {
    const cpuCands = [...cpus].sort((a, b) => a.p - b.p).slice(0, 4);
    for (const cpu of cpuCands) {
      const ramType = pickRamTypeFor(cpu.socket, mbPool, false);
      const mb = pickBoard(mbPool, cpu, ramType, wantedForms);
      if (!mb) continue;
      const ram = pickRam(ramPool, mb, ramGb);
      const storage = pickStorage(storagePool, storageGb, storageType);
      const psu = pickPsu(psuPool, cpu.tdp_watts + gpu.tdp_watts + 150, false);
      const pcCase = pickCase(casePool, mb.form_factor, gpu);
      const cooler = pickCooler(coolerPool, cpu, pcCase);
      if (!ram || !storage || !psu || !pcCase || !cooler) continue;
      const total = [gpu, cpu, mb, ram, storage, psu, pcCase, cooler].reduce((s, x) => s + x.p, 0);
      if (!best || total < best.total) best = { total, cpu, gpu };
    }
  }
  return best || { total: null };
}

// --- Serialization (shared with the legacy single-build output) ------------
function explanationFor(cat, rows, currency) {
  const { gpu, cpu, mb, ram, storage, psu, pcCase, cooler } = rows;
  switch (cat) {
    case 'cpu':
      return `${cpu.name} — ${cpu.cores}C/${cpu.threads}T, boost ${cpu.boost_clock_ghz}GHz. Chosen as a strong CPU that fits ~${Math.round(cpu.p)} ${currency} within this option.`;
    case 'gpu':
      return `${gpu.name} — ${gpu.vram_gb}GB VRAM, relative performance index ${gpu.performance_index}. The GPU has the largest budget share because it dominates gaming FPS.`;
    case 'motherboard':
      return `${mb.name} — ${mb.form_factor}, ${mb.ram_type} with ${mb.ram_slots} slots. Cheapest board matching the ${cpu.socket} socket for this RAM type.`;
    case 'ram':
      return `${ram.name} — ${ram.capacity_gb}GB ${ram.type} @ ${ram.speed_mhz}MHz. ${ram.modules} module(s).`;
    case 'storage':
      return `${storage.name} — ${Math.round(storage.capacity_gb / 1000)}TB ${storage.interface}.`;
    case 'psu':
      return `${psu.name} — ${psu.wattage}W ${psu.efficiency_rating}. Sized for ~${cpu.tdp_watts + gpu.tdp_watts + 150}W estimated draw.`;
    case 'case':
      return `${pcCase.name} — supports ${mb.form_factor}; ${pcCase.max_gpu_length_mm}mm GPU clearance.`;
    case 'cooler':
      return `${cooler.name} (${cooler.type}) — supports ${cpu.socket}.${cpu.tdp_watts >= 120 ? ' Selected as a strong cooling option for a high-TDP CPU.' : ''}`;
    default:
      return '';
  }
}

function buildPartsOutput(rows, currency) {
  const names = {
    cpu: 'cpu', gpu: 'gpu', motherboard: 'motherboard', ram: 'ram',
    storage: 'storage', psu: 'psu', case: 'case', cooler: 'cooler',
  };
  const out = {};
  for (const [key, row] of Object.entries(rows)) {
    const cat = names[key];
    if (!row) continue;
    out[key] = {
      id: row.id, name: row.name, price: row.p,
      price_date: row.price_date || null,
      store: storeSearchLinks(row.name, currency),
      reason: explanationFor(cat, rows, currency),
    };
  }
  return out;
}

// Shared "why" the plan is listed: factual position, never a fabricated spec.
function planVerdict(plan, budget, currency) {
  const pct = Math.round((plan.total / budget) * 100);
  return { total: Math.round(plan.total), budgetUsedPct: pct, gpuIndex: plan.gpuIndex, threads: plan.threads };
}

function serializePlan(plan, currency, opts = {}) {
  const { parts, config, total } = plan;
  const compatibility = opts.skipCompatibility ? null : checkCompatibility(config);

  const gameRows = (opts.gameRows || []).slice(0, opts.includeFpsGames || 8).map((g) => {
    const est = estimateFps({ gameId: g.id, cpuId: config.cpu, gpuId: config.gpu, resolution: opts.resolution || '1080p', quality: 'Ultra' });
    return { game: g.name, resolution: opts.resolution || '1080p', fps: est.avgFps, label: est.label, message: est.message };
  });

  const output = {
    config,
    parts: buildPartsOutput(parts, currency),
    totalPrice: Math.round(total),
    currency,
    withinBudget: true,
    expectedFps: gameRows,
    resolution: opts.resolution || '1080p',
    targetFps: opts.targetFps || 60,
    label: 'Estimated',
  };
  if (compatibility) {
    output.compatibility = { status: compatibility.status, score: compatibility.score, scoreVerdict: compatibility.scoreVerdict, summary: compatibility.summary, errors: compatibility.checks.filter((c) => c.status === 'error').length };
  }
  const amazonCount = applyAmazonLive(output.parts, currency);
  if (amazonCount > 0) {
    const amazonTotal = Math.round(Object.values(output.parts).reduce((s, p) => s + (Number(p.price) || 0), 0));
    output.totalPrice = amazonTotal;
    output.withinBudget = amazonTotal <= (opts.budget == null ? Infinity : opts.budget);
    output.priceLabel = 'Price basis: Amazon where live, reference otherwise';
    output.note = `${amazonCount} of ${Object.keys(output.parts).length} part prices were fetched live from Amazon and are current as of the dates shown on each part. The remaining parts use catalog reference estimates with their own dates. Always confirm the final price in store before buying.`;
  } else {
    output.priceLabel = 'Estimated price';
    output.note = 'Component selection is made from the verified hardware catalog. Prices are approximate street estimates with a date.';
  }
  warmPrices(currency, Object.entries(output.parts).map(([key, p]) => ({ key, id: p.id, name: p.name })));
  return output;
}

// --- Public API ------------------------------------------------------------
// Legacy single-build entry point. Kept behaviourally compatible: returns the
// top-ranked plan with the same fields as the historical engine.
export function buildPc(input, { alternatives = 0 } = {}) {
  const { currency = 'USD' } = input || {};
  const gen = generatePlans(input || {});
  if (gen.status !== 'ready') return { status: gen.status, message: gen.message };

  const gameRows = (input.games || []).map((id) => db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(id)).filter(Boolean);
  const opts = { resolution: input.resolution || '1080p', targetFps: input.targetFps || 60, gameRows, includeFpsGames: 8, budget: input.budget || 1500 };

  const top = serializePlan(gen.plans[0], currency, opts);
  const result = {
    status: 'ready',
    ...top,
    budget: input.budget || 1500,
  };

  const rest = alternatives > 0 ? gen.plans.slice(1, alternatives + 1) : [];
  if (rest.length) {
    result.alternatives = rest.map((p) => ({
      ...serializePlan(p, currency, opts),
      verdict: planVerdict(p, result.budget, currency),
    }));
    result.alternativeCount = rest.length + 1;
    result.note = `${result.alternativeCount} distinct verified configurations were generated for your request. Prices are catalog reference estimates with a date, or live Amazon prices where available.`;
  }
  return result;
}
