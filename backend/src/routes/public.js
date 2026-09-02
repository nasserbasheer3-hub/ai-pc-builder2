import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { db } from '../db.js';
import { ok, fail } from '../utils/helpers.js';
import { aiEnabled } from '../utils/ai.js';
import { sendMail } from '../utils/mailer.js';
import { config } from '../config.js';
import { partsDetail, totalPrice, resolvePart } from '../services/pcParts.js';

const router = Router();

// Tight per-IP limiter for the public contact form (anti-spam).
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many messages. Please try again later.' },
});

const CATEGORIES = [
  { key: 'cpus', table: 'cpus', label: 'CPUs' },
  { key: 'gpus', table: 'gpus', label: 'GPUs' },
  { key: 'motherboards', table: 'motherboards', label: 'Motherboards' },
  { key: 'memory', table: 'memory_modules', label: 'Memory kits' },
  { key: 'storage', table: 'storage', label: 'Storage' },
  { key: 'psus', table: 'psus', label: 'Power supplies' },
  { key: 'cases', table: 'cases', label: 'Cases' },
  { key: 'coolers', table: 'coolers', label: 'Coolers' },
];

function categoryCount(table) {
  return db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE enabled=1`).get().c;
}

function valuePicks(table, selectCols, limit = 5) {
  return db.prepare(`
    SELECT ${selectCols} FROM ${table}
    WHERE enabled=1 AND price_usd > 0
    ORDER BY CAST(performance_index AS REAL) / price_usd DESC
    LIMIT ?
  `).all(limit);
}

// GET /api/public/stats  (no auth — real, verifiable platform stats)
router.get('/stats', (req, res) => {
  const hardware = {};
  for (const c of CATEGORIES) hardware[c.key] = categoryCount(c.table);

  const games = db.prepare('SELECT COUNT(*) c FROM games WHERE enabled=1').get().c;
  const benchmarks = db.prepare('SELECT COUNT(*) c FROM benchmarks WHERE verified=1').get().c;
  const gameSettings = db.prepare('SELECT COUNT(*) c FROM game_settings WHERE verified=1').get().c;
  const achievements = db.prepare('SELECT COUNT(*) c FROM achievements').get().c;

  const sources = db.prepare('SELECT name, url, category, description, verified, last_verified_at FROM data_sources ORDER BY name').all();

  const gpuPicks = valuePicks('gpus', 'name, brand, chipset, vram_gb, performance_index, price_usd, price_date');
  const cpuPicks = valuePicks('cpus', 'name, brand, socket, cores, threads, performance_index, price_usd, price_date');

  ok(res, {
    hardware,
    games,
    benchmarks,
    gameSettings,
    achievements,
    sources,
    ai: { available: aiEnabled() },
    valuePicks: { gpus: gpuPicks, cpus: cpuPicks },
    generatedAt: new Date().toISOString(),
  });
});

// POST /api/public/contact — contact form (anti-spam: honeypot + tight rate limit)
router.post('/contact',
  contactLimiter,
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Please enter your name.'),
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required.'),
  body('message').trim().isLength({ min: 10, max: 4000 }).withMessage('Message must be at least 10 characters.'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
    }
    // Honeypot: bots that fill the invisible field get a silent "success".
    if (req.body._trap) return ok(res, { accepted: true });

    const { name, email, message } = req.body;
    try {
      const info = db.prepare(
        'INSERT INTO contact_messages (name, email, message, ip) VALUES (?, ?, ?, ?)'
      ).run(name, email, message, req.ip || null);

      sendMail(config.admin.email, `[LevelCore] Contact from ${name}`, `${name} (${email}):\n\n${message}`).catch(() => {});
      ok(res, { accepted: true, id: info.lastInsertRowid });
    } catch (err) {
      console.error('[contact] store failed:', err.message);
      fail(res, 500, 'INTERNAL', 'Could not store your message. Please try again later.');
    }
  });

// GET /api/public/build/:slug — a shareable build (link-shared, no auth).
router.get('/build/:slug', (req, res) => {
  const row = db.prepare(`
    SELECT b.id, b.name, b.category, b.resolution, b.target_fps, b.total_price, b.config_json,
           b.expected_fps, b.created_at, u.username, p.display_name
    FROM pc_builds b JOIN users u ON u.id = b.user_id
    LEFT JOIN profiles p ON p.user_id = b.user_id
    WHERE b.share_slug = ?
  `).get(req.params.slug);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'This shared build does not exist.');
  const config = JSON.parse(row.config_json || '{}');
  const parts = partsDetail(config);
  ok(res, {
    build: {
      id: row.id, name: row.name || 'Shared build', category: row.category, resolution: row.resolution,
      target_fps: row.target_fps, total_price: row.total_price || totalPrice(config),
      expected_fps: (() => { try { return JSON.parse(row.expected_fps || 'null'); } catch { return null; } })(),
      created_at: row.created_at, parts, partCount: Object.keys(parts).length,
      owner: { username: row.username, display_name: row.display_name || row.username },
    },
  });
});

// GET /api/public/profile/:slug — a public gamer profile (opt-in only).
router.get('/profile/:slug', (req, res) => {
  const p = db.prepare(`
    SELECT p.*, u.username, u.created_at as joined_at FROM profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.profile_slug = ? AND p.is_public = 1
  `).get(req.params.slug);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'This public profile does not exist.');
  const game = p.main_game_id ? db.prepare('SELECT id, name, cover_color, genre FROM games WHERE id=?').get(p.main_game_id) : null;
  const mainBuild = db.prepare(`
    SELECT id, name, category, resolution, target_fps, total_price, config_json, created_at
    FROM pc_builds WHERE user_id=? AND is_active=1 LIMIT 1
  `).get(p.user_id);
  const achievements = db.prepare(`
    SELECT a.code, a.name, a.tier FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id=? ORDER BY ua.earned_at DESC
  `).all(p.user_id);
  ok(res, {
    profile: {
      username: p.username, display_name: p.display_name || p.username, avatar: p.avatar, bio: p.bio,
      rank: p.rank, gaming_goals: p.gaming_goals, monitor_resolution: p.monitor_resolution,
      refresh_rate: p.refresh_rate, performance_preference: p.performance_preference,
      mainGame: game, joined_at: p.joined_at,
      hardware: {
        cpu: p.cpu_id ? resolvePart('cpu', p.cpu_id) : null,
        gpu: p.gpu_id ? resolvePart('gpu', p.gpu_id) : null,
        ram: p.ram_id ? resolvePart('ram', p.ram_id) : null,
        storage: p.storage_id ? resolvePart('storage', p.storage_id) : null,
      },
      mainBuild: mainBuild ? { ...mainBuild, parts: partsDetail(JSON.parse(mainBuild.config_json || '{}')), total: mainBuild.total_price || totalPrice(JSON.parse(mainBuild.config_json || '{}')) } : null,
      achievements,
    },
  });
});

export default router;
