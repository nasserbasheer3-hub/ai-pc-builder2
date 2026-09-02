import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { troubleshootAnalysis, symptomDefs, SYMPTOM_QUESTIONS } from '../engines/troubleshoot.js';
import { scanText } from '../engines/scanner.js';
import { recommendLibrary } from '../engines/gameLibrary.js';
import { aiComplete, AIServiceError, aiEnabled, getSetting } from '../utils/ai.js';
import { InsufficientCreditsError } from '../services/credits.js';

const router = Router();
router.use(requireAuth);

const AI_ERROR_MSG = 'AI service is temporarily unavailable. Please try again later.';
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

// local import for logging only
import { db } from '../db.js';

const HARDWARE_FIELDS = ['cpu_id', 'gpu_id', 'ram_id', 'psu_id', 'cooler_id'];
function hardwareFrom(body) {
  const hw = {};
  for (const f of HARDWARE_FIELDS) {
    const id = parseId(body[f] ?? body[f.replace('_id', 'Id')]);
    if (id) hw[f.replace('_id', 'Id')] = id;
  }
  return hw;
}

// GET /api/pc/troubleshoot/defs — symptoms + their follow-up questions
router.get('/troubleshoot/defs', (req, res) => {
  ok(res, { symptoms: symptomDefs() });
});

// POST /api/pc/troubleshoot — run the rule-based diagnostic model
router.post('/troubleshoot',
  body('symptom').isIn(Object.keys(SYMPTOM_QUESTIONS)).withMessage('Select a symptom.'),
  body('answers').optional().isObject().withMessage('Invalid answers.'),
  validate, (req, res) => {
    try {
      const result = troubleshootAnalysis({
        symptom: req.body.symptom,
        hardware: hardwareFrom(req.body),
        answers: req.body.answers || {},
      });
      logEngine('troubleshoot', req.user.id);
      ok(res, result);
    } catch (e) {
      return fail(res, 400, 'ANALYSIS_FAILED', e.message);
    }
  });

// POST /api/pc/troubleshoot/summary — optional AI explanation written ONLY from engine results
router.post('/troubleshoot/summary',
  body('description').trim().isLength({ min: 2, max: 400 }).withMessage('Describe the problem.'),
  validate, async (req, res) => {
    if (!aiEnabled()) return ok(res, { ai: { available: false, content: null, error: AI_ERROR_MSG } });
    const analysis = req.body.analysis;
    if (!analysis || !Array.isArray(analysis.causes) || !analysis.causes.length) {
      return fail(res, 422, 'VALIDATION', 'Run the analysis first.');
    }
    try {
      const system = getSetting('ai_troubleshooter_prompt', 'You are a careful PC troubleshooting assistant. You explain possible causes and safe next steps without ever inventing facts.');
      const top = analysis.causes.map((c) => `- ${c.title} (≈${c.probability}% estimated likelihood): ${c.rationale?.[0] || ''}`).join('\n');
      const user = [
        `User's own description: ${req.body.description}`,
        `Symptom: ${analysis.symptomLabel}`,
        `Hardware used for analysis: CPU ${analysis.hardwareUsed?.cpu?.name || 'unknown'} | GPU ${analysis.hardwareUsed?.gpu?.name || 'unknown'} | PSU ${analysis.hardwareUsed?.psu?.name || 'unknown'}`,
        analysis.powerCheck ? `Power check: ${analysis.powerCheck.psuWattage}W PSU vs ~${analysis.powerCheck.recommendedW}W recommended (${analysis.powerCheck.verdict}).` : 'No power check (parts not known).',
        "Engine's ranked causes (ESTIMATED likelihood, keep these exact numbers):",
        top,
        'Write a short, friendly explanation: restate what the user should check first, in order of likelihood, with the concrete fix for each. Keep the probabilities. Never add causes that are not listed. Two short paragraphs or a short bulleted list.',
      ].join('\n');
      const { content } = await aiComplete({ feature: 'troubleshoot', system, user, user_id: req.user.id });
      return ok(res, { ai: { available: true, content } });
    } catch (e) {
      return ok(res, { ai: { available: false, content: null, error: e instanceof InsufficientCreditsError ? e.message : AI_ERROR_MSG } });
    }
  });

// POST /api/pc/scan — Smart Build Scanner: free text -> structured catalog parts
router.post('/scan',
  body('text').trim().isLength({ min: 3, max: 1200 }).withMessage('Describe your hardware (e.g. "RTX 4070, Ryzen 5 7600, 32GB RAM").'),
  validate, (req, res) => {
    try {
      const result = scanText(req.body.text);
      logEngine('scanner', req.user.id);
      ok(res, result);
    } catch (e) {
      return fail(res, 400, 'SCAN_FAILED', e.message);
    }
  });

// POST /api/pc/library/recommend — Game Library Scanner
router.post('/library/recommend',
  body('game_ids').isArray({ min: 1, max: 20 }).withMessage('Select 1-20 games.'),
  body('game_ids.*').isInt().withMessage('Invalid game id.'),
  body('resolution').optional().isIn(['1080p', '1440p', '4K']).withMessage('Invalid resolution.'),
  body('quality').optional().isIn(['Low', 'Medium', 'High', 'Ultra', 'Epic']).withMessage('Invalid quality.'),
  body('target_fps').optional().isInt({ min: 30, max: 360 }).withMessage('Target FPS 30-360.'),
  validate, (req, res) => {
    try {
      const result = recommendLibrary({
        gameIds: req.body.game_ids,
        resolution: req.body.resolution,
        quality: req.body.quality,
        targetFps: req.body.target_fps,
      });
      logEngine('library_scan', req.user.id);
      ok(res, result);
    } catch (e) {
      return fail(res, 400, 'RECOMMEND_FAILED', e.message);
    }
  });

export default router;
