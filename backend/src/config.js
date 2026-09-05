import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

dotenv.config({ path: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.env') });
dotenv.config(); // also load from cwd

const root = process.cwd();

const isProduction = process.env.NODE_ENV === 'production';
// In production, never fall back to the well-known dev secrets that ship in this
// public repository (they would let anyone forge user/admin JWTs). Generate an
// ephemeral random secret per boot instead; sessions are simply reset on each
// restart until the operator sets JWT_SECRET / JWT_ADMIN_SECRET.
const ephemeral = () => crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || (isProduction ? ephemeral() : 'dev-insecure-jwt-secret-change-me'),
  jwtAdminSecret: process.env.JWT_ADMIN_SECRET || (isProduction ? ephemeral() : 'dev-insecure-admin-jwt-secret-change-me'),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  dbPath: process.env.DATABASE_PATH
    ? path.resolve(root, process.env.DATABASE_PATH)
    : path.resolve(root, 'data/gaming_platform.db'),
  email: {
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'ApexCore <no-reply@gamingplatform.local>',
  },
  ai: {
    apiKey: process.env.USER_LLM_API_KEY || '',
    baseUrl: process.env.USER_LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.USER_LLM_MODEL || 'gpt-4o-mini',
  },
  steam: {
    apiKey: process.env.USER_STEAM_API_KEY || '',
    baseUrl: process.env.USER_STEAM_BASE_URL || 'https://api.steampowered.com',
  },
  amazon: {
    accessKey: process.env.AMAZON_ACCESS_KEY || '',
    secretKey: process.env.AMAZON_SECRET_KEY || '',
    partnerTag: process.env.AMAZON_PARTNER_TAG || '',
    // Whole-listing availability window (hours) for cached PA-API prices.
    ttlHours: Number(process.env.AMAZON_PRICE_TTL_HOURS || 72),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@gamingplatform.local',
    password: process.env.ADMIN_PASSWORD || 'Admin12345!',
  },
  // Approximate SEK -> GBP rate used ONLY for display conversion (billing
  // remains SEK). Override with FX_SEK_TO_GBP when the rate moves.
  fxSekToGbp: Number(process.env.FX_SEK_TO_GBP || 0.07734),
};

if (!fs.existsSync(path.dirname(config.dbPath))) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}
