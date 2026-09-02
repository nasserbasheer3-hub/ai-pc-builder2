import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Stat, Badge, DataTag, Spinner, LoadingBlock, ProgressBar, useToast } from '../components/ui.jsx';
import SessionTracker from '../components/SessionTracker.jsx';

const PC_LINKS = [
  { to: '/pc/builder', icon: '🛠️', t: 'dash.pcBuilder', d: 'dash.pcBuilderText' },
  { to: '/pc/fps', icon: '📈', t: 'dash.fpsCalc', d: 'dash.fpsCalcText' },
  { to: '/pc/compatibility', icon: '✅', t: 'dash.compatCheck', d: 'dash.compatCheckText' },
  { to: '/pc/upgrade', icon: '⚡', t: 'dash.upgradeAdvisor', d: 'dash.upgradeAdvisorText' },
  { to: '/pc/settings', icon: '🎯', t: 'dash.gameSettings', d: 'dash.gameSettingsText' },
  { to: '/pc/hardware', icon: '🗄️', t: 'dash.hwCatalog', d: 'dash.hwCatalogText' },
  { to: '/pc/psu', icon: '🔌', t: 'dash.psuCalc', d: 'dash.psuCalcText' },
  { to: '/pc/gamecheck', icon: '🎮', t: 'dash.gameCheck', d: 'dash.gameCheckText' },
];

export default function Dashboard() {
  const { user, profile, loading } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [report, setReport] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [costs, setCosts] = useState(null);

  useEffect(() => {
    api.get('/performance/today').then(setToday).catch(() => setToday(null));
    api.get('/streak').then(setStreak).catch(() => setStreak(null));
    api.get('/ai/advice').then(setAdvice).catch(() => setAdvice(null));
    api.get('/ai/weekly-report/latest').then((r) => setReport(r?.report || null)).catch(() => setReport(null));
    api.get('/billing/me').then((d) => setCosts(d.costs || null)).catch(() => {});
  }, []);

  const getAiAdvice = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      const r = await api.get('/ai/advice?with_ai=1');
      setAdvice((prev) => ({ ...prev, ai: r.ai }));
      if (r.ai?.error) toast.err(r.ai.error);
    } catch (e) { toast.err(e.message); }
    finally { setAiLoading(false); }
  };

  if (loading) return <div className="page"><LoadingBlock text={t('common.loadingDashboard')} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('dash.welcomeBack').replace('{name}', (profile?.display_name || user?.username || '').toUpperCase())}</h1>
          <span className="sub">{t('dash.sub')}</span>
        </div>
      </div>

      {profile && !profile.onboarded && (
        <Card style={{ borderColor: 'rgba(34,211,238,0.35)', background: 'rgba(34,211,238,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '1.8rem' }}>🚀</div>
            <div style={{ flex: 1 }}>
              <h3>{t('dash.setupProfile')}</h3>
              <p style={{ fontSize: '0.88rem' }}>{t('dash.setupProfileSub')}</p>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>{t('dash.completeOnboarding')}</button>
          </div>
        </Card>
      )}

      <div className="grid cols-2">
        {/* Today's performance */}
        <Card tilt>
          <CardHead title={<>📊 {t('dash.todaysPerformance')}</>}>
            <Link to="/performance" className="btn btn-ghost btn-sm">{t('dash.details')}</Link>
          </CardHead>
          {!today ? <LoadingBlock text="Loading today's data..." /> : (
            <>
              <div className="grid cols-2">
                <Stat value={today.matches} label={t('dash.matches')} />
                <Stat value={today.sessions} label={t('dash.sessions')} />
                <Stat value={today.winRate != null ? `${today.winRate}%` : '—'} label={t('dash.winRate')} />
                <Stat value={today.kd != null ? today.kd : '—'} label={t('dash.kd')} />
              </div>
              <div style={{ marginTop: 10 }}>
                <Stat value={`${today.gamingTimeMinutes}m`} label={t('dash.playTimeToday')} />
              </div>
              {today.comparison?.hasPreviousData && (
                <div className="pill-row" style={{ marginTop: 12 }}>
                  <Badge tone={today.comparison.winRateDelta >= 0 ? 'ok' : 'err'}>
                    {today.comparison.winRateDelta >= 0 ? '▲' : '▼'} {Math.abs(today.comparison.winRateDelta)}{t('dash.winRateVsYesterday')}
                  </Badge>
                  <Badge tone={today.comparison.timeDeltaPercent >= 0 ? 'ok' : 'warn'}>
                    {today.comparison.timeDeltaPercent >= 0 ? '+' : ''}{today.comparison.timeDeltaPercent}{t('dash.playTimeDelta')}
                  </Badge>
                </div>
              )}
              {today.summary && <p style={{ fontSize: '0.84rem', marginTop: 12 }}>{today.summary}</p>}
            </>
          )}
        </Card>

        {/* Streak */}
        <Card tilt>
          <CardHead title={<>🔥 {t('dash.weekStreak')}</>}>
            <Link to="/streak" className="btn btn-ghost btn-sm">{t('dash.view')}</Link>
          </CardHead>
          {!streak ? <LoadingBlock text="Loading streak..." /> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="flame" style={{ fontSize: '2.6rem' }}>🔥</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 700 }}>{streak.current}</div>
                <div className="label" style={{ fontSize: '0.75rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('dash.dayStreak')}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>{t('dash.best').replace('{best}', streak.best)}</span>
                  <span>{t('dash.thisWeek').replace('{active}', streak.week.activeDays)}</span>
                </div>
                <ProgressBar pct={streak.weeklyProgress * 100} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {streak.last7.map((d) => (
                    <div key={d.date} title={d.date} style={{
                      width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center',
                      background: d.active ? 'var(--primary-grad)' : 'rgba(255,255,255,0.06)',
                      fontSize: '0.6rem', color: d.active ? '#fff' : 'var(--text-faint)',
                    }}>{new Date(d.date).getDate()}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid cols-2-3">
        {/* Session tracker */}
        <SessionTracker compact />
        {/* AI advice */}
        <Card>
          <CardHead title={<>🤖 {t('dash.aiAdvice')}</>}>
            <Badge tone="info">AI</Badge>
          </CardHead>
          {!advice ? <LoadingBlock text="Analyzing your performance..." /> : (
            <>
              <div className="pill-row">
                <Badge tone="ok">{t('data.verified')}</Badge><Badge>{t('data.engine')}</Badge>
                {advice.ai?.available ? <Badge tone="primary">{t('data.aiEnhanced')}</Badge> : <Badge tone="warn">{t('data.aiOffline')}</Badge>}
              </div>
              {advice.engine?.strengths?.slice(0, 2).map((s) => (
                <div key={s.title} style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>💪 {s.title} <DataTag label={s.label} /></div>
                  <p style={{ fontSize: '0.84rem' }}>{s.detail}</p>
                </div>
              ))}
              {advice.engine?.weaknesses?.slice(0, 2).map((s) => (
                <div key={s.title} style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>⚠️ {s.title} <DataTag label={s.label} /></div>
                  <p style={{ fontSize: '0.84rem' }}>{s.detail}</p>
                </div>
              ))}
              {advice.engine?.suggestions?.slice(0, 2).map((s) => (
                <div key={s.title} style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>🎯 {s.title} <DataTag label={s.label} /></div>
                  <p style={{ fontSize: '0.84rem' }}>{s.detail}</p>
                </div>
              ))}
              {advice.ai?.error && <p style={{ fontSize: '0.8rem', marginTop: 12 }}>{advice.ai.error}</p>}
              {advice.ai?.content && (
                <div className="card pad-sm" style={{ marginTop: 12, background: 'rgba(124,92,255,0.06)' }}>
                  <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{advice.ai.content}</p>
                </div>
              )}
              {!advice.ai?.content && (
                <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={aiLoading} onClick={getAiAdvice}>
                  {aiLoading ? t('dash.aiAdviceLoading') : `${t('dash.getAiAdvice')} · −${costs?.advice ?? 3} ${t('common.credits')}`}
                </button>
              )}
              <Link to="/weekly-report" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>{t('dash.fullWeeklyReport')}</Link>
            </>
          )}
        </Card>
      </div>

      {/* Weekly report strip */}
      <Card tilt>
        <CardHead title={<>🧠 {t('dash.aiWeeklyReport')}</>}>
          <Link to="/weekly-report" className="btn btn-ghost btn-sm">{report ? t('dash.viewReport') : t('dash.generate')}</Link>
        </CardHead>
        {report ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
            <div><Stat value={report.metrics.sessions} label={t('dash.sessions')} /></div>
            <div><Stat value={report.metrics.winRate != null ? `${report.metrics.winRate}%` : '—'} label={t('dash.winRate')} /></div>
            <div><Stat value={report.metrics.kd != null ? report.metrics.kd : '—'} label={t('dash.kd')} /></div>
            <div><Stat value={`${report.metrics.sessionHours}h`} label={t('dash.playTime')} /></div>
            <p style={{ flex: 1, minWidth: 220, fontSize: '0.85rem' }}>{report.engineSummary}</p>
          </div>
        ) : (
          <p style={{ fontSize: '0.88rem' }}>{t('dash.noReportYet')}</p>
        )}
      </Card>

      {/* PC hub */}
      <div>
        <div className="page-head" style={{ marginBottom: 4 }}>
          <div className="page-title"><h2>🖥️ {t('dash.pcHardware')}</h2></div>
          <Link to="/pc" className="btn btn-ghost btn-sm">{t('dash.pcHub')}</Link>
        </div>
        <div className="grid cols-3">
          {PC_LINKS.map((l) => (
            <Link key={l.to} to={l.to} style={{ textDecoration: 'none' }}>
              <div className="card hover" style={{ height: '100%' }}>
                <div style={{ fontSize: '1.5rem' }}>{l.icon}</div>
                <h3 style={{ margin: '10px 0 4px', color: 'var(--text)' }}>{t(l.t)}</h3>
                <p style={{ fontSize: '0.84rem' }}>{t(l.d)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyHint({ text }) {
  return <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)', marginTop: 12 }}>{text}</p>;
}

