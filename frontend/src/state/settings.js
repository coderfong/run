// Local app settings persisted on-device (AsyncStorage). Currently just the
// trail glow colour used while recording a run: 'clan' follows the clan
// accent; any other key picks a fixed neon from TRAIL_GLOW_COLORS.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TRAIL_GLOW_KEY = 'tr.settings.trailGlow';

// value: null means "use the clan accent" (the pre-setting behaviour).
export const TRAIL_GLOW_COLORS = [
  { key: 'clan', label: 'Club', value: null },
  { key: 'cyan', label: 'Cyan', value: '#22d3ee' },
  { key: 'volt', label: 'Volt', value: '#a3e635' },
  { key: 'magenta', label: 'Magenta', value: '#e879f9' },
  { key: 'amber', label: 'Amber', value: '#fbbf24' },
  { key: 'white', label: 'White', value: '#f8fafc' },
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
