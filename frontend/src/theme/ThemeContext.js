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
// DEFAULT is 'dark' so nothing changes visually until a screen opts in by
// reading useTheme().colors. Convert screens incrementally; flip the default
// to 'system' (and surface <ThemeToggle/>) once the sweep is complete.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { darkColors } from './dark';
import { colors as lightColors } from './light';
import { type as baseType } from './tokens';

const PREF_KEY = 'paser.theme.pref';
const PALETTES = { light: lightColors, dark: darkColors };

// Follow the OS by default; users override to light/dark in Profile. Main
// surfaces are themed; a few secondary detail screens still render on the
// static dark palette (readable, just dark) until they're converted too.
const DEFAULT_PREF = 'system';

const ThemeContext = createContext({
  colors: darkColors,
  scheme: 'dark',
  preference: DEFAULT_PREF,
  setPreference: () => {},
});

export function ThemeProvider({ children }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreferenceState] = useState(DEFAULT_PREF);

  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    AsyncStorage.setItem(PREF_KEY, next).catch(() => {});
  }, []);

  const scheme =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

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
