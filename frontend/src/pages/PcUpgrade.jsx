import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

export default function PcUpgrade() {
  const toast = useToast();
  const { t } = useI18n();
  const { profile } = useAuth();
  const [games, setGames] = useState([]);
  const [gpus, setGpus] = useState([]);
  const [cpus, setCpus] = useState([]);
  const [rams, setRams] = useState([]);
  const [form, setForm] = useState({ cpu_id: '', gpu_id: '', ram_id: '', resolution: '1080p', targetFps: 60, currency: 'USD', games: [] });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    getHardwareCategory('gpus').then(setGpus).catch(() => {});
    getHardwareCategory('cpus').then(setCpus).catch(() => {});
    getHardwareCategory('ram').then(setRams).catch(() => {});
  }, []);

  // Prefill from user profile when available
  useEffect(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        cpu_id: profile.cpu_id ? String(profile.cpu_id) : f.cpu_id,
        gpu_id: profile.gpu_id ? String(profile.gpu_id) : f.gpu_id,
        ram_id: profile.ram_id ? String(profile.ram_id) : f.ram_id,
        resolution: profile.monitor_resolution || f.resolution,
      }));
    }
  }, [profile]);

  const toggleGame = (id) => {
    setForm((f) => ({ ...f, games: f.games.includes(id) ? f.games.filter((x) => x !== id) : [...f.games, id] }));
  };

  const run = async () => {
    if (!form.gpu_id && !form.cpu_id) return toast.err(t('pcupgrade.errNeedPart'));
    if (!form.games.length) return toast.err(t('pcupgrade.errNeedGame'));
    setRunning(true);
    setResult(null);
    try {
      const r = await api.post('/pc/upgrade', {
        current: { cpu_id: form.cpu_id ? Number(form.cpu_id) : null, gpu_id: form.gpu_id ? Number(form.gpu_id) : null, ram_id: form.ram_id ? Number(form.ram_id) : null },
        targetGames: form.games, resolution: form.resolution, targetFps: Number(form.targetFps), currency: form.currency,
      });
      setResult(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>⚡ {t('pcupgrade.title')}</h1>
          <span className="sub">{t('pcupgrade.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pcupgrade.currentSystem')}</>}>
            <Badge tone="info">{t('pcupgrade.prefilled')}</Badge>
          </CardHead>
          <div className="grid cols-2">
            <div className="field"><label>{t('pcupgrade.gpu')}</label>
              <select className="select" value={form.gpu_id} onChange={(e) => setForm({ ...form, gpu_id: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {gpus.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcupgrade.cpu')}</label>
              <select className="select" value={form.cpu_id} onChange={(e) => setForm({ ...form, cpu_id: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {cpus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcupgrade.ram')}</label>
              <select className="select" value={form.ram_id} onChange={(e) => setForm({ ...form, ram_id: e.target.value })}>
                <option value="">{t('pcupgrade.notSure')}</option>
                {rams.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('pcupgrade.targetFps')}</label>
              <select className="select" value={form.targetFps} onChange={(e) => setForm({ ...form, targetFps: e.target.value })}>
                <option value="60">60</option><option value="120">120</option><option value="144">144</option><option value="240">240</option>
              </select>
            </div>
            <div className="field"><label>{t('pcupgrade.resolution')}</label>
              <select className="select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                <option>1080p</option><option>1440p</option><option>4K</option>
              </select>
            </div>
            <div className="field"><label>{t('pcupgrade.currency')}</label>
              <select className="select" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </div>
          </div>
          <div className="field"><label>{t('pcupgrade.targetGames')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {games.slice(0, 12).map((g) => (
                <button key={g.id} type="button" onClick={() => toggleGame(g.id)} className={`chip ${form.games.includes(g.id) ? 'chip-on' : ''}`}>{g.name}</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
            {running ? t('pcupgrade.analyzing') : t('pcupgrade.analyze')}
          </button>
        </Card>

        <div>
          {running ? (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pcupgrade.analyzingText')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pcupgrade.analyzingSub')}</p>
              </div>
            </Card>
          ) : result ? (
            result.status === 'error' ? (
              <Card><EmptyState icon="⚠️" title={t('pcupgrade.cannotAnalyze')} text={result.message} /></Card>
            ) : (
              <Card tilt>
                <CardHead title={<>📋 {t('pcupgrade.advice')}</>}>
                  <DataTag label={result.label} />
                </CardHead>
                <p style={{ fontSize: '0.92rem' }}>{result.summary}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {result.recommendations.map((r, i) => (
                    <div key={i} style={{ padding: '12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: r.type === 'gpu' && r.component !== t('pcupgrade.keepCurrent') ? '1px solid rgba(34,211,238,0.4)' : '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div><Badge tone={r.type === 'gpu' ? 'info' : 'warn'}>{r.type.toUpperCase()}</Badge> <span style={{ fontWeight: 700 }}>{r.component}</span></div>
                        {r.price != null && <div style={{ fontWeight: 700, color: 'var(--primary-2)', whiteSpace: 'nowrap' }}>{r.price ? `${r.price} ${r.currency}` : 'FREE'}</div>}
                      </div>
                      <p style={{ fontSize: '0.84rem', marginTop: 6 }}>{r.rationale}</p>
                      {r.expectedGain && <p style={{ fontSize: '0.82rem', color: 'var(--primary-2)', marginTop: 4 }}>{t('pcupgrade.expectedGain')} {r.expectedGain}</p>}
                      <DataTag label={r.confidence} />
                    </div>
                  ))}
                </div>
                {result.evidence?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('pcupgrade.evidence')}</div>
                    {result.evidence.map((e, i) => <p key={i} style={{ fontSize: '0.82rem', marginTop: 4 }}>• {e.text} <DataTag label={e.confidence} /></p>)}
                  </div>
                )}
                {result.perGame?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('pcupgrade.perGameNow')}</div>
                    <div className="pill-row" style={{ marginTop: 6 }}>
                      {result.perGame.map((g) => <Badge key={g.game} tone={g.meetsTarget ? 'ok' : 'warn'}>{g.game}: {g.currentFps != null ? `~${g.currentFps}` : '—'} FPS</Badge>)}
                    </div>
                  </div>
                )}
              </Card>
            )
          ) : (
            <Card style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="⚡" title={t('pcupgrade.noAnalysisYet')} text={t('pcupgrade.noAnalysisText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
