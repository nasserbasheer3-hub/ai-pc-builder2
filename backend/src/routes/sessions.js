import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { recomputeStreak } from '../engines/insights.js';
import { getAchievements } from '../services/achievements.js';

const router = Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

// POST /api/sessions/start
router.post('/start', body('game_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Invalid game.'), body('note').optional().isLength({ max: 500 }), validate, (req, res) => {
  const active = db.prepare('SELECT id, game_id FROM gaming_sessions WHERE user_id=? AND status=?').get(req.user.id, 'active');
  if (active) return fail(res, 409, 'SESSION_ACTIVE', 'You already have an active session. End it first.');
  const gid = parseId(req.body.game_id);
  if (gid && !db.prepare('SELECT id FROM games WHERE id=? AND enabled=1').get(gid)) return fail(res, 404, 'NOT_FOUND', 'Game not found.');
  const id = db.prepare('INSERT INTO gaming_sessions (user_id, game_id, note, status) VALUES (?, ?, ?, ?)').run(req.user.id, gid || null, req.body.note || null, 'active').lastInsertRowid;
  const session = db.prepare('SELECT s.*, g.name as game_name FROM gaming_sessions s LEFT JOIN games g ON g.id=s.game_id WHERE s.id=?').get(id);
  ok(res, { session });
});

// POST /api/sessions/:id/end
router.post('/:id/end', param('id').isInt().withMessage('Invalid session id.'), validate, (req, res) => {
  const id = parseId(req.params.id);
  const s = db.prepare('SELECT * FROM gaming_sessions WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!s) return fail(res, 404, 'NOT_FOUND', 'Session not found.');
  if (s.status === 'ended') return fail(res, 409, 'ALREADY_ENDED', 'This session has already ended.');
  const started = new Date(s.started_at);
  const ended = new Date();
  const mins = Math.max(1, Math.round((ended - started) / 60000));
  db.prepare('UPDATE gaming_sessions SET ended_at=?, duration_minutes=?, status=? WHERE id=?').run(ended.toISOString(), mins, 'ended', id);
  recomputeStreak(req.user.id);
  getAchievements(req.user.id);
  const session = db.prepare('SELECT s.*, g.name as game_name FROM gaming_sessions s LEFT JOIN games g ON g.id=s.game_id WHERE s.id=?').get(id);
  ok(res, { session });
});

// POST /api/sessions/:id/performance  (attach real stats to an ended session)
router.post('/:id/performance',
  param('id').isInt().withMessage('Invalid session id.'),
  body('wins').optional().isInt({ min: 0 }),
  body('losses').optional().isInt({ min: 0 }),
  body('kills').optional().isInt({ min: 0 }),
  body('deaths').optional().isInt({ min: 0 }),
  body('assists').optional().isInt({ min: 0 }),
  validate, (req, res) => {
    const id = parseId(req.params.id);
    const s = db.prepare('SELECT * FROM gaming_sessions WHERE id=? AND user_id=?').get(id, req.user.id);
    if (!s) return fail(res, 404, 'NOT_FOUND', 'Session not found.');
    const date = s.ended_at ? s.ended_at.slice(0, 10) : s.started_at.slice(0, 10);
    const gameId = s.game_id;
    const wins = Number(req.body.wins || 0);
    const losses = Number(req.body.losses || 0);
    const kills = Number(req.body.kills || 0);
    const deaths = Number(req.body.deaths || 0);
    const assists = Number(req.body.assists || 0);
    const matches = wins + losses;
    db.prepare(`
      INSERT INTO performance_records (user_id, session_id, game_id, record_date, wins, losses, kills, deaths, assists, matches)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, record_date, game_id) DO UPDATE SET
        wins = excluded.wins, losses = excluded.losses, kills = excluded.kills,
        deaths = excluded.deaths, assists = excluded.assists, matches = excluded.matches
    `).run(req.user.id, id, gameId, date, wins, losses, kills, deaths, assists, matches);
    recomputeStreak(req.user.id);
    getAchievements(req.user.id);
    ok(res, { recorded: true, date, wins, losses, kills, deaths });
  });

// GET /api/sessions
router.get('/', query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 100 }), validate, (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 20), 100);
  const offset = (page - 1) * limit;
  const active = db.prepare('SELECT s.*, g.name as game_name FROM gaming_sessions s LEFT JOIN games g ON g.id=s.game_id WHERE s.user_id=? AND s.status=? ORDER BY s.started_at DESC').get(req.user.id, 'active');
  const total = db.prepare('SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=?').get(req.user.id).c;
  const history = db.prepare(`
    SELECT s.*, g.name as game_name FROM gaming_sessions s
    LEFT JOIN games g ON g.id=s.game_id
    WHERE s.user_id=? AND s.status='ended'
    ORDER BY s.started_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);
  ok(res, { active, history, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// GET /api/sessions/stats
router.get('/stats', (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) sessions, COALESCE(SUM(duration_minutes),0) minutes, COALESCE(AVG(duration_minutes),0) avg_minutes
    FROM gaming_sessions WHERE user_id=? AND status='ended'
  `).get(req.user.id);
  const perGame = db.prepare(`
    SELECT g.name, COUNT(*) sessions, COALESCE(SUM(s.duration_minutes),0) minutes
    FROM gaming_sessions s JOIN games g ON g.id=s.game_id
    WHERE s.user_id=? AND s.status='ended' GROUP BY g.id ORDER BY minutes DESC
  `).all(req.user.id);
  ok(res, {
    totalSessions: totals.sessions,
    totalMinutes: totals.minutes,
    avgSessionMinutes: Math.round(totals.avg_minutes),
    hours: Math.round((totals.minutes / 60) * 10) / 10,
    perGame,
  });
});

export default router;
