// Dynamic light/dark theming.
//
// The app shipped "dark-first" with `colors` hardcoded to the dark palette
// (see theme/index.js). This provider makes the palette *dynamic* without
// breaking any screen that still imports the static `colors`:
//
//   - preference: 'system' | 'light' | 'dark'   (persisted on-device)
//   - resolved scheme follows the OS when preference === 'system'
//   - useTheme() -> { colors, scheme, preference, setPreference }
//   - useThemedStyles(factory) -> memoised StyleSheet from (colors, scheme)
//
// LIGHT BY DEFAULT. The paper palette is the app's face, so a runner who has
// never opened the Appearance switch gets it whatever their phone is set to.
// This used to follow the OS, which put everyone with a dark phone on the night
// palette without their ever choosing it. System and Dark are one tap away in
// Profile (ThemeToggle), and a saved choice always beats the default.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { darkColors } from './dark';
import { colors as lightColors } from './light';
import { type as baseType } from './tokens';

const PREF_KEY = 'paser.theme.pref';
const PALETTES = { light: lightColors, dark: darkColors };
const PREFS = ['system', 'light', 'dark'];

// What a runner who has never touched the switch gets. See the header.
export const DEFAULT_PREF = 'light';

/**
 * The scheme `preference` comes out as on a phone reporting `system`.
 *
 * The OS answer is null when it will not say (some Android builds, and the
 * moments before Appearance has answered). That falls to LIGHT for the same
 * reason the default does: an unknown answer should land on the app's own face,
 * not on the palette nobody picked.
 */
export function resolveScheme(preference, system) {
  if (preference === 'light' || preference === 'dark') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

// The saved preference, read before the provider exists. See below.
let hydratedPref = null;

/**
 * Read the saved preference into memory ahead of the first render. App awaits
 * this in its launch gate, beside `hydrateCache`, so the provider's FIRST frame
 * is already in the runner's scheme.
 *
 * Without it the provider opens on the default and swaps when its own read
 * lands: a flash of paper on every cold start for anybody who chose Dark,
 * which with a light default is precisely the people who went looking for the
 * switch.
 */
export async function hydrateThemePreference() {
  try {
    const saved = await AsyncStorage.getItem(PREF_KEY);
    if (PREFS.includes(saved)) hydratedPref = saved;
  } catch {
    // An unreadable disk costs the first frame its scheme, nothing more.
  }
  return hydratedPref;
}

const ThemeContext = createContext({
  colors: lightColors,
  scheme: 'light',
  preference: DEFAULT_PREF,
  setPreference: () => {},
});

export function ThemeProvider({ children }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreferenceState] = useState(() => hydratedPref || DEFAULT_PREF);
  // Set by a tap on the switch, so a disk read that lands late cannot undo it.
  const chosen = useRef(false);

  // Still read here as well: the launch gate gives up on a slow disk rather
  // than hold the splash, so the hydration above may not have landed yet.
  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((saved) => {
        if (!chosen.current && PREFS.includes(saved)) setPreferenceState(saved);
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((next) => {
    chosen.current = true;
    hydratedPref = next;
    setPreferenceState(next);
    AsyncStorage.setItem(PREF_KEY, next).catch(() => {});
  }, []);

  const scheme = resolveScheme(preference, system);

  const value = useMemo(
    () => ({ colors: PALETTES[scheme], scheme, preference, setPreference }),
    [scheme, preference, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Build a StyleSheet from the active palette. `factory(colors, scheme, type)`
// runs again only when the resolved scheme changes. `type` is the themed type
// scale, so stylesheets can spread `type.*` and still theme their text color.
export function useThemedStyles(factory) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  return useMemo(() => factory(colors, scheme, type), [factory, colors, scheme, type]);
}

// The type scale bakes in the DARK palette's text colors (tokens.js). This
// remaps those baked colors onto the active palette, so a screen that opts in
// (drops the static `type` import for `const type = useThemedType()`) gets
// correct text color in both themes with zero other changes.
const TEXT_MAP = [
  ['text', darkColors.text],
  ['textMuted', darkColors.textMuted],
  ['textDim', darkColors.textDim],
  ['primaryInk', darkColors.primaryInk],
];

function buildType(colors) {
  const out = {};
  for (const key in baseType) {
    const style = baseType[key];
    const hit = style.color != null && TEXT_MAP.find(([, dark]) => dark === style.color);
    out[key] = hit ? { ...style, color: colors[hit[0]] } : style;
  }
  return out;
}

// Memoise per palette so themed type objects are stable across renders.
const TYPE_CACHE = new WeakMap();

export function useThemedType() {
  const { colors } = useTheme();
  let cached = TYPE_CACHE.get(colors);
  if (!cached) {
    cached = buildType(colors);
    TYPE_CACHE.set(colors, cached);
  }
  return cached;
}
