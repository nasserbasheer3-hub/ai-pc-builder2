import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];

function LoadBar({ label, value, tone }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
        <b style={{ color: value >= 90 ? 'var(--danger)' : value >= 70 ? 'var(--warn)' : 'var(--ok)' }}>{value}%</b>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 6, background: `var(--${tone || 'primary-2'})`, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}

function Fact({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-faint)' }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}

export default function PcBottleneck() {
  const toast = useToast();
  const { t } = useI18n();
  const [cpus, setCpus] = useState([]);
  const [gpus, setGpus] = useState([]);
  const [form, setForm] = useState({ cpu_id: '', gpu_id: '', resolution: '1080p', quality: 'Ultra' });
  const [res, setRes] = useState(null);
  const [running, setRunning] = useState(false);
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    getHardwareCategory('cpus').then(setCpus).catch(() => {});
    getHardwareCategory('gpus').then(setGpus).catch(() => {});
  }, []);

  const run = async () => {
    if (!form.cpu_id || !form.gpu_id) return toast.err(t('pcb.required'));
    setRunning(true);
    setRes(null);
    try {
      const r = await api.post('/bottleneck/calc', {
        cpu_id: Number(form.cpu_id), gpu_id: Number(form.gpu_id),
        resolution: form.resolution, quality: form.quality,
      });
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  const dirTone = res?.direction === 'balanced' ? 'ok' : res?.direction === 'cpu' ? 'err' : 'info';
  const levelTone = res?.level === 'balanced' ? 'ok' : res?.level === 'minor' ? 'info' : res?.level === 'moderate' ? 'warn' : 'err';
  const levelKey = res?.level ? `pcb.level${res.level[0].toUpperCase()}${res.level.slice(1)}` : '';
  const dirKey = res?.direction === 'cpu' ? 'pcb.cpuBottleneck' : res?.direction === 'gpu' ? 'pcb.gpuBottleneck' : 'pcb.balanced';
  const tipKey = res?.direction === 'cpu' ? 'pcb.tipCpu' : res?.direction === 'gpu' ? 'pcb.tipGpu' : 'pcb.tipBalanced';
  const loadTone = res?.direction === 'cpu' ? 'danger' : 'primary-2';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>⚖️ {t('pcb.title')}</h1>
          <span className="sub">{t('pcb.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcb.configuration')}</>} />
          <div className="field"><label>{t('pcb.cpuReq')}</label>
            <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
              <option value="">{t('pcb.selectCpu')}</option>
              {cpus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcb.gpuReq')}</label>
            <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
              <option value="">{t('pcb.selectGpu')}</option>
              {gpus.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcb.resolution')}</label>
              <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcb.qualityPreset')}</label>
              <select className="select" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcb.calculating') : `⚖️ ${t('pcb.calculate')}`}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcb.calculating')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcb.calcText')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>🎯 {t('pcb.result')}</>}>
                <DataTag label={t('pcb.estimated')} />
              </CardHead>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{t('pcb.direction')}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '4rem', fontWeight: 800, lineHeight: 1.1, background: res.direction === 'cpu' ? 'var(--danger-grad, linear-gradient(135deg,#f43f5e,#fb923c))' : res.direction === 'gpu' ? 'var(--primary-grad)' : 'var(--ok-grad, linear-gradient(135deg,#22c55e,#84cc16))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{res.pct}%</div>
                <div className="pill-row" style={{ justifyContent: 'center' }}>
                  <Badge tone={dirTone}>{t(dirKey)}</Badge>
                  <Badge tone={levelTone}>{t(levelKey)}</Badge>
                </div>
                <p style={{ fontSize: '0.85rem', marginTop: 12, maxWidth: 420, marginInline: 'auto' }}>{t(tipKey)}</p>
              </div>

              <div className="card pad-sm" style={{ marginTop: 10, background: 'rgba(0,0,0,0.25)' }}>
                <LoadBar label={t('pcb.cpuLoad')} value={res.cpuLoad} tone={loadTone} />
                <LoadBar label={t('pcb.gpuLoad')} value={res.gpuLoad} tone={res.direction === 'gpu' ? 'danger' : 'primary-2'} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('pcb.components')}</div>
                <Fact k={`${res.cpu.name} · ${res.cpu.cores}C/${res.cpu.threads}T`} v={`${t('pcb.relIndex')}: ${res.cpu.index}`} />
                <Fact k={res.cpu.source || ''} v="" />
                <Fact k={`${res.gpu.name} · ${res.gpu.vram}GB`} v={`${t('pcb.relIndex')}: ${res.gpu.index}`} />
                <Fact k={res.gpu.source || ''} v="" />
                <Fact k={t('pcb.config')} v={`${res.config.resolution} / ${res.config.quality}`} />
              </div>

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowModel(!showModel)}>
                {showModel ? `▾ ${t('pcb.hideModel')}` : `▸ ${t('pcb.howTitle')}`}
              </button>
              {showModel && (
                <div className="card pad-sm" style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', fontSize: '0.82rem' }}>
                  <p style={{ marginBottom: 8, color: 'var(--text-dim)' }}>{t('pcb.howText')}</p>
                  <Fact k={t('pcb.formula')} v={res.model.formula} />
                  <Fact k={t('pcb.calibration')} v={`K = ${res.model.K}`} />
                  <Fact k={t('pcb.resolutionScale')} v={Object.entries(res.model.resolutionScale).map(([r, f]) => `${r} ×${f}`).join(' · ')} />
                  <Fact k={t('pcb.qualityFactor')} v={Object.entries(res.model.qualityFactor).map(([q, f]) => `${q} ×${f}`).join(' · ')} />
                  <Fact k={t('pcb.effectiveGpu')} v={res.model.effectiveGpuIndex} />
                  <Fact k={t('pcb.requiredCpu')} v={res.requiredCpu} />
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {t('pcb.disclaimer')}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="⚖️" title={t('pcb.noCalcYet')} text={t('pcb.noCalcText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
