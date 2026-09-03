import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ok, fail, parseId, sha256 } from '../utils/helpers.js';
import { grantCredits, deductCredits, getWallet, getActivePlan, ensureFreePlan } from '../services/credits.js';
import { isStripeConfigured, isWebhookConfigured, refundStripePayment, netRevenueSek, stripeKeys, maskSecret, resetStripeClient, sanitizeKey, listActivePlans, activatePaidPlan, revokeTopupCredits } from '../services/payments.js';
import { adminReferralSummary } from '../services/referrals.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP and GIF images are allowed.'));
  },
});

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts.' } });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

function signAdmin(admin) {
  return jwt.sign({ sub: admin.id, type: 'admin', role: admin.role }, config.jwtAdminSecret, { expiresIn: '12h' });
}

function audit(admin, action, targetType = null, targetId = null, details = null, ip = null) {
  db.prepare('INSERT INTO audit_logs (admin_user_id, action, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(admin.id, action, targetType, targetId, details ? JSON.stringify(details) : null, ip || reqIp());
  function reqIp() { return null; }
}

const HW = {
  cpus: { table: 'cpus', nameField: 'name', json: [] },
  gpus: { table: 'gpus', nameField: 'name', json: ['power_connectors', 'supports_upscaling'] },
  motherboards: { table: 'motherboards', nameField: 'name', json: [] },
  ram: { table: 'memory_modules', nameField: 'name', json: [] },
  storage: { table: 'storage', nameField: 'name', json: [] },
  psus: { table: 'psus', nameField: 'name', json: [] },
  cases: { table: 'cases', nameField: 'name', json: ['form_factors', 'radiator_support'] },
  coolers: { table: 'coolers', nameField: 'name', json: ['socket_support'] },
};

function columnsOf(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// POST /api/admin/login  (fully separate from user auth)
router.post('/login', limiter,
  body('email').isEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
  validate, (req, res) => {
    const em = String(req.body.email).toLowerCase();
    const admin = db.prepare('SELECT * FROM admin_users WHERE email=?').get(em);
    if (!admin || !bcrypt.compareSync(req.body.password, admin.password_hash)) {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect admin credentials.');
    }
    if (admin.status !== 'active') return fail(res, 403, 'ADMIN_DISABLED', 'This admin account is disabled.');
    db.prepare('UPDATE admin_users SET updated_at=? WHERE id=?').run(now(), admin.id);
    audit(admin, 'admin_login');
    ok(res, { token: signAdmin(admin), admin: { id: admin.id, email: admin.email, role: admin.role } });
  });

// GET /api/admin/setup-status  (public) - can the first admin still be created?
router.get('/setup-status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) c FROM admin_users').get().c;
  const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_setup_token'").get();
  let active = false;
  if (row && row.value) {
    const [, , exp] = String(row.value).split(':');
    active = !!(exp && Date.now() < Number(exp));
  }
  ok(res, { adminExists: count > 0, setupTokenActive: active });
});

// POST /api/admin/setup  (public, one-time) - create the very first admin with a
// token printed in the server logs. Fails as soon as any admin account exists.
router.post('/setup', limiter,
  body('token').trim().notEmpty().withMessage('Setup token required.'),
  body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters.'),
  validate, (req, res) => {
    const count = db.prepare('SELECT COUNT(*) c FROM admin_users').get().c;
    if (count > 0) return fail(res, 409, 'ADMIN_EXISTS', 'An admin account already exists. Sign in at /admin/login instead.');
    const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_setup_token'").get();
    if (!row || !row.value || !row.value.startsWith('v1:')) return fail(res, 403, 'NO_SETUP', 'No active setup token. Redeploy to generate one.');
    const [, hash, exp] = String(row.value).split(':');
    if (!hash || !exp || Date.now() > Number(exp)) return fail(res, 403, 'TOKEN_EXPIRED', 'This setup token has expired. Redeploy to generate a fresh one.');
    if (hash !== sha256(String(req.body.token).trim())) return fail(res, 403, 'BAD_TOKEN', 'Invalid setup token. Copy it from the server logs.');
    const em = String(req.body.email).toLowerCase();
    if (db.prepare('SELECT id FROM admin_users WHERE email = ?').get(em)) {
      return fail(res, 409, 'EMAIL_TAKEN', 'An admin with this email already exists.');
    }
    const ph = bcrypt.hashSync(String(req.body.password), 10);
    db.prepare('INSERT INTO admin_users (email, password_hash, role, status) VALUES (?, ?, ?, ?)')
      .run(em, ph, 'superadmin', 'active');
    db.prepare("DELETE FROM admin_settings WHERE key = 'admin_setup_token'").run();
    const admin = db.prepare('SELECT id, email, role FROM admin_users WHERE email = ?').get(em);
    audit(admin, 'admin_setup');
    ok(res, { token: signAdmin(admin), admin: { id: admin.id, email: admin.email, role: admin.role } });
  });

router.use(requireAdmin);

// POST /api/admin/uploads  (single image, admin only)
router.post('/uploads', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return fail(res, 400, 'UPLOAD_ERROR', err.message);
    if (!req.file) return fail(res, 400, 'UPLOAD_REQUIRED', 'No image file received.');
    audit(req.admin, 'upload_image', null, null, { name: req.file.filename });
    ok(res, { url: `/uploads/${req.file.filename}`, name: req.file.filename });
  });
});

// DELETE /api/admin/uploads/:name  (remove an uploaded image)
router.delete('/uploads/:name', (req, res) => {
  const name = String(req.params.name).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name) return fail(res, 400, 'BAD_NAME', 'Invalid filename.');
  const file = path.join(UPLOAD_DIR, name);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return fail(res, 404, 'NOT_FOUND', 'File not found.');
  fs.unlinkSync(file);
  audit(req.admin, 'delete_image', null, null, { name });
  ok(res, { deleted: true });
});

// POST /api/admin/change-password  (self-service; current password required)
router.post('/change-password',
  body('currentPassword').notEmpty().withMessage('Current password required.'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  validate, (req, res) => {
    const admin = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.admin.id);
    if (!admin || !bcrypt.compareSync(String(req.body.currentPassword), admin.password_hash)) {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    if (bcrypt.compareSync(String(req.body.newPassword), admin.password_hash)) {
      return fail(res, 422, 'VALIDATION', 'New password must be different from the current one.');
    }
    db.prepare('UPDATE admin_users SET password_hash=?, updated_at=? WHERE id=?')
      .run(bcrypt.hashSync(String(req.body.newPassword), 10), now(), admin.id);
    audit(req.admin, 'admin_password_change');
    ok(res, { updated: true });
  });

// GET /api/admin/me
router.get('/me', (req, res) => {
  ok(res, { admin: { id: req.admin.id, email: req.admin.email, role: req.admin.role } });
});

// ---- Users ----
router.get('/users', query('q').optional(), query('status').optional(), query('page').optional().isInt({ min: 1 }), validate, (req, res) => {
  const q = req.query.q || '';
  const status = req.query.status || '';
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = 20;
  let where = 'WHERE 1=1';
  const params = [];
  if (q) { where += ' AND (username LIKE ? OR email LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) c FROM users ${where}`).get(...params).c;
  const users = db.prepare(`SELECT u.id, u.username, u.email, u.status, u.email_verified, u.created_at, u.last_login_at,
    (SELECT COUNT(*) FROM gaming_sessions s WHERE s.user_id=u.id) as sessions,
    (SELECT COUNT(*) FROM performance_records p WHERE p.user_id=u.id) as records
    FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  ok(res, { users, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.patch('/users/:id', param('id').isInt(), body('status').isIn(['active', 'suspended']).withMessage('Invalid status.'), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  db.prepare('UPDATE users SET status=?, updated_at=? WHERE id=?').run(req.body.status, now(), id);
  audit(req.admin, req.body.status === 'suspended' ? 'user_suspend' : 'user_unsuspend', 'user', id);
  ok(res, { updated: true, status: req.body.status });
});

router.delete('/users/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  audit(req.admin, 'user_delete', 'user', id);
  ok(res, { deleted: true });
});

// GET /api/admin/users/:id — full detail for the management panel
router.get('/users/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare(`
    SELECT u.id, u.username, u.email, u.status, u.email_verified, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM gaming_sessions s WHERE s.user_id=u.id) as sessions,
      (SELECT COUNT(*) FROM performance_records p WHERE p.user_id=u.id) as records
    FROM users u WHERE u.id=?
  `).get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  ok(res, {
    user,
    wallet: getWallet(id),
    subscription: getActivePlan(id),
    plans: listActivePlans().map((p) => ({ id: p.id, name: p.name, slug: p.slug, price_sek: p.price_sek, monthly_credits: p.monthly_credits, is_free: p.is_free })),
    ledger: db.prepare(`
      SELECT id, delta, balance_after, reason, feature, created_at
      FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT 30
    `).all(id),
    payments: db.prepare(`
      SELECT id, plan_id, amount_sek, method, status, created_at, paid_at
      FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 10
    `).all(id),
  });
});

// POST /api/admin/users/:id/credits — grant (+) or withdraw (−) credits
router.post('/users/:id/credits', param('id').isInt(), body('delta').exists().withMessage('Amount is required.'), body('reason').optional().isString().isLength({ max: 200 }), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id, username FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  const delta = Math.trunc(Number(req.body.delta) || 0);
  if (delta === 0) return fail(res, 400, 'VALIDATION', 'Amount must not be zero.');
  const reason = String(req.body.reason || '').trim().slice(0, 200) || (delta > 0 ? 'admin_grant' : 'admin_deduct');
  let wallet;
  if (delta > 0) {
    wallet = grantCredits(id, delta, reason, { feature: 'admin', refType: 'admin', refId: req.admin.id });
  } else {
    wallet = deductCredits(id, delta, reason, { feature: 'admin', refType: 'admin', refId: req.admin.id });
  }
  audit(req.admin, delta > 0 ? 'user_credits_grant' : 'user_credits_deduct', 'user', id, { delta, reason, balance: wallet.balance });
  ok(res, { wallet });
});

// POST /api/admin/users/:id/plan — manually set the user's active plan
router.post('/users/:id/plan', param('id').isInt(), body('plan_id').isInt({ min: 1 }), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND is_active=1').get(parseId(req.body.plan_id));
  if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
  const current = getActivePlan(id);
  if (current && current.plan_id === plan.id && current.status === 'active') {
    return fail(res, 409, 'ALREADY_ON_PLAN', 'The user is already on this plan.');
  }
  const subscription = activatePaidPlan(id, plan, 'admin', `admin_${req.admin.id}`);
  audit(req.admin, 'user_plan_change', 'user', id, { plan_id: plan.id, plan_name: plan.name });
  ok(res, { subscription, wallet: getWallet(id) });
});

// POST /api/admin/users/:id/password — reset the user's password
router.post('/users/:id/password', param('id').isInt(), body('new_password').isLength({ min: 8, max: 128 }).withMessage('New password must be at least 8 characters.'), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  const hash = bcrypt.hashSync(req.body.new_password, 10);
  db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(hash, now(), id);
  audit(req.admin, 'user_password_reset', 'user', id);
  ok(res, { reset: true });
});

// POST /api/admin/users/:id/verify-email — mark the user's email as verified
router.post('/users/:id/verify-email', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  db.prepare('UPDATE users SET email_verified=1, updated_at=? WHERE id=?').run(now(), id);
  audit(req.admin, 'user_verify_email', 'user', id);
  ok(res, { verified: true });
});

// ---- Games ----
router.get('/games', (req, res) => {
  ok(res, { games: db.prepare('SELECT * FROM games ORDER BY name').all() });
});

router.post('/games', body('name').notEmpty().withMessage('Name required.'), body('slug').notEmpty().withMessage('Slug required.'), validate, (req, res) => {
  try {
    const id = db.prepare('INSERT INTO games (name, slug, genre, publisher, release_year, description, cover_color, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.body.name, req.body.slug, req.body.genre || null, req.body.publisher || null, req.body.release_year || null, req.body.description || null, req.body.cover_color || '#444', req.body.enabled === false ? 0 : 1).lastInsertRowid;
    audit(req.admin, 'game_create', 'game', id);
    ok(res, { id });
  } catch (e) {
    return fail(res, 409, 'DUPLICATE', 'A game with this slug already exists.');
  }
});

router.patch('/games/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const game = db.prepare('SELECT id FROM games WHERE id=?').get(id);
  if (!game) return fail(res, 404, 'NOT_FOUND', 'Game not found.');
  const sets = [];
  const vals = [];
  for (const f of ['name', 'slug', 'genre', 'publisher', 'description', 'cover_color', 'release_year']) {
    if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (req.body.enabled !== undefined) { sets.push('enabled=?'); vals.push(req.body.enabled ? 1 : 0); }
  if (sets.length) db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  audit(req.admin, 'game_update', 'game', id);
  ok(res, { updated: true });
});

router.delete('/games/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  db.prepare('DELETE FROM games WHERE id=?').run(id);
  audit(req.admin, 'game_delete', 'game', id);
  ok(res, { deleted: true });
});

// ---- Hardware CRUD ----
router.get('/hardware/:category', (req, res) => {
  const def = HW[req.params.category];
  if (!def) return fail(res, 404, 'NOT_FOUND', 'Unknown category.');
  ok(res, { items: db.prepare(`SELECT * FROM ${def.table} ORDER BY name`).all() });
});

router.post('/hardware/:category', (req, res) => {
  const def = HW[req.params.category];
  if (!def) return fail(res, 404, 'NOT_FOUND', 'Unknown category.');
  const allowed = columnsOf(def.table).filter((c) => !['id', 'created_at'].includes(c));
  const data = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k) && v !== undefined && v !== null) {
      data[k] = def.json.includes(k) ? JSON.stringify(v) : v;
    }
  }
  if (!data.name) return fail(res, 422, 'VALIDATION', 'name is required.');
  data.enabled = data.enabled ?? 1;
  try {
    const keys = Object.keys(data);
    const id = db.prepare(`INSERT INTO ${def.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => data[k])).lastInsertRowid;
    audit(req.admin, 'hardware_create', req.params.category, id);
    ok(res, { id });
  } catch (e) {
    return fail(res, 400, 'INSERT_FAILED', e.message);
  }
});

router.patch('/hardware/:category/:id', param('id').isInt(), validate, (req, res) => {
  const def = HW[req.params.category];
  if (!def) return fail(res, 404, 'NOT_FOUND', 'Unknown category.');
  const id = parseId(req.params.id);
  const allowed = columnsOf(def.table).filter((c) => !['id', 'created_at'].includes(c));
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k}=?`);
      vals.push(def.json.includes(k) && v !== null ? JSON.stringify(v) : v);
    }
  }
  if (sets.length) db.prepare(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  audit(req.admin, 'hardware_update', req.params.category, id);
  ok(res, { updated: true });
});

router.delete('/hardware/:category/:id', param('id').isInt(), validate, (req, res) => {
  const def = HW[req.params.category];
  if (!def) return fail(res, 404, 'NOT_FOUND', 'Unknown category.');
  const id = parseId(req.params.id);
  db.prepare(`DELETE FROM ${def.table} WHERE id=?`).run(id);
  audit(req.admin, 'hardware_delete', req.params.category, id);
  ok(res, { deleted: true });
});

// ---- Compatibility rules ----
router.get('/compatibility', (req, res) => {
  ok(res, { rules: db.prepare('SELECT * FROM compatibility_rules ORDER BY rule_type').all() });
});

router.post('/compatibility',
  body('rule_type').notEmpty().withMessage('rule_type required.'),
  body('subject').notEmpty().withMessage('subject required.'),
  body('allowed_values').isArray({ min: 1 }).withMessage('allowed_values must be an array.'),
  validate, (req, res) => {
    const id = db.prepare('INSERT INTO compatibility_rules (rule_type, subject, allowed_values, severity, note) VALUES (?, ?, ?, ?, ?)')
      .run(req.body.rule_type, req.body.subject, JSON.stringify(req.body.allowed_values), req.body.severity || 'error', req.body.note || null).lastInsertRowid;
    audit(req.admin, 'rule_create', 'compatibility', id);
    ok(res, { id });
  });

router.patch('/compatibility/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const sets = [];
  const vals = [];
  if (req.body.rule_type !== undefined) { sets.push('rule_type=?'); vals.push(req.body.rule_type); }
  if (req.body.subject !== undefined) { sets.push('subject=?'); vals.push(req.body.subject); }
  if (req.body.allowed_values !== undefined) { sets.push('allowed_values=?'); vals.push(JSON.stringify(req.body.allowed_values)); }
  if (req.body.severity !== undefined) { sets.push('severity=?'); vals.push(req.body.severity); }
  if (req.body.note !== undefined) { sets.push('note=?'); vals.push(req.body.note); }
  if (req.body.enabled !== undefined) { sets.push('enabled=?'); vals.push(req.body.enabled ? 1 : 0); }
  if (sets.length) db.prepare(`UPDATE compatibility_rules SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  audit(req.admin, 'rule_update', 'compatibility', id);
  ok(res, { updated: true });
});

router.delete('/compatibility/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  db.prepare('DELETE FROM compatibility_rules WHERE id=?').run(id);
  audit(req.admin, 'rule_delete', 'compatibility', id);
  ok(res, { deleted: true });
});

// ---- Benchmarks ----
router.get('/benchmarks', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, g.name game_name, gpu.name gpu_name, cpu.name cpu_name, ds.name source_name
    FROM benchmarks b
    JOIN games g ON g.id=b.game_id
    JOIN gpus gpu ON gpu.id=b.gpu_id
    LEFT JOIN cpus cpu ON cpu.id=b.cpu_id
    LEFT JOIN data_sources ds ON ds.id=b.source_id
    ORDER BY b.benchmark_date DESC LIMIT 300
  `).all();
  ok(res, { benchmarks: rows });
});

router.post('/benchmarks',
  body('game_id').isInt(), body('gpu_id').isInt(), body('resolution').notEmpty(), body('quality').notEmpty(),
  body('avg_fps').isFloat({ min: 1 }),
  validate, (req, res) => {
    try {
      const id = db.prepare(`
        INSERT INTO benchmarks (game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling, avg_fps, pct1_low, benchmark_date, notes, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling) DO UPDATE SET
          avg_fps=excluded.avg_fps, pct1_low=excluded.pct1_low, benchmark_date=excluded.benchmark_date, notes=excluded.notes
      `).run(req.body.game_id, req.body.cpu_id || null, req.body.gpu_id, req.body.resolution, req.body.quality,
        req.body.rt_enabled ? 1 : 0, req.body.upscaling || 'None', req.body.avg_fps, req.body.pct1_low || null,
        req.body.benchmark_date || now().slice(0, 10), req.body.notes || null, req.body.verified === false ? 0 : 1).lastInsertRowid;
      audit(req.admin, 'benchmark_upsert', 'benchmark', id);
      ok(res, { id });
    } catch (e) {
      return fail(res, 400, 'INSERT_FAILED', e.message);
    }
  });

router.patch('/benchmarks/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const sets = [];
  const vals = [];
  for (const f of ['game_id', 'cpu_id', 'gpu_id', 'resolution', 'quality', 'avg_fps', 'pct1_low', 'benchmark_date', 'notes', 'upscaling']) {
    if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (req.body.rt_enabled !== undefined) { sets.push('rt_enabled=?'); vals.push(req.body.rt_enabled ? 1 : 0); }
  if (req.body.verified !== undefined) { sets.push('verified=?'); vals.push(req.body.verified ? 1 : 0); }
  if (sets.length) db.prepare(`UPDATE benchmarks SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  audit(req.admin, 'benchmark_update', 'benchmark', id);
  ok(res, { updated: true });
});

router.delete('/benchmarks/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  db.prepare('DELETE FROM benchmarks WHERE id=?').run(id);
  audit(req.admin, 'benchmark_delete', 'benchmark', id);
  ok(res, { deleted: true });
});

// ---- Community benchmark moderation ----
// GET /api/admin/community/benchmarks — moderation queue with counts
router.get('/community/benchmarks',
  query('status').optional().isIn(['pending', 'approved', 'hidden', 'rejected', 'all']).withMessage('Invalid status.'),
  query('q').optional().isString().isLength({ max: 80 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  validate, (req, res) => {
    const status = req.query.status || 'all';
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Number(req.query.offset) || 0;
    const conds = [];
    const params = [];
    if (status !== 'all') { conds.push('cb.status=?'); params.push(status); }
    if (req.query.q) { conds.push('(g.name LIKE ? OR gpu.name LIKE ? OR cpu.name LIKE ? OR u.username LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q, q); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT cb.*, g.name game_name, gpu.name gpu_name, cpu.name cpu_name,
        u.username, p.display_name, adm.email reviewed_by_email
      FROM community_benchmarks cb
      JOIN games g ON g.id=cb.game_id
      JOIN gpus gpu ON gpu.id=cb.gpu_id
      LEFT JOIN cpus cpu ON cpu.id=cb.cpu_id
      JOIN users u ON u.id=cb.user_id
      LEFT JOIN profiles p ON p.user_id=u.id
      LEFT JOIN admin_users adm ON adm.id=cb.reviewed_by
      ${where}
      ORDER BY CASE cb.status WHEN 'pending' THEN 0 ELSE 1 END, cb.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) c FROM community_benchmarks cb ${where}`).get(...params).c;
    const counts = {
      pending: db.prepare("SELECT COUNT(*) c FROM community_benchmarks WHERE status='pending'").get().c,
      approved: db.prepare("SELECT COUNT(*) c FROM community_benchmarks WHERE status='approved'").get().c,
      hidden: db.prepare("SELECT COUNT(*) c FROM community_benchmarks WHERE status='hidden'").get().c,
      rejected: db.prepare("SELECT COUNT(*) c FROM community_benchmarks WHERE status='rejected'").get().c,
    };
    ok(res, { rows, total, counts });
  });

// PATCH /api/admin/community/benchmarks/:id/status — moderate a submission
router.patch('/community/benchmarks/:id/status',
  param('id').isInt(),
  body('status').isIn(['pending', 'approved', 'hidden', 'rejected']).withMessage('Invalid status.'),
  body('review_note').optional().isString().isLength({ max: 300 }),
  validate, (req, res) => {
    const id = parseId(req.params.id);
    const row = db.prepare('SELECT * FROM community_benchmarks WHERE id=?').get(id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Submission not found.');
    const status = req.body.status;
    db.prepare(`
      UPDATE community_benchmarks
      SET status=?, review_note=?, reviewed_by=?, reviewed_at=?
      WHERE id=?
    `).run(status,
      req.body.review_note !== undefined ? String(req.body.review_note).trim().slice(0, 300) : row.review_note,
      req.admin.id,
      ['pending'].includes(status) ? row.reviewed_at : now(),
      id);
    audit(req.admin, 'community_bench_review', 'community_benchmark', id,
      { from: row.status, to: status, note: req.body.review_note || null });
    ok(res, { updated: true, status });
  });

// POST /api/admin/community/benchmarks/:id/promote — move an approved result
// into the staff-verified `benchmarks` anchor table (explicit staff curation).
router.post('/community/benchmarks/:id/promote',
  param('id').isInt(),
  validate, (req, res) => {
    const id = parseId(req.params.id);
    const row = db.prepare('SELECT * FROM community_benchmarks WHERE id=?').get(id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Submission not found.');
    if (row.status !== 'approved') return fail(res, 400, 'NOT_APPROVED', 'Only approved submissions can be promoted.');
    if (row.promoted) return fail(res, 409, 'ALREADY_PROMOTED', 'This submission was already promoted.');
    const benchId = db.prepare(`
      INSERT INTO benchmarks (game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling, avg_fps, pct1_low, benchmark_date, notes, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling) DO UPDATE SET
        avg_fps=excluded.avg_fps, pct1_low=excluded.pct1_low, notes=excluded.notes, benchmark_date=excluded.benchmark_date, verified=1
    `).run(row.game_id, row.cpu_id, row.gpu_id, row.resolution, row.quality,
      row.rt_enabled ? 1 : 0, row.upscaling || 'None', row.avg_fps, row.pct1_low,
      now().slice(0, 10), `Promoted from community submission #${row.id}. ${row.notes || ''}`.trim()).lastInsertRowid;
    db.prepare('UPDATE community_benchmarks SET promoted=1, promoted_at=? WHERE id=?').run(now(), id);
    audit(req.admin, 'community_bench_promote', 'community_benchmark', id, { benchmarkId: benchId });
    ok(res, { promoted: true, benchmark_id: benchId });
  });

// ---- Referrals ----
router.get('/referrals', (req, res) => {
  ok(res, adminReferralSummary());
});

// ---- AI / integration config ----
router.get('/ai-config', (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_settings').all();
  const settings = {};
  const hide = new Set(['stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret', 'steam_api_key']);
  for (const r of rows) {
    if (!hide.has(r.key)) settings[r.key] = r.value;
  }
  const dbKeyRow = db.prepare("SELECT value FROM admin_settings WHERE key='steam_api_key'").get();
  const dbKey = dbKeyRow && dbKeyRow.value && dbKeyRow.value !== '0' ? dbKeyRow.value : null;
  const envKey = config.steam?.apiKey || '';
  const keyConfigured = Boolean(dbKey) || Boolean(envKey);
  ok(res, {
    settings,
    env: {
      apiKeyConfigured: Boolean(config.ai.apiKey),
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
    },
    steam: {
      keyConfigured,
      source: dbKey ? 'database' : (envKey ? 'environment' : null),
      enabled: settings.steam_enabled === '0' ? false : keyConfigured,
    },
    note: 'The API key itself is read from the backend environment (USER_LLM_API_KEY) and is never exposed to the frontend.',
  });
});

router.put('/ai-config', (req, res) => {
  const upsert = db.prepare("INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')");
  const allowed = [
    'ai_enabled', 'ai_model', 'ai_temperature', 'ai_max_tokens',
    'ai_advice_prompt', 'ai_weekly_prompt', 'ai_builder_prompt',
    'steam_enabled', 'steam_api_key',
    'free_signup_credits', 'credit_cost_chat', 'credit_cost_advice',
    'credit_cost_weekly_report', 'credit_cost_session_coach', 'credit_cost_game_coach',
    'credit_cost_plan', 'credit_cost_ai_builder_prompt', 'credit_cost_default',
    'payment_demo', 'swish_number', 'payment_methods',
    'payout_iban', 'payout_bic', 'payout_account_name', 'payout_bank_name',
    'referral_enabled', 'referral_signup_credits', 'referral_subscription_credits',
    'referral_discount_percent', 'referral_monthly_limit', 'referral_duplicate_protection',
  ];
  for (const [k, v] of Object.entries(req.body.settings || {})) {
    if (allowed.includes(k)) upsert.run(k, String(v));
  }
  audit(req.admin, 'ai_config_update', 'settings', null, { keys: Object.keys(req.body.settings || {}) });
  ok(res, { updated: true });
});

function parsePlanFeatures(row) {
  let features = [];
  try { features = JSON.parse(row.features_json || '[]'); } catch { features = []; }
  return { ...row, features };
}

router.get('/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC, price_sek ASC').all().map(parsePlanFeatures);
  ok(res, { plans });
});

router.put('/plans/:id', (req, res) => {
  const id = parseId(req.params.id);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : plan.name;
  const tagline = b.tagline != null ? String(b.tagline).trim() : plan.tagline;
  const price = b.price_sek != null ? Math.max(0, Math.trunc(Number(b.price_sek) || 0)) : plan.price_sek;
  const credits = b.monthly_credits != null ? Math.max(0, Math.trunc(Number(b.monthly_credits) || 0)) : plan.monthly_credits;
  const sortOrder = b.sort_order != null ? Math.trunc(Number(b.sort_order) || 0) : plan.sort_order;
  const featured = b.is_featured != null ? (b.is_featured ? 1 : 0) : plan.is_featured;
  const active = b.is_active != null ? (b.is_active ? 1 : 0) : plan.is_active;
  let featuresJson = plan.features_json;
  if (Array.isArray(b.features)) featuresJson = JSON.stringify(b.features.map((f) => String(f)));
  else if (typeof b.features_json === 'string') featuresJson = b.features_json;
  db.prepare(`
    UPDATE plans SET name=?, tagline=?, price_sek=?, monthly_credits=?, sort_order=?, is_featured=?, is_active=?, features_json=?, updated_at=?
    WHERE id=?
  `).run(name, tagline, price, credits, sortOrder, featured, active, featuresJson, now(), id);
  audit(req.admin, 'plan_update', 'plan', id, { name, price_sek: price, monthly_credits: credits });
  ok(res, { plan: parsePlanFeatures(db.prepare('SELECT * FROM plans WHERE id=?').get(id)) });
});

router.post('/plans', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, 400, 'VALIDATION', 'Plan name is required.');
  const slug = String(b.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `plan-${Date.now()}`;
  const exists = db.prepare('SELECT id FROM plans WHERE slug = ?').get(slug);
  if (exists) return fail(res, 409, 'SLUG_TAKEN', 'A plan with this slug already exists.');
  const featuresJson = Array.isArray(b.features) ? JSON.stringify(b.features.map((f) => String(f))) : '[]';
  const id = db.prepare(`
    INSERT INTO plans (slug, name, tagline, price_sek, monthly_credits, sort_order, is_free, is_featured, is_active, features_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug,
    name,
    String(b.tagline || '').trim(),
    Math.max(0, Math.trunc(Number(b.price_sek) || 0)),
    Math.max(0, Math.trunc(Number(b.monthly_credits) || 0)),
    Math.trunc(Number(b.sort_order) || 99),
    b.is_free ? 1 : 0,
    b.is_featured ? 1 : 0,
    b.is_active === 0 || b.is_active === false ? 0 : 1,
    featuresJson,
    now(),
    now(),
  ).lastInsertRowid;
  audit(req.admin, 'plan_create', 'plan', id, { name, slug });
  ok(res, { plan: parsePlanFeatures(db.prepare('SELECT * FROM plans WHERE id=?').get(id)) });
});

router.get('/offers', (req, res) => {
  const offers = db.prepare('SELECT * FROM offers ORDER BY id DESC').all();
  ok(res, { offers });
});

router.post('/offers', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, 400, 'VALIDATION', 'Offer name is required.');
  const discountType = b.discount_type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = Math.max(0, Math.trunc(Number(b.discount_value) || 0));
  if (discountType === 'percent' && discountValue > 100) return fail(res, 400, 'VALIDATION', 'Percent discount cannot exceed 100.');
  const code = b.code ? String(b.code).trim().toUpperCase() : null;
  if (code) {
    const taken = db.prepare('SELECT id FROM offers WHERE lower(code) = lower(?)').get(code);
    if (taken) return fail(res, 409, 'CODE_TAKEN', 'This offer code is already in use.');
  }
  const id = db.prepare(`
    INSERT INTO offers (code, name, description, discount_type, discount_value, plan_id, starts_at, ends_at, is_active, max_redemptions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    name,
    String(b.description || '').trim(),
    discountType,
    discountValue,
    parseId(b.plan_id),
    b.starts_at || null,
    b.ends_at || null,
    b.is_active === 0 || b.is_active === false ? 0 : 1,
    b.max_redemptions != null && b.max_redemptions !== '' ? Math.max(1, Math.trunc(Number(b.max_redemptions) || 1)) : null,
    now(),
    now(),
  ).lastInsertRowid;
  audit(req.admin, 'offer_create', 'offer', id, { name, code, discountType, discountValue });
  ok(res, { offer: db.prepare('SELECT * FROM offers WHERE id=?').get(id) });
});

router.put('/offers/:id', (req, res) => {
  const id = parseId(req.params.id);
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  if (!offer) return fail(res, 404, 'NOT_FOUND', 'Offer not found.');
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : offer.name;
  const description = b.description != null ? String(b.description).trim() : offer.description;
  const discountType = b.discount_type != null ? (b.discount_type === 'fixed' ? 'fixed' : 'percent') : offer.discount_type;
  const discountValue = b.discount_value != null ? Math.max(0, Math.trunc(Number(b.discount_value) || 0)) : offer.discount_value;
  const code = b.code != null ? (String(b.code).trim().toUpperCase() || null) : offer.code;
  const planId = b.plan_id !== undefined ? parseId(b.plan_id) : offer.plan_id;
  const startsAt = b.starts_at !== undefined ? (b.starts_at || null) : offer.starts_at;
  const endsAt = b.ends_at !== undefined ? (b.ends_at || null) : offer.ends_at;
  const active = b.is_active != null ? (b.is_active ? 1 : 0) : offer.is_active;
  const maxRed = b.max_redemptions !== undefined
    ? (b.max_redemptions === '' || b.max_redemptions == null ? null : Math.max(1, Math.trunc(Number(b.max_redemptions) || 1)))
    : offer.max_redemptions;
  db.prepare(`
    UPDATE offers SET code=?, name=?, description=?, discount_type=?, discount_value=?, plan_id=?, starts_at=?, ends_at=?, is_active=?, max_redemptions=?, updated_at=?
    WHERE id=?
  `).run(code, name, description, discountType, discountValue, planId, startsAt, endsAt, active, maxRed, now(), id);
  audit(req.admin, 'offer_update', 'offer', id, { name });
  ok(res, { offer: db.prepare('SELECT * FROM offers WHERE id=?').get(id) });
});

router.get('/refunds', (req, res) => {
  const refunds = db.prepare(`
    SELECT r.*, u.username, u.email, p.amount_sek as payment_amount, p.method, p.status as payment_status,
           CASE WHEN p.kind = 'credits_topup' THEN 'Credits top-up' ELSE pl.name END as plan_name
    FROM refunds r
    JOIN users u ON u.id = r.user_id
    JOIN payments p ON p.id = r.payment_id
    LEFT JOIN plans pl ON pl.id = p.plan_id
    ORDER BY r.id DESC LIMIT 80
  `).all();
  ok(res, { refunds });
});

router.post('/refunds/:id/process', async (req, res) => {
  const id = parseId(req.params.id);
  const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(id);
  if (!refund) return fail(res, 404, 'NOT_FOUND', 'Refund not found.');
  if (refund.status !== 'pending') return fail(res, 409, 'ALREADY_PROCESSED', 'This refund was already processed.');
  const action = String(req.body?.action || 'approve').toLowerCase();
  const adminNote = String(req.body?.admin_note || '').trim().slice(0, 500);
  if (action === 'reject') {
    db.prepare(`UPDATE refunds SET status = 'rejected', admin_note = ?, processed_at = ?, processed_by = ? WHERE id = ?`)
      .run(adminNote || 'rejected', now(), req.admin.id, id);
    audit(req.admin, 'refund_reject', 'refund', id, { paymentId: refund.payment_id });
    return ok(res, { refund: db.prepare('SELECT * FROM refunds WHERE id=?').get(id) });
  }
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(refund.payment_id);
  if (!payment || payment.status !== 'paid') return fail(res, 409, 'NOT_REFUNDABLE', 'Payment is not refundable.');
  try {
    let providerRef = `manual_${id}`;
    if (isStripeConfigured() && (payment.checkout_session_id || payment.provider_ref)) {
      const stripeRefund = await refundStripePayment(payment, refund.amount_sek, refund.reason);
      providerRef = stripeRefund.id;
    }
    db.prepare(`UPDATE refunds SET status = 'completed', provider_ref = ?, admin_note = ?, processed_at = ?, processed_by = ? WHERE id = ?`)
      .run(providerRef, adminNote, now(), req.admin.id, id);
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ?`).run(payment.id);
    const sub = db.prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(payment.subscription_id);
    if (sub && sub.status === 'active') {
      db.prepare(`UPDATE subscriptions SET status = 'refunded', cancelled_at = ?, updated_at = ? WHERE id = ?`)
        .run(now(), now(), sub.id);
      ensureFreePlan(payment.user_id);
    }
    if (payment.kind === 'credits_topup') {
      revokeTopupCredits(payment.id);
    }
    audit(req.admin, 'refund_approve', 'refund', id, { paymentId: payment.id, amount: refund.amount_sek });
    ok(res, { refund: db.prepare('SELECT * FROM refunds WHERE id=?').get(id) });
  } catch (e) {
    console.error('[admin.refund]', e.message);
    if (e.code === 'PAYMENT_UNAVAILABLE' || e.code === 'REFUND_UNAVAILABLE') {
      return fail(res, e.status || 409, e.code, e.message);
    }
    return fail(res, 502, 'REFUND_FAILED', 'Could not process the Stripe refund.');
  }
});

router.post('/payments/:id/refund', async (req, res) => {
  const id = parseId(req.params.id);
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!payment) return fail(res, 404, 'NOT_FOUND', 'Payment not found.');
  if (payment.status !== 'paid') return fail(res, 409, 'NOT_REFUNDABLE', 'Only paid charges can be refunded.');
  const existing = db.prepare(`SELECT id FROM refunds WHERE payment_id = ? AND status IN ('pending','completed')`).get(id);
  if (existing) return fail(res, 409, 'ALREADY_REQUESTED', 'A refund already exists for this payment.');
  const reason = String(req.body?.reason || 'admin_refund').trim().slice(0, 500);
  const refundId = db.prepare(`
    INSERT INTO refunds (payment_id, user_id, amount_sek, reason, status, requested_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, payment.user_id, payment.amount_sek, reason, now()).lastInsertRowid;
  try {
    let providerRef = `manual_${refundId}`;
    if (isStripeConfigured() && (payment.checkout_session_id || payment.provider_ref)) {
      const stripeRefund = await refundStripePayment(payment, payment.amount_sek, reason);
      providerRef = stripeRefund.id;
    }
    db.prepare(`UPDATE refunds SET status = 'completed', provider_ref = ?, admin_note = ?, processed_at = ?, processed_by = ? WHERE id = ?`)
      .run(providerRef, reason, now(), req.admin.id, refundId);
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ?`).run(payment.id);
    const sub = db.prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(payment.subscription_id);
    if (sub && sub.status === 'active') {
      db.prepare(`UPDATE subscriptions SET status = 'refunded', cancelled_at = ?, updated_at = ? WHERE id = ?`)
        .run(now(), now(), sub.id);
      ensureFreePlan(payment.user_id);
    }
    if (payment.kind === 'credits_topup') {
      revokeTopupCredits(payment.id);
    }
    audit(req.admin, 'refund_approve', 'refund', refundId, { paymentId: payment.id, amount: payment.amount_sek });
    ok(res, { refund: db.prepare('SELECT * FROM refunds WHERE id=?').get(refundId) });
  } catch (e) {
    console.error('[admin.paymentRefund]', e.message);
    db.prepare(`UPDATE refunds SET status = 'failed', admin_note = ? WHERE id = ?`).run(e.message, refundId);
    if (e.code === 'PAYMENT_UNAVAILABLE' || e.code === 'REFUND_UNAVAILABLE') {
      return fail(res, e.status || 409, e.code, e.message);
    }
    return fail(res, 502, 'REFUND_FAILED', 'Could not process the Stripe refund.');
  }
});

router.get('/payouts', (req, res) => {
  const payouts = db.prepare('SELECT * FROM payouts ORDER BY id DESC LIMIT 50').all();
  const revenue = netRevenueSek();
  const bank = {
    iban: db.prepare("SELECT value FROM admin_settings WHERE key='payout_iban'").get()?.value || '',
    bic: db.prepare("SELECT value FROM admin_settings WHERE key='payout_bic'").get()?.value || '',
    accountName: db.prepare("SELECT value FROM admin_settings WHERE key='payout_account_name'").get()?.value || '',
    bankName: db.prepare("SELECT value FROM admin_settings WHERE key='payout_bank_name'").get()?.value || '',
  };
  ok(res, { payouts, revenue, bank, stripeConfigured: isStripeConfigured() });
});

router.put('/payout-account', (req, res) => {
  const upsert = db.prepare("INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')");
  const b = req.body || {};
  if (b.iban != null) upsert.run('payout_iban', String(b.iban).trim());
  if (b.bic != null) upsert.run('payout_bic', String(b.bic).trim());
  if (b.accountName != null) upsert.run('payout_account_name', String(b.accountName).trim());
  if (b.bankName != null) upsert.run('payout_bank_name', String(b.bankName).trim());
  audit(req.admin, 'payout_account_update', 'settings', null, {});
  ok(res, { updated: true });
});

router.post('/payouts', (req, res) => {
  const revenue = netRevenueSek();
  const amount = Math.max(0, Math.trunc(Number(req.body?.amount_sek) || 0));
  if (!amount) return fail(res, 400, 'VALIDATION', 'Enter a payout amount in SEK.');
  if (amount > revenue.available) return fail(res, 400, 'INSUFFICIENT_BALANCE', 'Requested amount exceeds available revenue.');
  const iban = db.prepare("SELECT value FROM admin_settings WHERE key='payout_iban'").get()?.value || '';
  if (!iban) return fail(res, 400, 'NO_BANK_ACCOUNT', 'Save IBAN / BIC before requesting a payout.');
  const dest = `${iban}${db.prepare("SELECT value FROM admin_settings WHERE key='payout_bic'").get()?.value ? ' / ' + db.prepare("SELECT value FROM admin_settings WHERE key='payout_bic'").get().value : ''}`;
  const id = db.prepare(`
    INSERT INTO payouts (amount_sek, currency, status, destination, note, created_at, created_by)
    VALUES (?, 'SEK', 'processing', ?, ?, ?, ?)
  `).run(amount, dest, String(req.body?.note || '').trim().slice(0, 400), now(), req.admin.id).lastInsertRowid;
  audit(req.admin, 'payout_create', 'payout', id, { amount });
  ok(res, { payout: db.prepare('SELECT * FROM payouts WHERE id=?').get(id), revenue: netRevenueSek() });
});

router.post('/payouts/:id/complete', (req, res) => {
  const id = parseId(req.params.id);
  const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  if (!payout) return fail(res, 404, 'NOT_FOUND', 'Payout not found.');
  if (payout.status === 'completed') return fail(res, 409, 'ALREADY_COMPLETED', 'Payout already completed.');
  const action = String(req.body?.action || 'complete').toLowerCase();
  if (action === 'cancel') {
    db.prepare(`UPDATE payouts SET status = 'cancelled' WHERE id = ?`).run(id);
    audit(req.admin, 'payout_cancel', 'payout', id, {});
    return ok(res, { payout: db.prepare('SELECT * FROM payouts WHERE id=?').get(id) });
  }
  db.prepare(`UPDATE payouts SET status = 'completed', completed_at = ?, provider_ref = ? WHERE id = ?`)
    .run(now(), String(req.body?.provider_ref || `manual_${id}`), id);
  audit(req.admin, 'payout_complete', 'payout', id, { amount: payout.amount_sek });
  ok(res, { payout: db.prepare('SELECT * FROM payouts WHERE id=?').get(id), revenue: netRevenueSek() });
});

router.get('/billing-stats', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC').all().map(parsePlanFeatures);
  const byPlan = db.prepare(`
    SELECT p.id, p.slug, p.name, p.price_sek, COUNT(s.id) subscribers
    FROM plans p
    LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
    GROUP BY p.id
    ORDER BY p.sort_order
  `).all();
  const paidActive = db.prepare(`
    SELECT COUNT(*) c FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.status = 'active' AND p.is_free = 0
  `).get().c;
  const revenuePaid = db.prepare(`
    SELECT COALESCE(SUM(amount_sek), 0) c FROM payments WHERE status = 'paid'
  `).get().c;
  const revenueMonth = db.prepare(`
    SELECT COALESCE(SUM(amount_sek), 0) c FROM payments
    WHERE status = 'paid' AND paid_at >= datetime('now', 'start of month')
  `).get().c;
  const paymentsCount = db.prepare(`SELECT COUNT(*) c FROM payments WHERE status = 'paid'`).get().c;
  const wallets = db.prepare(`
    SELECT COALESCE(SUM(balance), 0) balance, COALESCE(SUM(lifetime_granted), 0) granted, COALESCE(SUM(lifetime_spent), 0) spent
    FROM credit_wallets
  `).get();
  const recentPayments = db.prepare(`
    SELECT pay.id, pay.amount_sek, pay.method, pay.status, pay.paid_at, pay.created_at,
           u.username, u.email,
           CASE WHEN pay.kind = 'credits_topup' THEN 'Credits top-up' ELSE p.name END as plan_name
    FROM payments pay
    JOIN users u ON u.id = pay.user_id
    LEFT JOIN plans p ON p.id = pay.plan_id
    ORDER BY pay.id DESC LIMIT 30
  `).all();
  const recentLedger = db.prepare(`
    SELECT l.id, l.delta, l.balance_after, l.reason, l.feature, l.created_at, u.username
    FROM credit_ledger l JOIN users u ON u.id = l.user_id
    ORDER BY l.id DESC LIMIT 40
  `).all();
  const methodSplit = db.prepare(`
    SELECT method, COUNT(*) c, COALESCE(SUM(amount_sek), 0) amount
    FROM payments WHERE status = 'paid' GROUP BY method
  `).all();
  const revenue = netRevenueSek();
  const pendingRefunds = db.prepare(`SELECT COUNT(*) c FROM refunds WHERE status = 'pending'`).get().c;
  const offers = db.prepare('SELECT * FROM offers ORDER BY id DESC').all();
  ok(res, {
    plans,
    byPlan,
    paidActive,
    revenuePaid,
    revenueMonth,
    paymentsCount,
    wallets,
    recentPayments,
    recentLedger,
    methodSplit,
    revenue,
    pendingRefunds,
    offers,
    stripeConfigured: isStripeConfigured(),
    stripeWebhookConfigured: isWebhookConfigured(),
    stripe: {
      secretMasked: maskSecret(stripeKeys().secret),
      publishableMasked: maskSecret(stripeKeys().publishable),
      webhookMasked: maskSecret(stripeKeys().webhook),
      hasSecret: Boolean(maskSecret(stripeKeys().secret)),
      hasPublishable: Boolean(maskSecret(stripeKeys().publishable)),
      hasWebhook: Boolean(maskSecret(stripeKeys().webhook)),
    },
  });
});

router.get('/stripe-keys', (req, res) => {
  const keys = stripeKeys();
  ok(res, {
    stripeConfigured: isStripeConfigured(),
    stripeWebhookConfigured: isWebhookConfigured(),
    stripe: {
      secretMasked: maskSecret(keys.secret),
      publishableMasked: maskSecret(keys.publishable),
      webhookMasked: maskSecret(keys.webhook),
      hasSecret: Boolean(maskSecret(keys.secret)),
      hasPublishable: Boolean(maskSecret(keys.publishable)),
      hasWebhook: Boolean(maskSecret(keys.webhook)),
    },
  });
});

router.put('/stripe-keys', (req, res) => {
  const upsert = db.prepare("INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')");
  const secret = sanitizeKey(req.body?.secretKey);
  const publishable = sanitizeKey(req.body?.publishableKey);
  const webhook = sanitizeKey(req.body?.webhookSecret);
  if (secret) {
    if (!(secret.startsWith('sk_test_') || secret.startsWith('sk_live_')) || secret.length < 32) {
      return fail(res, 400, 'VALIDATION', 'Secret key must be the full sk_test_ or sk_live_ value from Stripe (no extra text).');
    }
    upsert.run('stripe_secret_key', secret);
  }
  if (publishable) {
    if (!(publishable.startsWith('pk_test_') || publishable.startsWith('pk_live_')) || publishable.length < 32) {
      return fail(res, 400, 'VALIDATION', 'Publishable key must be the full pk_test_ or pk_live_ value from Stripe (no extra text).');
    }
    upsert.run('stripe_publishable_key', publishable);
  }
  if (webhook) {
    if (!webhook.startsWith('whsec_') || webhook.length < 16) {
      return fail(res, 400, 'VALIDATION', 'Webhook secret must start with whsec_ and not be a placeholder.');
    }
    upsert.run('stripe_webhook_secret', webhook);
  }
  if (!secret && !publishable && !webhook) {
    return fail(res, 400, 'VALIDATION', 'Provide at least one Stripe key to save.');
  }
  resetStripeClient();
  const keys = stripeKeys();
  audit(req.admin, 'stripe_keys_update', 'settings', null, {
    secret: Boolean(secret),
    publishable: Boolean(publishable),
    webhook: Boolean(webhook),
  });
  ok(res, {
    updated: true,
    stripeConfigured: isStripeConfigured(),
    stripeWebhookConfigured: isWebhookConfigured(),
    stripe: {
      secretMasked: maskSecret(keys.secret),
      publishableMasked: maskSecret(keys.publishable),
      webhookMasked: maskSecret(keys.webhook),
      hasSecret: Boolean(maskSecret(keys.secret)),
      hasPublishable: Boolean(maskSecret(keys.publishable)),
      hasWebhook: Boolean(maskSecret(keys.webhook)),
    },
  });
});

router.post('/credits/grant', (req, res) => {
  const userId = parseId(req.body?.userId);
  const amount = Math.trunc(Number(req.body?.amount) || 0);
  if (!userId || amount === 0) return fail(res, 400, 'VALIDATION', 'userId and a non-zero amount are required.');
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found.');
  grantCredits(userId, amount, 'admin_grant', { refType: 'admin', refId: req.admin.id });
  audit(req.admin, 'credits_grant', 'user', userId, { amount });
  ok(res, { wallet: getWallet(userId), user });
});

// ---- Analytics ----
router.get('/analytics', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const active7 = db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM gaming_sessions WHERE started_at >= datetime('now','-7 days')`).get().c + db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM performance_records WHERE record_date >= date('now','-7 days')`).get().c;
  const totalSessions = db.prepare('SELECT COUNT(*) c FROM gaming_sessions').get().c;
  const sessions7 = db.prepare(`SELECT COUNT(*) c FROM gaming_sessions WHERE started_at >= datetime('now','-7 days')`).get().c;
  const builds = db.prepare('SELECT COUNT(*) c FROM pc_builds').get().c;
  const aiCalls = db.prepare('SELECT COUNT(*) c FROM ai_requests').get().c;
  const aiSuccess = db.prepare('SELECT COUNT(*) c FROM ai_requests WHERE success=1').get().c;

  const popularGames = db.prepare(`
    SELECT g.name, COUNT(DISTINCT s.user_id) users, COUNT(*) sessions FROM gaming_sessions s
    JOIN games g ON g.id=s.game_id GROUP BY g.id ORDER BY sessions DESC LIMIT 8
  `).all();

  const featureUsage = db.prepare(`
    SELECT feature, COUNT(*) c FROM ai_requests WHERE feature NOT IN ('advice','weekly_report') GROUP BY feature ORDER BY c DESC
  `).all();

  const usersByDay = db.prepare(`
    SELECT date(created_at) day, COUNT(*) c FROM users GROUP BY day ORDER BY day DESC LIMIT 14
  `).all();

  const adminUsers = db.prepare('SELECT id, email, role, status FROM admin_users').all();

  ok(res, {
    users: { total: totalUsers, activeLast7: Math.min(active7, totalUsers) },
    sessions: { total: totalSessions, last7: sessions7 },
    builds,
    ai: { totalCalls: aiCalls, successRate: aiCalls ? Math.round((aiSuccess / aiCalls) * 100) : 0 },
    popularGames,
    featureUsage,
    usersByDay,
    adminUsers,
  });
});

// ---- Audit log ----
router.get('/audit', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, adm.email admin_email FROM audit_logs a
    LEFT JOIN admin_users adm ON adm.id=a.admin_user_id
    ORDER BY a.created_at DESC LIMIT 100
  `).all();
  ok(res, { logs: rows });
});

// GET /api/admin/contact-messages — messages from the public contact form
router.get('/contact-messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ?').all(limit);
  ok(res, { messages: rows });
});

// PATCH /api/admin/contact-messages/:id — mark read/unread
router.patch('/contact-messages/:id', param('id').isInt(), validate, (req, res) => {
  const row = db.prepare('SELECT id FROM contact_messages WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Message not found.');
  db.prepare('UPDATE contact_messages SET is_read = ? WHERE id = ?').run(req.body.is_read ? 1 : 0, req.params.id);
  ok(res, { updated: true });
});

// ---- Blog articles (admin CRUD) ----
function slugify(str) {
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseTags(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];
  } catch { return []; }
}

const articleCols = 'id, slug, title, excerpt, content, cover_color, tags, author_name, status, published_at, created_at, updated_at';

router.get('/articles', query('status').optional().isIn(['draft', 'published', 'all']), validate, (req, res) => {
  const status = req.query.status || 'all';
  const rows = status === 'all'
    ? db.prepare(`SELECT ${articleCols} FROM articles ORDER BY updated_at DESC LIMIT 200`).all()
    : db.prepare(`SELECT ${articleCols} FROM articles WHERE status=? ORDER BY updated_at DESC LIMIT 200`).all(status);
  rows.forEach((r) => { r.tags = parseTags(r.tags); });
  ok(res, { articles: rows });
});

router.post('/articles',
  body('title').trim().isLength({ min: 3, max: 160 }).withMessage('Title is required (3–160 chars).'),
  body('content').trim().isLength({ min: 20 }).withMessage('Content is required.'),
  body('status').optional().isIn(['draft', 'published']).withMessage('Invalid status.'),
  validate, (req, res) => {
    const title = req.body.title.trim();
    const baseSlug = (req.body.slug || '').trim() || slugify(title);
    let slug = baseSlug;
    let n = 2;
    while (db.prepare('SELECT id FROM articles WHERE slug=?').get(slug)) slug = `${baseSlug}-${n++}`;
    const tags = JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags.slice(0, 8) : []);
    const status = req.body.status || 'draft';
    const nowStr = now();
    const id = db.prepare(`
      INSERT INTO articles (slug, title, excerpt, content, cover_color, tags, author_name, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug, title, String(req.body.excerpt || '').trim().slice(0, 300),
      req.body.content, req.body.cover_color || '#7c5cff', tags,
      req.admin.email, status,
      status === 'published' ? nowStr : null, nowStr, nowStr,
    ).lastInsertRowid;
    audit(req.admin, 'article.create', 'article', id, { slug, title });
    ok(res, { article: db.prepare(`SELECT ${articleCols} FROM articles WHERE id=?`).get(id) });
  });

router.patch('/articles/:id', param('id').isInt(), validate, (req, res) => {
  const a = db.prepare(`SELECT ${articleCols} FROM articles WHERE id=?`).get(req.params.id);
  if (!a) return fail(res, 404, 'NOT_FOUND', 'Article not found.');
  const title = (req.body.title !== undefined ? req.body.title : a.title).trim();
  const status = req.body.status !== undefined ? req.body.status : a.status;
  const nowStr = now();
  const publishedAt = status === 'published' && !a.published_at ? nowStr : (a.published_at);
  db.prepare(`
    UPDATE articles SET title=?, excerpt=?, content=?, cover_color=?, tags=?, author_name=?, status=?, published_at=?, updated_at=?
    WHERE id=?
  `).run(
    title,
    req.body.excerpt !== undefined ? String(req.body.excerpt).trim().slice(0, 300) : a.excerpt,
    req.body.content !== undefined ? req.body.content : a.content,
    req.body.cover_color || a.cover_color,
    req.body.tags !== undefined ? JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags.slice(0, 8) : []) : a.tags,
    req.admin.email,
    status, publishedAt, nowStr, a.id,
  );
  audit(req.admin, 'article.update', 'article', a.id, { slug: a.slug, title });
  ok(res, { article: db.prepare(`SELECT ${articleCols} FROM articles WHERE id=?`).get(a.id) });
});

router.delete('/articles/:id', param('id').isInt(), validate, (req, res) => {
  const a = db.prepare('SELECT id, slug FROM articles WHERE id=?').get(req.params.id);
  if (!a) return fail(res, 404, 'NOT_FOUND', 'Article not found.');
  db.prepare('DELETE FROM articles WHERE id=?').run(a.id);
  audit(req.admin, 'article.delete', 'article', a.id, { slug: a.slug });
  ok(res, { deleted: true });
});

export default router;
