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
import { clearCache, setCacheOwner } from '../api/cache';

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
  // Provider identity data is deliberately ephemeral. Apple gives the name to
  // the native client (not in its ID token), so it lives here only until the
  // new-account flow has written the per-account local profile.
  const [onboardingIdentity, setOnboardingIdentity] = useState(null);

  // Restore on launch.
  //
  // The saved token is the source of truth for "signed in", so a returning
  // user goes straight into the app on the cached identity and the /me check
  // runs in the BACKGROUND. Launch used to block on that round trip, which put
  // every cold start behind a server wake-up — and on a slow or absent network
  // it held the loading mascot on screen for as long as the socket stayed open.
  useEffect(() => {
    let alive = true;

    // Silent refresh: if the 30-day token is inside the renewal window, swap
    // it for a fresh one. Failure is non-fatal — the old token still works
    // until it actually expires.
    const maybeRefresh = async (savedToken) => {
      const expMs = tokenExpiryMs(savedToken);
      if (!expMs || expMs - Date.now() >= REFRESH_WINDOW_MS) return;
      try {
        const refreshed = await api.refresh();
        if (!alive) return;
        setAuthToken(refreshed.access_token);
        setToken(refreshed.access_token);
        await SecureStore.setItemAsync(TOKEN_KEY, refreshed.access_token);
      } catch {}
    };

    // Confirm the session against the server. Only a 401/403 is a verdict on
    // the token; offline, timeout and 5xx are not, and the local session
    // stands. (Clearing on *any* failure — the previous behaviour — signed
    // people out whenever they opened the app without a connection.)
    const verify = async (savedToken) => {
      try {
        const me = await api.me({ timeoutMs: 10000 });
        if (!alive) return;
        setUser(me);
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(me)).catch(() => {});
        await maybeRefresh(savedToken);
      } catch (e) {
        if (e?.status !== 401 && e?.status !== 403) return;
        await clearStored();
        clearCache();
        if (!alive) return;
        setAuthToken(null);
        setToken(null);
        setUser(null);
      }
    };

    (async () => {
      try {
        const [savedToken, savedUserJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (!savedToken || !alive) return;

        // Already past its own expiry — no point asking the server.
        const expMs = tokenExpiryMs(savedToken);
        if (expMs && expMs <= Date.now()) {
          await clearStored();
          return;
        }

        let cached = null;
        try {
          cached = savedUserJson ? JSON.parse(savedUserJson) : null;
        } catch {}

        setAuthToken(savedToken);
        if (!alive) return;
        setToken(savedToken);

        if (cached) {
          // Enough to render the whole app — verify behind it.
          setUser(cached);
          setLoading(false);
          verify(savedToken);
        } else {
          // No cached identity: the per-user storage keys (avatar loadout,
          // profile) would resolve to 'anon', so this one case still waits.
          await verify(savedToken);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Cached responses belong to the account that fetched them. Naming the owner
  // lets the cache drop itself wholesale when a different user signs in on the
  // same device, so nobody ever sees the previous account's feed flash by.
  useEffect(() => {
    if (user) setCacheOwner(String(user.id ?? user.user_id ?? user.username));
  }, [user?.id, user?.user_id, user?.username]);

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
    setOnboardingIdentity(null);
  }, []);

  const signUp = useCallback(async (username, password, email) => {
    const res = await api.signup(username, password, email);
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    setOnboardingIdentity(null);
    setNeedsOnboarding(true); // new account → show the intro once
  }, []);

  // A finished password reset hands back a session exactly like a login, so it
  // is adopted the same way. Not treated as a new account: this runner has
  // been here all along and does not want the intro again.
  const adoptSession = useCallback(async (res) => {
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    setOnboardingIdentity(null);
  }, []);

  // Pull /me again after something changed the account off to the side (the
  // recovery email, mostly), so the cached identity the app renders from does
  // not keep saying the account has no way back in.
  const refreshUser = useCallback(async () => {
    const me = await api.me();
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me));
    setUser(me);
    return me;
  }, []);

  // OAuth sign-in (Google / Apple). `idToken` is the provider's identity
  // token; the backend verifies it and returns our own session. New users are
  // routed through onboarding just like a fresh signup.
  const signInWithProvider = useCallback(async (provider, idToken, extra = {}) => {
    // onboardingIdentity is client-only: Apple's raw name is not part of the
    // server credential and must not be mixed into the auth request contract.
    const { onboardingIdentity: suppliedIdentity, ...requestExtra } = extra;
    const res = await api.oauthLogin(provider, idToken, requestExtra);
    setAuthToken(res.access_token);
    await persist(res.access_token, res.user);
    setToken(res.access_token);
    setUser(res.user);
    if (res.created) {
      setOnboardingIdentity({
        provider,
        firstName: suppliedIdentity?.firstName || '',
        lastName: suppliedIdentity?.lastName || '',
      });
      setNeedsOnboarding(true);
    } else {
      setOnboardingIdentity(null);
    }
  }, []);

  const completeOnboarding = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingIdentity(null);
  }, []);

  const signOut = useCallback(async () => {
    await clearStored();
    clearCache();
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setNeedsOnboarding(false);
    setOnboardingIdentity(null);
  }, []);

  const updateUsername = useCallback(async (next) => {
    const updated = await api.renameMe(next);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
    setUser(updated);
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.deleteMe();
    await clearStored();
    clearCache();
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setNeedsOnboarding(false);
    setOnboardingIdentity(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      signedIn: !!token,
      needsOnboarding,
      onboardingIdentity,
      signIn,
      signUp,
      signInWithProvider,
      adoptSession,
      refreshUser,
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
      onboardingIdentity,
      signIn,
      signUp,
      signInWithProvider,
      adoptSession,
      refreshUser,
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
