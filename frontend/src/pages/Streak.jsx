import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { Card, CardHead, Badge, ProgressBar, useToast, LoadingBlock } from '../components/ui.jsx';

export default function Streak() {
  const toast = useToast();
  const { t } = useI18n();
  const [streak, setStreak] = useState(null);

  useEffect(() => {
    api.get('/streak').then(setStreak).catch((e) => toast.err(e.message));
  }, []);

  if (!streak) return <div className="page"><LoadingBlock text={t('common.loading')} /></div>;

  const targets = [1, 3, 7, 14, 30, 100];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🔥 {t('streak.title')}</h1>
          <span className="sub">{t('streak.sub')}</span>
        </div>
      </div>

      <div className="streak-hero">
        <div className="streak-flame">🔥</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '3.4rem', fontWeight: 800, lineHeight: 1 }}>{streak.current}</div>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('streak.dayStreak')}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('streak.bestEver')}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700 }}>{streak.best}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>{t('streak.lastActivity')}</div>
          <div style={{ fontSize: '0.9rem' }}>{streak.lastActivityDate ? new Date(streak.lastActivityDate).toLocaleDateString() : t('streak.never')}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={<>🗓️ {t('streak.thisWeek')}</>}>
            <Badge tone={streak.week.activeDays >= 5 ? 'ok' : 'warn'}>{streak.week.activeDays}/5 {t('streak.activeDays')}</Badge>
          </CardHead>
          <ProgressBar pct={streak.weeklyProgress * 100} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {streak.last7.map((d) => (
              <div key={d.date} style={{ flex: 1, minWidth: 70, textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: d.active ? 'var(--primary-grad)' : 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', opacity: 0.8 }}>{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700 }}>{new Date(d.date).getDate()}</div>
                <div style={{ fontSize: '0.7rem' }}>{d.active ? t('streak.active') : '—'}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title={<>🎯 {t('streak.milestones')}</>}>
            <Badge>{t('streak.next')}: {nextTarget(streak.current, targets)} {t('streak.days')}</Badge>
          </CardHead>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {targets.map((tg) => {
              const reached = streak.current >= tg;
              return (
                <div key={tg} style={{
                  flex: 1, minWidth: 60, textAlign: 'center', padding: '12px 6px', borderRadius: 12,
                  background: reached ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${reached ? 'rgba(34,211,238,0.4)' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize: '1.4rem', opacity: reached ? 1 : 0.4 }}>{reached ? '🏆' : '🔒'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{tg} {t('streak.days')}</div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: '0.84rem', marginTop: 16 }}>{t('streak.explainer')}</p>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHead title={<>⚡ {t('streak.howItWorks')}</>}>
        </CardHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {[
            [t('streak.step1t'), t('streak.step1d')],
            [t('streak.step2t'), t('streak.step2d')],
            [t('streak.step3t'), t('streak.step3d')],
          ].map(([t2, d]) => (
            <div key={t2} className="card pad-sm"><h3 style={{ fontSize: '0.95rem', marginBottom: 4 }}>{t2}</h3><p style={{ fontSize: '0.84rem' }}>{d}</p></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function nextTarget(cur, targets) {
  const n = targets.find((t) => t > cur);
  return n ?? cur;
}
