import { db } from '../db.js';

// CPU-GPU bottleneck estimate.
//
// Inputs are the TechPowerUp "Relative Performance" indices stored in the
// hardware catalog (data_sources 1 & 2). The model converts a GPU's relative
// performance into the CPU relative-performance index required to feed it at a
// given resolution and quality preset, then compares that against the chosen
// CPU. This is an ESTIMATE — real-world bottleneck depends on the specific
// game, RAM, cooling, drivers and workload.
//
// Model parameters (documented, not tuned to game data):
//   K = 3.2  calibration: an RTX 4090 (index 320) needs ~CPU index 100
//            (i9-13900K / Ryzen 7 9800X3D tier) at 1080p Ultra — the pairing
//            most reviewers call "balanced" at 1080p.
//   resolutionScale = same ratios as the FPS engine: 1080p 1.0, 1440p 0.75, 4K 0.6
//            (higher resolution lowers the GPU frame rate, so less CPU is needed).
//   qualityFactor  = same ratios as the FPS engine: Low 1.55, Medium 1.3,
//            High 1.1, Ultra 1.0, Epic 1.0 (lower quality raises the GPU frame
//            rate, so more CPU is needed).
//
// effectiveGpuIndex = gpuIndex * resolutionScale[res] * qualityFactor[quality]
// requiredCpuIndex  = effectiveGpuIndex / K
//   cpuIndex <  requiredCpuIndex  -> CPU-limited (GPU under-used)
//   cpuIndex >= requiredCpuIndex  -> GPU-limited (CPU has headroom)

export const BOTTLENECK_MODEL = {
  K: 3.2,
  resolutionScale: { '1080p': 1.0, '1440p': 0.75, '4K': 0.6 },
  qualityFactor: { Low: 1.55, Medium: 1.3, High: 1.1, Ultra: 1.0, Epic: 1.0 },
  levels: [
    { max: 5, label: 'balanced' },
    { max: 15, label: 'minor' },
    { max: 30, label: 'moderate' },
    { max: 50, label: 'severe' },
    { max: Infinity, label: 'extreme' },
  ],
};

export function levelOf(pct) {
  for (const lv of BOTTLENECK_MODEL.levels) {
    if (pct <= lv.max) return lv.label;
  }
  return 'extreme';
}

export function estimateBottleneck({ cpuId, gpuId, resolution = '1080p', quality = 'Ultra' }) {
  const cpu = db.prepare('SELECT id, name, performance_index, cores, threads, base_clock_ghz, boost_clock_ghz, source_id FROM cpus WHERE id=? AND enabled=1').get(cpuId);
  const gpu = db.prepare('SELECT id, name, performance_index, vram_gb, tdp_watts, source_id FROM gpus WHERE id=? AND enabled=1').get(gpuId);
  if (!cpu || !gpu) return { status: 'unavailable', message: 'Not enough verified data available for this configuration.' };

  const res = BOTTLENECK_MODEL.resolutionScale[resolution] != null ? resolution : '1080p';
  const q = BOTTLENECK_MODEL.qualityFactor[quality] != null ? quality : 'Ultra';

  const cpuIdx = Number(cpu.performance_index) || 0;
  const gpuIdx = Number(gpu.performance_index) || 0;

  const effectiveGpu = gpuIdx * BOTTLENECK_MODEL.resolutionScale[res] * BOTTLENECK_MODEL.qualityFactor[q];
  const requiredCpu = effectiveGpu / BOTTLENECK_MODEL.K;

  let direction;
  let pct;
  if (cpuIdx < requiredCpu) {
    direction = 'cpu';
    pct = requiredCpu > 0 ? ((requiredCpu - cpuIdx) / requiredCpu) * 100 : 0;
  } else {
    direction = 'gpu';
    pct = cpuIdx > 0 ? ((cpuIdx - requiredCpu) / cpuIdx) * 100 : 0;
  }
  pct = Math.max(0, Math.min(99, Math.round(pct)));
  if (pct < 5) direction = 'balanced';

  const cpuLoad = cpuIdx > 0 ? Math.min(100, Math.round((requiredCpu / cpuIdx) * 100)) : 100;
  const gpuLoad = requiredCpu > 0 ? Math.min(100, Math.round((cpuIdx / requiredCpu) * 100)) : 100;

  const sourceNames = {
    cpu: cpu.source_id ? (db.prepare('SELECT name FROM data_sources WHERE id=?').get(cpu.source_id) || {}).name : null,
    gpu: gpu.source_id ? (db.prepare('SELECT name FROM data_sources WHERE id=?').get(gpu.source_id) || {}).name : null,
  };

  return {
    status: 'estimated',
    label: 'Estimated',
    direction,
    pct,
    level: levelOf(pct),
    cpuLoad,
    gpuLoad,
    requiredCpu: Math.round(requiredCpu * 10) / 10,
    cpu: { id: cpu.id, name: cpu.name, index: cpuIdx, cores: cpu.cores, threads: cpu.threads, boost: cpu.boost_clock_ghz, source: sourceNames.cpu },
    gpu: { id: gpu.id, name: gpu.name, index: gpuIdx, vram: gpu.vram_gb, tdp: gpu.tdp_watts, source: sourceNames.gpu },
    config: { resolution: res, quality: q },
    model: {
      K: BOTTLENECK_MODEL.K,
      resolutionScale: BOTTLENECK_MODEL.resolutionScale,
      qualityFactor: BOTTLENECK_MODEL.qualityFactor,
      effectiveGpuIndex: Math.round(effectiveGpu * 10) / 10,
      formula: 'requiredCpu = gpuIndex × resolutionScale[res] × qualityFactor[quality] ÷ K',
    },
    disclaimer: 'Estimate based on relative performance indices and a documented model. Real bottleneck depends on the specific game, settings, RAM, cooling and workload.',
  };
}
