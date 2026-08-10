// Clan membership context — the single source of the app's accent. Loads
// /me/clan on sign-in; the user's clan color (or a neutral slate when solo)
// tints the tab bar, Record button, trails, and stat highlights.
//
// This retires the v1 hash-team accent: `useAccent()` now reads clan color.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { fetchAndCache, getCached } from '../api/cache';
import { useAuth } from '../auth/AuthContext';

// Neutral slate for solo runners — never a saturated hue.
export const NEUTRAL = { fill: 'rgba(100,116,139,0.20)', stroke: '#64748b', glow: '#94a3b8' };

const ClanContext = createContext({
  clan: null,
  color: NEUTRAL,
  accent: NEUTRAL.stroke,
  loading: true,
  refresh: () => {},
});

export function ClanProvider({ children }) {
  const { signedIn } = useAuth();
  // Seeded from cache: the clan colour IS the app's accent, so starting at
  // null painted the tab bar, the Record button and every stat highlight
  // neutral slate for one round trip on launch and then recoloured them.
  const [clan, setClan] = useState(() => {
    const cached = getCached('me:clan');
    return cached?.clan_id ? cached : null;
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setClan(null);
      setLoading(false);
      return;
    }
    try {
      const me = await fetchAndCache('me:clan', api.myClan);
      setClan(me?.clan_id ? me : null);
    } catch {
      // Keep whatever we had (usually the cached clan) rather than dropping
      // the whole app to the solo accent because one request timed out.
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => {
    const color = clan?.color || NEUTRAL;
    return { clan, color, accent: color.stroke, loading, refresh };
  }, [clan, loading, refresh]);

  return <ClanContext.Provider value={value}>{children}</ClanContext.Provider>;
}

export function useClan() {
  return useContext(ClanContext);
}
