import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

import { api, setAuthToken } from '../api/client';

const TOKEN_KEY = 'tr.token';
const USER_KEY = 'tr.user';

// Silently swap the token for a fresh one when it's this close to expiry.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Seconds-since-epoch expiry from a JWT, or null if unparseable.
function tokenExpiryMs(token) {
  try {
    const payload = token.split('.')[1];
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(globalThis.atob(b64));
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True only right after a brand-new account is created, so the app can
  // run the onboarding intro once for that user. Existing users who log in
  // (or are restored from a saved token) never see it.
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Restore on launch.
  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUserJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (savedToken) {
          setAuthToken(savedToken);
          setToken(savedToken);
          if (savedUserJson) setUser(JSON.parse(savedUserJson));
          // Verify the token is still valid against /me. If it's not,
          // sign the user out cleanly so they see Login on next render.
          try {
            const me = await api.me();
            setUser(me);
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me));

            // Silent refresh: if the 30-day token is inside the renewal
            // window, swap it for a fresh one. Failure is non-fatal — the
            // old token still works until it actually expires.
            const expMs = tokenExpiryMs(savedToken);
            if (expMs && expMs - Date.now() < REFRESH_WINDOW_MS) {
              try {
                const refreshed = await api.refresh();
                setAuthToken(refreshed.access_token);
                setToken(refreshed.access_token);
                await SecureStore.setItemAsync(TOKEN_KEY, refreshed.access_token);
              } catch {}
            }
          } catch {
            await clearStored();
            setAuthToken(null);
            setToken(null);
            setUser(null);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (t, u) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, t),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(u)),
    ]);
  };

  const clearStored = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  };

  const signIn = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (username, password) => {
    const res = await api.signup(username, password);
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    setNeedsOnboarding(true); // new account → show the intro once
  }, []);

  // OAuth sign-in (Google / Apple). `idToken` is the provider's identity
  // token; the backend verifies it and returns our own session. New users are
  // routed through onboarding just like a fresh signup.
  const signInWithProvider = useCallback(async (provider, idToken, extra = {}) => {
    const res = await api.oauthLogin(provider, idToken, extra);
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    if (res.created) setNeedsOnboarding(true);
  }, []);

  const completeOnboarding = useCallback(() => {
    setNeedsOnboarding(false);
  }, []);

  const signOut = useCallback(async () => {
    await clearStored();
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setNeedsOnboarding(false);
  }, []);

  const updateUsername = useCallback(async (next) => {
    const updated = await api.renameMe(next);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
    setUser(updated);
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.deleteMe();
    await clearStored();
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      signedIn: !!token,
      needsOnboarding,
      signIn,
      signUp,
      signInWithProvider,
      signOut,
      completeOnboarding,
      updateUsername,
      deleteAccount,
    }),
    [
      token,
      user,
      loading,
      needsOnboarding,
      signIn,
      signUp,
      signInWithProvider,
      signOut,
      completeOnboarding,
      updateUsername,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
