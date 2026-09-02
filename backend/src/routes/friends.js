import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId, todayStr, daysAgoStr } from '../utils/helpers.js';
import { userStats } from '../services/metrics.js';
import { getAchievements } from '../services/achievements.js';

const router = Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

function friendRow(userId, friendId) {
  const f = db.prepare(`
    SELECT u.id, u.username, p.display_name, p.rank, p.avatar,
           p.privacy_winrate, p.privacy_kd, p.privacy_gametime, p.privacy_compare
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(friendId);
  if (!f) return null;
  const stats = userStats(friendId, daysAgoStr(6), todayStr());
  return {
    id: f.id,
    username: f.username,
    displayName: f.display_name,
    rank: f.rank,
    avatar: f.avatar,
    winRate: f.privacy_winrate ? stats.winRate : null,
    kd: f.privacy_kd ? stats.kd : null,
    matches: f.privacy_winrate ? stats.matches : null,
    sessionHours: f.privacy_gametime ? stats.sessionHours : null,
    privacy: { winrate: f.privacy_winrate, kd: f.privacy_kd, gametime: f.privacy_gametime, compare: f.privacy_compare },
  };
}

// GET /api/friends
router.get('/', (req, res) => {
  const friends = db.prepare(`
    SELECT f.friend_id FROM friends f WHERE f.user_id = ? ORDER BY f.created_at
  `).all(req.user.id).map((r) => friendRow(req.user.id, r.friend_id)).filter(Boolean);

  const incoming = db.prepare(`
    SELECT fr.id, fr.created_at, u.id as user_id, u.username, p.display_name, p.rank
    FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE fr.receiver_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC
  `).all(req.user.id);

  const outgoing = db.prepare(`
    SELECT fr.id, fr.created_at, u.id as user_id, u.username, p.display_name
    FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE fr.sender_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC
  `).all(req.user.id);

  ok(res, { friends, incoming, outgoing });
});

// GET /api/friends/search?q=
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, { results: [] });
  const friendIds = db.prepare('SELECT friend_id FROM friends WHERE user_id=?').all(req.user.id).map((r) => r.friend_id);
  const pending = db.prepare(`SELECT sender_id s, receiver_id r FROM friend_requests WHERE status='pending' AND (sender_id=? OR receiver_id=?)`).all(req.user.id, req.user.id);
  const blocked = new Set(friendIds.concat(pending.map((p) => (p.s === req.user.id ? p.r : p.s))));
  blocked.add(req.user.id);
  const users = db.prepare(`
    SELECT u.id, u.username, p.rank,
      (SELECT COUNT(*) FROM user_games ug WHERE ug.user_id=u.id) as games
    FROM users u LEFT JOIN profiles p ON p.user_id=u.id
    WHERE u.username LIKE ? COLLATE NOCASE ORDER BY u.username LIMIT 10
  `).all(`%${q}%`);
  ok(res, { results: users.filter((u) => !blocked.has(u.id)) });
});

// GET /api/friends/leaderboard
router.get('/leaderboard', (req, res) => {
  const friends = db.prepare(`
    SELECT f.friend_id FROM friends f WHERE f.user_id = ? ORDER BY f.created_at
  `).all(req.user.id).map((r) => friendRow(req.user.id, r.friend_id)).filter(Boolean);
  const meRow = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  const myStats = userStats(req.user.id, daysAgoStr(6), todayStr());
  const me = {
    id: req.user.id,
    username: db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id).username,
    rank: meRow?.rank || null,
    winRate: myStats.winRate,
    kd: myStats.kd,
    matches: myStats.matches,
    isMe: true,
  };
  const list = [me].concat(friends.map((f) => ({
    id: f.id,
    username: f.username,
    rank: f.rank,
    winRate: f.winRate,
    kd: f.kd,
    matches: f.matches,
    isMe: false,
  })));
  const sortVal = (x) => (x.winRate != null ? x.winRate : x.kd != null ? x.kd : -1);
  list.sort((a, b) => sortVal(b) - sortVal(a));
  ok(res, { leaderboard: list });
});

// POST /api/friends/requests
router.post('/requests', body('username').trim().notEmpty().withMessage('Enter a username.'), validate, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(req.body.username);
  if (!target) return fail(res, 404, 'NOT_FOUND', 'No user found with that username.');
  if (target.id === req.user.id) return fail(res, 400, 'SELF_REQUEST', 'You cannot add yourself.');
  const alreadyFriend = db.prepare('SELECT id FROM friends WHERE user_id=? AND friend_id=?').get(req.user.id, target.id);
  if (alreadyFriend) return fail(res, 409, 'ALREADY_FRIENDS', 'You are already friends.');
  const pending = db.prepare('SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status=?').get(req.user.id, target.id, 'pending');
  if (pending) return fail(res, 409, 'REQUEST_PENDING', 'A friend request is already pending.');
  const reverse = db.prepare('SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status=?').get(target.id, req.user.id, 'pending');
  if (reverse) return fail(res, 409, 'REQUEST_PENDING', 'This user has already sent you a request — accept it instead.');

  const id = db.prepare('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)').run(req.user.id, target.id).lastInsertRowid;
  ok(res, { requestId: id, sent: true });
});

// POST /api/friends/requests/:id/accept
router.post('/requests/:id/accept', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const fr = db.prepare('SELECT * FROM friend_requests WHERE id=? AND receiver_id=?').get(id, req.user.id);
  if (!fr) return fail(res, 404, 'NOT_FOUND', 'Friend request not found.');
  if (fr.status !== 'pending') return fail(res, 409, 'ALREADY_HANDLED', 'This request has already been handled.');
  db.prepare('UPDATE friend_requests SET status=?, responded_at=? WHERE id=?').run('accepted', now(), id);
  db.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, fr.sender_id);
  db.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(fr.sender_id, req.user.id);
  getAchievements(req.user.id);
  ok(res, { accepted: true });
});

// POST /api/friends/requests/:id/decline
router.post('/requests/:id/decline', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const fr = db.prepare('SELECT id FROM friend_requests WHERE id=? AND receiver_id=?').get(id, req.user.id);
  if (!fr) return fail(res, 404, 'NOT_FOUND', 'Friend request not found.');
  db.prepare('UPDATE friend_requests SET status=?, responded_at=? WHERE id=?').run('declined', now(), id);
  ok(res, { declined: true });
});

// DELETE /api/friends/requests/:id  (sender cancels an outgoing request)
router.delete('/requests/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const fr = db.prepare('SELECT id FROM friend_requests WHERE id=? AND sender_id=?').get(id, req.user.id);
  if (!fr) return fail(res, 404, 'NOT_FOUND', 'Request not found.');
  db.prepare('UPDATE friend_requests SET status=? WHERE id=?').run('cancelled', id);
  ok(res, { cancelled: true });
});

// DELETE /api/friends/:userId
router.delete('/:userId', param('userId').isInt(), validate, (req, res) => {
  const uid = parseId(req.params.userId);
  db.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').run(req.user.id, uid);
  db.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').run(uid, req.user.id);
  ok(res, { removed: true });
});

// GET /api/friends/:userId/compare
router.get('/:userId/compare', param('userId').isInt(), validate, (req, res) => {
  const uid = parseId(req.params.userId);
  const friendship = db.prepare('SELECT id FROM friends WHERE user_id=? AND friend_id=?').get(req.user.id, uid);
  if (!friendship) return fail(res, 403, 'NOT_FRIENDS', 'Add this user as a friend to compare.');

  const me = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  const them = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(uid);
  if (them && !them.privacy_compare) return fail(res, 403, 'PRIVACY', 'This user has disabled comparisons.');

  const myStats = userStats(req.user.id, daysAgoStr(6), todayStr());
  const theirStats = userStats(uid, daysAgoStr(6), todayStr());
  const friendInfo = friendRow(req.user.id, uid);

  // weekly improvement: sessions this week vs last week
  const weekDelta = (u) => {
    const cur = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status='ended' AND started_at >= datetime('now','-7 days')`).get(u).c;
    const prev = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status='ended' AND started_at >= datetime('now','-14 days') AND started_at < datetime('now','-7 days')`).get(u).c;
    return { current: cur, previous: prev, delta: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
  };

  const visible = (stat, priv) => (priv ? stat : 'hidden');
  const metrics = [
    { key: 'winRate', label: 'Win rate', me: visible(myStats.winRate, me?.privacy_winrate !== 0), friend: visible(theirStats.winRate, friendInfo?.privacy.winrate) },
    { key: 'kd', label: 'K/D', me: visible(myStats.kd, me?.privacy_kd !== 0), friend: visible(theirStats.kd, friendInfo?.privacy.kd) },
    { key: 'matches', label: 'Matches (7d)', me: myStats.matches, friend: visible(theirStats.matches, friendInfo?.privacy.winrate) },
    { key: 'hours', label: 'Gaming time (7d)', me: visible(myStats.sessionHours, me?.privacy_gametime !== 0), friend: visible(theirStats.sessionHours, friendInfo?.privacy.gametime) },
    { key: 'rank', label: 'Rank', me: me?.rank || null, friend: friendInfo?.rank || null },
    { key: 'weeklyImprovement', label: 'Weekly sessions', me: weekDelta(req.user.id), friend: visible(weekDelta(uid), friendInfo?.privacy.gametime) },
  ];

  const winnerCount = metrics.reduce((acc, m) => {
    if (m.me == null || m.friend == null || m.me === 'hidden' || m.friend === 'hidden') return acc;
    const num = (v) => (typeof v === 'object' ? v.current : v);
    const a = num(m.me);
    const b = num(m.friend);
    if (a == null || b == null || a === b) return acc;
    return { ...acc, [a > b ? 'me' : 'friend']: (acc[a > b ? 'me' : 'friend'] || 0) + 1 };
  }, {});

  ok(res, {
    friend: { id: friendInfo.id, username: friendInfo.username, displayName: friendInfo.displayName, rank: friendInfo.rank },
    metrics,
    verdict: winnerCount.me > winnerCount.friend
      ? { text: `You are ahead in ${winnerCount.me} of ${winnerCount.me + winnerCount.friend} compared categories.`, leader: 'me' }
      : winnerCount.friend > winnerCount.me
        ? { text: `${friendInfo.username} is ahead in ${winnerCount.friend} compared categories.`, leader: 'friend' }
        : { text: 'You are evenly matched in the compared categories.', leader: 'tie' },
  });
});

export default router;
