import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast, LoadingBlock } from '../components/ui.jsx';
import { useSeo } from '../hooks/useSeo.js';

const BEST_FN = {
  max: (a, b) => a - b,
  min: (a, b) => b - a,
};

const ROWS = {
  cpus: [
    { k: 'pchw.col.socket', v: (i) => i.socket || '—' },
    { k: 'pchw.col.coresThreads', v: (i) => (i.cores ? `${i.cores}C / ${i.threads}T` : '—') },
    { k: 'compare.baseClock', v: (i) => (i.base_clock_ghz ? `${i.base_clock_ghz} GHz` : '—'), best: 'max' },
    { k: 'pchw.col.boost', v: (i) => (i.boost_clock_ghz ? `${i.boost_clock_ghz} GHz` : '—'), best: 'max' },
    { k: 'pchw.col.tdp', v: (i) => (i.tdp_watts ? `${i.tdp_watts} W` : '—'), best: 'min' },
    { k: 'compare.igpu', v: (i) => (i.integrated_graphics ? 'yes' : 'no') },
    { k: 'pchw.col.index', v: (i) => i.performance_index ?? '—', best: 'max', num: true },
    { k: 'compare.value', v: (i) => valueOf(i), best: 'max', num: true },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
    { k: 'compare.released', v: (i) => i.release_year || '—' },
  ],
  gpus: [
    { k: 'compare.chipset', v: (i) => i.chipset || '—' },
    { k: 'pchw.col.vram', v: (i) => (i.vram_gb ? `${i.vram_gb} GB` : '—'), best: 'max' },
    { k: 'pchw.col.tdp', v: (i) => (i.tdp_watts ? `${i.tdp_watts} W` : '—'), best: 'min' },
    { k: 'compare.upscaling', v: (i) => (i.supports_upscaling ? 'yes' : 'no') },
    { k: 'compare.pcie', v: (i) => i.pcie_version || '—' },
    { k: 'pchw.col.index', v: (i) => i.performance_index ?? '—', best: 'max', num: true },
    { k: 'compare.value', v: (i) => valueOf(i), best: 'max', num: true },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
    { k: 'compare.released', v: (i) => i.release_year || '—' },
  ],
  motherboards: [
    { k: 'pchw.col.socket', v: (i) => i.socket || '—' },
    { k: 'pchw.col.chipset', v: (i) => i.chipset || '—' },
    { k: 'pchw.col.ram', v: (i) => (i.ram_type ? `${i.ram_type} · ${i.ram_slots ?? 0} slots` : '—') },
    { k: 'compare.maxRam', v: (i) => (i.max_ram_gb ? `${i.max_ram_gb} GB` : '—'), best: 'max' },
    { k: 'compare.maxSpeed', v: (i) => (i.max_ram_speed_mhz ? `${i.max_ram_speed_mhz} MHz` : '—'), best: 'max' },
    { k: 'pchw.col.formFactor', v: (i) => i.form_factor || '—' },
    { k: 'compare.m2', v: (i) => i.m2_slots ?? '—', best: 'max', num: true },
    { k: 'compare.pcie', v: (i) => i.pcie_version || '—' },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
  ram: [
    { k: 'pchw.col.type', v: (i) => i.type || '—' },
    { k: 'pchw.col.capacity', v: (i) => (i.capacity_gb ? `${i.capacity_gb} GB` : '—'), best: 'max' },
    { k: 'pchw.col.speed', v: (i) => (i.speed_mhz ? `${i.speed_mhz} MHz` : '—'), best: 'max' },
    { k: 'compare.modules', v: (i) => i.modules ?? '—', best: 'max', num: true },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
  storage: [
    { k: 'pchw.col.interface', v: (i) => i.interface || '—' },
    { k: 'pchw.col.formFactor', v: (i) => i.form_factor || '—' },
    { k: 'pchw.col.capacity', v: (i) => (i.capacity_gb ? `${i.capacity_gb} GB` : '—'), best: 'max' },
    { k: 'pchw.col.read', v: (i) => (i.read_mbps ? `${i.read_mbps} MB/s` : '—'), best: 'max' },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
  psus: [
    { k: 'pchw.col.wattage', v: (i) => (i.wattage ? `${i.wattage} W` : '—'), best: 'max' },
    { k: 'pchw.col.efficiency', v: (i) => i.efficiency_rating || '—' },
    { k: 'compare.modular', v: (i) => (i.modular ? 'yes' : 'no') },
    { k: 'pchw.col.8pin', v: (i) => i.pcie_connectors_8pin ?? '—', best: 'max', num: true },
    { k: 'compare.pwr12vhpwr', v: (i) => (i.has_12vhpwr ? 'yes' : 'no') },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
  cases: [
    { k: 'pchw.col.formFactors', v: (i) => i.form_factors || '—' },
    { k: 'pchw.col.maxGpu', v: (i) => (i.max_gpu_length_mm ? `${i.max_gpu_length_mm} mm` : '—'), best: 'max' },
    { k: 'pchw.col.maxCooler', v: (i) => (i.max_cooler_height_mm ? `${i.max_cooler_height_mm} mm` : '—'), best: 'max' },
    { k: 'compare.radiator', v: (i) => i.radiator_support || '—' },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
  coolers: [
    { k: 'pchw.col.type', v: (i) => i.type || '—' },
    { k: 'pchw.col.sockets', v: (i) => i.socket_support || '—' },
    { k: 'pchw.col.height', v: (i) => (i.height_mm ? `${i.height_mm} mm` : '—'), best: 'min' },
    { k: 'compare.radiator', v: (i) => (i.radiator_size_mm ? `${i.radiator_size_mm} mm` : '—'), best: 'max' },
    { k: 'pchw.col.price', v: (i) => (i.price_usd ? `$${i.price_usd}` : '—'), best: 'min' },
  ],
};

function valueOf(item) {
  if (item && item.price_usd > 0 && item.performance_index) {
    return (item.performance_index / item.price_usd).toFixed(2);
  }
  return '—';
}

const SLOT_KEYS = ['a', 'b', 'c'];

export default function Compare() {
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [priceNote, setPriceNote] = useState('');

  const category = params.get('category') || 'gpus';
  const [extraSlot, setExtraSlot] = useState(() => !!params.get('c'));
  const slotIds = SLOT_KEYS.map((k) => parseInt(params.get(k), 10) || null);

  useEffect(() => {
    api.get('/hardware').then((d) => setCats(d.categories)).catch(() => setCats([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/hardware?category=${category}`)
      .then((d) => { setItems(d.items); setPriceNote(d.priceNote || ''); setLoading(false); })
      .catch(() => { setLoading(false); toast.err(t('compare.loadError')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const setSlot = (idx, id) => {
    const next = new URLSearchParams(params);
    if (id) next.set(SLOT_KEYS[idx], id); else next.delete(SLOT_KEYS[idx]);
    next.set('category', category);
    setParams(next, { replace: true });
  };

  const byId = useMemo(() => new Map(items.map((i) => [String(i.id), i])), [items]);
  const selected = slotIds.map((id) => (id ? byId.get(String(id)) || null : null));
  const chosen = selected.filter(Boolean);
  const rows = ROWS[category] || [];
  const bestOf = (row, list) => {
    if (!row.best || list.length < 2) return -1;
    const nums = list.map((it) => {
      const raw = row.v(it);
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? n : null;
    });
    if (nums.some((n) => n === null)) return -1;
    let best = nums[0]; let idx = 0;
    for (let i = 1; i < nums.length; i++) {
      if (BEST_FN[row.best](nums[i], best) > 0) { best = nums[i]; idx = i; }
    }
    return idx;
  };

  const compareTitle = chosen.length >= 2 ? `${chosen[0].name} vs ${chosen[1].name}` : t('compare.title');
  useSeo({
    title: `${compareTitle} — LevelCore`,
    description: t('compare.sub'),
  });

  const slotOptions = (slotId) => items.map((i) => (
    <option key={i.id} value={i.id}>{i.name}</option>
  ));

  return (
    <div className="page" style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="kicker">{t('compare.kicker')}</div>
      <h1>{t('compare.title')}</h1>
      <p style={{ color: 'var(--text-dim)', maxWidth: 680 }}>{t('compare.sub')}</p>

      <div className="pill-row" style={{ margin: '16px 0 8px', gap: 8 }}>
        {cats.map((c) => (
          <button
            key={c.key}
            className={`chip ${category === c.key ? 'chip-on' : ''}`}
            onClick={() => { const n = new URLSearchParams(); n.set('category', c.key); setParams(n, { replace: true }); }}
          >
            {c.label} <span className="badge" style={{ marginLeft: 6, opacity: 0.8 }}>{c.count}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingBlock text={t('compare.loading')} /> : items.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>{t('compare.empty')}</p>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
            {selected.slice(0, extraSlot ? 3 : 2).map((sel, idx) => (
              <div className="card" key={idx} style={{ padding: 14 }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {idx === 0 ? t('compare.first') : t('compare.vs')} {idx + 1}
                </label>
                <select
                  className="select"
                  value={sel?.id ?? ''}
                  onChange={(e) => setSlot(idx, e.target.value ? parseInt(e.target.value, 10) : null)}
                >
                  <option value="">— {t('compare.select')} —</option>
                  {slotOptions(idx)}
                </select>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 6, minHeight: 32 }}>
                  {sel ? (sel.brand ? `${sel.brand} · ` : '') + (sel.price_usd ? `$${sel.price_usd}` : t('compare.noPrice')) : ''}
                </div>
              </div>
            ))}
            {!extraSlot && (
              <button className="btn btn-ghost" style={{ alignSelf: 'center' }} onClick={() => setExtraSlot(true)}>
                + {t('compare.add')}
              </button>
            )}
          </div>

          {chosen.length >= 2 ? (
            <div className="card" style={{ padding: 18, marginTop: 22, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 150 }}>{t('compare.spec')}</th>
                    {chosen.map((c) => <th key={c.id}>{c.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => {
                    const win = bestOf(row, chosen);
                    return (
                      <tr key={ri}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{t(row.k)}</td>
                        {chosen.map((c, ci) => {
                          const raw = row.v(c);
                          const disp = raw === 'yes' ? t('compare.yes') : raw === 'no' ? t('compare.no') : raw;
                          const isWin = ci === win;
                          return (
                            <td key={c.id} style={{
                              fontSize: '0.88rem',
                              color: isWin ? '#6ee7b7' : 'var(--text)',
                              fontWeight: isWin ? 600 : 400,
                              opacity: win >= 0 && !isWin ? 0.6 : 1,
                            }}>
                              {isWin ? '✓ ' : ''}{disp}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 12 }}>
                {priceNote || t('compare.priceNote')}
              </p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                {t('compare.honestNote')}
              </p>
              {chosen.length >= 2 && chosen.some((c) => c.performance_index) && (
                <div style={{ marginTop: 8 }}>
                  <Link to="/pc/fps" className="btn btn-ghost btn-sm">{t('compare.toFps')}</Link>
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-dim)', marginTop: 26 }}>{t('compare.hint')}</p>
          )}
        </>
      )}
    </div>
  );
}
