import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail, parseId } from '../utils/helpers.js';
import { ensureFreePlan, getActivePlan, getWallet, listLedger, creditCosts } from '../services/credits.js';
import {
  listActivePlans, findOffer, applyOffer, parseFeatures, getSetting, bestAutoOffer, isNewPaidCustomer,
  createCheckout, fulfillPayment, isStripeConfigured, getStripe, stripeKeys,
  demoPaymentsEnabled, supportedPaymentMethods,
  syncStripeSubscription, cancelStripeSubscriptionNow, reactivateStripeSubscription,
  cancelScheduledSubscription,
  creditsTopupInfo, quoteCreditsTopup, createCreditsTopupCheckout, grantTopupCredits,
} from '../services/payments.js';
import { config } from '../config.js';
import { referralDiscountFor, referralStatsFor, referralEnabled } from '../services/referrals.js';

const router = Router();

const FX = config.fxSekToGbp;
const toGbp = (sek) => (sek == null ? null : Math.round((Number(sek) || 0) * FX * 100) / 100);
const perCreditGbp = (sekTotal, credits) => Math.round(((Number(sekTotal) || 0) * FX) / (Math.trunc(Number(credits)) || 1) * 100) / 100;

function checkoutOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return config.appUrl || 'http://localhost:5173';
}

router.get('/plans', (req, res) => {
  const plans = listActivePlans().map((p) => {
    const best = bestAutoOffer(p);
    const priced = applyOffer(p, best);
    return {
      ...p,
      original_price_sek: priced.original,
      price_sek: priced.amount,
      original_price_gbp: toGbp(priced.original),
      price_gbp: toGbp(priced.amount),
      offer: best ? {
        id: best.id,
        code: best.code,
        name: best.name,
        description: best.description,
        discount_type: best.discount_type,
        discount_value: best.discount_value,
      } : null,
    };
  });
  ok(res, {
    plans,
    costs: creditCosts(),
    topup: creditsTopupInfo(),
    currency: 'SEK',
    paymentMethods: supportedPaymentMethods(),
    stripeConfigured: isStripeConfigured(),
    demoEnabled: demoPaymentsEnabled() && !isStripeConfigured(),
    publishableKey: isStripeConfigured() ? (stripeKeys().publishable || '') : '',
  });
});

// Price quote for a one-time credits top-up (public, no login needed).
router.get('/topup-quote', (req, res) => {
  const credits = Math.trunc(Number(req.query?.credits) || 0);
  const quote = quoteCreditsTopup(credits);
  if (!quote) {
    const info = creditsTopupInfo();
    return fail(res, 400, 'VALIDATION', `Choose between ${info.min} and ${info.max} credits.`);
  }
  ok(res, {
    ...quote,
    price_gbp: toGbp(quote.price),
    perCredit_gbp: perCreditGbp(quote.price, quote.credits),
  });
});

// Buy extra AI credits as a one-time payment (Stripe Checkout, mode: payment).
// No subscription is created; the purchased credits are added to the wallet
// once the single charge succeeds.
router.post('/topup', requireAuth, async (req, res) => {
  const credits = Math.trunc(Number(req.body?.credits) || 0);
  const method = String(req.body?.method || 'card').toLowerCase();
  const allowed = new Set(supportedPaymentMethods());
  const info = creditsTopupInfo();
  if (!Number.isInteger(credits) || credits < info.min || credits > info.max) {
    return fail(res, 400, 'VALIDATION', `Choose between ${info.min} and ${info.max} credits.`);
  }
  if (!allowed.has(method)) return fail(res, 400, 'VALIDATION', `Choose a supported payment method: ${[...allowed].join(', ')}.`);
  try {
    const result = await createCreditsTopupCheckout({
      user: req.user,
      credits,
      method,
      origin: checkoutOrigin(req),
    });
    if (result.mode === 'activated') {
      return ok(res, {
        mode: 'activated',
        payment: result.payment,
        wallet: result.wallet,
        demo: Boolean(result.demo),
      });
    }
    return ok(res, { mode: 'checkout', url: result.url, paymentId: result.paymentId });
  } catch (e) {
    if (e.code === 'PAYMENT_UNAVAILABLE' || e.code === 'VALIDATION') {
      return fail(res, e.status || 503, e.code, e.message);
    }
    console.error('[billing.topup]', e.message);
    return fail(res, 502, 'CHECKOUT_FAILED', 'Could not start checkout. Please try again.');
  }
});

router.get('/me', requireAuth, (req, res) => {
  ensureFreePlan(req.user.id);
  const wallet = getWallet(req.user.id);
  const subscription = getActivePlan(req.user.id);
  ok(res, {
    wallet: {
      balance: wallet.balance,
      lifetimeGranted: wallet.lifetime_granted,
      lifetimeSpent: wallet.lifetime_spent,
    },
    subscription: subscription
      ? {
          ...subscription,
          isRecurring: Boolean(subscription.stripe_subscription_id),
          cancelAtPeriodEnd: Boolean(subscription.cancelled_at),
        }
      : null,
    costs: creditCosts(),
    plans: listActivePlans(),
    ledger: listLedger(req.user.id, 20),
    payments: db.prepare(`
      SELECT id, plan_id, kind, credits, amount_sek, method, status, created_at, paid_at
      FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20
    `).all(req.user.id),
  });
});

router.get('/ledger', requireAuth, (req, res) => {
  ok(res, { ledger: listLedger(req.user.id, 80), wallet: getWallet(req.user.id) });
});

router.get('/referral', requireAuth, (req, res) => {
  ok(res, {
    enabled: referralEnabled(),
    referral: referralStatsFor(req.user.id),
  });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  const planId = parseId(req.body?.planId);
  const method = String(req.body?.method || 'card').toLowerCase();
  const allowed = new Set(supportedPaymentMethods());
  if (!planId) return fail(res, 400, 'VALIDATION', 'Choose a plan.');
  if (!allowed.has(method)) return fail(res, 400, 'VALIDATION', `Choose a supported payment method: ${[...allowed].join(', ')}.`);

  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(planId);
  if (!plan) return fail(res, 404, 'NOT_FOUND', 'Plan not found.');
  if (plan.is_free) {
    const existing = getActivePlan(req.user.id);
    if (existing && !existing.is_free) {
      return fail(res, 409, 'CANCEL_FIRST', 'Cancel your current subscription first, then switch back to Free.');
    }
    ensureFreePlan(req.user.id);
    return ok(res, { subscription: getActivePlan(req.user.id), wallet: getWallet(req.user.id), mode: 'free' });
  }

  const current = getActivePlan(req.user.id);
  const samePlan = current && !current.is_free && Number(current.plan_id) === Number(plan.id);
  const isRecurring = Boolean(current && current.stripe_subscription_id);

  if (current && !current.is_free && isRecurring) {
    if (samePlan) {
      if (!current.cancelled_at) {
        return fail(res, 409, 'ALREADY_SUBSCRIBED', 'You already have this subscription. It renews automatically every month.');
      }
      // Resuming a subscription that was scheduled to cancel at the period end.
      try {
        await reactivateStripeSubscription(current.stripe_subscription_id);
        db.prepare(`UPDATE subscriptions SET cancelled_at = NULL, updated_at = ? WHERE id = ?`).run(now(), current.id);
      } catch (e) {
        console.error('[billing.resume]', e.message);
        return fail(res, 502, 'RESUME_FAILED', 'Could not resume your subscription. Please try again.');
      }
      return ok(res, { subscription: getActivePlan(req.user.id), wallet: getWallet(req.user.id), mode: 'resumed' });
    }
    // Switching to a different plan: stop the current Stripe subscription now
    // (Stripe prorates the unused time to the customer balance, which offsets
    // the first invoice of the new subscription) before opening the new one.
    try {
      await cancelStripeSubscriptionNow(current.stripe_subscription_id);
    } catch (e) {
      console.error('[billing.switch.cancel]', e.message);
      return fail(res, 502, 'SWITCH_FAILED', 'Could not switch plans right now. Please try again.');
    }
  }

  const coded = req.body?.offerCode || req.body?.offerId;
  let offer = null;
  if (coded) {
    offer = findOffer(coded, plan.id);
    if (!offer) return fail(res, 400, 'OFFER_INVALID', 'This offer code is not valid for the selected plan.');
  } else if (isNewPaidCustomer(req.user.id)) {
    offer = bestAutoOffer(plan);
  }
  const referral = referralDiscountFor(req.user.id);
  try {
    const result = await createCheckout({
      user: req.user,
      plan,
      method,
      offer,
      origin: checkoutOrigin(req),
      referral,
    });
    if (result.mode === 'activated') {
      return ok(res, {
        mode: 'activated',
        subscription: result.subscription,
        wallet: result.wallet,
        payment: db.prepare('SELECT id, amount_sek, method, status, paid_at FROM payments WHERE id = ?').get(result.paymentId),
      });
    }
    return ok(res, { mode: 'checkout', url: result.url, paymentId: result.paymentId });
  } catch (e) {
    if (e.code === 'PAYMENT_UNAVAILABLE') return fail(res, e.status || 503, e.code, e.message);
    console.error('[billing.subscribe]', e.message);
    return fail(res, 502, 'CHECKOUT_FAILED', 'Could not start checkout. Please try again.');
  }
});

router.get('/checkout/:id', requireAuth, async (req, res) => {
  const paymentId = parseId(req.params.id);
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(paymentId, req.user.id);
  if (!payment) return fail(res, 404, 'NOT_FOUND', 'Payment not found.');
  if (payment.status === 'pending' && payment.checkout_session_id && getStripe()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(payment.checkout_session_id);
      if (session.mode === 'subscription') {
        if (session.payment_status === 'paid' || session.status === 'complete') {
          if (session.subscription) {
            await syncStripeSubscription({ stripeSubscriptionId: session.subscription, session });
          } else {
            fulfillPayment(payment.id);
          }
        } else if (session.status === 'expired') {
          db.prepare(`UPDATE payments SET status = 'failed', error = ? WHERE id = ?`).run('checkout_expired', payment.id);
        }
      } else if (session.payment_status === 'paid' || session.status === 'complete') {
        if (payment.kind === 'credits_topup') {
          grantTopupCredits(payment.id);
        } else {
          fulfillPayment(payment.id);
        }
      } else if (session.status === 'expired') {
        db.prepare(`UPDATE payments SET status = 'failed', error = ? WHERE id = ?`).run('checkout_expired', payment.id);
      }
    } catch (e) {
      console.error('[billing.checkout]', e.message);
    }
  }
  ok(res, {
    payment: db.prepare('SELECT id, amount_sek, method, status, kind, credits, paid_at, created_at FROM payments WHERE id = ?').get(paymentId),
    subscription: getActivePlan(req.user.id),
    wallet: getWallet(req.user.id),
  });
});

router.post('/cancel', requireAuth, async (req, res) => {
  const current = getActivePlan(req.user.id);
  if (!current || current.is_free) return fail(res, 400, 'NO_PAID_PLAN', 'You do not have a paid plan to cancel.');

  if (current.stripe_subscription_id) {
    // Recurring subscription: stop future renewals, keep access until the
    // period ends, and let Stripe downgrade us when the subscription is gone.
    const stripe = getStripe();
    if (!stripe) return fail(res, 503, 'PAYMENT_UNAVAILABLE', 'Stripe is not configured.');
    try {
      await stripe.subscriptions.update(current.stripe_subscription_id, { cancel_at_period_end: true });
      cancelScheduledSubscription(current);
    } catch (e) {
      console.error('[billing.cancel]', e.message);
      return fail(res, 502, 'CANCEL_FAILED', 'Could not cancel the subscription right now. Please try again.');
    }
    return ok(res, { subscription: getActivePlan(req.user.id), wallet: getWallet(req.user.id), cancelAtPeriodEnd: true });
  }

  // Legacy one-time paid plan: cancel immediately.
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), current.id);
  ensureFreePlan(req.user.id);
  ok(res, { subscription: getActivePlan(req.user.id), wallet: getWallet(req.user.id) });
});

router.post('/refund-request', requireAuth, (req, res) => {
  const paymentId = parseId(req.body?.paymentId);
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!paymentId) return fail(res, 400, 'VALIDATION', 'Choose a payment to refund.');
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(paymentId, req.user.id);
  if (!payment) return fail(res, 404, 'NOT_FOUND', 'Payment not found.');
  if (payment.status !== 'paid') return fail(res, 409, 'NOT_REFUNDABLE', 'Only paid charges can be refunded.');
  const existing = db.prepare(`SELECT id FROM refunds WHERE payment_id = ? AND status IN ('pending','completed')`).get(paymentId);
  if (existing) return fail(res, 409, 'ALREADY_REQUESTED', 'A refund is already in progress for this payment.');
  const id = db.prepare(`
    INSERT INTO refunds (payment_id, user_id, amount_sek, reason, status, requested_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(paymentId, req.user.id, payment.amount_sek, reason || 'requested_by_customer', now()).lastInsertRowid;
  ok(res, { refund: db.prepare('SELECT * FROM refunds WHERE id = ?').get(id) });
});

export default router;
export { parseFeatures, getSetting, listActivePlans };
