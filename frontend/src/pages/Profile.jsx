import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getGames, getHardwareCategory } from '../api/catalog.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, Modal, EmptyState, useToast, LoadingBlock } from '../components/ui.jsx';

const RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Immortal', 'Radiant', 'Challenger', 'Unranked'];

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [referral, setReferral] = useState(null);
  const [gamesCatalog, setGamesCatalog] = useState([]);
  const [hw, setHw] = useState({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addGame, setAddGame] = useState('');
  const [addRank, setAddRank] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const d = await api.get('/profile');
    setData(d);
    setForm({ ...d.profile });
    api.get('/billing/referral').then((r) => setReferral(r.referral)).catch(() => {});
  };

  useEffect(() => {
    load().catch(() => {});
    getGames().then(setGamesCatalog).catch(() => {});
    Promise.all(['cpus', 'gpus', 'ram', 'storage'].map(async (c) => {
      const items = await getHardwareCategory(c);
      setHw((h) => ({ ...h, [c]: items }));
    })).catch(() => {});
  }, []);

  if (!data) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  const profile = data.profile;
  const achievements = data.achievements || [];
  const earned = achievements.filter((a) => a.earned);
  const pending = achievements.filter((a) => !a.earned);

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/profile', form);
      toast.ok(t('prof.saved'));
      setEditing(false);
      await load();
      await refresh();
    } catch (e) { toast.err(e.message); } finally { setBusy(false); }
  };

  const toggleMain = async (gid) => {
    try {
      await api.patch(`/profile/games/${gid}`, { is_main: true });
      await load();
    } catch (e) { toast.err(e.message); }
  };
  const removeGame = async (gid) => {
    try {
      await api.del(`/profile/games/${gid}`);
      await load();
    } catch (e) { toast.err(e.message); }
  };
  const addGameSubmit = async () => {
    if (!addGame) return;
    try {
      await api.post('/profile/games', { game_id: Number(addGame), rank: addRank || null });
      toast.ok(t('prof.gameAdded'));
      setAddOpen(false);
      setAddGame('');
      setAddRank('');
      await load();
    } catch (e) { toast.err(e.message); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const shareLink = referral?.code ? `${window.location.origin}/signup?ref=${encodeURIComponent(referral.code)}` : '';
  const copyShare = async () => {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>{t('prof.title')}</h1>
          <span className="sub">{t('prof.sub')}</span>
        </div>
        {!editing ? (
          <button className="btn btn-primary" onClick={() => setEditing(true)}>{t('prof.editProfile')}</button>
        ) : (
          <div className="pill-row">
            <button className="btn btn-ghost" onClick={() => { setEditing(false); setForm({ ...profile }); }}>{t('prof.cancel')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? t('prof.saving') : t('prof.save')}</button>
          </div>
        )}
      </div>

      {referral && (
        <Card style={{ marginBottom: 18 }}>
          <CardHead title={<>📣 {t('ref.title')}</>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 4 }}>{t('ref.yourCode')}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-2)' }}>{referral.code}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={copyShare}>{copied ? t('ref.copied') : t('ref.copyLink')}</button>
              <Badge tone="primary">{t('ref.monthlyUsed')}: {referral.monthlyUsed}/{referral.monthlyLimit}</Badge>
            </div>
            {shareLink && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                <input className="input" readOnly value={shareLink} onFocus={(e) => e.target.select()} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div className="card pad-sm" style={{ flex: '1 1 150px', background: 'rgba(124,92,255,0.06)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{referral.invited}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('ref.invited')}</div>
              </div>
              <div className="card pad-sm" style={{ flex: '1 1 150px', background: 'rgba(124,92,255,0.06)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>+{referral.signupCredits}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('ref.perSignup')}</div>
              </div>
              <div className="card pad-sm" style={{ flex: '1 1 150px', background: 'rgba(124,92,255,0.06)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>+{referral.subscriptionCredits}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('ref.perSubscription')}</div>
              </div>
              <div className="card pad-sm" style={{ flex: '1 1 150px', background: 'rgba(124,92,255,0.06)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{referral.discountPercent}%</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('ref.discountForReferee')}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>
              {t('ref.howItWorks')}
              {referral.referredBy && (
                <span style={{ display: 'block', marginTop: 4 }}>
                  {t('ref.referredBy')}: <strong>{referral.referredBy}</strong>
                  {referral.discountApplied
                    ? ` — ${t('ref.discountUsed')}`
                    : ` — ${t('ref.discountAvailable')}`}
                </span>
              )}
            </p>
          </div>
        </Card>
      )}

      <div className="grid cols-3-2">
        <div>
          <Card>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
              <div className="avatar lg ring">{profile.display_name?.charAt(0) || user.username.charAt(0)}</div>
              <div>
                <h2>{profile.display_name || user.username}</h2>
                <div className="pill-row" style={{ marginTop: 6 }}>
                  <Badge tone="primary">{profile.rank || t('common.unranked')}</Badge>
                  {profile.mainGame && <Badge>{profile.mainGame.name}</Badge>}
                  <Badge>{profile.monitor_resolution} @ {profile.refresh_rate}Hz</Badge>
                </div>
              </div>
            </div>

            {!editing ? (
              <div>
                <div className="settings-grid" style={{ marginTop: 8 }}>
                  <div className="settings-row"><span className="k">CPU</span><span className="v">{profile.cpu?.name || t('prof.notSet')}</span></div>
                  <div className="settings-row"><span className="k">GPU</span><span className="v">{profile.gpu?.name || t('prof.notSet')}</span></div>
                  <div className="settings-row"><span className="k">RAM</span><span className="v">{profile.ram?.name || t('prof.notSet')}</span></div>
                  <div className="settings-row"><span className="k">Storage</span><span className="v">{profile.storage?.name || t('prof.notSet')}</span></div>
                  <div className="settings-row"><span className="k">{t('prof.resolution')}</span><span className="v">{profile.monitor_resolution || '—'}</span></div>
                  <div className="settings-row"><span className="k">{t('prof.refreshRate')}</span><span className="v">{profile.refresh_rate ? `${profile.refresh_rate} Hz` : '—'}</span></div>
                  <div className="settings-row"><span className="k">{t('prof.preference')}</span><span className="v" style={{ textTransform: 'capitalize' }}>{profile.performance_preference || '—'}</span></div>
                  <div className="settings-row"><span className="k">{t('prof.currency')}</span><span className="v">{profile.currency || 'USD'}</span></div>
                </div>
                {profile.bio && <p style={{ marginTop: 16, fontSize: '0.92rem' }}>{profile.bio}</p>}
                {profile.gaming_goals && (
                  <div className="card pad-sm" style={{ marginTop: 14, background: 'rgba(124,92,255,0.06)' }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-faint)', fontWeight: 600 }}>🎯 {t('prof.gamingGoals')}</div>
                    <p style={{ fontSize: '0.9rem', marginTop: 4 }}>{profile.gaming_goals}</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="grid cols-2">
                  <div className="field"><label>{t('prof.displayName')}</label><input className="input" value={form.display_name || ''} onChange={set('display_name')} /></div>
                  <div className="field"><label>{t('prof.rank')}</label>
                    <select className="select" value={form.rank || ''} onChange={set('rank')}>
                      <option value="">{t('common.unranked')}</option>
                      {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>{t('prof.mainGame')}</label>
                    <select className="select" value={form.main_game_id || ''} onChange={(e) => setForm({ ...form, main_game_id: Number(e.target.value) || null })}>
                      <option value="">{t('common.none')}</option>
                      {gamesCatalog.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>{t('prof.perfPreference')}</label>
                    <select className="select" value={form.performance_preference || 'balanced'} onChange={set('performance_preference')}>
                      <option value="performance">{t('prof.prefPerf')}</option><option value="balanced">{t('prof.prefBalanced')}</option><option value="quality">{t('prof.prefQuality')}</option>
                    </select>
                  </div>
                  <div className="field"><label>CPU</label>
                    <select className="select" value={form.cpu_id || ''} onChange={(e) => setForm({ ...form, cpu_id: Number(e.target.value) || null })}>
                      <option value="">{t('common.none')}</option>
                      {(hw.cpus || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>GPU</label>
                    <select className="select" value={form.gpu_id || ''} onChange={(e) => setForm({ ...form, gpu_id: Number(e.target.value) || null })}>
                      <option value="">{t('common.none')}</option>
                      {(hw.gpus || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>RAM</label>
                    <select className="select" value={form.ram_id || ''} onChange={(e) => setForm({ ...form, ram_id: Number(e.target.value) || null })}>
                      <option value="">{t('common.none')}</option>
                      {(hw.ram || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Storage</label>
                    <select className="select" value={form.storage_id || ''} onChange={(e) => setForm({ ...form, storage_id: Number(e.target.value) || null })}>
                      <option value="">{t('common.none')}</option>
                      {(hw.storage || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>{t('prof.resolution')}</label>
                    <select className="select" value={form.monitor_resolution || '1080p'} onChange={set('monitor_resolution')}>
                      {['1080p', '1440p', '4K'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>{t('prof.refreshRate')}</label>
                    <select className="select" value={form.refresh_rate || 60} onChange={(e) => setForm({ ...form, refresh_rate: Number(e.target.value) })}>
                      {[60, 120, 144, 165, 240, 360].map((r) => <option key={r} value={r}>{r} Hz</option>)}
                    </select>
                  </div>
                </div>
                <div className="field"><label>{t('prof.bio')}</label><textarea className="input" rows={2} value={form.bio || ''} onChange={set('bio')} /></div>
                <div className="field"><label>{t('prof.gamingGoals')}</label><textarea className="input" rows={2} value={form.gaming_goals || ''} onChange={set('gaming_goals')} /></div>
                <div className="field"><label>{t('prof.currency')}</label>
                  <select className="select" value={form.currency || 'USD'} onChange={set('currency')}>
                    {['USD', 'EUR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  {[['privacy_winrate', t('prof.shareWinrate')], ['privacy_kd', t('prof.shareKd')], ['privacy_gametime', t('prof.shareGametime')], ['privacy_compare', t('prof.allowCompare')], ['notifications_enabled', t('prof.notifications')]].map(([k, label]) => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem' }}>
                      <input type="checkbox" checked={Boolean(form[k])} onChange={set(k)} /> {label}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem' }}>
                    <input type="checkbox" checked={Boolean(form.is_public)} onChange={set('is_public')} />
                    {t('prof.publicProfile')}
                  </label>
                  {Boolean(form.is_public) && data.profile?.profile_slug && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                      {t('prof.publicProfileLink')}: <b style={{ color: 'var(--primary-2)' }}>{window.location.origin}/u/{data.profile.profile_slug}</b>
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Games */}
          <Card style={{ marginTop: 18 }}>
            <CardHead title={<>🎮 {t('prof.yourGames')}</>}>
              <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ {t('prof.addGame')}</button>
            </CardHead>
            {data.games.length === 0 ? (
              <EmptyState icon="🎮" title={t('prof.noGamesYet')} text={t('prof.noGamesText')} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.games.map((g) => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: g.cover_color || '#444' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{g.name} {g.is_main ? <span style={{ color: 'var(--primary-2)', fontSize: '0.75rem' }}>{t('prof.main')}</span> : ''}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{g.genre}{g.rank ? ` · ${g.rank}` : ''}{g.hours ? ` · ${g.hours}h` : ''}</div>
                    </div>
                    {!g.is_main && <button className="btn btn-ghost btn-sm" onClick={() => toggleMain(g.game_id)}>{t('prof.setMain')}</button>}
                    <button className="btn btn-danger btn-sm" onClick={() => removeGame(g.game_id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Achievements */}
        <div>
          <Card>
            <CardHead title={<>🏆 {t('prof.achievements')}</>}>
              <Badge>{earned.length}/{achievements.length} {t('prof.earned')}</Badge>
            </CardHead>
            {achievements.length === 0 && <EmptyState icon="🏆" title={t('prof.noAchievements')} text={t('prof.noAchievementsText')} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {achievements.map((a) => (
                <div key={a.code} style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: a.earned ? 1 : 0.5 }}>
                  <div style={{ fontSize: '1.5rem', filter: a.earned ? 'none' : 'grayscale(1)' }}>{a.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{a.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{a.description}</div>
                  </div>
                  <div style={{ width: 70 }}>
                    <div className="bar"><div style={{ width: `${a.progress}%` }} /></div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-faint)', textAlign: 'center', marginTop: 3 }}>{a.earned ? t('prof.earnedShort') : `${a.progress}%`}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('prof.addGameModal')}>
        <div className="field"><label>{t('prof.game')}</label>
          <select className="select" value={addGame} onChange={(e) => setAddGame(e.target.value)}>
            <option value="">{t('prof.selectGame')}</option>
            {gamesCatalog.filter((g) => !data.games.some((ug) => ug.game_id === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="field"><label>{t('prof.rankOptional')}</label><input className="input" value={addRank} onChange={(e) => setAddRank(e.target.value)} /></div>
        <button className="btn btn-primary btn-block" onClick={addGameSubmit}>{t('prof.add')}</button>
      </Modal>
    </div>
  );
}
