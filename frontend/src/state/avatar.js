// Avatar context — the user's equipped cosmetics, rank tier + unlock state.
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
import { fetchAndCache, getCached } from '../api/cache';
import { useAuth } from '../auth/AuthContext';
import { useClan } from './clan';
import {
  DEFAULT_EQUIPPED,
  equippedImageSources,
  isUnlocked as itemUnlocked,
  unlockSet,
  randomEquipped,
} from '../config/cosmetics';
import { BORDER_ART } from '../config/borderArt';
import { preloadImages } from '../utils/imagePreload';
import { renderWatchAvatar } from '../watch/watchAvatar';

// v2 = the real-art catalog (face/hair/glasses/top/bottom ids). v1 loadouts
// referenced the retired SVG catalog, so v2 starts fresh (studio shows once).
const keyFor = (user) => `avatar:v2:${user?.id || user?.user_id || user?.username || 'anon'}`;

const AvatarContext = createContext({
  equipped: DEFAULT_EQUIPPED,
  rankKey: 'wood',
  refreshRank: async () => {},
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
  // Seeded from the response cache. `rankKey` is derived from stats, and
  // starting at null meant every portrait in the app drew the WOOD border for
  // the length of a /me/stats round trip and then visibly swapped to the real
  // tier on launch. The cached tier is right virtually always, and the fetch
  // below corrects it either way.
  const [stats, setStats] = useState(() => getCached('me:stats') ?? null);
  const [unlocks, setUnlocks] = useState(() => unlockSet(getCached('me:progression')?.unlocks));
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
      .then(async (raw) => {
        if (!alive) return;
        let nextEquipped = DEFAULT_EQUIPPED;
        if (raw) {
          const loaded = { ...DEFAULT_EQUIPPED, ...JSON.parse(raw) };
          nextEquipped = loaded;
          setEquipped(loaded);
          setNeedsSetup(false);
          // Backfill the server copy for pre-existing users who set their
          // avatar before it was stored server-side.
          api.setAvatar(loaded).catch(() => {});
        } else {
          setEquipped(DEFAULT_EQUIPPED);
          setNeedsSetup(true);
        }
        // RootNavigator already waits for this provider, so the saved runner
        // gets decoded here and its layers do not pop in separately on Home,
        // You, or the customisation screen. It is a BUDGET, not a barrier —
        // a cold image cache must not add seconds to launch, and the effect
        // below re-warms whatever missed the window.
        await Promise.race([
          preloadImages(equippedImageSources(nextEquipped)),
          new Promise((resolve) => setTimeout(resolve, 600)),
        ]);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    fetchAndCache('me:stats', api.meStats).then((s) => alive && setStats(s)).catch(() => {});
    // Server-granted cosmetics (premium pass tiers, lootbox rolls) — these
    // beat the stat gates, so the studio can't tell what's equippable
    // without them.
    fetchAndCache('me:progression', api.progression)
      .then((p) => alive && setUnlocks(unlockSet(p?.unlocks)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn, user?.username]);

  const unlockCtx = useMemo(
    () => ({ stats, hasClan: !!clan?.clan_id, unlocks }),
    [stats, clan?.clan_id, unlocks]
  );

  const isUnlocked = useCallback((item) => itemUnlocked(item, unlockCtx), [unlockCtx]);

  // Re-pull server-granted unlocks. The shop calls this after a coin purchase
  // so the item is equippable immediately instead of after an app restart.
  const refreshUnlocks = useCallback(async () => {
    try {
      const p = await fetchAndCache('me:progression', api.progression);
      setUnlocks(unlockSet(p?.unlocks));
    } catch {
      // Non-fatal: the studio just keeps the unlocks it already had.
    }
  }, []);

  // Re-read /me/stats. Rank moves DURING a session — claim a zone, finish a
  // run — and this context used to fetch stats once at sign-in and never
  // again, so `rankKey` stayed on whatever tier you signed in at. Screens that
  // fetch their own stats (You, the pass) looked right while anything reading
  // the context (the rivalry card on Home) kept drawing the stale frame.
  const refreshRank = useCallback(async () => {
    try {
      setStats(await fetchAndCache('me:stats', api.meStats));
    } catch {
      // Non-fatal: keep the tier we already had rather than dropping to wood.
    }
  }, []);

  const persist = useCallback(
    (next) => {
      AsyncStorage.setItem(keyFor(user), JSON.stringify(next)).catch(() => {});
      // Mirror to the server so other players can render this character on
      // feeds/cards. Best-effort — a failure never blocks local editing.
      if (signedIn) api.setAvatar(next).catch(() => {});
      
      // Trigger Watch avatar update (best-effort, non-blocking)
      // Avatar rendering will be implemented when the view context is available
      // renderWatchAvatar(next).catch(() => {});
    },
    [user?.username, signedIn]
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

  // The viewer's own border tier. It rides along with the loadout because it
  // is the other half of drawing YOUR portrait, and /me/stats is already
  // fetched here for the unlock gates — no second round trip. Other runners'
  // tiers arrive as `rank_key` on whatever payload carries their avatar.
  const rankKey = stats?.rank_key || 'wood';

  useEffect(() => {
    if (!signedIn) return;
    preloadImages([
      ...equippedImageSources(equipped),
      BORDER_ART[rankKey]?.src,
    ]);
  }, [equipped, rankKey, signedIn]);

  const value = useMemo(
    () => ({ equipped, rankKey, setPart, randomize, save, isUnlocked, unlockCtx, needsSetup,
             loading, refreshUnlocks, refreshRank }),
    [equipped, rankKey, setPart, randomize, save, isUnlocked, unlockCtx, needsSetup, loading,
     refreshUnlocks, refreshRank]
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatar() {
  return useContext(AvatarContext);
}
