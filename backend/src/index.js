import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, migrate } from './db.js';
import { fail } from './utils/helpers.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import gamesRoutes from './routes/games.js';
import sessionsRoutes from './routes/sessions.js';
import performanceRoutes from './routes/performance.js';
import streakRoutes from './routes/streak.js';
import aiRoutes from './routes/ai.js';
import friendsRoutes from './routes/friends.js';
import pcRoutes from './routes/pc.js';
import pcToolsRoutes from './routes/pc-tools.js';
import hardwareRoutes from './routes/hardware.js';
import bottleneckRoutes from './routes/bottleneck.js';
import psuRoutes from './routes/psu.js';
import gamecheckRoutes from './routes/gamecheck.js';
import adminRoutes from './routes/admin.js';
import steamRoutes from './routes/steam.js';
import publicRoutes from './routes/public.js';
import articleRoutes from './routes/articles.js';
import seoRoutes from './routes/seo.js';
import billingRoutes from './routes/billing.js';
import communityRoutes from './routes/community.js';
import { seedIfEmpty } from './seed.js';
import { InsufficientCreditsError, ensureBillingDefaults } from './services/credits.js';
import { getStripe, handleStripeEvent, stripeKeys, isWebhookConfigured } from './services/payments.js';

migrate();
ensureBillingDefaults();
// Auto-seed a fresh/empty database on boot (production-safe: no demo users,
// admin only created when an ADMIN_PASSWORD env is explicitly provided).
try {
  seedIfEmpty({ demo: false, admin: Boolean(process.env.ADMIN_PASSWORD) });
} catch (e) {
  console.error('[seed] auto-seed failed:', e.message);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false, // SPA dev server; CSP is configured on the frontend build
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(compression({ threshold: 1024 }));

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const secret = stripeKeys().webhook;
  if (!stripe || !isWebhookConfigured()) {
    return fail(res, 503, 'PAYMENT_UNAVAILABLE', 'Stripe webhook is not configured.');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    console.error('[stripe.webhook]', e.message);
    return fail(res, 400, 'WEBHOOK_INVALID', 'Invalid webhook signature.');
  }
  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error('[stripe.webhook.handle]', e.message);
    return fail(res, 500, 'WEBHOOK_FAILED', 'Webhook handling failed.');
  }
  return res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests.' } });
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true, status: 'healthy', time: new Date().toISOString() }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

app.use(seoRoutes);
app.use('/api/articles', articleRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/streak', streakRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/pc', pcRoutes);
app.use('/api/pc', pcToolsRoutes);
app.use('/api/hardware', hardwareRoutes);
app.use('/api/bottleneck', bottleneckRoutes);
app.use('/api/psu', psuRoutes);
app.use('/api/gamecheck', gamecheckRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/steam', steamRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/community', communityRoutes);

// Single-origin production: serve the built frontend (frontend/dist) so the
// SPA and the API live on one URL (no CORS/proxy needed). API 404s below
// remain untouched; only non-/api GETs fall back to the SPA entry point.
const FRONTEND_DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  app.use(express.static(FRONTEND_DIST, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
  console.log(`[static] serving frontend from ${FRONTEND_DIST}`);
} else {
  console.log(`[static] ${FRONTEND_DIST} not found - API-only mode`);
}

app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Endpoint not found.'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err instanceof InsufficientCreditsError) {
    return fail(res, 402, 'INSUFFICIENT_CREDITS', err.message);
  }
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON', 'Invalid JSON body.');
  return fail(res, 500, 'INTERNAL', 'An unexpected error occurred.');
});

const server = app.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
