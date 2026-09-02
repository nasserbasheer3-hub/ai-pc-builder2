import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config({ path: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.env') });
dotenv.config(); // also load from cwd

const root = process.cwd();

export const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me',
  jwtAdminSecret: process.env.JWT_ADMIN_SECRET || 'dev-insecure-admin-jwt-secret-change-me',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  dbPath: process.env.DATABASE_PATH
    ? path.resolve(root, process.env.DATABASE_PATH)
    : path.resolve(root, 'data/gaming_platform.db'),
  email: {
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'Gaming Performance Platform <no-reply@gamingplatform.local>',
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
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@gamingplatform.local',
    password: process.env.ADMIN_PASSWORD || 'Admin12345!',
  },
};

if (!fs.existsSync(path.dirname(config.dbPath))) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}
