import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/ui.jsx';
import { useI18n } from '../i18n/index.jsx';

const RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Immortal', 'Radiant', 'Challenger', 'Unranked'];

export default function Onboarding() {
  const { refresh } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [games, setGames] = useState([]);
  const [hw, setHw] = useState({ cpus: [], gpus: [], ram: [], storage: [] });
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    games: [], mainGameId: null, rank: '', gaming_goals: '',
    cpu_id: null, gpu_id: null, ram_id: null, storage_id: null,
    monitor_resolution: '1080p', refresh_rate: 144,
    performance_preference: 'balanced', language: 'en', currency: 'USD',
  });

  useEffect(() => {
    getGames().then(setGames).catch(() => {});
    Promise.all([
      getHardwareCategory('cpus'), getHardwareCategory('gpus'),
      getHardwareCategory('ram'), getHardwareCategory('storage'),
    ]).then(([cpus, gpus, ram, storage]) => setHw({ cpus, gpus, ram, storage })).catch(() => {});
  }, []);

  const toggleGame = (id) => {
    const has = form.games.includes(id);
    const games2 = has ? form.games.filter((g) => g !== id) : [...form.games, id];
    const main = !has && !form.mainGameId ? id : form.mainGameId === id && has ? null : form.mainGameId;
    setForm({ ...form, games: games2, mainGameId: main });
  };

  const setMain = (id) => {
    const games2 = form.games.includes(id) ? form.games : [...form.games, id];
    setForm({ ...form, games: games2, mainGameId: id });
  };

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/profile/onboarding', form);
      await refresh();
      toast.ok(t('onb.welcome'));
      navigate('/dashboard');
    } catch (e) {
      toast.err(e.message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [t('onb.step1'), t('onb.step2'), t('onb.step3')];

  return (
    <div className="page" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="card" style={{ padding: 30 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 26 }}>
          {steps.map((s, i) => (
            <div key={s} style={{ flex: 1 }}>
              <div className="bar"><div style={{ width: i <= step ? '100%' : '0%' }} /></div>
              <div style={{ fontSize: '0.72rem', color: i === step ? 'var(--text)' : 'var(--text-faint)', marginTop: 6, fontWeight: 600 }}>{s}</div>
            </div>
          ))}
        </div>

        {step === 0 && (
          <>
            <h2>{t('onb.whatDoYouPlay')}</h2>
            <p style={{ margin: '6px 0 16px' }}>{t('onb.whatDoYouPlaySub')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {games.map((g) => {
                const sel = form.games.includes(g.id);
                const main = form.mainGameId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGame(g.id)}
                    style={{
                      border: `1px solid ${sel ? 'rgba(124,92,255,0.6)' : 'var(--border)'}`,
                      background: sel ? 'rgba(124,92,255,0.15)' : 'var(--surface)',
                      color: 'var(--text)', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.92rem', fontWeight: 600,
                    }}
                  >
                    {g.name} {main && <span style={{ color: 'var(--primary-2)', marginLeft: 6 }}>{t('onb.mainTag')}</span>}
                  </button>
                );
              })}
            </div>
            {form.games.length > 1 && (
              <div className="field" style={{ marginTop: 18 }}>
                <label>{t('onb.mainGame')}</label>
                <select className="select" value={form.mainGameId || ''} onChange={(e) => setMain(Number(e.target.value))}>
                  <option value="">{t('onb.selectMainGame')}</option>
                  {form.games.map((id) => { const g = games.find((x) => x.id === id); return g && <option key={id} value={id}>{g.name}</option>; })}
                </select>
              </div>
            )}
            <div className="field">
              <label>{t('onb.currentRank')}</label>
              <select className="select" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })}>
                <option value="">{t('onb.selectRank')}</option>
                {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('onb.gamingGoals')}</label>
              <textarea className="input" rows={2} placeholder={t('onb.goalsPlaceholder')} value={form.gaming_goals} onChange={(e) => setForm({ ...form, gaming_goals: e.target.value })} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>{t('onb.yourPc')}</h2>
            <p style={{ margin: '6px 0 16px' }}>{t('onb.yourPcSub')}</p>
            <div className="grid cols-2">
              <div className="field"><label>{t('onb.cpu')}</label>
                <select className="select" value={form.cpu_id || ''} onChange={(e) => setForm({ ...form, cpu_id: Number(e.target.value) || null })}>
                  <option value="">{t('onb.selectCpu')}</option>
                  {hw.cpus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('onb.gpu')}</label>
                <select className="select" value={form.gpu_id || ''} onChange={(e) => setForm({ ...form, gpu_id: Number(e.target.value) || null })}>
                  <option value="">{t('onb.selectGpu')}</option>
                  {hw.gpus.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('onb.ram')}</label>
                <select className="select" value={form.ram_id || ''} onChange={(e) => setForm({ ...form, ram_id: Number(e.target.value) || null })}>
                  <option value="">{t('onb.selectRam')}</option>
                  {hw.ram.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('onb.storage')}</label>
                <select className="select" value={form.storage_id || ''} onChange={(e) => setForm({ ...form, storage_id: Number(e.target.value) || null })}>
                  <option value="">{t('onb.selectStorage')}</option>
                  {hw.storage.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('onb.monitorResolution')}</label>
                <select className="select" value={form.monitor_resolution} onChange={(e) => setForm({ ...form, monitor_resolution: e.target.value })}>
                  {['1080p', '1440p', '4K'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('onb.refreshRate')}</label>
                <select className="select" value={form.refresh_rate} onChange={(e) => setForm({ ...form, refresh_rate: Number(e.target.value) })}>
                  {[60, 120, 144, 165, 240, 360].map((r) => <option key={r} value={r}>{r} Hz</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>{t('onb.preferences')}</h2>
            <p style={{ margin: '6px 0 16px' }}>{t('onb.preferencesSub')}</p>
            <div className="field"><label>{t('onb.perfQualityPref')}</label>
              <select className="select" value={form.performance_preference} onChange={(e) => setForm({ ...form, performance_preference: e.target.value })}>
                <option value="performance">{t('onb.maxFps')}</option>
                <option value="balanced">{t('onb.balanced')}</option>
                <option value="quality">{t('onb.maxQuality')}</option>
              </select>
            </div>
            <div className="grid cols-2">
              <div className="field"><label>{t('onb.language')}</label>
                <select className="select" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="field"><label>{t('onb.currency')}</label>
                <select className="select" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {['USD', 'EUR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="card pad-sm" style={{ background: 'rgba(34,211,238,0.05)' }}>
              <p style={{ fontSize: '0.85rem' }}>{t('onb.changeLater')}</p>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('onb.back')}</button>
          {step < 2
            ? <button className="btn btn-primary" onClick={() => setStep(step + 1)}>{t('onb.continue')}</button>
            : <button className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>{busy ? t('onb.creatingProfile') : t('onb.finish')}</button>}
        </div>
      </div>
    </div>
  );
}
