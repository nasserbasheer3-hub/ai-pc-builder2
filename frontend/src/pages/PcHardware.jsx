import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getHardwareCategories, getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, Badge, useToast, LoadingBlock } from '../components/ui.jsx';

const FIELDS = {
  cpus: { cols: ['pchw.col.name', 'pchw.col.coresThreads', 'pchw.col.boost', 'pchw.col.tdp', 'pchw.col.index', 'pchw.col.price'], render: (i, t, y) => [i.name, `${i.cores}C/${i.threads}T`, `${i.boost_clock_ghz}GHz`, `${i.tdp_watts}W`, i.performance_index, fmtPrice(i)] },
  gpus: { cols: ['pchw.col.name', 'pchw.col.vram', 'pchw.col.tdp', 'pchw.col.index', 'pchw.col.price'], render: (i, t, y) => [i.name, `${i.vram_gb}GB`, `${i.tdp_watts}W`, i.performance_index, fmtPrice(i)] },
  motherboards: { cols: ['pchw.col.name', 'pchw.col.socket', 'pchw.col.chipset', 'pchw.col.ram', 'pchw.col.formFactor', 'pchw.col.price'], render: (i, t, y) => [i.name, i.socket, i.chipset, `${i.ram_type} · ${i.ram_slots} slots`, i.form_factor, fmtPrice(i)] },
  ram: { cols: ['pchw.col.name', 'pchw.col.type', 'pchw.col.capacity', 'pchw.col.speed', 'pchw.col.price'], render: (i, t, y) => [i.name, i.type, `${i.capacity_gb}GB`, `${i.speed_mhz}MHz`, fmtPrice(i)] },
  storage: { cols: ['pchw.col.name', 'pchw.col.interface', 'pchw.col.capacity', 'pchw.col.read', 'pchw.col.price'], render: (i, t, y) => [i.name, i.interface, `${i.capacity_gb}GB`, i.read_mbps ? `${i.read_mbps} MB/s` : '—', fmtPrice(i)] },
  psus: { cols: ['pchw.col.name', 'pchw.col.wattage', 'pchw.col.efficiency', 'pchw.col.8pin', '12VHPWR', 'pchw.col.price'], render: (i, t, y) => [i.name, `${i.wattage}W`, i.efficiency_rating, i.pcie_connectors_8pin, i.has_12vhpwr ? y('pchw.yes') : y('pchw.no'), fmtPrice(i)] },
  cases: { cols: ['pchw.col.name', 'pchw.col.formFactors', 'pchw.col.maxGpu', 'pchw.col.maxCooler', 'pchw.col.price'], render: (i, t, y) => [i.name, i.form_factors, `${i.max_gpu_length_mm}mm`, `${i.max_cooler_height_mm}mm`, fmtPrice(i)] },
  coolers: { cols: ['pchw.col.name', 'pchw.col.type', 'pchw.col.sockets', 'pchw.col.height', 'pchw.col.price'], render: (i, t, y) => [i.name, i.type, i.socket_support, i.height_mm ? `${i.height_mm}mm` : '—', fmtPrice(i)] },
};

export default function PcHardware() {
  const toast = useToast();
  const { t } = useI18n();
  const [cats, setCats] = useState([]);
  const [active, setActive] = useState('cpus');
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHardwareCategories().then(setCats).catch((e) => toast.err(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    getHardwareCategory(active, true).then((list) => {
      setItems(list);
      setLoading(false);
    }).catch((e) => { toast.err(e.message); setLoading(false); });
  }, [active]);

  const applyFilters = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/hardware?category=${active}&q=${encodeURIComponent(q)}&sort=${sort}`);
      setItems(data.items);
      setPriceNote(data.priceNote || '');
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  };

  const spec = FIELDS[active] || FIELDS.cpus;
  const label = (c) => (c.startsWith('pchw.col.') ? t(c) : c);

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🗄️ {t('pchw.title')}</h1>
          <span className="sub">{t('pchw.sub')}</span>
        </div>
      </div>

      <div className="chip-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {cats.map((c) => (
          <button key={c.key} className={`chip ${active === c.key ? 'chip-on' : ''}`} onClick={() => { setActive(c.key); setQ(''); setSort(''); }}>
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={t('pchw.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
          <select className="select" value={sort} onChange={(e) => { setSort(e.target.value); applyFilters(); }}>
            <option value="">{t('pchw.sortNameAz')}</option>
            <option value="price">{t('pchw.sortPriceLow')}</option>
            <option value="price_desc">{t('pchw.sortPriceHigh')}</option>
            {(active === 'cpus' || active === 'gpus') && <option value="index">{t('pchw.sortPerfIndex')}</option>}
          </select>
          <button className="btn btn-primary" onClick={applyFilters}>{t('pchw.filter')}</button>
        </div>

        {loading ? <LoadingBlock text={t('pchw.loading')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{spec.cols.map((c) => <th key={c}>{label(c)}</th>)}<th></th></tr></thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={spec.cols.length + 1} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 30 }}>{t('pchw.noItems')}</td></tr>
                ) : items.map((i) => (
                  <tr key={i.id}>
                    {spec.render(i, t, t).map((v, k) => <td key={k}>{v}</td>)}
                    <td>
                      <a className="btn btn-ghost btn-sm" href={`/pc/compare?category=${active}&a=${i.id}`}>{t('pchw.compare')}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 10 }}>{priceNote || t('pchw.priceNote')}</p>
      </Card>
    </div>
  );
}

function fmtPrice(i) {
  const p = i.price_usd;
  return p != null ? <Badge tone="primary">${p}</Badge> : <span style={{ color: 'var(--text-faint)' }}>—</span>;
}
