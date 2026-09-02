import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../utils/helpers.js';
import { computeStreaks } from '../engines/insights.js';
import { activityDates } from '../services/metrics.js';
import { weekStart } from '../utils/helpers.js';

const router = Router();
router.use(requireAuth);

// GET /api/streak
router.get('/', (req, res) => {
  const streaks = computeStreaks(req.user.id);
  const dates = activityDates(req.user.id);
  const set = new Set(dates);

  const ws = weekStart();
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    weekDays.push({ date: iso, active: set.has(iso) });
  }
  const weekActive = weekDays.filter((d) => d.active).length;

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    last7.push({ date: iso, active: set.has(iso) });
  }

  ok(res, {
    current: streaks.current,
    best: streaks.best,
    lastActivityDate: streaks.lastActivityDate,
    week: { days: weekDays, activeDays: weekActive, target: 5 },
    last7,
    weeklyProgress: Math.min(weekActive / 5, 1),
  });
});

export default router;
