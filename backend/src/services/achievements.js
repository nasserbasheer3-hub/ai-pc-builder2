import { db } from '../db.js';
import { recomputeStreak, computeStreaks } from '../engines/insights.js';
import { userStats, activeGameIds } from '../services/metrics.js';
import { todayStr, daysAgoStr } from '../utils/helpers.js';

const ALL = db.prepare('SELECT * FROM achievements').all();

export function evaluateAchievements(userId) {
  const all = db.prepare('SELECT * FROM achievements').all();
  if (!all.length) return [];
  const earnedSet = new Set(db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id=?').all(userId).map((r) => r.achievement_id));
  const totals = userStats(userId, '2000-01-01', todayStr());
  const streaks = computeStreaks(userId);
  const friends = db.prepare('SELECT COUNT(*) c FROM friends WHERE user_id=?').get(userId).c;
  const builds = db.prepare('SELECT COUNT(*) c FROM pc_builds WHERE user_id=?').get(userId).c;
  const reports = db.prepare('SELECT COUNT(*) c FROM weekly_reports WHERE user_id=?').get(userId).c;
  const fpsChecks = db.prepare('SELECT COUNT(*) c FROM ai_requests WHERE user_id=? AND feature=? AND success=1').get(userId, 'fps_calc').c || 0;
  const sessions = db.prepare('SELECT COUNT(*) c FROM gaming_sessions WHERE user_id=? AND status=?').get(userId, 'ended').c;
  const perfCount = db.prepare('SELECT COUNT(*) c FROM performance_records WHERE user_id=?').get(userId).c;
  const games = db.prepare('SELECT COUNT(*) c FROM user_games WHERE user_id=?').get(userId).c;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
  const activeIds = activeGameIds(userId);
  const perfMatches = totals.matches;

  const criteria = {
    first_session: () => sessions >= 1,
    first_performance: () => perfCount >= 1,
    streak_7: () => streaks.best >= 7,
    streak_30: () => streaks.best >= 30,
    hours_10: () => (totals.sessionMinutes + (totals.perfHours * 60)) >= 600,
    games_5: () => games >= 5,
    profile_complete: () => Boolean(profile && profile.onboarded),
    win_rate_60: () => perfMatches >= 10 && totals.winRate != null && totals.winRate >= 60,
    kd_positive: () => perfMatches >= 10 && totals.kd != null && totals.kd >= 1.0,
    first_report: () => reports >= 1,
    friends_5: () => friends >= 5,
    first_build: () => builds >= 1,
    first_fps_check: () => fpsChecks >= 1,
  };

  const results = [];
  for (const a of all) {
    const fn = criteria[a.code];
    if (!fn) continue;
    let progress = 0;
    let earned = earnedSet.has(a.id);
    if (a.code === 'streak_7') { progress = Math.min(streaks.best / 7, 1); earned = streaks.best >= 7; }
    if (a.code === 'streak_30') { progress = Math.min(streaks.best / 30, 1); earned = streaks.best >= 30; }
    if (a.code === 'hours_10') { progress = Math.min((totals.sessionMinutes + totals.perfHours * 60) / 600, 1); earned = progress >= 1; }
    if (a.code === 'games_5') { progress = Math.min(games / 5, 1); earned = progress >= 1; }
    if (a.code === 'friends_5') { progress = Math.min(friends / 5, 1); earned = progress >= 1; }
    if (a.code === 'win_rate_60') { progress = perfMatches >= 10 ? Math.min(totals.winRate / 60, 1) : 0; earned = progress >= 1; }
    if (a.code === 'kd_positive') { progress = perfMatches >= 10 ? Math.min(totals.kd / 1, 1) : 0; earned = progress >= 1; }
    if (a.code === 'first_session' && earned) { progress = 1; }
    if (a.code === 'first_performance' && earned) { progress = 1; }
    if (a.code === 'first_report' && earned) { progress = 1; }
    if (a.code === 'first_build' && earned) { progress = 1; }
    if (a.code === 'first_fps_check' && earned) { progress = 1; }
    if (a.code === 'profile_complete' && earned) { progress = 1; }

    if (earned && !earnedSet.has(a.id)) {
      db.prepare("INSERT INTO user_achievements (user_id, achievement_id, progress, earned_at) VALUES (?, ?, ?, datetime('now'))").run(userId, a.id, progress);
      earnedSet.add(a.id);
    }
    results.push({ ...a, earned, progress: Math.round(progress * 100), earnedAt: null });
  }
  return results;
}

export function getAchievements(userId) {
  return evaluateAchievements(userId);
}
