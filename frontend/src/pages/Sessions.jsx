import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, Modal, EmptyState, useToast, LoadingBlock, Pagination } from '../components/ui.jsx';
import SessionTracker from '../components/SessionTracker.jsx';

const PAGE_SIZE = 15;

export default function Sessions() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const r = await api.get(`/sessions?page=${p}&limit=${PAGE_SIZE}`);
      setSessions(r.history);
      setTotal(r.total);
      setActive(r.active || null);
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(1); }, []);

  const changePage = (p) => {
    setPage(p);
    load(p);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('sess.title')}</h1>
          <span className="sub">{t('sess.sub')}</span>
        </div>
      </div>

      <SessionTracker onChanged={() => load()} />

      <Card style={{ marginTop: 18 }}>
        <CardHead title={<>📜 {t('sess.history')}</>}>
          <button className="btn btn-ghost btn-sm" onClick={() => setHistoryOpen(true)}>{t('sess.historyView')}</button>
        </CardHead>
        {loading ? <LoadingBlock text={t('sess.loading')} /> : sessions.length === 0 ? (
          <EmptyState icon="🕹️" title={t('sess.noSessionsYet')} text={t('sess.noSessionsText')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('sess.game')}</th><th>{t('sess.started')}</th><th>{t('sess.ended')}</th><th>{t('sess.duration')}</th><th>{t('sess.note')}</th><th></th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.game_name || '—'}</td>
                    <td>{fmt(s.started_at)}</td>
                    <td>{s.ended_at ? fmt(s.ended_at) : <Badge tone="warn">{t('sess.live')}</Badge>}</td>
                    <td>{s.duration_minutes ? `${s.duration_minutes}m` : '—'}</td>
                    <td>{s.note || '—'}</td>
                    <td>
                      {s.status === 'ended' ? (
                        <button className="btn btn-ghost btn-sm" title={t('coach.sessionCoach')} onClick={() => navigate(`/ai/coach?session=${s.id}`)}>🤖</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={changePage} />
        )}
      </Card>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('sess.fullHistory')} wide>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('sess.game')}</th><th>{t('sess.started')}</th><th>{t('sess.ended')}</th><th>{t('sess.duration')}</th><th>{t('sess.note')}</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.game_name || '—'}</td>
                  <td>{fmt(s.started_at)}</td>
                  <td>{s.ended_at ? fmt(s.ended_at) : <Badge tone="warn">{t('sess.live')}</Badge>}</td>
                  <td>{s.duration_minutes ? `${s.duration_minutes}m` : '—'}</td>
                  <td>{s.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
