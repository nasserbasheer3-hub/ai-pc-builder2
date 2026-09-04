import { useI18n } from '../i18n/index.jsx';

// "Dozens of builds" selector. After the engine returns many distinct verified
// configurations for one request, this bar lets the user flip between them.
// Every plan is a real build from the catalog — nothing is decorative.

function shortName(name = '') {
  return String(name).replace(/^(AMD|NVIDIA|Intel)\s+/i, '');
}

function fpsStats(plan) {
  const values = (plan.expectedFps || [])
    .map((f) => (Number.isFinite(Number(f.fps)) ? Number(f.fps) : null))
    .filter((n) => n != null);
  if (!values.length) return { min: null, avg: null };
  return { min: Math.min(...values), avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length) };
}

export default function BuildVariants({ plans = [], active = 0, onPick, targetFps = 60 }) {
  const { t } = useI18n();
  if (!plans || plans.length < 2) return null;
  const currency = plans[0]?.currency || '';
  return (
    <div style={{ margin: '14px 0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)', fontWeight: 700 }}>
          {t('pcbuilder.variantsTitle')}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{t('pcbuilder.variantsCount', { n: plans.length })}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 2px 6px', scrollbarWidth: 'thin' }}>
        {plans.map((plan, i) => {
          const st = fpsStats(plan);
          const sel = i === active;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              aria-pressed={sel}
              style={{
                flex: '0 0 auto', minWidth: 170, maxWidth: 230, textAlign: 'left', cursor: 'pointer',
                padding: '8px 11px', borderRadius: 12, lineHeight: 1.35,
                background: sel ? 'linear-gradient(135deg, rgba(124,92,255,0.22), rgba(34,211,238,0.12))' : 'rgba(0,0,0,0.22)',
                border: sel ? '1px solid var(--primary-2)' : '1px solid var(--border)',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: sel ? 'var(--primary-2)' : 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {i === 0 ? '★ ' : `#${i + 1} `}{shortName(plan.parts?.gpu?.name)}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {shortName(plan.parts?.cpu?.name)} · {(plan.totalPrice || 0).toLocaleString()} {currency}
              </div>
              {st.min != null && (
                <div style={{ fontSize: '0.64rem', marginTop: 3 }}>
                  {st.min >= targetFps ? (
                    <span style={{ color: 'var(--ok, #34d399)' }}>{t('pcbuilder.variantReaches')}</span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>{t('pcbuilder.variantAvg', { fps: st.avg })}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
