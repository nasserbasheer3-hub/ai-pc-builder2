import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, useToast, LoadingBlock } from '../components/ui.jsx';

function useCoachStream(t) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const run = async (path, body) => {
    setContent('');
    setError(false);
    setErrMsg('');
    setBusy(true);
    try {
      await api.stream(path, body ?? {}, (delta) => setContent((c) => c + delta));
    } catch (e) {
      setError(true);
      setErrMsg(e?.code === 'INSUFFICIENT_CREDITS' ? t('pricing.needCredits') : (e.message || t('common.aiUnavailable')));
    } finally {
      setBusy(false);
    }
  };

  return { content, busy, error, errMsg, run };
}

function CoachOutput({ stream, t }) {
  const { content, busy, error, errMsg } = stream;
  if (!content && !busy && !error) {
    return (
      <div className="coach-placeholder">
        {t('coach.placeholder')}
      </div>
    );
  }
  return (
    <div className="coach-output">
      {content ? <p className="coach-text">{content}</p> : busy ? <LoadingBlock text={t('coach.aiAnalyzing')} /> : null}
      {busy && content && <span className="typing" />}
      {error && (
        <div className="coach-error">
          {errMsg}
          {content ? <div className="coach-note">{t('coach.partialResponse')}</div> : null}
        </div>
      )}
    </div>
  );
}

export default function AiCoach() {
  const toast = useToast();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  const [sessionId, setSessionId] = useState('');
  const [gameId, setGameId] = useState('');
  const [planFocus, setPlanFocus] = useState('');
  const [savedPlan, setSavedPlan] = useState(null);
  const [costs, setCosts] = useState(null);

  const sessionStream = useCoachStream(t);
  const gameStream = useCoachStream(t);
  const planStream = useCoachStream(t);

  useEffect(() => {
    (async () => {
      try {
        const [sr, gr, pr, bm] = await Promise.all([
          api.get('/sessions?page=1&limit=100'),
          api.get('/games'),
          api.get('/ai/plan/latest'),
          api.get('/billing/me'),
        ]);
        setCosts(bm.costs || null);
        const ended = (sr.history || []).filter((s) => s.status === 'ended');
        setSessions(ended);
        setGames(gr.games || []);
        setSavedPlan(pr.plan || null);
        const pre = params.get('session');
        const initial = ended.find((s) => String(s.id) === pre) || ended[0];
        setSessionId(initial ? String(initial.id) : '');
        setGameId((gr.games || [])[0] ? String((gr.games || [])[0].id) : '');
      } catch (e) { toast.err(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const session = sessions.find((s) => String(s.id) === sessionId);

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🎯 {t('coach.title')}</h1>
          <span className="sub">{t('coach.sub')}</span>
        </div>
      </div>

      {loading ? <LoadingBlock text={t('coach.loading')} /> : (
        <div className="grid cols-3" style={{ alignItems: 'start' }}>
          <Card>
            <CardHead title={<>🧾 {t('coach.sessionCoach')}</>}>
              <Badge tone="ok">{t('coach.verifiedData')}</Badge>
            </CardHead>
            <div className="field">
              <label>{t('coach.recentEndedSession')}</label>
              <select className="select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {sessions.length === 0 && <option value="">{t('coach.noEndedSessions')}</option>}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.game_name || t('coach.unknownGame')} · {fmtDate(s.started_at)} · {s.duration_minutes || 0}m
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={sessionStream.busy || !session}
              onClick={() => sessionStream.run(`/ai/session/${session.id}/debrief`)}
            >
              {sessionStream.busy ? t('coach.analyzing') : t('coach.analyzeSession')}
            </button>
            {costs?.session_coach != null && <Badge style={{ marginTop: 8 }}>−{costs.session_coach} {t('common.credits')}</Badge>}
            <CoachOutput stream={sessionStream} t={t} />
          </Card>

          <Card>
            <CardHead title={<>🎮 {t('coach.gameCoach')}</>}>
              <Badge tone="primary">{t('coach.catalogYourStats')}</Badge>
            </CardHead>
            <div className="field">
              <label>{t('coach.game')}</label>
              <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)}>
                {games.length === 0 && <option value="">{t('coach.noGames')}</option>}
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} · {g.genre}</option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={gameStream.busy || !gameId}
              onClick={() => gameStream.run(`/ai/game/${gameId}/coach`)}
            >
              {gameStream.busy ? t('coach.coaching') : t('coach.getCoaching')}
            </button>
            {costs?.game_coach != null && <Badge style={{ marginTop: 8 }}>−{costs.game_coach} {t('common.credits')}</Badge>}
            <CoachOutput stream={gameStream} t={t} />
          </Card>

          <Card>
            <CardHead title={<>🧭 {t('coach.improvementPlan')}</>}>
              <Badge tone="primary">{t('coach.savedToProfile')}</Badge>
            </CardHead>
            <div className="field">
              <label>{t('coach.focus')}</label>
              <input
                className="input"
                placeholder={t('coach.focusPlaceholder')}
                value={planFocus}
                onChange={(e) => setPlanFocus(e.target.value)}
                maxLength={120}
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={planStream.busy}
              onClick={() => planStream.run('/ai/plan/generate', { focus: planFocus || t('coach.focusDefault') })}
            >
              {planStream.busy ? t('coach.buildingPlan') : savedPlan ? t('coach.regeneratePlan') : t('coach.generatePlan')}
            </button>
            {costs?.plan != null && <Badge style={{ marginTop: 8 }}>−{costs.plan} {t('common.credits')}</Badge>}
            <CoachOutput stream={planStream} t={t} />
            {savedPlan && !planStream.content && (
              <div className="coach-saved">
                <div className="coach-saved-head">
                  <span>{t('coach.lastSavedPlan')}{savedPlan.focus ? ` · ${savedPlan.focus}` : ''}</span>
                  <Badge tone="ok">{t('coach.saved')} {fmtDate(savedPlan.createdAt)}</Badge>
                </div>
                <p className="coach-text">{savedPlan.text}</p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
}
