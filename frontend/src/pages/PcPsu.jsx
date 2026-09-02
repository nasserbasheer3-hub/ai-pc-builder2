import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

function Fact({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '4px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
      <span style={{ color: 'var(--text-faint)' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export default function PcPsu() {
  const toast = useToast();
  const { t } = useI18n();
  const [catalog, setCatalog] = useState({});
  const [form, setForm] = useState({
    cpu_id: '', gpu_id: '', ram_id: '', ram_modules: 2,
    storage_id: '', cooler_id: '', case_fans: 0, psu_id: '',
  });
  const [res, setRes] = useState(null);
  const [running, setRunning] = useState(false);
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    Promise.all([
      ['cpus', 'cpu'], ['gpus', 'gpu'], ['ram', 'ram'], ['storage', 'storage'], ['coolers', 'cooler'], ['psus', 'psu'],
    ].map(async ([cat, key]) => {
      const items = await getHardwareCategory(cat);
      setCatalog((c) => ({ ...c, [key]: items }));
    })).catch((e) => toast.err(e.message));
  }, []);

  const run = async () => {
    if (!form.cpu_id && !form.gpu_id) return toast.err(t('pcpsu.required'));
    setRunning(true);
    setRes(null);
    try {
      const r = await api.post('/psu/calc', {
        cpu_id: form.cpu_id ? Number(form.cpu_id) : null,
        gpu_id: form.gpu_id ? Number(form.gpu_id) : null,
        ram_id: form.ram_id ? Number(form.ram_id) : null,
        ram_modules: form.ram_modules != null ? Number(form.ram_modules) : null,
        storage_id: form.storage_id ? Number(form.storage_id) : null,
        cooler_id: form.cooler_id ? Number(form.cooler_id) : null,
        case_fans: form.case_fans != null ? Number(form.case_fans) : 0,
        psu_id: form.psu_id ? Number(form.psu_id) : null,
      });
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  const psuTone = res?.psuVerdict?.status === 'ok' ? 'ok' : res?.psuVerdict?.status === 'warn' ? 'warn' : 'err';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🔌 {t('pcpsu.title')}</h1>
          <span className="sub">{t('pcpsu.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcpsu.components')}</>} />
          <div className="grid cols-2">
            <div className="field"><label>{t('pcpsu.cpu')}</label>
              <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.cpu || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.tdp_watts}W)</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.gpu')}</label>
              <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.gpu || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.tdp_watts}W)</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.memoryKit')}</label>
              <select className="select" value={form.ram_id} onChange={(e) => setForm({ ...form, ram_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.ram || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.ramModules')}</label>
              <select className="select" value={form.ram_modules} onChange={(e) => setForm({ ...form, ram_modules: e.target.value })}>
                {[1, 2, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.storage')}</label>
              <select className="select" value={form.storage_id} onChange={(e) => setForm({ ...form, storage_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.storage || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.cooler')}</label>
              <select className="select" value={form.cooler_id} onChange={(e) => setForm({ ...form, cooler_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.cooler || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.caseFans')}</label>
              <select className="select" value={form.case_fans} onChange={(e) => setForm({ ...form, case_fans: e.target.value })}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcpsu.psuCompare')}</label>
              <select className="select" value={form.psu_id} onChange={(e) => setForm({ ...form, psu_id: e.target.value })}>
                <option value="">—</option>
                {(catalog.psu || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.wattage}W)</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcpsu.calculating') : `🔌 ${t('pcpsu.calculate')}`}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcpsu.calculating')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcpsu.calcText')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>⚡ {t('pcpsu.result')}</>}>
                <DataTag label={t('data.estimated')} />
              </CardHead>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>{t('pcpsu.recommended')}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '4rem', fontWeight: 800, lineHeight: 1.1, background: 'var(--ok-grad, linear-gradient(135deg,#22c55e,#84cc16))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{res.recommendedW}W</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                      {t('pcpsu.baseDrawLabel')} <b>{res.baseDraw}W</b> + {Math.round(res.headroomFactor * 100)}% {t('pcpsu.headroomFactor')} (+{res.headroomW}W)
                    </div>
              </div>

              {res.psuVerdict && (
                <div className="pill-row" style={{ justifyContent: 'center', marginBottom: 10 }}>
                  <Badge tone={psuTone}>{res.psu.name} · {res.psu.wattage}W</Badge>
                  <Badge tone={psuTone}>{res.psuVerdict.message}</Badge>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('pcpsu.drawBreakdown')}</div>
                {res.components.map((c, i) => (
                  <Fact key={i} k={`${c.name}`} v={`${c.watts}W`} />
                ))}
                <Fact k={t('pcpsu.total')} v={`${res.baseDraw}W`} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>{t('pcpsu.suggestions')}</div>
                {res.suggestions.length ? res.suggestions.map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: '0.84rem' }}>
                    <span>{s.name} · <span style={{ color: 'var(--text-faint)' }}>{s.efficiency_rating}</span></span>
                    <b>{s.wattage}W · ${s.price_usd}</b>
                  </div>
                )) : <p style={{ fontSize: '0.84rem', color: 'var(--text-dim)' }}>{t('pcpsu.noSuggestion')} ({res.maxAvailable}W)</p>}
              </div>

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowModel(!showModel)}>
                {showModel ? `▾ ${t('pcb.hideModel')}` : `▸ ${t('pcb.howTitle')}`}
              </button>
              {showModel && (
                <div className="card pad-sm" style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', fontSize: '0.82rem' }}>
                  <p style={{ marginBottom: 8, color: 'var(--text-dim)' }}>{t('pcpsu.howText')}</p>
                  <Fact k={t('pcpsu.formula')} v={res.model.formula} />
                  <Fact k={t('pcpsu.headroomConst')} v={`${res.model.constants.headroomFactor * 100}%`} />
                  <Fact k={t('pcpsu.motherboardConst')} v={`${res.model.constants.motherboardW}W`} />
                  <Fact k={t('pcpsu.ramConst')} v={`${res.model.constants.ramPerModuleW}W / DIMM`} />
                  <Fact k={t('pcpsu.storageConst')} v={`${res.model.constants.storagePerDriveW}W / drive`} />
                  <Fact k={t('pcpsu.fanConst')} v={`${res.model.constants.caseFanW}W / fan`} />
                  {res.sources.length ? <Fact k={t('pcpsu.sources')} v={res.sources.join(', ')} /> : null}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {t('pcpsu.disclaimer')}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="🔌" title={t('pcpsu.noCalcYet')} text={t('pcpsu.noCalcText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
