import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
import { fail } from '../utils/helpers.js';

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return fail(res, 401, 'AUTH_REQUIRED', 'Authentication required.');
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.type !== 'user') throw new Error('wrong token type');
    const user = db.prepare('SELECT id, username, email, status, email_verified FROM users WHERE id = ?').get(payload.sub);
    if (!user) return fail(res, 401, 'AUTH_INVALID', 'Account no longer exists.');
    if (user.status !== 'active') return fail(res, 403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');
    req.user = user;
    next();
  } catch {
    return fail(res, 401, 'AUTH_INVALID', 'Session expired or invalid. Please sign in again.');
  }
}

export function requireVerified(req, res, next) {
  if (!req.user.email_verified) {
    return fail(res, 403, 'EMAIL_UNVERIFIED', 'Please verify your email address first.');
  }
  next();
}

export function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return fail(res, 401, 'ADMIN_AUTH_REQUIRED', 'Admin authentication required.');
  try {
    const payload = jwt.verify(token, config.jwtAdminSecret);
    if (payload.type !== 'admin') throw new Error('wrong token type');
    const admin = db.prepare('SELECT id, email, role, status FROM admin_users WHERE id = ?').get(payload.sub);
    if (!admin) return fail(res, 401, 'ADMIN_INVALID', 'Admin account no longer exists.');
    if (admin.status !== 'active') return fail(res, 403, 'ADMIN_DISABLED', 'Admin account is disabled.');
    req.admin = admin;
    next();
  } catch {
    return fail(res, 401, 'ADMIN_INVALID', 'Admin session expired or invalid.');
  }
}
