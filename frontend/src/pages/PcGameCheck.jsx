import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];

function Row({ label, min, rec }) {
  return (
    <div style={{ fontSize: '0.84rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span><b>{min || '—'}</b></span>
        <span style={{ color: 'var(--text-faint)' }}>→ {rec || '—'}</span>
      </div>
    </div>
  );
}

function CheckRow({ c, t }) {
  const icon = c.status === 'ok' ? '✅' : c.status === 'error' ? '❌' : c.status === 'warn' ? '⚠️' : 'ℹ️';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <div style={{ marginTop: 1 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t(`pcgame.check.${c.category}`)}</span>
          <b style={{ fontSize: '0.84rem', whiteSpace: 'nowrap' }}>{c.label}</b>
        </div>
        <div style={{ fontSize: '0.84rem', marginTop: 2 }}>{c.detail}</div>
      </div>
    </div>
  );
}

export default function PcGameCheck() {
  const toast = useToast();
  const { t } = useI18n();
  const [games, setGames] = useState([]);
  const [catalog, setCatalog] = useState({});
  const [form, setForm] = useState({
    game_id: '', cpu_id: '', gpu_id: '', ram_id: '', storage_id: '',
    resolution: '1080p', quality: 'Ultra', target_fps: 60,
  });
  const [res, setRes] = useState(null);
  const [running, setRunning] = useState(false);
  const [showReq, setShowReq] = useState(false);
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    Promise.all([
      ['cpus', 'cpu'], ['gpus', 'gpu'], ['ram', 'ram'], ['storage', 'storage'],
    ].map(async ([cat, key]) => {
      const items = await getHardwareCategory(cat);
      setCatalog((c) => ({ ...c, [key]: items }));
    })).catch((e) => toast.err(e.message));
  }, []);

  const run = async () => {
    if (!form.game_id) return toast.err(t('pcgame.requiredGame'));
    if (!form.gpu_id) return toast.err(t('pcgame.requiredGpu'));
    setRunning(true);
    setRes(null);
    try {
      const r = await api.post('/gamecheck/check', {
        game_id: Number(form.game_id),
        cpu_id: form.cpu_id ? Number(form.cpu_id) : null,
        gpu_id: Number(form.gpu_id),
        ram_id: form.ram_id ? Number(form.ram_id) : null,
        storage_id: form.storage_id ? Number(form.storage_id) : null,
        resolution: form.resolution, quality: form.quality,
        target_fps: Number(form.target_fps) || 60,
      });
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  const verdictTone = res?.verdict === 'meets_recommended' ? 'ok'
    : res?.verdict === 'meets_minimum' ? 'warn'
      : res?.verdict === 'below_minimum' ? 'err' : 'info';
  const verdictKey = res?.verdict ? `pcgame.verdict.${res.verdict}` : '';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🎮 {t('pcgame.title')}</h1>
          <span className="sub">{t('pcgame.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcgame.configuration')}</>} />
          <div className="field"><label>{t('pcgame.game')} *</label>
            <select className="select" value={form.game_id} onChange={(e) => setForm({ ...form, game_id: e.target.value })}>
              <option value="">{t('pcgame.selectGame')}</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcgame.cpu')}</label>
              <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
                <option value="">{t('pcgame.optional')}</option>
                {(catalog.cpu || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcgame.gpu')} *</label>
              <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
                <option value="">{t('pcgame.selectGpu')}</option>
                {(catalog.gpu || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcgame.memory')}</label>
              <select className="select" value={form.ram_id} onChange={(e) => setForm({ ...form, ram_id: e.target.value })}>
                <option value="">{t('pcgame.optional')}</option>
                {(catalog.ram || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.capacity_gb}GB)</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcgame.storage')}</label>
              <select className="select" value={form.storage_id} onChange={(e) => setForm({ ...form, storage_id: e.target.value })}>
                <option value="">{t('pcgame.optional')}</option>
                {(catalog.storage || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.capacity_gb}GB)</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcgame.resolution')}</label>
              <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcgame.quality')}</label>
              <select className="select" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>{t('pcgame.targetFps')}</label>
            <input type="number" className="input" min="1" max="480" value={form.target_fps}
              onChange={(e) => setForm({ ...form, target_fps: e.target.value })} />
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcgame.checking') : `🎮 ${t('pcgame.check')}`}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcgame.checking')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcgame.checkingText')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>{res.game.name}</>}>
                <Badge tone={verdictTone}>{t(verdictKey)}</Badge>
                <DataTag label={t('data.estimated')} />
              </CardHead>

              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{t('pcgame.estimatedFps')}</div>
                {res.fps != null ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '4rem', fontWeight: 800, lineHeight: 1.1, background: res.meetsTarget ? 'var(--ok-grad, linear-gradient(135deg,#22c55e,#84cc16))' : 'var(--warn-grad, linear-gradient(135deg,#f59e0b,#f43f5e))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{res.fps}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                      {t('pcgame.target')} {res.target} FPS · 1% low {res.fps1Low} · {res.config.resolution} / {res.config.quality}
                    </div>
                    <div className="pill-row" style={{ justifyContent: 'center', marginTop: 8 }}>
                      {res.meetsTarget ? <Badge tone="ok">{t('pcgame.meetsTarget')}</Badge> : <Badge tone="err">{t('pcgame.belowTarget')}</Badge>}
                      {res.anchorMatchNote && <Badge tone="info">{res.anchorMatchNote}</Badge>}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '18px 0', fontSize: '0.88rem', color: 'var(--text-dim)' }}>
                    {t('pcgame.noBenchmark')}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {res.checks.map((c, i) => <CheckRow key={i} c={c} t={t} />)}
              </div>

              {res.requirements && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowReq(!showReq)}>
                    {showReq ? `▾ ${t('pcgame.hideRequirements')}` : `▸ ${t('pcgame.showRequirements')}`}
                  </button>
                  {showReq && (
                    <div className="card pad-sm" style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)' }}>
                      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('pcgame.officialReq')}</div>
                      <Row label={t('pcgame.cpu')} min={res.requirements.min.cpu} rec={res.requirements.rec.cpu} />
                      <Row label={t('pcgame.gpu')} min={res.requirements.min.gpu} rec={res.requirements.rec.gpu} />
                      {res.requirements.min.vramGb != null && (
                        <Row label={t('pcgame.vram')} min={`${res.requirements.min.vramGb}GB`} rec={`${res.requirements.rec.vramGb}GB`} />
                      )}
                      <Row label={t('pcgame.ram')} min={`${res.requirements.min.ramGb}GB`} rec={`${res.requirements.rec.ramGb}GB`} />
                      <Row label={t('pcgame.storage')} min={`${res.requirements.min.storageGb}GB`} rec={`${res.requirements.rec.storageGb}GB`} />
                      <Row label={t('pcgame.os')} min={res.requirements.min.os} rec={res.requirements.rec.os} />
                      {res.requirements.notes && <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 8 }}>{res.requirements.notes}</p>}
                      {res.requirements.sourceUrl && (
                        <a href={res.requirements.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: 'var(--primary-2)' }}>{t('pcgame.source')} ↗</a>
                      )}
                    </div>
                  )}
                </>
              )}

              {res.anchor && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowModel(!showModel)}>
                  {showModel ? `▾ ${t('pcb.hideModel')}` : `▸ ${t('pcb.howTitle')}`}
                </button>
              )}
              {showModel && res.anchor && (
                <div className="card pad-sm" style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', fontSize: '0.82rem' }}>
                  <p style={{ marginBottom: 8, color: 'var(--text-dim)' }}>{t('pcgame.howText')}</p>
                  <div style={{ fontSize: '0.84rem', padding: '4px 0' }}><b>{res.anchor.gpu.name}</b> — {t('pcgame.gpuAnchor')}: {res.anchor.gpu.avgFps} FPS</div>
                  {res.anchor.cpu && <div style={{ fontSize: '0.84rem', padding: '4px 0' }}><b>{res.anchor.cpu.name}</b> — {t('pcgame.cpuAnchor')}: {res.anchor.cpu.avgFps} FPS</div>}
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginTop: 4 }}>{t('pcgame.modelNote')} {res.fpsScale === 'gpu+cpu' ? t('pcgame.scaleBoth') : res.fpsScale === 'gpu' ? t('pcgame.scaleGpu') : ''}</div>
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {t('pcgame.disclaimer')}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="🎮" title={t('pcgame.noCheckYet')} text={t('pcgame.noCheckText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
