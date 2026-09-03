import { Link } from 'react-router-dom';
import { useI18n, LanguageSwitcher } from '../i18n/index.jsx';

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 60, padding: '34px 22px 44px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 26 }}>
          <div>
            <img className="brand-logo" src="/logo/logo-lockup.webp" alt="ApexCore" style={{ width: 190 }} />
            <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginTop: 10, maxWidth: 260 }}>{t('footer.tagline')}</p>
            <div style={{ marginTop: 12 }}><LanguageSwitcher compact /></div>
          </div>
        <div>
          <div className="nav-group" style={{ textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: 1 }}>{t('footer.product')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <Link className="footer-link" to="/pc/hardware">{t('footer.hardwareCatalog')}</Link>
            <Link className="footer-link" to="/pc/compare">{t('footer.compare')}</Link>
            <Link className="footer-link" to="/pc/fps">{t('footer.fpsCalculator')}</Link>
            <Link className="footer-link" to="/pc/builder">{t('footer.pcBuilder')}</Link>
            <Link className="footer-link" to="/pricing">{t('footer.pricing')}</Link>
            <Link className="footer-link" to="/blog">{t('footer.blog')}</Link>
          </div>
        </div>
        <div>
          <div className="nav-group" style={{ textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: 1 }}>{t('footer.company')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <Link className="footer-link" to="/about">{t('footer.about')}</Link>
            <Link className="footer-link" to="/contact">{t('footer.contact')}</Link>
            <Link className="footer-link" to="/privacy">{t('footer.privacy')}</Link>
            <Link className="footer-link" to="/terms">{t('footer.terms')}</Link>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 980, margin: '26px auto 0', paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-faint)', fontSize: '0.74rem', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
        <span>{t('footer.verifiedNote')}</span>
      </div>
    </footer>
  );
}
