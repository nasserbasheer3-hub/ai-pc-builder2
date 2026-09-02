import Stripe from 'stripe';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { grantCredits, getActivePlan, ensureFreePlan, getWallet } from './credits.js';
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

export async function createCheckout({ user, plan, method, offer, origin, referral = null }) {
  const priced = applyOffer(plan, offer);
  let referralDiscount = 0;
  if (referral && referral.percent > 0) {
    referralDiscount = referral.percent;
    priced.amount = Math.round(priced.amount * (100 - referral.percent) / 100);
  }
  const attachReferral = referral && priced.amount > 0 ? referral.referralId : null;
  const pay = db.prepare(`
    INSERT INTO payments (user_id, plan_id, amount_sek, original_amount_sek, currency, method, status, offer_id, referral_id, referral_discount, created_at)
    VALUES (?, ?, ?, ?, 'SEK', ?, 'pending', ?, ?, ?, ?)
  `).run(user.id, plan.id, priced.amount, priced.original, method, offer?.id || null, attachReferral, attachReferral ? referralDiscount : 0, now());
  const paymentId = pay.lastInsertRowid;

  if (priced.amount === 0) {
    // Free offer: stamp the provider ref first, then fulfil - fulfil() marks it
    // paid AND activates the plan + grants credits (order matters).
    db.prepare(`UPDATE payments SET provider_ref = ? WHERE id = ?`)
      .run(`free_offer_${paymentId}`, paymentId);
    fulfillPayment(paymentId);
    return {
      mode: 'activated',
      paymentId,
      subscription: getActivePlan(user.id),
      wallet: getWallet(user.id),
    };
  }

  const stripe = getStripe();
  if (!stripe && demoPaymentsEnabled()) {
    // Explicit PAYMENT_DEMO=1 demo gateway: simulate a successful payment so
    // plan upgrades and credit grants can be tested without Stripe keys. Every
    // payment is honestly stamped with a demo_* provider reference.
    db.prepare(`UPDATE payments SET provider_ref = ? WHERE id = ?`)
      .run(`demo_${paymentId}`, paymentId);
    fulfillPayment(paymentId);
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

  const successUrl = `${origin}/pricing?checkout=success&payment=${paymentId}`;
  const cancelUrl = `${origin}/pricing?checkout=cancel&payment=${paymentId}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    currency: 'sek',
    customer_email: user.email,
    client_reference_id: String(paymentId),
    payment_method_types: paymentMethodTypes(method),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'sek',
        unit_amount: priced.amount * 100,
        product_data: {
          name: `${plan.name} plan`,
          description: plan.tagline || `${plan.monthly_credits} AI credits / month`,
        },
      },
    }],
    metadata: {
      paymentId: String(paymentId),
      userId: String(user.id),
      planId: String(plan.id),
      method,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'auto',
  });

  db.prepare(`UPDATE payments SET checkout_session_id = ?, provider_ref = ? WHERE id = ?`)
    .run(session.id, session.id, paymentId);

  return { mode: 'checkout', url: session.url, paymentId, sessionId: session.id };
}

export async function refundStripePayment(payment, amountSek, reason) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Live payment is not configured yet.');
    err.code = 'PAYMENT_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  let chargeId = null;
  let pi = null;
  if (payment.checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(payment.checkout_session_id);
    pi = session.payment_intent;
  }
  if (!pi && payment.provider_ref && String(payment.provider_ref).startsWith('pi_')) pi = payment.provider_ref;
  if (!pi && payment.checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(payment.checkout_session_id, { expand: ['payment_intent'] });
    pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    chargeId = session.payment_intent?.latest_charge || null;
  }
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

export async function handleStripeEvent(event) {
  const type = event.type;
  if (type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentId = Number(session.metadata?.paymentId || session.client_reference_id);
    if (!paymentId) return;
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment || payment.status === 'paid') return;
    if (session.payment_status !== 'paid' && session.status !== 'complete') return;
    db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?')
      .run(session.payment_intent || session.id, paymentId);
    fulfillPayment(paymentId);
    return;
  }
  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const paymentId = Number(session.metadata?.paymentId || session.client_reference_id);
    if (!paymentId) return;
    db.prepare(`UPDATE payments SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`)
      .run(type, paymentId);
    return;
  }
  if (type === 'charge.refunded') {
    const charge = event.data.object;
    const pi = charge.payment_intent;
    if (!pi) return;
    const payment = db.prepare('SELECT * FROM payments WHERE provider_ref = ? OR checkout_session_id = ?').get(pi, pi);
    if (!payment) return;
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ? AND status = 'paid'`).run(payment.id);
  }
}

export function netRevenueSek() {
  const paid = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM payments WHERE status = 'paid'`).get().c;
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM refunds WHERE status = 'completed'`).get().c;
  const withdrawn = db.prepare(`SELECT COALESCE(SUM(amount_sek), 0) c FROM payouts WHERE status IN ('completed','processing')`).get().c;
  const net = Math.max(0, paid - refunded);
  return { paid, refunded, withdrawn, net, available: Math.max(0, net - withdrawn) };
}
