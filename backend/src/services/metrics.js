import { db } from '../db.js';

// Aggregated metrics computed from REAL recorded data only.
export function userStats(userId, fromDate, toDate) {
  const sessions = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(duration_minutes), 0) as minutes,
           COALESCE(AVG(duration_minutes), 0) as avg_minutes
    FROM gaming_sessions
    WHERE user_id = ? AND status = 'ended' AND started_at >= ? AND started_at < ?
  `).get(userId, `${fromDate}T00:00:00`, `${toDate}T23:59:59`);

  const perf = db.prepare(`
    SELECT
      COALESCE(SUM(wins), 0) wins,
      COALESCE(SUM(losses), 0) losses,
      COALESCE(SUM(kills), 0) kills,
      COALESCE(SUM(deaths), 0) deaths,
      COALESCE(SUM(assists), 0) assists,
      COALESCE(SUM(matches), 0) matches,
      COALESCE(SUM(hours), 0) hours
    FROM performance_records
    WHERE user_id = ? AND record_date >= ? AND record_date <= ?
  `).get(userId, fromDate, toDate);

  const perGame = db.prepare(`
    SELECT g.id, g.name, g.cover_color,
           COALESCE(SUM(p.wins),0) wins, COALESCE(SUM(p.losses),0) losses,
           COALESCE(SUM(p.kills),0) kills, COALESCE(SUM(p.deaths),0) deaths,
           COALESCE(SUM(p.matches),0) matches
    FROM performance_records p
    JOIN games g ON g.id = p.game_id
    WHERE p.user_id = ? AND p.record_date >= ? AND p.record_date <= ?
    GROUP BY g.id ORDER BY matches DESC
  `).all(userId, fromDate, toDate);

  const totalMatches = perf.matches > 0 ? perf.matches : perf.wins + perf.losses;
  return {
    sessions: sessions.count,
    sessionMinutes: sessions.minutes,
    sessionHours: Math.round((sessions.minutes / 60) * 10) / 10,
    avgSessionMinutes: Math.round(sessions.avg_minutes),
    perfHours: Math.round((perf.hours || 0) * 10) / 10,
    wins: perf.wins,
    losses: perf.losses,
    matches: totalMatches,
    kills: perf.kills,
    deaths: perf.deaths,
    assists: perf.assists,
    winRate: totalMatches > 0 ? Math.round((perf.wins / totalMatches) * 1000) / 10 : null,
    kd: perf.deaths > 0 ? Math.round((perf.kills / perf.deaths) * 100) / 100 : (perf.kills > 0 ? perf.kills : null),
    kda: perf.deaths > 0 ? Math.round(((perf.kills + (perf.assists || 0)) / perf.deaths) * 100) / 100 : null,
    perGame,
  };
}

export function dailySeries(userId, days) {
  const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT record_date as date, SUM(wins) wins, SUM(losses) losses, SUM(kills) kills,
           SUM(deaths) deaths, SUM(matches) matches, SUM(hours) hours
    FROM performance_records
    WHERE user_id = ? AND record_date >= ?
    GROUP BY record_date ORDER BY record_date
  `).all(userId, start);

  const sessionDays = db.prepare(`
    SELECT substr(started_at,1,10) date, COUNT(*) cnt, SUM(duration_minutes) minutes
    FROM gaming_sessions WHERE user_id = ? AND status='ended' AND started_at >= ?
    GROUP BY date
  `).all(userId, `${start}T00:00:00`);

  const map = {};
  for (const r of rows) map[r.date] = { ...r, sessions: 0, sessionMinutes: 0 };
  for (const s of sessionDays) {
    map[s.date] = map[s.date] || { date: s.date, wins: 0, losses: 0, kills: 0, deaths: 0, matches: 0, hours: 0 };
    map[s.date].sessions = s.cnt;
    map[s.date].sessionMinutes = s.minutes;
  }

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const rec = map[d];
    const base = rec || { date: d, wins: 0, losses: 0, kills: 0, deaths: 0, matches: 0, hours: 0, sessions: 0, sessionMinutes: 0 };
    const matches = base.matches > 0 ? base.matches : base.wins + base.losses;
    out.push({
      ...base,
      minutes: base.sessionMinutes,
      winRate: matches > 0 ? Math.round((base.wins / matches) * 1000) / 10 : null,
      kd: base.deaths > 0 ? Math.round((base.kills / base.deaths) * 100) / 100 : null,
    });
  }
  return out;
}

// "Improvement activity" = a day with a logged session or a performance record.
export function activityDates(userId) {
  return db.prepare(`
    SELECT DISTINCT substr(started_at,1,10) date FROM gaming_sessions
    WHERE user_id = ? AND status='ended'
    UNION
    SELECT DISTINCT record_date FROM performance_records WHERE user_id = ?
    ORDER BY date
  `).all(userId, userId).map((r) => r.date);
}

export function activeGameIds(userId) {
  return db.prepare(`
    SELECT DISTINCT game_id FROM performance_records WHERE user_id = ? AND game_id IS NOT NULL
  `).all(userId).map((r) => r.game_id);
}
