import crypto from 'crypto';
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { getAchievements } from '../services/achievements.js';

const router = Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

const PROFILE_FIELDS = [
  'display_name', 'avatar', 'bio', 'rank', 'gaming_goals', 'main_game_id',
  'cpu_id', 'gpu_id', 'ram_id', 'storage_id', 'monitor_resolution', 'refresh_rate',
  'performance_preference', 'language', 'currency',
  'privacy_winrate', 'privacy_kd', 'privacy_gametime', 'privacy_compare',
  'notifications_enabled', 'is_public',
];

function makeProfileSlug() {
  let slug;
  do {
    slug = crypto.randomBytes(5).toString('hex');
  } while (db.prepare('SELECT 1 FROM profiles WHERE profile_slug=?').get(slug));
  return slug;
}

// Accept both camelCase and snake_case from the client (e.g. mainGameId, cpu_id).
const ALIAS = {
  mainGameId: 'main_game_id',
  cpuId: 'cpu_id',
  gpuId: 'gpu_id',
  ramId: 'ram_id',
  storageId: 'storage_id',
  monitorResolution: 'monitor_resolution',
  refreshRate: 'refresh_rate',
  displayName: 'display_name',
  gamingGoals: 'gaming_goals',
  performancePreference: 'performance_preference',
};
const REF_TABLES = {
  main_game_id: 'games', cpu_id: 'cpus', gpu_id: 'gpus',
  ram_id: 'memory_modules', storage_id: 'storage',
};
function normalizeBody(body) {
  const out = { ...body };
  for (const [alias, field] of Object.entries(ALIAS)) {
    if (out[alias] !== undefined && out[field] === undefined) out[field] = out[alias];
  }
  return out;
}
function refExists(field, id) {
  if (id === null || id === undefined || id === '') return true;
  const table = REF_TABLES[field];
  if (!table) return true;
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(Number(id));
}

function enrichProfile(profile) {
  if (!profile) return null;
  const grab = (table, id) => (id ? db.prepare(`SELECT id, name FROM ${table} WHERE id=?`).get(id) : null);
  const game = profile.main_game_id ? db.prepare('SELECT id, name, cover_color FROM games WHERE id=?').get(profile.main_game_id) : null;
  return {
    ...profile,
    mainGame: game,
    cpu: grab('cpus', profile.cpu_id),
    gpu: grab('gpus', profile.gpu_id),
    ram: grab('memory_modules', profile.ram_id),
    storage: grab('storage', profile.storage_id),
  };
}

function getProfile(userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
}

// GET /api/profile
router.get('/', (req, res) => {
  const profile = getProfile(req.user.id);
  const games = db.prepare(`
    SELECT ug.*, g.name, g.cover_color, g.genre FROM user_games ug
    JOIN games g ON g.id = ug.game_id
    WHERE ug.user_id = ? ORDER BY ug.is_main DESC, ug.created_at
  `).all(req.user.id);
  ok(res, { profile: enrichProfile(profile), games, achievements: getAchievements(req.user.id) });
});

// PUT /api/profile
router.put('/', (req, res) => {
  req.body = normalizeBody(req.body);
  const profile = getProfile(req.user.id);
  for (const f of Object.keys(REF_TABLES)) {
    if (req.body[f] !== undefined && !refExists(f, req.body[f])) {
      return fail(res, 422, 'VALIDATION', `${f} does not reference an existing item.`);
    }
  }
  const sets = [];
  const vals = [];
  for (const f of PROFILE_FIELDS) {
    if (req.body[f] !== undefined) {
      if (['main_game_id', 'cpu_id', 'gpu_id', 'ram_id', 'storage_id'].includes(f) && req.body[f] === null) {
        sets.push(`${f} = NULL`);
      } else if (['main_game_id', 'cpu_id', 'gpu_id', 'ram_id', 'storage_id', 'refresh_rate'].includes(f)) {
        const n = parseId(req.body[f]);
        if (!n) return fail(res, 422, 'VALIDATION', `${f} must be a valid id.`);
        sets.push(`${f} = ?`);
        vals.push(n);
      } else if (['privacy_winrate', 'privacy_kd', 'privacy_gametime', 'privacy_compare', 'notifications_enabled', 'is_public'].includes(f)) {
        sets.push(`${f} = ?`);
        vals.push(req.body[f] ? 1 : 0);
        if (f === 'is_public' && req.body[f] && !getProfile(req.user.id).profile_slug) {
          sets.push('profile_slug = ?');
          vals.push(makeProfileSlug());
        }
      } else {
        sets.push(`${f} = ?`);
        vals.push(req.body[f] === '' ? null : req.body[f]);
      }
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    vals.push(now());
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, req.user.id);
  }
  getAchievements(req.user.id); // re-evaluate (profile_complete)
  ok(res, { profile: enrichProfile(getProfile(req.user.id)) });
});

// POST /api/profile/onboarding
router.post('/onboarding',
  body('games').isArray().withMessage('Select your games.').optional(),
  body('mainGameId').optional({ nullable: true }),
  validate, (req, res) => {
    req.body = normalizeBody(req.body);
    const p = getProfile(req.user.id);
    for (const f of Object.keys(REF_TABLES)) {
      if (req.body[f] !== undefined && !refExists(f, req.body[f])) {
        return fail(res, 422, 'VALIDATION', `${f} does not reference an existing item.`);
      }
    }
    const fields = ['main_game_id', 'rank', 'gaming_goals', 'cpu_id', 'gpu_id', 'ram_id', 'storage_id',
      'monitor_resolution', 'refresh_rate', 'performance_preference', 'language', 'currency'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined && req.body[f] !== null) {
        if (['main_game_id', 'cpu_id', 'gpu_id', 'ram_id', 'storage_id', 'refresh_rate'].includes(f)) {
          const n = parseId(req.body[f]);
          if (n) { sets.push(`${f} = ?`); vals.push(n); }
        } else {
          sets.push(`${f} = ?`);
          vals.push(req.body[f]);
        }
      }
    }
    if (req.body.games && Array.isArray(req.body.games)) {
      for (const gid of req.body.games) {
        const n = parseId(gid);
        if (!n) continue;
        db.prepare('INSERT INTO user_games (user_id, game_id, is_main) VALUES (?, ?, ?) ON CONFLICT(user_id, game_id) DO NOTHING')
          .run(req.user.id, n, n === req.body.mainGameId ? 1 : 0);
      }
    }
    sets.push('onboarded = 1', 'updated_at = ?');
    vals.push(now());
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, req.user.id);
    getAchievements(req.user.id);
    ok(res, { profile: enrichProfile(getProfile(req.user.id)) });
  });

// Games ----------------------------------------------------------------
// GET /api/profile/games
router.get('/games', (req, res) => {
  const rows = db.prepare(`
    SELECT ug.*, g.name, g.cover_color, g.genre FROM user_games ug
    JOIN games g ON g.id = ug.game_id WHERE ug.user_id = ? ORDER BY ug.is_main DESC, ug.created_at
  `).all(req.user.id);
  ok(res, { games: rows });
});

// POST /api/profile/games
router.post('/games', body('game_id').isInt({ min: 1 }).withMessage('Select a game.'), validate, (req, res) => {
  const gid = req.body.game_id;
  const game = db.prepare('SELECT id FROM games WHERE id=? AND enabled=1').get(gid);
  if (!game) return fail(res, 404, 'NOT_FOUND', 'Game not found.');
  db.prepare('INSERT INTO user_games (user_id, game_id, is_main, rank, hours) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, game_id) DO NOTHING')
    .run(req.user.id, gid, req.body.is_main ? 1 : 0, req.body.rank || null, req.body.hours || null);
  getAchievements(req.user.id);
  ok(res, { game: db.prepare('SELECT ug.*, g.name, g.cover_color FROM user_games ug JOIN games g ON g.id=ug.game_id WHERE ug.user_id=? AND ug.game_id=?').get(req.user.id, gid) });
});

// PATCH /api/profile/games/:gameId
router.patch('/games/:gameId', param('gameId').isInt().withMessage('Invalid game id.'), validate, (req, res) => {
  const gid = parseId(req.params.gameId);
  const exists = db.prepare('SELECT id FROM user_games WHERE user_id=? AND game_id=?').get(req.user.id, gid);
  if (!exists) return fail(res, 404, 'NOT_FOUND', 'Game not in your list.');
  if (req.body.is_main) {
    db.prepare('UPDATE user_games SET is_main = 0 WHERE user_id = ?').run(req.user.id);
  }
  const sets = [];
  const vals = [];
  if (req.body.is_main !== undefined) { sets.push('is_main = ?'); vals.push(req.body.is_main ? 1 : 0); }
  if (req.body.rank !== undefined) { sets.push('rank = ?'); vals.push(req.body.rank || null); }
  if (req.body.hours !== undefined) { sets.push('hours = ?'); vals.push(req.body.hours || null); }
  if (sets.length) db.prepare(`UPDATE user_games SET ${sets.join(', ')} WHERE user_id=? AND game_id=?`).run(...vals, req.user.id, gid);
  ok(res, { updated: true });
});

// DELETE /api/profile/games/:gameId
router.delete('/games/:gameId', param('gameId').isInt().withMessage('Invalid game id.'), validate, (req, res) => {
  const gid = parseId(req.params.gameId);
  db.prepare('DELETE FROM user_games WHERE user_id=? AND game_id=?').run(req.user.id, gid);
  ok(res, { deleted: true });
});

// GET /api/profile/achievements
router.get('/achievements', (req, res) => {
  ok(res, { achievements: getAchievements(req.user.id) });
});

// GET /api/profile/performance-history
router.get('/performance-history', query('days').optional().isInt({ min: 1, max: 90 }).withMessage('days must be 1–90.'), validate, (req, res) => {
  const days = Math.min(Number(req.query.days || 30), 90);
  const rows = db.prepare(`
    SELECT record_date, game_id, g.name as game_name, wins, losses, kills, deaths, assists, matches, hours
    FROM performance_records pr LEFT JOIN games g ON g.id = pr.game_id
    WHERE pr.user_id = ? AND record_date >= date('now', ?)
    ORDER BY record_date DESC
  `).all(req.user.id, `-${days} days`);
  ok(res, { records: rows, days });
});

export default router;
