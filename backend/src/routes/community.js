import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { db } from '../db.js';

const router = Router();
router.use(requireAuth);

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];
const UPSCALING = ['None', 'DLSS', 'FSR', 'XeSS'];
const FPS_METHODS = ['ingame_benchmark', 'overlay_counter', 'manual_counter'];
const STATUSES = ['pending', 'approved', 'hidden', 'rejected'];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

const COLS = `cb.*, g.name AS game_name, gpu.name AS gpu_name, cpu.name AS cpu_name,
  COALESCE(NULLIF(p.display_name, ''), u.username) AS contributor`;

function listQuery(where, params, limit, offset) {
  const rows = db.prepare(`
    SELECT ${COLS}
    FROM community_benchmarks cb
    JOIN games g ON g.id = cb.game_id
    JOIN gpus gpu ON gpu.id = cb.gpu_id
    LEFT JOIN cpus cpu ON cpu.id = cb.cpu_id
    JOIN users u ON u.id = cb.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
    ${where}
    ORDER BY cb.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`
    SELECT COUNT(*) c
    FROM community_benchmarks cb
    JOIN games g ON g.id = cb.game_id
    JOIN gpus gpu ON gpu.id = cb.gpu_id
    JOIN users u ON u.id = cb.user_id
    ${where}
  `).get(...params).c;
  return { rows, total };
}

// GET /api/community/benchmarks/options — catalogs for the submission form
router.get('/benchmarks/options', (req, res) => {
  const games = db.prepare('SELECT id, name FROM games WHERE enabled=1 ORDER BY name').all();
  const gpus = db.prepare('SELECT id, name, performance_index FROM gpus WHERE enabled=1 ORDER BY name').all();
  const cpus = db.prepare('SELECT id, name, performance_index FROM cpus WHERE enabled=1 ORDER BY name').all();
  ok(res, {
    games, gpus, cpus,
    resolutions: RESOLUTIONS, qualities: QUALITIES, upscaling: UPSCALING, fps_methods: FPS_METHODS,
  });
});

// POST /api/community/benchmarks — submit a measured result (needs verified email)
router.post('/benchmarks',
  requireVerified,
  body('game_id').isInt().withMessage('Select a game.'),
  body('gpu_id').isInt().withMessage('Select a GPU.'),
  body('cpu_id').optional({ nullable: true }).isInt().withMessage('Invalid CPU.'),
  body('resolution').isIn(RESOLUTIONS).withMessage('Invalid resolution.'),
  body('quality').isIn(QUALITIES).withMessage('Invalid quality preset.'),
  body('rt_enabled').optional().isBoolean().withMessage('Invalid ray tracing flag.'),
  body('upscaling').optional().isIn(UPSCALING).withMessage('Invalid upscaling.'),
  body('avg_fps').isFloat({ min: 5, max: 2000 }).withMessage('Average FPS must be a real measured number (5-2000).'),
  body('pct1_low').optional({ nullable: true }).isFloat({ min: 0.1, max: 2000 }).withMessage('Invalid 1% low.'),
  body('fps_method').isIn(FPS_METHODS).withMessage('Select how you measured it.'),
  body('driver_version').optional().trim().isLength({ max: 40 }).withMessage('Driver version too long.'),
  body('notes').optional().trim().isLength({ max: 400 }).withMessage('Notes too long.'),
  body('agreed_measured').isBoolean().withMessage('Confirm you ran this benchmark on your own machine.'),
  validate, (req, res) => {
    const game = db.prepare('SELECT id, name FROM games WHERE id=? AND enabled=1').get(req.body.game_id);
    if (!game) return fail(res, 404, 'NOT_FOUND', 'Game not found.');
    const gpu = db.prepare('SELECT id, name FROM gpus WHERE id=? AND enabled=1').get(req.body.gpu_id);
    if (!gpu) return fail(res, 404, 'NOT_FOUND', 'GPU not found.');
    const cpuId = parseId(req.body.cpu_id);
    if (req.body.cpu_id != null && cpuId == null) return fail(res, 422, 'VALIDATION', 'Invalid CPU.');
    if (cpuId) {
      const cpu = db.prepare('SELECT id, name FROM cpus WHERE id=? AND enabled=1').get(cpuId);
      if (!cpu) return fail(res, 404, 'NOT_FOUND', 'CPU not found.');
    }

    const pct1 = req.body.pct1_low != null ? Number(req.body.pct1_low) : null;
    const avg = Number(req.body.avg_fps);
    if (pct1 != null && pct1 > avg) {
      return fail(res, 422, 'VALIDATION', '1% low cannot be higher than the average FPS.');
    }
    if (!req.body.agreed_measured) {
      return fail(res, 422, 'VALIDATION', 'Confirm that these are real numbers you measured on your own PC.');
    }

    const dup = db.prepare(`
      SELECT id, status FROM community_benchmarks
      WHERE user_id=? AND game_id=? AND cpu_id IS ? AND gpu_id=? AND resolution=? AND quality=?
        AND COALESCE(upscaling, 'None')=? AND status IN ('pending', 'approved')
    `).get(req.user.id, game.id, cpuId, gpu.id, req.body.resolution, req.body.quality,
      req.body.upscaling || 'None');
    if (dup) {
      return fail(res, 409, 'DUPLICATE_SUBMISSION',
        dup.status === 'approved'
          ? 'You already have an approved result for this exact configuration.'
          : 'This exact result is already pending review.');
    }

    const id = db.prepare(`
      INSERT INTO community_benchmarks
        (user_id, game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling, avg_fps, pct1_low, fps_method, driver_version, notes, agreed_measured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, game.id, cpuId, gpu.id, req.body.resolution, req.body.quality,
      req.body.rt_enabled ? 1 : 0, req.body.upscaling || 'None',
      avg, pct1, req.body.fps_method, req.body.driver_version || null, req.body.notes || null,
      req.body.agreed_measured ? 1 : 0,
    ).lastInsertRowid;

    ok(res, {
      id,
      label: 'user-provided',
      message: 'Submitted for review. It will appear in the community results only after an admin approves it.',
    }, { status: 'pending' });
  });

// GET /api/community/benchmarks/mine — the signed-in user's own submissions
router.get('/benchmarks/mine',
  query('status').optional().isIn(STATUSES).withMessage('Invalid status filter.'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit.'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Invalid offset.'),
  validate, (req, res) => {
    const status = req.query.status;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const where = status
      ? 'WHERE cb.user_id=? AND cb.status=?'
      : 'WHERE cb.user_id=?';
    const params = status ? [req.user.id, status] : [req.user.id];
    const { rows, total } = listQuery(where, params, limit, offset);
    const counts = {
      pending: db.prepare('SELECT COUNT(*) c FROM community_benchmarks WHERE user_id=? AND status=?').get(req.user.id, 'pending').c,
      approved: db.prepare('SELECT COUNT(*) c FROM community_benchmarks WHERE user_id=? AND status=?').get(req.user.id, 'approved').c,
      rejected: db.prepare('SELECT COUNT(*) c FROM community_benchmarks WHERE user_id=? AND status=?').get(req.user.id, 'rejected').c,
      hidden: db.prepare('SELECT COUNT(*) c FROM community_benchmarks WHERE user_id=? AND status=?').get(req.user.id, 'hidden').c,
    };
    ok(res, { rows, total, counts }, { status });
  });

// GET /api/community/benchmarks/public — community results (approved only)
router.get('/benchmarks/public',
  query('game_id').optional().isInt().withMessage('Invalid game filter.'),
  query('gpu_id').optional().isInt().withMessage('Invalid GPU filter.'),
  query('cpu_id').optional().isInt().withMessage('Invalid CPU filter.'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit.'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Invalid offset.'),
  validate, (req, res) => {
    const conds = ["cb.status='approved'"];
    const params = [];
    for (const f of ['game_id', 'gpu_id', 'cpu_id']) {
      const v = parseId(req.query[f]);
      if (v) { conds.push(`cb.${f}=?`); params.push(v); }
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const offset = Number(req.query.offset) || 0;
    const { rows, total } = listQuery(where, params, limit, offset);
    ok(res, { rows, total }, { label: 'community-verified' });
  });

// DELETE /api/community/benchmarks/:id — owner removes own pending/rejected row
router.delete('/benchmarks/:id', param('id').isInt(), validate, (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id, user_id, status FROM community_benchmarks WHERE id=?').get(id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Result not found.');
  if (row.user_id !== req.user.id) return fail(res, 403, 'FORBIDDEN', 'You can only delete your own submissions.');
  if (!['pending', 'rejected'].includes(row.status)) {
    return fail(res, 403, 'FORBIDDEN', 'Reviewed results cannot be deleted here. Contact support if this is wrong.');
  }
  db.prepare('DELETE FROM community_benchmarks WHERE id=?').run(id);
  ok(res, { deleted: true });
});

export default router;
