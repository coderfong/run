// Ambient presets — the slow, unprompted motion a screen has when nothing is
// happening on it. Wind through a scene, embers off a fire, dust in a light.
//
// This is deliberately NOT the effect registry. An effect is a one-shot fired
// at a moment; an ambient preset is a standing instruction ("three of these,
// drifting left, forever") and it needs numbers the effect registry has no
// business carrying: how many, how fast they cross, how far they sway.
//
// EVERY PRESET CAN BE EMPTY. Its sprites are looked up by id at render time and
// a preset whose art is not imported resolves to nothing, so `AmbientLayer`
// draws nothing and the screen is exactly as it was. That is not a defensive
// nicety here — the leaf art is licence blocked out of the build right now (see
// scripts/animations/animation-selection.json), so `leaves` IS the empty case
// until that is settled, and the screens that ask for it must not care.

import { getEffect } from './effectRegistry';

export const AMBIENT = Object.freeze({
  // Wind through the roadside scene on the You page and the avatar studio.
  leaves: {
    id: 'leaves',
    sprites: ['fall_leaf_01', 'spring_leaf_01', 'winter_leaf_01'],
    count: 7,
    size: 22,
    // Seconds for one particle to cross the full width. A range, so they do
    // not travel as a formation.
    crossMs: [7000, 13000],
    // How far a particle wanders off its line, in points, and how long one
    // wander takes. Leaves fall in arcs; a leaf on a straight line reads as a
    // sprite on a tween, which is what it is.
    swayPx: [14, 34],
    swayMs: [1600, 3200],
    // Downward drift as a fraction of the layer height over one crossing.
    fall: [0.15, 0.5],
    spin: true,
    opacity: [0.55, 0.95],
  },
  // Warm flecks rising. For the darker panels — a reward reveal, a fire lit
  // behind a card — where falling anything would read as ash.
  embers: {
    id: 'embers',
    sprites: ['ember_jet_01'],
    count: 5,
    size: 18,
    crossMs: [9000, 15000],
    swayPx: [10, 24],
    swayMs: [1400, 2600],
    fall: [-0.55, -0.2],
    spin: false,
    opacity: [0.3, 0.6],
  },
  // Slow sparkle, no travel to speak of. The quietest of the three; used where
  // something should feel alive without anything appearing to move across it.
  sparks: {
    id: 'sparks',
    sprites: ['magic_bubbles_01', 'spectral_bloom_01'],
    count: 4,
    size: 20,
    crossMs: [16000, 26000],
    swayPx: [8, 18],
    swayMs: [2200, 3800],
    fall: [-0.12, 0.12],
    spin: false,
    opacity: [0.25, 0.55],
  },
});

export const getAmbient = (id) => AMBIENT[id] || null;

/** The sprites a preset can actually draw right now. May be empty. */
export function ambientSprites(id) {
  const preset = getAmbient(id);
  if (!preset) return [];
  return preset.sprites.map(getEffect).filter((spec) => spec?.source);
}

/** Whether a preset has any art behind it in this build. */
export const hasAmbient = (id) => ambientSprites(id).length > 0;
