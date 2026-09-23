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
// WHY THE SECOND PASS OVER-CUT. One flat line across the HAT'S FULL WIDTH
// (x0 to x1, which for a typical cap is nearly ear to ear) hides anything
// above the seat everywhere under that whole span — including hair sitting
// against the TEMPLE, well clear of the crown the hat actually domes over.
// Real side hair, low pigtail roots and bob volume live exactly there, so a
// single wide flat cut read as one rectangular bite out of the hairstyle
// rather than a hat resting on a head.
//
// THE SHAPE NOW (head fractions: x 0..1 across the skull, y 0 = skull top,
// 1 = chin; see `getHairOcclusion`):
//
//                    [ hat from edgeX0 to edgeX1 ]
//        edgeX0   crownX0                   crownX1   edgeX1
//      ────●━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━●────
//          ╲        ┗━━━━━ crown y ━━━━━━━┛        ╱
//           ╲      (fully hidden: the hat's dome)  ╱
//            ╲___tapering to fully visible___╱
//               by the hat's own edge (revealY)
//        hair beyond edgeX0/edgeX1: never clipped at all
//
//   - CROWN (`crownY`, `crownX0..crownX1`): a flat band centred under the
//     hat, narrower than the hat's own measured width by `crownWidth` — the
//     part of the skull the hat actually domes over. Above this line is gone
//     for every closed hat, however tall the style; nothing outside this
//     band is ever hidden this deeply.
//   - TAPER (`crownX0→edgeX0`, `crownX1→edgeX1`): between the crown band and
//     the hat's own physical edge — the brim/side wall's footprint, still
//     under the hat but past its dome — the hidden line rises in a straight
//     run from `crownY` down to `revealY`, so hair right against the crown is
//     still mostly hidden but hair at the hat's own edge is almost entirely
//     kept: this is what lets side hair, low pigtail roots and bob volume
//     survive under a cap instead of being cut with the crown.
//   - BEYOND THE HAT (past `edgeX0`/`edgeX1`): never clipped. By the hat's own
//     edge the taper has already reached `revealY`, so there is no seam to
//     paper over — anything further out was never under the hat to begin
//     with.
//
// `crownY` is measured per item the same way it always was: the hat's own
// lowest ink across the skull (scripts/measure-headwear-fit.py), pulled up by
// the category's `edgeInset` so the cut sits under the hat's own ink.
// `crownWidth` (0..1, a fraction of the hat's OWN width) and `revealY` are
// category defaults — a snug beanie or headwrap claims most of its own width
// as crown and only eases off right at its edge; a baseball cap claims less
// than half of its width as crown and gives back almost everything by its
// edge. `hairRegions[id].keepBelow`, when a specific style still loses a
// hanging ponytail or braid it shouldn't, floors `crownY` itself so nothing
// below that head-fraction is ever hidden — a per-style escape hatch, not a
// second geometry to maintain.
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

// Hairstyle region metadata (headwearFit.json `hairRegions`). The crown band
// and its taper already split every style into what a hat's dome covers and
// what survives below and beside it, so most styles need nothing here. Two
// escape hatches for the styles whose geometry still breaks the default:
//   - `gathered: 'crown'` — the whole style is gathered on the crown itself
//     (a top bun), so its hanging parts exist only because of the bun: under
//     a closed hat the bun is gone and there is nothing left to show.
//   - `keepBelow` — a head fraction nothing is ever hidden below, for a style
//     whose hanging ponytail, pigtail or braid still crosses into the crown
//     band's own x-range and would otherwise be clipped with it.
export function getHairRegions(hair) {
  return (hair && FIT.hairRegions[hair.id]) || null;
}

// The occlusion to apply to `hair` under `hat`, or null when nothing clips.
//   { hide: true }                                     → no hair survives
//   { crownY, crownX0, crownX1, edgeX0, edgeX1, revealY } → the shape above
// All of crownY/crownX0/crownX1/edgeX0/edgeX1/revealY are HEAD fractions.
export function getHairOcclusion(hat, hair) {
  if (!hair || hair.id === 'none') return null;
  const profile = getHeadwearFitProfile(hat);
  if (!profile.occlude) return null;
  const regions = getHairRegions(hair);
  if (regions && regions.gathered === 'crown') return { hide: true };
  const m = FIT.hats[hat.id] || {};
  const edge = m.edgeY != null ? m.edgeY : profile.defaultEdgeY;
  let crownY = Math.min(edge, profile.maxEdgeY) - profile.edgeInset;
  if (regions && regions.keepBelow != null) crownY = Math.min(crownY, regions.keepBelow);
  const edgeX0 = m.x0 != null ? m.x0 : DEFAULT_EXTENT.x0;
  const edgeX1 = m.x1 != null ? m.x1 : DEFAULT_EXTENT.x1;
  const mid = (edgeX0 + edgeX1) / 2;
  const half = ((edgeX1 - edgeX0) * (profile.crownWidth ?? 0.5)) / 2;
  return {
    crownY,
    crownX0: mid - half,
    crownX1: mid + half,
    edgeX0,
    edgeX1,
    revealY: regions && regions.keepBelow != null
      ? Math.min(regions.keepBelow, profile.revealY ?? 0.8)
      : (profile.revealY ?? 0.8),
  };
}
