import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, ProgressBar, useToast } from '../components/ui.jsx';

const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];
const RESOLUTIONS = ['1080p', '1440p', '4K'];
const UPSCALING = ['None', 'DLSS', 'FSR', 'XeSS', 'DLSS_Balanced'];

export default function PcFps() {
  const toast = useToast();
  const { t } = useI18n();
  const [games, setGames] = useState([]);
  const [gpus, setGpus] = useState([]);
  const [cpus, setCpus] = useState([]);
  const [form, setForm] = useState({ game_id: '', gpu_id: '', cpu_id: '', resolution: '1080p', quality: 'Ultra', rt_enabled: false, upscaling: 'None' });
  const [calc, setCalc] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    getHardwareCategory('gpus').then(setGpus).catch(() => {});
    getHardwareCategory('cpus').then(setCpus).catch(() => {});
  }, []);

  const run = async () => {
    if (!form.game_id || !form.gpu_id) return toast.err(t('pcfps.gameGpuRequired'));
    setRunning(true);
    setCalc(null);
    try {
      const r = await api.post('/pc/fps', {
        game_id: Number(form.game_id), gpu_id: Number(form.gpu_id),
        cpu_id: form.cpu_id ? Number(form.cpu_id) : null,
        resolution: form.resolution, quality: form.quality,
        rt_enabled: form.rt_enabled, upscaling: form.upscaling,
      });
      setCalc(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  const levelTone = calc?.level === 'excellent' ? 'ok' : calc?.level === 'great' ? 'ok' : calc?.level === 'good' ? 'info' : calc?.level === 'playable' ? 'warn' : 'err';
  const confTone = calc?.confidence?.grade === 'high' ? 'ok' : calc?.confidence?.grade === 'medium' ? 'warn' : 'err';
  const gradeKey = calc?.confidence?.grade === 'high' ? 'pcfps.confGrade.high' : calc?.confidence?.grade === 'medium' ? 'pcfps.confGrade.medium' : 'pcfps.confGrade.low';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>📈 {t('pcfps.title')}</h1>
          <span className="sub">{t('pcfps.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcfps.configuration')}</>} />
          <div className="field"><label>{t('pcfps.gameReq')}</label>
            <select className="select" value={form.game_id} onChange={(e) => setForm({ ...form, game_id: e.target.value })}>
              <option value="">{t('pcfps.selectGame')}</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcfps.gpuReq')}</label>
            <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
              <option value="">{t('pcfps.selectGpu')}</option>
              {gpus.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcfps.cpuOptional')}</label>
            <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
              <option value="">{t('pcfps.skipCpu')}</option>
              {cpus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcfps.resolution')}</label>
              <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcfps.qualityPreset')}</label>
              <select className="select" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcfps.upscaling')}</label>
              <select className="select" value={form.upscaling} onChange={(e) => setForm({ ...form, upscaling: e.target.value })}>
                {UPSCALING.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, fontSize: '0.9rem' }}>
              <input type="checkbox" checked={form.rt_enabled} onChange={(e) => setForm({ ...form, rt_enabled: e.target.checked })} /> {t('pcfps.rayTracing')}
            </label>
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcfps.calculating') : `📈 ${t('pcfps.calculateFps')}`}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcfps.calcText1')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcfps.calcText2')}</p>
              </div>
            </Card>
          ) : calc ? (
            calc.status === 'unavailable' ? (
              <Card><EmptyState icon="🚫" title={t('pcfps.noVerifiedData')} text={calc.message} /></Card>
            ) : (
              <Card tilt>
                <CardHead title={<>🎮 {t('pcfps.result')}</>}>
                  <DataTag label={calc.label} />
                </CardHead>
                {calc.avgFps ? (
                  <>
                    <div style={{ textAlign: 'center', padding: '10px 0' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{t('pcfps.avgFps')}</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '4.4rem', fontWeight: 800, lineHeight: 1.1, background: 'var(--primary-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{calc.avgFps}</div>
                      <Badge tone={levelTone}>{calc.level}</Badge>
                    </div>
                    <div className="pill-row" style={{ justifyContent: 'center' }}>
                      <Badge>{t('pcfps.range')} {calc.range?.low}–{calc.range?.high}</Badge>
                      {calc.low1 != null && <Badge>1% low {calc.low1}</Badge>}
                    </div>
                    <p style={{ fontSize: '0.85rem', marginTop: 14 }}>{calc.message}</p>
                    {calc.confidence && (
                      <div className="card pad-sm" style={{ marginTop: 10, background: 'rgba(0,0,0,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600 }}>
                            {t('pcfps.confidence')}
                          </span>
                          <Badge tone={confTone}>{calc.confidence.score}% · {t(gradeKey)}</Badge>
                        </div>
                        <ProgressBar pct={calc.confidence.score} />
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
                          {calc.confidence.factors?.map((f, i) => <div key={i}>• {f}</div>)}
                        </div>
                      </div>
                    )}
                    {calc.basis?.anchor && (
                      <div className="card pad-sm" style={{ marginTop: 10, background: 'rgba(0,0,0,0.25)' }}>
                        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('pcfps.referenceAnchor')}</div>
                        <div style={{ fontSize: '0.84rem', marginTop: 4 }}>{t('pcfps.verifiedBenchmark')}: {calc.basis.anchor.fps} FPS @ {calc.basis.anchor.resolution} ({calc.basis.anchor.quality}), {new Date(calc.basis.anchor.date).toLocaleDateString()}</div>
                        {calc.basis.steps?.map((s, i) => <div key={i} style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 2 }}>• {s}</div>)}
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: '0.9rem' }}>{calc.message}</p>
                )}
              </Card>
            )
          ) : (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="📈" title={t('pcfps.noCalcYet')} text={t('pcfps.noCalcText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
