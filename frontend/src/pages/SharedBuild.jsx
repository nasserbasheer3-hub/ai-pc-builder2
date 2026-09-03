import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';
import { PartImage, StoreLinks, RefDate } from '../components/PartAssets.jsx';
import { useSeo } from '../hooks/useSeo.js';
import { track } from '../utils/analytics.js';

const ORDER = ['cpu', 'gpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'];
const LABEL = { cpu: 'CPU', gpu: 'GPU', motherboard: 'Motherboard', ram: 'Memory', storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'Cooler' };
const SYM = { USD: '$', EUR: '€', GBP: '£', SEK: 'kr' };

function fmtMoney(v, cur) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sym = SYM[cur] || '';
  return cur === 'SEK' ? `${s} ${sym}` : `${sym}${s}`;
}

function colorFor(name, games) {
  const hit = games.find((g) => g.name === name || name.includes(g.name) || g.name.includes(name));
  if (hit?.cover_color) return hit.cover_color;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 55%)`;
}

function shareText(build, t) {
  const cpu = build.parts?.cpu?.name || '';
  const gpu = build.parts?.gpu?.name || '';
  const parts = [cpu, gpu].filter(Boolean).join(' · ');
  const line = t('shared.shareLine', { parts: parts || 'a gaming' });
  const price = fmtMoney(build.total_price, build.currency);
  return price ? `${line} · ${price}` : line;
}

export default function SharedBuild() {
  const { slug } = useParams();
  const toast = useToast();
  const { t } = useI18n();
  const [build, setBuild] = useState(null);
  const [games, setGames] = useState([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    api.get(`/public/build/${slug}`)
      .then((d) => setBuild(d.build))
      .catch(() => setErr(true));
  }, [slug]);

  const { title, description } = useMemo(() => {
    if (!build) return { title: t('shared.title'), description: null };
    const cur = build.currency || 'USD';
    const total = fmtMoney(build.total_price, cur);
    const headline = build.parts?.cpu?.name && build.parts?.gpu?.name
      ? `${build.parts.cpu.name} + ${build.parts.gpu.name}`
      : 'ApexCore';
    const fps = Array.isArray(build.expected_fps) && build.expected_fps.length
      ? `Estimated ${build.expected_fps.length} games around ${build.target_fps || 60} FPS at ${build.resolution || '1080p'}.`
      : '';
    return {
      title: `${build.name} · ${headline}${total ? ` for ${total}` : ''}`,
      description: `A ${build.partCount || 8}-part gaming build shared on ApexCore by ${build.owner?.display_name || build.owner?.username || 'a member'}. Verified hardware, honest estimates. ${fps}`.trim(),
    };
  }, [build, t]);

  useSeo({
    title,
    description,
    image: '/logo/logo-full.webp',
    jsonLd: build ? {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: build.name,
      description,
      image: `${window.location.origin}/logo/logo-full.webp`,
      brand: { '@type': 'Brand', name: 'ApexCore' },
      offers: build.total_price ? {
        '@type': 'Offer',
        price: Number(build.total_price),
        priceCurrency: build.currency || 'USD',
        availability: 'https://schema.org/InStock',
      } : undefined,
    } : null,
  });

  const share = async (channel) => {
    track('build_share_clicked', { channel });
    const url = window.location.href;
    if (channel === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        toast.ok(t('shared.linkCopied'));
      } catch {
        toast.err(t('shared.copyFailed'));
      }
      return;
    }
    const text = encodeURIComponent(`${shareText(build, t)} — ApexCore`);
    const href = channel === 'whatsapp'
      ? `https://wa.me/?text=${text}%20${encodeURIComponent(url)}`
      : `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  if (err) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>{t('shared.title')}</h1></div></div>
        <Card><EmptyState title={t('shared.noBuild')} text={t('shared.noBuildText')} action={<Link className="btn" to="/">{t('shared.back')}</Link>} /></Card>
      </div>
    );
  }

  if (!build) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>{t('shared.title')}</h1></div></div>
        <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><Spinner lg /></Card>
      </div>
    );
  }

  const ownerName = build.owner?.display_name || build.owner?.username || 'ApexCore member';
  const cur = build.currency || 'USD';
  const total = fmtMoney(build.total_price, cur);

  return (
    <div className="page" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Card tilt>
        <CardHead title={<>{build.name}</>}>
          {build.category ? <Badge tone="primary">{build.category}</Badge> : null}
        </CardHead>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {total && (
            <span style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-display)', background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{total}</span>
          )}
          <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
            {build.partCount || Object.keys(build.parts || {}).length} part build · shared by <b style={{ color: 'var(--text)' }}>{ownerName}</b>
          </span>
        </div>

        <p style={{ fontSize: '0.84rem', color: 'var(--text-dim)', marginBottom: 14 }}>
          {t('shared.builtAt', { date: (build.created_at || '').slice(0, 10) })}
          {build.resolution ? ` · ${t('shared.resolution')} ${build.resolution}` : ''}
          {build.target_fps ? ` · ${build.target_fps} FPS` : ''}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {ORDER.filter((k) => build.parts[k]).map((k, i) => {
            const p = build.parts[k];
            const price = p.price != null ? fmtMoney(p.price, cur) : (p.price_usd != null ? `$${p.price_usd}` : null);
            return (
                <div key={k} className="card pad-sm" style={{ margin: 0, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <div style={{ position: 'absolute', inset: '0 auto 0 0', width: 3, background: `linear-gradient(180deg, hsl(${i * 45}, 70%, 60%), hsl(${i * 45 + 60}, 70%, 45%))` }} />
                  <PartImage part={{ category: k }} size={32} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)' }}>{LABEL[k]}</div>
                    <div style={{ fontWeight: 650, fontSize: '0.9rem', lineHeight: 1.3, margin: '2px 0' }}>{p.name}</div>
                    {p.spec && <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)' }}>{p.spec}</div>}
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--primary-2)', marginTop: 5 }}>
                      {price}
                      <RefDate date={p.price_date} live={!!p.live} />
                    </div>
                    <StoreLinks store={p.store} name={p.name} />
                  </div>
                </div>
            );
          })}
        </div>

        {Array.isArray(build.expected_fps) && build.expected_fps.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 700 }}>
              {t('pcbuilder.expectedFps')} {build.resolution ? `(${build.resolution})` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
              {build.expected_fps.map((f) => (
                <div key={f.game} className="card pad-sm" style={{ margin: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: colorFor(f.game, games), flex: '0 0 auto' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.game}</div>
                    {f.message && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{f.message}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {f.fps != null ? (
                      <Badge tone="primary">{f.fps >= 1000 ? '1000+' : f.fps} FPS</Badge>
                    ) : (
                      <DataTag label="unavailable" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 8 }}>{t('shared.fpsNote')}</p>
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: '0.78rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
          {t('shared.honesty')}
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', fontWeight: 600 }}>{t('shared.shareVia')}</span>
          <button className="btn btn-ghost" onClick={() => share('copy')}>{t('shared.copyLink')}</button>
          <button className="btn btn-ghost" onClick={() => share('whatsapp')}>WhatsApp</button>
          <button className="btn btn-ghost" onClick={() => share('x')}>X / Twitter</button>
        </div>
      </div>

      <div className="card pad-sm" style={{ marginTop: 16, textAlign: 'center', background: 'linear-gradient(135deg, rgba(124,92,255,0.14), rgba(34,211,238,0.10))', border: '1px solid rgba(124,92,255,0.35)' }}>
        <h3 style={{ fontSize: '1.15rem' }}>{t('shared.buildYours')}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '6px 0 14px' }}>{t('shared.buildYoursText')}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" to="/signup">{t('shared.signUp')}</Link>
          <Link className="btn btn-ghost" to="/">{t('shared.explore')}</Link>
        </div>
      </div>
    </div>
  );
}
