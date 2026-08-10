// Theme switch — System / Light / Dark. Reads and writes the persisted
// preference from ThemeProvider.
//
//   import ThemeToggle from '../components/ThemeToggle';
//   ...
//   <ThemeToggle />
//
// This was its own copy of Segmented's markup, which is how the two drifted
// apart — the copy kept the static (dark) type scale and had to be re-spaced
// by hand. It now IS a Segmented, so spacing and theming stay in one place.

import React from 'react';

import { useTheme } from '../theme';
import Segmented from './ui/Segmented';

const OPTIONS = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function ThemeToggle({ style }) {
  const { preference, setPreference } = useTheme();
  return (
    <Segmented
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
      labelSuffix="theme"
      style={style}
    />
  );
}
