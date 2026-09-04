import crypto from 'crypto';
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { buildPc } from '../engines/builder.js';
import { checkCompatibility } from '../engines/compatibility.js';
import { estimateFps } from '../engines/fps.js';
import { upgradeAdvice } from '../engines/upgrade.js';
import { recommendSettings } from '../engines/settings.js';
import { aiComplete, AIServiceError, aiEnabled, getSetting } from '../utils/ai.js';
import { getAchievements } from '../services/achievements.js';
import { PART_TABLES, PART_LABELS, partsDetail, totalPrice, resolvePart, categoryOfPartType } from '../services/pcParts.js';

const PC_CATEGORIES = ['gaming', 'work', 'future', 'other'];
const PART_TYPES = Object.keys(PART_TABLES);

function makeShareSlug() {
  let slug;
  do {
    slug = crypto.randomBytes(6).toString('hex');
  } while (db.prepare('SELECT 1 FROM pc_builds WHERE share_slug=?').get(slug));
  return slug;
}

const router = Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

function logEngine(feature, userId) {
  try {
    db.prepare("INSERT INTO ai_requests (user_id, feature, model, duration_ms, success) VALUES (?, ?, 'engine', 0, 1)")
      .run(userId, feature);
  } catch { /* non-fatal */ }
}

function buildPartsDisplay(config) {
  const detail = partsDetail(config || {}, null);
  const parts = {};
  for (const [key, row] of Object.entries(detail)) {
    parts[key] = {
      name: row.name, price: row.price_usd, reason: 'Saved configuration',
      spec: row.spec || null, price_date: row.price_date || null, store: row.store || null,
    };
  }
  return parts;
}

function defaultBuildName(build, index) {
  if (build.name && build.name.trim()) return build.name.trim();
  const date = (build.created_at || '').slice(0, 10) || '—';
  return `${build.category === 'future' ? 'Future Build' : build.category === 'work' ? 'Work PC' : 'My PC'} · ${date}`;
}

function serializeBuild(row) {
  const config = JSON.parse(row.config_json || '{}');
  return {
    id: row.id, name: defaultBuildName(row), category: row.category, share_slug: row.share_slug,
    is_active: Boolean(row.is_active), budget: row.budget, currency: row.currency,
    resolution: row.resolution, target_fps: row.target_fps, total_price: row.total_price,
    status: row.status, created_at: row.created_at, has_ai: Boolean(row.ai_summary),
    config, parts: buildPartsDisplay(config),
  };
}

async function maybeAiExplain(userId, systemKey, userPrompt) {
  if (!aiEnabled()) return { explanation: null, error: 'AI service is temporarily unavailable. Please try again later.' };
  try {
    const system = getSetting(systemKey, 'You are a PC hardware expert.');
    const { content } = await aiComplete({ feature: systemKey, system, user: userPrompt, user_id: userId });
    return { explanation: content, error: null };
  } catch (e) {
    return { explanation: null, error: e instanceof AIServiceError ? e.message : 'AI service is temporarily unavailable. Please try again later.' };
  }
}

// POST /api/pc/build
// Builds the best configuration (variant 0) and auto-saves it as a draft.
// When `variants` > 1 the response also includes that many distinct verified
// configurations; passing `variant` selects which one is persisted, so a user
// can save any alternative from the generated menu.
router.post('/build', (req, res, next) => {
  try {
    const wantVariants = Math.max(0, Math.min(Number(req.body?.variants) || 0, 40));
    const variant = Math.max(0, Math.min(Number(req.body?.variant) || 0, wantVariants));
    const result = buildPc(req.body, { alternatives: wantVariants >= 2 ? wantVariants - 1 : 0 });
    if (result.status !== 'ready') return ok(res, result);
    logEngine('pc_build', req.user.id);
    getAchievements(req.user.id);

    // If the user picked an alternative from the generated menu, persist that
    // one; otherwise persist the top recommendation (historical behaviour).
    let chosen = result;
    if (variant > 0 && Array.isArray(result.alternatives) && result.alternatives[variant - 1]) {
      chosen = { ...result.alternatives[variant - 1], budget: result.budget, currency: result.currency };
    }

    const buildId = db.prepare(`
      INSERT INTO pc_builds (user_id, budget, currency, games, resolution, target_fps, config_json, total_price, expected_fps, engine_reasoning, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      req.user.id, chosen.budget, chosen.currency, JSON.stringify(req.body.games || []),
      req.body.resolution || '1080p', req.body.targetFps || null,
      JSON.stringify(chosen.config), chosen.totalPrice,
      JSON.stringify(chosen.expectedFps), JSON.stringify(chosen.parts),
    ).lastInsertRowid;

    maybeAiExplain(
      req.user.id, 'ai_builder_prompt',
      `Budget ${chosen.budget} ${chosen.currency}, games: ${(req.body.games || []).map((id) => db.prepare('SELECT name FROM games WHERE id=?').get(id)?.name).filter(Boolean).join(', ') || 'generic'}, resolution ${req.body.resolution || '1080p'}, target ${req.body.targetFps || 60} FPS.\nSelected build:\n${JSON.stringify(chosen.parts)}\nExplain each component choice concisely.`,
    ).then((ai) => {
      db.prepare('UPDATE pc_builds SET ai_summary=? WHERE id=?').run(ai.explanation, buildId);
      const body = { ...chosen, buildId, ai };
      if (wantVariants >= 2 && Array.isArray(result.alternatives)) {
        body.alternatives = result.alternatives;
        body.configurations = result.alternativeCount;
      }
      ok(res, body);
    }).catch(() => {
      const body = { ...chosen, buildId, ai: { explanation: null, error: 'AI service is temporarily unavailable. Please try again later.' } };
      if (wantVariants >= 2 && Array.isArray(result.alternatives)) {
        body.alternatives = result.alternatives;
        body.configurations = result.alternativeCount;
      }
      ok(res, body);
    });
  } catch (e) {
    return fail(res, 400, 'BUILD_FAILED', e.message || 'Could not build a configuration.');
  }
});

// POST /api/pc/build/save-config — persist an already-generated configuration
// (for example an alternative the user picked from the generated menu) without
// re-running the engine. Used by the builder's "save this exact build" action.
router.post('/build/save-config', (req, res) => {
  try {
    const cfg = req.body?.config || {};
    const need = ['cpu', 'gpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'];
    for (const k of need) {
      const id = Number(cfg[k]);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 422, 'VALIDATION', 'A complete part configuration is required.');
    }
    const budget = Number(req.body?.budget) || null;
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const resolution = String(req.body?.resolution || '1080p');
    const targetFps = Number(req.body?.targetFps) || 60;
    const totalPrice = Math.round(Number(req.body?.totalPrice) || 0);
    const games = Array.isArray(req.body?.games) ? req.body.games.map(Number).filter(Boolean).slice(0, 12) : [];
    const parts = (req.body?.parts && typeof req.body.parts === 'object') ? req.body.parts : {};
    const expectedFps = Array.isArray(req.body?.expectedFps) ? req.body.expectedFps : [];

    const buildId = db.prepare(`
      INSERT INTO pc_builds (user_id, budget, currency, games, resolution, target_fps, config_json, total_price, expected_fps, engine_reasoning, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      req.user.id, budget, currency, JSON.stringify(games), resolution, targetFps,
      JSON.stringify(cfg), totalPrice, JSON.stringify(expectedFps), JSON.stringify(parts),
    ).lastInsertRowid;
    logEngine('pc_build_save_variant', req.user.id);
    return ok(res, { buildId });
  } catch (e) {
    return fail(res, 400, 'BUILD_FAILED', e.message || 'Could not save the configuration.');
  }
});

// POST /api/pc/compatibility
router.post('/compatibility',
  body('cpu_id').optional({ nullable: true }).isInt(),
  body('gpu_id').optional({ nullable: true }).isInt(),
  body('motherboard_id').optional({ nullable: true }).isInt(),
  body('ram_id').optional({ nullable: true }).isInt(),
  body('storage_id').optional({ nullable: true }).isInt(),
  body('psu_id').optional({ nullable: true }).isInt(),
  body('case_id').optional({ nullable: true }).isInt(),
  body('cooler_id').optional({ nullable: true }).isInt(),
  validate, (req, res, next) => {
    try {
      const result = checkCompatibility(req.body);
      logEngine('compatibility', req.user.id);
      ok(res, result);
    } catch (e) {
      return fail(res, 400, 'CHECK_FAILED', e.message);
    }
  });

// POST /api/pc/fps
router.post('/fps',
  body('game_id').isInt().withMessage('Select a game.'),
  body('gpu_id').isInt().withMessage('Select a GPU.'),
  body('cpu_id').optional({ nullable: true }).isInt(),
  validate, (req, res, next) => {
    const result = estimateFps({
      gameId: req.body.game_id,
      gpuId: req.body.gpu_id,
      cpuId: req.body.cpu_id || null,
      resolution: req.body.resolution || '1080p',
      quality: req.body.quality || 'Ultra',
      rtEnabled: Boolean(req.body.rt_enabled),
      upscaling: req.body.upscaling || 'None',
    });
    logEngine('fps_calc', req.user.id);
    getAchievements(req.user.id);
    ok(res, result);
  });

// POST /api/pc/upgrade
router.post('/upgrade',
  body('targetGames').isArray({ min: 1 }).withMessage('Select at least one target game.'),
  validate, (req, res, next) => {
    try {
      const result = upgradeAdvice(req.body);
      if (result.status === 'error') return ok(res, result);
      logEngine('upgrade', req.user.id);
      ok(res, result);
    } catch (e) {
      return fail(res, 400, 'UPGRADE_FAILED', e.message);
    }
  });

// POST /api/pc/settings
router.post('/settings',
  body('game_id').isInt().withMessage('Select a game.'),
  body('gpu_id').isInt().withMessage('Select a GPU.'),
  validate, (req, res, next) => {
    const result = recommendSettings(req.body);
    logEngine('game_settings', req.user.id);
    ok(res, result);
  });

// GET /api/pc/builds
router.get('/builds', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, category, share_slug, is_active, budget, currency, resolution, target_fps,
           total_price, config_json, status, created_at, ai_summary IS NOT NULL as has_ai
    FROM pc_builds WHERE user_id=? ORDER BY is_active DESC, created_at DESC LIMIT 50
  `).all(req.user.id);
  ok(res, { builds: rows.map(serializeBuild) });
});

// POST /api/pc/builds — save a manual PC profile (no AI involved)
router.post('/builds',
  body('name').trim().isLength({ min: 1, max: 80 }).withMessage('Give this PC a name.'),
  body('category').optional().isIn(PC_CATEGORIES).withMessage('Invalid category.'),
  body('config').isObject().withMessage('Select at least one part.'),
  validate, (req, res) => {
    try {
      const count = db.prepare('SELECT COUNT(*) c FROM pc_builds WHERE user_id=?').get(req.user.id).c;
      if (count >= 20) return fail(res, 400, 'LIMIT', 'You can save up to 20 PCs.');
      const config = {};
      for (const [key, table] of Object.entries(PART_TABLES)) {
        const id = parseId(req.body.config[`${key}_id`] ?? req.body.config[key]);
        if (!id) continue;
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) {
          return fail(res, 422, 'VALIDATION', `${key} references a part that does not exist.`);
        }
        config[key] = id;
      }
      if (!Object.keys(config).length) return fail(res, 422, 'VALIDATION', 'Select at least one part.');
      const total = totalPrice(config);
      const category = PC_CATEGORIES.includes(req.body.category) ? req.body.category : 'gaming';
      const id = db.prepare(`
        INSERT INTO pc_builds (user_id, name, category, config_json, total_price, status)
        VALUES (?, ?, ?, ?, ?, 'saved')
      `).run(req.user.id, req.body.name.trim(), category, JSON.stringify(config), total).lastInsertRowid;
      getAchievements(req.user.id);
      const row = db.prepare('SELECT * FROM pc_builds WHERE id=?').get(id);
      ok(res, { build: serializeBuild(row) });
    } catch (e) {
      return fail(res, 400, 'SAVE_FAILED', e.message);
    }
  });

// PATCH /api/pc/builds/:id — rename / recategorize / set active
router.patch('/builds/:id',
  body('name').optional({ nullable: true }).trim().isLength({ max: 80 }).withMessage('Name too long.'),
  body('category').optional().isIn(PC_CATEGORIES).withMessage('Invalid category.'),
  validate, (req, res) => {
    const id = parseId(req.params.id);
    const row = db.prepare('SELECT id FROM pc_builds WHERE id=? AND user_id=?').get(id, req.user.id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Build not found.');
    const sets = [];
    const vals = [];
    if (req.body.name !== undefined) { sets.push('name = ?'); vals.push(req.body.name?.trim() || null); }
    if (req.body.category !== undefined) { sets.push('category = ?'); vals.push(req.body.category); }
    if (req.body.is_active !== undefined) {
      if (req.body.is_active) db.prepare('UPDATE pc_builds SET is_active=0 WHERE user_id=?').run(req.user.id);
      sets.push('is_active = ?');
      vals.push(req.body.is_active ? 1 : 0);
    }
    if (sets.length) db.prepare(`UPDATE pc_builds SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
    ok(res, { build: serializeBuild(db.prepare('SELECT * FROM pc_builds WHERE id=?').get(id)) });
  });

// POST /api/pc/builds/:id/share — create (or return) the public share link
router.post('/builds/:id/share', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id, share_slug FROM pc_builds WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Build not found.');
  const slug = row.share_slug || makeShareSlug();
  if (!row.share_slug) db.prepare('UPDATE pc_builds SET share_slug=? WHERE id=?').run(slug, id);
  ok(res, { slug, url: `/pc/shared/${slug}` });
});

// DELETE /api/pc/builds/:id
router.delete('/builds/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id FROM pc_builds WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Build not found.');
  db.prepare('DELETE FROM pc_builds WHERE id=?').run(id);
  ok(res, { deleted: true });
});

// Upgrade history --------------------------------------------------------
function enrichUpgrade(row) {
  const from = row.from_part_id ? resolvePart(row.part_type, row.from_part_id) : null;
  const to = resolvePart(row.part_type, row.to_part_id);
  return {
    id: row.id, pc_id: row.pc_id, part_type: row.part_type, part_label: PART_LABELS[row.part_type],
    from_part_id: row.from_part_id, to_part_id: row.to_part_id,
    from_part_name: from ? from.name : row.from_part_name,
    to_part_name: to ? to.name : row.to_part_name,
    note: row.note, upgraded_at: row.upgraded_at, created_at: row.created_at,
  };
}

// GET /api/pc/upgrades
router.get('/upgrades', (req, res) => {
  const rows = db.prepare('SELECT * FROM upgrade_history WHERE user_id=? ORDER BY upgraded_at DESC, id DESC LIMIT 100').all(req.user.id);
  ok(res, { upgrades: rows.map(enrichUpgrade) });
});

// POST /api/pc/upgrades
router.post('/upgrades',
  body('part_type').isIn(PART_TYPES).withMessage('Select a part type.'),
  body('to_part_id').isInt({ min: 1 }).withMessage('Select the part you upgraded to.'),
  body('from_part_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Invalid old part.'),
  body('pc_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Invalid PC.'),
  body('upgraded_at').isISO8601().withMessage('Enter a valid date (YYYY-MM-DD).'),
  body('note').optional().trim().isLength({ max: 300 }),
  validate, (req, res) => {
    try {
      const table = categoryOfPartType(req.body.part_type);
      const to = db.prepare(`SELECT id, name FROM ${table} WHERE id=?`).get(req.body.to_part_id);
      if (!to) return fail(res, 422, 'VALIDATION', 'Target part does not exist in the catalog.');
      let from = null;
      if (req.body.from_part_id) {
        from = db.prepare(`SELECT id, name FROM ${table} WHERE id=?`).get(req.body.from_part_id);
        if (!from) return fail(res, 422, 'VALIDATION', 'Old part does not exist in the catalog.');
      }
      const date = req.body.upgraded_at.slice(0, 10);
      const id = db.prepare(`
        INSERT INTO upgrade_history (user_id, pc_id, part_type, from_part_id, to_part_id, from_part_name, to_part_name, note, upgraded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, parseId(req.body.pc_id) || null, req.body.part_type,
        from ? from.id : null, to.id, from ? from.name : null, to.name,
        req.body.note || null, date).lastInsertRowid;
      ok(res, { upgrade: enrichUpgrade(db.prepare('SELECT * FROM upgrade_history WHERE id=?').get(id)) });
    } catch (e) {
      return fail(res, 400, 'UPGRADE_SAVE_FAILED', e.message);
    }
  });

// DELETE /api/pc/upgrades/:id
router.delete('/upgrades/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id FROM upgrade_history WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Upgrade entry not found.');
  db.prepare('DELETE FROM upgrade_history WHERE id=?').run(id);
  ok(res, { deleted: true });
});

// Wishlist ---------------------------------------------------------------
function enrichWish(row) {
  const part = resolvePart(row.part_type, row.part_id);
  const detail = partsDetail({ [row.part_type]: row.part_id }, null)[row.part_type] || {};
  return {
    id: row.id, part_type: row.part_type, part_label: PART_LABELS[row.part_type],
    part_id: row.part_id, name: part ? part.name : 'Unknown part', price_usd: part ? part.price_usd : null,
    spec: detail.spec || null, price_date: detail.price_date || null,
    store: detail.store || null,
    note: row.note, created_at: row.created_at,
  };
}

// GET /api/pc/wishlist
router.get('/wishlist', (req, res) => {
  const rows = db.prepare('SELECT * FROM wishlist WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  ok(res, { wishlist: rows.map(enrichWish) });
});

// POST /api/pc/wishlist
router.post('/wishlist',
  body('part_type').isIn(PART_TYPES).withMessage('Select a part type.'),
  body('part_id').isInt({ min: 1 }).withMessage('Select a part.'),
  body('note').optional().trim().isLength({ max: 300 }),
  validate, (req, res) => {
    try {
      const table = categoryOfPartType(req.body.part_type);
      const part = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(req.body.part_id);
      if (!part) return fail(res, 422, 'VALIDATION', 'Part does not exist in the catalog.');
      db.prepare('INSERT INTO wishlist (user_id, part_type, part_id, note) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, part_type, part_id) DO NOTHING')
        .run(req.user.id, req.body.part_type, req.body.part_id, req.body.note || null);
      const row = db.prepare('SELECT * FROM wishlist WHERE user_id=? AND part_type=? AND part_id=?').get(req.user.id, req.body.part_type, req.body.part_id);
      ok(res, { wish: enrichWish(row) });
    } catch (e) {
      return fail(res, 400, 'WISH_SAVE_FAILED', e.message);
    }
  });

// DELETE /api/pc/wishlist/:id
router.delete('/wishlist/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id FROM wishlist WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Wishlist item not found.');
  db.prepare('DELETE FROM wishlist WHERE id=?').run(id);
  ok(res, { deleted: true });
});

// GET /api/pc/my — aggregate: builds + active + upgrades + wishlist
router.get('/my', (req, res) => {
  const builds = db.prepare(`
    SELECT id, name, category, share_slug, is_active, budget, currency, resolution, target_fps,
           total_price, config_json, status, created_at, ai_summary IS NOT NULL as has_ai
    FROM pc_builds WHERE user_id=? ORDER BY is_active DESC, created_at DESC LIMIT 50
  `).all(req.user.id).map(serializeBuild);
  const active = builds.find((b) => b.is_active) || null;
  const upgrades = db.prepare('SELECT * FROM upgrade_history WHERE user_id=? ORDER BY upgraded_at DESC, id DESC LIMIT 100').all(req.user.id).map(enrichUpgrade);
  const wishlist = db.prepare('SELECT * FROM wishlist WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id).map(enrichWish);
  ok(res, { builds, active, upgrades, wishlist });
});

export default router;
