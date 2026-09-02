import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, EmptyState, useToast, LoadingBlock } from '../components/ui.jsx';

export default function Friends() {
  const toast = useToast();
  const { t } = useI18n();
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const f = await api.get('/friends');
    setFriends(f.friends);
    setIncoming(f.incoming);
    setOutgoing(f.outgoing);
    const l = await api.get('/friends/leaderboard').catch(() => ({ leaderboard: [] }));
    setLeaderboard(l.leaderboard);
  };

  useEffect(() => {
    load().catch((e) => toast.err(e.message)).finally(() => setLoading(false));
  }, []);

  const doSearch = async () => {
    if (q.trim().length < 2) return toast.err(t('friends.typeAtLeast2'));
    try {
      const r = await api.get(`/friends/search?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
    } catch (e) { toast.err(e.message); }
  };

  const send = async (username) => {
    try {
      await api.post('/friends/requests', { username });
      toast.ok(t('friends.requestSent'));
      setResults([]);
      load();
    } catch (e) { toast.err(e.message); }
  };
  const respond = async (id, accept) => {
    try {
      if (accept) {
        await api.post(`/friends/requests/${id}/accept`);
        toast.ok(t('friends.friendAdded'));
      } else {
        await api.post(`/friends/requests/${id}/decline`);
        toast.ok(t('friends.requestDeclined'));
      }
      load();
    } catch (e) { toast.err(e.message); }
  };
  const cancelRequest = async (id) => {
    try {
      await api.del(`/friends/requests/${id}`);
      toast.ok(t('friends.requestCancelled'));
      load();
    } catch (e) { toast.err(e.message); }
  };
  const remove = async (uid) => {
    try {
      await api.del(`/friends/${uid}`);
      toast.ok(t('friends.friendRemoved'));
      load();
    } catch (e) { toast.err(e.message); }
  };

  if (loading) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('friends.title')}</h1>
          <span className="sub">{t('friends.sub')}</span>
        </div>
      </div>

      <Card>
        <CardHead title={<>🔍 {t('friends.findPlayers')}</>} />
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" style={{ flex: 1 }} placeholder={t('friends.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
          <button className="btn btn-primary" onClick={doSearch}>{t('friends.search')}</button>
        </div>
        {results.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div className="avatar sm">{u.username?.charAt(0)}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{u.username}</div><div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{u.rank || t('common.unranked')} · {u.games} {t('friends.games')}</div></div>
                <button className="btn btn-primary btn-sm" onClick={() => send(u.username)}>{t('friends.addFriend')}</button>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && q.length >= 2 && <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginTop: 10 }}>{t('friends.noMatches')}</p>}
      </Card>

      {incoming.length > 0 && (
        <Card style={{ marginTop: 18 }}>
          <CardHead title={<>📨 {t('friends.requests')} ({incoming.length})</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {incoming.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(34,211,238,0.05)', borderRadius: 12, border: '1px solid rgba(34,211,238,0.25)' }}>
                <div className="avatar sm">{r.username?.charAt(0)}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{r.username}</div><div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{r.rank || t('common.unranked')} · {t('friends.wantsToBeFriends')}</div></div>
                <button className="btn btn-primary btn-sm" onClick={() => respond(r.id, true)}>{t('friends.accept')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => respond(r.id, false)}>{t('friends.decline')}</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <Card>
          <CardHead title={<>👥 {t('friends.yourFriends')} ({friends.length})</>} />
          {friends.length === 0 ? <EmptyState icon="👥" title={t('friends.noFriendsYet')} text={t('friends.noFriendsText')} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {friends.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div className="avatar sm">{f.username?.charAt(0)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{f.username}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>
                      {f.rank || t('common.unranked')}
                      {f.kd != null && <> · K/D {f.kd}</>}
                      {f.sessionHours != null && <> · {f.sessionHours}h</>}
                    </div>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(f.id)}>{t('friends.remove')}</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title={<>🏆 {t('friends.leaderboard')}</>}>
            <Badge tone="info">7 {t('friends.days')} · {t('friends.privacyAware')}</Badge>
          </CardHead>
          {leaderboard.length === 0 ? <EmptyState icon="🏆" title={t('friends.nothingToCompare')} text={t('friends.nothingToCompareText')} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leaderboard.map((l, i) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: l.isMe ? 'rgba(124,92,255,0.08)' : 'rgba(0,0,0,0.25)', borderRadius: 12, border: l.isMe ? '1px solid rgba(124,92,255,0.35)' : '1px solid var(--border)' }}>
                  <div style={{ width: 24, textAlign: 'center', fontWeight: 800, color: i === 0 ? 'var(--primary-2)' : 'var(--text-faint)' }}>{i + 1}</div>
                  <div className="avatar sm">{l.username?.charAt(0)}</div>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{l.username} {l.isMe && <Badge tone="primary">{t('friends.you')}</Badge>}</div><div style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{l.rank || t('common.unranked')}</div></div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--primary-2)' }}>{l.winRate != null ? `${l.winRate}%` : '—'}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{t('friends.winRate')}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 60 }}>
                    <div style={{ fontWeight: 700 }}>{l.kd ?? '—'}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>K/D</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {outgoing.length > 0 && (
        <Card style={{ marginTop: 18 }}>
          <CardHead title={<>⏳ {t('friends.pendingOutgoing')}</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outgoing.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div className="avatar sm">{r.username?.charAt(0)}</div>
                <div style={{ flex: 1 }}>{r.username}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => cancelRequest(r.id)}>{t('friends.cancel')}</button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
