import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const QUALITIES = ['Low', 'Medium', 'High', 'Ultra', 'Epic'];

function statusTone(s) {
  if (s === 'approved') return 'ok';
  if (s === 'rejected') return 'err';
  if (s === 'hidden') return 'warn';
  return 'info';
}

export default function CommunityBenchmarks() {
  const toast = useToast();
  const { t } = useI18n();
  const [tab, setTab] = useState('submit');

  const [opt, setOpt] = useState(null);
  const [form, setForm] = useState({
    game_id: '', cpu_id: '', gpu_id: '', resolution: '1080p', quality: 'Ultra',
    rt_enabled: false, upscaling: 'None', avg_fps: '', pct1_low: '',
    fps_method: 'ingame_benchmark', driver_version: '', notes: '', agreed_measured: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [verifiedHint, setVerifiedHint] = useState(false);

  const [mine, setMine] = useState(null);
  const [mineFilter, setMineFilter] = useState('');
  const [loadingMine, setLoadingMine] = useState(false);

  const [publicRows, setPublicRows] = useState(null);
  const [filters, setFilters] = useState({ game_id: '', gpu_id: '' });
  const [applied, setApplied] = useState({ game_id: '', gpu_id: '' });
  const [loadingPublic, setLoadingPublic] = useState(false);

  const loadOptions = async () => {
    try { setOpt(await api.get('/community/benchmarks/options')); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { loadOptions(); }, []);

  const loadMine = async (status) => {
    setLoadingMine(true);
    try {
      const q = status ? `?status=${status}` : '';
      setMine(await api.get(`/community/benchmarks/mine${q}`));
    } catch (e) { toast.err(e.message); }
    finally { setLoadingMine(false); }
  };
  useEffect(() => { if (tab === 'mine' && !mine) loadMine(mineFilter); }, [tab]);

  const loadPublic = async (f) => {
    setLoadingPublic(true);
    try {
      const p = new URLSearchParams();
      if (f?.game_id) p.set('game_id', f.game_id);
      if (f?.gpu_id) p.set('gpu_id', f.gpu_id);
      const qs = p.toString();
      setPublicRows(await api.get(`/community/benchmarks/public${qs ? `?${qs}` : ''}`));
    } catch (e) { toast.err(e.message); }
    finally { setLoadingPublic(false); }
  };
  useEffect(() => { if (tab === 'community' && !publicRows) loadPublic(applied); }, [tab]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.game_id) return toast.err(t('cben.errGame'));
    if (!form.gpu_id) return toast.err(t('cben.errGpu'));
    if (!form.avg_fps || Number(form.avg_fps) <= 0) return toast.err(t('cben.errFps'));
    if (!form.agreed_measured) return toast.err(t('cben.errAgree'));
    setSubmitting(true);
    try {
      const body = {
        game_id: Number(form.game_id),
        gpu_id: Number(form.gpu_id),
        cpu_id: form.cpu_id ? Number(form.cpu_id) : null,
        resolution: form.resolution,
        quality: form.quality,
        rt_enabled: !!form.rt_enabled,
        upscaling: form.upscaling,
        avg_fps: Number(form.avg_fps),
        pct1_low: form.pct1_low !== '' ? Number(form.pct1_low) : null,
        fps_method: form.fps_method,
        driver_version: form.driver_version.trim() || null,
        notes: form.notes.trim() || null,
        agreed_measured: !!form.agreed_measured,
      };
      await api.post('/community/benchmarks', body);
      toast.ok(t('cben.sent'));
      setVerifiedHint(false);
      setForm((f) => ({ ...f, avg_fps: '', pct1_low: '', driver_version: '', notes: '', agreed_measured: false }));
      setMine(null);
      setTab('mine');
    } catch (e) {
      if (e.code === 'EMAIL_UNVERIFIED') setVerifiedHint(true);
      toast.err(e.message);
    }
    finally { setSubmitting(false); }
  };

  const removeMine = async (id) => {
    if (!window.confirm(t('cben.deleteConfirm'))) return;
    try { await api.del(`/community/benchmarks/${id}`); toast.ok(t('cben.deleted')); setMine(null); }
    catch (e) { toast.err(e.message); }
  };

  const chips = (sel, options, onPick) => options.map(([key, label]) => (
    <button key={key} className={`chip ${sel === key ? 'chip-on' : ''}`} onClick={() => onPick(key)}>{label}</button>
  ));

  const heading = {
    submit: t('cben.submitTitle'),
    mine: t('cben.mineTitle'),
    community: t('cben.communityTitle'),
  }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('cben.title')}</h1>
          <span className="sub">{t('cben.sub')}</span>
        </div>
      </div>

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {chips(tab, [['submit', t('cben.tab.submit')], ['mine', t('cben.tab.mine')], ['community', t('cben.tab.community')]], setTab)}
      </div>

      {tab === 'submit' && (
        <div className="grid cols-2">
          <Card>
            <CardHead title={<>{t('cben.submitTitle')} <DataTag label={t('cben.tagUserProvided')} /></>} />
            <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)', marginBottom: 12 }}>{t('cben.howWorks')}</p>
            {verifiedHint && (
              <div className="note-warn" style={{ marginBottom: 12 }}>
                {t('cben.emailHint')} <Link to="/settings">{t('cben.verifyLink')}</Link>
              </div>
            )}
            <div className="grid cols-2">
              <div className="field"><label>{t('cben.game')}</label>
                <select className="select" value={form.game_id} onChange={(e) => set('game_id', e.target.value)}>
                  <option value="">—</option>
                  {(opt?.games || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.gpu')}</label>
                <select className="select" value={form.gpu_id} onChange={(e) => set('gpu_id', e.target.value)}>
                  <option value="">—</option>
                  {(opt?.gpus || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.cpu')}</label>
                <select className="select" value={form.cpu_id} onChange={(e) => set('cpu_id', e.target.value)}>
                  <option value="">{t('cben.cpuNone')}</option>
                  {(opt?.cpus || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.resolution')}</label>
                <select className="select" value={form.resolution} onChange={(e) => set('resolution', e.target.value)}>
                  {(opt?.resolutions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.quality')}</label>
                <select className="select" value={form.quality} onChange={(e) => set('quality', e.target.value)}>
                  {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.upscaling')}</label>
                <select className="select" value={form.upscaling} onChange={(e) => set('upscaling', e.target.value)}>
                  {(opt?.upscaling || []).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.avgFps')}</label>
                <input type="number" step="0.1" min="5" className="input" value={form.avg_fps} onChange={(e) => set('avg_fps', e.target.value)} placeholder="120" />
              </div>
              <div className="field"><label>{t('cben.pct1Low')}</label>
                <input type="number" step="0.1" min="0" className="input" value={form.pct1_low} onChange={(e) => set('pct1_low', e.target.value)} placeholder={t('cben.pct1Ph')} />
              </div>
              <div className="field"><label>{t('cben.method')}</label>
                <select className="select" value={form.fps_method} onChange={(e) => set('fps_method', e.target.value)}>
                  {(opt?.fps_methods || []).map((m) => <option key={m} value={m}>{t(`cben.mtd.${m}`)}</option>)}
                </select>
              </div>
              <div className="field"><label>{t('cben.driver')}</label>
                <input className="input" value={form.driver_version} onChange={(e) => set('driver_version', e.target.value)} maxLength={40} placeholder="561.09" />
              </div>
              <div className="field"><label>{t('cben.rayTracing')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem' }}><input type="checkbox" checked={!!form.rt_enabled} onChange={(e) => set('rt_enabled', e.target.checked)} /> {t('cben.rtOn')}</label>
              </div>
            </div>
            <div className="field"><label>{t('cben.notes')}</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={400} placeholder={t('cben.notesPh')} />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.86rem', margin: '6px 0 12px' }}>
              <input type="checkbox" style={{ marginTop: 3 }} checked={!!form.agreed_measured} onChange={(e) => set('agreed_measured', e.target.checked)} />
              <span>{t('cben.agree')}</span>
            </label>
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={submit}>
              {submitting ? t('cben.submitting') : t('cben.submit')}
            </button>
          </Card>
          <Card>
            <CardHead title={t('cben.reviewTitle')} />
            <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)', marginBottom: 10 }}>{t('cben.reviewText')}</p>
            <ul style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: '0.9rem' }}>
              {[t('cben.rule1'), t('cben.rule2'), t('cben.rule3'), t('cben.rule4')].map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'mine' && (
        <Card>
          <CardHead title={heading}>
            {mine?.counts && (
              <div className="chip-row" style={{ margin: 0 }}>
                {chips(mineFilter, [
                  ['', `${t('cben.status.all')}`],
                  ['pending', `${t('cben.status.pending')} (${mine.counts.pending})`],
                  ['approved', `${t('cben.status.approved')} (${mine.counts.approved})`],
                  ['rejected', `${t('cben.status.rejected')} (${mine.counts.rejected})`],
                  ['hidden', `${t('cben.status.hidden')} (${mine.counts.hidden})`],
                ], (k) => { setMineFilter(k); loadMine(k); })}
              </div>
            )}
          </CardHead>
          {loadingMine ? <Spinner /> : !mine?.rows?.length ? (
            <EmptyState title={t('cben.emptyMine')} text={t('cben.emptyMineText')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>{t('cben.col.game')}</th><th>{t('cben.col.gpu')}</th><th>{t('cben.col.cpu')}</th>
                  <th>{t('cben.col.fps')}</th><th>{t('cben.col.low')}</th><th>{t('cben.col.date')}</th>
                  <th>{t('cben.col.status')}</th><th></th>
                </tr></thead>
                <tbody>
                  {mine.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.game_name}</td><td>{r.gpu_name}</td><td>{r.cpu_name || '—'}</td>
                      <td><b>{r.avg_fps}</b></td><td>{r.pct1_low ?? '—'}</td>
                      <td>{String(r.created_at || '').slice(0, 10)}</td>
                      <td><Badge tone={statusTone(r.status)}>{t(`cben.status.${r.status}`)}</Badge></td>
                      <td>
                        {(r.status === 'pending' || r.status === 'rejected') && (
                          <button className="btn btn-danger btn-sm" onClick={() => removeMine(r.id)}>{t('cben.delete')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'community' && (
        <Card>
          <CardHead title={heading}>
            <DataTag label={t('cben.tagCommunity')} />
          </CardHead>
          <div className="grid cols-4" style={{ marginBottom: 12 }}>
            <div className="field"><label>{t('cben.filterGame')}</label>
              <select className="select" value={filters.game_id} onChange={(e) => setFilters((f) => ({ ...f, game_id: e.target.value }))}>
                <option value="">—</option>
                {(opt?.games || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('cben.filterGpu')}</label>
              <select className="select" value={filters.gpu_id} onChange={(e) => setFilters((f) => ({ ...f, gpu_id: e.target.value }))}>
                <option value="">—</option>
                {(opt?.gpus || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button className="btn btn-primary" disabled={loadingPublic} onClick={() => { setApplied(filters); loadPublic(filters); }}>
                {loadingPublic ? t('cben.loading') : t('cben.apply')}
              </button>
            </div>
          </div>
          {loadingPublic ? <Spinner /> : !publicRows?.rows?.length ? (
            <EmptyState title={t('cben.emptyCommunity')} text={t('cben.emptyCommunityText')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr>
                    <th>{t('cben.col.game')}</th><th>{t('cben.col.gpu')}</th><th>{t('cben.col.cpu')}</th>
                    <th>{t('cben.col.res')}</th><th>{t('cben.col.quality')}</th><th>{t('cben.col.fps')}</th>
                    <th>{t('cben.col.low')}</th><th>{t('cben.col.who')}</th><th>{t('cben.col.date')}</th>
                  </tr></thead>
                  <tbody>
                    {publicRows.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.game_name}</td><td>{r.gpu_name}</td><td>{r.cpu_name || '—'}</td>
                        <td>{r.resolution}{r.rt_enabled ? ' RT' : ''}</td><td>{r.quality}</td>
                        <td><b>{r.avg_fps}</b></td><td>{r.pct1_low ?? '—'}</td>
                        <td>{r.contributor}</td>
                        <td>{String(r.created_at || '').slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: 10 }}>
                {t('cben.verifiedNote')}
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
