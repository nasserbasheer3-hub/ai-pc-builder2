import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, Stat, EmptyState, useToast, LoadingBlock, Modal } from '../components/ui.jsx';
import ArticleEditor from '../components/ArticleEditor.jsx';

const ADMIN_KEY = 'gpp_admin_token';

function adminRequest(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(ADMIN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`/api/admin${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    .then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 401) localStorage.removeItem(ADMIN_KEY);
        throw new Error(json?.message || 'Request failed.');
      }
      return json.data;
    });
}

const TABS = [
  ['overview', 'admin.tab.overview'], ['users', 'admin.tab.users'], ['games', 'admin.tab.games'], ['hardware', 'admin.tab.hardware'],
  ['compat', 'admin.tab.compat'], ['bench', 'admin.tab.bench'], ['blog', 'admin.tab.blog'], ['messages', 'admin.tab.messages'],
  ['plans', 'admin.tab.plans'], ['ai', 'admin.tab.ai'], ['steam', 'admin.tab.steam'], ['referrals', 'admin.tab.referrals'], ['audit', 'admin.tab.audit'],
];

const TAB_ICONS = { overview: '📊', users: '👥', games: '🎮', hardware: '🗄️', compat: '✅', bench: '📈', blog: '📝', messages: '✉️', plans: '💳', ai: '🤖', steam: '🟦', referrals: '📣', audit: '📜' };

const HW_CATEGORIES = ['cpus', 'gpus', 'motherboards', 'ram', 'storage', 'psus', 'cases', 'coolers'];

export default function Admin() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState(null);

  useEffect(() => {
    adminRequest('GET', '/me').then((r) => { setMe(r.admin); setAuthed(true); }).catch(() => setAuthed(false));
  }, []);

  const logout = () => { localStorage.removeItem(ADMIN_KEY); navigate('/admin/login'); };

  if (!authed) {
    return (
      <div className="page">
        <Card>
          <EmptyState icon="🔐" title={t('admin.required')} text={t('admin.signInToContinue')} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate('/admin/login')}>{t('admin.goToLogin')}</button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🛡️ {t('admin.console')}</h1>
          <span className="sub">{t('admin.signedInAs')} {me?.email} · {me?.role}</span>
        </div>
        <button className="btn btn-ghost" onClick={logout}>{t('admin.signOut')}</button>
      </div>
      <div className="chip-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={`chip ${tab === key ? 'chip-on' : ''}`} onClick={() => setTab(key)}>{TAB_ICONS[key]} {t(label)}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'games' && <Games />}
      {tab === 'hardware' && <Hardware />}
      {tab === 'compat' && <Compatibility />}
      {tab === 'bench' && <Benchmarks />}
      {tab === 'blog' && <Blogs />}
      {tab === 'messages' && <Messages />}
      {tab === 'plans' && <PlansBilling />}
      {tab === 'ai' && <AiConfig />}
      {tab === 'steam' && <SteamAdmin />}
      {tab === 'referrals' && <Referrals />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Overview() {
  const toast = useToast();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [cur, setCur] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { adminRequest('GET', '/analytics').then(setData).catch((e) => toast.err(e.message)); }, []);
  if (!data) return <LoadingBlock text={t('common.loading')} />;

  const changePassword = async () => {
    if (pw1.length < 8) { toast.err(t('admin.passwordMin8')); return; }
    if (pw1 !== pw2) { toast.err(t('admin.passwordMismatch')); return; }
    setSaving(true);
    try {
      await adminRequest('POST', '/change-password', { currentPassword: cur, newPassword: pw1 });
      toast.ok(t('admin.passwordUpdated'));
      setCur(''); setPw1(''); setPw2('');
    } catch (e) { toast.err(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="grid cols-4">
        <Card><Stat value={data.users.total} label={t('admin.totalUsers')} /></Card>
        <Card><Stat value={data.users.activeLast7} label={t('admin.active7d')} /></Card>
        <Card><Stat value={data.sessions.total} label={t('admin.totalSessions')} /></Card>
        <Card><Stat value={data.builds} label={t('admin.pcBuilds')} /></Card>
      </div>
      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <Card>
          <CardHead title={<>🎮 {t('admin.popularGames')}</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.popularGames.map((g) => (
              <div key={g.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 10 }}>
                <span>{g.name}</span><Badge>{g.sessions} {t('admin.sessions')} · {g.users} {t('admin.users')}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title={<>⚙️ {t('admin.featureUsage')}</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.featureUsage.map((f) => (
              <div key={f.feature} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 10 }}>
                <span>{f.feature}</span><Badge tone="primary">{f.calls}</Badge>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(124,92,255,0.08)', borderRadius: 10 }}>
              <span>🤖 {t('admin.aiCalls')}</span><Badge tone="info">{data.ai.totalCalls} · {data.ai.successRate}%</Badge>
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHead title={<>🔑 {t('admin.adminPassword')}</>} />
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '0 0 12px' }}>
          {t('admin.changePasswordNote')}
        </p>
        <div className="grid cols-3" style={{ gap: 10 }}>
          <div className="field"><label>{t('admin.currentPassword')}</label><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
          <div className="field"><label>{t('admin.newPassword')}</label><input className="input" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" /></div>
          <div className="field"><label>{t('admin.confirmNewPassword')}</label><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving || !cur || !pw1} onClick={changePassword}>
          {saving ? '…' : t('admin.updatePassword')}
        </button>
      </Card>
    </>
  );
}

function Users() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [manageId, setManageId] = useState(null);
  const load = async (query = '') => {
    setLoading(true);
    try {
      const r = await adminRequest('GET', `/users?q=${encodeURIComponent(query)}`);
      setRows(r.users);
    } catch (e) { toast.err(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const setStatus = async (id, status) => {
    try {
      await adminRequest('PATCH', `/users/${id}`, { status });
      toast.ok(t('admin.userStatus').replace('{status}', status));
      load(q);
    } catch (e) { toast.err(e.message); }
  };
  const del = async (id) => {
    try {
      await adminRequest('DELETE', `/users/${id}`);
      toast.ok(t('admin.userDeleted'));
      load(q);
    } catch (e) { toast.err(e.message); }
  };
  return (
    <Card>
      <CardHead title={<>👥 {t('admin.users')}</>} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input className="input" style={{ flex: 1 }} placeholder={t('admin.searchUsers')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q)} />
        <button className="btn btn-primary" onClick={() => load(q)}>{t('common.search')}</button>
      </div>
      {loading ? <LoadingBlock text={t('common.loading')} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.user')}</th><th>{t('admin.status')}</th><th>{t('admin.verified')}</th><th>{t('admin.sessions')}</th><th>{t('admin.records')}</th><th>{t('admin.joined')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}<div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{u.email}</div></td>
                  <td><Badge tone={u.status === 'active' ? 'ok' : 'err'}>{u.status}</Badge></td>
                  <td>{u.email_verified ? '✓' : '—'}</td>
                  <td>{u.sessions}</td>
                  <td>{u.records}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="pill-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => setManageId(u.id)}>{t('admin.manage')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatus(u.id, u.status === 'active' ? 'suspended' : 'active')}>
                        {u.status === 'active' ? t('admin.suspend') : t('admin.activate')}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`${t('admin.deleteUser')} ${u.username}?`)) del(u.id); }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manageId && <UserManage id={manageId} onClose={() => { setManageId(null); load(q); }} />}
    </Card>
  );
}

function UserManage({ id, onClose }) {
  const toast = useToast();
  const { t } = useI18n();
  const [d, setD] = useState(null);
  const [creditAmt, setCreditAmt] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [planId, setPlanId] = useState('');
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setD(await adminRequest('GET', `/users/${id}`)); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, [id]);
  const act = async (path, body, msg) => {
    setBusy(true);
    try { await adminRequest('POST', path, body); toast.ok(msg); await load(); } catch (e) { toast.err(e.message); } finally { setBusy(false); }
  };
  if (!d) return <Modal open onClose={onClose} title={t('admin.manageUser')}><LoadingBlock text={t('common.loading')} /></Modal>;
  const wallet = d.wallet || {};
  const sub = d.subscription;
  return (
    <Modal open onClose={onClose} title={`${t('admin.manageUser')} — ${d.user.username}`} wide>
      <div className="grid cols-2" style={{ gap: 14 }}>
        <div className="card pad-sm" style={{ background: 'rgba(124,92,255,0.06)' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('admin.user')}</div>
          <div style={{ fontWeight: 700, margin: '4px 0' }}>{d.user.username}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{d.user.email} · {t('admin.verified')}: {d.user.email_verified ? '✓' : '—'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{t('admin.joined')}: {new Date(d.user.created_at).toLocaleString()} · {t('admin.sessions')}: {d.user.sessions} · {t('admin.records')}: {d.user.records}</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <div><span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{t('admin.balance')}</span><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{wallet.balance}</div></div>
            <div><span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{t('admin.lifetimeGranted')}</span><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{wallet.lifetime_granted}</div></div>
            <div><span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{t('admin.lifetimeSpent')}</span><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{wallet.lifetime_spent}</div></div>
          </div>
          <div style={{ marginTop: 10, fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-faint)' }}>{t('admin.currentPlan')}:</span>{' '}
            <strong>{sub ? `${sub.plan_name}${sub.is_free ? ' (free)' : ''}` : '—'}</strong>
          </div>
        </div>

        <div className="card pad-sm">
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 8 }}>{t('admin.adjustCredits')}</div>
          <div className="grid cols-2">
            <div className="field"><label>{t('admin.creditAmount')}</label><input className="input" type="number" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} /></div>
            <div className="field"><label>{t('admin.creditReason')}</label><input className="input" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="compensation, promo…" maxLength={200} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !creditAmt} onClick={() => act(`/users/${id}/credits`, { delta: Math.abs(Number(creditAmt)), reason: creditReason }, t('admin.creditsGranted'))}>+ {t('admin.give')}</button>
            <button className="btn btn-danger btn-sm" disabled={busy || !creditAmt} onClick={() => act(`/users/${id}/credits`, { delta: -Math.abs(Number(creditAmt)), reason: creditReason }, t('admin.creditsDeducted'))}>− {t('admin.take')}</button>
          </div>
        </div>

        <div className="card pad-sm">
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 8 }}>{t('admin.changePlan')}</div>
          <div className="field"><label>{t('admin.plan')}</label>
            <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">{t('admin.choosePlan')}</option>
              {d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_free ? ' (free)' : ''} — {p.monthly_credits} cr</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !planId} onClick={() => act(`/users/${id}/plan`, { plan_id: Number(planId) }, t('admin.planChanged'))}>{t('admin.applyPlan')}</button>
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 8 }}>{t('admin.verifyEmail')}</div>
            <button className="btn btn-ghost btn-sm" disabled={busy || d.user.email_verified} onClick={() => act(`/users/${id}/verify-email`, {}, t('admin.emailVerified'))}>
              {d.user.email_verified ? '✓' : ''} {t('admin.markVerified')}
            </button>
          </div>
        </div>

        <div className="card pad-sm">
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 8 }}>{t('admin.resetPassword')}</div>
          <div className="field"><label>{t('admin.newPassword')}</label><input className="input" type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} minLength={8} placeholder="min 8 characters" /></div>
          <button className="btn btn-ghost btn-sm" disabled={busy || newPass.length < 8} onClick={() => { if (confirm(t('admin.confirmResetPassword'))) act(`/users/${id}/password`, { new_password: newPass }, t('admin.passwordReset')); }}>{t('admin.resetPassword')}</button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 8 }}>{t('admin.creditLedger')}</div>
        {d.ledger.length === 0 ? <EmptyState icon="💳" title={t('admin.noLedger')} text={t('admin.noLedgerText')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('admin.date')}</th><th>{t('admin.change')}</th><th>{t('admin.balance')}</th><th>{t('admin.reason')}</th></tr></thead>
              <tbody>
                {d.ledger.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontSize: '0.78rem' }}>{new Date(l.created_at).toLocaleString()}</td>
                    <td style={{ color: l.delta >= 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{l.delta >= 0 ? `+${l.delta}` : l.delta}</td>
                    <td>{l.balance_after}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Games() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = async () => {
    try { setRows((await adminRequest('GET', '/games')).games); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    const body = { name: edit.name, slug: edit.slug, genre: edit.genre, publisher: edit.publisher, description: edit.description, release_year: edit.release_year, cover_color: edit.cover_color, enabled: edit.enabled };
    try {
      if (edit.id) await adminRequest('PATCH', `/games/${edit.id}`, body);
      else await adminRequest('POST', '/games', body);
      toast.ok(t('admin.gameSaved'));
      setEdit(null);
      load();
    } catch (e) { toast.err(e.message); }
  };
  const del = async (id) => {
    try { await adminRequest('DELETE', `/games/${id}`); toast.ok(t('admin.gameDeleted')); load(); } catch (e) { toast.err(e.message); }
  };
  return (
    <Card>
      <CardHead title={<>🎮 {t('admin.games')}</>}>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit({ id: null, name: '', slug: '', genre: '', publisher: '', release_year: '', description: '', cover_color: '#7c5cff', enabled: true })}>+ {t('admin.new')}</button>
      </CardHead>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('admin.name')}</th><th>{t('admin.genre')}</th><th>{t('admin.year')}</th><th>{t('admin.enabled')}</th><th></th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: g.cover_color || '#444', display: 'inline-block' }} />{g.name}</div></td>
                <td>{g.genre || '—'}</td>
                <td>{g.release_year || '—'}</td>
                <td>{g.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}</td>
                <td>
                  <div className="pill-row">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit(g)}>{t('admin.edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`${t('admin.deleteGame')} ${g.name}?`)) del(g.id); }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? t('admin.editGame') : t('admin.newGame')}>
          <div className="grid cols-2">
            <div className="field"><label>{t('admin.name')} *</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label>{t('admin.slug')} *</label><input className="input" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></div>
            <div className="field"><label>{t('admin.genre')}</label><input className="input" value={edit.genre} onChange={(e) => setEdit({ ...edit, genre: e.target.value })} /></div>
            <div className="field"><label>{t('admin.publisher')}</label><input className="input" value={edit.publisher} onChange={(e) => setEdit({ ...edit, publisher: e.target.value })} /></div>
            <div className="field"><label>{t('admin.releaseYear')}</label><input className="input" value={edit.release_year} onChange={(e) => setEdit({ ...edit, release_year: e.target.value })} /></div>
            <div className="field"><label>{t('admin.coverColor')}</label><input className="input" type="color" value={edit.cover_color} onChange={(e) => setEdit({ ...edit, cover_color: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t('admin.description')}</label><textarea className="input" rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> {t('admin.enabled')}</label>
          <button className="btn btn-primary btn-block" onClick={save}>{t('admin.save')}</button>
        </Modal>
      )}
    </Card>
  );
}

function Hardware() {
  const toast = useToast();
  const { t } = useI18n();
  const [cat, setCat] = useState('cpus');
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(false);
  const [item, setItem] = useState(null);
  const load = async () => {
    try { setRows((await adminRequest('GET', `/hardware/${cat}`)).items); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, [cat]);
  const save = async () => {
    const body = { ...item };
    if (item.name === undefined || item.name === '') return toast.err(t('admin.nameRequired'));
    try {
      if (item.id) await adminRequest('PATCH', `/hardware/${cat}/${item.id}`, body);
      else await adminRequest('POST', `/hardware/${cat}`, body);
      toast.ok(t('admin.itemSaved'));
      setEditing(false);
      setItem(null);
      load();
    } catch (e) { toast.err(e.message); }
  };
  const del = async (id) => {
    try { await adminRequest('DELETE', `/hardware/${cat}/${id}`); toast.ok(t('admin.itemDeleted')); load(); } catch (e) { toast.err(e.message); }
  };
  const keys = item ? Object.keys(item).filter((k) => !['id', 'created_at', 'price_date', 'source_id'].includes(k)) : [];
  return (
    <Card>
      <CardHead title={<>🗄️ {t('admin.hardware')}</>}>
        <button className="btn btn-primary btn-sm" onClick={() => setItem({ name: '', enabled: 1 })}>+ {t('admin.new')}</button>
      </CardHead>
      <div className="chip-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {HW_CATEGORIES.map((c) => <button key={c} className={`chip ${cat === c ? 'chip-on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('admin.hwId')}</th><th>{t('admin.name')}</th><th>{t('admin.price')}</th><th>{t('admin.enabled')}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>{r.price_usd ? `$${r.price_usd}` : '—'}</td>
                <td>{r.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}</td>
                <td>
                  <div className="pill-row">
                    <button className="btn btn-ghost btn-sm" onClick={() => setItem({ ...r })}>{t('admin.edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`${t('admin.deleteItem')} ${r.name}?`)) del(r.id); }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item && (
        <Modal open onClose={() => setItem(null)} title={item.id ? t('admin.editItem') : t('admin.newItem')}>
          <div className="grid cols-2">
            {keys.map((k) => (
              <div className="field" key={k}>
                <label>{k}</label>
                <input className="input" value={item[k] ?? ''} onChange={(e) => setItem({ ...item, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}><input type="checkbox" checked={item.enabled === 1 || item.enabled === true} onChange={(e) => setItem({ ...item, enabled: e.target.checked })} /> {t('admin.enabled')}</label>
          <button className="btn btn-primary btn-block" onClick={save}>{t('admin.save')}</button>
        </Modal>
      )}
    </Card>
  );
}

function Compatibility() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = async () => {
    try { setRows((await adminRequest('GET', '/compatibility')).rules); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    const body = { rule_type: edit.rule_type, subject: edit.subject, allowed_values: String(edit.allowed_values || '').split(',').map((s) => s.trim()).filter(Boolean), severity: edit.severity, note: edit.note, enabled: edit.enabled };
    try {
      if (edit.id) await adminRequest('PATCH', `/compatibility/${edit.id}`, body);
      else await adminRequest('POST', '/compatibility', body);
      toast.ok(t('admin.ruleSaved'));
      setEdit(null);
      load();
    } catch (e) { toast.err(e.message); }
  };
  const del = async (id) => {
    try { await adminRequest('DELETE', `/compatibility/${id}`); toast.ok(t('admin.itemDeleted')); load(); } catch (e) { toast.err(e.message); }
  };
  return (
    <Card>
      <CardHead title={<>✅ {t('admin.compatRules')}</>}>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit({ id: null, rule_type: '', subject: '', allowed_values: '', severity: 'error', note: '', enabled: true })}>+ {t('admin.new')}</button>
      </CardHead>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('admin.ruleType')}</th><th>{t('admin.subject')}</th><th>{t('admin.allowed')}</th><th>{t('admin.severity')}</th><th>{t('admin.note')}</th><th>{t('admin.enabled')}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.rule_type}</td><td>{r.subject}</td>
                <td>{(r.allowed_values || '').slice(0, 40)}</td>
                <td><Badge tone={r.severity === 'error' ? 'err' : r.severity === 'warn' ? 'warn' : 'info'}>{r.severity}</Badge></td>
                <td>{r.note || '—'}</td>
                <td>{r.enabled ? '✓' : '—'}</td>
                <td>
                  <div className="pill-row">
                    <button className="btn btn-ghost btn-sm" onClick={() => { let vals = r.allowed_values; if (Array.isArray(vals)) vals = vals.join(', '); else if (typeof vals === 'string') { try { vals = JSON.parse(vals).join(', '); } catch { /* keep raw */ } } setEdit({ ...r, allowed_values: vals }); }}>{t('admin.edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(t('admin.deleteRule'))) del(r.id); }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? t('admin.editRule') : t('admin.newRule')}>
          <div className="field"><label>{t('admin.ruleType')}</label><input className="input" value={edit.rule_type} onChange={(e) => setEdit({ ...edit, rule_type: e.target.value })} /></div>
          <div className="field"><label>{t('admin.subject')}</label><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></div>
          <div className="field"><label>{t('admin.allowedValues')}</label><input className="input" value={edit.allowed_values} onChange={(e) => setEdit({ ...edit, allowed_values: e.target.value })} /></div>
          <div className="field"><label>{t('admin.severity')}</label>
            <select className="select" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>
              <option value="error">error</option><option value="warn">warn</option><option value="info">info</option>
            </select>
          </div>
          <div className="field"><label>{t('admin.note')}</label><input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> {t('admin.enabled')}</label>
          <button className="btn btn-primary btn-block" onClick={save}>{t('admin.save')}</button>
        </Modal>
      )}
    </Card>
  );
}

function benchStatusTone(s) {
  if (s === 'approved') return 'ok';
  if (s === 'rejected') return 'err';
  if (s === 'hidden') return 'warn';
  return 'info';
}

function Benchmarks() {
  const toast = useToast();
  const { t } = useI18n();
  const [sub, setSub] = useState('anchors');
  const [rows, setRows] = useState([]);
  const load = async () => {
    try { setRows((await adminRequest('GET', '/benchmarks')).benchmarks); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { if (sub === 'anchors') load(); }, [sub]);
  const del = async (id) => {
    try { await adminRequest('DELETE', `/benchmarks/${id}`); toast.ok(t('admin.itemDeleted')); load(); } catch (e) { toast.err(e.message); }
  };

  // community moderation queue
  const [comm, setComm] = useState(null);
  const [cStatus, setCStatus] = useState('pending');
  const [cQ, setCQ] = useState('');
  const [loadingComm, setLoadingComm] = useState(false);
  const loadComm = async (status = cStatus, q = cQ) => {
    setLoadingComm(true);
    try {
      const p = new URLSearchParams();
      if (status && status !== 'all') p.set('status', status);
      if (q) p.set('q', q);
      const qs = p.toString();
      setComm(await adminRequest('GET', `/community/benchmarks${qs ? `?${qs}` : ''}`));
    } catch (e) { toast.err(e.message); }
    finally { setLoadingComm(false); }
  };
  useEffect(() => { if (sub === 'community') loadComm(); }, [sub]);

  const review = async (id, status) => {
    let review_note;
    if (status === 'rejected' || status === 'hidden') {
      review_note = window.prompt(t('admin.cben.reviewNote'), '');
      if (review_note === null) return;
    }
    try {
      await adminRequest('PATCH', `/community/benchmarks/${id}/status`, { status, review_note });
      toast.ok(t('admin.cben.reviewSaved'));
      loadComm();
    } catch (e) { toast.err(e.message); }
  };
  const promote = async (r) => {
    if (!window.confirm(t('admin.cben.promoteConfirm'))) return;
    try { await adminRequest('POST', `/community/benchmarks/${r.id}/promote`); toast.ok(t('admin.cben.promoted')); loadComm(); }
    catch (e) { toast.err(e.message); }
  };

  const cmChp = (v, label) => (
    <button key={v} className={`chip ${cStatus === v ? 'chip-on' : ''}`} onClick={() => { setCStatus(v); loadComm(v, cQ); }}>{label}</button>
  );

  return (
    <Card>
      <CardHead title={<>{t('admin.benchTitle')}</>}>
        <div className="chip-row">
          <button className={`chip ${sub === 'anchors' ? 'chip-on' : ''}`} onClick={() => setSub('anchors')}>{t('admin.benchSubAnchors')}</button>
          <button className={`chip ${sub === 'community' ? 'chip-on' : ''}`} onClick={() => setSub('community')}>
            {t('admin.benchSubCommunity')} {comm?.counts ? <b>({comm.counts.pending})</b> : ''}
          </button>
        </div>
      </CardHead>

      {sub === 'anchors' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.game')}</th><th>GPU</th><th>CPU</th><th>{t('admin.res')}</th><th>{t('admin.quality')}</th><th>FPS</th><th>1% low</th><th>{t('admin.date')}</th><th>{t('admin.verified')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.game_name}</td><td>{b.gpu_name}</td><td>{b.cpu_name || '—'}</td><td>{b.resolution}</td><td>{b.quality}</td>
                  <td><b>{b.avg_fps}</b></td><td>{b.pct1_low ?? '—'}</td><td>{b.benchmark_date}</td>
                  <td>{b.verified ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => { if (confirm(t('admin.deleteBenchmark'))) del(b.id); }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'community' && (
        <>
          <div className="chip-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {cmChp('all', t('admin.cben.filterAll'))}
            {['pending', 'approved', 'hidden', 'rejected'].map((s) => cmChp(s, `${t(`admin.cben.st.${s}`)}${comm?.counts ? ` (${comm.counts[s]})` : ''}`))}
            <input className="input" style={{ width: 220, marginLeft: 'auto' }} value={cQ}
              placeholder={t('admin.cben.search')} onChange={(e) => setCQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setCStatus('all'); loadComm('all', cQ); } }} />
          </div>
          {loadingComm ? <div style={{ padding: 20 }}><Spinner /></div> : !comm?.rows?.length ? (
            <EmptyState title={t('admin.cben.empty')} text={t('admin.cben.emptyText')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>#</th><th>{t('admin.cben.who')}</th><th>{t('admin.game')}</th><th>GPU</th><th>CPU</th>
                  <th>{t('admin.res')}</th><th>{t('admin.quality')}</th><th>FPS</th><th>1% low</th><th>{t('admin.cben.method')}</th>
                  <th>{t('admin.cben.status')}</th><th>{t('admin.date')}</th><th>{t('admin.cben.actions')}</th>
                </tr></thead>
                <tbody>
                  {comm.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.display_name || r.username}</td>
                      <td>{r.game_name}</td><td>{r.gpu_name}</td><td>{r.cpu_name || '—'}</td>
                      <td>{r.resolution}{r.rt_enabled ? ' RT' : ''}</td><td>{r.quality}</td>
                      <td><b>{r.avg_fps}</b></td><td>{r.pct1_low ?? '—'}</td>
                      <td style={{ fontSize: '0.72rem' }}>{t(`admin.cben.mtd.${r.fps_method}`)}</td>
                      <td><Badge tone={benchStatusTone(r.status)}>{t(`admin.cben.st.${r.status}`)}</Badge></td>
                      <td>{String(r.created_at || '').slice(0, 10)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.status !== 'approved' && <button className="btn btn-sm" style={{ background: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.4)', color: '#6ee7b7' }} onClick={() => review(r.id, 'approved')}>{t('admin.cben.approve')}</button>}
                          {r.status !== 'rejected' && <button className="btn btn-danger btn-sm" onClick={() => review(r.id, 'rejected')}>{t('admin.cben.reject')}</button>}
                          {r.status !== 'hidden' && <button className="btn btn-sm" onClick={() => review(r.id, 'hidden')}>{t('admin.cben.hide')}</button>}
                          {r.status === 'approved' && !r.promoted && <button className="btn btn-primary btn-sm" onClick={() => promote(r)}>{t('admin.cben.promote')}</button>}
                          {r.promoted ? <Badge tone="ok">{t('admin.cben.promotedTag')}</Badge> : null}
                        </div>
                        {r.review_note && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 4 }}>{r.review_note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function emptyOffer() {
  return { name: '', code: '', description: '', discount_type: 'percent', discount_value: '10', plan_id: '', starts_at: '', ends_at: '', max_redemptions: '', is_active: true };
}

function emptyPlan() {
  return { name: '', slug: '', tagline: '', price_sek: '99', monthly_credits: '400', featuresText: '', is_featured: false, is_active: true, is_free: false };
}

function PlansBilling() {
  const toast = useToast();
  const { t } = useI18n();
  const [stats, setStats] = useState(null);
  const [plans, setPlans] = useState([]);
  const [offers, setOffers] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [payouts, setPayouts] = useState(null);
  const [edit, setEdit] = useState(null);
  const [creating, setCreating] = useState(null);
  const [offerForm, setOfferForm] = useState(null);
  const [grant, setGrant] = useState({ userId: '', amount: '25' });
  const [bank, setBank] = useState({ iban: '', bic: '', accountName: '', bankName: '' });
  const [payoutAmount, setPayoutAmount] = useState('');
  const [stripeForm, setStripeForm] = useState({ secretKey: '', publishableKey: '', webhookSecret: '' });
  const [stripeInfo, setStripeInfo] = useState(null);

  const load = async () => {
    try {
      const [s, o, r, p, sk] = await Promise.all([
        adminRequest('GET', '/billing-stats'),
        adminRequest('GET', '/offers'),
        adminRequest('GET', '/refunds'),
        adminRequest('GET', '/payouts'),
        adminRequest('GET', '/stripe-keys'),
      ]);
      setStats(s);
      setPlans(s.plans || []);
      setOffers(o.offers || []);
      setRefunds(r.refunds || []);
      setPayouts(p);
      setStripeInfo(sk);
      setBank({
        iban: p.bank?.iban || '',
        bic: p.bank?.bic || '',
        accountName: p.bank?.accountName || '',
        bankName: p.bank?.bankName || '',
      });
    } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, []);

  const savePlan = async () => {
    try {
      const features = String(edit.featuresText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      await adminRequest('PUT', `/plans/${edit.id}`, {
        name: edit.name,
        tagline: edit.tagline,
        price_sek: Number(edit.price_sek),
        monthly_credits: Number(edit.monthly_credits),
        is_featured: edit.is_featured ? 1 : 0,
        is_active: edit.is_active ? 1 : 0,
        features,
      });
      toast.ok(t('admin.planSaved'));
      setEdit(null);
      load();
    } catch (e) { toast.err(e.message); }
  };

  const createPlan = async () => {
    try {
      const features = String(creating.featuresText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      await adminRequest('POST', '/plans', {
        name: creating.name,
        slug: creating.slug,
        tagline: creating.tagline,
        price_sek: Number(creating.price_sek),
        monthly_credits: Number(creating.monthly_credits),
        is_featured: creating.is_featured ? 1 : 0,
        is_active: creating.is_active ? 1 : 0,
        is_free: creating.is_free ? 1 : 0,
        features,
      });
      toast.ok(t('admin.planCreated'));
      setCreating(null);
      load();
    } catch (e) { toast.err(e.message); }
  };

  const saveOffer = async () => {
    try {
      const body = {
        name: offerForm.name,
        code: offerForm.code,
        description: offerForm.description,
        discount_type: offerForm.discount_type,
        discount_value: Number(offerForm.discount_value),
        plan_id: offerForm.plan_id || null,
        starts_at: offerForm.starts_at || null,
        ends_at: offerForm.ends_at || null,
        max_redemptions: offerForm.max_redemptions || null,
        is_active: offerForm.is_active ? 1 : 0,
      };
      if (offerForm.id) await adminRequest('PUT', `/offers/${offerForm.id}`, body);
      else await adminRequest('POST', '/offers', body);
      toast.ok(t('admin.offerSaved'));
      setOfferForm(null);
      load();
    } catch (e) { toast.err(e.message); }
  };

  const processRefund = async (id, action) => {
    try {
      await adminRequest('POST', `/refunds/${id}/process`, { action });
      toast.ok(action === 'reject' ? t('admin.refundRejected') : t('admin.refundApproved'));
      load();
    } catch (e) { toast.err(e.message); }
  };

  const refundPayment = async (id) => {
    try {
      await adminRequest('POST', `/payments/${id}/refund`, { reason: 'admin_refund' });
      toast.ok(t('admin.refundApproved'));
      load();
    } catch (e) { toast.err(e.message); }
  };

  const saveBank = async () => {
    try {
      await adminRequest('PUT', '/payout-account', bank);
      toast.ok(t('admin.bankSaved'));
      load();
    } catch (e) { toast.err(e.message); }
  };

  const requestPayout = async () => {
    try {
      await adminRequest('POST', '/payouts', { amount_sek: Number(payoutAmount) });
      toast.ok(t('admin.payoutRequested'));
      setPayoutAmount('');
      load();
    } catch (e) { toast.err(e.message); }
  };

  const completePayout = async (id) => {
    try {
      await adminRequest('POST', `/payouts/${id}/complete`, {});
      toast.ok(t('admin.payoutCompleted'));
      load();
    } catch (e) { toast.err(e.message); }
  };

  const saveStripeKeys = async () => {
    try {
      const body = {};
      if (stripeForm.secretKey.trim()) body.secretKey = stripeForm.secretKey.trim();
      if (stripeForm.publishableKey.trim()) body.publishableKey = stripeForm.publishableKey.trim();
      if (stripeForm.webhookSecret.trim()) body.webhookSecret = stripeForm.webhookSecret.trim();
      const r = await adminRequest('PUT', '/stripe-keys', body);
      toast.ok(t('admin.stripeSaved'));
      setStripeForm({ secretKey: '', publishableKey: '', webhookSecret: '' });
      setStripeInfo(r);
      load();
    } catch (e) { toast.err(e.message); }
  };

  const grantCredits = async () => {
    try {
      await adminRequest('POST', '/credits/grant', { userId: Number(grant.userId), amount: Number(grant.amount) });
      toast.ok(t('admin.creditsGranted'));
      setGrant({ userId: '', amount: '25' });
      load();
    } catch (e) { toast.err(e.message); }
  };

  if (!stats) return <LoadingBlock text={t('common.loading')} />;
  const available = payouts?.revenue?.available ?? 0;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-4">
        <Stat label={t('admin.paidSubs')} value={stats.paidActive} />
        <Stat label={t('admin.revenueAll')} value={`${stats.revenuePaid} kr`} />
        <Stat label={t('admin.revenueMonth')} value={`${stats.revenueMonth} kr`} />
        <Stat label={t('admin.creditsSpent')} value={stats.wallets?.spent ?? 0} />
      </div>
      <div className="grid cols-4">
        <Stat label={t('admin.netRevenue')} value={`${stats.revenue?.net ?? available} kr`} />
        <Stat label={t('admin.availablePayout')} value={`${available} kr`} />
        <Stat label={t('admin.pendingRefunds')} value={stats.pendingRefunds ?? 0} />
        <Stat label={t('admin.stripeStatus')} value={stats.stripeConfigured ? t('admin.configured') : t('admin.notConfigured')} />
      </div>
      <Card>
        <CardHead title={t('admin.stripeKeysTitle')} />
        <p className="pricing-note">{t('admin.stripeKeysHelp')}</p>
        <p className="pricing-note">
          {t('admin.secretKey')}: {stripeInfo?.stripe?.secretMasked || t('admin.notConfigured')}
          {' · '}
          {t('admin.publishableKey')}: {stripeInfo?.stripe?.publishableMasked || t('admin.notConfigured')}
          {' · '}
          {t('admin.webhookSecret')}: {stripeInfo?.stripe?.webhookMasked || t('admin.notConfigured')}
        </p>
        <div className="field">
          <label>{t('admin.secretKey')}</label>
          <input className="input" type="password" autoComplete="off" placeholder={stripeInfo?.stripe?.secretMasked || 'sk_test_...'} value={stripeForm.secretKey} onChange={(e) => setStripeForm({ ...stripeForm, secretKey: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('admin.publishableKey')}</label>
          <input className="input" type="password" autoComplete="off" placeholder={stripeInfo?.stripe?.publishableMasked || 'pk_test_...'} value={stripeForm.publishableKey} onChange={(e) => setStripeForm({ ...stripeForm, publishableKey: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('admin.webhookSecret')}</label>
          <input className="input" type="password" autoComplete="off" placeholder={stripeInfo?.stripe?.webhookMasked || 'whsec_...'} value={stripeForm.webhookSecret} onChange={(e) => setStripeForm({ ...stripeForm, webhookSecret: e.target.value })} />
        </div>
        <button className="btn btn-primary" onClick={saveStripeKeys}>{t('admin.saveStripeKeys')}</button>
      </Card>
      <Card>
        <CardHead title={t('admin.plansTitle')}>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(emptyPlan())}>{t('admin.newPlan')}</button>
        </CardHead>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.planName')}</th><th>{t('pricing.price')}</th><th>{t('pricing.credits')}</th><th>{t('admin.subscribers')}</th><th>{t('admin.articleStatus')}</th><th /></tr></thead>
            <tbody>
              {plans.map((p) => {
                const subs = stats.byPlan?.find((x) => x.id === p.id)?.subscribers || 0;
                return (
                  <tr key={p.id}>
                    <td>{p.name}{p.is_featured ? <Badge>{t('pricing.popular')}</Badge> : null}</td>
                    <td>{p.price_sek} kr</td>
                    <td>{p.monthly_credits}</td>
                    <td>{subs}</td>
                    <td>{p.is_active ? t('admin.active') : t('admin.inactive')}</td>
                    <td><button className="btn btn-sm" onClick={() => setEdit({ ...p, featuresText: (p.features || []).join('\n') })}>{t('common.edit')}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHead title={t('admin.offersTitle')}>
          <button className="btn btn-primary btn-sm" onClick={() => setOfferForm(emptyOffer())}>{t('admin.newOffer')}</button>
        </CardHead>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.offerName')}</th><th>{t('pricing.offerCode')}</th><th>{t('admin.discount')}</th><th>{t('admin.articleStatus')}</th><th /></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.code || '-'}</td>
                  <td>{o.discount_type === 'fixed' ? `${o.discount_value} kr` : `${o.discount_value}%`}</td>
                  <td>{o.is_active ? t('admin.active') : t('admin.inactive')}</td>
                  <td><button className="btn btn-sm" onClick={() => setOfferForm({ ...o, plan_id: o.plan_id || '', starts_at: o.starts_at || '', ends_at: o.ends_at || '', max_redemptions: o.max_redemptions || '' })}>{t('common.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHead title={t('admin.refundsTitle')} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.user')}</th><th>{t('admin.planName')}</th><th>{t('pricing.price')}</th><th>{t('admin.articleStatus')}</th><th /></tr></thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td>{r.username}</td>
                  <td>{r.plan_name}</td>
                  <td>{r.amount_sek} kr</td>
                  <td>{r.status}</td>
                  <td>
                    {r.status === 'pending' && (
                      <div className="pill-row">
                        <button className="btn btn-sm btn-primary" onClick={() => processRefund(r.id, 'approve')}>{t('admin.approve')}</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => processRefund(r.id, 'reject')}>{t('admin.reject')}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid cols-2">
        <Card>
          <CardHead title={t('admin.recentPayments')} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('admin.user')}</th><th>{t('admin.planName')}</th><th>{t('pricing.price')}</th><th>{t('pricing.method')}</th><th>{t('admin.articleStatus')}</th><th /></tr></thead>
              <tbody>
                {(stats.recentPayments || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.username}</td>
                    <td>{p.plan_name}</td>
                    <td>{p.amount_sek} kr</td>
                    <td>{p.method}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.status === 'paid' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => refundPayment(p.id)}>{t('pricing.requestRefund')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHead title={t('admin.grantCredits')} />
          <div className="field"><label>{t('admin.userId')}</label><input className="input" value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.credits')}</label><input className="input" type="number" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={grantCredits}>{t('admin.grant')}</button>
        </Card>
      </div>
      <div className="grid cols-2">
        <Card>
          <CardHead title={t('admin.payoutAccount')} />
          <div className="field"><label>{t('admin.iban')}</label><input className="input" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} /></div>
          <div className="field"><label>{t('admin.bic')}</label><input className="input" value={bank.bic} onChange={(e) => setBank({ ...bank, bic: e.target.value })} /></div>
          <div className="field"><label>{t('admin.accountName')}</label><input className="input" value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} /></div>
          <div className="field"><label>{t('admin.bankName')}</label><input className="input" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={saveBank}>{t('admin.saveBank')}</button>
        </Card>
        <Card>
          <CardHead title={t('admin.payoutsTitle')} />
          <p className="pricing-note">{t('admin.availablePayout')}: {available} kr</p>
          <div className="field"><label>{t('admin.payoutAmount')}</label><input className="input" type="number" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={requestPayout}>{t('admin.requestPayout')}</button>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>{t('pricing.price')}</th><th>{t('admin.articleStatus')}</th><th /></tr></thead>
              <tbody>
                {(payouts?.payouts || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.amount_sek} kr</td>
                    <td>{p.status}</td>
                    <td>
                      {p.status === 'processing' && (
                        <button className="btn btn-sm" onClick={() => completePayout(p.id)}>{t('admin.markPaid')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={t('admin.editPlan')}>
          <div className="field"><label>{t('admin.planName')}</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.tagline')}</label><input className="input" value={edit.tagline} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.priceSek')}</label><input className="input" type="number" value={edit.price_sek} onChange={(e) => setEdit({ ...edit, price_sek: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.monthlyCredits')}</label><input className="input" type="number" value={edit.monthly_credits} onChange={(e) => setEdit({ ...edit, monthly_credits: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.features')}</label><textarea className="input" rows={6} value={edit.featuresText} onChange={(e) => setEdit({ ...edit, featuresText: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 8, marginBottom: 8 }}><input type="checkbox" checked={!!edit.is_featured} onChange={(e) => setEdit({ ...edit, is_featured: e.target.checked })} /> {t('pricing.popular')}</label>
          <label style={{ display: 'flex', gap: 8, marginBottom: 12 }}><input type="checkbox" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> {t('admin.active')}</label>
          <button className="btn btn-primary" onClick={savePlan}>{t('common.save')}</button>
        </Modal>
      )}
      {creating && (
        <Modal open onClose={() => setCreating(null)} title={t('admin.newPlan')}>
          <div className="field"><label>{t('admin.planName')}</label><input className="input" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></div>
          <div className="field"><label>{t('admin.planSlug')}</label><input className="input" value={creating.slug} onChange={(e) => setCreating({ ...creating, slug: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.tagline')}</label><input className="input" value={creating.tagline} onChange={(e) => setCreating({ ...creating, tagline: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.priceSek')}</label><input className="input" type="number" value={creating.price_sek} onChange={(e) => setCreating({ ...creating, price_sek: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.monthlyCredits')}</label><input className="input" type="number" value={creating.monthly_credits} onChange={(e) => setCreating({ ...creating, monthly_credits: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.features')}</label><textarea className="input" rows={6} value={creating.featuresText} onChange={(e) => setCreating({ ...creating, featuresText: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 8, marginBottom: 8 }}><input type="checkbox" checked={!!creating.is_featured} onChange={(e) => setCreating({ ...creating, is_featured: e.target.checked })} /> {t('pricing.popular')}</label>
          <label style={{ display: 'flex', gap: 8, marginBottom: 12 }}><input type="checkbox" checked={!!creating.is_active} onChange={(e) => setCreating({ ...creating, is_active: e.target.checked })} /> {t('admin.active')}</label>
          <button className="btn btn-primary" onClick={createPlan}>{t('common.save')}</button>
        </Modal>
      )}
      {offerForm && (
        <Modal open onClose={() => setOfferForm(null)} title={offerForm.id ? t('admin.editOffer') : t('admin.newOffer')}>
          <div className="field"><label>{t('admin.offerName')}</label><input className="input" value={offerForm.name} onChange={(e) => setOfferForm({ ...offerForm, name: e.target.value })} /></div>
          <div className="field"><label>{t('pricing.offerCode')}</label><input className="input" value={offerForm.code || ''} onChange={(e) => setOfferForm({ ...offerForm, code: e.target.value })} /></div>
          <div className="field"><label>{t('admin.offerDesc')}</label><input className="input" value={offerForm.description || ''} onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })} /></div>
          <div className="field">
            <label>{t('admin.discountType')}</label>
            <select className="input" value={offerForm.discount_type} onChange={(e) => setOfferForm({ ...offerForm, discount_type: e.target.value })}>
              <option value="percent">{t('admin.percent')}</option>
              <option value="fixed">{t('admin.fixedSek')}</option>
            </select>
          </div>
          <div className="field"><label>{t('admin.discountValue')}</label><input className="input" type="number" value={offerForm.discount_value} onChange={(e) => setOfferForm({ ...offerForm, discount_value: e.target.value })} /></div>
          <div className="field">
            <label>{t('admin.planOptional')}</label>
            <select className="input" value={offerForm.plan_id || ''} onChange={(e) => setOfferForm({ ...offerForm, plan_id: e.target.value })}>
              <option value="">{t('admin.allPlans')}</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('admin.startsAt')}</label><input className="input" type="datetime-local" value={offerForm.starts_at || ''} onChange={(e) => setOfferForm({ ...offerForm, starts_at: e.target.value })} /></div>
          <div className="field"><label>{t('admin.endsAt')}</label><input className="input" type="datetime-local" value={offerForm.ends_at || ''} onChange={(e) => setOfferForm({ ...offerForm, ends_at: e.target.value })} /></div>
          <div className="field"><label>{t('admin.maxRedemptions')}</label><input className="input" type="number" value={offerForm.max_redemptions || ''} onChange={(e) => setOfferForm({ ...offerForm, max_redemptions: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 8, marginBottom: 12 }}><input type="checkbox" checked={!!offerForm.is_active} onChange={(e) => setOfferForm({ ...offerForm, is_active: e.target.checked })} /> {t('admin.active')}</label>
          <button className="btn btn-primary" onClick={saveOffer}>{t('common.save')}</button>
        </Modal>
      )}
    </div>
  );
}

function AiConfig() {
  const toast = useToast();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  useEffect(() => {
    adminRequest('GET', '/ai-config').then((r) => { setData(r); setForm(r.settings || {}); }).catch((e) => toast.err(e.message));
  }, []);
  if (!data) return <LoadingBlock text={t('admin.loadingAi')} />;
  const save = async () => {
    try {
      await adminRequest('PUT', '/ai-config', { settings: form });
      toast.ok(t('admin.aiSaved'));
    } catch (e) { toast.err(e.message); }
  };
  return (
    <div className="grid cols-2">
      <Card>
        <CardHead title={<>🤖 {t('admin.aiService')}</>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="settings-row"><span className="k">{t('admin.apiKeyEnv')}</span><span className="v">{data.env.apiKeyConfigured ? t('admin.configured') : t('admin.notConfigured')}</span></div>
          <div className="settings-row"><span className="k">{t('admin.baseUrlEnv')}</span><span className="v">{data.env.baseUrl}</span></div>
          <div className="settings-row"><span className="k">{t('admin.modelEnv')}</span><span className="v">{data.env.model}</span></div>
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 10 }}>{data.note}</p>
      </Card>
      <Card>
        <CardHead title={<>⚙️ {t('admin.aiSettings')}</>} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={form.ai_enabled === '1' || form.ai_enabled === 'true' || form.ai_enabled === true} onChange={(e) => setForm({ ...form, ai_enabled: e.target.checked })} /> {t('admin.enableAi')}
        </label>
        <div className="field"><label>{t('admin.modelOverride')}</label><input className="input" value={form.ai_model || ''} onChange={(e) => setForm({ ...form, ai_model: e.target.value })} placeholder={t('admin.envDefault')} /></div>
        <div className="field"><label>{t('admin.temperature')}</label><input className="input" type="number" step="0.1" min="0" max="1.5" value={form.ai_temperature || ''} onChange={(e) => setForm({ ...form, ai_temperature: e.target.value })} /></div>
        <div className="field"><label>{t('admin.maxTokens')}</label><input className="input" type="number" value={form.ai_max_tokens || ''} onChange={(e) => setForm({ ...form, ai_max_tokens: e.target.value })} /></div>
        <button className="btn btn-primary" onClick={save}>{t('admin.saveSettings')}</button>
      </Card>
    </div>
  );
}

function SteamAdmin() {
  const toast = useToast();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    adminRequest('GET', '/ai-config').then((r) => {
      setData(r);
      setEnabled(Boolean(r.steam?.enabled));
    }).catch((e) => toast.err(e.message));
  };
  useEffect(() => { load(); }, []);
  if (!data) return <LoadingBlock text={t('common.loading')} />;
  const save = async () => {
    setBusy(true);
    try {
      const settings = { steam_enabled: enabled ? '1' : '0' };
      if (apiKey.trim()) settings.steam_api_key = apiKey.trim();
      await adminRequest('PUT', '/ai-config', { settings });
      toast.ok(t('admin.steamSaved'));
      setApiKey('');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };
  const removeKey = async () => {
    setBusy(true);
    try {
      await adminRequest('PUT', '/ai-config', { settings: { steam_api_key: '' } });
      toast.ok(t('admin.steamSaved'));
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid cols-2">
      <Card>
        <CardHead title={<>🟦 {t('admin.steamIntegration')}</>} />
        <div className="settings-row"><span className="k">{t('admin.status')}</span>
          <span className="v">{data.steam.keyConfigured
            ? <Badge tone="ok">{t('admin.configured')}</Badge>
            : <Badge tone="">{t('admin.notConfigured')}</Badge>}
          </span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('admin.steamEnabled')}
        </label>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginBottom: 12 }}>{t('admin.steamHowTo')}</p>
      </Card>
      <Card>
        <CardHead title={<>🔑 {t('admin.steamApiKey')}</>} />
        <div className="field">
          <label>{t('admin.steamApiKey')}</label>
          <input className="input" type="password" autoComplete="off" value={apiKey}
            placeholder={t('admin.steamKeyKeep')}
            onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{t('admin.saveSettings')}</button>
          {data.steam.keyConfigured && data.steam.source === 'database' && (
            <button className="btn btn-ghost" onClick={removeKey} disabled={busy}>{t('admin.steamRemoveKey')}</button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Referrals() {
  const toast = useToast();
  const { t } = useI18n();
  const [form, setForm] = useState({});
  const [stats, setStats] = useState(null);
  const load = async () => {
    try {
      const [cfg, st] = await Promise.all([
        adminRequest('GET', '/ai-config'),
        adminRequest('GET', '/referrals'),
      ]);
      setForm(cfg.settings || {});
      setStats(st);
    } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      await adminRequest('PUT', '/ai-config', {
        settings: {
          referral_enabled: form.referral_enabled ? '1' : '0',
          referral_signup_credits: form.referral_signup_credits || '0',
          referral_subscription_credits: form.referral_subscription_credits || '0',
          referral_discount_percent: form.referral_discount_percent || '0',
          referral_monthly_limit: form.referral_monthly_limit || '0',
          referral_duplicate_protection: form.referral_duplicate_protection ? '1' : '0',
        },
      });
      toast.ok(t('ref.saved'));
      load();
    } catch (e) { toast.err(e.message); }
  };
  return (
    <div className="grid cols-2">
      <Card>
        <CardHead title={<>📣 {t('ref.settings')}</>} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={form.referral_enabled === '1' || form.referral_enabled === 'true' || form.referral_enabled === true} onChange={(e) => setForm({ ...form, referral_enabled: e.target.checked })} /> {t('ref.enabled')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={form.referral_duplicate_protection === '1' || form.referral_duplicate_protection === 'true' || form.referral_duplicate_protection === true} onChange={(e) => setForm({ ...form, referral_duplicate_protection: e.target.checked })} /> {t('ref.dupProtection')}
        </label>
        <div className="grid cols-2">
          <div className="field"><label>{t('ref.signupCredits')}</label><input className="input" type="number" min="0" value={form.referral_signup_credits || ''} onChange={(e) => setForm({ ...form, referral_signup_credits: e.target.value })} /></div>
          <div className="field"><label>{t('ref.subscriptionCredits')}</label><input className="input" type="number" min="0" value={form.referral_subscription_credits || ''} onChange={(e) => setForm({ ...form, referral_subscription_credits: e.target.value })} /></div>
          <div className="field"><label>{t('ref.discountPercent')}</label><input className="input" type="number" min="0" max="100" value={form.referral_discount_percent || ''} onChange={(e) => setForm({ ...form, referral_discount_percent: e.target.value })} /></div>
          <div className="field"><label>{t('ref.monthlyLimit')}</label><input className="input" type="number" min="0" value={form.referral_monthly_limit || ''} onChange={(e) => setForm({ ...form, referral_monthly_limit: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary" onClick={save}>{t('admin.saveSettings')}</button>
      </Card>
      <Card>
        <CardHead title={<>📊 {t('ref.stats')}</>} />
        {!stats ? <LoadingBlock text={t('common.loading')} /> : (
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Stat label={t('ref.total')} value={stats.total} />
              <Stat label={t('ref.signupRewards')} value={stats.signupRewards} />
              <Stat label={t('ref.subscriptionRewards')} value={stats.subscriptionRewards} />
              <Stat label={t('ref.discounts')} value={stats.discounts} />
              <Stat label={t('ref.thisMonth')} value={stats.thisMonth} />
            </div>
            {stats.top.length === 0 ? (
              <EmptyState icon="📣" title={t('ref.noReferralsYet')} text={t('ref.noReferralsText')} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('admin.user')}</th><th>{t('ref.code')}</th><th>{t('ref.total')}</th><th>{t('ref.signups')}</th><th>{t('ref.subscriptions')}</th></tr></thead>
                  <tbody>
                    {stats.top.map((r) => (
                      <tr key={r.id}>
                        <td>{r.username}</td>
                        <td style={{ fontFamily: 'monospace' }}>{r.code}</td>
                        <td>{r.total}</td>
                        <td>{r.signups}</td>
                        <td>{r.subscriptions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Blogs() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = async () => {
    try { setRows((await adminRequest('GET', '/articles')).articles); } catch (e) { toast.err(e.message); }
  };
  useEffect(() => { load(); }, []);
  const empty = { id: null, title: '', slug: '', excerpt: '', content: '', tags: [], cover_color: '#7c5cff', status: 'draft' };
  const save = async () => {
    const body = {
      title: edit.title, slug: edit.slug, excerpt: edit.excerpt, content: edit.content,
      tags: edit.tags, cover_color: edit.cover_color, status: edit.status,
    };
    try {
      if (edit.id) await adminRequest('PATCH', `/articles/${edit.id}`, body);
      else await adminRequest('POST', '/articles', body);
      toast.ok(t('admin.articleSaved'));
      setEdit(null);
      load();
    } catch (e) { toast.err(e.message); }
  };
  const del = async (id) => {
    try { await adminRequest('DELETE', `/articles/${id}`); toast.ok(t('admin.articleDeleted')); load(); } catch (e) { toast.err(e.message); }
  };
  return (
    <Card>
      <CardHead title={<>📝 {t('admin.articles')}</>}>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit(empty)}>+ {t('admin.newArticle')}</button>
      </CardHead>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('admin.title')}</th><th>{t('admin.slug')}</th><th>{t('admin.tags')}</th><th>{t('admin.articleStatus')}</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: a.cover_color || '#444', display: 'inline-block' }} />{a.title}</div></td>
                <td style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{a.slug}</td>
                <td>{(a.tags || []).slice(0, 3).map((tg) => <span key={tg} className="badge badge-primary" style={{ marginRight: 4, fontSize: '0.68rem' }}>{tg}</span>)}</td>
                <td>{a.status === 'published' ? <Badge tone="ok">{t('admin.articlePublished')}</Badge> : <Badge>{t('admin.articleDraft')}</Badge>}</td>
                <td>
                  <div className="pill-row">
                    {a.status === 'published' && <a className="btn btn-ghost btn-sm" href={`/blog/${a.slug}`} target="_blank" rel="noopener noreferrer">{t('admin.articleView')}</a>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...a, tags: a.tags || [] })}>{t('admin.edit')}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`${t('admin.deleteArticle')} ${a.title}?`)) del(a.id); }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? t('admin.editArticle') : t('admin.newArticle')}>
          <div className="grid cols-2">
            <div className="field"><label>{t('admin.title')} *</label><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
            <div className="field"><label>{t('admin.slug')}</label><input className="input" value={edit.slug} placeholder="auto-from-title" onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t('admin.excerpt')}</label><input className="input" value={edit.excerpt} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} /></div>
          <div className="field"><label>{t('admin.articleTags')}</label><input className="input" value={(edit.tags || []).join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="valorant, gpu, 1440p" /></div>
          <div className="field">
            <label>{t('admin.articleContent')} *</label>
            <ArticleEditor value={edit.content} onChange={(md) => setEdit({ ...edit, content: md })} />
          </div>
          <div className="grid cols-2">
            <div className="field"><label>{t('admin.articleStatus')}</label>
              <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="draft">{t('admin.articleDraft')}</option>
                <option value="published">{t('admin.articlePublished')}</option>
              </select>
            </div>
            <div className="field"><label>{t('admin.coverColor')}</label><input className="input" type="color" value={edit.cover_color} onChange={(e) => setEdit({ ...edit, cover_color: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary btn-block" onClick={save}>{t('admin.save')}</button>
        </Modal>
      )}
    </Card>
  );
}

function Messages() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    adminRequest('GET', '/contact-messages').then((r) => setRows(r.messages)).catch((e) => toast.err(e.message));
  }, []);
  const toggleRead = async (m) => {
    try {
      await adminRequest('PATCH', `/contact-messages/${m.id}`, { is_read: m.is_read ? 0 : 1 });
      setRows(rows.map((x) => (x.id === m.id ? { ...x, is_read: x.is_read ? 0 : 1 } : x)));
    } catch (e) { toast.err(e.message); }
  };
  return (
    <Card>
      <CardHead title={<>✉️ {t('admin.messages')}</>} />
      {rows.length === 0 ? (
        <EmptyState text={t('admin.messagesEmpty')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('admin.when')}</th><th>{t('contact.name')}</th><th>{t('contact.email')}</th><th>{t('contact.message')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ opacity: m.is_read ? 0.55 : 1 }}>
                  <td>{new Date(m.created_at).toLocaleString()}</td>
                  <td><b>{m.name}</b></td>
                  <td style={{ fontSize: '0.82rem' }}>{m.email}</td>
                  <td style={{ fontSize: '0.82rem', maxWidth: 340 }}>{m.message}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleRead(m)}>
                      {m.is_read ? t('admin.unread') : t('admin.read')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Audit() {
  const toast = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    adminRequest('GET', '/audit').then((r) => setRows(r.logs)).catch((e) => toast.err(e.message));
  }, []);
  return (
    <Card>
      <CardHead title={<>📜 {t('admin.auditLog')}</>} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('admin.when')}</th><th>{t('admin.admin')}</th><th>{t('admin.action')}</th><th>{t('admin.target')}</th><th>{t('admin.details')}</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>{l.admin_email}</td>
                <td><Badge tone="info">{l.action}</Badge></td>
                <td>{l.target_type}{l.target_id ? ` #${l.target_id}` : ''}</td>
                <td style={{ fontSize: '0.76rem' }}>{l.details || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
