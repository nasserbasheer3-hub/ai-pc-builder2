import { db } from '../db.js';

// "Can I run this game?" engine.
//
// Two independent, honest signals are combined:
//
// 1. OFFICIAL REQUIREMENTS — the publisher's minimum / recommended hardware
//    (CPU, GPU, VRAM, RAM, storage, OS) stored in game_requirements with its
//    source URL. Numeric columns (VRAM, RAM, storage) are compared directly
//    against the real, catalog-verified values of the user's parts.
//
// 2. MEASURED BENCHMARKS — real FPS measurements from the benchmarks table.
//    The estimate uses a documented weakest-link model over two real anchors:
//    - GPU anchor: the benchmark with the weakest GPU (GPU-limited point).
//      fpsGpu = gpuAnchor.avg_fps × (userGpuIndex / gpuAnchor.gpuIndex)
//    - CPU anchor: the benchmark with the highest average FPS (the CPU ceiling
//      for the game, where even the strongest GPU does not go higher).
//      fpsCpu = cpuAnchor.avg_fps × (userCpuIndex / cpuAnchor.cpuIndex)
//    - estimate = min(fpsGpu, fpsCpu)
//    When only one benchmark exists the model falls back to GPU scaling alone
//    and honestly reports that the CPU ceiling is not measured.
//
// All indices come from the TechPowerUp relative-performance databases used
// across the catalog. The estimate is labeled, never presented as a measurement.

const DEFAULT_TARGET = 60;

function sourceName(id) {
  if (!id) return null;
  const r = db.prepare('SELECT name FROM data_sources WHERE id=?').get(id);
  return r ? r.name : null;
}

function anchorGroup(gameId, resolution, quality) {
  const res = resolution || '1080p';
  const q = quality || 'Ultra';
  let rows = db.prepare('SELECT * FROM benchmarks WHERE game_id=? AND resolution=? AND quality=?').all(gameId, res, q);
  let match = 'exact';
  if (!rows.length) {
    rows = db.prepare('SELECT * FROM benchmarks WHERE game_id=? AND resolution=?').all(gameId, res);
    match = 'resolution';
  }
  if (!rows.length) {
    rows = db.prepare('SELECT * FROM benchmarks WHERE game_id=?').all(gameId);
    match = 'any';
  }
  return { rows, match };
}

export function checkGame({ gameId, cpuId, gpuId, ramId, storageId, resolution, quality, targetFps }) {
  const game = db.prepare('SELECT id, name, slug FROM games WHERE id=? AND enabled=1').get(gameId);
  if (!game) return { status: 'unavailable', message: 'Game not found.' };
  const gpu = gpuId ? db.prepare('SELECT id, name, vram_gb, performance_index, source_id FROM gpus WHERE id=? AND enabled=1').get(gpuId) : null;
  const cpu = cpuId ? db.prepare('SELECT id, name, performance_index, source_id FROM cpus WHERE id=? AND enabled=1').get(cpuId) : null;
  const ram = ramId ? db.prepare('SELECT id, name, capacity_gb, modules, source_id FROM memory_modules WHERE id=? AND enabled=1').get(ramId) : null;
  const storage = storageId ? db.prepare('SELECT id, name, capacity_gb, source_id FROM storage WHERE id=? AND enabled=1').get(storageId) : null;

  if (!gpu) return { status: 'unavailable', message: 'Select a GPU to check this game.' };

  const req = db.prepare('SELECT * FROM game_requirements WHERE game_id=?').get(gameId);
  const res = resolution || '1080p';
  const q = quality || 'Ultra';
  const target = Number(targetFps) || DEFAULT_TARGET;

  const totalRamGb = ram ? Number(ram.capacity_gb) : null;
  const storageGb = storage ? Number(storage.capacity_gb) : null;

  // --- Component checks against official requirements ---
  const checks = [];
  const push = (category, status, label, detail) => checks.push({ category, status, label, detail });

  if (req && req.min_vram_gb != null && gpu) {
    if (gpu.vram_gb < req.min_vram_gb) {
      push('vram', 'error', `${gpu.vram_gb}GB VRAM`, `Official minimum requires ${req.min_vram_gb}GB (recommended ${req.rec_vram_gb}GB).`);
    } else if (req.rec_vram_gb != null && gpu.vram_gb < req.rec_vram_gb) {
      push('vram', 'warn', `${gpu.vram_gb}GB VRAM`, `Meets the ${req.min_vram_gb}GB minimum but below the ${req.rec_vram_gb}GB recommended.`);
    } else {
      push('vram', 'ok', `${gpu.vram_gb}GB VRAM`, `At or above the recommended ${req.rec_vram_gb}GB.`);
    }
  }

  if (req && req.min_ram_gb != null) {
    if (totalRamGb == null) {
      push('ram', 'info', 'Memory not selected', `Official minimum is ${req.min_ram_gb}GB RAM.`);
    } else if (totalRamGb < req.min_ram_gb) {
      push('ram', 'error', `${totalRamGb}GB RAM`, `Official minimum requires ${req.min_ram_gb}GB (recommended ${req.rec_ram_gb}GB).`);
    } else if (totalRamGb < req.rec_ram_gb) {
      push('ram', 'warn', `${totalRamGb}GB RAM`, `Meets the ${req.min_ram_gb}GB minimum but below the ${req.rec_ram_gb}GB recommended.`);
    } else {
      push('ram', 'ok', `${totalRamGb}GB RAM`, `At or above the recommended ${req.rec_ram_gb}GB.`);
    }
  }

  if (req && req.min_storage_gb != null) {
    if (storageGb == null) {
      push('storage', 'info', 'Storage not selected', `Official minimum is ${req.min_storage_gb}GB free space.`);
    } else if (storageGb < req.min_storage_gb) {
      push('storage', 'error', `${storageGb}GB storage`, `Official minimum requires ${req.min_storage_gb}GB free (recommended ${req.rec_storage_gb}GB).`);
    } else if (storageGb < req.rec_storage_gb) {
      push('storage', 'warn', `${storageGb}GB storage`, `Meets the ${req.min_storage_gb}GB minimum but below the ${req.rec_storage_gb}GB recommended.`);
    } else {
      push('storage', 'ok', `${storageGb}GB storage`, `At or above the recommended ${req.rec_storage_gb}GB.`);
    }
  }

  // --- FPS estimate from measured benchmarks ---
  const { rows, match } = anchorGroup(gameId, res, q);
  let fps = null;
  let fps1Low = null;
  let anchorInfo = null;
  let fpsScale = 'none';

  if (rows.length) {
    const gpuIdxOf = new Map();
    for (const r of rows) {
      if (!gpuIdxOf.has(r.gpu_id)) {
        gpuIdxOf.set(r.gpu_id, db.prepare('SELECT performance_index FROM gpus WHERE id=?').get(r.gpu_id)?.performance_index ?? 0);
      }
    }
    const cpuIdxOf = new Map();
    for (const r of rows) {
      if (r.cpu_id && !cpuIdxOf.has(r.cpu_id)) {
        cpuIdxOf.set(r.cpu_id, db.prepare('SELECT performance_index FROM cpus WHERE id=?').get(r.cpu_id)?.performance_index ?? 0);
      }
    }
    const gpuAnchor = [...rows].sort((a, b) => gpuIdxOf.get(a.gpu_id) - gpuIdxOf.get(b.gpu_id))[0];
    const gpuAnchorIdx = gpuIdxOf.get(gpuAnchor.gpu_id);
    const gpuAnchorName = db.prepare('SELECT name FROM gpus WHERE id=?').get(gpuAnchor.gpu_id)?.name;

    const cpuAnchor = [...rows].sort((a, b) => b.avg_fps - a.avg_fps)[0];
    const cpuAnchorIdx = cpuAnchor.cpu_id ? cpuIdxOf.get(cpuAnchor.cpu_id) : null;
    const cpuAnchorName = cpuAnchor.cpu_id ? db.prepare('SELECT name FROM cpus WHERE id=?').get(cpuAnchor.cpu_id)?.name : null;

    const userGpuIdx = Number(gpu.performance_index) || 0;
    let fpsGpu = null;
    let fpsCpu = null;
    if (gpuAnchorIdx) fpsGpu = Number(gpuAnchor.avg_fps) * (userGpuIdx / gpuAnchorIdx);
    if (cpu && cpuAnchorIdx) fpsCpu = Number(cpuAnchor.avg_fps) * (Number(cpu.performance_index) / cpuAnchorIdx);

    if (fpsGpu != null && fpsCpu != null) {
      fps = Math.min(fpsGpu, fpsCpu);
      fpsScale = 'gpu+cpu';
    } else if (fpsGpu != null) {
      fps = fpsGpu;
      fpsScale = 'gpu';
    }

    if (fps != null) {
      fps1Low = Number(gpuAnchor.pct1_low || gpuAnchor.avg_fps) * (fps / Number(gpuAnchor.avg_fps) || 1);
      anchorInfo = {
        gpu: { id: gpuAnchor.gpu_id, name: gpuAnchorName, index: gpuAnchorIdx, avgFps: Number(gpuAnchor.avg_fps) },
        cpu: cpuAnchor.cpu_id ? { id: cpuAnchor.cpu_id, name: cpuAnchorName, index: cpuAnchorIdx, avgFps: Number(cpuAnchor.avg_fps) } : null,
        match,
      };
    }
  }

  fps = fps != null ? Math.round(fps) : null;
  fps1Low = fps1Low != null ? Math.round(fps1Low) : null;

  const anyError = checks.some((c) => c.status === 'error');
  const anyWarn = checks.some((c) => c.status === 'warn');
  const meetsTarget = fps != null && fps >= target;

  let verdict;
  let verdictKey;
  if (anyError) {
    verdict = 'below_minimum';
    verdictKey = 'below minimum — official requirements not fully met.';
  } else if (fps == null) {
    verdict = 'unverified';
    verdictKey = 'no measured benchmarks available for this game; official requirements are shown for reference.';
  } else if (anyWarn) {
    verdict = 'meets_minimum';
    verdictKey = 'meets the official minimum but not the recommended hardware.';
  } else if (meetsTarget) {
    verdict = 'meets_recommended';
    verdictKey = 'meets or exceeds the recommended hardware and the target frame rate.';
  } else {
    verdict = 'meets_minimum';
    verdictKey = 'meets official minimum, but the estimated frame rate is below the target.';
  }

  const sources = [...new Set([req?.source_url, sourceName(gpu.source_id), cpu ? sourceName(cpu.source_id) : null, sourceName(ram?.source_id), sourceName(storage?.source_id)].filter(Boolean))];

  return {
    status: 'estimated',
    label: 'Estimated',
    game: { id: game.id, name: game.name },
    verdict,
    verdictKey,
    fps,
    fps1Low,
    target,
    meetsTarget,
    fpsScale,
    anchor: anchorInfo,
    anchorMatchNote: match !== 'exact' ? `Anchored on ${match === 'resolution' ? 'the same resolution across quality presets' : 'all measured presets'} for this game.` : null,
    checks,
    requirements: req ? {
      min: { cpu: req.min_cpu, gpu: req.min_gpu, vramGb: req.min_vram_gb, ramGb: req.min_ram_gb, storageGb: req.min_storage_gb, os: req.min_os },
      rec: { cpu: req.rec_cpu, gpu: req.rec_gpu, vramGb: req.rec_vram_gb, ramGb: req.rec_ram_gb, storageGb: req.rec_storage_gb, os: req.rec_os },
      sourceUrl: req.source_url,
      notes: req.notes,
    } : null,
    parts: {
      gpu: gpu ? { id: gpu.id, name: gpu.name, vramGb: gpu.vram_gb, index: Number(gpu.performance_index) } : null,
      cpu: cpu ? { id: cpu.id, name: cpu.name, index: Number(cpu.performance_index) } : null,
      ram: totalRamGb != null ? { totalGb: totalRamGb, kit: ram.name } : null,
      storage: storageGb != null ? { capacityGb: storageGb, name: storage.name } : null,
    },
    config: { resolution: res, quality: q, targetFps: target },
    sources,
    disclaimer: 'FPS is an estimate from measured benchmarks using a documented weakest-link model. Official requirements come from the publisher\'s own pages. Real performance varies with drivers, thermals and system configuration.',
  };
}
