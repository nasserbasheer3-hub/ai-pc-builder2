import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { ok, fail } from '../utils/helpers.js';
import { checkGame } from '../engines/gamecheck.js';

const router = Router();

// Public (no auth) "Can I run this game?" tool — same policy as the bottleneck
// and PSU calculators, so it can be shared and linked freely.
const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
});

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  next();
};

// POST /api/gamecheck/check
router.post('/check',
  checkLimiter,
  body('game_id').isInt({ min: 1 }).withMessage('Select a game.'),
  body('gpu_id').isInt({ min: 1 }).withMessage('Select a GPU.'),
  body('cpu_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('ram_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('storage_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('resolution').optional().isIn(['1080p', '1440p', '4K']),
  body('quality').optional().isIn(['Low', 'Medium', 'High', 'Ultra', 'Epic']),
  body('target_fps').optional({ nullable: true }).isInt({ min: 1, max: 480 }),
  validate, (req, res) => {
    const result = checkGame({
      gameId: Number(req.body.game_id),
      cpuId: req.body.cpu_id ? Number(req.body.cpu_id) : null,
      gpuId: Number(req.body.gpu_id),
      ramId: req.body.ram_id ? Number(req.body.ram_id) : null,
      storageId: req.body.storage_id ? Number(req.body.storage_id) : null,
      resolution: req.body.resolution || '1080p',
      quality: req.body.quality || 'Ultra',
      targetFps: req.body.target_fps != null ? Number(req.body.target_fps) : 60,
    });
    ok(res, result);
  });

export default router;
