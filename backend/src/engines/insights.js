import { db } from '../db.js';
import { userStats, activityDates, dailySeries } from '../services/metrics.js';
import { weekStart, todayStr, daysAgoStr } from '../utils/helpers.js';

const MIN_MATCHES = 10;

export function computeStreaks(userId) {
  const row = db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO streaks (user_id, current_streak, best_streak) VALUES (?, 0, 0)').run(userId);
    return { current: 0, best: 0, lastActivityDate: null };
  }
  return {
    current: row.current_streak,
    best: row.best_streak,
    lastActivityDate: row.last_activity_date,
    bestEndDate: row.best_end_date,
  };
}

// Recompute streak from real activity. Call after logging a session/performance.
export function recomputeStreak(userId) {
  const dates = activityDates(userId);
  const today = todayStr();
  let current = 0;
  let best = 0;
  let bestEnd = null;
  let last = null;

  if (dates.length) {
    const set = new Set(dates);
    let cursor = new Date(`${today}T00:00:00`);
    if (set.has(today) || set.has(daysAgoStr(1))) {
      // streak can count from today or yesterday (still alive)
      if (set.has(today)) current = 1;
      cursor.setDate(cursor.getDate() - 1);
      while (set.has(cursor.toISOString().slice(0, 10))) {
        current += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }
    // best streak over all dates
    const sorted = [...set].sort();
    let run = 0;
    let prev = null;
    for (const d of sorted) {
      const day = new Date(`${d}T00:00:00`);
      const diff = prev ? (day - prev) / 86400000 : 1;
      if (diff === 1) run += 1;
      else if (diff > 1) run = 1;
      else if (diff <= 0) continue;
      if (run >= best) {
        best = run;
        bestEnd = d;
      }
      prev = day;
    }
    last = sorted[sorted.length - 1];
  }

  db.prepare(`
    INSERT INTO streaks (user_id, current_streak, best_streak, last_activity_date, best_end_date, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      last_activity_date = excluded.last_activity_date,
      best_end_date = excluded.best_end_date,
      updated_at = excluded.updated_at
  `).run(userId, current, best, last, bestEnd);
  return { current, best, lastActivityDate: last, bestEndDate: bestEnd };
}

function habitTimeOfDay(userId) {
  const rows = db.prepare(`
    SELECT CAST(strftime('%H', started_at) AS INTEGER) h, COUNT(*) c
    FROM gaming_sessions WHERE user_id = ? AND status='ended'
    GROUP BY h ORDER BY c DESC LIMIT 1
  `).get(userId);
  if (!rows) return null;
  const h = rows.h;
  if (h < 6) return 'late night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

export function engineAdvice(userId) {
  const last7 = userStats(userId, daysAgoStr(6), todayStr());
  const prev7 = userStats(userId, daysAgoStr(13), daysAgoStr(7));
  const series = dailySeries(userId, 14);
  const activity = activityDates(userId).length;
  const activeDays7 = new Set(series.slice(7).map((d) => d.date)).size;

  const strengths = [];
  const weaknesses = [];
  const suggestions = [];
  const trends = [];

  if (last7.matches >= MIN_MATCHES) {
    if (last7.winRate >= 55) strengths.push({ title: 'Strong win rate', detail: `${last7.winRate}% win rate across ${last7.matches} matches.`, label: 'verified' });
    else if (last7.winRate <= 40) weaknesses.push({ title: 'Below-average win rate', detail: `${last7.winRate}% win rate across ${last7.matches} matches.`, label: 'verified' });
    if (last7.kd != null && last7.kd >= 1.15) strengths.push({ title: 'Positive K/D', detail: `K/D of ${last7.kd} over the last 7 days.`, label: 'verified' });
    else if (last7.kd != null && last7.kd < 0.85) weaknesses.push({ title: 'Negative K/D', detail: `K/D of ${last7.kd}. Consider reviewing positioning and aim.`, label: 'verified' });
  }

  if (last7.sessions >= 1 && prev7.sessions >= 1) {
    const delta = last7.winRate != null && prev7.winRate != null ? Math.round((last7.winRate - prev7.winRate) * 10) / 10 : null;
    if (delta != null && delta >= 5) trends.push({ title: 'Win rate improving', detail: `+${delta} points versus the previous 7 days.`, direction: 'up', label: 'verified' });
    if (delta != null && delta <= -5) trends.push({ title: 'Win rate declining', detail: `${delta} points versus the previous 7 days.`, direction: 'down', label: 'verified' });
    const sDelta = last7.sessions - prev7.sessions;
    if (sDelta >= 3) trends.push({ title: 'More sessions', detail: `+${sDelta} sessions versus the previous 7 days.`, direction: 'up', label: 'verified' });
    if (sDelta <= -3) trends.push({ title: 'Fewer sessions', detail: `${sDelta} sessions versus the previous 7 days.`, direction: 'down', label: 'verified' });
  }

  const topGame = last7.perGame[0];
  if (topGame) {
    strengths.push({ title: `Dedicated to ${topGame.name}`, detail: `${topGame.matches} matches logged in ${topGame.name} this week.`, label: 'verified' });
  }

  // Habits & suggestions (recommendations)
  if (activeDays7 < 3) {
    suggestions.push({ title: 'Build consistency', detail: `Only ${activeDays7} active day(s) in the last 7. Short, regular sessions build skill faster than rare long ones.`, label: 'recommendation' });
  }
  const avg = last7.avgSessionMinutes;
  if (avg > 0 && avg < 25) {
    suggestions.push({ title: 'Lengthen focused sessions', detail: `Average session is ${avg} minutes — short enough that warmup may dominate playtime. Aim for 45–90 minute focused blocks.`, label: 'recommendation' });
  } else if (avg > 240) {
    suggestions.push({ title: 'Avoid marathon sessions', detail: `Average session length is ${Math.round(avg)} minutes. Performance and focus drop sharply after ~3 hours.`, label: 'recommendation' });
  }
  if (last7.kd != null && last7.kd < 1 && last7.matches > 0) {
    suggestions.push({ title: 'Aim & positioning practice', detail: `K/D of ${last7.kd}. Add a short warmup (aim trainers, deathmatch) before ranked sessions.`, label: 'recommendation' });
  }
  if (last7.winRate != null && last7.winRate >= 55 && last7.kd != null && last7.kd < 1.1) {
    suggestions.push({ title: 'Win more by fragging more', detail: `Win rate is strong (${last7.winRate}%) but K/D is modest — aggressive-but-safe duels can convert wins into clear fragging advantage.`, label: 'recommendation' });
  }
  if (last7.matches === 0 && last7.sessions > 0) {
    suggestions.push({ title: 'Record match stats', detail: `You have logged sessions but no match results. Recording wins/losses and K/D unlocks performance insights.`, label: 'recommendation' });
  }
  if (last7.matches === 0 && last7.sessions === 0 && activity === 0) {
    suggestions.push({ title: 'Log your first session', detail: 'Start a gaming session to begin tracking your improvement journey.', label: 'recommendation' });
  }

  return {
    strengths,
    weaknesses,
    trends,
    suggestions,
    habits: {
      topGame: topGame ? topGame.name : null,
      timeOfDay: habitTimeOfDay(userId),
      avgSessionMinutes: last7.avgSessionMinutes || null,
      sessionsLast7: last7.sessions,
      activeDaysLast7: activeDays7,
    },
    stats: {
      winRate: last7.winRate,
      kd: last7.kd,
      matches: last7.matches,
      sessions: last7.sessions,
      sessionHours: last7.sessionHours,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function buildWeeklyReport(userId, weekStartDate = null) {
  const ws = weekStartDate ? new Date(`${weekStartDate}T00:00:00Z`) : weekStart();
  const startStr = ws.toISOString().slice(0, 10);
  const end = new Date(ws);
  end.setUTCDate(end.getUTCDate() + 6);
  const endStr = end.toISOString().slice(0, 10);
  const prevStart = new Date(ws);
  prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  const prevEnd = new Date(ws);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);

  const cur = userStats(userId, startStr, endStr);
  const prev = userStats(userId, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
  const series = dailySeries(userId, 7).map((d) => d);

  const hasData = cur.sessions > 0 || cur.matches > 0;
  const winRateDelta = cur.winRate != null && prev.winRate != null ? Math.round((cur.winRate - prev.winRate) * 10) / 10 : null;
  const sessionDelta = prev.sessions > 0 ? Math.round(((cur.sessions - prev.sessions) / prev.sessions) * 100) : (cur.sessions > 0 ? 100 : 0);
  const timeDelta = prev.sessionMinutes > 0 ? Math.round(((cur.sessionMinutes - prev.sessionMinutes) / prev.sessionMinutes) * 100) : (cur.sessionMinutes > 0 ? 100 : 0);

  const report = {
    weekStart: startStr,
    weekEnd: endStr,
    metrics: {
      hasData,
      sessions: cur.sessions,
      sessionHours: cur.sessionHours,
      sessionMinutes: cur.sessionMinutes,
      avgSessionMinutes: cur.avgSessionMinutes,
      matches: cur.matches,
      wins: cur.wins,
      losses: cur.losses,
      winRate: cur.winRate,
      kd: cur.kd,
      perGame: cur.perGame,
      daily: series,
    },
    comparison: {
      previousWeekStart: prevStart.toISOString().slice(0, 10),
      winRateDelta,
      sessionCountDeltaPercent: sessionDelta,
      timeDeltaPercent: timeDelta,
      hasPreviousData: prev.sessions > 0 || prev.matches > 0,
    },
  };

  // engine summary (deterministic, from real data)
  const parts = [];
  if (!hasData) {
    parts.push('No verified gaming data was recorded this week, so no performance metrics could be computed.');
  } else {
    parts.push(`This week you logged ${cur.sessions} session(s) totaling ~${cur.sessionHours} hours`);
    if (cur.matches > 0) {
      parts.push(`and ${cur.matches} match(es) with a ${cur.winRate}% win rate`);
      if (cur.kd != null) parts.push(`and a K/D of ${cur.kd}`);
    }
    parts.push('.');
    if (report.comparison.winRateDelta != null) {
      parts.push(`Win rate ${report.comparison.winRateDelta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(report.comparison.winRateDelta)} points compared with the previous week`);
    }
    if (report.comparison.hasPreviousData) {
      parts.push(`; session count ${report.comparison.sessionCountDeltaPercent >= 0 ? 'up' : 'down'} ${Math.abs(report.comparison.sessionCountDeltaPercent)}% and play time ${report.comparison.timeDeltaPercent >= 0 ? 'up' : 'down'} ${Math.abs(report.comparison.timeDeltaPercent)}%.`);
    }
  }
  report.engineSummary = parts.join(' ');

  return report;
}
