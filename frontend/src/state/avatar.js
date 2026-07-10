// Avatar context — the user's equipped cosmetics + unlock state.
//
// Equipped loadout persists locally (AsyncStorage, keyed per user) so it
// survives restarts and works offline. Unlocks are evaluated client-side
// against /me/stats + clan membership (config/cosmetics.js owns the rules).
// `needsSetup` is true until the user saves an avatar once — the root
// navigator uses it to show the studio right after onboarding.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useClan } from './clan';
import {
  DEFAULT_EQUIPPED,
  isUnlocked as itemUnlocked,
  randomEquipped,
} from '../config/cosmetics';

// v2 = the real-art catalog (face/hair/glasses/top/bottom ids). v1 loadouts
// referenced the retired SVG catalog, so v2 starts fresh (studio shows once).
const keyFor = (user) => `avatar:v2:${user?.id || user?.user_id || user?.username || 'anon'}`;

const AvatarContext = createContext({
  equipped: DEFAULT_EQUIPPED,
  setPart: () => {},
  randomize: () => {},
  save: async () => {},
  isUnlocked: () => true,
  unlockCtx: { stats: null, hasClan: false },
  needsSetup: false,
  loading: true,
});

export function AvatarProvider({ children }) {
  const { signedIn, user } = useAuth();
  const { clan } = useClan();

  const [equipped, setEquipped] = useState(DEFAULT_EQUIPPED);
  const [stats, setStats] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load saved loadout (and current stats for unlock checks) on sign-in.
  useEffect(() => {
    let alive = true;
    if (!signedIn) {
      setEquipped(DEFAULT_EQUIPPED);
      setNeedsSetup(false);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    AsyncStorage.getItem(keyFor(user))
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          setEquipped({ ...DEFAULT_EQUIPPED, ...JSON.parse(raw) });
          setNeedsSetup(false);
        } else {
          setEquipped(DEFAULT_EQUIPPED);
          setNeedsSetup(true);
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    api.meStats().then((s) => alive && setStats(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn, user?.username]);

  const unlockCtx = useMemo(
    () => ({ stats, hasClan: !!clan?.clan_id }),
    [stats, clan?.clan_id]
  );

  const isUnlocked = useCallback((item) => itemUnlocked(item, unlockCtx), [unlockCtx]);

  const persist = useCallback(
    (next) => AsyncStorage.setItem(keyFor(user), JSON.stringify(next)).catch(() => {}),
    [user?.username]
  );

  // Equip one part (and auto-persist — the studio edits are always live).
  const setPart = useCallback(
    (patch) => {
      setEquipped((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const randomize = useCallback(() => {
    const next = randomEquipped(unlockCtx);
    setEquipped(next);
    persist(next);
  }, [unlockCtx, persist]);

  // Marks first-time setup complete (called by the onboarding studio CTA).
  const save = useCallback(async () => {
    await persist(equipped);
    setNeedsSetup(false);
  }, [equipped, persist]);

  const value = useMemo(
    () => ({ equipped, setPart, randomize, save, isUnlocked, unlockCtx, needsSetup, loading }),
    [equipped, setPart, randomize, save, isUnlocked, unlockCtx, needsSetup, loading]
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatar() {
  return useContext(AvatarContext);
}
