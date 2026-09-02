import { db } from '../db.js';
import { estimateFps } from './fps.js';

// Game Library Scanner engine.
//
// "Based on your games, this is the best build for you."
//
// Honest approach: the recommendation is driven by the measured-benchmark FPS
// model, not by taste or AI vibes. For every catalog GPU we estimate the FPS
// for each of the user's games at their chosen resolution/quality (anchored to
// the reference test CPU). We then pick the cheapest GPU that keeps EVERY
// selected game at or above the target FPS, and the cheapest CPU that still
// hits that target with that GPU. Remaining parts are filled from the cheapest
// compatible catalog options. Games without measured data are reported as such
// instead of being silently assumed to run fine.

function enabled(table) {
  return db.prepare(`SELECT * FROM ${table} WHERE enabled=1`).all();
}

function fpsFor(game, cpu, gpu, resolution, quality) {
  const r = estimateFps({ gameId: game.id, cpuId: cpu.id, gpuId: gpu.id, resolution, quality });
  return r.avgFps != null ? r.avgFps : null;
}

export function recommendLibrary({ gameIds, resolution = '1080p', quality = 'Ultra', targetFps = 60 }) {
  const games = (gameIds || [])
    .map((id) => db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(Number(id)))
    .filter(Boolean);
  if (!games.length) return { status: 'error', message: 'Select at least one game.' };
  const ids = games.map((g) => g.id);
  if (games.length > 20) return { status: 'error', message: 'Select up to 20 games.' };

  const target = Number(targetFps) || 60;
  const cpus = enabled('cpus');
  const gpus = enabled('gpus');
  if (!cpus.length || !gpus.length) return { status: 'error', message: 'The hardware catalog is empty.' };

  const referenceCpu = [...cpus].sort((a, b) => b.performance_index - a.performance_index)[0];
  const q = quality || 'Ultra';
  const res = resolution || '1080p';

  // ---- Step 1: cheapest GPU that keeps every MEASURED game at/above target ----
  // Games with no measured data anywhere are not counted (they are reported
  // honestly); we never let them silently force a more expensive part.
  const gpuScores = gpus.map((gpu) => {
    const perGame = games.map((g) => ({ game: g, fps: fpsFor(g, referenceCpu, gpu, res, q) }));
    const measured = perGame.filter((p) => p.fps != null);
    return {
      gpu,
      perGame,
      coverage: measured.length,
      minFps: measured.length ? Math.min(...measured.map((p) => p.fps)) : null,
    };
  });

  const maxCoverage = Math.max(...gpuScores.map((s) => s.coverage));
  let gpuPick = null;
  if (maxCoverage > 0) {
    // cheapest GPU covering every measured game at/above the target
    const hits = gpuScores.filter((s) => s.coverage === maxCoverage && s.minFps >= target);
    gpuPick = (hits.length ? hits : gpuScores.filter((s) => s.coverage === maxCoverage))
      .sort((a, b) => (hits.length ? a.gpu.price_usd - b.gpu.price_usd : (b.minFps || 0) - (a.minFps || 0)))[0];
  }
  if (!gpuPick) gpuPick = gpuScores.slice().sort((a, b) => (b.minFps || 0) - (a.minFps || 0))[0];
  const chosenGpu = gpuPick.gpu;

  // ---- Step 2: cheapest CPU that keeps the target with that GPU ----
  // judged against the same measured games only.
  const measuredGames = gpuPick.perGame.filter((p) => p.fps != null).map((p) => p.game);
  let cpuPick = null;
  if (measuredGames.length) {
    const cpuOrder = cpus.slice().sort((a, b) => a.price_usd - b.price_usd);
    for (const cpu of cpuOrder) {
      const fps = measuredGames.map((g) => fpsFor(g, cpu, chosenGpu, res, q));
      if (fps.every((v) => v != null && v >= target)) { cpuPick = cpu; break; }
    }
  }
  if (!cpuPick) cpuPick = cpus.slice().sort((a, b) => b.performance_index - a.performance_index)[0];
  const chosenCpu = cpuPick;

  // ---- Step 3: fill the rest with the cheapest compatible parts ----
  const boards = enabled('motherboards')
    .filter((m) => m.socket === chosenCpu.socket && ['ATX', 'microATX', 'mini-ITX'].includes(m.form_factor))
    .sort((a, b) => a.price_usd - b.price_usd);
  const wantDdr5 = boards.some((b) => b.ram_type === 'DDR5');
  const mb = boards.filter((b) => b.ram_type === (wantDdr5 ? 'DDR5' : 'DDR4'))[0] || boards[0] || null;

  const memRows = enabled('memory_modules')
    .filter((r) => !mb || r.type === mb.ram_type)
    .filter((r) => r.capacity_gb >= 32)
    .sort((a, b) => a.price_usd - b.price_usd);
  const ram = memRows[0] || enabled('memory_modules').slice().sort((a, b) => b.capacity_gb - a.capacity_gb)[0] || null;

  const reqRows = ids.map((gid) => db.prepare('SELECT min_storage_gb FROM game_requirements WHERE game_id=?').get(gid)).filter(Boolean);
  const needGb = Math.max(1000, ...reqRows.map((r) => Number(r.min_storage_gb) || 0));
  const storage = enabled('storage')
    .filter((s) => s.capacity_gb >= needGb)
    .sort((a, b) => a.price_usd - b.price_usd)[0]
    || enabled('storage').sort((a, b) => b.capacity_gb - a.capacity_gb)[0] || null;

  const drawW = (chosenCpu.tdp_watts || 0) + (chosenGpu.tdp_watts || 0) + 150;
  const psu = enabled('psus').filter((p) => p.wattage >= drawW && p.wattage <= drawW + 350)
    .sort((a, b) => a.price_usd - b.price_usd)[0]
    || enabled('psus').sort((a, b) => a.wattage - b.wattage)[0] || null;

  const pcCase = (mb ? enabled('cases').filter((c) => {
    let ff = [];
    try { ff = JSON.parse(c.form_factors); } catch { /* ignore */ }
    return ff.includes(mb.form_factor) && (!chosenGpu.length_mm || c.max_gpu_length_mm >= chosenGpu.length_mm);
  }).sort((a, b) => a.price_usd - b.price_usd)[0] : null)
    || enabled('cases').sort((a, b) => a.price_usd - b.price_usd)[0] || null;

  const cooler = enabled('coolers').filter((c) => {
    let sockets = [];
    try { sockets = JSON.parse(c.socket_support); } catch { /* ignore */ }
    return sockets.includes(chosenCpu.socket);
  }).sort((a, b) => a.price_usd - b.price_usd)[0] || enabled('coolers')[0] || null;

  const parts = { cpu: chosenCpu, gpu: chosenGpu, motherboard: mb, ram, storage, psu, case: pcCase, cooler };
  const total = Object.values(parts).reduce((s, p) => s + (p && Number(p.price_usd) || 0), 0);
  const config = {
    cpu: chosenCpu.id, gpu: chosenGpu.id,
    motherboard: mb ? mb.id : null, ram: ram ? ram.id : null, storage: storage ? storage.id : null,
    psu: psu ? psu.id : null, case: pcCase ? pcCase.id : null, cooler: cooler ? cooler.id : null,
  };

  // ---- Final per-game FPS with the actual chosen CPU+GPU ----
  const perGame = games.map((g) => {
    const est = estimateFps({ gameId: g.id, cpuId: chosenCpu.id, gpuId: chosenGpu.id, resolution: res, quality: q });
    return {
      game: { id: g.id, name: g.name },
      fps: est.avgFps,
      status: est.status === 'unavailable' || est.avgFps == null ? 'no_data' : (est.status === 'verified' ? 'verified' : 'estimated'),
      meetsTarget: est.avgFps != null && est.avgFps >= target,
      message: est.message,
    };
  });

  const unmet = perGame.filter((p) => p.status !== 'no_data' && !p.meetsTarget);
  const noData = perGame.filter((p) => p.status === 'no_data');
  const verdict = noData.length === games.length
    ? 'no_data'
    : unmet.length === 0 && noData.length === 0
      ? 'all_covered'
      : unmet.length === 0 ? 'all_measured_covered' : 'some_unmet';
  const message = noData.length === games.length
    ? 'None of the selected games have measured benchmark data. Recommendation is disabled — no guesses are made.'
    : noData.length
      ? `${noData.length} game(s) have no measured benchmark data for this configuration and are not counted in the guarantee.`
      : (unmet.length ? `${unmet.length} game(s) are projected below ${target} FPS — see details.` : `Every game reaches at least ${target} FPS at ${res} (${q}).`);

  // No measured data at all: refuse to invent a recommendation.
  if (verdict === 'no_data') {
    return {
      status: 'ok',
      label: 'Estimated from measured benchmarks',
      evidenceType: 'estimated',
      verdict,
      message,
      recommendation: null,
      parts: null,
      totalPrice: null,
      config: null,
      target: { fps: target, resolution: res, quality: q },
      perGame,
      coverage: { games: games.length, measured: 0, unmet: [] },
      honest: 'Recommendation is driven by measured-benchmark estimates only. Games without measurements are flagged, never assumed.',
    };
  }

  return {
    status: 'ok',
    label: 'Estimated from measured benchmarks',
    evidenceType: 'estimated',
    verdict,
    message,
    config,
    recommendation: {
      cpu: { id: chosenCpu.id, name: chosenCpu.name, price: chosenCpu.price_usd },
      gpu: { id: chosenGpu.id, name: chosenGpu.name, price: chosenGpu.price_usd },
    },
    parts: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p ? { id: p.id, name: p.name, price_usd: p.price_usd } : null])),
    totalPrice: Math.round(total),
    target: { fps: target, resolution: res, quality: q },
    perGame,
    coverage: { games: games.length, measured: games.length - noData.length, unmet: unmet.map((p) => p.game.name) },
    honest: 'Recommendation is driven by measured-benchmark estimates only. Games without measurements are flagged, never assumed.',
  };
}
