import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readSession, writeSession, SESSION_EXPIRED_EVENT } from '../api/client';
import { sesiones } from '../api/resources';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onExpired = () => { setSession(null); setExpired(true); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Comprueba en segundo plano que el token guardado siga vigente.
  useEffect(() => {
    if (session?.token) sesiones.actual().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async ({ email, password, baseDatos }) => {
    const data = await sesiones.login({ email, password, baseDatos });
    if (!data?.token) throw new Error('El servidor no devolvió un token de sesión.');
    const next = {
      token: data.token,
      baseDatos: data.baseDatos || baseDatos,
      usuarioId: data.usuarioId,
      expiraEn: data.expiraEn,
      email,
    };
    writeSession(next);
    setExpired(false);
    setSession(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    try { await sesiones.logout(); } catch { /* la sesión local se cierra de todos modos */ }
    writeSession(null);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, login, logout, expired }), [session, login, logout, expired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return ctx;
}
