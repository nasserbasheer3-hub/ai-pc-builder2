import { db } from '../db.js';
import { estimateFps } from './fps.js';

export function upgradeAdvice(input) {
  const { current = {}, targetGames = [], resolution = '1080p', targetFps = 60, currency = 'USD' } = input;
  const { cpu_id, gpu_id, ram_id, storage_id, psu_id } = current;

  const gpu = gpu_id ? db.prepare('SELECT * FROM gpus WHERE id=? AND enabled=1').get(gpu_id) : null;
  const cpu = cpu_id ? db.prepare('SELECT * FROM cpus WHERE id=? AND enabled=1').get(cpu_id) : null;

  if (!gpu && !cpu) {
    return { status: 'error', message: 'Provide at least your current GPU or CPU to run an upgrade analysis.' };
  }
  if (!targetGames.length) {
    return { status: 'error', message: 'Select at least one target game.' };
  }

  const priceCol = (r) => (currency === 'EUR' && r.price_eur != null ? r.price_eur : currency === 'GBP' && r.price_gbp != null ? r.price_gbp : r.price_usd);

  const games = targetGames.map((id) => db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(id)).filter(Boolean);
  const perGame = games.map((g) => {
    const est = gpu ? estimateFps({ gameId: g.id, cpuId: cpu?.id, gpuId: gpu.id, resolution, quality: 'Ultra' }) : { status: 'unavailable', avgFps: null, label: null };
    return {
      game: g.name,
      currentFps: est.avgFps,
      status: est.status,
      label: est.label,
      message: est.message,
      meetsTarget: est.avgFps != null ? est.avgFps >= targetFps : null,
    };
  });

  const recommendations = [];
  const evidence = [];

  // GPU upgrade need
  if (gpu) {
    const needing = perGame.filter((p) => p.status !== 'unavailable' && p.meetsTarget === false);
    if (needing.length > 0) {
      const worst = needing.sort((a, b) => (a.currentFps || 0) - (b.currentFps || 0))[0];
      const neededIdx = Math.ceil((gpu.performance_index * targetFps) / worst.currentFps);
      evidence.push({
        text: `${worst.game}: current ~${worst.currentFps} FPS vs target ${targetFps}. A GPU with a relative index of ~${neededIdx} (vs ${gpu.performance_index} now) would be required.`,
        confidence: 'estimated',
      });
      const candidates = db.prepare('SELECT * FROM gpus WHERE enabled=1 AND performance_index >= ? AND id != ? ORDER BY price_usd').all(neededIdx, gpu.id);
      if (candidates.length) {
        const pick = candidates[0];
        const newEst = estimateFps({ gameId: worst.game && db.prepare('SELECT id FROM games WHERE name=?').get(worst.game).id, cpuId: cpu?.id, gpuId: pick.id, resolution, quality: 'Ultra' });
        recommendations.push({
          type: 'gpu',
          component: pick.name,
          price: priceCol(pick),
          currency,
          expectedGain: newEst.avgFps ? `${worst.currentFps} → ~${newEst.avgFps} FPS in ${worst.game}` : null,
          rationale: `Current GPU (${gpu.name}, index ${gpu.performance_index}) cannot reach ${targetFps} FPS in ${worst.game}. ${pick.name} (index ${pick.performance_index}) is the cheapest verified upgrade that meets the requirement.`,
          confidence: 'estimated',
        });
      }
    } else if (perGame.some((p) => p.meetsTarget === true)) {
      recommendations.push({
        type: 'gpu',
        component: 'Keep current GPU',
        price: 0,
        currency,
        expectedGain: null,
        rationale: `Your ${gpu.name} already meets the ${targetFps} FPS target at ${resolution} in the selected games. No GPU upgrade is justified by this data.`,
        confidence: 'verified',
      });
    }
  }

  // CPU check for high-refresh / esports titles
  if (cpu) {
    const highRefresh = targetFps >= 144;
    if (highRefresh && cpu.performance_index < 75) {
      const candidates = db.prepare(`SELECT * FROM cpus WHERE enabled=1 AND socket = ? AND performance_index > ? AND performance_index < 130 ORDER BY performance_index DESC`).all(cpu.socket, cpu.performance_index);
      if (candidates.length) {
        const pick = candidates[0];
        recommendations.push({
          type: 'cpu',
          component: pick.name,
          price: priceCol(pick),
          currency,
          expectedGain: `Higher frame-rate ceilings in CPU-bound titles (${Math.round(((pick.performance_index - cpu.performance_index) / cpu.performance_index) * 100)}% faster index)`,
          rationale: `Targeting ${targetFps} FPS at high refresh. ${cpu.name} (index ${cpu.performance_index}) can limit frame-rate ceilings in CPU-bound titles. ${pick.name} is the strongest verified drop-in for the ${cpu.socket} socket.`,
          confidence: 'estimated',
        });
      }
    } else if (highRefresh && cpu.performance_index >= 75) {
      evidence.push({ text: `CPU (${cpu.name}, index ${cpu.performance_index}) is strong enough that we do not identify it as a bottleneck at ${targetFps} FPS.`, confidence: 'verified' });
    }
  }

  // RAM / storage / monitor notes only when we have evidence
  if (ram_id) {
    const ram = db.prepare('SELECT * FROM memory_modules WHERE id=?').get(ram_id);
    if (ram && ram.capacity_gb < 16) {
      recommendations.push({ type: 'ram', component: 'Upgrade RAM to 32GB', price: 79, currency, expectedGain: 'Removes stutter in memory-heavy titles', rationale: `Only ${ram.capacity_gb}GB RAM detected; modern titles benefit from 16–32GB.`, confidence: 'estimated' });
    }
  } else {
    recommendations.push({ type: 'ram', component: 'Add at least 16GB (dual-channel) RAM', price: null, currency, expectedGain: null, rationale: 'No RAM specified; dual-channel memory is required for consistent FPS.', confidence: 'user' });
  }

  const gpuRec = recommendations.find((r) => r.type === 'gpu');
  const summary = gpuRec && gpuRec.component !== 'Keep current GPU'
    ? `Recommended upgrade: ${gpuRec.component} (est. ${gpuRec.price} ${currency}). ${gpuRec.rationale}`
    : perGame.length && perGame.every((p) => p.status === 'unavailable')
      ? 'Not enough verified data available to compute an upgrade path for these games.'
      : 'Your current system meets the target; no high-value upgrade was identified from verified data.';

  return {
    status: 'ready',
    current: {
      gpu: gpu ? { id: gpu.id, name: gpu.name, index: gpu.performance_index } : null,
      cpu: cpu ? { id: cpu.id, name: cpu.name, index: cpu.performance_index } : null,
    },
    perGame,
    recommendations,
    evidence,
    summary,
    label: 'Estimated',
    generatedAt: new Date().toISOString(),
  };
}
