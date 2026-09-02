import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, randomToken, sha256 } from '../utils/helpers.js';
import { sendMail, lastOutboxLink } from '../utils/mailer.js';
import { ensureFreePlan } from '../services/credits.js';
import {
  generateReferralCode, findReferrerByCode, recordSignupReferral,
  findDuplicateAccount, registerDevice, clientIp, sanitizeCode,
} from '../services/referrals.js';

const MAIL_ERROR_MSG = 'Email delivery is not configured. Please contact support.';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
});
router.use(limiter);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return fail(res, 422, 'VALIDATION', errors.array().map((e) => e.msg).join(' '));
  }
  next();
};

function signUserToken(user) {
  return jwt.sign({ sub: user.id, type: 'user' }, config.jwtSecret, { expiresIn: '7d' });
}

function debugLinkFor(email) {
  return config.nodeEnv === 'production' ? null : lastOutboxLink(email);
}

// Build the clickable base for email links from the origin the frontend actually runs
// on (public preview hosts reachable by the recipient), never a localhost address.
function publicOrigin(req) {
  const raw = String((req.body && req.body.appUrl) || '').trim().replace(/\/+$/, '');
  if (raw && /^https:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).host;
      const local = /(^|\.)localhost$/i.test(host) || /^127\.0\.0\.1$/.test(host)
        || /(^|\.)local$/i.test(host) || host === '0.0.0.0';
      if (!local) return raw;
    } catch { /* malformed URL -> fall through to config */ }
  }
  return config.appUrl;
}

// POST /api/auth/register
router.post('/register',
  body('username').trim().isLength({ min: 3, max: 32 }).withMessage('Username must be 3–32 characters.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username may only contain letters, numbers and underscores.'),
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters.'),
  validate,
  async (req, res) => {
    const { username, email, password } = req.body;
    const em = String(email).toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) return fail(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return fail(res, 409, 'USERNAME_TAKEN', 'This username is already taken.');

    const ip = clientIp(req);
    const deviceId = sanitizeCode(String(req.body.deviceId || '')).toLowerCase();
    const dup = findDuplicateAccount({ deviceId, ip });
    if (dup) {
      return fail(res, 409, 'DUPLICATE_ACCOUNT', 'One account per person. This device or IP is already linked to an account.');
    }

    const code = sanitizeCode(req.body.referralCode);
    let referrer = null;
    if (code) {
      referrer = findReferrerByCode(code);
      if (!referrer) return fail(res, 400, 'REFERRAL_INVALID', 'This referral code is not valid. Check the code or leave the field empty.');
      if (String(referrer.username).toLowerCase() === String(username).toLowerCase()) {
        return fail(res, 400, 'REFERRAL_SELF', 'You cannot use your own referral code.');
      }
    }

    const hash = bcrypt.hashSync(password, 10);
    const uid = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)').run(username, em, hash).lastInsertRowid;
    const referralCode = generateReferralCode(username);
    db.prepare('INSERT INTO profiles (user_id, referral_code) VALUES (?, ?)').run(uid, referralCode);
    registerDevice(uid, { deviceId, ip });
    ensureFreePlan(uid);

    let referral = null;
    if (referrer) {
      referral = recordSignupReferral({ referrerUserId: referrer.id, refereeUserId: uid, code, ip, deviceId });
    }

    const raw = randomToken();
    db.prepare("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))").run(uid, sha256(raw), 'email_verify');
    const link = `${publicOrigin(req)}/verify-email?token=${raw}`;
    const delivered = await sendMail(em, 'Verify your email', `Welcome to Gaming Performance Platform, ${username}! Click the link to verify your email: ${link}`, link);

    const user = { id: uid, username, email: em, emailVerified: false, status: 'active' };
    return ok(res, {
      user,
      token: signUserToken(user),
      emailSent: delivered,
      debugLink: delivered ? null : debugLinkFor(em),
      referral: referral ? { rewarded: true, code: referralCode } : null,
    });
  });

// POST /api/auth/verify-email
router.post('/verify-email', body('token').notEmpty().withMessage('Token is required.'), validate, (req, res) => {
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ?').get(sha256(req.body.token));
  if (!row || row.purpose !== 'email_verify' || row.used) return fail(res, 400, 'INVALID_TOKEN', 'This verification link is invalid or has already been used.');
  if (new Date(row.expires_at) < new Date()) return fail(res, 400, 'TOKEN_EXPIRED', 'This verification link has expired.');
  db.prepare('UPDATE auth_tokens SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now(), row.user_id);
  const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(row.user_id);
  return ok(res, { user, token: signUserToken(user) });
});

// POST /api/auth/resend-verification
router.post('/resend-verification', body('email').isEmail().withMessage('Valid email required.'), validate, async (req, res) => {
  const em = String(req.body.email).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'No account found for this email.');
  if (user.email_verified) return ok(res, { alreadyVerified: true });
  const raw = randomToken();
  db.prepare("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))").run(user.id, sha256(raw), 'email_verify');
  const link = `${publicOrigin(req)}/verify-email?token=${raw}`;
  const delivered = await sendMail(em, 'Verify your email', `Click to verify: ${link}`, link);
  if (!delivered) return fail(res, 503, 'MAIL_UNAVAILABLE', MAIL_ERROR_MSG);
  return ok(res, { sent: true, debugLink: debugLinkFor(em) });
});

// POST /api/auth/login
router.post('/login', body('email').isEmail().withMessage('Valid email required.'), body('password').notEmpty().withMessage('Password required.'), validate, (req, res) => {
  const em = String(req.body.email).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (user.status !== 'active') return fail(res, 403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), user.id);
  const payload = { id: user.id, username: user.username, email: user.email, emailVerified: Boolean(user.email_verified), status: user.status };
  return ok(res, { user: payload, token: signUserToken(user), emailVerified: Boolean(user.email_verified) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => ok(res, { loggedOut: true }));

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  ok(res, {
    user: req.user,
    profile: profile || null,
  });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', body('email').isEmail().withMessage('Valid email required.'), validate, async (req, res) => {
  const em = String(req.body.email).toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(em);
  if (!user) return ok(res, { sent: true }); // don't leak account existence
  const raw = randomToken();
  db.prepare("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, datetime('now', '+1 hour'))").run(user.id, sha256(raw), 'password_reset');
  const link = `${publicOrigin(req)}/reset-password?token=${raw}`;
  const delivered = await sendMail(em, 'Reset your password', `Click to reset your password: ${link}`, link);
  if (!delivered) return fail(res, 503, 'MAIL_UNAVAILABLE', MAIL_ERROR_MSG);
  return ok(res, { sent: true, debugLink: config.nodeEnv !== 'production' ? lastOutboxLink(em) : null });
});

// POST /api/auth/reset-password
router.post('/reset-password',
  body('token').notEmpty().withMessage('Token required.'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters.'),
  validate, (req, res) => {
    const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ?').get(sha256(req.body.token));
    if (!row || row.purpose !== 'password_reset' || row.used) return fail(res, 400, 'INVALID_TOKEN', 'This reset link is invalid or has already been used.');
    if (new Date(row.expires_at) < new Date()) return fail(res, 400, 'TOKEN_EXPIRED', 'This reset link has expired.');
    db.prepare('UPDATE auth_tokens SET used = 1 WHERE id = ?').run(row.id);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), now(), row.user_id);
    return ok(res, { reset: true });
  });

// POST /api/auth/change-password
router.post('/change-password', requireAuth,
  body('currentPassword').notEmpty().withMessage('Current password required.'),
  body('newPassword').isLength({ min: 8, max: 128 }).withMessage('New password must be at least 8 characters.'),
  validate, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(bcrypt.hashSync(req.body.newPassword, 10), now(), user.id);
    return ok(res, { changed: true });
  });

// POST /api/auth/change-email
router.post('/change-email', requireAuth,
  body('newEmail').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password required.'),
  validate, async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(req.body.password, user.password_hash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Password is incorrect.');
    const em = String(req.body.newEmail).toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(em, user.id)) return fail(res, 409, 'EMAIL_TAKEN', 'This email is already in use.');
    const raw = randomToken();
    const tokenId = db.prepare("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))").run(user.id, sha256(raw), 'email_verify').lastInsertRowid;
    const link = `${publicOrigin(req)}/verify-email?token=${raw}`;
    const delivered = await sendMail(em, 'Verify your new email', `Click to verify: ${link}`, link);
    if (!delivered) {
      db.prepare('DELETE FROM auth_tokens WHERE id = ?').run(tokenId);
      return fail(res, 503, 'MAIL_UNAVAILABLE', MAIL_ERROR_MSG);
    }
    db.prepare('UPDATE users SET email = ?, email_verified = 0, updated_at = ? WHERE id = ?').run(em, now(), user.id);
    return ok(res, { changed: true, emailVerified: false, debugLink: debugLinkFor(em) });
  });

// DELETE /api/auth/account
router.delete('/account', requireAuth, body('password').notEmpty().withMessage('Password required.'), validate, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.password, user.password_hash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Password is incorrect.');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  return ok(res, { deleted: true });
});

export default router;
