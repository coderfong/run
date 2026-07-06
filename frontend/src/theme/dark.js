// Dark "night run" theme. Three surface elevation steps (constitution: no
// shadows on dark — depth comes from surface color, not shadow):
//   base  #0B0D10  (screen)
//   raised #15181D (cards, panels)
//   high  #1D2127  (nested / pressed)

export const SURFACE = {
  base: '#0b0d10',
  raised: '#15181d',
  high: '#1d2127',
};

export const darkColors = {
  bg: SURFACE.base,
  bgElevated: SURFACE.raised,
  card: SURFACE.raised,
  cardAlt: SURFACE.high,
  border: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.66)',
  textDim: 'rgba(255,255,255,0.42)',

  primary: '#ffffff',
  primaryInk: '#0b0d10',

  ok: '#3faf74',
  warn: '#c7913e',
  danger: '#d16560',
  dangerSoft: 'rgba(209,101,96,0.16)',
};
