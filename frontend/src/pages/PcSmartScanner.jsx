import { useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const EXAMPLES = [
  'RTX 4070, Ryzen 5 7600 and 32GB DDR5 RAM',
  'RX 7800 XT with a Ryzen 7 7800X3D and 2TB NVMe',
  'i5-13600K, RTX 4060 Ti and 16GB RAM, 650W PSU',
];

const PART_ICON = { cpu: '🧠', gpu: '🎨', motherboard: '🔲', ram: '🧩', storage: '💾', psu: '🔌', case: '🗄️', cooler: '🌀' };

export default function PcSmartScanner() {
  const toast = useToast();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [showNote, setShowNote] = useState(false);

  const run = async (value) => {
    const v = value !== undefined ? value : text;
    if (!v.trim()) return toast.err(t('scanner.required'));
    setBusy(true); setRes(null);
    try {
      const r = await api.post('/pc/scan', { text: v });
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>📸 {t('scanner.title')}</h1>
          <span className="sub">{t('scanner.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>{t('scanner.input')}</>} />
          <textarea className="input" rows={4} placeholder={t('scanner.ph')} value={text}
            onChange={(e) => setText(e.target.value)} />
          <div style={{ margin: '10px 0' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginBottom: 6 }}>{t('scanner.examples')}</div>
            <div className="pill-row">
              {EXAMPLES.map((e, i) => (
                <button key={i} className="chip" onClick={() => { setText(e); run(e); }}>{e}</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run()}>
            {busy ? t('scanner.scanning') : `🔎 ${t('scanner.scan')}`}
          </button>
        </Card>

        <div>
          {busy ? (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12 }}>{t('scanner.scanning')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('scanner.scanningText')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>{t('scanner.result')}</>}>
                <Badge tone="ok">{t('data.verified')}</Badge>
                <DataTag label={res.label} />
              </CardHead>

              {res.found.length ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {res.found.map((f, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: '1.2rem' }}>{PART_ICON[f.partType]}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t(`scanner.part.${f.partType}`)}</div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{f.spec}</div>
                        </div>
                        <b style={{ whiteSpace: 'nowrap' }}>${f.price_usd}</b>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t('scanner.total')}</span>
                    <b style={{ fontSize: '1.2rem' }}>${res.totalPrice}</b>
                  </div>
                </>
              ) : (
                <EmptyState icon="🔎" title={t('scanner.nothing')} text={t('scanner.nothingText')} />
              )}

              {res.unmatched.length > 0 && (
                <div className="card pad-sm" style={{ marginTop: 12, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.05)' }}>
                  <b style={{ color: 'var(--warn)' }}>⚠️ {t('scanner.unmatched')}</b>
                  <div className="pill-row" style={{ marginTop: 8 }}>
                    {res.unmatched.map((u, i) => <Badge key={i} tone="warn">{u}</Badge>)}
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 8 }}>{t('scanner.unmatchedText')}</p>
                </div>
              )}

              {res.notes?.length > 0 && (
                <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  {res.notes.map((n, i) => <p key={i}>· {n}</p>)}
                </div>
              )}

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowNote(!showNote)}>
                {showNote ? `▾ ${t('scanner.howTitle')}` : `▸ ${t('scanner.howTitle')}`}
              </button>
              {showNote && (
                <div className="card pad-sm" style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
                  {t('scanner.howText')}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: '0.76rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {res.disclaimer}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="📸" title={t('scanner.noScan')} text={t('scanner.noScanText')} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
