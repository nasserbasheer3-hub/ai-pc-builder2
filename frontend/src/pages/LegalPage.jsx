import { useI18n } from '../i18n/index.jsx';
import { useSeo } from '../hooks/useSeo.js';

const SECTION_COUNTS = { privacy: 9, terms: 10, about: 4 };

function renderBody(body) {
  return String(body || '').split('\n\n').map((block, i) => {
    const lines = block.split('\n').filter(Boolean);
    const isList = lines.every((l) => l.trim().startsWith('- '));
    if (isList) {
      return (
        <ul key={i} style={{ paddingLeft: 20, margin: '10px 0' }}>
          {lines.map((l, j) => <li key={j} style={{ margin: '4px 0' }}>{l.trim().slice(2)}</li>)}
        </ul>
      );
    }
    return <p key={i} style={{ margin: '10px 0' }}>{block}</p>;
  });
}

export default function LegalPage({ page }) {
  const { t } = useI18n();
  const count = SECTION_COUNTS[page] || 1;
  useSeo({
    title: `${t(`${page}.title`)} — ApexCore`,
    description: t(`${page}.sub`),
  });

  return (
    <div className="page" style={{ maxWidth: 820, margin: '0 auto', padding: '44px 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div className="kicker">{t('legal.kicker')}</div>
      <h1>{t(`${page}.title`)}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
        {t('legal.updated')} {t(`${page}.updated`)}
      </p>
      <div style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
        {Array.from({ length: count }, (_, i) => (
          <section key={i} style={{ margin: '26px 0' }}>
            <h2 style={{ fontSize: '1.05rem', color: 'var(--text)' }}>{t(`${page}.s${i + 1}.title`)}</h2>
            {renderBody(t(`${page}.s${i + 1}.body`))}
          </section>
        ))}
      </div>
    </div>
  );
}
