// Headwear-fit system: reusable HAIR + HEADWEAR occlusion, not per-pair
// hacks. CharacterRig's `Layer` does the drawing; this file decides the shape.
//
// THE RULE. A hat is anchored to the SKULL, never to the hairstyle: every
// hat's layout is fixed per item and nothing about the hair moves it. The
// visible hair is then
//
//     the hairstyle  minus  the part of the head the hat physically covers
//
// and that covered part is described by the HAT, measured once from its own
// art, so swapping hairstyles under one hat only changes which hair is left
// showing around it.
//
// WHY THE FIRST PASS STILL FLOATED. It clipped hair along ONE horizontal
// line per category, and put that line at or ABOVE the skull top for
// caps/brims (-0.06/-0.08) so ordinary hair was untouched. Anything wider
// than the hat (side hair, bobs, pigtail roots, curls) kept its whole upper
// silhouette beside the hat and read as the hat sitting on top of an
// unchanged hairstyle. Pushing the line down would not have fixed it either:
// a flat full-width cut leaves a boxy, ink-less shelf of hair beside the hat.
//
// THE SHAPE NOW (head fractions: x 0..1 across the skull, y 0 = skull top,
// 1 = chin; see `getHairOcclusion`):
//
//          fall ↘        [ hat from x0 to x1 ]        ↙ fall
//      ─────────────────●━━━━━━━━━━━ seat y ━━━━━━━●─────────────────
//        hair below the     hidden under the hat     hair below the
//        sloped line shows  above the seat line      sloped line shows
//
//   - SEAT (`y`): where the hat's lower edge meets the head, measured per item
//     by scripts/measure-headwear-fit.py (its lowest ink across the skull,
//     10th percentile), pulled up by the category's `edgeInset` so the cut
//     always sits UNDER the hat's own ink. Crown and upper-side hair above it
//     is gone for every closed hat, however tall the style.
//   - SIDES (`x0`/`x1` and `fall`): beyond the hat's own extent the cut falls
//     away at `fall` degrees below horizontal, so side hair, pigtails and
//     ponytails appear to come out FROM UNDER the edge instead of standing
//     up beside it.
//   - SEAM: where that cut crosses hair outside the hat, the rig draws a thin
//     line of ink (a tinted copy of the hair itself, so it only lands on
//     hair), so a tucked edge is outlined like the rest of the art.
//
// CATEGORY decides whether any of that happens and how deep it goes; HAIR
// metadata covers the few styles whose geometry breaks the default. Open-top
// pieces (visor, headband, headphones, ears/crowns/clips) never clip: they keep
// the top hair, and the existing draw order (hair, then the item) already puts
// their band, brim or earcups in front of it.
//
// The data lives in headwearFit.json so the offline QA compositor
// (scripts/headwear-fit-qa.py) reads the exact same numbers. After adding or
// re-laying out headwear:
//   node scripts/dump-hair-headwear.js > scripts/qa-headwear-fit/catalog.json
//   python scripts/measure-headwear-fit.py
//   python scripts/headwear-fit-qa.py
import FIT from './headwearFit.json';

export const HEADWEAR_CATEGORY = {
  CLOSED_HAT: 'closed_hat', // structured cap with a brim near the brow: baseball, trucker, bucket
  WIDE_BRIM_HAT: 'wide_brim_hat', // crowned hat with a brim or a soft body: fedora, cowboy, beret, flat cap
  BEANIE: 'beanie', // snug knit cap that follows the skull
  HELMET: 'helmet', // rigid shell; chin straps are capped by maxEdgeY
  HEADWRAP: 'headwrap', // wraps the scalp: turban, headscarf, swim cap
  VISOR: 'visor', // open top: crown hair preserved, band in front
  HEADBAND: 'headband', // thin band, never claims the scalp
  HEADPHONES: 'headphones', // band over the hair, earcups in front of it
  OPEN_HEADWEAR: 'open_headwear', // decorative: ears, horns, crowns, clips, bows
};

// Where a hat with no measured entry (a new item not yet run through
// measure-headwear-fit.py) is assumed to reach across. A bit past the skull
// either side, which is what a typical cap measures.
const DEFAULT_EXTENT = { x0: -0.08, x1: 1.08 };

// Resolve a headwear item to its fit category: an explicit override, then
// the catalogue's own flags (`hideHair` encloses the head → beanie,
// `hidesBulky` is a structured hat → closed hat), then decorative.
export function getHeadwearCategory(item) {
  if (!item || !item.id || item.id === 'none') return null;
  const override = FIT.overrides[item.id];
  if (override) return override;
  if (item.hideHair) return HEADWEAR_CATEGORY.BEANIE;
  if (item.hidesBulky) return HEADWEAR_CATEGORY.CLOSED_HAT;
  return HEADWEAR_CATEGORY.OPEN_HEADWEAR;
}

export function getHeadwearFitProfile(item) {
  const category = getHeadwearCategory(item);
  if (!category) return { occlude: false, category: null };
  return { ...FIT.profiles[category], ...FIT.hatTweaks[item.id], category };
}

// Hairstyle region metadata (headwearFit.json `hairRegions`). The seat line
// already splits every style into crown (above it, hidden) and fringe/side/
// back (below it, kept), so most styles need nothing. The exception is a
// style that is ALL gathered on the crown (`gathered: 'crown'`), whose
// hanging parts only exist because of the bun: under a closed hat the bun is
// gone, so the tail would be left floating in the air.
export function getHairRegions(hair) {
  return (hair && FIT.hairRegions[hair.id]) || null;
}

// The occlusion to apply to `hair` under `hat`, or null when nothing clips.
//   { hide: true }                         → no hair survives under this hat
//   { y, x0, x1, fall }                    → the seat shape described above
// y/x0/x1 in HEAD fractions, fall in screen degrees below horizontal.
export function getHairOcclusion(hat, hair) {
  if (!hair || hair.id === 'none') return null;
  const profile = getHeadwearFitProfile(hat);
  if (!profile.occlude) return null;
  const regions = getHairRegions(hair);
  if (regions && regions.gathered === 'crown') return { hide: true };
  const m = FIT.hats[hat.id] || {};
  const edge = m.edgeY != null ? m.edgeY : profile.defaultEdgeY;
  return {
    y: Math.min(edge, profile.maxEdgeY) - profile.edgeInset,
    x0: m.x0 != null ? m.x0 : DEFAULT_EXTENT.x0,
    x1: m.x1 != null ? m.x1 : DEFAULT_EXTENT.x1,
    fall: profile.sideFall,
  };
}
