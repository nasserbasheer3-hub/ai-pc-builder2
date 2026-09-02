import { Router } from 'express';
import { db } from '../db.js';
import { ok } from '../utils/helpers.js';

const router = Router();

// GET /api/games  (public catalog, enabled only)
router.get('/', (req, res) => {
  const games = db.prepare('SELECT id, name, slug, genre, publisher, release_year, description, cover_color FROM games WHERE enabled=1 ORDER BY name').all();
  ok(res, { games });
});

// GET /api/games/:id
router.get('/:id', (req, res) => {
  const game = db.prepare('SELECT id, name, slug, genre, publisher, release_year, description, cover_color FROM games WHERE id=? AND enabled=1').get(req.params.id);
  if (!game) return ok(res, { game: null });
  const settingsCount = db.prepare('SELECT COUNT(*) c FROM game_settings WHERE game_id=?').get(game.id).c;
  const benchmarkCount = db.prepare('SELECT COUNT(*) c FROM benchmarks WHERE game_id=?').get(game.id).c;
  ok(res, { game: { ...game, hasVerifiedSettings: settingsCount > 0, hasBenchmarkData: benchmarkCount > 0 } });
});

export default router;
