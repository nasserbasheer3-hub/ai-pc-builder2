import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api/client';

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
    const me = await api.get('/auth/me');
    setProfile(me.profile);
    return data;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.post('/auth/register', { ...payload, appUrl: window.location.origin });
    setToken(data.token);
    setUser(data.user);
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
