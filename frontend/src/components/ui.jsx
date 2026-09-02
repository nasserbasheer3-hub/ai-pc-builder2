import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export function Spinner({ lg }) {
  return <div className={`spinner${lg ? ' lg' : ''}`} aria-label="Loading" />;
}

export function LoadingBlock({ text = 'Loading...' }) {
  return (
    <div className="loading-block">
      <Spinner lg />
      <p>{text}</p>
    </div>
  );
}

export function ErrorBlock({ message, onRetry, children }) {
  return (
    <div className="error-block">
      <div className="big" style={{ fontSize: '2rem', opacity: 0.5 }}>⚠</div>
      <div className="msg">{message || 'Something went wrong.'}</div>
      {children}
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ icon = '🗂️', title, text, action }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      <p style={{ marginTop: 6 }}>{text}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Badge({ tone = '', children, ...rest }) {
  return <span className={`badge${tone ? ` badge-${tone}` : ''}`} {...rest}>{children}</span>;
}

// Status labels: verified | user | estimated | ai | unavailable
export function DataTag({ label }) {
  return <span className={`data-tag ${label || 'unavailable'}`}>{label || 'unavailable'}</span>;
}

export function Card({ className = '', tilt = false, children, style }) {
  const ref = useRef(null);
  const [t, setT] = useState(null);
  const onMove = (e) => {
    if (!tilt || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setT(`rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`);
  };
  return (
    <div
      ref={ref}
      className={`card${tilt ? ' tilt' : ''} ${className}`}
      style={{ ...style, transform: t ? `${t} scale(1.01)` : undefined }}
      onMouseMove={onMove}
      onMouseLeave={() => setT(null)}
    >
      <div className="glow-line" />
      {children}
    </div>
  );
}

export function CardHead({ title, children }) {
  return (
    <div className="card-head">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export function Stat({ value, label, delta, deltaTone }) {
  return (
    <div className="stat">
      <span className="value">{value ?? '—'}</span>
      <span className="label">{label}</span>
      {delta != null && (
        <span className={`delta ${deltaTone || (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat')}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta)}
        </span>
      )}
    </div>
  );
}

export function ProgressRing({ pct, size = 150, label, live }) {
  const inner = size - 22;
  return (
    <div className={`tracker-ring${live ? ' live' : ''}`} style={{ ['--p']: Math.min(100, Math.max(0, pct)), width: size, height: size }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: size / 5, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{label}</div>
      </div>
    </div>
  );
}

export function ProgressBar({ pct }) {
  return (
    <div className="bar"><div style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
  );
}

// ---------- Toast ----------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'info', timeout = 4200) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), timeout);
  }, []);
  const value = {
    toast: push,
    ok: (m) => push(m, 'ok'),
    err: (m) => push(m, 'err', 6000),
    info: (m) => push(m, 'info'),
  };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: wide ? 760 : 480, maxHeight: '85vh', overflow: 'auto', padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pagination({ page, total, pageSize = 15, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const items = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) items.push(i);
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      {items.map((i) => <button key={i} className={i === page ? 'active' : ''} onClick={() => onPage(i)}>{i}</button>)}
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}

export function fmtTime(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
