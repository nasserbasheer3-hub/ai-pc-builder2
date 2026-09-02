import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

const TOOLS = ['pchub.t1', 'pchub.t2', 'pchub.t3', 'pchub.t4', 'pchub.t5', 'pchub.t6', 'pchub.t7', 'pchub.t8', 'pchub.t9', 'pchub.t10', 'pchub.t11', 'pchub.t12', 'pchub.t13', 'pchub.t14'];
const TOOL_ROUTES = { t1: '/pc/builder', t2: '/pc/fps', t3: '/pc/compatibility', t4: '/pc/upgrade', t5: '/pc/settings', t6: '/pc/hardware', t7: '/pc/compare', t8: '/pc/bottleneck', t9: '/pc/psu', t10: '/pc/gamecheck', t11: '/pc/my', t12: '/pc/troubleshooter', t13: '/pc/scan', t14: '/pc/library' };
const TOOL_ICONS = { t1: '🛠️', t2: '📈', t3: '✅', t4: '⚡', t5: '🎯', t6: '🗄️', t7: '⚖️', t8: '🧠', t9: '🔌', t10: '🎮', t11: '🖥️', t12: '🩺', t13: '📸', t14: '📚' };

export default function PcHub() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>🖥️ {t('pchub.title')}</h1>
          <span className="sub">{t('pchub.sub')}</span>
        </div>
      </div>

      <div className="grid cols-3">
        {TOOLS.map((k) => (
          <Link key={k} to={TOOL_ROUTES[k]} style={{ textDecoration: 'none' }}>
            <div className="card hover" style={{ height: '100%' }}>
              <div style={{ fontSize: '1.6rem' }}>{TOOL_ICONS[k]}</div>
              <h3 style={{ margin: '12px 0 6px', color: 'var(--text)' }}>{t(k)}</h3>
              <p style={{ fontSize: '0.86rem' }}>{t(`${k}d`)}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22, borderColor: 'rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.04)' }}>
        <h3 style={{ marginBottom: 8 }}>{t('pchub.honestyTitle')}</h3>
        <p style={{ fontSize: '0.88rem' }}>
          {t('pchub.honestyText1')}{' '}
          <b style={{ color: 'var(--primary-2)' }}>{t('data.verified')}</b>, <b>{t('data.userProvided')}</b>, <b>{t('data.estimated')}</b>, {t('pchub.or')} <b>{t('data.aiRec')}</b>.
        </p>
        <p style={{ fontSize: '0.88rem', marginTop: 6 }}>{t('pchub.honestyText2')}</p>
      </div>
    </div>
  );
}
