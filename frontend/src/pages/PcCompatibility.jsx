import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const FIELDS = [
  ['cpu', 'pccomp.cpu'], ['gpu', 'pccomp.gpu'], ['motherboard', 'pccomp.motherboard'], ['ram', 'pccomp.memory'],
  ['storage', 'pccomp.storage'], ['psu', 'pccomp.psu'], ['case', 'pccomp.case'], ['cooler', 'pccomp.cooler'],
];

const CAT_API = {
  cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'ram',
  storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers',
};

const TONES = { ok: 'ok', error: 'err', warn: 'warn', info: 'info' };

export default function PcCompatibility() {
  const toast = useToast();
  const { t } = useI18n();
  const [catalog, setCatalog] = useState({});
  const [sel, setSel] = useState({});
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    Promise.all(FIELDS.map(async ([key]) => {
      const items = await getHardwareCategory(CAT_API[key]);
      setCatalog((c) => ({ ...c, [key]: items }));
    })).catch((e) => toast.err(e.message));
  }, []);

  const run = async () => {
    const ids = Object.fromEntries(FIELDS.map(([key]) => [key, sel[key] ? Number(sel[key]) : null]));
    if (!Object.values(ids).some(Boolean)) return toast.err(t('pccomp.selectAtLeastOne'));
    setChecking(true);
    setResult(null);
    try {
      const r = await api.post('/pc/compatibility', ids);
      setResult(r);
    } catch (e) { toast.err(e.message); }
    finally { setChecking(false); }
  };

  const clearAll = () => { setSel({}); setResult(null); };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>✅ {t('pccomp.title')}</h1>
          <span className="sub">{t('pccomp.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('pccomp.selectComponents')}</>} />
          <div className="grid cols-2">
            {FIELDS.map(([key, label]) => (
              <div className="field" key={key}>
                <label>{t(label)}</label>
                <select className="select" value={sel[key] || ''} onChange={(e) => setSel({ ...sel, [key]: e.target.value })}>
                  <option value="">—</option>
                  {(catalog[key] || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="pill-row" style={{ marginTop: 6 }}>
            <button className="btn btn-primary" disabled={checking} onClick={run}>
              {checking ? t('pccomp.checking') : t('pccomp.checkCompatibility')}
            </button>
            <button className="btn btn-ghost" onClick={clearAll}>{t('pccomp.clear')}</button>
          </div>
        </Card>

        <div>
          {checking ? (
            <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={32} />
                <p style={{ marginTop: 12, fontSize: '0.92rem' }}>{t('pccomp.checkingText')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('pccomp.validating')}</p>
              </div>
            </Card>
          ) : result ? (
            <Card tilt>
              <CardHead title={<>📋 {t('pccomp.result')}</>}>
                <Badge tone={result.status === 'compatible' ? 'ok' : result.status === 'incompatible' ? 'err' : 'warn'}>
                  {result.status === 'compatible' ? t('pccomp.compatible') : result.status === 'incompatible' ? t('pccomp.incompatible') : t('pccomp.compatibleNotes')}
                </Badge>
                <DataTag label={t('data.verified')} />
              </CardHead>
              <p style={{ fontSize: '0.9rem', marginBottom: 12 }}>{result.summary}</p>

              <div className="card pad-sm" style={{ marginBottom: 12, background: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', fontWeight: 600 }}>{t('pccomp.score')}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: 800, lineHeight: 1.1, color: result.score >= 75 ? 'var(--ok)' : result.score >= 50 ? 'var(--warn)' : 'var(--danger)' }}>{result.score}%</div>
                    <Badge tone={result.score >= 75 ? 'ok' : result.score >= 50 ? 'warn' : 'err'}>
                      {t(`pccomp.verdict.${result.scoreVerdict}`)}
                    </Badge>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    <div>{t('pccomp.coverage')} <b>{result.coverage.percent}%</b> ({result.coverage.selected}/{result.coverage.total})</div>
                    {result.coverage.percent < 100 && <div style={{ marginTop: 4, color: 'var(--text-faint)' }}>{t('pccomp.partialNote')}</div>}
                  </div>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                  {t('pccomp.formula')}: {result.scoreFormula}
                </div>
                {result.scoreBreakdown.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {result.scoreBreakdown.map((d, i) => (
                      <Badge key={i} tone={d.status === 'error' ? 'err' : d.status === 'warn' ? 'warn' : 'info'}>
                        {t(`pccomp.status.${d.status}`)} {d.category} −{d.penalty}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.checks.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid var(--border)' }}>
                    <div style={{ marginTop: 2 }}>
                      {c.status === 'ok' ? '✅' : c.status === 'error' ? '❌' : c.status === 'warn' ? '⚠️' : 'ℹ️'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{c.category}</div>
                      <div style={{ fontSize: '0.88rem' }}>{c.message}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 10 }}>{t('pccomp.checkedAt')} {new Date(result.checkedAt).toLocaleString()}</p>
            </Card>
          ) : (
            <Card style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="✅" title={t('pccomp.noCheckYet')} text={t('pccomp.noCheckText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
