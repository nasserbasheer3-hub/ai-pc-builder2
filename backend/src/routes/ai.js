import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId, daysAgoStr } from '../utils/helpers.js';
import { engineAdvice, buildWeeklyReport } from '../engines/insights.js';
import { aiComplete, aiStream, AIServiceError, aiEnabled, getSetting } from '../utils/ai.js';
import { getAchievements } from '../services/achievements.js';
import { InsufficientCreditsError } from '../services/credits.js';

const router = Router();
router.use(requireAuth);

const AI_ERROR_MSG = 'AI service is temporarily unavailable. Please try again later.';

function buildAdvicePrompt(user, profile, advice) {
  const lines = [
    `Player: ${user.username}`,
    `Profile: rank=${profile?.rank || 'unranked'}, main game=${(profile?.mainGame || {}).name || 'unknown'}, goals=${profile?.gaming_goals || 'not set'}`,
    'Engine analysis (real recorded data, last 7 days):',
    JSON.stringify(advice),
    'Provide personalized coaching: strengths, weaknesses, 2-3 concrete practice suggestions, trends, and game-specific tips. Keep it practical and concise.',
  ];
  return lines.join('\n');
}

// GET /api/ai/advice
// Engine advice is always free. The AI-generated part only runs — and only
// charges credits — when the user explicitly opts in via ?with_ai=1. This
// guarantees the dashboard never deducts credits just by being opened.
router.get('/advice', async (req, res) => {
  const profile = db.prepare(`
    SELECT profiles.*, g.name as mainGameName FROM profiles
    LEFT JOIN games g ON g.id = profiles.main_game_id WHERE profiles.user_id = ?
  `).get(req.user.id);

  const engine = engineAdvice(req.user.id);
  const response = { engine, ai: { available: false, content: null, error: null, reason: 'AI advice is only generated on request.' } };

  const wantAi = req.query.with_ai === '1' || req.query.with_ai === 'true';
  if (!wantAi) return ok(res, response);

  if (!aiEnabled()) {
    response.ai.error = AI_ERROR_MSG;
    response.ai.reason = 'No API key configured in the backend environment.';
    return ok(res, response);
  }

  try {
    const system = getSetting('ai_advice_prompt', 'You are a gaming performance coach.');
    const { content } = await aiComplete({ feature: 'advice', system, user: buildAdvicePrompt(req.user, profile, engine), user_id: req.user.id });
    response.ai = { available: true, content, reason: null };
    return ok(res, response);
  } catch (e) {
    response.ai.error = e instanceof InsufficientCreditsError ? e.message : (e instanceof AIServiceError ? e.message : AI_ERROR_MSG);
    response.ai.code = e instanceof InsufficientCreditsError ? 'INSUFFICIENT_CREDITS' : null;
    return ok(res, response);
  }
});

// GET /api/ai/weekly-report/latest
router.get('/weekly-report/latest', (req, res) => {
  const row = db.prepare('SELECT * FROM weekly_reports WHERE user_id=? ORDER BY week_start DESC LIMIT 1').get(req.user.id);
  if (!row) return ok(res, { report: null });
  ok(res, {
    report: {
      id: row.id,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      metrics: JSON.parse(row.metrics_json),
      comparison: row.comparison_json ? JSON.parse(row.comparison_json) : null,
      engineSummary: row.engine_summary,
      aiSummary: row.ai_summary,
      generatedAt: row.generated_at,
    },
  });
});

// GET /api/ai/weekly-report/history
router.get('/weekly-report/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM weekly_reports WHERE user_id=? ORDER BY week_start DESC LIMIT 12').all(req.user.id);
  ok(res, {
    items: rows.map((r) => {
      const metrics = JSON.parse(r.metrics_json || '{}');
      return {
        id: r.id,
        week_start: r.week_start,
        week_end: r.week_end,
        sessions: metrics.sessions ?? 0,
        win_rate: metrics.winRate ?? null,
        kd: metrics.kd ?? null,
        session_hours: metrics.sessionHours ?? 0,
        ai_summary: r.ai_summary,
        generated_at: r.generated_at,
      };
    }),
  });
});

// POST /api/ai/weekly-report/generate
router.post('/weekly-report/generate', async (req, res) => {
  const report = buildWeeklyReport(req.user.id, req.body?.weekStart || null);
  const profile = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
  getAchievements(req.user.id);

  let aiSummary = null;
  if (report.metrics.hasData && aiEnabled()) {
    try {
      const system = getSetting('ai_weekly_prompt', 'You are a gaming performance analyst.');
      const { content } = await aiComplete({
        feature: 'weekly_report',
        system,
        user: `Player: ${profile.username}\nWeekly metrics:\n${JSON.stringify(report.metrics)}\nComparison with previous week:\n${JSON.stringify(report.comparison)}\nEngine summary: ${report.engineSummary}\nWrite a concise weekly report.`,
        user_id: req.user.id,
      });
      aiSummary = content;
    } catch (e) {
      if (e instanceof InsufficientCreditsError) return fail(res, 402, 'INSUFFICIENT_CREDITS', e.message);
      aiSummary = null;
    }
  }

  db.prepare(`
    INSERT INTO weekly_reports (user_id, week_start, week_end, metrics_json, comparison_json, engine_summary, ai_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET
      metrics_json=excluded.metrics_json, comparison_json=excluded.comparison_json,
      engine_summary=excluded.engine_summary,
      ai_summary=excluded.ai_summary, generated_at=datetime('now')
  `).run(req.user.id, report.weekStart, report.weekEnd, JSON.stringify(report.metrics), JSON.stringify(report.comparison), report.engineSummary, aiSummary);

  ok(res, {
    report: {
      weekStart: report.weekStart,
      weekEnd: report.weekEnd,
      metrics: report.metrics,
      comparison: report.comparison,
      engineSummary: report.engineSummary,
      aiSummary,
      aiAvailable: aiSummary != null,
    },
  });
});

// ---------- AI Chat (customer / player assistant) ----------

function catalogDigest() {
  const parts = [];
  const gpus = db.prepare("SELECT name, price_usd, performance_index, vram_gb FROM gpus WHERE enabled=1 ORDER BY performance_index DESC").all();
  parts.push('GPUs (verified, price USD):\n' + gpus.map((g) => `- ${g.name}: $${g.price_usd}, perf index ${g.performance_index}, ${g.vram_gb}GB VRAM`).join('\n'));
  const cpus = db.prepare("SELECT name, price_usd, performance_index, cores, threads FROM cpus WHERE enabled=1 ORDER BY performance_index DESC").all();
  parts.push('CPUs (verified, price USD):\n' + cpus.map((c) => `- ${c.name}: $${c.price_usd}, perf index ${c.performance_index}, ${c.cores}C/${c.threads}T`).join('\n'));
  const games = db.prepare('SELECT name, genre FROM games WHERE enabled=1 ORDER BY name').all();
  parts.push('Supported games: ' + games.map((g) => `${g.name} (${g.genre})`).join(', '));
  return parts.join('\n\n');
}

function buildChatSystem(user, profile) {
  const pc = profile ? [
    profile.cpu_id ? `CPU id ${profile.cpu_id}` : null,
    profile.gpu_id ? `GPU id ${profile.gpu_id}` : null,
    profile.monitor_resolution ? `monitor ${profile.monitor_resolution}` : null,
    `${profile.refresh_rate || 60}Hz`,
  ].filter(Boolean).join(', ') : 'not set';
  return [
    'You are the ApexCore Assistant, a helpful chat assistant for players and customers of the ApexCore gaming performance platform.',
    'The platform tracks gaming sessions, performance (win rate, K/D), improvement streaks, weekly reports, and offers PC tools: AI PC Builder, Compatibility Checker, FPS Calculator, Upgrade Advisor, Game Settings and a Hardware Catalog.',
    `Current user: ${user.username}. Profile: rank=${profile?.rank || 'unranked'}, main game=${profile?.mainGameName || 'unknown'}, goals=${profile?.gaming_goals || 'not set'}, PC=${pc}.`,
    'VERIFIED DATA AVAILABLE (use ONLY this data for hardware/fps/prices, never invent):',
    catalogDigest(),
    'Rules:',
    '- Help with platform usage, gaming improvement, PC building, compatibility, FPS estimates and upgrades.',
    '- NEVER invent hardware specs, prices, FPS numbers, benchmarks or user statistics. Use only the verified data above.',
    '- If you are unsure or the data is not available, say so honestly and suggest using the relevant tool (e.g. the FPS Calculator or Compatibility Checker).',
    '- Label claims: Verified data (from the catalog), Estimate (rough guidance), Recommendation (opinion).',
    '- Be concise, friendly and practical. Use short paragraphs or bullet points.',
  ].join('\n');
}

// POST /api/ai/chat  (SSE streaming)
// Body: { messages: [{ role: 'user'|'assistant', content }] }
router.post('/chat', async (req, res) => {
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  const last = msgs.filter((m) => m?.role === 'user').slice(-1)[0];
  if (!last?.content || !String(last.content).trim()) {
    return fail(res, 422, 'VALIDATION', 'A message is required.');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  if (!aiEnabled()) {
    send('error', { message: AI_ERROR_MSG });
    return res.end();
  }

  try {
    const profile = db.prepare(`
      SELECT profiles.*, g.name as mainGameName FROM profiles
      LEFT JOIN games g ON g.id = profiles.main_game_id WHERE profiles.user_id = ?
    `).get(req.user.id);
    const user = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
    const system = getSetting('ai_chat_prompt', buildChatSystem(user, profile));
    const convo = msgs
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 2000)}`)
      .join('\n');

    for await (const chunk of aiStream({ system, user: convo, user_id: req.user.id })) {
      send('delta', { content: chunk.token });
    }
    send('done', {});
  } catch (e) {
    const msg = e instanceof InsufficientCreditsError ? e.message : (e instanceof AIServiceError ? e.message : AI_ERROR_MSG);
    send('error', { message: msg, code: e instanceof InsufficientCreditsError ? 'INSUFFICIENT_CREDITS' : undefined });
  } finally {
    res.end();
  }
});

// ---------- AI Coach (session debrief, game coach, improvement plan) ----------

function getProfile(userId) {
  return db.prepare(`
    SELECT profiles.*, g.name as mainGameName FROM profiles
    LEFT JOIN games g ON g.id = profiles.main_game_id WHERE profiles.user_id = ?
  `).get(userId);
}

function gameStatsFor(userId, gameId, fromDate) {
  const p = db.prepare(`
    SELECT COALESCE(SUM(wins),0) wins, COALESCE(SUM(losses),0) losses,
           COALESCE(SUM(kills),0) kills, COALESCE(SUM(deaths),0) deaths,
           COALESCE(SUM(matches),0) matches
    FROM performance_records WHERE user_id=? AND game_id=? AND record_date >= ?
  `).get(userId, gameId, fromDate);
  const m = p.matches > 0 ? p.matches : p.wins + p.losses;
  return {
    matches: m,
    wins: p.wins,
    losses: p.losses,
    kills: p.kills,
    deaths: p.deaths,
    winRate: m > 0 ? Math.round((p.wins / m) * 1000) / 10 : null,
    kd: p.deaths > 0 ? Math.round((p.kills / p.deaths) * 100) / 100 : null,
  };
}

function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

// POST /api/ai/session/:id/debrief  (SSE)
router.post('/session/:id/debrief', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 422, 'VALIDATION', 'Invalid session id.');
  const s = db.prepare(`
    SELECT s.*, g.name as game_name, g.genre, g.description FROM gaming_sessions s
    LEFT JOIN games g ON g.id = s.game_id WHERE s.id=? AND s.user_id=?
  `).get(id, req.user.id);
  if (!s) return fail(res, 404, 'NOT_FOUND', 'Session not found.');
  if (s.status !== 'ended') return fail(res, 422, 'VALIDATION', 'End the session before asking for a debrief.');

  const send = openSse(res);
  if (!aiEnabled()) { send('error', { message: AI_ERROR_MSG }); return res.end(); }

  const perf = db.prepare('SELECT wins, losses, kills, deaths, assists, matches FROM performance_records WHERE session_id=?').get(id);
  const stats = s.game_id ? gameStatsFor(req.user.id, s.game_id, daysAgoStr(29)) : null;
  const context = [
    `Session: game=${s.game_name || 'not specified'}, duration=${s.duration_minutes || 0} minutes, started=${s.started_at}, note=${s.note || 'none'}`,
    `Game catalog entry: genre=${s.genre || 'unknown'}${s.description ? `, description="${s.description}"` : ''}`,
    perf
      ? `Session performance (recorded): ${perf.matches} match(es), ${perf.wins}W / ${perf.losses}L, ${perf.kills} kills, ${perf.deaths} deaths, ${perf.assists} assists`
      : 'No performance record was attached to this session.',
    stats ? `Your recorded stats for this game over the last 30 days: ${stats.matches} matches, ${stats.winRate}% win rate, K/D ${stats.kd}` : '',
    'Write a concise post-session debrief: what the numbers say, one or two things that stood out, and 2-3 concrete things to focus on next time. Never invent numbers that are not listed above. Label verified facts (Verified) and advice (Recommendation).',
  ].filter(Boolean).join('\n');

  try {
    const system = getSetting('ai_session_prompt', 'You are a focused, friendly gaming session coach.');
    for await (const chunk of aiStream({ system, user: context, user_id: req.user.id, feature: 'session_coach' })) {
      send('delta', { content: chunk.token });
    }
    send('done', {});
  } catch (e) {
    const msg = e instanceof InsufficientCreditsError ? e.message : (e instanceof AIServiceError ? e.message : AI_ERROR_MSG);
    send('error', { message: msg, code: e instanceof InsufficientCreditsError ? 'INSUFFICIENT_CREDITS' : undefined });
  } finally {
    res.end();
  }
});

// POST /api/ai/game/:id/coach  (SSE)
router.post('/game/:id/coach', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 422, 'VALIDATION', 'Invalid game id.');
  const g = db.prepare('SELECT id, name, slug, genre, publisher, release_year, description FROM games WHERE id=? AND enabled=1').get(id);
  if (!g) return fail(res, 404, 'NOT_FOUND', 'Game not found.');

  const send = openSse(res);
  if (!aiEnabled()) { send('error', { message: AI_ERROR_MSG }); return res.end(); }

  const profile = getProfile(req.user.id);
  const recent = gameStatsFor(req.user.id, id, daysAgoStr(29));
  const context = [
    `Game (verified catalog): ${g.name} (${g.genre || 'genre unknown'}, ${g.release_year || 'year unknown'}, publisher: ${g.publisher || 'unknown'}). Description: ${g.description || 'none'}`,
    `Player: ${req.user.username}, rank=${profile?.rank || 'unranked'}, main game=${profile?.mainGameName || 'unknown'}, goals=${profile?.gaming_goals || 'not set'}`,
    `Player's recorded stats for this game, last 30 days: ${recent.matches} matches, ${recent.winRate}% win rate, K/D ${recent.kd}`,
    'Give practical coaching for this game tailored to the player: how to improve given their real stats, what to practice, and 2-3 concrete drills or habits. Game-mechanic tips are general recommendations, never claimed as platform-verified data. Never invent player statistics.',
  ].filter(Boolean).join('\n');

  try {
    const system = getSetting('ai_game_prompt', 'You are a knowledgeable gaming coach for a specific title.');
    for await (const chunk of aiStream({ system, user: context, user_id: req.user.id, feature: 'game_coach' })) {
      send('delta', { content: chunk.token });
    }
    send('done', {});
  } catch (e) {
    const msg = e instanceof InsufficientCreditsError ? e.message : (e instanceof AIServiceError ? e.message : AI_ERROR_MSG);
    send('error', { message: msg, code: e instanceof InsufficientCreditsError ? 'INSUFFICIENT_CREDITS' : undefined });
  } finally {
    res.end();
  }
});

// POST /api/ai/plan/generate  (SSE; persists the finished plan)
router.post('/plan/generate', async (req, res) => {
  const send = openSse(res);
  if (!aiEnabled()) { send('error', { message: AI_ERROR_MSG }); return res.end(); }

  const profile = getProfile(req.user.id);
  const advice = engineAdvice(req.user.id);
  const lastReport = db.prepare('SELECT engine_summary, ai_summary FROM weekly_reports WHERE user_id=? ORDER BY week_start DESC LIMIT 1').get(req.user.id);
  const focus = String(req.body?.focus || 'overall improvement').slice(0, 120);
  const context = [
    `Player: ${req.user.username}, rank=${profile?.rank || 'unranked'}, main game=${profile?.mainGameName || 'unknown'}, goals=${profile?.gaming_goals || 'not set'}. Plan focus: ${focus}`,
    'Engine analysis (real recorded data, last 7 days):',
    JSON.stringify(advice),
    lastReport ? `Latest weekly report engine summary: ${lastReport.engine_summary}` : '',
    'Create a personalized, practical improvement plan: 2 phases (Weeks 1-2, Weeks 3-4), each with clear goals, daily/weekly habits, and specific practice steps tied to the player\'s actual strengths, weaknesses and goals. Use ONLY the provided data; never invent player statistics. Keep it structured and actionable.',
  ].filter(Boolean).join('\n');

  let planText = '';
  try {
    const system = getSetting('ai_plan_prompt', 'You are a gaming improvement coach who writes personalized training plans.');
    for await (const chunk of aiStream({ system, user: context, user_id: req.user.id, feature: 'plan', maxTokens: 1600 })) {
      planText += chunk.token;
      send('delta', { content: chunk.token });
    }
    if (planText) {
      db.prepare(`
        INSERT INTO ai_plans (user_id, focus, plan_text, created_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET focus=excluded.focus, plan_text=excluded.plan_text, created_at=excluded.created_at
      `).run(req.user.id, focus, planText);
    }
    send('done', {});
  } catch (e) {
    const msg = e instanceof InsufficientCreditsError ? e.message : (e instanceof AIServiceError ? e.message : AI_ERROR_MSG);
    send('error', { message: msg, code: e instanceof InsufficientCreditsError ? 'INSUFFICIENT_CREDITS' : undefined });
  } finally {
    res.end();
  }
});

// GET /api/ai/plan/latest
router.get('/plan/latest', (req, res) => {
  const row = db.prepare('SELECT focus, plan_text, created_at FROM ai_plans WHERE user_id=?').get(req.user.id);
  ok(res, { plan: row ? { focus: row.focus, text: row.plan_text, createdAt: row.created_at } : null });
});

export default router;
