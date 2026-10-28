import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api";
import { registerForPushNotificationsAsync, unregisterPushNotificationsAsync } from "./push-notifications";

interface AuthContextValue {
  user: api.AuthUser | null;
  /** True only while the initial session check is running (app cold start). */
  bootstrapping: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string; errors?: string[] }>;
  register: (email: string, password: string, name: string) => Promise<{ ok: true } | { ok: false; message: string; errors?: string[] }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The mobile app's single source of "who is signed in." Backed entirely by the real
 * server session (src/lib/auth/, src/app/api/auth/*) — this context never invents
 * identity locally, it just caches what /api/auth/me returned.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await api.getSessionToken();
      if (!token) {
        setBootstrapping(false);
        return;
      }
      const result = await api.getCurrentUser();
      if (result.ok) setUser(result.data.user);
      else await api.clearSessionToken(); // stale/expired token — clear it silently
      setBootstrapping(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    if (result.ok) {
      setUser(result.data.user);
      return { ok: true as const };
    }
    return { ok: false as const, message: result.message, errors: result.errors };
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const result = await api.register(email, password, name);
    if (result.ok) {
      setUser(result.data.user);
      return { ok: true as const };
    }
    return { ok: false as const, message: result.message, errors: result.errors };
  }, []);

  const logout = useCallback(async () => {
    await unregisterPushNotificationsAsync();
    await api.logout();
    setUser(null);
  }, []);

  // Registers this device for push once a real, authenticated user is established —
  // covers login, registration, AND the silent session-restore on cold start (the effect
  // above already sets `user` in that case too). Keyed on the user's id (not the whole
  // object) so an unrelated re-render never re-triggers a permission prompt/token
  // re-registration; the underlying call is idempotent server-side regardless.
  useEffect(() => {
    if (!user) return;
    registerForPushNotificationsAsync();
  }, [user?.id]);

  const value = useMemo(() => ({ user, bootstrapping, login, register, logout }), [user, bootstrapping, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
