import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, Spinner, EmptyState } from '../components/ui.jsx';

const TIER_TONE = { bronze: 'info', silver: 'primary', gold: 'warn', diamond: 'ok' };

export default function PublicProfile() {
  const { slug } = useParams();
  const { t } = useI18n();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get(`/public/profile/${slug}`)
      .then((d) => setP(d.profile))
      .catch(() => setErr(true));
  }, [slug]);

  if (err) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>👤 {t('uprof.title')}</h1></div></div>
        <Card><EmptyState icon="🔍" title={t('uprof.noProfile')} text={t('uprof.noProfileText')} action={<Link className="btn" to="/">{t('shared.back')}</Link>} /></Card>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>👤 {t('uprof.title')}</h1></div></div>
        <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><Spinner lg /></Card>
      </div>
    );
  }

  const hw = p.hardware || {};
  const hwRows = [hw.cpu, hw.gpu, hw.ram, hw.storage].filter(Boolean);

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-head">
        <div className="page-title">
          <h1>👤 {t('uprof.title')}</h1>
          <span className="sub">@{p.username} · {t('uprof.joined', { date: (p.joined_at || '').slice(0, 10) })}</span>
        </div>
      </div>

      <Card tilt>
        <CardHead title={<>{p.display_name || p.username} {p.rank ? <Badge tone="primary">{p.rank}</Badge> : null}</>}>
          {p.mainGame ? <Badge tone="info">{p.mainGame.name}</Badge> : null}
        </CardHead>

        {p.bio && <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{p.bio}</p>}
        {p.gaming_goals && (
          <p style={{ fontSize: '0.84rem' }}>
            <b>{t('uprof.gamingGoals')}:</b> <span style={{ color: 'var(--text-dim)' }}>{p.gaming_goals}</span>
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('uprof.hardware')}</div>
          {hwRows.length === 0 ? (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-faint)' }}>{t('uprof.noHardware')}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {hwRows.map((r, i) => (
                <div key={i} className="card pad-sm" style={{ margin: 0, background: 'rgba(0,0,0,0.25)', fontSize: '0.84rem' }}>{r.name}</div>
              ))}
            </div>
          )}
        </div>

        {p.mainBuild && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('uprof.mainBuild')}</div>
            <div className="card pad-sm" style={{ margin: 0, background: 'rgba(34,211,238,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <b>{p.mainBuild.name}</b>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.84rem' }}>
                  {Object.keys(p.mainBuild.parts).length} {t('pcmy.partsCount', { n: Object.keys(p.mainBuild.parts).length })} · <b>${p.mainBuild.total || 0}</b>
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {Object.values(p.mainBuild.parts).map((part) => (
                  <span key={part.id} style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 6, padding: '2px 7px', fontSize: '0.74rem' }}>
                    {part.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('uprof.achievements')} ({p.achievements?.length || 0})</div>
          {p.achievements?.length ? (
            <div className="pill-row">
              {p.achievements.map((a) => (
                <Badge key={a.code} tone={TIER_TONE[a.tier] || 'info'}>{a.name}</Badge>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-faint)' }}>{t('uprof.noAchievements')}</p>
          )}
        </div>
      </Card>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link className="btn" to="/">{t('shared.back')}</Link>
      </div>
    </div>
  );
}
