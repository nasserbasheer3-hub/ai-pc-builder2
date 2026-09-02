import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { ok, fail } from '../utils/helpers.js';
import { estimatePsu } from '../engines/psu.js';

const router = Router();

// Public (no auth) PSU sizing tool — same policy as the bottleneck calculator
// and the hardware catalog, so the calculator can be shared and linked freely.
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

// POST /api/psu/calc
router.post('/calc',
  calcLimiter,
  body('cpu_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('gpu_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('ram_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('ram_modules').optional({ nullable: true }).isInt({ min: 0, max: 8 }),
  body('storage_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('cooler_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('case_fans').optional({ nullable: true }).isInt({ min: 0, max: 12 }),
  body('psu_id').optional({ nullable: true }).isInt({ min: 1 }),
  validate, (req, res) => {
    const result = estimatePsu({
      cpuId: req.body.cpu_id ? Number(req.body.cpu_id) : null,
      gpuId: req.body.gpu_id ? Number(req.body.gpu_id) : null,
      ramId: req.body.ram_id ? Number(req.body.ram_id) : null,
      ramModules: req.body.ram_modules != null ? Number(req.body.ram_modules) : null,
      storageId: req.body.storage_id ? Number(req.body.storage_id) : null,
      coolerId: req.body.cooler_id ? Number(req.body.cooler_id) : null,
      caseFans: req.body.case_fans != null ? Number(req.body.case_fans) : 0,
      psuId: req.body.psu_id ? Number(req.body.psu_id) : null,
    });
    ok(res, result);
  });

export default router;
