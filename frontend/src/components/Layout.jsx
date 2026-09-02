import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, LanguageSwitcher } from '../i18n/index.jsx';
import { api } from '../api/client';

const I = {
  home: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>,
  profile: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>,
  sessions: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M10 2h4" /></svg>,
  stats: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>,
  streak: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22c4 0 7-3 7-7.5C19 9 15 6 12 2c-3 4-7 7-7 12.5C5 19 8 22 12 22z" /></svg>,
  report: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16M4 10h16M4 15h9M4 20h6" /><circle cx="17.5" cy="17" r="3.5" /></svg>,
  friends: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3-5 6.5-5s6 1.5 6.5 5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 15c2.8.3 4.3 1.8 4.6 5" /></svg>,
  pc: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  builder: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3v4l-2 2-2-2V3M14 7h6v3h-2v5a2 2 0 0 1-2 2h-2" /><rect x="2" y="14" width="8" height="7" rx="1.5" /></svg>,
  check: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  fps: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>,
  compare: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="3" width="8" height="8" rx="1.5" /><rect x="13.5" y="13" width="8" height="8" rx="1.5" /><path d="M6.5 11v6a2 2 0 0 0 2 2h5M17.5 13V7a2 2 0 0 0-2-2h-5" /></svg>,
  upgrade: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20V6M6 12l6-6 6 6" /></svg>,
  gear: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>,
  logout: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 12H3M8 8l-4 4 4 4M14 4h6v16h-6" /></svg>,
  settings: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="17" r="2" /></svg>,
  game: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 9l-2 6m-1-2h4M14 8h.01M18 8h.01M9.5 11.5h.01M17 10h.01" /><rect x="2.5" y="7" width="19" height="11" rx="5" /></svg>,
  lab: <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 2.5v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5v-6M9 2.5h6M9.5 14h5" /></svg>,
};

const NAV = [
  { group: 'nav.overview' },
  { to: '/dashboard', label: 'nav.dashboard', icon: I.home },
  { to: '/steam', label: 'nav.steamLibrary', icon: I.game },
  { group: 'nav.player' },
  { to: '/profile', label: 'nav.profile', icon: I.profile },
  { to: '/sessions', label: 'nav.sessionTracker', icon: I.sessions },
  { to: '/performance', label: 'nav.performance', icon: I.stats },
  { to: '/streak', label: 'nav.improvementStreak', icon: I.streak },
  { to: '/weekly-report', label: 'nav.aiWeeklyReport', icon: I.report },
  { to: '/ai/coach', label: 'nav.aiCoach', icon: I.stats },
  { to: '/ai/chat', label: 'nav.aiChat', icon: I.report },
  { to: '/friends', label: 'nav.friends', icon: I.friends },
  { group: 'nav.pcHardware' },
  { to: '/pc', label: 'nav.pcHub', icon: I.pc },
  { to: '/pc/my', label: 'nav.pcMy', icon: I.pc },
  { to: '/pc/builder', label: 'nav.aiPcBuilder', icon: I.builder },
  { to: '/pc/compatibility', label: 'nav.compatibility', icon: I.check },
  { to: '/pc/fps', label: 'nav.fpsCalculator', icon: I.fps },
  { to: '/pc/upgrade', label: 'nav.upgradeAdvisor', icon: I.upgrade },
  { to: '/pc/settings', label: 'nav.gameSettings', icon: I.gear },
  { to: '/pc/hardware', label: 'nav.hardwareCatalog', icon: I.game },
  { to: '/pc/compare', label: 'nav.compare', icon: I.compare },
  { to: '/pc/troubleshooter', label: 'nav.troubleshooter', icon: I.gear },
  { to: '/pc/scan', label: 'nav.scanner', icon: I.fps },
  { to: '/pc/library', label: 'nav.library', icon: I.game },
  { group: 'nav.community' },
  { to: '/community/benchmarks', label: 'nav.communityBench', icon: I.lab },
  { group: 'nav.account' },
  { to: '/pricing', label: 'nav.pricing', icon: I.upgrade },
  { to: '/settings', label: 'nav.settings', icon: I.settings },
  { group: 'nav.resources' },
  { to: '/blog', label: 'nav.blog', icon: I.report },
];

const MOBILE = [
  { to: '/dashboard', label: 'nav.home', icon: I.home },
  { to: '/steam', label: 'nav.steam', icon: I.game },
  { to: '/ai/coach', label: 'nav.coach', icon: I.stats },
  { to: '/ai/chat', label: 'nav.ai', icon: I.report },
  { to: '/sessions', label: 'nav.sessions', icon: I.sessions },
  { to: '/pc/builder', label: 'nav.pcBuilder', icon: I.builder },
  { to: '/pc/compare', label: 'nav.compare', icon: I.compare },
  { to: '/pc/fps', label: 'nav.fps', icon: I.fps },
  { to: '/profile', label: 'nav.profile', icon: I.profile },
];

export function Sidebar({ open, onClose }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const onLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    localStorage.removeItem('gpp_token');
    navigate('/');
    window.location.reload();
  };
  return (
    <aside className="sidebar" style={open ? { display: 'flex' } : undefined}>
      <div className="brand">
        <div className="logo"><img src="/logo/logo-inverse.png" alt="" /></div>
        <div>
          <span>LevelCore</span>
          <small>{t('nav.gamingPerformance')}</small>
        </div>
      </div>
      {NAV.map((n, i) => n.group
        ? <div key={i} className="nav-group">{t(n.group)}</div>
        : (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={onClose}>
            {n.icon}
            <span>{t(n.label)}</span>
            {n.to === '/streak' && profile?.onboarded && <span className="pill" />}
          </NavLink>
        ))}
      <div className="spacer" />
      <div className="nav-item" style={{ padding: '6px 10px' }}>
        <LanguageSwitcher compact />
      </div>
      <NavLink to="/admin/login" className="nav-item">{I.check} <span>{t('nav.admin')}</span></NavLink>
      <div className="nav-item" onClick={onLogout} style={{ color: 'var(--text-faint)' }}>
        {I.logout} <span>{t('nav.signOut')} {user?.username}</span>
      </div>
    </aside>
  );
}

export function Topbar({ title, streak }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) return;
    api.get('/billing/me').then((d) => setCredits(d.wallet?.balance ?? 0)).catch(() => {});
  }, [user]);
  return (
    <>
      <div className="topbar">
        <button className="burger" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>☰</button>
        <div className="crumbs"><b>{title}</b></div>
        <div className="right">
          <LanguageSwitcher compact />
          {credits != null && (
            <button className="badge badge-primary" onClick={() => navigate('/pricing')} title={t('pricing.balanceTitle')}>
              {t('pricing.creditsShort', { n: credits })}
            </button>
          )}
          {streak != null && (
            <div className="badge" title={t('topbar.streakTitle')}><span className="flame">🔥</span> {streak} {t('topbar.streakDays')}</div>
          )}
          <div className="badge badge-primary">{profile?.rank || t('common.unranked')}</div>
          <button className="btn btn-sm" onClick={() => navigate('/profile')}>{user?.username}</button>
        </div>
      </div>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,0.5)', display: 'flex' }}>
        <Sidebar open onClose={() => setOpen(false)} />
        <div style={{ flex: 1 }} onClick={() => setOpen(false)} />
      </div>}
      <nav className="mobile-nav">
        <div className="row">
          {MOBILE.map((m) => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => `item${isActive ? ' active' : ''}`}>
              {m.icon}{t(m.label)}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
