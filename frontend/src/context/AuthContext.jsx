import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api/client';
import { analyticsAllowed, getUtm, setUserId } from '../utils/analytics.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const boot = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setProfile(data.profile);
      setUserId(data.user?.id);
    } catch {
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    setUserId(data.user?.id);
    const me = await api.get('/auth/me');
    setProfile(me.profile);
    return data;
  }, []);

  const register = useCallback(async (payload) => {
    const body = { ...payload, appUrl: window.location.origin };
    // Only attach campaign attribution for visitors who accepted analytics,
    // matching the consent promise shown in the cookie banner.
    if (analyticsAllowed()) {
      const utm = getUtm();
      const utmBody = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term']
        .reduce((acc, k) => { if (utm[k]) acc[k] = utm[k]; return acc; }, {});
      if (Object.keys(utmBody).length) body.utm = utmBody;
    }
    const data = await api.post('/auth/register', body);
    setToken(data.token);
    setUser(data.user);
    setUserId(data.user?.id);
    const me = await api.get('/auth/me');
    setProfile(me.profile);
    return data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api.get('/auth/me');
    setUser(me.user);
    setProfile(me.profile);
    setUserId(me.user?.id);
    return me;
  }, []);

  const value = {
    user, profile, loading, login, register, logout, refresh,
    setProfile: (p) => setProfile(p),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
