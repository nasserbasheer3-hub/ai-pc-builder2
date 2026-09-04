import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast, LoadingBlock } from '../components/ui.jsx';
import { PartImage, StoreLinks, RefDate } from '../components/PartAssets.jsx';
import BuildVariants from '../components/BuildVariants.jsx';
import { track } from '../utils/analytics.js';

const CATEGORIES = [
  ['cpu', 'pccomp.cpu'], ['gpu', 'pccomp.gpu'], ['motherboard', 'pccomp.motherboard'], ['ram', 'pccomp.memory'],
  ['storage', 'pccomp.storage'], ['psu', 'pccomp.psu'], ['case', 'pccomp.case'], ['cooler', 'pccomp.cooler'],
];

const STORAGE_PRESETS = {
  p1: { gb: 1000, type: 'nvme' }, p2: { gb: 2000, type: 'nvme' }, p3: { gb: 4000, type: 'nvme' },
  p4: { gb: 1000, type: 'sata' }, p5: { gb: 2000, type: 'sata' },
};
const WANT_CONFIGS = 24;

export default function PcBuilder() {
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
  const [caseSize, setCaseSize] = useState('auto');
  const [noise, setNoise] = useState('balanced');
  const [storagePreset, setStoragePreset] = useState('p1');
  const [activeVariant, setActiveVariant] = useState(0);
  const [selectedGames, setSelectedGames] = useState([]);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState([]);
  const [shareUrl, setShareUrl] = useState(null);
  const formRef = useRef(null);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    api.get('/pc/builds').then((r) => setSaved(r.builds || [])).catch(() => {});
  }, []);

  const pre = STORAGE_PRESETS[storagePreset] || STORAGE_PRESETS.p1;
  const payloadBase = () => ({
    budget: Number(budget), currency, games: selectedGames, resolution, targetFps: Number(targetFps),
    cpuPreference: cpuPref, gpuPreference: gpuPref, ramGb: Number(ramGb), purpose,
    caseSize, noisePreference: noise, storageGb: pre.gb, storageType: pre.type,
  });

  const build = async () => {
    if (budget < 300) return toast.err(t('pcbuilder.budgetMin'));
    track('generate_build', { budget: Number(budget), currency, resolution });
    setBuilding(true);
    setResult(null);
    setActiveVariant(0);
    try {
      formRef.current = payloadBase();
      const r = await api.post('/pc/build', { ...formRef.current, variants: WANT_CONFIGS });
      setResult(r);
      setShareUrl(null);
      toast.ok(t('pcbuilder.buildGenerated'));
      api.get('/pc/builds').then((x) => setSaved(x.builds || [])).catch(() => {});
    } catch (e) {
      toast.err(e.message || t('pcbuilder.couldNotBuildConfig'));
    } finally { setBuilding(false); }
  };

  // Persist the currently inspected alternative (activeVariant > 0) verbatim
  // as a new draft, without re-running the engine.
  const saveCurrentVariant = async () => {
    if (!result?.alternatives?.[activeVariant - 1]) return;
    const alt = result.alternatives[activeVariant - 1];
    setBuilding(true);
    try {
      await api.post('/pc/build/save-config', {
        ...(formRef.current || payloadBase()), config: alt.config, totalPrice: alt.totalPrice,
        parts: alt.parts, expectedFps: alt.expectedFps,
      });
      toast.ok(t('pcbuilder.buildGenerated'));
      api.get('/pc/builds').then((x) => setSaved(x.builds || [])).catch(() => {});
    } catch (e) {
      toast.err(e.message || t('pcbuilder.couldNotBuildConfig'));
    } finally { setBuilding(false); }
  };

  const deleteBuild = async (id) => {
    try {
      await api.del(`/pc/builds/${id}`);
      setSaved(saved.filter((b) => b.id !== id));
      toast.ok(t('pcbuilder.buildDeleted'));
    } catch (e) { toast.err(e.message); }
  };

  const ensureShare = async (buildId) => {
    if (shareUrl) return shareUrl;
    const r = await api.post(`/pc/builds/${buildId}/share`);
    const url = `${window.location.origin}${r.url}`;
    setShareUrl(url);
    return url;
  };

  const doShare = async (channel) => {
    if (!result?.buildId) return;
    try {
      const url = await ensureShare(result.buildId);
      track('build_share_clicked', { channel, source: 'builder' });
      if (channel === 'copy') {
        await navigator.clipboard.writeText(url);
        toast.ok(t('shared.linkCopied'));
        return;
      }
      const text = encodeURIComponent(t('pcbuilder.shareText'));
      const href = channel === 'whatsapp'
        ? `https://wa.me/?text=${text}%20${encodeURIComponent(url)}`
        : `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`;
      window.open(href, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.err(e.message || t('shared.copyFailed'));
    }
  };

  const toggleGame = (id) => {
    setSelectedGames((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  };

  const plans = result?.status === 'ready' ? [result, ...(result.alternatives || [])] : [];
  const cur = plans.length ? plans[Math.min(activeVariant, plans.length - 1)] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🛠️ {t('pcbuilder.title')}</h1>
          <span className="sub">{t('pcbuilder.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcbuilder.configure')}</>} />
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
          <div className="grid cols-3" style={{ marginTop: 2 }}>
            <div className="field"><label>{t('pcbuilder.caseSize')}</label>
              <select className="select" value={caseSize} onChange={(e) => setCaseSize(e.target.value)}>
                <option value="auto">{t('pcbuilder.caseAuto')}</option>
                <option value="ATX">{t('pcbuilder.caseAtx')}</option>
                <option value="microATX">{t('pcbuilder.caseMicroAtx')}</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.noisePref')}</label>
              <select className="select" value={noise} onChange={(e) => setNoise(e.target.value)}>
                <option value="balanced">{t('pcbuilder.noiseBalanced')}</option>
                <option value="quiet">{t('pcbuilder.noiseQuiet')}</option>
                <option value="performance">{t('pcbuilder.noisePerformance')}</option>
              </select>
            </div>
            <div className="field"><label>{t('pcbuilder.storage')}</label>
              <select className="select" value={storagePreset} onChange={(e) => setStoragePreset(e.target.value)}>
                <option value="p1">{t('pcbuilder.storageP1')}</option>
                <option value="p2">{t('pcbuilder.storageP2')}</option>
                <option value="p3">{t('pcbuilder.storageP3')}</option>
                <option value="p4">{t('pcbuilder.storageP4')}</option>
                <option value="p5">{t('pcbuilder.storageP5')}</option>
              </select>
            </div>
          </div>

          <div className="field"><label>{t('pcbuilder.targetGames')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {games.slice(0, 12).map((g) => (
                <button key={g.id} type="button" onClick={() => toggleGame(g.id)}
                  className={`chip ${selectedGames.includes(g.id) ? 'chip-on' : ''}`}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-block" disabled={building} onClick={build}>
            {building ? t('pcbuilder.building') : `🛠️ ${t('pcbuilder.buildMyPc')}`}
          </button>
        </Card>

        <div>
          {building ? (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={36} />
                <p style={{ marginTop: 14, fontSize: '0.92rem' }}>{t('pcbuilder.buildingText1')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcbuilder.buildingText2')}</p>
              </div>
            </Card>
          ) : result ? (
            <>
              {result.status !== 'ready' && (
                <Card><EmptyState icon="⚠️" title={t('pcbuilder.couldNotBuild')} text={result.message || t('pcbuilder.adjustConfig')} /></Card>
              )}
              {result.status === 'ready' && cur && (
                <Card tilt>
                  <CardHead title={<>{'📦 '}{t('pcbuilder.yourBuild')} {plans.length > 1 ? `· ${activeVariant + 1}/${plans.length}` : ''}</>}>
                    <Badge tone={cur.withinBudget ? 'ok' : 'warn'}>{cur.withinBudget ? t('pcbuilder.withinBudget') : t('pcbuilder.overBudget')}</Badge>
                  </CardHead>
                  <div className="pill-row">
                    <DataTag label={cur.priceLabel} />
                    <Badge tone="info">{t('pcbuilder.total')} {cur.totalPrice} {cur.currency}</Badge>
                    <Badge>{t('pcbuilder.compatibility')}: {cur.compatibility?.status || 'ok'}</Badge>
                  </div>
                  <BuildVariants plans={plans} active={activeVariant} onPick={setActiveVariant} targetFps={cur.targetFps || 60} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {CATEGORIES.map(([key, label]) => {
                      const p = cur.parts?.[key];
                      if (!p) return null;
                      return (
                        <div key={key} style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <PartImage part={{ category: key }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div><span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t(label)}</span><div style={{ fontWeight: 600 }}>{p.name}</div></div>
                              <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, color: 'var(--primary-2)' }}>{p.price} {cur.currency}</div>
                                <RefDate date={p.price_date} live={!!p.live} />
                              </div>
                            </div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 4 }}>{p.reason}</div>
                            <StoreLinks store={p.store} name={p.name} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {cur.expectedFps?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>🎮 {t('pcbuilder.expectedFps')} ({cur.resolution})</div>
                      <div className="pill-row" style={{ marginTop: 6 }}>
                        {cur.expectedFps.map((f) => <Badge key={f.game} tone={f.fps != null ? 'primary' : ''}>{f.game}: {f.fps != null ? `~${f.fps} FPS` : t('pcbuilder.noVerifiedData')}</Badge>)}
                      </div>
                    </div>
                  )}
                  {cur.compatibility?.summary && (
                    <p style={{ fontSize: '0.84rem', marginTop: 10 }}>✅ {cur.compatibility.summary}</p>
                  )}
                  {activeVariant === 0 && result.ai?.explanation && (
                    <div className="card pad-sm" style={{ marginTop: 12, background: 'rgba(124,92,255,0.06)' }}>
                      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>🤖 {t('pcbuilder.aiRec')}</div>
                      <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', marginTop: 4 }}>{result.ai.explanation}</p>
                    </div>
                  )}
                  {activeVariant === 0 && result.ai?.error && <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: 10 }}>{result.ai.error}</p>}
                  <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 12 }}>{cur.note}</p>
                  {activeVariant === 0 && result.buildId && (
                    <div style={{ marginTop: 14, borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', fontWeight: 600, marginRight: 4 }}>{t('shared.shareVia')}</span>
                      <button className="btn btn-primary btn-sm" onClick={() => doShare('copy')}>{t('shared.copyLink')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => doShare('whatsapp')}>WhatsApp</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => doShare('x')}>X</button>
                    </div>
                  )}
                  {activeVariant > 0 && (
                    <div style={{ marginTop: 14, borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button className="btn btn-primary btn-sm" onClick={saveCurrentVariant}>{t('pcbuilder.useThisVariant')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setActiveVariant(0)}>{t('pcbuilder.backToBest')}</button>
                    </div>
                  )}
                </Card>
              )}
            </>
          ) : (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="🛠️" title={t('pcbuilder.noBuildYet')} text={t('pcbuilder.noBuildText')} />
            </Card>
          )}

          {saved.length > 0 && (
            <Card style={{ marginTop: 18 }}>
              <CardHead title={<>💾 {t('pcbuilder.savedBuilds')}</>} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {saved.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{b.total_price} {b.currency} · {b.resolution}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{new Date(b.created_at).toLocaleString()} · {b.status}{b.has_ai ? ' · AI' : ''}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setResult({ status: 'ready', parts: b.parts, totalPrice: b.total_price, currency: b.currency, budget: b.budget, resolution: b.resolution, withinBudget: true, compatibility: { status: 'saved', summary: '' }, expectedFps: [], note: t('pcbuilder.loadedFromSaved') }); }}>{t('pcbuilder.view')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteBuild(b.id)}>✕</button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
