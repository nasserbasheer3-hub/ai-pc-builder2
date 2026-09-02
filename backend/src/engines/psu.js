import { db } from '../db.js';

// PSU (power supply) sizing calculator.
//
// The estimate follows the ATX12V PSU sizing approach used by every major PSU
// vendor calculator (Corsair, Seasonic, be quiet!): sum the REAL TDP values of
// the CPU and GPU from the hardware catalog, add documented typical power draws
// for the rest of the system, then apply a headroom factor for transient spikes.
//
// Documented constants (typical values, source: ATX12V / PSU vendor calculators):
//   motherboard  = 50W  typical desktop platform draw
//   memory       =  5W  per DIMM (DDR4/DDR5 typical)
//   storage      =  7W  per drive (M.2 NVMe / SATA typical)
//   air cooler   =  5W  tower cooler fans + pump-less heatsink
//   AIO cooler   = 10W  pump + radiator fans
//   case fan     =  3W  per fan
//   headroom     = 30%  transient-spike headroom (ATX12V guidance)
//
// Recommended wattage = ceil(baseDraw * 1.3 / 50) * 50
// This is an ESTIMATE. Real draw depends on overclocks, loads and firmware.

export const PSU_MODEL = {
  motherboardW: 50,
  ramPerModuleW: 5,
  storagePerDriveW: 7,
  airCoolerW: 5,
  aioCoolerW: 10,
  caseFanW: 3,
  headroomFactor: 1.3,
  roundTo: 50,
};

function sourcesName(ids) {
  const names = new Set();
  for (const id of new Set(ids.filter(Boolean))) {
    const r = db.prepare('SELECT name FROM data_sources WHERE id=?').get(id);
    if (r) names.add(r.name);
  }
  return [...names];
}

export function estimatePsu({ cpuId, gpuId, ramId, ramModules, storageId, coolerId, caseFans, psuId }) {
  const parts = [];
  const sourceIds = [];

  const cpu = cpuId ? db.prepare('SELECT id, name, tdp_watts, source_id FROM cpus WHERE id=? AND enabled=1').get(cpuId) : null;
  const gpu = gpuId ? db.prepare('SELECT id, name, tdp_watts, source_id FROM gpus WHERE id=? AND enabled=1').get(gpuId) : null;
  const ram = ramId ? db.prepare('SELECT id, name, modules, source_id FROM memory_modules WHERE id=? AND enabled=1').get(ramId) : null;
  const storage = storageId ? db.prepare('SELECT id, name, source_id FROM storage WHERE id=? AND enabled=1').get(storageId) : null;
  const cooler = coolerId ? db.prepare('SELECT id, name, type, source_id FROM coolers WHERE id=? AND enabled=1').get(coolerId) : null;

  if (!cpu && !gpu) {
    return { status: 'unavailable', message: 'Select at least a CPU or a GPU to estimate system draw.' };
  }
  if (cpu) {
    sourceIds.push(cpu.source_id);
    parts.push({ key: 'cpu', name: `${cpu.name} (TDP)`, watts: Number(cpu.tdp_watts) || 0, source: 'TDP as specified by the manufacturer' });
  }
  if (gpu) {
    sourceIds.push(gpu.source_id);
    parts.push({ key: 'gpu', name: `${gpu.name} (TDP)`, watts: Number(gpu.tdp_watts) || 0, source: 'TDP as specified by the manufacturer' });
  }
  parts.push({ key: 'motherboard', name: 'Motherboard + peripherals', watts: PSU_MODEL.motherboardW, source: 'Typical ATX platform draw (documented constant)' });

  let modules = 0;
  if (ram) {
    sourceIds.push(ram.source_id);
    modules = ramModules != null ? Number(ramModules) : Number(ram.modules) || 1;
    parts.push({ key: 'ram', name: `${ram.name} × ${modules} DIMM`, watts: PSU_MODEL.ramPerModuleW * modules, source: 'Typical per-DIMM draw (documented constant)' });
  } else if (ramModules > 0) {
    modules = Number(ramModules);
    parts.push({ key: 'ram', name: `Memory × ${modules} DIMM`, watts: PSU_MODEL.ramPerModuleW * modules, source: 'Typical per-DIMM draw (documented constant)' });
  }

  if (storage) {
    sourceIds.push(storage.source_id);
    parts.push({ key: 'storage', name: storage.name, watts: PSU_MODEL.storagePerDriveW, source: 'Typical per-drive draw (documented constant)' });
  }
  if (cooler) {
    sourceIds.push(cooler.source_id);
    const coolerW = cooler.type === 'aio' ? PSU_MODEL.aioCoolerW : PSU_MODEL.airCoolerW;
    parts.push({ key: 'cooler', name: `${cooler.name} (${cooler.type === 'aio' ? 'AIO' : 'air'})`, watts: coolerW, source: cooler.type === 'aio' ? 'Typical AIO pump + fans (documented constant)' : 'Typical air cooler (documented constant)' });
  }
  const fans = Math.max(0, Number(caseFans) || 0);
  if (fans > 0) {
    parts.push({ key: 'fans', name: `Case fans × ${fans}`, watts: PSU_MODEL.caseFanW * fans, source: 'Typical per-fan draw (documented constant)' });
  }

  const baseDraw = parts.reduce((s, p) => s + p.watts, 0);
  const recommendedW = Math.ceil((baseDraw * PSU_MODEL.headroomFactor) / PSU_MODEL.roundTo) * PSU_MODEL.roundTo;

  // Real PSU options from the catalog that cover the recommendation, cheapest first.
  const suggestions = db.prepare('SELECT id, name, brand, wattage, efficiency_rating, modular, has_12vhpwr, price_usd FROM psus WHERE enabled=1 AND wattage >= ? ORDER BY price_usd ASC, wattage ASC').all(recommendedW)
    .map((p) => ({ ...p, price: p.price_usd, priceCurrency: 'USD' }));

  let psu = null;
  let psuVerdict = null;
  if (psuId) {
    psu = db.prepare('SELECT id, name, brand, wattage, efficiency_rating, has_12vhpwr FROM psus WHERE id=? AND enabled=1').get(psuId);
    if (psu) {
      psuVerdict = psu.wattage < baseDraw
        ? { status: 'error', message: `The ${psu.wattage}W PSU cannot even cover the ${baseDraw}W base draw.` }
        : psu.wattage < recommendedW
          ? { status: 'warn', message: `The ${psu.wattage}W PSU covers the ${baseDraw}W base draw but has less than the recommended ${recommendedW}W for transient-spike headroom.` }
          : { status: 'ok', message: `The ${psu.wattage}W PSU covers the recommended ${recommendedW}W.` };
    }
  }

  const maxAvailable = db.prepare('SELECT MAX(wattage) AS m FROM psus WHERE enabled=1').get().m;

  return {
    status: 'estimated',
    label: 'Estimated',
    baseDraw: Math.round(baseDraw),
    recommendedW,
    headroomFactor: PSU_MODEL.headroomFactor,
    headroomW: Math.round(baseDraw * PSU_MODEL.headroomFactor - baseDraw),
    components: parts,
    model: {
      constants: { motherboardW: PSU_MODEL.motherboardW, ramPerModuleW: PSU_MODEL.ramPerModuleW, storagePerDriveW: PSU_MODEL.storagePerDriveW, airCoolerW: PSU_MODEL.airCoolerW, aioCoolerW: PSU_MODEL.aioCoolerW, caseFanW: PSU_MODEL.caseFanW, headroomFactor: PSU_MODEL.headroomFactor },
      formula: 'recommended = ceil((Σ TDP / typical draws) × 1.3 headroom, rounded up to 50W)',
    },
    suggestions,
    maxAvailable,
    psu,
    psuVerdict,
    sources: sourcesName(sourceIds),
    disclaimer: 'Estimate based on manufacturer TDP values and documented typical draws. Real power draw varies with overclocking, load and firmware — treat as a guide, not a measurement.',
  };
}
