import { db, now } from '../db.js';
import { grantCredits } from './credits.js';

export function referralSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

export function referralEnabled() {
  return String(db.prepare("SELECT value FROM admin_settings WHERE key = 'referral_enabled'").get()?.value ?? '1') === '1';
}

export function referralSignupCredits() {
  return referralSetting('referral_signup_credits', 100);
}

export function referralSubscriptionCredits() {
  return referralSetting('referral_subscription_credits', 500);
}

export function referralDiscountPercent() {
  return Math.min(100, Math.max(0, referralSetting('referral_discount_percent', 50)));
}

export function referralMonthlyLimit() {
  return referralSetting('referral_monthly_limit', 10);
}

export function referralDuplicateProtection() {
  return String(db.prepare("SELECT value FROM admin_settings WHERE key = 'referral_duplicate_protection'").get()?.value ?? '1') === '1';
}

export function sanitizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

export function generateReferralCode(username) {
  const base = sanitizeCode(username).slice(0, 6);
  const suffix = Math.floor(10 + Math.random() * 89);
  let code = base || 'LCL';
  let candidate = `${code}${suffix}`;
  let i = 0;
  const taken = (c) => !!db.prepare('SELECT 1 FROM profiles WHERE referral_code = ?').get(c);
  while (taken(candidate) && i < 50) {
    candidate = `${code}${Math.floor(10 + Math.random() * 89)}`;
    i += 1;
  }
  while (taken(candidate)) {
    candidate = `${code}${Math.floor(100 + Math.random() * 900)}`;
  }
  return candidate;
}

export function findReferrerByCode(code) {
  const c = sanitizeCode(code);
  if (!c) return null;
  return db.prepare(`
    SELECT u.id, u.username FROM profiles p JOIN users u ON u.id = p.user_id
    WHERE upper(p.referral_code) = ? AND u.status = 'active'
  `).get(c) || null;
}

export function getReferralByReferee(refereeUserId) {
  return db.prepare('SELECT * FROM referrals WHERE referee_user_id = ?').get(refereeUserId) || null;
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || '';
}

export function hasPaidSubscription(userId) {
  return !!db.prepare(`
    SELECT 1 FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = ? AND p.is_free = 0 LIMIT 1
  `).get(userId) || !!db.prepare("SELECT 1 FROM payments WHERE user_id = ? AND status = 'paid' LIMIT 1").get(userId);
}

export function referralDiscountFor(userId) {
  if (!referralEnabled()) return null;
  const referral = getReferralByReferee(userId);
  if (!referral || referral.discount_applied) return null;
  if (hasPaidSubscription(userId)) return null;
  return {
    referralId: referral.id,
    percent: referralDiscountPercent(),
  };
}

export function monthlySuccessfulCount(referrerUserId) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM referrals
    WHERE referrer_user_id = ? AND subscription_granted = 1
      AND created_at >= datetime('now', 'start of month')
  `).get(referrerUserId)?.c || 0;
}

export function recordSignupReferral({ referrerUserId, refereeUserId, code, ip, deviceId }) {
  if (!referralEnabled()) return null;
  const signupReward = referralSignupCredits();
  const id = db.prepare(`
    INSERT INTO referrals (referrer_user_id, referee_user_id, code, signup_granted, ip, device_id, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(referrerUserId, refereeUserId, code, ip, deviceId, now(), now()).lastInsertRowid;
  if (signupReward > 0) {
    grantCredits(referrerUserId, signupReward, 'referral_signup', { feature: 'referral', refType: 'referral', refId: id });
    grantCredits(refereeUserId, signupReward, 'referral_signup', { feature: 'referral', refType: 'referral', refId: id });
  }
  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
}

export function rewardSubscriptionReferral(referralId) {
  const referral = db.prepare('SELECT * FROM referrals WHERE id = ?').get(referralId);
  if (!referral) return null;
  if (!referral.subscription_granted && !referral.subscription_skipped) {
    const reward = referralSubscriptionCredits();
    if (monthlySuccessfulCount(referral.referrer_user_id) >= referralMonthlyLimit()) {
      db.prepare('UPDATE referrals SET subscription_skipped = 1, updated_at = ? WHERE id = ?').run(now(), referral.id);
    } else if (reward > 0) {
      grantCredits(referral.referrer_user_id, reward, 'referral_subscription', { feature: 'referral', refType: 'referral', refId: referral.id });
      db.prepare('UPDATE referrals SET subscription_granted = 1, updated_at = ? WHERE id = ?').run(now(), referral.id);
    }
  }
  if (referral.discount_applied) return null;
  db.prepare('UPDATE referrals SET discount_applied = 1, updated_at = ? WHERE id = ?').run(now(), referral.id);
  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(referral.id);
}

export function registerDevice(userId, { deviceId, ip }) {
  if (deviceId) {
    db.prepare('INSERT INTO user_devices (user_id, device_id, ip, created_at) VALUES (?, ?, ?, ?)').run(userId, deviceId, ip, now());
  }
  db.prepare('INSERT INTO user_devices (user_id, device_id, ip, created_at) VALUES (?, NULL, ?, ?)').run(userId, ip, now());
}

export function findDuplicateAccount({ deviceId, ip }) {
  if (!referralDuplicateProtection()) return null;
  if (deviceId) {
    const byDevice = db.prepare(`
      SELECT u.id, u.username FROM user_devices d JOIN users u ON u.id = d.user_id
      WHERE d.device_id = ? ORDER BY d.id LIMIT 1
    `).get(deviceId);
    if (byDevice) return { ...byDevice, reason: 'device' };
  }
  if (ip) {
    const byIp = db.prepare(`
      SELECT u.id, u.username FROM user_devices d JOIN users u ON u.id = d.user_id
      WHERE d.ip = ? ORDER BY d.id LIMIT 1
    `).get(ip);
    if (byIp) return { ...byIp, reason: 'ip' };
  }
  return null;
}

export function referralStatsFor(userId) {
  const profile = db.prepare('SELECT referral_code FROM profiles WHERE user_id = ?').get(userId);
  const invited = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = ?').get(userId)?.c || 0;
  const signupRewarded = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = ? AND signup_granted = 1').get(userId)?.c || 0;
  const subscriptionRewarded = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = ? AND subscription_granted = 1').get(userId)?.c || 0;
  const myReferral = getReferralByReferee(userId);
  return {
    code: profile?.referral_code || null,
    invited,
    signupRewarded,
    subscriptionRewarded,
    monthlyUsed: monthlySuccessfulCount(userId),
    monthlyLimit: referralMonthlyLimit(),
    discountPercent: referralDiscountPercent(),
    signupCredits: referralSignupCredits(),
    subscriptionCredits: referralSubscriptionCredits(),
    referredBy: myReferral ? (db.prepare('SELECT username FROM users WHERE id = ?').get(myReferral.referrer_user_id)?.username || null) : null,
    discountApplied: myReferral ? Boolean(myReferral.discount_applied) : false,
    hasPaid: hasPaidSubscription(userId),
  };
}

export function adminReferralSummary() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM referrals').get()?.c || 0;
  const signupRewards = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE signup_granted = 1').get()?.c || 0;
  const subscriptionRewards = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE subscription_granted = 1').get()?.c || 0;
  const discounts = db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE discount_applied = 1').get()?.c || 0;
  const thisMonth = db.prepare("SELECT COUNT(*) AS c FROM referrals WHERE created_at >= datetime('now', 'start of month')").get()?.c || 0;
  const top = db.prepare(`
    SELECT u.id, u.username, p.referral_code AS code,
      COUNT(r.id) AS total,
      SUM(CASE WHEN r.signup_granted = 1 THEN 1 ELSE 0 END) AS signups,
      SUM(CASE WHEN r.subscription_granted = 1 THEN 1 ELSE 0 END) AS subscriptions
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN referrals r ON r.referrer_user_id = u.id
    GROUP BY u.id
    HAVING COUNT(r.id) > 0
    ORDER BY COUNT(r.id) DESC LIMIT 20
  `).all();
  return { total, signupRewards, subscriptionRewards, discounts, thisMonth, top };
}
