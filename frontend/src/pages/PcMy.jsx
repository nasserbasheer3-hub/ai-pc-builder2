import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, Modal, useToast } from '../components/ui.jsx';
import { PartImage, StoreLinks, RefDate } from '../components/PartAssets.jsx';

const PART_TYPES = ['cpu', 'gpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'];
const TYPE_CAT = {
  cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'ram',
  storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers',
};
const CONFIG_KEYS = {
  cpu: 'cpu_id', gpu: 'gpu_id', motherboard: 'motherboard_id', ram: 'ram_id',
  storage: 'storage_id', psu: 'psu_id', case: 'case_id', cooler: 'cooler_id',
};
const CATEGORIES = ['gaming', 'work', 'future', 'other'];

function labelOf(partType) {
  return { cpu: 'CPU', gpu: 'GPU', motherboard: 'MB', ram: 'RAM', storage: 'SSD', psu: 'PSU', case: 'Case', cooler: 'Cooler' }[partType] || partType;
}

export default function PcMy() {
  const toast = useToast();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState(null); // build being renamed
  const [busy, setBusy] = useState(false);

  const [addForm, setAddForm] = useState({ name: '', category: 'gaming', config: {} });
  const [editForm, setEditForm] = useState({ name: '', category: 'gaming' });

  // upgrade + wishlist forms
  const [upg, setUpg] = useState({ part_type: 'gpu', from_part_id: '', to_part_id: '', upgraded_at: new Date().toISOString().slice(0, 10), note: '' });
  const [wish, setWish] = useState({ part_type: 'gpu', part_id: '', note: '' });

  const load = async () => {
    const d = await api.get('/pc/my');
    setData(d);
  };

  useEffect(() => {
    load().catch((e) => toast.err(e.message));
    Promise.all(Object.values(TYPE_CAT).map(async (cat) => {
      const items = await getHardwareCategory(cat);
      setCatalog((c) => ({ ...c, [cat]: items }));
    })).catch((e) => toast.err(e.message));
  }, []);

  const catList = useMemo(() => (partType) => catalog[TYPE_CAT[partType]] || [], [catalog]);

  const setActive = async (id) => {
    try { await api.patch(`/pc/builds/${id}`, { is_active: true }); await load(); toast.ok(t('pcmy.pcUpdated')); }
    catch (e) { toast.err(e.message); }
  };

  const openEdit = (b) => { setEdit(b); setEditForm({ name: b.name, category: b.category }); };

  const saveEdit = async () => {
    if (!editForm.name.trim()) return toast.err(t('pcmy.requiredName'));
    try {
      await api.patch(`/pc/builds/${edit.id}`, { name: editForm.name.trim(), category: editForm.category });
      toast.ok(t('pcmy.pcUpdated'));
      setEdit(null);
      await load();
    } catch (e) { toast.err(e.message); }
  };

  const addPc = async () => {
    if (!addForm.name.trim()) return toast.err(t('pcmy.requiredName'));
    const config = {};
    for (const k of PART_TYPES) {
      const id = addForm.config[CONFIG_KEYS[k]];
      if (id) config[`${k}_id`] = Number(id);
    }
    if (!Object.keys(config).length) return toast.err(t('pcmy.requiredPart'));
    setBusy(true);
    try {
      await api.post('/pc/builds', { name: addForm.name.trim(), category: addForm.category, config });
      toast.ok(t('pcmy.pcSaved'));
      setAddOpen(false);
      setAddForm({ name: '', category: 'gaming', config: {} });
      await load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const share = async (id) => {
    try {
      const r = await api.post(`/pc/builds/${id}/share`);
      const url = `${window.location.origin}${r.url}`;
      try { await navigator.clipboard.writeText(url); } catch { /* fallback below */ }
      toast.ok(`${t('pcmy.linkCopied')} ${url}`);
    } catch (e) { toast.err(e.message); }
  };

  const deleteBuild = async (id) => {
    try { await api.del(`/pc/builds/${id}`); toast.ok(t('pcmy.pcDeleted')); await load(); }
    catch (e) { toast.err(e.message); }
  };

  const addUpgrade = async () => {
    if (!upg.to_part_id) return toast.err(t('pcmy.requiredPart'));
    if (!upg.upgraded_at) return toast.err(t('pcmy.requiredDate'));
    setBusy(true);
    try {
      await api.post('/pc/upgrades', {
        part_type: upg.part_type,
        from_part_id: upg.from_part_id ? Number(upg.from_part_id) : null,
        to_part_id: Number(upg.to_part_id),
        upgraded_at: upg.upgraded_at,
        note: upg.note || null,
      });
      toast.ok(t('pcmy.upgradeAdded'));
      setUpg({ part_type: 'gpu', from_part_id: '', to_part_id: '', upgraded_at: new Date().toISOString().slice(0, 10), note: '' });
      await load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const delUpgrade = async (id) => {
    try { await api.del(`/pc/upgrades/${id}`); toast.ok(t('pcmy.upgradeDeleted')); await load(); }
    catch (e) { toast.err(e.message); }
  };

  const addWish = async () => {
    if (!wish.part_id) return toast.err(t('pcmy.requiredPart'));
    setBusy(true);
    try {
      await api.post('/pc/wishlist', { part_type: wish.part_type, part_id: Number(wish.part_id), note: wish.note || null });
      toast.ok(t('pcmy.wishAdded'));
      setWish({ part_type: 'gpu', part_id: '', note: '' });
      await load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const delWish = async (id) => {
    try { await api.del(`/pc/wishlist/${id}`); toast.ok(t('pcmy.wishDeleted')); await load(); }
    catch (e) { toast.err(e.message); }
  };

  if (!data) {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title"><h1>🖥️ {t('pcmy.title')}</h1></div></div>
        <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><Spinner lg /></Card>
      </div>
    );
  }

  const catTone = (c) => ({ gaming: 'primary', work: 'ok', future: 'warn', other: 'info' }[c] || 'info');

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🖥️ {t('pcmy.title')}</h1>
          <span className="sub">{t('pcmy.sub')}</span>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>＋ {t('pcmy.addPc')}</button>
        </div>
      </div>

      {/* My PCs ---------------------------------------------------- */}
      <Card>
        <CardHead title={<>{t('pcmy.myPcs')} <Badge tone="info">{data.builds.length}</Badge></>}>
          <DataTag label={t('data.userProvided')} />
        </CardHead>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)' }}>{t('pcmy.myPcsSub')}</p>

        {data.builds.length === 0 ? (
          <EmptyState icon="🖥️" title={t('pcmy.noPcs')} text={t('pcmy.noPcsText')}
            action={<Link className="btn btn-sm" to="/pc/builder">{t('pcmy.goBuilder')}</Link>} />
        ) : (
          <div className="grid cols-3">
            {data.builds.map((b) => (
              <Card key={b.id} className="hover" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
                    <div className="pill-row" style={{ marginTop: 6 }}>
                      <Badge tone={catTone(b.category)}>{t(`pcmy.cat${b.category[0].toUpperCase()}${b.category.slice(1)}`)}</Badge>
                      {b.is_active && <Badge tone="ok">● {t('pcmy.active')}</Badge>}
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-dim)', minHeight: 84 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Object.entries(b.parts).map(([k, p]) => (
                      <span key={k} title={p.name} style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 6, padding: '2px 7px' }}>
                        {labelOf(k)}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {t('pcmy.partsCount', { n: Object.keys(b.parts).length })} · <b style={{ color: 'var(--text)' }}>${b.total_price || 0}</b>
                  </div>
                </div>
                <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!b.is_active && <button className="btn btn-ghost btn-sm" onClick={() => setActive(b.id)}>{t('pcmy.setActive')}</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)}>{t('pcmy.edit')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => share(b.id)} title={t('pcmy.shareLink')}>🔗</button>
                  <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => deleteBuild(b.id)}>✕</button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* Upgrade history -------------------------------------------- */}
      <Card style={{ marginTop: 20 }}>
        <CardHead title={<>{t('pcmy.upgradeHistory')} <Badge tone="info">{data.upgrades.length}</Badge></>} />
        <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)' }}>{t('pcmy.upgradesSub')}</p>

        <div className="grid cols-4" style={{ alignItems: 'end' }}>
          <div className="field"><label>{t('pcmy.partType')}</label>
            <select className="select" value={upg.part_type} onChange={(e) => setUpg({ ...upg, part_type: e.target.value, from_part_id: '', to_part_id: '' })}>
              {PART_TYPES.map((p) => <option key={p} value={p}>{labelOf(p)}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcmy.oldPart')}</label>
            <select className="select" value={upg.from_part_id} onChange={(e) => setUpg({ ...upg, from_part_id: e.target.value })}>
              <option value="">—</option>
              {catList(upg.part_type).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcmy.newPart')}</label>
            <select className="select" value={upg.to_part_id} onChange={(e) => setUpg({ ...upg, to_part_id: e.target.value })}>
              <option value="">—</option>
              {catList(upg.part_type).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcmy.date')}</label>
            <input className="input" type="date" value={upg.upgraded_at} onChange={(e) => setUpg({ ...upg, upgraded_at: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: 'span 3' }}><label>{t('pcmy.note')}</label>
            <input className="input" value={upg.note} onChange={(e) => setUpg({ ...upg, note: e.target.value })} placeholder={t('pcmy.notePlaceholder')} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={addUpgrade}>{t('pcmy.addUpgrade')}</button>
        </div>

        {data.upgrades.length === 0 ? (
          <EmptyState icon="⚡" title={t('pcmy.noUpgrades')} text={t('pcmy.noUpgradesText')} />
        ) : (
          <div style={{ marginTop: 12 }}>
            {data.upgrades.map((u) => (
              <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px dashed var(--border)', fontSize: '0.86rem' }}>
                <Badge tone="info">{u.part_label}</Badge>
                <span style={{ color: 'var(--text-dim)' }}>{u.from_part_name || '—'}</span>
                <span>→</span>
                <b>{u.to_part_name}</b>
                {u.note && <span style={{ color: 'var(--text-faint)' }}>· {u.note}</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: '0.8rem' }}>{u.upgraded_at}</span>
                <button className="btn btn-danger btn-sm" onClick={() => delUpgrade(u.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Wishlist --------------------------------------------------- */}
      <Card style={{ marginTop: 20 }}>
        <CardHead title={<>{t('pcmy.wishlist')} <Badge tone="info">{data.wishlist.length}</Badge></>} />
        <p style={{ fontSize: '0.86rem', color: 'var(--text-dim)' }}>{t('pcmy.wishlistSub')}</p>

        <div className="grid cols-4" style={{ alignItems: 'end' }}>
          <div className="field"><label>{t('pcmy.partType')}</label>
            <select className="select" value={wish.part_type} onChange={(e) => setWish({ ...wish, part_type: e.target.value, part_id: '' })}>
              {PART_TYPES.map((p) => <option key={p} value={p}>{labelOf(p)}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>{t('pcmy.partToBuy')}</label>
            <select className="select" value={wish.part_id} onChange={(e) => setWish({ ...wish, part_id: e.target.value })}>
              <option value="">—</option>
              {catList(wish.part_type).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('pcmy.note')}</label>
            <input className="input" value={wish.note} onChange={(e) => setWish({ ...wish, note: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={addWish} style={{ gridColumn: 'span 4' }}>{t('pcmy.addToWishlist')}</button>
        </div>

        {data.wishlist.length === 0 ? (
          <EmptyState icon="🎯" title={t('pcmy.noWish')} text={t('pcmy.noWishText')} />
        ) : (
          <div style={{ marginTop: 12 }}>
            {data.wishlist.map((w) => (
              <div key={w.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px dashed var(--border)', fontSize: '0.86rem' }}>
                <PartImage part={{ category: w.part_type }} size={26} />
                <Badge tone="warn">{w.part_label}</Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{w.name}</b>
                  {w.spec && <span style={{ color: 'var(--text-faint)', marginLeft: 8, fontSize: '0.8rem' }}>{w.spec}</span>}
                  {w.note && <span style={{ color: 'var(--text-dim)' }}> · {w.note}</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700 }}>{w.price_usd ? `$${w.price_usd}` : '—'}</span>
                  <RefDate date={w.price_date} />
                </div>
                <StoreLinks store={w.store} name={w.name} />
                <button className="btn btn-danger btn-sm" onClick={() => delWish(w.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add PC modal ------------------------------------------------- */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('pcmy.addManual')}>
        <div className="grid cols-2">
          <div className="field"><label>{t('pcmy.pcName')}</label>
            <input className="input" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder={t('pcmy.pcNamePlaceholder')} />
          </div>
          <div className="field"><label>{t('pcmy.category')}</label>
            <select className="select" value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`pcmy.cat${c[0].toUpperCase()}${c.slice(1)}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid cols-2">
          {PART_TYPES.map((k) => (
            <div className="field" key={k}><label>{labelOf(k)}</label>
              <select className="select" value={addForm.config[CONFIG_KEYS[k]] || ''} onChange={(e) => setAddForm({ ...addForm, config: { ...addForm.config, [CONFIG_KEYS[k]]: e.target.value } })}>
                <option value="">—</option>
                {catList(k).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 12 }} onClick={addPc}>{t('pcmy.savePc')}</button>
      </Modal>

      {/* Edit PC modal ------------------------------------------------- */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('pcmy.editPc')}>
        <div className="grid cols-2">
          <div className="field"><label>{t('pcmy.pcName')}</label>
            <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div className="field"><label>{t('pcmy.category')}</label>
            <select className="select" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`pcmy.cat${c[0].toUpperCase()}${c.slice(1)}`)}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 12 }} onClick={saveEdit}>{t('pcmy.savePc')}</button>
      </Modal>
    </div>
  );
}
