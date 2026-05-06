// Dark-mode design tokens adapted from the "GoRun" Figma kit
// (lB9VXWJN2yqOTCq9Lgu0Eb). Used across every screen.

export const colors = {
  bg: '#0b0d0c',
  bgElevated: '#15181a',
  card: '#1b1f22',
  cardAlt: '#23282c',
  border: '#2a2f33',
  text: '#ffffff',
  textMuted: '#9aa0a6',
  textDim: '#6b7177',

  // Lime/green accent that the GoRun kit uses for primary calls-to-action.
  primary: '#c5fc4b',
  primaryDark: '#9ad62a',
  primaryInk: '#0b0d0c', // text colour to put ON primary

  danger: '#ef4444',
  warn: '#f59e0b',
  ok: '#22c55e',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const font = {
  hero: { fontSize: 32, fontWeight: '800', color: colors.text },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  metric: { fontSize: 28, fontWeight: '800', color: colors.primary },
};
