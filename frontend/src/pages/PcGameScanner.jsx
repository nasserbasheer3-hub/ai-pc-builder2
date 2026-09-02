import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];
const PART_LABEL = { cpu: 'CPU', gpu: 'GPU', motherboard: 'Motherboard', ram: 'Memory', storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'Cooler' };

function verdictBadge(v) {
  if (v === 'all_covered') return <Badge tone="ok">✓</Badge>;
  if (v === 'all_measured_covered') return <Badge tone="info">≈</Badge>;
  if (v === 'some_unmet') return <Badge tone="warn">!</Badge>;
  return <Badge tone="err">✗</Badge>;
}

export default function PcGameScanner() {
  const toast = useToast();
  const { t } = useI18n();
  const [games, setGames] = useState([]);
  const [picked, setPicked] = useState([]);
  const [form, setForm] = useState({ resolution: '1080p', quality: 'Ultra', target_fps: 60 });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  useEffect(() => { getGames().then(setGames).catch((e) => toast.err(e.message)); }, []);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const run = async () => {
    if (!picked.length) return toast.err(t('glib.required'));
    setBusy(true); setRes(null);
    try {
      const r = await api.post('/pc/library/recommend', {
        game_ids: picked,
        resolution: form.resolution, quality: form.quality,
        target_fps: Number(form.target_fps) || 60,
      });
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const verdictKey = res?.verdict ? `glib.verdict.${res.verdict}` : '';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>📚 {t('glib.title')}</h1>
          <span className="sub">{t('glib.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div>
          <Card>
            <CardHead title={<>{t('glib.yourGames')} <Badge tone="info">{picked.length}</Badge></>} />
            {games.length ? (
              <div className="grid cols-2" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {games.map((g) => (
                  <button key={g.id} className={`chip ${picked.includes(g.id) ? 'chip-on' : ''}`}
                    style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal' }}
                    onClick={() => toggle(g.id)}>
                    🎮 {g.name}
                  </button>
                ))}
              </div>
            ) : <EmptyState icon="📚" title={t('glib.loading')} />}
          </Card>

          <Card style={{ marginTop: 14 }}>
            <CardHead title={<>{t('glib.target')}</>} />
            <div className="grid cols-3">
              <div className="field"><label>{t('glib.resolution')}</label>
                <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                  {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('glib.quality')}</label>
                <select className="select" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                  {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('glib.targetFps')}</label>
                <input type="number" className="input" min="30" max="360" value={form.target_fps}
                  onChange={(e) => setForm({ ...form, target_fps: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={run}>
              {busy ? t('glib.recommending') : `⚡ ${t('glib.recommend')}`}
            </button>
          </Card>
        </div>

        <div>
          {busy ? (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12 }}>{t('glib.recommending')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('glib.recommendingText')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>{t('glib.bestBuild')}</>}>
                {verdictBadge(res.verdict)}
                <DataTag label={res.label} />
              </CardHead>

              <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)', marginBottom: 12 }}>{res.message}</p>

              {res.recommendation ? (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('glib.cpu')}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>🧠 {res.recommendation.cpu.name}</div>
                      <div style={{ color: 'var(--primary-2)', fontWeight: 600 }}>${res.recommendation.cpu.price}</div>
                    </div>
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('glib.gpu')}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>🎨 {res.recommendation.gpu.name}</div>
                      <div style={{ color: 'var(--primary-2)', fontWeight: 600 }}>${res.recommendation.gpu.price}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                    {res.parts && Object.entries(res.parts).filter(([k, p]) => k !== 'cpu' && k !== 'gpu' && p).map(([k, p]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.82rem', padding: '3px 0' }}>
                        <span style={{ color: 'var(--text-dim)' }}>{PART_LABEL[k]}: <b style={{ color: 'var(--text)' }}>{p.name}</b></span>
                        <span>${p.price_usd}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8, fontWeight: 700 }}>
                      <span>{t('glib.total')}</span><span>${res.totalPrice}</span>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState icon="🚫" title={t('glib.noData')} text={t('glib.noDataText')} />
              )}

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 6 }}>{t('glib.perGame')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {res.perGame.map((g) => (
                    <div key={g.game.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.86rem', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.2)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.game.name}</span>
                      {g.status === 'no_data'
                        ? <Badge tone="info">{t('glib.noDataShort')}</Badge>
                        : g.meetsTarget
                          ? <Badge tone="ok">{g.fps} FPS ✓</Badge>
                          : <Badge tone="warn">{g.fps} FPS ↓</Badge>}
                    </div>
                  ))}
                </div>
                {res.coverage?.measured < res.coverage?.games && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 8 }}>{t('glib.measuredNote', { m: res.coverage.measured, g: res.coverage.games })}</p>
                )}
              </div>

              <div style={{ marginTop: 14, fontSize: '0.76rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {res.honest}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="📚" title={t('glib.noRec')} text={t('glib.noRecText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
