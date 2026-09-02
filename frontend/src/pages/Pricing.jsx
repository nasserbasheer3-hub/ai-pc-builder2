import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { api, ApiError } from '../api/client.js';
import { Card, Badge, useToast, LoadingBlock } from '../components/ui.jsx';

const METHODS = [
  { id: 'card', labelKey: 'pricing.card' },
  { id: 'swish', labelKey: 'pricing.swish' },
  { id: 'klarna', labelKey: 'pricing.klarna' },
];

export default function Pricing() {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [method, setMethod] = useState('card');
  const [offerCode, setOfferCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [refunding, setRefunding] = useState(null);

  const refreshMe = () => {
    if (!user) { setMe(null); return Promise.resolve(); }
    return api.get('/billing/me').then(setMe).catch(() => {});
  };

  useEffect(() => {
    api.get('/billing/plans').then((d) => { setData(d); setLoadError(null); }).catch((e) => {
      setLoadError(e.message);
      toast.err(e.message);
    });
  }, []);

  useEffect(() => { refreshMe(); }, [user]);

  useEffect(() => {
    const checkout = params.get('checkout');
    const paymentId = params.get('payment');
    if (!checkout || !user) return;
    const done = () => {
      params.delete('checkout');
      params.delete('payment');
      setParams(params, { replace: true });
    };
    (async () => {
      try {
        if (paymentId) {
          const res = await api.get(`/billing/checkout/${paymentId}`);
          if (res.payment?.status === 'paid') toast.ok(t('pricing.paid'));
          else if (checkout === 'cancel') toast.err(t('pricing.checkoutCancel'));
          else toast.ok(t('pricing.checkoutPending'));
        } else if (checkout === 'success') toast.ok(t('pricing.paid'));
        else toast.err(t('pricing.checkoutCancel'));
        await refreshMe();
      } catch (e) {
        toast.err(e.message);
      } finally {
        done();
      }
    })();
  }, [user]);

  const subscribe = async (plan) => {
    if (!user) { navigate('/signup'); return; }
    if (plan.is_free) { toast.ok(t('pricing.alreadyFree')); return; }
    setBusy(plan.id);
    try {
      const body = { planId: plan.id, method };
      if (offerCode.trim()) body.offerCode = offerCode.trim();
      const res = await api.post('/billing/subscribe', body);
      if (res.mode === 'checkout' && res.url) {
        window.location.assign(res.url);
        return;
      }
      setMe({ ...me, subscription: res.subscription, wallet: res.wallet });
      toast.ok(t('pricing.paid'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PAYMENT_UNAVAILABLE') toast.err(t('pricing.paymentUnavailable'));
      else toast.err(e.message);
    } finally {
      setBusy(null);
    }
  };

  const requestRefund = async (paymentId) => {
    setRefunding(paymentId);
    try {
      await api.post('/billing/refund-request', { paymentId, reason: 'requested_by_customer' });
      toast.ok(t('pricing.refundRequested'));
      await refreshMe();
    } catch (e) {
      toast.err(e.message);
    } finally {
      setRefunding(null);
    }
  };

  if (loadError && !data) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="page-title">
            <h1>{t('pricing.title')}</h1>
            <span className="sub">{loadError}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>{t('common.retry') || 'Retry'}</button>
      </div>
    );
  }
  if (!data) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  const currentSlug = me?.subscription?.slug;
  const paidPayments = (me?.payments || []).filter((p) => p.status === 'paid');

  return (
    <div className="page pricing-page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('pricing.title')}</h1>
          <span className="sub">{t('pricing.subtitle')}</span>
        </div>
        {me?.wallet && (
          <div className="badge badge-primary">{t('pricing.balance', { n: me.wallet.balance })}</div>
        )}
      </div>
      <p className="pricing-note">{t('pricing.freeToolsNote')}</p>
      <div className="pricing-pay-methods">
        <span className="pricing-pay-label">{t('pricing.payWith')}</span>
        <div className="chip-row">
          {METHODS.map((m) => (
            <button key={m.id} type="button" className={`chip ${method === m.id ? 'chip-on' : ''}`} onClick={() => setMethod(m.id)}>
              {t(m.labelKey)}
            </button>
          ))}
        </div>
        <p className="pricing-note">{t('pricing.payMethodsHint')}</p>
      </div>
      {user && (
        <div className="pricing-offer-row">
          <input
            className="input"
            value={offerCode}
            onChange={(e) => setOfferCode(e.target.value)}
            placeholder={t('pricing.offerCode')}
            autoComplete="off"
          />
        </div>
      )}
      {!data.stripeConfigured && (
        <p className="pricing-note pricing-warn">{t('pricing.paymentUnavailable')}</p>
      )}
      <div className="pricing-grid">
        {(data.plans || []).map((p) => {
          const current = currentSlug === p.slug;
          const discounted = p.offer && p.original_price_sek != null && p.price_sek < p.original_price_sek;
          return (
            <Card key={p.id} className={`pricing-card${p.is_featured ? ' featured' : ''}${current ? ' current' : ''}`}>
              {p.is_featured ? <Badge>{t('pricing.popular')}</Badge> : null}
              {p.offer ? <Badge tone="ok">{p.offer.name}</Badge> : null}
              <h2>{p.name}</h2>
              <p className="pricing-tagline">{p.tagline}</p>
              <div className="pricing-price">
                {discounted ? <span className="pricing-was">{p.original_price_sek} kr</span> : null}
                <b>{p.price_sek}</b>
                <span> kr / {t('pricing.month')}</span>
              </div>
              <div className="pricing-credits">{t('pricing.creditsPerMonth', { n: p.monthly_credits })}</div>
              <ul className="pricing-features">
                {(p.features || []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button
                className={`btn ${p.is_featured ? 'btn-primary' : ''} ${current ? 'btn-ghost' : ''}`}
                disabled={busy === p.id || current}
                onClick={() => subscribe(p)}
              >
                {current ? t('pricing.currentPlan') : p.is_free ? t('pricing.getStarted') : t('pricing.subscribe')}
              </button>
            </Card>
          );
        })}
      </div>
      <p className="pricing-note">{t('pricing.costsNote')}</p>
      {!user && (
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link className="btn btn-primary" to="/signup">{t('pricing.getStarted')}</Link>
        </div>
      )}
      {user && paidPayments.length > 0 && (
        <Card className="pricing-refunds">
          <h3>{t('pricing.yourPayments')}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pricing.price')}</th>
                  <th>{t('pricing.method')}</th>
                  <th>{t('admin.articleStatus')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paidPayments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.amount_sek} kr</td>
                    <td>{p.method}</td>
                    <td>{p.status}</td>
                    <td>
                      <button className="btn btn-sm btn-ghost" disabled={refunding === p.id} onClick={() => requestRefund(p.id)}>
                        {t('pricing.requestRefund')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
