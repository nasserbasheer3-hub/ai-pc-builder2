import { db } from '../db.js';
import { clamp } from '../utils/helpers.js';

// Documented estimation model. FPS results are either:
//  - verified: exact match on a stored benchmark row, or
//  - estimated: interpolated from verified anchors using the factors below.
export const MODEL = {
  resolutionScale: { '1080p': 1.0, '1440p': 0.68, '4K': 0.45 },
  qualityFactor: { Low: 1.55, Medium: 1.3, High: 1.1, Ultra: 1.0, Epic: 1.0 },
  rtFactor: 0.5,
  upscalingFactor: { None: 1.0, DLSS: 1.55, FSR: 1.5, XeSS: 1.5, DLSS_Balanced: 1.75 },
  cpuFactorSlope: 0.25,
  cpuFactorClamp: [0.85, 1.15],
};

function findAnchor({ gameId, gpuId, cpuId, resolution, quality, rtEnabled = false, upscaling = 'None' }) {
  const cols = 'id, game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling, avg_fps, pct1_low, source_id, benchmark_date, notes';
  // exact match — prefer an anchor whose rt / upscaling match the requested
  // settings, so truly identical measurements stay "verified".
  let row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND gpu_id=? AND cpu_id=? AND resolution=? AND quality=?
    ORDER BY (rt_enabled = ?) DESC, (COALESCE(upscaling,'None') = ?) DESC, id LIMIT 1`)
    .get(gameId, gpuId, cpuId, resolution, quality, rtEnabled ? 1 : 0, upscaling || 'None');
  if (row) return { row, match: 'exact' };
  // same gpu, game, res, quality, any cpu
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND gpu_id=? AND resolution=? AND quality=? ORDER BY id LIMIT 1`).get(gameId, gpuId, resolution, quality);
  if (row) return { row, match: 'cpu_interpolated' };
  // same gpu, game, quality, any resolution
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND gpu_id=? AND quality=? ORDER BY id LIMIT 1`).get(gameId, gpuId, quality);
  if (row) return { row, match: 'resolution_scaled' };
  // any gpu in game at resolution+quality
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND resolution=? AND quality=? ORDER BY id LIMIT 1`).get(gameId, resolution, quality);
  if (row) return { row, match: 'gpu_interpolated' };
  // same gpu, game, res, any quality
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND gpu_id=? AND resolution=? ORDER BY id LIMIT 1`).get(gameId, gpuId, resolution);
  if (row) return { row, match: 'quality_scaled' };
  // same gpu, game, any res, any quality
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? AND gpu_id=? ORDER BY id LIMIT 1`).get(gameId, gpuId);
  if (row) return { row, match: 'res_quality_scaled' };
  // same game, any gpu, any res, any quality
  row = db.prepare(`SELECT ${cols} FROM benchmarks WHERE game_id=? ORDER BY id LIMIT 1`).get(gameId);
  if (row) return { row, match: 'game_generic' };
  return null;
}

export function estimateFps(input) {
  const { gameId, cpuId, gpuId, resolution, quality, rtEnabled = false, upscaling = 'None' } = input;
  const game = db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(gameId);
  const gpu = db.prepare('SELECT id, name, performance_index FROM gpus WHERE id=? AND enabled=1').get(gpuId);
  if (!game || !gpu) return { status: 'unavailable', message: 'Not enough verified data available for this configuration.', model: MODEL };

  const cpu = cpuId ? db.prepare('SELECT id, name, performance_index FROM cpus WHERE id=? AND enabled=1').get(cpuId) : null;
  const qKey = quality || 'Ultra';
  const anchor = findAnchor({ gameId, gpuId, cpuId, resolution, quality: qKey, rtEnabled, upscaling });

  if (!anchor) {
    // No anchor for this game at all
    const anyGame = db.prepare('SELECT id, game_id, resolution, quality, avg_fps, pct1_low, benchmark_date, notes FROM benchmarks WHERE gpu_id=? AND quality=? ORDER BY id LIMIT 1').get(gpuId, qKey);
    if (!anyGame) {
      return { status: 'unavailable', message: 'Not enough verified data available for this configuration.', model: MODEL };
    }
    // Fallback: generic GPU reference across any game — treat as rough estimate.
    const g = db.prepare('SELECT name FROM games WHERE id=?').get(anyGame.game_id);
    return {
      status: 'estimated',
      label: 'Estimated',
      avgFps: null,
      message: `Not enough verified data for ${game.name}. Closest verified reference is ${g.name} (${anyGame.resolution}, ${anyGame.quality}): ${anyGame.avg_fps} FPS on the same GPU.`,
      model: MODEL,
      basis: { game: game.name, anchorGame: g.name, anchorFps: anyGame.avg_fps },
    };
  }

  const { row, match } = anchor;
  let fps = row.avg_fps;
  let low = row.pct1_low;
  const steps = [];
  let penalty = 0;

  // Apply each documented factor independently based on the differences
  // between the stored anchor and the requested configuration.
  if (row.gpu_id !== gpuId && row.gpu_id) {
    const anchorGpu = db.prepare('SELECT performance_index FROM gpus WHERE id=?').get(row.gpu_id);
    if (anchorGpu && anchorGpu.performance_index && gpu.performance_index) {
      const f = gpu.performance_index / anchorGpu.performance_index;
      fps = fps * f;
      if (low) low = low * f;
      penalty += 8;
      steps.push(`GPU index interpolation: ${row.avg_fps} × (${gpu.performance_index}/${anchorGpu.performance_index})`);
    }
  }

  if (row.resolution !== resolution) {
    const from = MODEL.resolutionScale[row.resolution] || 1;
    const to = MODEL.resolutionScale[resolution] || 1;
    const f = to / from;
    fps = fps * f;
    if (low) low = low * f;
    penalty += 5;
    steps.push(`Resolution scaling: ${row.resolution}→${resolution} (×${Math.round(f * 100) / 100})`);
  }

  if (row.cpu_id !== cpuId && cpu && row.cpu_id) {
    const anchorCpu = db.prepare('SELECT performance_index FROM cpus WHERE id=?').get(row.cpu_id);
    if (anchorCpu && anchorCpu.performance_index && cpu.performance_index) {
      const slope = MODEL.cpuFactorSlope * ((cpu.performance_index - anchorCpu.performance_index) / 100);
      const f = clamp(1 + slope, MODEL.cpuFactorClamp[0], MODEL.cpuFactorClamp[1]);
      fps = fps * f;
      if (low) low = low * f;
      penalty += 3;
      steps.push(`CPU factor: anchor CPU index ${anchorCpu.performance_index} → ${cpu.performance_index} (×${Math.round(f * 100) / 100})`);
    }
  }

  const qfAnchor = MODEL.qualityFactor[row.quality] || 1;
  const qfTarget = MODEL.qualityFactor[qKey] || 1;
  if (qfAnchor !== qfTarget) {
    const f = qfTarget / qfAnchor;
    fps = fps * f;
    if (low) low = low * f;
    penalty += 4;
    steps.push(`Quality preset: ${row.quality}→${qKey} (×${Math.round(f * 100) / 100})`);
  }

  // Ray tracing and upscaling are applied RELATIVE to the anchor's own
  // settings. If the anchor was itself measured with RT or upscaling on,
  // we do not apply the same factor a second time.
  const anchorRt = row.rt_enabled ? 1 : 0;
  const wantRt = rtEnabled ? 1 : 0;
  if (wantRt !== anchorRt) {
    const f = wantRt ? MODEL.rtFactor : (1 / MODEL.rtFactor);
    fps = fps * f;
    if (low) low = low * f;
    penalty += 3;
    steps.push(`Ray tracing ${anchorRt ? 'on→off' : 'off→on'} (×${Math.round(f * 100) / 100})`);
  }

  const anchorUp = row.upscaling || 'None';
  const wantUp = upscaling || 'None';
  const upF = MODEL.upscalingFactor[wantUp] || 1;
  const anchorUpF = MODEL.upscalingFactor[anchorUp] || 1;
  if (anchorUp !== wantUp && (upF !== 1 || anchorUpF !== 1)) {
    const f = upF / anchorUpF;
    fps = fps * f;
    if (low) low = low * f;
    penalty += 2;
    steps.push(`Upscaling ${anchorUp}→${wantUp} (×${Math.round(f * 100) / 100})`);
  }

  const verified = match === 'exact' && steps.length === 0;
  const rounded = Math.round(fps);
  const lowRounded = low ? Math.round(low) : null;
  const range = { low: Math.round(fps * 0.92), high: Math.round(fps * 1.08) };

  let level = 'unplayable';
  if (rounded >= 144) level = 'excellent';
  else if (rounded >= 100) level = 'great';
  else if (rounded >= 75) level = 'good';
  else if (rounded >= 60) level = 'playable';
  else if (rounded >= 30) level = 'low';

  // --- FPS Confidence Score -------------------------------------------
  // Honest, deterministic score: how close is the prediction to a real
  // measurement? Starts from the match type and only ever gets lower as
  // extrapolation steps, missing/ancient anchors are factored in.
  const CONF_BASE = {
    exact: 95, cpu_interpolated: 87, resolution_scaled: 81, quality_scaled: 79,
    gpu_interpolated: 73, res_quality_scaled: 71, game_generic: 58, cross_game: 48,
  };
  const date = row.benchmark_date;
  let agePenalty = 0;
  let ageNote = null;
  if (date) {
    const ageMonths = (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths > 24) { agePenalty = 6; ageNote = `Anchor measurement is over two years old (${date}) — game updates and drivers can shift real results.`; }
    else if (ageMonths > 12) { agePenalty = 3; ageNote = `Anchor measurement is more than a year old (${date}).`; }
  } else {
    agePenalty = 3;
    ageNote = 'Anchor has no measurement date on file.';
  }
  const stepsPenalty = Math.min(steps.length * 2, 10);
  let score = (CONF_BASE[match] || 48) - penalty - agePenalty - stepsPenalty;
  score = Math.max(4, Math.min(98, Math.round(score)));

  const grade = score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low';
  const factors = [];
  factors.push(match === 'exact'
    ? `Direct match on a stored measurement for ${game.name} at ${resolution} (${qKey}).`
    : `Closest stored reference for ${game.name}: match type "${match.replace(/_/g, ' ')}".`);
  if (steps.length) factors.push(`${steps.length} documented extrapolation step${steps.length > 1 ? 's' : ''} applied (each lowers confidence).`);
  else factors.push('No extrapolation applied — the stored measurement is returned as-is.');
  if (ageNote) factors.push(ageNote);
  const confidence = {
    score,
    grade,
    label: grade === 'high' ? 'High confidence' : grade === 'medium' ? 'Medium confidence' : 'Low confidence',
    factors,
    note: verified
      ? `This is a verified measurement for the exact configuration — no extrapolation. Confidence ${score}%.`
      : `This is an estimate interpolated from a verified reference. Confidence ${score}%.`,
  };

  return {
    status: verified ? 'verified' : 'estimated',
    label: verified ? 'Verified' : 'Estimated',
    avgFps: rounded,
    low1: lowRounded,
    range,
    level,
    confidence,
    message: verified
      ? `Verified benchmark for ${game.name} at ${resolution} (${qKey}).`
      : `Estimated from verified reference data using the documented model (${match.replace('_', ' ')}).`,
    basis: {
      anchor: { resolution: row.resolution, quality: row.quality, rt_enabled: row.rt_enabled, upscaling: row.upscaling || 'None', fps: row.avg_fps, date: row.benchmark_date, source_id: row.source_id },
      steps,
      model: MODEL,
    },
  };
}
