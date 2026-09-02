import { db, now } from '../db.js';

export class InsufficientCreditsError extends Error {
  constructor(needed, balance) {
    super('Not enough AI credits. Upgrade your plan to continue.');
    this.name = 'InsufficientCreditsError';
    this.code = 'INSUFFICIENT_CREDITS';
    this.needed = needed;
    this.balance = balance;
  }
}

const DEFAULT_COSTS = {
  chat: 2,
  advice: 3,
  weekly_report: 8,
  session_coach: 5,
  game_coach: 5,
  plan: 10,
  ai_builder_prompt: 4,
  default: 3,
};

function settingInt(key, fallback) {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

export function featureCost(feature) {
  if (!feature) return settingInt('credit_cost_default', DEFAULT_COSTS.default);
  const key = `credit_cost_${feature}`;
  const fallback = DEFAULT_COSTS[feature] ?? DEFAULT_COSTS.default;
  return Math.max(0, settingInt(key, fallback));
}

export function freeSignupCredits() {
  return Math.max(0, settingInt('free_signup_credits', 25));
}

export function ensureWallet(userId) {
  db.prepare(`
    INSERT INTO credit_wallets (user_id, balance, lifetime_granted, lifetime_spent, updated_at)
    VALUES (?, 0, 0, 0, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, now());
  return db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
}

export function getWallet(userId) {
  return ensureWallet(userId);
}

export function grantCredits(userId, amount, reason, { feature = null, refType = null, refId = null } = {}) {
  const n = Math.trunc(Number(amount) || 0);
  if (n <= 0) return getWallet(userId);
  const grant = db.transaction(() => {
    ensureWallet(userId);
    db.prepare(`
      UPDATE credit_wallets
      SET balance = balance + ?, lifetime_granted = lifetime_granted + ?, updated_at = ?
      WHERE user_id = ?
    `).run(n, n, now(), userId);
    const wallet = db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
    db.prepare(`
      INSERT INTO credit_ledger (user_id, delta, balance_after, reason, feature, ref_type, ref_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, n, wallet.balance, reason, feature, refType, refId);
    return wallet;
  });
  return grant();
}

export function deductCredits(userId, amount, reason, { feature = null, refType = null, refId = null } = {}) {
  const n = Math.min(Math.trunc(Number(amount) || 0), 0);
  if (n >= 0) return getWallet(userId);
  const deduct = db.transaction(() => {
    ensureWallet(userId);
    const wallet = db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
    const applied = Math.max(-wallet.balance, n);
    db.prepare(`
      UPDATE credit_wallets
      SET balance = balance + ?, updated_at = ?
      WHERE user_id = ?
    `).run(applied, now(), userId);
    const after = db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
    db.prepare(`
      INSERT INTO credit_ledger (user_id, delta, balance_after, reason, feature, ref_type, ref_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, applied, after.balance, reason, feature, refType, refId);
    return after;
  });
  return deduct();
}

export function spendCredits(userId, feature) {
  if (!userId) return null;
  const cost = featureCost(feature);
  if (cost <= 0) return getWallet(userId);
  const spend = db.transaction(() => {
    ensureWallet(userId);
    const wallet = db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
    if (wallet.balance < cost) {
      throw new InsufficientCreditsError(cost, wallet.balance);
    }
    db.prepare(`
      UPDATE credit_wallets
      SET balance = balance - ?, lifetime_spent = lifetime_spent + ?, updated_at = ?
      WHERE user_id = ?
    `).run(cost, cost, now(), userId);
    const after = db.prepare('SELECT * FROM credit_wallets WHERE user_id = ?').get(userId);
    db.prepare(`
      INSERT INTO credit_ledger (user_id, delta, balance_after, reason, feature, ref_type, ref_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, -cost, after.balance, 'ai_spend', feature, 'ai_request', null);
    return after;
  });
  return spend();
}

export function refundCredits(userId, feature, reason = 'ai_refund') {
  if (!userId) return null;
  const cost = featureCost(feature);
  if (cost <= 0) return getWallet(userId);
  return grantCredits(userId, cost, reason, { feature, refType: 'ai_request' });
}

export function getActivePlan(userId) {
  return db.prepare(`
    SELECT s.*, p.slug, p.name as plan_name, p.price_sek, p.monthly_credits, p.is_free
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = ? AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1
  `).get(userId) || null;
}

export function ensureFreePlan(userId) {
  const existing = getActivePlan(userId);
  if (existing) return existing;
  const free = db.prepare("SELECT * FROM plans WHERE is_free = 1 AND is_active = 1 LIMIT 1").get();
  if (!free) return null;
  db.prepare(`
    INSERT INTO subscriptions (user_id, plan_id, status, payment_method, current_period_start, current_period_end, created_at, updated_at)
    VALUES (?, ?, 'active', 'free', datetime('now'), datetime('now', '+1 month'), ?, ?)
  `).run(userId, free.id, now(), now());
  const wallet = getWallet(userId);
  if (wallet.lifetime_granted === 0 && free.monthly_credits > 0) {
    grantCredits(userId, free.monthly_credits, 'signup_grant', { refType: 'plan', refId: free.id });
  }
  return getActivePlan(userId);
}

export function listLedger(userId, limit = 40) {
  return db.prepare(`
    SELECT id, delta, balance_after, reason, feature, created_at
    FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, limit);
}

export function creditCosts() {
  return {
    chat: featureCost('chat'),
    advice: featureCost('advice'),
    weekly_report: featureCost('weekly_report'),
    session_coach: featureCost('session_coach'),
    game_coach: featureCost('game_coach'),
    plan: featureCost('plan'),
    ai_builder_prompt: featureCost('ai_builder_prompt'),
    default: featureCost('default'),
  };
}

export function ensureBillingDefaults() {
  const billingDefaults = {
    free_signup_credits: '25',
    credit_cost_chat: '2',
    credit_cost_advice: '3',
    credit_cost_weekly_report: '8',
    credit_cost_session_coach: '5',
    credit_cost_game_coach: '5',
    credit_cost_plan: '10',
    credit_cost_ai_builder_prompt: '4',
    credit_cost_default: '3',
    payment_demo: '0',
    payment_methods: 'card',
    referral_enabled: '1',
    referral_signup_credits: '100',
    referral_subscription_credits: '500',
    referral_discount_percent: '50',
    referral_monthly_limit: '10',
    referral_duplicate_protection: '1',
  };
  const insertIgnore = db.prepare('INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(billingDefaults)) insertIgnore.run(k, v);

  const insert = db.prepare(`
    INSERT INTO plans (slug, name, tagline, price_sek, monthly_credits, sort_order, is_free, is_featured, is_active, features_json)
    VALUES (@slug, @name, @tagline, @price_sek, @monthly_credits, @sort_order, @is_free, @is_featured, 1, @features_json)
    ON CONFLICT(slug) DO NOTHING
  `);
  const plans = [
    {
      slug: 'free',
      name: 'Free',
      tagline: 'All non-AI tools, plus a starter pack of AI credits.',
      price_sek: 0,
      monthly_credits: 25,
      sort_order: 0,
      is_free: 1,
      is_featured: 0,
      features_json: JSON.stringify([
        'All PC tools (builder, FPS, compatibility, upgrades, settings)',
        'Session tracker, performance, streaks, friends',
        '25 AI credits on signup',
        'Hardware catalog and compare',
      ]),
    },
    {
      slug: 'starter',
      name: 'Starter',
      tagline: 'Enough AI coaching for regular play.',
      price_sek: 59,
      monthly_credits: 150,
      sort_order: 1,
      is_free: 0,
      is_featured: 0,
      features_json: JSON.stringify([
        'Everything in Free',
        '150 AI credits every month',
        'AI Chat and AI Coach',
        'Weekly AI reports',
      ]),
    },
    {
      slug: 'plus',
      name: 'Plus',
      tagline: 'The best value for serious players.',
      price_sek: 99,
      monthly_credits: 400,
      sort_order: 2,
      is_free: 0,
      is_featured: 1,
      features_json: JSON.stringify([
        'Everything in Starter',
        '400 AI credits every month',
        'Priority AI coaching',
        'Improvement plans',
      ]),
    },
    {
      slug: 'pro',
      name: 'Pro',
      tagline: 'Unlimited-feeling AI for power users.',
      price_sek: 299,
      monthly_credits: 1500,
      sort_order: 3,
      is_free: 0,
      is_featured: 0,
      features_json: JSON.stringify([
        'Everything in Plus',
        '1500 AI credits every month',
        'Highest monthly allowance',
        'Best for daily coaching and reports',
      ]),
    },
  ];
  for (const p of plans) insert.run(p);
}
