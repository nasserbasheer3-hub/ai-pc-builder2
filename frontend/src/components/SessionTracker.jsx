import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getGames } from '../api/catalog.js';
import { useToast } from './ui.jsx';
import { Card, CardHead, Badge, Spinner } from './ui.jsx';
import { useNavigate } from 'react-router-dom';

export default function SessionTracker({ compact }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [active, setActive] = useState(null);
  const [history, setHistory] = useState([]);
  const [gameId, setGameId] = useState('');
  const [note, setNote] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState({ wins: 0, losses: 0, kills: 0, deaths: 0 });
  const tickRef = useRef(null);

  const load = async () => {
    const d = await api.get('/sessions');
    setActive(d.active);
    setHistory(d.history.slice(0, 5));
  };

  useEffect(() => { load().catch(() => {}); getGames().then(setGames).catch(() => {}); }, []);

  useEffect(() => {
    if (active) {
      tickRef.current = setInterval(() => {
        const ms = new Date() - new Date(active.started_at);
        setElapsed(Math.max(0, Math.floor(ms / 1000)));
      }, 1000);
      return () => clearInterval(tickRef.current);
    }
    setElapsed(0);
  }, [active]);

  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h, m, sec].map((x) => String(x).padStart(2, '0')).join(':');
  };

  const start = async () => {
    setBusy(true);
    try {
      const d = await api.post('/sessions/start', { game_id: gameId || null, note: note || null });
      setActive(d.session);
      setNote('');
      setGameId('');
      toast.ok('Session started — GLHF!');
    } catch (e) {
      toast.err(e.message);
    } finally { setBusy(false); }
  };

  const end = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/sessions/${active.id}/end`);
      toast.ok(`Session ended (${Math.round(d.session.duration_minutes)} min).`);
      if (showStats) {
        await api.post(`/sessions/${active.id}/performance`, stats);
        toast.ok('Performance recorded.');
      }
      setShowStats(false);
      setActive(null);
      await load();
    } catch (e) {
      toast.err(e.message);
    } finally { setBusy(false); }
  };

  const activeGame = active?.game_id ? games.find((g) => g.id === active.game_id) : null;

  return (
    <Card>
      <CardHead title={<>⏱️ Gaming Session Tracker</>}>
        {active && <Badge tone="ok">● LIVE</Badge>}
      </CardHead>

      {active ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '8px 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: 700, letterSpacing: '0.02em' }}>{fmt(elapsed)}</div>
          <div>{activeGame ? `Playing ${activeGame.name}` : 'Playing'}{active.note ? ` — ${active.note}` : ''}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowStats(!showStats)}>{showStats ? 'Hide stats' : 'Add stats'}</button>
            <button className="btn btn-danger" disabled={busy} onClick={end}>⏹ End Session</button>
          </div>
          {showStats && (
            <div className="grid cols-4" style={{ width: '100%', gap: 10 }}>
              {['wins', 'losses', 'kills', 'deaths'].map((k) => (
                <div className="field" key={k} style={{ marginBottom: 0 }}>
                  <label style={{ textTransform: 'capitalize' }}>{k}</label>
                  <input className="input" type="number" min={0} value={stats[k]} onChange={(e) => setStats({ ...stats, [k]: Number(e.target.value) || 0 })} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid cols-2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Game</label>
              <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)}>
                <option value="">Any game</option>
                {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Note (optional)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Focused aim practice" />
            </div>
          </div>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={start}>▶ Start Gaming Session</button>
          <p style={{ fontSize: '0.78rem' }}>Sessions count toward your improvement streak.</p>
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="divider" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                <span>{s.game_name || '—'}</span>
                <span style={{ color: 'var(--text-faint)' }}>{Math.round(s.duration_minutes)} min · {new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
            {!compact && <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => navigate('/sessions')}>View all sessions</button>}
          </div>
        </>
      )}
      {history.length === 0 && !active && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: 10 }}>No sessions yet — start your first one above.</p>
      )}
    </Card>
  );
}
