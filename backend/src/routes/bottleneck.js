import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { ok, fail } from '../utils/helpers.js';
import { estimateBottleneck } from '../engines/bottleneck.js';

const router = Router();

// Public (no auth) bottleneck tool. Kept public so the calculator can be shared
// and linked freely — same policy as the hardware catalog and game list.
const calcLimiter = rateLimit({
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

// POST /api/bottleneck/calc
router.post('/calc',
  calcLimiter,
  body('cpu_id').isInt({ min: 1 }).withMessage('Select a CPU.'),
  body('gpu_id').isInt({ min: 1 }).withMessage('Select a GPU.'),
  body('resolution').optional().isIn(['1080p', '1440p', '4K']),
  body('quality').optional().isIn(['Low', 'Medium', 'High', 'Ultra', 'Epic']),
  validate, (req, res) => {
    const result = estimateBottleneck({
      cpuId: Number(req.body.cpu_id),
      gpuId: Number(req.body.gpu_id),
      resolution: req.body.resolution || '1080p',
      quality: req.body.quality || 'Ultra',
    });
    ok(res, result);
  });

export default router;
