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

  useEffect(() => {
    api.get('/public/stats').then(setStats).catch(() => setStats(null));
  }, []);

  const totalComponents = stats ? Object.values(stats.hardware || {}).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="hero">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
          <img src="/logo/logo-inverse.png" alt="LevelCore" style={{ height: 32, width: 32, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>LevelCore</span>
        </div>
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
              <Link to="/signup" className="btn btn-primary btn-lg" onClick={() => track('cta_click', { action: 'signup_hero' })}>{t('landing.createFreeAccount')}</Link>
              <Link to="/login" className="btn btn-ghost btn-lg" onClick={() => track('cta_click', { action: 'login_hero' })}>{t('landing.signIn')}</Link>
            </>
          )}
        </div>
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
