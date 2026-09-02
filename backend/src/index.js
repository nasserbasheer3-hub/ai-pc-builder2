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
import { seedIfEmpty, ensureAdmin, issueAdminSetupToken } from './seed.js';
import { InsufficientCreditsError, ensureBillingDefaults } from './services/credits.js';
import { getStripe, handleStripeEvent, stripeKeys, isWebhookConfigured, isStripeConfigured, demoPaymentsEnabled } from './services/payments.js';

migrate();
ensureBillingDefaults();
// Auto-seed a fresh/empty database on boot (production-safe: no demo users,
// admin only created when an ADMIN_PASSWORD env is explicitly provided).
try {
  seedIfEmpty({ demo: false, admin: false });
  if (process.env.ADMIN_PASSWORD) ensureAdmin();
} catch (e) {
  console.error('[seed] auto-seed failed:', e.message);
}

// First-run admin bootstrap: if no admin exists and no ADMIN_PASSWORD was given,
// print a fresh one-time setup token (24h) to the logs so the operator can create
// the admin at /admin/setup from the browser.
const adminSetupToken = issueAdminSetupToken();
if (adminSetupToken) {
  console.log(`[setup] ADMIN SETUP TOKEN (one-time, valid 24h, regenerated on each boot until used): ${adminSetupToken}`);
}

// Boot diagnostics: clearly report which integrations are configured so an
// operator (or this assistant, remotely) can see what is still missing.
console.log(`[setup] database: ${config.dbPath}${config.dbPath === path.resolve(process.cwd(), 'data/gaming_platform.db') ? ' (EPHEMERAL - data is lost on redeploy unless DATABASE_PATH points at a persistent disk)' : ' (persistent)'}`);
console.log(`[setup] stripe:   ${isStripeConfigured() ? 'configured' : 'NOT configured - paid plans are blocked until STRIPE_SECRET_KEY/PUBLISHABLE are set'}`);
console.log(`[setup] webhook:  ${isWebhookConfigured() ? 'configured' : 'not configured (STRIPE_WEBHOOK_SECRET) - still works via redirect, but webhooks recommended'}`);
console.log(`[setup] demo pay: ${demoPaymentsEnabled() ? 'ENABLED (PAYMENT_DEMO=1) - plan upgrades grant credits without real payment' : 'disabled'}`);
console.log(`[setup] ai:       ${config.ai.apiKey ? `configured (${config.ai.model})` : 'NOT configured - AI chat/coach disabled until USER_LLM_API_KEY is set'}`);
console.log(`[setup] mail:     ${config.email.smtpHost ? 'configured' : 'NOT configured (SMTP_HOST/USER/PASS) - email links are not delivered'}`);
console.log(`[setup] admin:    ${process.env.ADMIN_PASSWORD ? `will be ensured: ${config.admin.email}` : (adminSetupToken ? 'no account yet - one-time setup token printed above (open /admin/setup)' : 'configured')}`);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-insecure-jwt-secret-change-me') {
  console.warn('[setup] WARNING: JWT_SECRET is the public default - user sessions can be forged. Set a random JWT_SECRET env var.');
}
if (!process.env.JWT_ADMIN_SECRET || process.env.JWT_ADMIN_SECRET === 'dev-insecure-admin-jwt-secret-change-me') {
  console.warn('[setup] WARNING: JWT_ADMIN_SECRET is the public default - admin sessions can be forged. Set a random JWT_ADMIN_SECRET env var.');
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

// Read-only deployment diagnostics (no secrets - only booleans/masks) so an
// operator can confirm which integrations are active.
app.get('/api/setup/status', (req, res) => {
  const keys = stripeKeys();
  res.json({
    ok: true,
    data: {
      env: config.nodeEnv,
      appUrl: config.appUrl,
      persistentDb: config.dbPath !== path.resolve(process.cwd(), 'data/gaming_platform.db'),
      stripeConfigured: isStripeConfigured(),
      stripeKeyMasked: isStripeConfigured() ? `${keys.secret.slice(0, 7)}...${keys.secret.slice(-4)}` : '',
      webhookConfigured: isWebhookConfigured(),
      demoEnabled: demoPaymentsEnabled(),
      aiEnabled: Boolean(config.ai.apiKey),
      aiModel: config.ai.apiKey ? config.ai.model : '',
      mailConfigured: Boolean(config.email.smtpHost),
      adminConfigured: Boolean(process.env.ADMIN_PASSWORD),
      adminEmail: process.env.ADMIN_PASSWORD ? config.admin.email : '',
    },
  });
});

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
