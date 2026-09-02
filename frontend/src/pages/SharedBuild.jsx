import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, Spinner, EmptyState } from '../components/ui.jsx';

const ORDER = ['cpu', 'gpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'];
const LABEL = { cpu: 'CPU', gpu: 'GPU', motherboard: 'Motherboard', ram: 'Memory', storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'Cooler' };

export default function SharedBuild() {
  const { slug } = useParams();
  const { t } = useI18n();
  const [build, setBuild] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get(`/public/build/${slug}`)
      .then((d) => setBuild(d.build))
      .catch(() => setErr(true));
  }, [slug]);

  if (err) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>🔗 {t('shared.title')}</h1></div></div>
        <Card><EmptyState icon="🔍" title={t('shared.noBuild')} text={t('shared.noBuildText')} action={<Link className="btn" to="/">{t('shared.back')}</Link>} /></Card>
      </div>
    );
  }

  if (!build) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>🔗 {t('shared.title')}</h1></div></div>
        <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><Spinner lg /></Card>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-head">
        <div className="page-title">
          <h1>🔗 {t('shared.title')}</h1>
          <span className="sub">{t('shared.sub', { owner: build.owner?.display_name || build.owner?.username || '' })}</span>
        </div>
      </div>

      <Card tilt>
        <CardHead title={<>{build.name}</>}>
          <Badge tone="primary">{build.category}</Badge>
          {build.total_price ? <Badge tone="ok">${build.total_price}</Badge> : null}
        </CardHead>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-dim)', marginBottom: 10 }}>
          {t('shared.by')} <b>{build.owner?.display_name || build.owner?.username}</b> · {t('shared.builtAt', { date: (build.created_at || '').slice(0, 10) })}
          {build.resolution ? ` · ${build.resolution}` : ''}
          {build.target_fps ? ` · ${build.target_fps} FPS` : ''}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {ORDER.filter((k) => build.parts[k]).map((k) => {
            const p = build.parts[k];
            return (
              <div key={k} className="card pad-sm" style={{ margin: 0, background: 'rgba(0,0,0,0.25)' }}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)' }}>{LABEL[k]}</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.3, margin: '3px 0' }}>{p.name}</div>
                {p.spec && <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{p.spec}</div>}
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: 4 }}>{p.price_usd ? `$${p.price_usd}` : ''}</div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, fontSize: '0.8rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
          {t('shared.honesty')}
        </div>
      </Card>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link className="btn" to="/">{t('shared.back')}</Link>
      </div>
    </div>
  );
}
