import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getHardwareCategory } from '../api/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, DataTag, Spinner, EmptyState, ProgressBar, useToast } from '../components/ui.jsx';

const SYM_ICONS = {
  crash_gaming: '🎮', random_restart: '🔄', overheating: '🌡️', no_display: '🖥️',
  bsod: '💙', stutter_fps: '📉', freeze_system: '🧊',
};
const HARDWARE_SELECTS = ['cpu', 'gpu', 'psu', 'ram', 'cooler'];
const CAT_MAP = { cpu: 'cpus', gpu: 'gpus', psu: 'psus', ram: 'ram', cooler: 'coolers' };

function severityTone(s) { return s === 'high' ? 'err' : s === 'medium' ? 'warn' : 'info'; }

export default function PcTroubleshooter() {
  const toast = useToast();
  const { t } = useI18n();
  const [defs, setDefs] = useState([]);
  const [catalog, setCatalog] = useState({});
  const [symptom, setSymptom] = useState(null);
  const [form, setForm] = useState({});
  const [describe, setDescribe] = useState('');
  const [answers, setAnswers] = useState({});
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    api.get('/pc/troubleshoot/defs').then((d) => setDefs(d.symptoms || [])).catch((e) => toast.err(e.message));
    Promise.all(HARDWARE_SELECTS.map(async (k) => {
      const items = await getHardwareCategory(CAT_MAP[k]);
      setCatalog((c) => ({ ...c, [k]: items }));
    })).catch((e) => toast.err(e.message));
  }, []);

  const questions = symptom ? (defs.find((s) => s.key === symptom)?.questions || []) : [];
  const nextIdx = questions.findIndex((q) => answers[q.id] === undefined);
  const answeredCount = Object.keys(answers).length;

  const optLabel = (qid, v) => {
    const k = `trbl.opt.${v}`;
    const label = t(k);
    return label === k ? v : label;
  };
  const qText = (qid) => t(`trbl.q.${qid}.text`);

  const chooseAnswer = (qid, v) => {
    const next = { ...answers, [qid]: v };
    setAnswers(next);
    if (res) setRes(null);
  };

  const analyze = async () => {
    if (!symptom) return toast.err(t('trbl.selectSymptomFirst'));
    setRunning(true); setRes(null);
    try {
      const body = { symptom };
      for (const k of HARDWARE_SELECTS) if (form[k]) body[`${k}_id`] = Number(form[k]);
      body.answers = answers;
      const r = await api.post('/pc/troubleshoot', body);
      setRes(r);
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); }
  };

  const aiExplain = async () => {
    if (!res) return;
    setAiBusy(true); setAi(null);
    try {
      const r = await api.post('/pc/troubleshoot/summary', { description: describe || 'no description', analysis: res });
      setAi(r.ai);
      if (!r.ai.available && r.ai.error) toast.err(r.ai.error);
    } catch (e) { toast.err(e.message); }
    finally { setAiBusy(false); }
  };

  const restart = () => { setSymptom(null); setAnswers({}); setRes(null); setAi(null); setDescribe(''); setForm({}); };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🩺 {t('trbl.title')}</h1>
          <span className="sub">{t('trbl.sub')}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div>
          <Card>
            <CardHead title={<>{t('trbl.step1')} — {t('trbl.symptom')}</>} />
            {symptom ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{SYM_ICONS[symptom]} {t(`trbl.s.${symptom}.title`)}</b>
                <button className="btn btn-ghost btn-sm" onClick={() => { setSymptom(null); setRes(null); }}>{t('trbl.change')}</button>
              </div>
            ) : (
              <div className="grid cols-2">
                {defs.map((s) => (
                  <button key={s.key} className="btn btn-ghost" style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', justifyContent: 'flex-start', padding: '12px 14px' }}
                    onClick={() => { setSymptom(s.key); setAnswers({}); setRes(null); setAi(null); }}>
                    <div>{SYM_ICONS[s.key]} <b>{t(`trbl.s.${s.key}.title`)}</b></div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 4 }}>{t(`trbl.s.${s.key}.desc`)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {symptom && (
            <>
              <Card style={{ marginTop: 14 }}>
                <CardHead title={<>{t('trbl.yourHardware')} <Badge tone="info">{t('trbl.optional')}</Badge></>} />
                <div className="grid cols-2">
                  {HARDWARE_SELECTS.map((k) => (
                    <div className="field" key={k}><label>{t(`trbl.hw.${k}`)}</label>
                      <select className="select" value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                        <option value="">{t('trbl.optional')}</option>
                        {(catalog[k] || []).map((i) => (
                          <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 4 }}>{t('trbl.hwNote')}</p>
              </Card>

              <Card style={{ marginTop: 14 }}>
                <CardHead title={<>{t('trbl.questions')} <Badge tone="info">{answeredCount}/{questions.length}</Badge></>} />
                {questions.length ? questions.map((q, i) => {
                  const chosen = answers[q.id];
                  const isCurrent = i === nextIdx;
                  return (
                    <div key={q.id} style={{
                      padding: '10px 12px', marginBottom: 8, borderRadius: 10, border: '1px solid var(--border)',
                      background: isCurrent ? 'rgba(34,211,238,0.07)' : 'rgba(0,0,0,0.2)', opacity: chosen !== undefined ? 0.72 : 1,
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: '0.88rem' }}>{i + 1}. {qText(q.id)}</b>
                        {chosen !== undefined && <Badge tone="ok">{optLabel(q.id, chosen)}</Badge>}
                      </div>
                      <div className="pill-row" style={{ marginTop: 8 }}>
                        {q.options.map((v) => (
                          <button key={v} className={`chip ${chosen === v ? 'chip-on' : ''}`} onClick={() => chooseAnswer(q.id, v)}>
                            {optLabel(q.id, v)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }) : <EmptyState icon="🩺" title={t('trbl.noQuestions')} text={t('trbl.noQuestionsText')} />}

                <button className="btn btn-primary btn-block" disabled={running} onClick={analyze}>
                  {running ? t('trbl.analyzing') : `🔍 ${t('trbl.analyze')}`}
                </button>
                {!nextIdx || res ? null : (
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', marginTop: 8 }}>{t('trbl.canSkip')}</p>
                )}
              </Card>
            </>
          )}
        </div>

        <div>
          {running ? (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Spinner size={34} />
                <p style={{ marginTop: 12 }}>{t('trbl.analyzing')}</p>
              </div>
            </Card>
          ) : res ? (
            <Card tilt>
              <CardHead title={<>{SYM_ICONS[res.symptom]} {t(`trbl.s.${res.symptom}.title`)}</>}>
                <DataTag label={t('data.estimated')} />
              </CardHead>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                {t('trbl.estimatedLikelihood')} · {t('trbl.answeredX', { a: res.questions.asked, t: res.questions.total })} · {res.causeModel}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {res.causes.map((c) => (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.94rem' }}>
                        <span style={{ color: 'var(--text-faint)', marginRight: 6 }}>#{c.rank}</span>{c.title}
                      </div>
                      <Badge tone={severityTone(c.severity)}>{t(`trbl.sev.${c.severity}`)}</Badge>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0 4px' }}>
                      <div style={{ flex: 1 }}><ProgressBar pct={c.probability} /></div>
                      <b style={{ fontSize: '1rem', whiteSpace: 'nowrap' }}>{c.probability}%</b>
                    </div>
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-dim)' }}>{c.rationale?.[0]}</p>
                    <div style={{ fontSize: '0.8rem', margin: '6px 0' }}><b>🛠 {t('trbl.check')}:</b> {c.check}</div>
                    {c.fixes?.length > 0 && (
                      <ul style={{ margin: '4px 0 0 18px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {c.fixes.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {res.powerCheck && (
                <div className="card pad-sm" style={{ marginTop: 12, fontSize: '0.84rem', borderColor: res.powerCheck.verdict === 'underpowered' ? 'rgba(244,63,94,0.4)' : 'rgba(34,211,238,0.3)' }}>
                  <b>{t('trbl.powerCheck')}:</b> {t(`trbl.powerVerdict.${res.powerCheck.verdict}`)} — {res.powerCheck.psuWattage}W vs ~{res.powerCheck.recommendedW}W {t('trbl.recommended')}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>{t('trbl.describe')} <Badge tone="info">{t('trbl.optional')}</Badge></label>
                  <textarea className="input" rows={2} placeholder={t('trbl.describePh')} value={describe}
                    onChange={(e) => setDescribe(e.target.value)} />
                </div>
                <button className="btn btn-ghost btn-block" disabled={aiBusy} onClick={aiExplain}>
                  {aiBusy ? t('trbl.aiWorking') : `🤖 ${t('trbl.aiExplain')}`}
                </button>
                {ai?.available && ai.content && (
                  <div className="card pad-sm" style={{ marginTop: 10, borderColor: 'rgba(34,211,238,0.35)', fontSize: '0.85rem', whiteSpace: 'pre-line' }}>
                    <b>🤖 {t('trbl.aiTitle')}</b><div style={{ marginTop: 6 }}>{ai.content}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 8 }}>{t('trbl.aiNote')}</div>
                  </div>
                )}
                {ai && !ai.available && ai.error && (
                  <p style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--warn)' }}>{ai.error}</p>
                )}
              </div>

              <div style={{ marginTop: 14, fontSize: '0.76rem', color: 'var(--text-faint)', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                ⚠️ {res.disclaimer}
              </div>
            </Card>
          ) : (
            <Card style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
              <EmptyState icon="🩺" title={t('trbl.noRun')} text={t('trbl.noRunText')} />
            </Card>
          )}
        </div>
      </div>

      {symptom && (
        <div className="card hover" style={{ marginTop: 16, display: 'inline-flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={restart}>{t('trbl.restart')}</button>
        </div>
      )}
    </div>
  );
}
