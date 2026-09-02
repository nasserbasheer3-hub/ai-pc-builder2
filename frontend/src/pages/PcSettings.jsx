import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

export default function PcSettings() {
  const toast = useToast();
  const { t } = useI18n();
  const [games, setGames] = useState([]);
  const [gpus, setGpus] = useState([]);
  const [cpus, setCpus] = useState([]);
  const [form, setForm] = useState({ game_id: '', gpu_id: '', cpu_id: '', resolution: '1080p', refreshRate: 60, targetFps: '', preference: 'balanced' });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    getHardwareCategory('gpus').then(setGpus).catch(() => {});
    getHardwareCategory('cpus').then(setCpus).catch(() => {});
  }, []);

  const run = async () => {
    if (!form.game_id || !form.gpu_id) return toast.err(t('pcsettings.errRequired'));
    setRunning(true);
    setResult(null);
    try {
      const r = await api.post('/pc/settings', {
        game_id: Number(form.game_id), gpu_id: Number(form.gpu_id),
        cpu_id: form.cpu_id ? Number(form.cpu_id) : null,
        resolution: form.resolution, refreshRate: Number(form.refreshRate),
        targetFps: form.targetFps ? Number(form.targetFps) : null,
        preference: form.preference,
      });
      setResult(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🎯 {t('pcsettings.title')}</h1>
          <span className="sub">{t('pcsettings.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcsettings.select')}</>} />
          <div className="field"><label>{t('pcsettings.gameReq')}</label>
            <select className="select" value={form.game_id} onChange={(e) => setForm({ ...form, game_id: e.target.value })}>
              <option value="">{t('pcsettings.selectGame')}</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcsettings.gpuReq')}</label>
            <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
              <option value="">{t('pcsettings.selectGpu')}</option>
              {gpus.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcsettings.cpuOptional')}</label>
              <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
                <option value="">{t('pcsettings.skip')}</option>
                {cpus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcsettings.resolution')}</label>
              <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                <option>1080p</option><option>1440p</option><option>4K</option>
              </select>
            </div>
            <div className="field"><label>{t('pcsettings.refreshRate')}</label>
              <select className="select" value={form.refreshRate} onChange={(e) => setForm({ ...form, refreshRate: e.target.value })}>
                {[60, 120, 144, 165, 240, 360].map((r) => <option key={r} value={r}>{r} Hz</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcsettings.targetFps')}</label>
              <input className="input" type="number" placeholder="e.g. 144" value={form.targetFps} onChange={(e) => setForm({ ...form, targetFps: e.target.value })} />
            </div>
          </div>
          <div className="field"><label>{t('pcsettings.preference')}</label>
            <select className="select" value={form.preference} onChange={(e) => setForm({ ...form, preference: e.target.value })}>
              <option value="performance">{t('prof.prefPerf')}</option><option value="balanced">{t('prof.prefBalanced')}</option><option value="quality">{t('prof.prefQuality')}</option>
            </select>
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcsettings.finding') : t('pcsettings.recommend')}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcsettings.findingText')}</p>
              </div>
            </Card>
          ) : result ? (
            result.status === 'error' ? (
              <Card><EmptyState icon="⚠️" title={t('pcsettings.cannotRecommend')} text={result.message} /></Card>
            ) : result.status === 'unavailable' ? (
              <Card><EmptyState icon="🚫" title={t('pcsettings.noVerifiedSettings')} text={result.message} /></Card>
            ) : (
              <Card tilt>
                <CardHead title={<>📋 {t('pcsettings.recommendedPreset')}</>}>
                  <DataTag label={result.label} />
                </CardHead>
                <div className="card pad-sm" style={{ background: 'var(--primary-grad)', color: '#fff', marginBottom: 12 }}>
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.85 }}>{result.game} · {result.gpu}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700 }}>{result.preset.key}</div>
                  <div style={{ fontSize: '0.82rem', opacity: 0.9 }}>{result.preset.description} · ~{result.preset.targetFps} FPS</div>
                </div>
                <p style={{ fontSize: '0.85rem' }}>{result.rationale}</p>
                {result.fpsEstimate?.avgFps != null && (
                  <p style={{ fontSize: '0.85rem', marginTop: 6 }}>
                    {t('pcsettings.estimated')} <b>{result.fpsEstimate.avgFps} FPS</b> {t('pcsettings.atUltra')} <DataTag label={result.fpsEstimate.label} />
                  </p>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {result.settings.map((s) => (
                    <div key={s.setting} className="chip-static">
                      <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{s.setting}</span> <b>{String(s.value)}</b>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 12 }}>{t('pcsettings.source')} {result.sourceLabel}</p>
              </Card>
            )
          ) : (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="🎯" title={t('pcsettings.noPresetYet')} text={t('pcsettings.noPresetText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
