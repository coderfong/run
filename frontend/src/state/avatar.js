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

// v2 = the real-art catalog (face/hair/glasses/top/bottom ids). v1 loadouts
// referenced the retired SVG catalog, so v2 starts fresh (studio shows once).
const keyFor = (user) => `avatar:v2:${user?.id || user?.user_id || user?.username || 'anon'}`;

// How long launch may wait on /me for a device with no saved runner. It only
// happens on a fresh install or a new phone, never on an ordinary launch.
const SERVER_AVATAR_WAIT_MS = 6000;

/**
 * The loadout the SERVER holds for this account. `known` is false when the
 * question could not be answered (offline, a cold server, a backend from
 * before /me carried `avatar`), which callers must read as "do not know",
 * never as "has none".
 */
export async function serverAvatar(user, fetchMe = () => api.me()) {
  if (user && Object.prototype.hasOwnProperty.call(user, 'avatar')) {
    return { known: true, avatar: user.avatar || null };
  }
  try {
    const me = await Promise.race([
      fetchMe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SERVER_AVATAR_WAIT_MS)),
    ]);
    if (me && Object.prototype.hasOwnProperty.call(me, 'avatar')) {
      return { known: true, avatar: me.avatar || null };
    }
  } catch {
    // Unknown, below.
  }
  return { known: false, avatar: null };
}

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
          // NOTHING ON THIS DEVICE IS NOT "NEVER MADE A RUNNER". A reinstall,
          // a new phone or a cleared app all land here, and this used to send
          // every one of those veterans back through the character intro. The
          // server keeps the loadout (`users.avatar`, returned on /me), so it
          // decides: a saved runner is adopted and kept on the device again;
          // only a server that CONFIRMS there is none asks for setup. If the
          // server cannot be asked, nothing is shown: a brand new account
          // gets the whole intro from sign up anyway (needsOnboarding), and a
          // runner can always dress in the studio.
          const server = await serverAvatar(user);
          if (!alive) return;
          if (server.known && server.avatar) {
            const restored = { ...DEFAULT_EQUIPPED, ...server.avatar };
            nextEquipped = restored;
            setEquipped(restored);
            setNeedsSetup(false);
            AsyncStorage.setItem(keyFor(user), JSON.stringify(restored)).catch(() => {});
          } else {
            setEquipped(DEFAULT_EQUIPPED);
            setNeedsSetup(server.known);
          }
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
      // The Apple Watch portrait is NOT pushed from here. It is a rasterised
      // drawing of this loadout, so it needs a rig on screen to capture, and
      // the component that owns one watches `equipped` from the app root
      // (WatchAvatarSync in src/watch/watchAvatar.js).
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
