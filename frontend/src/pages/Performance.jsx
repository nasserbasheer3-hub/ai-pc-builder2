import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Stat, Badge, Modal, EmptyState, useToast, LoadingBlock } from '../components/ui.jsx';

export default function Performance() {
  const toast = useToast();
  const { t } = useI18n();
  const [today, setToday] = useState(null);
  const [series, setSeries] = useState([]);
  const [records, setRecords] = useState([]);
  const [gamesCatalog, setGamesCatalog] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ game_id: '', wins: '', losses: '', kills: '', deaths: '' });

  const load = async () => {
    const [t, h] = await Promise.all([
      api.get('/performance/today'),
      api.get('/performance/history?days=7'),
    ]);
    setToday(t);
    setSeries(h.series || []);
    setRecords(h.records || []);
  };

  useEffect(() => {
    load().catch((e) => toast.err(e.message));
    getGames().then(setGamesCatalog).catch(() => {});
  }, []);

  const perGame = useMemo(() => {
    const map = {};
    for (const r of records) {
      if (!r.game_id) continue;
      const g = map[r.game_id] || (map[r.game_id] = { game_id: r.game_id, game_name: r.game_name || 'Unknown', kills: 0, deaths: 0, wins: 0, matches: 0, minutes: 0 });
      g.kills += r.kills || 0;
      g.deaths += r.deaths || 0;
      g.wins += r.wins || 0;
      g.matches += (r.matches || 0) || (r.wins || 0) + (r.losses || 0);
      g.minutes += r.hours ? Math.round(r.hours * 60) : 0;
    }
    return Object.values(map).sort((a, b) => b.matches - a.matches);
  }, [records]);

  const maxKd = Math.max(...series.map((d) => d.kd || 0), 1);

  const submit = async () => {
    if (!form.game_id) return toast.err(t('perf.selectGameErr'));
    try {
      await api.post('/performance/records', {
        game_id: Number(form.game_id),
        wins: Number(form.wins) || 0,
        losses: Number(form.losses) || 0,
        kills: Number(form.kills) || 0,
        deaths: Number(form.deaths) || 0,
      });
      toast.ok(t('perf.recorded'));
      setAddOpen(false);
      setForm({ game_id: '', wins: '', losses: '', kills: '', deaths: '' });
      load();
    } catch (e) { toast.err(e.message); }
  };

  if (!today) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('perf.title')}</h1>
          <span className="sub">{t('perf.sub')}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>+ {t('perf.recordStats')}</button>
      </div>

      <div className="grid cols-4">
        <Card><Stat value={today.matches > 0 ? today.matches : today.sessions} label={t('perf.matchesSessions')} /></Card>
        <Card><Stat value={today.winRate != null ? `${today.winRate}%` : '—'} label={t('perf.winRate')} /></Card>
        <Card><Stat value={today.kd != null ? today.kd : '—'} label={t('perf.kd')} /></Card>
        <Card><Stat value={`${Math.round(today.gamingTimeMinutes)}m`} label={t('perf.todaysPlayTime')} /></Card>
      </div>
      {today.summary && <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)', marginTop: 4 }}>{today.summary}</p>}

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>📈 {t('perf.kd7d')}</>}>
            <Badge tone="ok">{t('data.verified')}</Badge>
          </CardHead>
          {series.length === 0 ? <EmptyState icon="📉" title={t('perf.noDataYet')} text={t('perf.noDataText')} /> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 180 }}>
              {series.map((d) => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>{d.kd ?? '—'}</div>
                  <div className="bar-h" style={{ height: `${Math.max(8, Math.min(100, ((d.kd || 0) / maxKd) * 100))}%` }} />
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-faint)' }}>{new Date(d.date).getDate()}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title={<>🎯 {t('perf.perGame7d')}</>}>
            <Badge tone="ok">{t('data.verified')}</Badge>
          </CardHead>
          {perGame.length === 0 ? <EmptyState icon="🎮" title={t('perf.noGameStats')} text={t('perf.noGameStatsText')} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {perGame.map((g) => (
                <div key={g.game_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{g.game_name}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{g.matches} {t('perf.matches')}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--primary-2)' }}>K/D {g.deaths > 0 ? (g.kills / g.deaths).toFixed(2) : g.kills > 0 ? g.kills : '—'}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>WR {g.matches > 0 ? `${Math.round((g.wins / g.matches) * 100)}%` : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHead title={<>🗓️ {t('perf.recentRecords')}</>}>
          <Badge tone="ok">{t('data.verified')}</Badge>
        </CardHead>
        {records.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('perf.date')}</th><th>{t('perf.game')}</th><th>{t('perf.matches')}</th><th>{t('perf.wins')}</th><th>{t('perf.losses')}</th><th>{t('perf.kills')}</th><th>{t('perf.deaths')}</th><th>K/D</th></tr></thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.record_date).toLocaleDateString()}</td>
                    <td>{r.game_name || '—'}</td>
                    <td>{r.matches ?? '—'}</td>
                    <td>{r.wins ?? '—'}</td>
                    <td>{r.losses ?? '—'}</td>
                    <td>{r.kills ?? '—'}</td>
                    <td>{r.deaths ?? '—'}</td>
                    <td>{r.deaths > 0 ? ((r.kills || 0) / r.deaths).toFixed(2) : r.kills > 0 ? r.kills : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="🗓️" title={t('perf.noRecords')} text={t('perf.noRecordsText')} />}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('perf.recordTitle')}>
        <div className="field"><label>{t('perf.gameReq')}</label>
          <select className="select" value={form.game_id} onChange={(e) => setForm({ ...form, game_id: e.target.value })}>
            <option value="">{t('perf.selectGame')}</option>
            {gamesCatalog.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="grid cols-2">
          <div className="field"><label>{t('perf.kills')}</label><input className="input" type="number" min="0" value={form.kills} onChange={(e) => setForm({ ...form, kills: e.target.value })} /></div>
          <div className="field"><label>{t('perf.deaths')}</label><input className="input" type="number" min="0" value={form.deaths} onChange={(e) => setForm({ ...form, deaths: e.target.value })} /></div>
          <div className="field"><label>{t('perf.wins')}</label><input className="input" type="number" min="0" value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value })} /></div>
          <div className="field"><label>{t('perf.losses')}</label><input className="input" type="number" min="0" value={form.losses} onChange={(e) => setForm({ ...form, losses: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary btn-block" onClick={submit}>{t('perf.saveRecord')}</button>
      </Modal>
    </div>
  );
}
