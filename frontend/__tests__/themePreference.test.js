// Which scheme a runner gets. Light unless they asked for something else.
//
// Order matters in this file: `hydrateThemePreference` keeps what it read in
// module state, so the case with nothing valid saved has to run first.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_PREF,
  hydrateThemePreference,
  resolveScheme,
} from '../src/theme/ThemeContext';

const PREF_KEY = 'paser.theme.pref';

describe('the theme preference', () => {
  it('defaults to light, even on a phone set to dark', () => {
    expect(DEFAULT_PREF).toBe('light');
    expect(resolveScheme(DEFAULT_PREF, 'dark')).toBe('light');
  });

  it('follows the OS only when the runner picked System', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  // Some Android builds, and the first moments before Appearance answers.
  it('lands on light when the OS will not say', () => {
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('system', undefined)).toBe('light');
  });

  it('ignores a saved value it does not recognise', async () => {
    await AsyncStorage.setItem(PREF_KEY, 'purple');
    await expect(hydrateThemePreference()).resolves.toBeNull();
  });

  it('hydrates a saved choice before the first render', async () => {
    await AsyncStorage.setItem(PREF_KEY, 'dark');
    await expect(hydrateThemePreference()).resolves.toBe('dark');
  });
});
