import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { LanguageSwitcher } from '../i18n/index.jsx';
import { api } from '../api/client.js';
import { track } from '../utils/analytics.js';

const FEATURES = [
  { icon: '🎮', tKey: 'f1', dKey: 'f1d' },
  { icon: '🖥️', tKey: 'f2', dKey: 'f2d' },
  { icon: '📊', tKey: 'f3', dKey: 'f3d' },
  { icon: '⚡', tKey: 'f4', dKey: 'f4d' },
  { icon: '🧠', tKey: 'f5', dKey: 'f5d' },
  { icon: '🔒', tKey: 'f6', dKey: 'f6d' },
  { icon: '⚖️', tKey: 'f7', dKey: 'f7d', to: '/pc/compare' },
];

const SHARE_SYM = { USD: '$', EUR: '€', GBP: '£', SEK: 'kr' };
function shareMoney(v, cur) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sym = SHARE_SYM[cur] || '';
  return cur === 'SEK' ? `${s} ${sym}` : `${sym}${s}`;
}

const STEPS = [
  { n: '01', tKey: 's1', dKey: 's1d' },
  { n: '02', tKey: 's2', dKey: 's2d' },
  { n: '03', tKey: 's3', dKey: 's3d' },
  { n: '04', tKey: 's4', dKey: 's4d' },
];

function Stat({ value, label, live }) {
  return (
    <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.55rem', fontWeight: 700, background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
        {value ?? '·'}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 4 }}>{label}</div>
      {live && <div className="badge badge-ok" style={{ marginTop: 6 }}>● live</div>}
    </div>
  );
}

function ValueItem({ item }) {
  const { t } = useI18n();
  const ratio = item.price_usd > 0 ? (item.performance_index / item.price_usd).toFixed(2) : '—';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          {item.brand} · {item.performance_index} perf
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="chip-static" style={{ display: 'block', padding: '3px 8px', fontSize: '0.75rem' }}>{t('landing.estPrice', { price: item.price_usd })}</div>
        <div style={{ fontSize: '0.72rem', color: '#6ee7b7', marginTop: 2 }}>{ratio} {t('landing.valuePerfPerDollar')}</div>
      </div>
    </div>
  );
}

function ValueList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>{title}</h3>
      {items.map((it) => <ValueItem key={it.name} item={it} />)}
    </div>
  );
}

function SourceCard({ s, t }) {
  return (
    <div className="card hover" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {s.url ? (
          <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>{s.name}</a>
        ) : (
          <span style={{ fontWeight: 600 }}>{s.name}</span>
        )}
        <span className={s.verified ? 'badge badge-ok' : 'badge badge-warn'} style={{ flexShrink: 0 }}>
          {s.verified ? t('landing.verifiedTag') : t('landing.estimateTag')}
        </span>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '8px 0 0' }}>{s.description}</p>
      {s.last_verified_at && (
        <div className="badge badge-info" style={{ marginTop: 10 }}>{t('landing.verifiedOn', { date: s.last_verified_at })}</div>
      )}
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [stats, setStats] = useState(null);
  const [shares, setShares] = useState([]);

  useEffect(() => {
    api.get('/public/stats').then(setStats).catch(() => setStats(null));
    api.get('/public/builds').then((d) => setShares(d.builds || [])).catch(() => {});
  }, []);

  const totalComponents = stats ? Object.values(stats.hardware || {}).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="hero">
        <img src="/logo/logo-full.webp" alt="ApexCore" style={{ display: 'block', margin: '0 auto 12px', width: 'min(520px, 92vw)' }} />
        <div className="kicker">{t('landing.kicker')}</div>
        <h1>
          {t('landing.h1a')}<br />
          {t('landing.h1bPre')} <span className="grad">{t('landing.h1b')}</span>
        </h1>
        <p>{t('landing.sub')}</p>
        <div className="pill-row" style={{ marginTop: 10 }}>
          {user ? (
            <Link to="/dashboard" className="btn btn-primary btn-lg" onClick={() => track('cta_click', { action: 'open_dashboard' })}>{t('landing.openDashboard')}</Link>
          ) : (
            <>
              <Link to="/try" className="btn btn-primary btn-lg" onClick={() => track('cta_click', { action: 'try_hero' })}>{t('landing.tryCta')}</Link>
              <Link to="/signup" className="btn btn-ghost btn-lg" onClick={() => track('cta_click', { action: 'signup_hero' })}>{t('landing.createFreeAccount')}</Link>
            </>
          )}
        </div>
        {!user && (
          <div style={{ marginTop: 12, fontSize: '0.85rem' }}>
            <Link to="/login" style={{ color: 'var(--text-dim)', textDecoration: 'none' }} onClick={() => track('cta_click', { action: 'login_hero' })}>{t('landing.loginHint')}</Link>
          </div>
        )}
        <div className="pill-row" style={{ marginTop: 18 }}>
          <LanguageSwitcher />
        </div>
      </div>

      <h2 style={{ margin: '46px 0 8px' }}>{t('landing.statsTitle')}</h2>
      <p style={{ margin: '0 0 18px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t('landing.statsSub')}</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Stat value={totalComponents} label={t('landing.statComponents')} />
        <Stat value={stats?.games} label={t('landing.statGames')} />
        <Stat value={stats?.benchmarks} label={t('landing.statBenchmarks')} />
        <Stat value={stats?.gameSettings} label={t('landing.statSettings')} />
        <Stat value={stats?.sources?.length} label={t('landing.statSources')} />
        <Stat value={stats?.ai?.available ? 'ONLINE' : 'OFF'} label={t('landing.statAi')} live={stats?.ai?.available} />
      </div>

      {shares.length > 0 && (
        <>
          <h2 style={{ margin: '46px 0 8px' }}>{t('landing.sharesTitle')}</h2>
          <p style={{ margin: '0 0 18px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t('landing.sharesSub')}</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
            {shares.map((b) => (
              <Link key={b.slug} to={`/pc/shared/${b.slug}`} style={{ textDecoration: 'none' }} onClick={() => track('shared_build_view', { build: b.slug })}>
                <div className="card hover" style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 650, fontSize: '0.92rem' }}>{b.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>{(b.head || []).join(' · ') || '—'}</div>
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: '1.05rem', background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                      {shareMoney(b.total_price, b.currency)}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.owner?.display_name || b.owner?.username}{b.resolution ? ` · ${b.resolution}` : ''}{b.target_fps ? ` · ${b.target_fps} FPS` : ''}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 40 }}>
        {STEPS.map((s) => (
          <div className="card" key={s.n} style={{ padding: 18 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{s.n}</div>
            <h3 style={{ margin: '6px 0 4px' }}>{t(`landing.${s.tKey}t`)}</h3>
            <p style={{ fontSize: '0.86rem' }}>{t(`landing.${s.dKey}`)}</p>
          </div>
        ))}
      </div>

      <h2 style={{ margin: '46px 0 20px' }}>{t('landing.stepsTitle')}</h2>
      <div className="feature-grid">
        {FEATURES.map((f) => {
          const inner = (
            <div className="card hover" style={{ padding: 20 }}>
              <div style={{ fontSize: '1.7rem' }}>{f.icon}</div>
              <h3 style={{ margin: '10px 0 6px' }}>{t(`landing.${f.tKey}t`)}</h3>
              <p style={{ fontSize: '0.88rem' }}>{t(`landing.${f.dKey}`)}</p>
            </div>
          );
          return f.to
            ? <Link key={f.tKey} to={f.to} style={{ textDecoration: 'none' }}>{inner}</Link>
            : <div key={f.tKey}>{inner}</div>;
        })}
      </div>

      <h2 style={{ margin: '46px 0 8px' }}>{t('landing.valueTitle')}</h2>
      <p style={{ margin: '0 0 18px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t('landing.valueSub')}</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <ValueList title={t('landing.valueGpu')} items={stats?.valuePicks?.gpus} />
        <ValueList title={t('landing.valueCpu')} items={stats?.valuePicks?.cpus} />
      </div>

      <h2 style={{ margin: '46px 0 8px' }}>{t('landing.sourcesTitle')}</h2>
      <p style={{ margin: '0 0 18px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t('landing.sourcesSub')}</p>
      <div className="feature-grid">
        {(stats?.sources || []).map((s) => <SourceCard key={s.name} s={s} t={t} />)}
      </div>
      <div className="card" style={{ marginTop: 16, padding: '16px 20px' }}>
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-dim)' }}>{t('landing.sourcesNote')}</p>
      </div>

      <div className="card" style={{ marginTop: 40, padding: 26, textAlign: 'center' }}>
        <h2>{t('landing.aiCtaTitle')}</h2>
        <p style={{ margin: '10px 0 20px', fontSize: '0.92rem' }}>{t('landing.aiCtaSub')}</p>
        {!user && <Link to="/signup" className="btn btn-primary btn-lg" onClick={() => track('cta_click', { action: 'signup_bottom' })}>{t('landing.startImproving')}</Link>}
      </div>
      <div className="footer-note">{t('landing.footerNote')}</div>
    </div>
  );
}
