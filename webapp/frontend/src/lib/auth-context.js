'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import Cookies from 'js-cookie';
import { authApi } from './api';

const AuthContext = createContext(null);

const COOKIE_OPTS = { secure: true, sameSite: 'strict', expires: 1 };

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = Cookies.get('user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  // updateUser merges a partial update into state AND the persisted cookie
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      if (next) Cookies.set('user', JSON.stringify(next), COOKIE_OPTS);
      return next;
    });
  }, []);

  const login = useCallback(async (email, password, totp) => {
    const payload = { email, password };
    if (totp) payload.totp = totp;
    const res = await authApi.login(payload);
    if (res.data.mfa_required) return { mfa_required: true };

    const { token, user: u } = res.data;
    Cookies.set('token', token, COOKIE_OPTS);
    Cookies.set('user',  JSON.stringify(u), COOKIE_OPTS);
    setUser(u);
    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    Cookies.remove('token');
    Cookies.remove('user');
    setUser(null);
  }, []);

  const register = useCallback(async (data) => {
    const res = await authApi.register(data);
    return res.data;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
