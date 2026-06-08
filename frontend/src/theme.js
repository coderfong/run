// Territory Run — "visual v1" light design tokens.
// Light is the default everywhere; `darkColors` is reserved for the active
// Running screen (battery + outdoor visibility). There is NO global brand
// accent — a user's team colour is their accent, so `colors.primary` falls
// back to brand ink for team-agnostic surfaces (Auth, onboarding, neutral CTAs).

export const teams = {
  north: { key: 'north', name: 'North', fill: '#e9d5ff', stroke: '#9333ea', text: '#581c87', dm: '#f3e8ff' },
  east:  { key: 'east',  name: 'East',  fill: '#bbf7d0', stroke: '#16a34a', text: '#14532d', dm: '#dcfce7' },
  south: { key: 'south', name: 'South', fill: '#bfdbfe', stroke: '#2563eb', text: '#1e3a8a', dm: '#dbeafe' },
  west:  { key: 'west',  name: 'West',  fill: '#fecaca', stroke: '#dc2626', text: '#7f1d1d', dm: '#fee2e2' },
};

export const colors = {
  bg: '#fafaf7',
  bgElevated: '#f3f1ea',
  card: '#ffffff',
  cardAlt: '#f0eee7',
  border: '#e5e1d8',
  text: '#0d1117',
  textMuted: 'rgba(13,17,23,0.60)',
  textDim: 'rgba(13,17,23,0.40)',

  primary: '#0d1117', // brand ink — neutral CTA where there is no team yet
  primaryDark: '#000000',
  primaryInk: '#ffffff',

  danger: '#dc2626',
  warn: '#d97706',
  ok: '#16a34a',
};

// Active-run dark surface.
export const darkColors = {
  bg: '#0d1117',
  bgElevated: '#161b22',
  card: '#161b22',
  cardAlt: '#1b2230',
  border: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.66)',
  textDim: 'rgba(255,255,255,0.42)',
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
  hero: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  metric: { fontSize: 28, fontWeight: '800', color: colors.text },
};
