import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { LoadingBlock } from './components/ui.jsx';
import { Sidebar, Topbar } from './components/Layout.jsx';
import { useI18n } from './i18n/index.jsx';
import { api } from './api/client.js';
import { captureUtm } from './utils/analytics.js';

const Landing = lazy(() => import('./pages/Landing.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Signup = lazy(() => import('./pages/Signup.jsx'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const ProfilePage = lazy(() => import('./pages/Profile.jsx'));
const SessionsPage = lazy(() => import('./pages/Sessions.jsx'));
const PerformancePage = lazy(() => import('./pages/Performance.jsx'));
const StreakPage = lazy(() => import('./pages/Streak.jsx'));
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReport.jsx'));
const FriendsPage = lazy(() => import('./pages/Friends.jsx'));
const AiChat = lazy(() => import('./pages/AiChat.jsx'));
const AiCoach = lazy(() => import('./pages/AiCoach.jsx'));
const Steam = lazy(() => import('./pages/Steam.jsx'));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const PcHub = lazy(() => import('./pages/PcHub.jsx'));
const PcBuilder = lazy(() => import('./pages/PcBuilder.jsx'));
const PcCompatibility = lazy(() => import('./pages/PcCompatibility.jsx'));
const PcFps = lazy(() => import('./pages/PcFps.jsx'));
const PcBottleneck = lazy(() => import('./pages/PcBottleneck.jsx'));
const PcPsu = lazy(() => import('./pages/PcPsu.jsx'));
const PcGameCheck = lazy(() => import('./pages/PcGameCheck.jsx'));
const PcMy = lazy(() => import('./pages/PcMy.jsx'));
const SharedBuild = lazy(() => import('./pages/SharedBuild.jsx'));
const TryBuilder = lazy(() => import('./pages/TryBuilder.jsx'));
const PublicProfile = lazy(() => import('./pages/PublicProfile.jsx'));
const PcUpgrade = lazy(() => import('./pages/PcUpgrade.jsx'));
const PcTroubleshooter = lazy(() => import('./pages/PcTroubleshooter.jsx'));
const PcSmartScanner = lazy(() => import('./pages/PcSmartScanner.jsx'));
const PcGameScanner = lazy(() => import('./pages/PcGameScanner.jsx'));
const PcSettings = lazy(() => import('./pages/PcSettings.jsx'));
const PcHardware = lazy(() => import('./pages/PcHardware.jsx'));
const Blog = lazy(() => import('./pages/Blog.jsx'));
const ArticlePage = lazy(() => import('./pages/Article.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const AdminSetup = lazy(() => import('./pages/AdminSetup.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const Contact = lazy(() => import('./pages/Contact.jsx'));
const Compare = lazy(() => import('./pages/Compare.jsx'));
const CommunityBenchmarks = lazy(() => import('./pages/CommunityBenchmarks.jsx'));
const Pricing = lazy(() => import('./pages/Pricing.jsx'));
const Footer = lazy(() => import('./components/Footer.jsx'));

function PageLoading() {
  return <div className="page"><LoadingBlock text="…" /></div>;
}

function PublicLayout() {
  return (
    <>
      <Outlet />
      <Suspense fallback={null}><Footer /></Suspense>
    </>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <div className="page"><LoadingBlock text={t('common.loadingDashboard')} /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function ShellWithStreak() {
  const { user } = useAuth();
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    if (!user) return;
    api.get('/streak').then((d) => setStreak(d.current)).catch(() => {});
  }, [user]);
  return (
    <div className="app-shell">
      <div className="bg-fx" /><div className="bg-grid" />
      <Sidebar />
      <main className="app-main">
        <Topbar title="" streak={streak} />
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <UtmCapture>
        <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<ArticlePage />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/setup" element={<AdminSetup />} />
          <Route path="/privacy" element={<LegalPage page="privacy" />} />
          <Route path="/terms" element={<LegalPage page="terms" />} />
          <Route path="/about" element={<LegalPage page="about" />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/pc/compare" element={<Compare />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/try" element={<TryBuilder />} />
          <Route path="/pc/shared/:slug" element={<SharedBuild />} />
          <Route path="/u/:slug" element={<PublicProfile />} />
        </Route>

        <Route element={<Protected />}>
          <Route element={<ShellWithStreak />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/streak" element={<StreakPage />} />
            <Route path="/weekly-report" element={<WeeklyReportPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/ai/chat" element={<AiChat />} />
            <Route path="/ai/coach" element={<AiCoach />} />
            <Route path="/steam" element={<Steam />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/pc" element={<PcHub />} />
            <Route path="/pc/builder" element={<PcBuilder />} />
            <Route path="/pc/compatibility" element={<PcCompatibility />} />
            <Route path="/pc/fps" element={<PcFps />} />
            <Route path="/pc/bottleneck" element={<PcBottleneck />} />
            <Route path="/pc/psu" element={<PcPsu />} />
            <Route path="/pc/gamecheck" element={<PcGameCheck />} />
            <Route path="/pc/my" element={<PcMy />} />
            <Route path="/pc/upgrade" element={<PcUpgrade />} />
            <Route path="/pc/troubleshooter" element={<PcTroubleshooter />} />
            <Route path="/pc/scan" element={<PcSmartScanner />} />
            <Route path="/pc/library" element={<PcGameScanner />} />
            <Route path="/pc/settings" element={<PcSettings />} />
            <Route path="/community/benchmarks" element={<CommunityBenchmarks />} />
          <Route path="/pc/hardware" element={<PcHardware />} />
          <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </UtmCapture>
    </Suspense>
  );
}

function UtmCapture({ children }) {
  const location = useLocation();
  useEffect(() => { captureUtm(); }, [location.pathname, location.search]);
  return children;
}
