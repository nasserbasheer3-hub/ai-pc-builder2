// Category placeholder art + store-check links for PC part rows.
// Backend rows now carry { price, price_date, store:{amazon,google} }.
// Icons are inline SVG strokes (no external deps).

function Icon({ meta, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {meta.body}
    </svg>
  );
}

const CPU = (
  <>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    <rect x="10" y="10" width="4" height="4" rx="0.6" />
    <path d="M9 2.5v3M12 2.5v3M15 2.5v3M9 18.5v3M12 18.5v3M15 18.5v3" />
    <path d="M2.5 9h3M2.5 12h3M2.5 15h3M18.5 9h3M18.5 12h3M18.5 15h3" />
  </>
);
const GPU = (
  <>
    <rect x="3.5" y="8.5" width="17" height="6.2" rx="1.2" />
    <path d="M6 14.7v2.8M9.5 14.7v2.8M14.5 14.7v2.8M18 14.7v2.8" />
    <path d="M4.6 10h4M18.5 12.2h2" />
    <circle cx="12" cy="11.6" r="2" />
  </>
);
const MOTHERBOARD = (
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="7" width="6" height="5" rx="0.8" />
    <path d="M7 15h10" />
    <circle cx="7" cy="16.8" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="17.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" />
  </>
);
const RAM = (
  <>
    <rect x="6.5" y="5" width="3.4" height="14" rx="1" />
    <rect x="14.1" y="5" width="3.4" height="14" rx="1" />
    <path d="M8.2 10h0M8.2 13h0M8.2 16h0M15.8 10h0M15.8 13h0M15.8 16h0" strokeWidth="2.6" />
    <path d="M8.2 19v2.5M15.8 19v2.5" />
  </>
);
const STORAGE = (
  <>
    <rect x="3" y="7.5" width="18" height="9" rx="1.6" />
    <circle cx="6.4" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6.4" cy="12" r="0.9" />
    <path d="M9.6 12h9.4M10.5 9.8h4.2" />
  </>
);
const PSU = (
  <>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <path d="M9.5 8.5v7M13 8.5V12M9.5 14.5h3.5" />
  </>
);
const CASE = (
  <>
    <rect x="8" y="3" width="8" height="18" rx="1.6" />
    <path d="M11 6h2M11 9h2M8 12.5h1.5" />
    <path d="M15 12.5h1" />
    <path d="M11 15.5h2" />
  </>
);
const COOLER = (
  <>
    <circle cx="12" cy="12" r="7.2" />
    <path d="M12 4.8v-1.6M12 20.8v-1.6M4.8 12H3.2M20.8 12h-1.6" />
    <circle cx="12" cy="12" r="1.4" />
  </>
);
const OTHER = (
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
  </>
);

const META = {
  cpu:        { body: CPU, hue: 210 },
  gpu:        { body: GPU, hue: 280 },
  motherboard:{ body: MOTHERBOARD, hue: 160 },
  ram:        { body: RAM, hue: 45 },
  storage:    { body: STORAGE, hue: 200 },
  psu:        { body: PSU, hue: 330 },
  case:       { body: CASE, hue: 0 },
  cooler:     { body: COOLER, hue: 190 },
};

export function partMeta(key) {
  return META[key] || { body: OTHER, hue: 220 };
}

// Per-category placeholder image (a soft gradient tile). Real per-part
// photography is layered on later; the slot shape stays the same.
export function PartImage({ part, size = 38 }) {
  const meta = partMeta(part?.category || part?.part_key || part?.key || 'other');
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: 10, flex: '0 0 auto',
      display: 'grid', placeItems: 'center', color: 'rgba(240,240,255,0.92)',
      background: `linear-gradient(135deg, hsl(${meta.hue},70%,26%), hsl(${meta.hue + 60},62%,12%))`,
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
    }}>
      <Icon meta={meta} size={Math.round(size * 0.52)} />
    </div>
  );
}

export function priceDateLabel(date) {
  if (!date) return null;
  const s = String(date);
  const d = s.length >= 10 ? s.slice(0, 10) : s;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

// Small inline store-check links shown under a part name/price.
export function StoreLinks({ store, name, size = 'sm' }) {
  if (!store) return null;
  const pad = size === 'sm' ? '2px 7px' : '3px 10px';
  const font = size === 'sm' ? '0.68rem' : '0.76rem';
  const items = [];
  if (store.amazon) items.push(['Amazon', store.amazon]);
  if (store.google) items.push(['Google', store.google]);
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
      {items.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer"
           onClick={(e) => e.stopPropagation()}
           title={name ? `Check current price for ${name}` : 'Check current price'}
           style={{
             padding: pad, fontSize: font, fontWeight: 700, lineHeight: 1.5,
             textDecoration: 'none', color: 'var(--primary-2)',
             background: 'rgba(124,92,255,0.12)', border: '1px solid rgba(124,92,255,0.35)',
             borderRadius: 999, whiteSpace: 'nowrap',
           }}>{label} ↗</a>
      ))}
    </div>
  );
}

// Date caption under a price. Two honest states:
//   live  -> the number was fetched from Amazon on this date
//   other -> catalog reference estimate, last revised on this date
export function RefDate({ date, live }) {
  const label = priceDateLabel(date);
  if (!label) return null;
  const prefix = live ? 'live price' : 'reference price';
  return (
    <div style={{ fontSize: '0.62rem', color: 'var(--text-faint)', marginTop: 2 }}>
      {prefix} · {label}
    </div>
  );
}
