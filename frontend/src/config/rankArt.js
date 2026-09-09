// The rank tier illustrations — one wide scene per rung of the ladder.
//
// WHAT THE ART IS FOR. A tier used to be a colour and a word: "Gold II" on a
// coloured plaque, ten times down a column. That is a legend, not a ladder —
// the difference between Onyx and Ember was two hex codes, and neither of them
// meant anything you could want. Each tier now has a WORLD: the runner in the
// woods with a stick and a bark shield at the bottom, holding a banner and a
// medal at Bronze, standing on a pile of coins at Gold, walking a crystal field
// at Diamond, and crowned over floating islands at the top. Scrolling the
// ladder is meant to read as a climb through ten places, because that is what
// makes the rung above yours worth the points.
//
// KEYED ON THE TIER KEYS THE APP ALREADY USES (config/rankLadder.js, the
// portrait borders, the map's rank filter), so a rung, a border and a map tier
// can never disagree about what a tier is.
//
// `ground` IS THE ART'S OWN DIRT. Averaged from the bottom sixth of each
// illustration by scripts/install-rank-art.py, and painted UNDER the image by
// whatever draws it. Two things need it: a rung whose art has not decoded yet
// shows that scene's sand or lava or ice instead of a grey hole, and art
// letterboxed into a box that is not 16:9 sits on its own ground rather than on
// a seam of card colour. It is deliberately NOT the tier's plaque colour —
// those are picked for legible type, and half of them are nowhere near the
// illustration they would be standing in for.
//
// The files are installed by `scripts/install-rank-art.py`; see that script for
// why they are 1024px and indexed rather than the 1672px truecolour exports.

const ART = Object.freeze({
  wood: { source: require('../../assets/art/rank/wood.png'), ground: '#82723e' },
  bronze: { source: require('../../assets/art/rank/bronze.png'), ground: '#784f28' },
  silver: { source: require('../../assets/art/rank/silver.png'), ground: '#8b99ac' },
  gold: { source: require('../../assets/art/rank/gold.png'), ground: '#dcac1c' },
  platinum: { source: require('../../assets/art/rank/platinum.png'), ground: '#cfd2d9' },
  diamond: { source: require('../../assets/art/rank/diamond.png'), ground: '#7bbde2' },
  onyx: { source: require('../../assets/art/rank/onyx.png'), ground: '#151317' },
  ember: { source: require('../../assets/art/rank/ember.png'), ground: '#5d2319' },
  prismatic: { source: require('../../assets/art/rank/prismatic.png'), ground: '#a592dd' },
  mythic: { source: require('../../assets/art/rank/mythic.png'), ground: '#67549d' },
});

// The shape every illustration is authored at (1024x576). Callers size their
// art box from this rather than from a magic 16/9, so a future re-export at a
// different ratio moves the layout with it instead of cropping into faces.
export const RANK_ART_ASPECT = 16 / 9;

/**
 * The scene for a tier, or null for a key with no art in the build.
 *
 * Null rather than a fallback illustration on purpose: a rung drawing ANOTHER
 * tier's world is a worse failure than a rung drawing none, because it is the
 * one that looks deliberate. Callers fall back to the flat tier colour.
 */
export function rankArt(key) {
  return ART[key] || null;
}

/** Every scene, for the screen's preload group. */
export const RANK_ART_SOURCES = Object.freeze(Object.values(ART).map((a) => a.source));

export default ART;
