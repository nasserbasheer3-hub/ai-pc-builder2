import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import sv from './sv.js';
import ar from './ar.js';

const DICTS = { en, sv, ar };
const STORAGE_KEY = 'gpp_lang';
const DIRS = { ar: 'rtl' };

const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && DICTS[saved] ? saved : 'en';
    } catch { return 'en'; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = DIRS[lang] || 'ltr';
    document.body.dataset.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    const dict = DICTS[lang] || en;
    const t = (key, vars) => {
      let s = dict[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return s;
    };
    return { lang, setLang, dir: DIRS[lang] || 'ltr', t };
  }, [lang]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>.');
  return ctx;
}

const LANGS = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
];

export function LanguageSwitcher({ compact = false }) {
  const { lang, setLang } = useI18n();
  return (
    <select
      className="select lang-switcher"
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      aria-label="Language"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>{compact ? l.flag : `${l.flag} ${l.label}`}</option>
      ))}
    </select>
  );
}
