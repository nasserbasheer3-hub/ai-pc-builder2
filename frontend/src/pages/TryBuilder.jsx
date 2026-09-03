import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, Spinner, useToast } from '../components/ui.jsx';
import { PartImage, StoreLinks, RefDate } from '../components/PartAssets.jsx';
import { track } from '../utils/analytics.js';

const CATS = [
  ['cpu', 'pccomp.cpu'], ['gpu', 'pccomp.gpu'], ['motherboard', 'pccomp.motherboard'], ['ram', 'pccomp.memory'],
  ['storage', 'pccomp.storage'], ['psu', 'pccomp.psu'], ['case', 'pccomp.case'], ['cooler', 'pccomp.cooler'],
];

export default function TryBuilder() {
  const toast = useToast();
  const { t } = useI18n();
  const [games, setGames] = useState([]);
  const [budget, setBudget] = useState(1500);
  const [currency, setCurrency] = useState('USD');
  const [resolution, setResolution] = useState('1080p');
  const [targetFps, setTargetFps] = useState(60);
  const [purpose, setPurpose] = useState('gaming');
  const [cpuPref, setCpuPref] = useState('any');
  const [gpuPref, setGpuPref] = useState('any');
  const [ramGb, setRamGb] = useState(32);
  const [selected, setSelected] = useState([]);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getGames().then((g) => {
      setGames(g);
      setSelected(g.slice(0, 3).map((x) => x.id));
    }).catch(() => {});
  }, []);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async () => {
    if (budget < 300) return toast.err(t('pcbuilder.budgetMin'));
    track('try_generate', { budget: Number(budget), currency, resolution });
    setBuilding(true);
    setErr('');
    setResult(null);
    try {
      const r = await api.post('/public/build', {
        budget: Number(budget), currency, games: selected, resolution,
        targetFps: Number(targetFps), purpose,
        cpuPreference: cpuPref, gpuPreference: gpuPref, ramGb: Number(ramGb),
      });
      if (r.status === 'ready') setResult(r);
      else setErr(r.message || t('try.noBuild'));
    } catch (e) {
      setErr(e.message || t('try.noBuild'));
    } finally { setBuilding(false); }
  };

  return (
    <div className="page" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="hero" style={{ paddingBottom: 8 }}>
        <div className="kicker">{t('try.kicker')}</div>
        <h1>
          {t('try.h1a')}<br />
          <span className="grad">{t('try.h1b')}</span>
        </h1>
        <p>{t('try.sub')}</p>
      </div>

      <div className="grid cols-2" style={{ gap: 16 }}>
        <Card>
          <CardHead title={<>{t('try.configure')}</>} />
          <div className="grid cols-2">
            <div className="field"><label>{t('pcbuilder.budget')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" type="number" min="300" value={budget} onChange={(e) => setBudget(e.target.value)} />
                <select className="select" style={{ width: 84 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option>USD</option><option>EUR</option><option>GBP</option>
                </select>
              </div>
            </div>
            <div className="field"><label>{t('pcbuilder.resolution')}</label>
              <select className="select" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option>1080p</option><option>1440p</option><option>4K</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.targetFps')}</label>
              <select className="select" value={targetFps} onChange={(e) => setTargetFps(e.target.value)}>
                <option value="60">60</option><option value="120">120</option><option value="144">144</option><option value="240">240</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.useCase')}</label>
              <select className="select" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="gaming">{t('pcbuilder.gaming')}</option><option value="streaming">{t('pcbuilder.streaming')}</option><option value="content">{t('pcbuilder.content')}</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.cpuPref')}</label>
              <select className="select" value={cpuPref} onChange={(e) => setCpuPref(e.target.value)}>
                <option value="any">{t('pcbuilder.any')}</option><option value="intel">{t('pcbuilder.intel')}</option><option value="amd">{t('pcbuilder.amd')}</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.gpuPref')}</label>
              <select className="select" value={gpuPref} onChange={(e) => setGpuPref(e.target.value)}>
                <option value="any">{t('pcbuilder.any')}</option><option value="nvidia">{t('pcbuilder.nvidia')}</option><option value="amd">{t('pcbuilder.amd')}</option>
              </select>
            </div>
          </div>
          <div className="field"><label>{t('pcbuilder.ramCapacity')}</label>
            <select className="select" value={ramGb} onChange={(e) => setRamGb(e.target.value)}>
              <option value="16">16 GB</option><option value="32">32 GB</option><option value="64">64 GB</option>
            </select>
          </div>

          <div className="field"><label>{t('try.targetGames')} <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>{t('try.sampleNote')}</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {games.slice(0, 12).map((g) => (
                <button key={g.id} type="button" onClick={() => toggle(g.id)} className={`chip ${selected.includes(g.id) ? 'chip-on' : ''}`}>{g.name}</button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-block" style={{ marginTop: 4 }} disabled={building} onClick={run}>
            {building ? t('try.generating') : t('try.generate')}
          </button>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: '10px 0 0', textAlign: 'center' }}>{t('try.freeNote')}</p>
        </Card>

        <div>
          {building ? (
            <Card style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={38} />
                <p style={{ marginTop: 16 }}>{t('try.building')}</p>
              </div>
            </Card>
          ) : result ? (
            <Card tilt>
              <CardHead title={<>📦 {t('try.yourBuild')}</>}>
                <Badge tone={result.withinBudget ? 'ok' : 'warn'}>{result.withinBudget ? t('pcbuilder.withinBudget') : t('pcbuilder.overBudget')}</Badge>
              </CardHead>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
                <span style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'var(--font-display)', background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                  {result.totalPrice.toLocaleString()} {result.currency}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{t('pcbuilder.total')} · {result.resolution} · {result.targetFps} FPS</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {CATS.map(([key, label]) => {
                  const p = result.parts[key];
                  if (!p) return null;
                  return (
                    <div key={key} style={{ padding: '9px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <PartImage part={{ category: key }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div><span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t(label)}</span><div style={{ fontWeight: 600 }}>{p.name}</div></div>
                          <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: 'var(--primary-2)' }}>{p.price.toLocaleString()} {result.currency}</div>
                            <RefDate date={p.price_date} live={!!p.live} />
                          </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 3 }}>{p.reason}</div>
                        <StoreLinks store={p.store} name={p.name} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {result.expectedFps?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 700 }}>🎮 {t('pcbuilder.expectedFps')}</div>
                  <div className="pill-row" style={{ marginTop: 6 }}>
                    {result.expectedFps.map((f) => <Badge key={f.game} tone={f.fps != null ? 'primary' : ''}>{f.game}: {f.fps != null ? `~${f.fps} FPS` : t('pcbuilder.noVerifiedData')}</Badge>)}
                  </div>
                </div>
              )}
              <div className="card pad-sm" style={{ marginTop: 14, textAlign: 'center', background: 'linear-gradient(135deg, rgba(124,92,255,0.14), rgba(34,211,238,0.10))', border: '1px solid rgba(124,92,255,0.35)' }}>
                <h3 style={{ fontSize: '1.05rem' }}>{t('try.saveCta')}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '6px 0 14px' }}>{t('try.saveSub')}</p>
                <Link to="/signup" className="btn btn-primary" onClick={() => track('cta_click', { action: 'try_save_signup' })}>{t('try.signupFree')}</Link>
              </div>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 12 }}>{result.note}</p>
            </Card>
          ) : err ? (
            <Card><div style={{ padding: 30, textAlign: 'center' }}><p style={{ color: 'var(--text-dim)' }}>{err}</p><button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setErr(''); }}>{t('try.retry')}</button></div></Card>
          ) : (
            <Card style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center', padding: '0 24px' }}>
                <div style={{ fontSize: '2rem', opacity: 0.6 }}>🖥️</div>
                <h3 style={{ margin: '12px 0 6px' }}>{t('try.readyTitle')}</h3>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)', margin: 0 }}>{t('try.readyText')}</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div style={{ margin: '26px 0 10px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)' }}>
        {t('try.honesty')}
      </div>
    </div>
  );
}
