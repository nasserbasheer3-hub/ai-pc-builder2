import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './components/ui.jsx';
import CookieConsent from './components/CookieConsent.jsx';
import { I18nProvider } from './i18n/index.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
          <CookieConsent />
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  </BrowserRouter>
);
