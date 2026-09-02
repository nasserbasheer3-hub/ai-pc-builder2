import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Stat, Badge, EmptyState, useToast, LoadingBlock } from '../components/ui.jsx';

export default function WeeklyReport() {
  const toast = useToast();
  const { t } = useI18n();
  const [report, setReport] = useState(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [history, setHistory] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cost, setCost] = useState(null);

  const load = async () => {
    try {
      const r = await api.get('/ai/weekly-report/latest');
      setReport(r.report || null);
      const h = await api.get('/ai/weekly-report/history');
      setHistory(h.items || []);
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    api.get('/billing/me').then((d) => setCost(d.costs?.weekly_report ?? null)).catch(() => {});
  }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post('/ai/weekly-report/generate');
      toast.ok(t('report.generated'));
      setReport(r.report);
      setAiUnavailable(r.report.aiAvailable === false);
      load();
    } catch (e) {
      toast.err(e?.code === 'INSUFFICIENT_CREDITS' ? t('pricing.needCredits') : e.message);
    }
    finally { setGenerating(false); }
  };

  if (loading) return <div className="page"><LoadingBlock text={t('report.building')} /></div>;

  const m = report?.metrics || {};
  const cmp = report?.comparison || {};

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🧠 {t('report.title')}</h1>
          <span className="sub">{t('report.sub')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {cost != null && <Badge>−{cost} {t('common.credits')}</Badge>}
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? t('report.building') : report ? t('report.regenerate') : t('report.generateReport')}
          </button>
        </div>
      </div>

      {!report || !m.hasData ? (
        <Card><EmptyState icon="📊" title={t('report.noReportYet')} text={t('report.noReportText')} /></Card>
      ) : (
        <>
          <div className="grid cols-4">
            <Card><Stat value={m.sessions} label={t('report.sessions')} /></Card>
            <Card><Stat value={m.winRate != null ? `${m.winRate}%` : '—'} label={t('report.winRate')} /></Card>
            <Card><Stat value={m.kd != null ? m.kd : '—'} label={t('report.kd')} /></Card>
            <Card><Stat value={`${m.sessionHours}h`} label={t('report.playTime')} /></Card>
          </div>

          <div className="grid cols-2">
            <Card tilt>
              <CardHead title={<>⚙️ {t('report.engineAnalysis')}</>}>
                <Badge tone="ok">{t('data.verified')}</Badge>
              </CardHead>
              <p style={{ fontSize: '0.95rem' }}>{report.engineSummary}</p>
              {cmp.hasPreviousData && (
                <div className="pill-row" style={{ marginTop: 12 }}>
                  {cmp.winRateDelta != null && (
                    <Badge tone={cmp.winRateDelta >= 0 ? 'ok' : 'err'}>
                      {t('report.winRateVsPrev')} {cmp.winRateDelta >= 0 ? '+' : ''}{cmp.winRateDelta} pts
                    </Badge>
                  )}
                  <Badge tone={cmp.timeDeltaPercent >= 0 ? 'ok' : 'warn'}>
                    {t('report.playTimeDelta')} {cmp.timeDeltaPercent >= 0 ? '+' : ''}{cmp.timeDeltaPercent}%
                  </Badge>
                </div>
              )}
              {m.perGame?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('report.gamesPlayed')}</div>
                  <div className="pill-row" style={{ marginTop: 6 }}>
                    {m.perGame.map((g) => <Badge key={g.id}>{g.name} · {g.matches} {t('report.matches')}</Badge>)}
                  </div>
                </div>
              )}
              {m.daily?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('report.dailyActivity')}</div>
                  <div className="pill-row" style={{ marginTop: 6 }}>
                    {m.daily.map((d) => (
                      <Badge key={d.date} tone={d.sessions > 0 || d.matches > 0 ? 'ok' : ''}>
                        {new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}{d.sessions > 0 || d.matches > 0 ? ' ✓' : ' —'}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <CardHead title={<>🤖 {t('report.aiInsights')}</>}>
                {report.aiSummary ? <Badge tone="primary">{t('data.aiEnhanced')}</Badge> : <Badge tone="warn">{t('data.aiOffline')}</Badge>}
              </CardHead>
              {report.aiSummary ? (
                <p style={{ fontSize: '0.92rem', whiteSpace: 'pre-wrap' }}>{report.aiSummary}</p>
              ) : aiUnavailable ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)' }}>{t('common.aiUnavailable')}</p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)' }}>{t('report.noAiSummary')}</p>
              )}
            </Card>
          </div>
        </>
      )}

      {history.length > 0 && (
        <Card style={{ marginTop: 18 }}>
          <CardHead title={<>🕘 {t('report.pastReports')}</>} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('report.week')}</th><th>{t('report.sessions')}</th><th>{t('report.winRate')}</th><th>K/D</th><th>{t('report.hours')}</th><th>{t('report.ai')}</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.week_start).toLocaleDateString()} – {new Date(h.week_end).toLocaleDateString()}</td>
                    <td>{h.sessions}</td>
                    <td>{h.win_rate != null ? `${h.win_rate}%` : '—'}</td>
                    <td>{h.kd ?? '—'}</td>
                    <td>{h.session_hours}h</td>
                    <td>{h.ai_summary ? <Badge tone="primary">✓</Badge> : <Badge tone="warn">—</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
