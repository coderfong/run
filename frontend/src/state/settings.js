// Local app settings persisted on-device (AsyncStorage). Currently just the
// trail glow colour used while recording a run: 'clan' follows the clan
// accent; any other key picks a fixed neon from TRAIL_GLOW_COLORS.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TRAIL_GLOW_KEY = 'tr.settings.trailGlow';

// value: null means "use the clan accent" (the pre-setting behaviour).
//
// `pro: true` marks a colour as PASER PRO expression — a wider palette to run
// in, and nothing more. Trail colour tints your trail and your own land's
// outline; it wins no ground and changes no number, so gating some of it is
// depth, not power (the line in config/pro.js). Everyone keeps the club colour
// and a full handful of neons; the richer half is what a subscription adds.
// A build that cannot sell PRO shows them all — see ProfileScreen's swatch row.
export const TRAIL_GLOW_COLORS = [
  { key: 'clan', label: 'Club', value: null },
  { key: 'cyan', label: 'Cyan', value: '#22d3ee' },
  { key: 'azure', label: 'Azure', value: '#38bdf8' },
  { key: 'rose', label: 'Rose', value: '#fb7185' },
  { key: 'volt', label: 'Volt', value: '#a3e635' },
  { key: 'violet', label: 'Violet', value: '#a78bfa', pro: true },
  { key: 'magenta', label: 'Magenta', value: '#e879f9', pro: true },
  { key: 'orange', label: 'Orange', value: '#fb923c', pro: true },
  { key: 'amber', label: 'Amber', value: '#fbbf24', pro: true },
];


const SettingsContext = createContext({
  trailGlow: 'clan',
  trailGlowColor: null,
  setTrailGlow: () => {},
});

export function SettingsProvider({ children }) {
  const [trailGlow, setTrailGlowState] = useState('clan');

  useEffect(() => {
    AsyncStorage.getItem(TRAIL_GLOW_KEY)
      .then((saved) => {
        if (saved && TRAIL_GLOW_COLORS.some((c) => c.key === saved)) setTrailGlowState(saved);
      })
      .catch(() => {});
  }, []);

  const setTrailGlow = (key) => {
    setTrailGlowState(key);
    AsyncStorage.setItem(TRAIL_GLOW_KEY, key).catch(() => {});
  };


  const value = useMemo(() => {
    const entry = TRAIL_GLOW_COLORS.find((c) => c.key === trailGlow) || TRAIL_GLOW_COLORS[0];
    return { trailGlow: entry.key, trailGlowColor: entry.value, setTrailGlow };
  }, [trailGlow]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
