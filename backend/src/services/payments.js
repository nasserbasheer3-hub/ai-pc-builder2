import Stripe from 'stripe';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { grantCredits, deductCredits, getActivePlan, ensureFreePlan, getWallet } from './credits.js';
import { rewardSubscriptionReferral } from './referrals.js';

let stripeClient = null;
let stripeClientKey = '';

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function sanitizeKey(value) {
  return String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim().split(/\s+/)[0] || '';
}

function looksLikeKey(value, prefix) {
  const k = sanitizeKey(value);
  return k.startsWith(prefix) && k.length > 20 && !k.includes('xxx') && !k.includes('...');
}

export function stripeKeys() {
  const secret = sanitizeKey(getSetting('stripe_secret_key') || config.stripe.secretKey || '');
  const publishable = sanitizeKey(getSetting('stripe_publishable_key') || config.stripe.publishableKey || '');
  const webhook = sanitizeKey(getSetting('stripe_webhook_secret') || config.stripe.webhookSecret || '');
  return { secret, publishable, webhook };
}

export function isStripeConfigured() {
  return looksLikeKey(stripeKeys().secret, 'sk_');
}

export function isWebhookConfigured() {
  return looksLikeKey(stripeKeys().webhook, 'whsec_');
}

// Demo payments ("activate plan + grant credits without a real charge") must be
// switched on EXPLICITLY by the operator (PAYMENT_DEMO=1). Without that env var
// a paid plan can never be granted for free - not even when Stripe keys are
// missing - so a public deployment can never hand out credits without payment.
export function demoPaymentsEnabled() {
  return process.env.PAYMENT_DEMO === '1';
}

// Payment methods the live gateway can actually process. Stripe Checkout does
// not support Swish at all, so the default is card only. Klarna can be added
// here later once a merchant account has it activated.
export function supportedPaymentMethods() {
  const raw = String(getSetting('payment_methods', 'card')).split(',').map((s) => s.trim()).filter(Boolean);
  const out = raw.filter((m) => m === 'card');
  return out.length ? out : ['card'];
}

export function resetStripeClient() {
  stripeClient = null;
  stripeClientKey = '';
}

export function getStripe() {
  const secret = stripeKeys().secret;
  if (!looksLikeKey(secret, 'sk_')) return null;
  if (!stripeClient || stripeClientKey !== secret) {
    stripeClient = new Stripe(secret);
    stripeClientKey = secret;
  }
  return stripeClient;
}

export function maskSecret(value) {
  const k = String(value || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

const sekToMinor = (sek) => Math.max(0, Math.round((Number(sek) || 0) * 100));
const epochToIso = (s) => new Date((Number(s) || Math.floor(Date.now() / 1000)) * 1000).toISOString();

export function parseFeatures(row) {
  let features = [];
  try { features = JSON.parse(row.features_json || '[]'); } catch { features = []; }
  return { ...row, features, features_json: undefined };
}

export function listActivePlans() {
  return db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, price_sek ASC').all().map(parseFeatures);
}

function offerAppliesNow(offer, planId) {
  if (!offer || !offer.is_active) return false;
  if (offer.plan_id && Number(offer.plan_id) !== Number(planId)) return false;
  const t = Date.now();
  if (offer.starts_at && new Date(offer.starts_at).getTime() > t) return false;
  if (offer.ends_at && new Date(offer.ends_at).getTime() < t) return false;
  if (offer.max_redemptions != null && offer.times_redeemed >= offer.max_redemptions) return false;
  return true;
}

export function listActiveOffers(planId = null) {
  const rows = db.prepare('SELECT * FROM offers WHERE is_active = 1 ORDER BY id DESC').all();
  return rows.filter((o) => offerAppliesNow(o, planId || o.plan_id || 0));
}

export function bestAutoOffer(plan) {
  const offers = listActiveOffers(plan.id).filter((o) => !o.code);
  let best = null;
  let bestAmount = Math.max(0, Math.trunc(Number(plan.price_sek) || 0));
  for (const o of offers) {
    const priced = applyOffer(plan, o);
    if (priced.amount < bestAmount) {
      best = o;
      bestAmount = priced.amount;
    }
  }
  return best;
}

export function findOffer(codeOrId, planId) {
  if (codeOrId == null || codeOrId === '') return null;
  const asId = Number(codeOrId);
  const row = Number.isInteger(asId) && asId > 0
    ? db.prepare('SELECT * FROM offers WHERE id = ?').get(asId)
    : db.prepare('SELECT * FROM offers WHERE lower(code) = lower(?)').get(String(codeOrId).trim());
  if (!row) return null;
  if (!offerAppliesNow(row, planId)) return null;
  return row;
}

export function applyOffer(plan, offer) {
  const original = Math.max(0, Math.trunc(Number(plan.price_sek) || 0));
  if (!offer) return { amount: original, original, offer: null };
  let amount = original;
  if (offer.discount_type === 'fixed') amount = original - Math.max(0, Math.trunc(Number(offer.discount_value) || 0));
  else amount = Math.round(original * (100 - Math.min(100, Math.max(0, Number(offer.discount_value) || 0))) / 100);
  amount = Math.max(0, amount);
  return { amount, original, offer };
}

export function paymentMethodTypes(method) {
  if (method === 'swish') return ['swish'];
  if (method === 'klarna') return ['klarna'];
  return ['card'];
}

// ---------------------------------------------------------------------------
// Recurring (Stripe Subscription) support.
//
// A paid plan is a MONTHLY RECURRING subscription. Checkout is created in
// Stripe `mode: 'subscription'` against a cached recurring Price per plan.
// The user's card is charged once a month; every paid invoice grants the
// plan's monthly credits once and extends the active period. All money facts
// (amounts, periods) are taken from Stripe (invoice/session objects), never
// guessed, and each paid invoice maps to exactly one payments row so nothing
// is granted twice.
// ---------------------------------------------------------------------------

function upsertSetting(key, value) {
  db.prepare(`
    INSERT INTO admin_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Return the cached Stripe monthly Price id for a plan, creating it (product +
// recurring price) the first time that price point is needed.
async function ensureRecurringPrice(plan) {
  const amount = Math.trunc(Number(plan.price_sek) || 0);
  const cached = db.prepare(`
    SELECT stripe_price_id FROM stripe_prices
    WHERE plan_id = ? AND billing_interval = 'month' AND currency = 'SEK' AND amount_sek = ?
  `).get(plan.id, amount);
  if (cached) return cached.stripe_price_id;

  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Live payment is not configured yet. Ask an administrator to add Stripe keys.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  let product;
  const existing = await stripe.products.list({ limit: 100, active: true });
  product = existing.data.find((p) => String(p.metadata?.plan_id) === String(plan.id));
  if (!product) {
    product = await stripe.products.create({
      name: `${plan.name} plan`,
      description: plan.tagline || `${plan.monthly_credits} AI credits / month`,
      metadata: { plan_id: String(plan.id) },
    });
  }
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'sek',
    unit_amount: sekToMinor(amount),
    recurring: { interval: 'month', interval_count: 1 },
    metadata: { plan_id: String(plan.id) },
  });
  // Two checkout requests hitting a never-bought price point at the same time
  // could both create the Stripe price; the UNIQUE index makes one of the two
  // local INSERTs fail. Treat that as "someone else won the race" and reuse it.
  try {
    db.prepare(`
      INSERT INTO stripe_prices (plan_id, billing_interval, currency, amount_sek, stripe_price_id, created_at, updated_at)
      VALUES (?, 'month', 'SEK', ?, ?, ?, ?)
    `).run(plan.id, amount, price.id, now(), now());
  } catch {
    const existing = db.prepare(`
      SELECT stripe_price_id FROM stripe_prices
      WHERE plan_id = ? AND billing_interval = 'month' AND currency = 'SEK' AND amount_sek = ?
    `).get(plan.id, amount);
    if (existing) return existing.stripe_price_id;
  }
  return price.id;
}

// Build/return a cached one-time Stripe coupon (duration: 'once' = applies to
// the very first invoice only, perfect for first-month discounts). Coupons are
// shared across customers; each subscription can redeem one at most once.
async function ensureCoupon(kind, value) {
  const cacheKey = `stripe_coupon_${kind}_${value}`;
  const cached = getSetting(cacheKey, '');
  if (cached) return cached;

  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Live payment is not configured yet. Ask an administrator to add Stripe keys.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  const n = Math.max(0, Number(value) || 0);
  const params = { duration: 'once', metadata: { kind, value: String(n) } };
  if (kind === 'fixed') {
    params.amount_off = sekToMinor(n);
    params.currency = 'sek';
  } else {
    params.percent_off = Math.min(100, n);
  }
  const coupon = await stripe.coupons.create(params);
  upsertSetting(cacheKey, coupon.id);
  return coupon.id;
}

function byStripeSubId(stripeSubscriptionId) {
  return db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ? ORDER BY id DESC LIMIT 1').get(stripeSubscriptionId) || null;
}

function byProviderRef(ref) {
  return db.prepare('SELECT * FROM payments WHERE provider_ref = ? ORDER BY id DESC LIMIT 1').get(ref) || null;
}

// Create (or refresh) the local subscriptions row that mirrors a Stripe
// subscription. Closing any previously-active paid rows that this one replaces
// keeps history while ensuring only one active plan per user.
function upsertSubscriptionFromStripe({ userId, planId, stripeSubscriptionId, periodStart, periodEnd }) {
  let row = byStripeSubId(stripeSubscriptionId);
  if (!row) {
    if (userId == null) userId = undefined;
    const others = db.prepare(`
      SELECT s.id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = ? AND s.status = 'active' AND p.is_free = 0 AND s.stripe_subscription_id != ?
    `).all(userId || -1, stripeSubscriptionId || '');
    for (const o of others) {
      db.prepare(`UPDATE subscriptions SET status = 'replaced', updated_at = ? WHERE id = ?`).run(now(), o.id);
    }
    const subId = db.prepare(`
      INSERT INTO subscriptions (user_id, plan_id, status, payment_method, payment_ref, stripe_subscription_id, billing_interval, current_period_start, current_period_end, created_at, updated_at)
      VALUES (?, ?, 'active', 'stripe', ?, ?, 'month', ?, ?, ?, ?)
    `).run(userId, planId, stripeSubscriptionId, stripeSubscriptionId, periodStart, periodEnd, now(), now()).lastInsertRowid;
    row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  } else {
    db.prepare(`
      UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, status = 'active', updated_at = ?
      WHERE id = ?
    `).run(periodStart, periodEnd, now(), row.id);
  }
  return row;
}

function grantPlanCreditsOnce(paymentRow) {
  if (!paymentRow || paymentRow.renewal_granted) return;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(paymentRow.plan_id);
  if (!plan || !(Number(plan.monthly_credits) > 0)) return;
  grantCredits(paymentRow.user_id, plan.monthly_credits, 'plan_grant', { refType: 'subscription', refId: paymentRow.subscription_id || null });
  db.prepare('UPDATE payments SET renewal_granted = 1 WHERE id = ?').run(paymentRow.id);
}

// Count an offer redemption once per successful subscription activation. Called
// ONLY from the code paths that flip a pending checkout payment to 'paid' the
// first time, so retries and the checkout poll never double-count it. (The
// legacy one-time fulfillPayment path already increments times_redeemed itself.)
function redeemOfferOnce(offerId) {
  if (!offerId) return;
  db.prepare('UPDATE offers SET times_redeemed = times_redeemed + 1, updated_at = ? WHERE id = ?').run(now(), offerId);
}

function rewardReferralOnce(paymentRow) {
  if (!paymentRow || !paymentRow.referral_id || paymentRow.referral_rewarded) return;
  rewardSubscriptionReferral(paymentRow.referral_id);
  db.prepare('UPDATE payments SET referral_rewarded = 1 WHERE id = ?').run(paymentRow.id);
}

function periodFromStripeSub(sub, invoice = null) {
  let periodStart = epochToIso(sub.current_period_start);
  let periodEnd = epochToIso(sub.current_period_end);
  if (invoice) {
    const line = invoice.lines?.data?.[0];
    if (line?.period?.end) {
      periodStart = epochToIso(line.period.start);
      periodEnd = epochToIso(line.period.end);
    }
  }
  return { periodStart, periodEnd };
}

// Sync an active Stripe subscription into the local database (used by the
// checkout redirect poll AND by webhooks). Never grants credits here - that is
// the job of processPaidInvoice - but it does resolve the payment row created
// when the checkout was started and records the real amount Stripe charged.
export async function syncStripeSubscription({ stripeSubscriptionId, session = null }) {
  const stripe = getStripe();
  if (!stripe || !stripeSubscriptionId) return null;
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  } catch {
    return byStripeSubId(stripeSubscriptionId) || null;
  }

  const planId = Number(sub.metadata?.plan_id || session?.metadata?.planId);
  const userId = Number(sub.metadata?.user_id || session?.metadata?.userId);
  const plan = planId ? db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) : null;
  const existing = byStripeSubId(stripeSubscriptionId);
  const resolvedUserId = userId || existing?.user_id;
  if (!plan || !resolvedUserId) return existing || null;

  const { periodStart, periodEnd } = periodFromStripeSub(sub);
  const row = upsertSubscriptionFromStripe({
    userId: resolvedUserId,
    planId: plan.id,
    stripeSubscriptionId,
    periodStart,
    periodEnd,
  });

  if (session) {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(session.metadata?.paymentId));
    if (payment && payment.status === 'pending') {
      const amount = Math.round((Number(session.amount_total) || 0) / 100);
      db.prepare(`
        UPDATE payments SET status = 'paid', paid_at = ?, amount_sek = ?, original_amount_sek = ?,
          method = 'stripe', subscription_id = ?, provider_ref = ?, provider_charge_ref = ?, checkout_session_id = ?, updated_at = ?
        WHERE id = ?
      `).run(now(), amount, amount, row.id, stripeSubscriptionId, session.payment_intent || null, session.id, now(), payment.id);
      redeemOfferOnce(payment.offer_id);
      // First month: grant the plan credits right away so activation works even
      // if the invoice.paid webhook is delayed or not yet configured. The same
      // payment row is what the webhook would use, so this cannot double-grant.
      const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
      if (!fresh.renewal_granted) {
        grantPlanCreditsOnce(fresh);
        rewardReferralOnce(fresh);
      }
    }
  }
  return row;
}

// Finalise a paid invoice: ensure the subscription row exists, create/link the
// exact payments row for THIS invoice (one row per invoice = one credit grant),
// and grant the monthly credits once. Fully idempotent across webhook retries
// and racing with the checkout redirect poll.
export async function processPaidInvoice(invoice) {
  const stripeSubscriptionId = invoice.subscription;
  if (!stripeSubscriptionId || typeof stripeSubscriptionId !== 'string') return null;

  const stripe = getStripe();
  let sub = null;
  if (stripe) {
    try { sub = await stripe.subscriptions.retrieve(stripeSubscriptionId); } catch { sub = null; }
  }

  let paymentId = null;
  let planId = null;
  let userId = null;
  if (sub) {
    paymentId = Number(sub.metadata?.paymentId);
    planId = Number(sub.metadata?.plan_id);
    userId = Number(sub.metadata?.user_id);
  }
  const existingSub = byStripeSubId(stripeSubscriptionId);
  if (!planId && existingSub) planId = existingSub.plan_id;
  if (!userId && existingSub) userId = existingSub.user_id;

  const pending = paymentId ? db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) : null;
  if (!pending && !existingSub && (!planId || !userId)) return null;

  const amount = Math.round((Number(invoice.amount_paid) || Number(invoice.amount_due) || 0) / 100);
  const { periodStart, periodEnd } = sub
    ? periodFromStripeSub(sub, invoice)
    : { periodStart: epochToIso(invoice.created || sub?.current_period_start), periodEnd: epochToIso((invoice.created || 0) + 2592000) };

  let row = pending && pending.subscription_id
    ? db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(pending.subscription_id)
    : null;
  if (!row) {
    row = upsertSubscriptionFromStripe({
      userId: userId || existingSub?.user_id || pending?.user_id,
      planId: planId || pending?.plan_id || existingSub?.plan_id,
      stripeSubscriptionId,
      periodStart,
      periodEnd,
    });
  } else {
    db.prepare(`
      UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, status = 'active', updated_at = ? WHERE id = ?
    `).run(periodStart, periodEnd, now(), row.id);
  }

  const payment = (() => {
    if (pending) {
      if (pending.status !== 'paid') {
        db.prepare(`
          UPDATE payments SET status = 'paid', paid_at = ?, amount_sek = ?, original_amount_sek = ?,
            method = 'stripe', subscription_id = ?, provider_ref = ?, provider_charge_ref = ?,
            checkout_session_id = COALESCE(checkout_session_id, ?), updated_at = ?
          WHERE id = ?
        `).run(now(), amount, amount, row.id, invoice.id, invoice.payment_intent || null, pending.checkout_session_id, now(), pending.id);
        redeemOfferOnce(pending.offer_id);
      } else {
        db.prepare(`UPDATE payments SET provider_charge_ref = COALESCE(provider_charge_ref, ?), updated_at = ? WHERE id = ?`)
          .run(invoice.payment_intent || null, now(), pending.id);
      }
      return db.prepare('SELECT * FROM payments WHERE id = ?').get(pending.id);
    }
    const chargeId = String(invoice.payment_intent || invoice.id || '');
    const dup = byProviderRef(invoice.id);
    if (dup) {
      db.prepare('UPDATE payments SET provider_charge_ref = COALESCE(provider_charge_ref, ?) WHERE id = ?')
        .run(invoice.payment_intent || null, dup.id);
      return dup;
    }
    const inserted = db.prepare(`
      INSERT INTO payments (user_id, plan_id, subscription_id, amount_sek, currency, method, status, provider_ref, provider_charge_ref, created_at, paid_at)
      VALUES (?, ?, ?, ?, 'SEK', 'stripe', 'paid', ?, ?, ?, ?)
    `).run(row.user_id, row.plan_id, row.id, amount, invoice.id, invoice.payment_intent || chargeId, now(), now());
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(inserted.lastInsertRowid);
  })();

  if (payment.renewal_granted) return payment;
  grantPlanCreditsOnce(payment);
  rewardReferralOnce(payment);
  return payment;
}

export function cancelScheduledSubscription(row) {
  return db.prepare('UPDATE subscriptions SET cancelled_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id);
}

// Cancel a recurring Stripe subscription immediately (used when switching to a
// different plan). Stripe prorates the unused time to the customer balance,
// which is then applied to the first invoice of the new subscription.
export async function cancelStripeSubscriptionNow(stripeSubscriptionId) {
  const stripe = getStripe();
  if (!stripe || !stripeSubscriptionId) return null;
  let sub = null;
  try { sub = await stripe.subscriptions.retrieve(stripeSubscriptionId); } catch { return null; }
  if (sub.status === 'canceled' || sub.status === 'unpaid') return sub;
  return stripe.subscriptions.cancel(stripeSubscriptionId);
}

export async function reactivateStripeSubscription(stripeSubscriptionId) {
  const stripe = getStripe();
  if (!stripe || !stripeSubscriptionId) return null;
  const sub = await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
  return sub;
}

export function markSubscriptionDeleted(stripeSubscriptionId) {
  const row = byStripeSubId(stripeSubscriptionId);
  if (!row) return null;
  if (row.status !== 'active') return row;
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), row.id);
  ensureFreePlan(row.user_id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(row.id);
}

// ---------------------------------------------------------------------------
// One-time credits top-up
//
// A user can buy an extra block of AI credits with a SINGLE payment (Stripe
// Checkout mode 'payment', no subscription). The unit price drops as the
// purchased quantity grows, so larger top-ups are cheaper per credit while the
// price always rises with the total quantity. These credits never expire and
// do not affect the user's subscription.
// ---------------------------------------------------------------------------

const TOPUP_LIMITS = { min: 100, max: 100000 };
const TOPUP_TIERS = [
  { upTo: 250, rate: 0.40 },
  { upTo: 1000, rate: 0.35 },
  { upTo: 5000, rate: 0.30 },
  { upTo: 20000, rate: 0.26 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.24 },
];

export function creditsTopupInfo() {
  return {
    ...TOPUP_LIMITS,
    currency: 'SEK',
    tiers: TOPUP_TIERS.map((t) => ({ upTo: Number.isFinite(t.upTo) ? t.upTo : null, rate: t.rate })),
  };
}

export function quoteCreditsTopup(credits) {
  const q = Math.trunc(Number(credits) || 0);
  if (!Number.isInteger(q) || q <= 0) return null;
  if (q < TOPUP_LIMITS.min || q > TOPUP_LIMITS.max) return null;
  let cursor = 0;
  let total = 0;
  for (const tier of TOPUP_TIERS) {
    const top = Math.min(tier.upTo, q);
    if (top <= cursor) continue;
    total += Math.round((top - cursor) * tier.rate);
    cursor = top;
    if (cursor >= q) break;
  }
  const price = Math.max(1, total);
  return { credits: q, price, currency: 'SEK', perCredit: Math.round((price / q) * 100) / 100 };
}

export async function createCreditsTopupCheckout({ user, credits, method = 'card', origin }) {
  const quote = quoteCreditsTopup(credits);
  if (!quote) {
    const err = new Error(`Choose between ${TOPUP_LIMITS.min} and ${TOPUP_LIMITS.max} credits.`);
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const pay = db.prepare(`
    INSERT INTO payments (user_id, plan_id, amount_sek, original_amount_sek, currency, method, status, kind, credits, created_at)
    VALUES (?, NULL, ?, ?, 'SEK', ?, 'pending', 'credits_topup', ?, ?)
  `).run(user.id, quote.price, quote.price, method, quote.credits, now());
  const paymentId = Number(pay.lastInsertRowid);

  const stripe = getStripe();
  if (!stripe && demoPaymentsEnabled()) {
    db.prepare(`UPDATE payments SET provider_ref = ? WHERE id = ?`).run(`demo_${paymentId}`, paymentId);
    const payment = grantTopupCredits(paymentId);
    return { mode: 'activated', paymentId, payment, wallet: getWallet(user.id), demo: true };
  }
  if (!stripe) {
    db.prepare(`UPDATE payments SET status = 'requires_gateway', error = ? WHERE id = ?`)
      .run('Stripe keys are not configured. Set STRIPE_SECRET_KEY in the backend environment.', paymentId);
    const err = new Error('Live payment is not configured yet. Ask an administrator to add Stripe keys.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: String(paymentId),
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'sek',
        unit_amount: sekToMinor(quote.price),
        product_data: {
          name: `${quote.credits} AI credits — one-time`,
          description: 'Extra ApexCore AI credits. One-time payment, no subscription. These credits never expire.',
          metadata: { kind: 'credits_topup', credits: String(quote.credits) },
        },
      },
    }],
    metadata: {
      paymentId: String(paymentId),
      userId: String(user.id),
      credits: String(quote.credits),
      kind: 'credits_topup',
      method,
    },
    success_url: `${origin}/pricing?checkout=success&payment=${paymentId}`,
    cancel_url: `${origin}/pricing?checkout=cancel&payment=${paymentId}`,
    locale: 'auto',
  });

  db.prepare(`UPDATE payments SET checkout_session_id = ?, provider_ref = ? WHERE id = ?`)
    .run(session.id, session.id, paymentId);

  return { mode: 'checkout', url: session.url, paymentId, sessionId: session.id };
}

// Mark a credits top-up payment as paid and grant its credits exactly once.
export function grantTopupCredits(paymentId) {
  const grant = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment || payment.kind !== 'credits_topup') return payment;
    if (payment.credits_granted) return payment;
    if (payment.status !== 'paid') {
      db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?`)
        .run(now(), paymentId);
    }
    const n = Math.trunc(Number(payment.credits) || 0);
    if (n > 0) {
      grantCredits(payment.user_id, n, 'credits_topup', { refType: 'payment', refId: paymentId });
    }
    db.prepare(`UPDATE payments SET credits_granted = 1 WHERE id = ?`).run(paymentId);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  });
  return grant();
}

// After an approved refund of a top-up payment, take the purchased credits back
// out of the wallet (only what was actually granted, never more than the
// current balance). Safe to call more than once.
export function revokeTopupCredits(paymentId) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment || payment.kind !== 'credits_topup') return payment;
  const granted = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) s FROM credit_ledger
    WHERE user_id = ? AND ref_type = 'payment' AND ref_id = ? AND reason = 'credits_topup'
  `).get(payment.user_id, paymentId).s;
  const already = db.prepare(`
    SELECT id FROM credit_ledger
    WHERE user_id = ? AND ref_type = 'payment' AND ref_id = ? AND reason = 'credits_topup_refund'
  `).get(payment.user_id, paymentId);
  if (already || !(granted > 0)) return payment;
  deductCredits(payment.user_id, -granted, 'credits_topup_refund', { refType: 'payment', refId: paymentId });
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function createCheckout({ user, plan, method, offer, origin, referral = null }) {
  const priced = applyOffer(plan, offer);
  let firstAmount = priced.amount;
  let referralPercent = 0;
  if (referral && referral.percent > 0) {
    referralPercent = referral.percent;
    firstAmount = Math.round(firstAmount * (100 - referral.percent) / 100);
  }

  const useTrial = firstAmount <= 0; // 100% first-month discount => 30d free trial
  const couponDescs = [];
  if (!useTrial) {
    if (offer && firstAmount < priced.original) {
      if (offer.discount_type === 'fixed') {
        if (Number(offer.discount_value) < priced.original) couponDescs.push({ kind: 'fixed', value: offer.discount_value });
      } else if (Number(offer.discount_value) < 100) {
        couponDescs.push({ kind: 'percent', value: offer.discount_value });
      }
    }
    if (referralPercent > 0 && referralPercent < 100) {
      couponDescs.push({ kind: 'referral', value: referralPercent });
    }
  }
  const couponKeys = new Set();
  const coupons = [];
  for (const d of couponDescs) {
    const dup = [...couponKeys];
    if (dup.some((k) => k.kind === d.kind && String(k.value) === String(d.value))) continue;
    couponKeys.add({ kind: d.kind, value: d.value });
    const kind = d.kind === 'referral' ? 'percent' : d.kind;
    coupons.push(await ensureCoupon(kind, d.value));
  }

  const pay = db.prepare(`
    INSERT INTO payments (user_id, plan_id, amount_sek, original_amount_sek, currency, method, status, offer_id, referral_id, referral_discount, created_at)
    VALUES (?, ?, ?, ?, 'SEK', ?, 'pending', ?, ?, ?, ?)
  `).run(user.id, plan.id, firstAmount, priced.original, method, offer?.id || null, referral?.referralId || null, referralPercent, now());
  const paymentId = Number(pay.lastInsertRowid);

  const stripe = getStripe();
  if (!stripe && demoPaymentsEnabled()) {
    // Explicit PAYMENT_DEMO=1 demo gateway: simulate one successful payment so
    // plan upgrades and credit grants can be tested without Stripe keys. Every
    // payment is honestly stamped with a demo_* provider reference.
    db.prepare(`UPDATE payments SET provider_ref = ? WHERE id = ?`).run(`demo_${paymentId}`, paymentId);
    const row = upsertSubscriptionFromStripe({
      userId: user.id,
      planId: plan.id,
      stripeSubscriptionId: `demo_${paymentId}`,
      periodStart: now(),
      periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    db.prepare(`UPDATE payments SET status = 'paid', paid_at = ?, subscription_id = ? WHERE id = ?`)
      .run(now(), row.id, paymentId);
    grantPlanCreditsOnce(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
    return {
      mode: 'activated',
      paymentId,
      subscription: getActivePlan(user.id),
      wallet: getWallet(user.id),
      demo: true,
    };
  }

  if (!stripe) {
    db.prepare(`UPDATE payments SET status = 'requires_gateway', error = ? WHERE id = ?`)
      .run('Stripe keys are not configured. Set STRIPE_SECRET_KEY in the backend environment.', paymentId);
    const err = new Error('Live payment is not configured yet. Ask an administrator to add Stripe keys.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }

  const priceId = await ensureRecurringPrice(plan);
  const successUrl = `${origin}/pricing?checkout=success&payment=${paymentId}`;
  const cancelUrl = `${origin}/pricing?checkout=cancel&payment=${paymentId}`;

  const sessionParams = {
    mode: 'subscription',
    customer_email: user.email,
    client_reference_id: String(paymentId),
    payment_method_types: paymentMethodTypes(method),
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: {
        paymentId: String(paymentId),
        userId: String(user.id),
        planId: String(plan.id),
        method,
      },
    },
    metadata: {
      paymentId: String(paymentId),
      userId: String(user.id),
      planId: String(plan.id),
      method,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'auto',
  };
  if (useTrial) {
    sessionParams.subscription_data.trial_period_days = 30;
  } else if (coupons.length) {
    sessionParams.discounts = coupons.map((c) => ({ coupon: c }));
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  db.prepare(`UPDATE payments SET checkout_session_id = ?, provider_ref = ? WHERE id = ?`)
    .run(session.id, session.id, paymentId);

  return { mode: 'checkout', url: session.url, paymentId, sessionId: session.id };
}

// Legacy one-time activation used by old payments / free flows.
export function activatePaidPlan(userId, plan, method, paymentId) {
  const current = getActivePlan(userId);
  if (current) {
    db.prepare(`
      UPDATE subscriptions SET status = 'replaced', cancelled_at = ?, updated_at = ? WHERE id = ?
    `).run(now(), now(), current.id);
  }
  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  const subId = db.prepare(`
    INSERT INTO subscriptions (user_id, plan_id, status, payment_method, payment_ref, current_period_start, current_period_end, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, datetime('now'), ?, ?, ?)
  `).run(userId, plan.id, method, String(paymentId), periodEnd, now(), now()).lastInsertRowid;
  grantCredits(userId, plan.monthly_credits, 'plan_grant', { refType: 'subscription', refId: subId });
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
}

export function fulfillPayment(paymentId) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return null;
  if (payment.status === 'paid') return payment;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(payment.plan_id);
  if (!plan) return payment;
  db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?`).run(now(), paymentId);
  if (payment.offer_id) {
    db.prepare('UPDATE offers SET times_redeemed = times_redeemed + 1, updated_at = ? WHERE id = ?').run(now(), payment.offer_id);
  }
  const subscription = activatePaidPlan(payment.user_id, plan, payment.method, paymentId);
  db.prepare('UPDATE payments SET subscription_id = ? WHERE id = ?').run(subscription.id, paymentId);
  if (payment.referral_id) {
    rewardSubscriptionReferral(payment.referral_id);
  }
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

export async function refundStripePayment(payment, amountSek, reason) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Live payment is not configured yet.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  let pi = payment.provider_charge_ref || null;
  if (!pi && payment.checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(payment.checkout_session_id);
    pi = session.payment_intent;
  }
  if (!pi && payment.provider_ref && String(payment.provider_ref).startsWith('pi_')) pi = payment.provider_ref;
  if (!pi) {
    const err = new Error('No Stripe payment intent found for this charge.');
    err.code = 'REFUND_UNAVAILABLE';
    err.status = 409;
    throw err;
  }
  const refund = await stripe.refunds.create({
    payment_intent: pi,
    amount: Math.round(amountSek * 100),
    reason: reason === 'duplicate' || reason === 'fraudulent' ? reason : 'requested_by_customer',
    metadata: { paymentId: String(payment.id) },
  });
  return refund;
}

// ---------------------------------------------------------------------------
// Stripe webhook
// ---------------------------------------------------------------------------

export async function handleStripeEvent(event) {
  const type = event.type;
  const object = event.data.object;

  if (type === 'checkout.session.completed') {
    if (object.mode === 'subscription' && object.subscription) {
      await syncStripeSubscription({ stripeSubscriptionId: object.subscription, session: object });
      return;
    }
    // Legacy one-time checkouts (one-time plans and credits top-ups).
    const paymentId = Number(object.metadata?.paymentId || object.client_reference_id);
    if (!paymentId) return;
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment || payment.status === 'paid') return;
    if (object.payment_status !== 'paid' && object.status !== 'complete') return;
    db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?')
      .run(object.payment_intent || object.id, paymentId);
    if (payment.kind === 'credits_topup') {
      grantTopupCredits(paymentId);
      return;
    }
    fulfillPayment(paymentId);
    return;
  }

  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    const paymentId = Number(object.metadata?.paymentId || object.client_reference_id);
    if (!paymentId) return;
    db.prepare(`UPDATE payments SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`)
      .run(type, paymentId);
    return;
  }

  if (type === 'invoice.paid') {
    await processPaidInvoice(object);
    return;
  }

  if (type === 'invoice.payment_failed') {
    const subId = object.subscription;
    const row = byStripeSubId(subId);
    if (row) db.prepare(`UPDATE subscriptions SET updated_at = ? WHERE id = ?`).run(now(), row.id);
    return;
  }

  if (type === 'customer.subscription.deleted') {
    markSubscriptionDeleted(object.id);
    return;
  }

  if (type === 'customer.subscription.updated') {
    if (object.status === 'canceled') {
      markSubscriptionDeleted(object.id);
    } else if (object.id) {
      const row = byStripeSubId(object.id);
      if (row) {
        const { periodStart, periodEnd } = periodFromStripeSub(object);
        db.prepare(`UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?`)
          .run(periodStart, periodEnd, now(), row.id);
      }
    }
    return;
  }

  if (type === 'charge.refunded') {
    const charge = object;
    const pi = charge.payment_intent;
    if (!pi) return;
    const payment = db.prepare('SELECT * FROM payments WHERE provider_charge_ref = ? OR provider_ref = ? OR checkout_session_id = ?').get(pi, pi, pi);
    if (!payment) return;
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ? AND status = 'paid'`).run(payment.id);
    if (payment.kind === 'credits_topup') {
      revokeTopupCredits(payment.id);
    }
    return;
  }
}

export function netRevenueSek() {
  const paid = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM payments WHERE status = 'paid'`).get().c;
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM refunds WHERE status = 'completed'`).get().c;
  const withdrawn = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM payouts WHERE status IN ('completed','processing')`).get().c;
  const net = Math.max(0, paid - refunded);
  return { paid, refunded, withdrawn, net, available: Math.max(0, net - withdrawn) };
}
