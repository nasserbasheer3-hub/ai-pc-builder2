import { Router } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId, todayStr, daysAgoStr } from '../utils/helpers.js';
import { recomputeStreak } from '../engines/insights.js';
import { getAchievements } from '../services/achievements.js';
import { dailySeries } from '../services/metrics.js';

const router = Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

// GET /api/performance/today
router.get('/today', (req, res) => {
  const today = todayStr();
  const yesterday = daysAgoStr(1);
  const sessionsToday = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status='ended' AND substr(started_at,1,10)=?`).get(req.user.id, today).c;
  const sessionsYesterday = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status='ended' AND substr(started_at,1,10)=?`).get(req.user.id, yesterday).c;
  const activeToday = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status='active'`).get(req.user.id).c;
  const minutesToday = db.prepare(`SELECT COALESCE(SUM(duration_minutes),0) m FROM gaming_sessions WHERE user_id=? AND status='ended' AND substr(started_at,1,10)=?`).get(req.user.id, today).m;
  const minutesYesterday = db.prepare(`SELECT COALESCE(SUM(duration_minutes),0) m FROM gaming_sessions WHERE user_id=? AND status='ended' AND substr(started_at,1,10)=?`).get(req.user.id, yesterday).m;

  const recs = db.prepare(`
    SELECT pr.*, g.name game_name FROM performance_records pr
    LEFT JOIN games g ON g.id = pr.game_id WHERE pr.user_id=? AND pr.record_date=?
  `).all(req.user.id, today);

  const totalMatches = recs.reduce((s, r) => s + r.matches, 0);
  const totalWins = recs.reduce((s, r) => s + r.wins, 0);
  const totalKills = recs.reduce((s, r) => s + r.kills, 0);
  const totalDeaths = recs.reduce((s, r) => s + r.deaths, 0);

  const yesterdayRecs = db.prepare(`SELECT * FROM performance_records WHERE user_id=? AND record_date=?`).all(req.user.id, yesterday);
  const yMatches = yesterdayRecs.reduce((s, r) => s + r.matches, 0);
  const yWins = yesterdayRecs.reduce((s, r) => s + r.wins, 0);

  const data = {
    date: today,
    gamingTimeMinutes: minutesToday,
    sessions: sessionsToday,
    activeSession: activeToday > 0,
    gamesPlayed: recs.length,
    wins: totalWins,
    losses: totalMatches - totalWins,
    matches: totalMatches,
    kills: totalKills,
    deaths: totalDeaths,
    winRate: totalMatches > 0 ? Math.round((totalWins / totalMatches) * 1000) / 10 : null,
    kd: totalDeaths > 0 ? Math.round((totalKills / totalDeaths) * 100) / 100 : (totalKills > 0 ? totalKills : null),
    comparison: {
      previousDay: yesterday,
      timeDeltaPercent: minutesYesterday > 0 ? Math.round(((minutesToday - minutesYesterday) / minutesYesterday) * 100) : (minutesToday > 0 ? 100 : 0),
      sessionDelta: sessionsToday - sessionsYesterday,
      winRateDelta: yMatches > 0 && totalMatches > 0 ? Math.round((totalWins / totalMatches - yWins / yMatches) * 1000) / 10 : null,
      hasPreviousData: sessionsYesterday > 0 || yMatches > 0,
    },
  };

  // Only include stats that actually exist.
  if (data.sessions === 0 && data.matches === 0) {
    ok(res, { ...data, summary: 'No gaming activity recorded today yet.' });
    return;
  }
  const hasStats = data.matches > 0;
  ok(res, {
    ...data,
    summary: hasStats
      ? `${data.matches} match(es) today across ${data.gamesPlayed} game(s) — ${data.winRate}% win rate.`
      : `${data.sessions} session(s), ${Math.round(data.gamingTimeMinutes)} minutes of gaming today.`,
  });
});

// GET /api/performance/history?days=30
router.get('/history', query('days').optional().isInt({ min: 1, max: 90 }), validate, (req, res) => {
  const days = Math.min(Number(req.query.days || 30), 90);
  const rows = db.prepare(`
    SELECT pr.*, g.name game_name FROM performance_records pr
    LEFT JOIN games g ON g.id=pr.game_id
    WHERE pr.user_id=? AND pr.record_date >= date('now', ?)
    ORDER BY pr.record_date DESC
  `).all(req.user.id, `-${days} days`);
  ok(res, { records: rows, series: dailySeries(req.user.id, days), days });
});

// POST /api/performance/records
router.post('/records',
  body('game_id').isInt({ min: 1 }).withMessage('Select a game.'),
  body('record_date').optional().isISO8601().withMessage('Invalid date.'),
  body('wins').optional().isInt({ min: 0 }),
  body('losses').optional().isInt({ min: 0 }),
  body('kills').optional().isInt({ min: 0 }),
  body('deaths').optional().isInt({ min: 0 }),
  body('assists').optional().isInt({ min: 0 }),
  body('hours').optional().isFloat({ min: 0 }),
  validate, (req, res) => {
    const game = db.prepare('SELECT id FROM games WHERE id=? AND enabled=1').get(req.body.game_id);
    if (!game) return fail(res, 404, 'NOT_FOUND', 'Game not found.');
    const date = req.body.record_date ? req.body.record_date.slice(0, 10) : todayStr();
    const wins = Number(req.body.wins || 0);
    const losses = Number(req.body.losses || 0);
    const kills = Number(req.body.kills || 0);
    const deaths = Number(req.body.deaths || 0);
    const assists = Number(req.body.assists || 0);
    const matches = wins + losses;
    db.prepare(`
      INSERT INTO performance_records (user_id, game_id, record_date, wins, losses, kills, deaths, assists, matches, hours, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, record_date, game_id) DO UPDATE SET
        wins=excluded.wins, losses=excluded.losses, kills=excluded.kills,
        deaths=excluded.deaths, assists=excluded.assists, matches=excluded.matches,
        hours=excluded.hours, notes=excluded.notes
    `).run(req.user.id, req.body.game_id, date, wins, losses, kills, deaths, assists, matches, req.body.hours || null, req.body.notes || null);
    recomputeStreak(req.user.id);
    getAchievements(req.user.id);
    ok(res, { recorded: true, date, game_id: req.body.game_id });
  });

// DELETE /api/performance/records/:id
router.delete('/records/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id FROM performance_records WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Record not found.');
  db.prepare('DELETE FROM performance_records WHERE id=?').run(id);
  recomputeStreak(req.user.id);
  ok(res, { deleted: true });
});

export default router;
