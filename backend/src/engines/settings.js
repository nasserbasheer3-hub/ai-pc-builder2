import { db } from '../db.js';
import { estimateFps } from './fps.js';

export function recommendSettings(input) {
  const { game_id, gpu_id, cpu_id = null, resolution = '1080p', refreshRate = 60, targetFps = null, preference = 'balanced' } = input;

  const game = db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(game_id);
  if (!game) return { status: 'error', message: 'Game not found.' };
  const gpu = gpu_id ? db.prepare('SELECT id, name, performance_index FROM gpus WHERE id=? AND enabled=1').get(gpu_id) : null;

  const presets = db.prepare('SELECT * FROM game_settings WHERE game_id = ? ORDER BY id').all(game_id);
  if (!presets.length) {
    return { status: 'unavailable', message: 'Not enough verified data available for this game. Verified in-game settings are not yet stored for this title.', game: game.name };
  }
  if (!gpu) {
    return { status: 'error', message: 'Select a GPU to estimate the appropriate settings tier.' };
  }

  const goal = targetFps || refreshRate || 60;
  const fpsEst = estimateFps({ gameId: game.id, cpuId: cpu_id, gpuId: gpu.id, resolution, quality: 'Ultra' });
  const ultraFps = fpsEst.avgFps;

  // Score presets: prefer the one whose target_fps is nearest to the goal while <= ultraFps.
  let chosen = presets[presets.length - 1];
  let bestDiff = Infinity;
  for (const p of presets) {
    const t = p.target_fps || 60;
    if (ultraFps != null && ultraFps < t) continue; // can't reach this tier at Ultra
    const diff = Math.abs(t - goal);
    if (diff < bestDiff) {
      bestDiff = diff;
      chosen = p;
    }
  }

  const settings = JSON.parse(chosen.settings_json || '{}');
  return {
    status: 'ready',
    game: game.name,
    gpu: gpu.name,
    preset: { key: chosen.settings_key, description: chosen.description, targetFps: chosen.target_fps },
    settings: Object.entries(settings).map(([setting, value]) => ({ setting, value })),
    rationale: ultraFps == null
      ? `No verified benchmark exists for ${game.name} on the ${gpu.name}, so the preset is chosen by your target (${goal} FPS).`
      : `Estimated ~${ultraFps} FPS at ${resolution} Ultra. Recommended preset "${chosen.settings_key}" targets ${chosen.target_fps || goal} FPS.`,
    fpsEstimate: { avgFps: ultraFps, label: fpsEst.label },
    label: 'Verified',
    sourceLabel: 'Verified in-game settings',
  };
}
