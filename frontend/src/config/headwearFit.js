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
//
// HAIR + HEADWEAR COMPATIBILITY (hairHeadwearCompat.json). The cover above
// is a SCALP mask: it says how much of the head a hat hides, and it is the
// same for every hairstyle. Some hair is not scalp hair. A bun on the crown,
// two space buns and the top run of a high ponytail are the parts that decide
// whether a combination looks worn or looks clipped, and a scalp mask cannot
// judge them: a painted cap cover cuts a top knot's bun off flat, and a top
// hat with no cover shows a bun straight through its crown. So:
//
//   - every headwear item has a FAMILY (OPEN, VISOR, SIDE_ACCESSORY, CAP,
//     STRUCTURED_HAT, SOFT_COVER, WRAP, HELMET, FULL_ENCLOSURE, SPECIAL_CASE),
//     classified by eye from the art, not the name;
//   - every hairstyle has a behaviour TYPE, and the few with features carry
//     REGIONS: polygons in the hair ART's own fractions, so they move with
//     the hair if the Fit Studio moves it under a hat;
//   - the family says what happens to each feature: `keep` (shown even where
//     the cover hides hair; the hat is drawn over it, so the crown overlaps
//     the bun's base the way a bun through a cap's back or a beanie's top
//     looks), `hide` (removed ABOVE THE HAT'S SEAT even where nothing else is:
//     no bun through a top hat's crown, no tail rising out of a helmet shell,
//     but the tail still hangs out below the brim), or `cover` (follows the
//     cover like the rest of the hair). An item can override its family
//     (santa hat: the bun goes under it), a 'hair:hat' pair can override both;
//   - crown-covering families add the SKY rule: no hair above the hat's own
//     underside (its lowest ink per column, measured once from the art into
//     hatUndersides.json by scripts/measure-hat-underside.py) in any column
//     the hat occupies. A scalp cover that stops short, or an empty one,
//     otherwise leaves curls and spikes standing out of a crown or above a
//     brim. Kept features are exempt: a bun through a beanie is the point.
//
// Two types skip the mask entirely: COVERING (the hijab is a head covering;
// every hat sits on top of it as it is, never cut into it), and anything under
// a FULL_ENCLOSURE (astronaut helmet, knight helmet, swim cap), which hides
// all hair. A crown-GATHERED style (high bun) is only its bun, so where the
// bun is hidden the whole style goes with it.
//
// Precedence, top wins: the pair's own painted cover (the whole answer);
// COVERING; FULL_ENCLOSURE; gathered + hidden bun; then the hat's '*' cover or
// the measured shape, plus the sky, minus kept features, plus hidden ones. `resolveHairClip` turns all of it
// into ONE hidden region in the hair's art fractions, which CharacterRig draws
// as one even-odd path, and scripts/hair-headwear-qa renders offline through
// this same function.
import polygonClipping from 'polygon-clipping';

import FIT from './headwearFit.json';
import UNDER_HAT from './hairUnderHat.json';
import COMPAT from './hairHeadwearCompat.json';
import UNDERSIDES from './hatUndersides.json';

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

export const HEADWEAR_FAMILY = {
  OPEN: 'OPEN', // crowns, tiaras, ears, horns, halos, bows, clips, headbands
  VISOR: 'VISOR', // a brim and a band, no crown
  SIDE_ACCESSORY: 'SIDE_ACCESSORY', // headphones, earmuffs: over and around the hair
  CAP: 'CAP', // soft crown + peak; a bun or tail can come out of the back
  STRUCTURED_HAT: 'STRUCTURED_HAT', // rigid crowned hats: nothing passes through the crown
  SOFT_COVER: 'SOFT_COVER', // beanies, knit and cloth caps that follow the skull
  WRAP: 'WRAP', // cloth wound round the head: turbans, bandanas, wraps
  HELMET: 'HELMET', // rigid shell
  FULL_ENCLOSURE: 'FULL_ENCLOSURE', // the whole head is inside it
  SPECIAL_CASE: 'SPECIAL_CASE', // no family fits: the item carries its own policy
};

// Where an item has no entry in hairHeadwearCompat.json (a new piece not yet
// classified; the test fails on it), its measured-shape category stands in.
const CATEGORY_FAMILY = {
  closed_hat: 'CAP',
  wide_brim_hat: 'STRUCTURED_HAT',
  beanie: 'SOFT_COVER',
  helmet: 'HELMET',
  headwrap: 'WRAP',
  visor: 'VISOR',
  headband: 'OPEN',
  headphones: 'SIDE_ACCESSORY',
  open_headwear: 'OPEN',
};

const FEATURES = ['topBun', 'sideBuns', 'tail'];

function compatEntry(item) {
  const e = item && COMPAT.headwear[item.id];
  if (!e) return null;
  return typeof e === 'string' ? { family: e } : e;
}

// The legacy resolution: the old per-item category table, then the
// catalogue's own flags (`hideHair` encloses the head → beanie, `hidesBulky`
// is a structured hat → closed hat), then decorative.
function legacyCategory(item) {
  const override = FIT.overrides[item.id];
  if (override) return override;
  if (item.hideHair) return HEADWEAR_CATEGORY.BEANIE;
  if (item.hidesBulky) return HEADWEAR_CATEGORY.CLOSED_HAT;
  return HEADWEAR_CATEGORY.OPEN_HEADWEAR;
}

// The item's compatibility family (hairHeadwearCompat.json), or null bare-headed.
export function getHeadwearFamily(item) {
  if (!item || !item.id || item.id === 'none') return null;
  const e = compatEntry(item);
  return e ? e.family : CATEGORY_FAMILY[legacyCategory(item)];
}

// The measured-shape category (headwearFit.json `profiles`) a hat falls back
// on where nothing is painted: its family's profile, so one classification
// drives both.
export function getHeadwearCategory(item) {
  if (!item || !item.id || item.id === 'none') return null;
  const e = compatEntry(item);
  if (e) return COMPAT.families[e.family].profile;
  return legacyCategory(item);
}

// The hairstyle's behaviour entry: { type, regions?, gathered? }.
export function getHairCompat(hair) {
  return (hair && COMPAT.hair[hair.id]) || null;
}

// What `hat` does to each of `hair`'s features: 'keep' | 'hide' | 'cover'.
// Family default, then the item's own override, then the pair's.
export function getHairFeaturePolicy(hat, hair) {
  const family = getHeadwearFamily(hat);
  if (!family) return null;
  const base = COMPAT.families[family] || {};
  const item = compatEntry(hat) || {};
  const pair = (hair && COMPAT.pairs[`${hair.id}:${hat.id}`]) || {};
  const out = {};
  for (const f of FEATURES) out[f] = pair[f] || item[f] || base[f] || 'cover';
  return out;
}

// The hat's seat on the skull (head fraction): what `hide` cuts features
// above. Measured per hat, else its profile's default.
function seatY(hat) {
  const m = FIT.hats[hat.id];
  if (m && m.edgeY != null) return m.edgeY;
  const p = FIT.profiles[getHeadwearCategory(hat)] || {};
  return p.defaultEdgeY ?? 0.28;
}

export function getHeadwearFitProfile(item) {
  const category = getHeadwearCategory(item);
  if (!category) return { occlude: false, category: null };
  return { ...FIT.profiles[category], ...FIT.hatTweaks[item.id], category };
}

// Hairstyle region metadata (headwearFit.json `hairRegions`). One escape
// hatch, kept for the studio: `keepBelow`, a head fraction nothing is ever
// hidden below, for a style whose hanging ponytail, pigtail or braid still
// crosses into the crown band's x-range under the MEASURED shape. (The old
// `gathered: 'crown'` flag moved to hairHeadwearCompat.json, where the bun it
// describes is a region with a policy per family.)
export function getHairRegions(hair) {
  return (hair && FIT.hairRegions[hair.id]) || null;
}

// HAND-PAINTED COVERS (hairUnderHat.json `cover`, written by the Fit Studio's
// "Hair under hat" editor). Where the measured shape is still wrong for a hat, the
// hidden region is painted by hand with the hat on and stored as polygons in
// head fractions. A pair's own cover (hat + this hairstyle) wins over
// everything, including the compatibility rules. The hat's cover for every
// hairstyle ('*') wins over the measured shape, applies even to open-top
// pieces, and an empty one means "show all of this hair" — except the
// features, which the family still keeps or hides on top of it.

// The occlusion to apply to `hair` under `hat`, or null when nothing clips.
//   { hide: true }                                     → no hair survives
//   { cover: [[[x, y], ...], ...] }                    → hand-painted, hidden inside
//   { crownY, crownX0, crownX1, edgeX0, edgeX1, revealY } → the shape above
// Covers and the measured shape are HEAD fractions. Either may carry
//   sky: [run...]   the hat's underside, runs in the HAT's art fractions
//   features: { keep: [poly...], hide: [poly...], seatY }
// (feature polygons in the hair's ART fractions; seatY in head fractions), or
// be only `{ sky, features }` where the hat has no scalp cover at all.
export function getHairOcclusion(hat, hair) {
  if (!hair || hair.id === 'none') return null;
  const covers = (hat && UNDER_HAT.cover[hat.id]) || {};
  if (covers[hair.id]) return { cover: covers[hair.id] };
  const family = getHeadwearFamily(hat);
  if (!family) return null;
  const compat = getHairCompat(hair) || {};
  if (compat.type === 'COVERING') return null;
  if ((COMPAT.families[family] || {}).hideAll) return { hide: true };
  const policy = getHairFeaturePolicy(hat, hair);
  if (compat.gathered && policy.topBun === 'hide') return { hide: true };

  const profile = getHeadwearFitProfile(hat);
  const item = compatEntry(hat) || {};
  const skyOn = item.sky != null ? item.sky : !!COMPAT.families[family].sky;
  const sky = skyOn ? (UNDERSIDES.hats[hat.id] || null) : null;
  // The measured notch is only the fallback for an occluding hat with neither
  // a painted cover nor a measured underside: its deep side wedge was drawn
  // for a world without the sky, and cuts tails and bobs where the sky would
  // leave them.
  let base = null;
  if (covers['*']) base = { cover: covers['*'] };
  else if (profile.occlude && !sky) base = measuredShape(hat, hair, profile);

  const keep = [];
  const hide = [];
  for (const f of FEATURES) {
    const polys = compat.regions && compat.regions[f];
    if (!polys) continue;
    if (policy[f] === 'keep') keep.push(...polys);
    else if (policy[f] === 'hide') hide.push(...polys);
  }
  // Keeping hair only matters where something would have hidden it.
  const clips = !!sky || !!(base && !(base.cover && base.cover.length === 0));
  if (!sky && !hide.length && !(keep.length && clips)) return base;
  const out = base ? { ...base } : {};
  if (sky) out.sky = sky;
  if (hide.length || (keep.length && clips)) {
    out.features = { keep: clips ? keep : [], hide, seatY: seatY(hat) };
  }
  return out;
}

function measuredShape(hat, hair, profile) {
  const regions = getHairRegions(hair);
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

// The measured shape as the polygon it hides (head fractions): the notch
// CharacterRig used to trace clockwise round the frame, from far above the
// hair down to the seat. Clamping to the frame is the path's job now.
const ABOVE = -3;
function notchRing(o) {
  return [
    [o.edgeX0, ABOVE], [o.edgeX0, o.revealY], [o.crownX0, o.crownY],
    [o.crownX1, o.crownY], [o.edgeX1, o.revealY], [o.edgeX1, ABOVE],
  ];
}

// WHAT THE RIG CLIPS. `frame` is the hair art's box in HEAD fractions
// ({ x, y, w, h }: x 0..1 across the skull, y 0 = skull top, 1 = chin), which
// is scale-free, so one answer serves a 24pt bust and the studio alike.
// `hatFrame` is the hat's front art box the same way, which places its
// underside for the sky rule (no hatFrame, no sky).
// Returns null (draw all the hair), 'hide' (draw none of it), or
// { rings: [[[ax, ay], ...], ...] }: the hidden region in the hair's ART
// fractions, to be cut from the art rectangle even-odd. Covers are even-odd
// among themselves already, so a bare cover's rings go straight through; the
// sky and the features need real set operations (polygon-clipping).
//
// COST. Almost all of the geometry is the HAT's (its cover and its sky), so
// that union is built once per hat and cached; per hairstyle only the feature
// polygons and a coordinate change remain. Painted covers are pixel
// staircases of ~300 points, simplified to COVER_TOL first (a fifth of a
// skull pixel, far under one screen point at any rig size): the set
// operations cost what their input costs.
const clipCache = new Map();
const hatCache = new Map();
const CACHE_MAX = 400;
const COVER_TOL = 0.0015; // head fractions
const k4 = (v) => Math.round(v * 1e4);
const boxKey = (b) => (b ? `${k4(b.x)},${k4(b.y)},${k4(b.w)},${k4(b.h)}` : '-');
const remember = (cache, key, value) => {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, value);
  return value;
};

export function resolveHairClip(hat, hair, frame, hatFrame = null) {
  const occ = getHairOcclusion(hat, hair);
  if (!occ) return null;
  if (occ.hide) return 'hide';
  const key = `${hat ? hat.id : ''}|${hair.id}|${boxKey(frame)}|${boxKey(hatFrame)}`;
  if (clipCache.has(key)) return clipCache.get(key);
  return remember(clipCache, key, computeClip(occ, frame, hatFrame, hat));
}

function computeClip(occ, frame, hatFrame, hat) {
  const toArt = ([x, y]) => [(x - frame.x) / frame.w, (y - frame.y) / frame.h];
  const toHead = ([ax, ay]) => [frame.x + ax * frame.w, frame.y + ay * frame.h];
  let base = [];
  if (occ.cover) base = occ.cover;
  else if (occ.crownY != null) base = [notchRing(occ)];
  const f = { keep: [], hide: [], ...(occ.features || {}) };
  const plain = () => (base.length ? { rings: base.map((r) => r.map(toArt)) } : null);
  if (!(occ.sky && hatFrame) && !f.keep.length && !f.hide.length) return plain();

  const asGeom = (ring) => [ring];
  try {
    const hatPart = hatHidden(occ, base, hatFrame, hat);
    let hidden = hatPart.hidden;
    if (hatPart.seat != null) f.seatY = hatPart.seat;
    if (f.keep.length && hidden.length) {
      hidden = polygonClipping.difference(hidden, ...f.keep.map((r) => asGeom(r.map(toHead))));
    }
    if (f.hide.length) {
      const above = [[[-10, -10], [10, -10], [10, f.seatY], [-10, f.seatY]]];
      const cut = polygonClipping.intersection(
        polygonClipping.union(...f.hide.map((r) => asGeom(r.map(toHead)))),
        above
      );
      hidden = hidden.length ? polygonClipping.union(hidden, cut) : cut;
    }
    const rings = [];
    for (const poly of hidden) for (const ring of poly) rings.push(ring.map(toArt));
    return rings.length ? { rings } : null;
  } catch (e) {
    // A painted cover the set operations cannot digest: draw it as painted,
    // without the compatibility rules, rather than lose the hair or the rig.
    return plain();
  }
}

// What the hat alone hides, in head fractions: its cover (or the measured
// notch) united with its sky. Cached per hat and hat frame; the measured notch
// depends on the hairstyle (keepBelow), so that rare path is not cached.
function hatHidden(occ, base, hatFrame, hat) {
  const key = occ.cover && hat ? `${hat.id}|${boxKey(hatFrame)}` : null;
  if (key && hatCache.has(key)) return hatCache.get(key);
  const asGeom = (ring) => [ring];
  const under = occ.sky && hatFrame ? undersideInHead(occ.sky, hatFrame) : null;
  const seat = under ? seatOf(under) : null;
  const sky = under && seat != null ? skyRings(under, seat) : [];
  const rings = base.map((r) => simplify(r, COVER_TOL)).filter((r) => r.length >= 3);
  let hidden = [];
  if (rings.length === 1) hidden = [[rings[0]]];
  else if (rings.length > 1) hidden = polygonClipping.xor(...rings.map(asGeom));
  if (sky.length) hidden = polygonClipping.union(hidden, ...sky.map(asGeom));
  const out = { hidden, seat };
  return key ? remember(hatCache, key, out) : out;
}

// Ramer-Douglas-Peucker on a closed ring (or an open run).
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x0, y0] = pts[a];
    const [x1, y1] = pts[b];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - x0) - dx * (pts[i][1] - y0)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// The hat's underside runs placed on the head (head fractions).
function undersideInHead(runs, hatFrame) {
  return runs.map((run) => run.map(([ax, ay]) => [hatFrame.x + ax * hatFrame.w, hatFrame.y + ay * hatFrame.h]));
}

// The hat's SEAT, from its underside as drawn now: across the skull, the
// highest of its lower edges (10th percentile, so a notch cannot win), which
// is measure-headwear-fit.py's `edgeY` recomputed from the live layout. The
// stored edgeY goes stale when a hat is moved in the Fit Studio (the bowler's
// read 0.09 against a brim at 0.25), so the rules that can use this do.
function seatOf(runs) {
  const edges = [];
  for (let i = 0; i <= 42; i++) {
    const x = 0.08 + (0.84 * i) / 42;
    let best = null;
    for (const run of runs) {
      for (let j = 0; j < run.length - 1; j++) {
        const [x0, y0] = run[j];
        const [x1, y1] = run[j + 1];
        if (x < Math.min(x0, x1) || x > Math.max(x0, x1)) continue;
        const y = x1 === x0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        best = best == null ? y : Math.max(best, y);
      }
    }
    if (best != null) edges.push(best);
  }
  if (!edges.length) return null;
  edges.sort((a, b) => a - b);
  const k = (edges.length - 1) * 0.1;
  const lo = Math.floor(k);
  return edges[lo] + (edges[Math.min(lo + 1, edges.length - 1)] - edges[lo]) * (k - lo);
}

// The sky over the hat, in head fractions. Only where the hat RESTS: columns
// whose underside sits within SKY_BAND of its seat (brims, crowns, cap walls).
// Horns, ears, a feather or a pompom stand off the head, and hair beside or
// under them is hair beside the hat, not through it; counting them erased an
// afro's sides under a Viking helm. Each resting run is closed along its
// underside, then out and up from each end at SKY_FALL degrees rather than
// straight up, so hair just past a brim's tip tapers off under it instead of
// standing in a vertical strip beside it.
const SKY_FALL = 60;
const SKY_SLOPE = Math.tan((SKY_FALL * Math.PI) / 180) * (157 / 218); // head-y per head-x
const SKY_BAND = { above: 0.12, below: 0.12 };
const SKY_STEP = 0.01; // head-x between resampled underside points
function skyRings(under, seat) {
  const lo = seat - SKY_BAND.above;
  const hi = seat + SKY_BAND.below;
  const rests = ([, y]) => y >= lo && y <= hi;
  const runs = [];
  for (const pts of under) {
    let cur = [];
    const flush = () => {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    };
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1] || pts[i];
      const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / SKY_STEP));
      for (let k = 0; k < (i === pts.length - 1 ? 1 : n); k++) {
        const p = [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n];
        if (rests(p)) cur.push(p);
        else flush();
      }
    }
    flush();
  }
  const reach = (y) => (y - ABOVE) / SKY_SLOPE;
  return runs.map((dense) => {
    const pts = simplify(dense, COVER_TOL);
    const [lx, ly] = pts[0];
    const [rx, ry] = pts[pts.length - 1];
    return [[lx - reach(ly), ABOVE], ...pts, [rx + reach(ry), ABOVE]];
  });
}

// WITH-HAT HAIR POSITION (hairUnderHat.json `layout`, dragged in the Fit
// Studio). A hairstyle can sit differently while a hat is on: pressed down,
// narrower, pushed to one side. Its layout under this hat is the hat's own
// entry for the style, else the style's entry for every crown-covering hat
// ('*'), laid over its plain layout. Only the hair moves; the hat stays
// anchored to the skull and the occlusion stays in head fractions, so the
// crop does not move with it.
export function getHairLayout(hat, hair) {
  if (!hair) return null;
  const byHat = (hat && hat.id !== 'none' && UNDER_HAT.layout[hair.id]) || null;
  if (!byHat) return hair.layout || null;
  const own = byHat[hat.id] || (getHeadwearFitProfile(hat).occlude ? byHat['*'] : null);
  if (!own) return hair.layout || null;
  // An entry anchors by either top or cy; drop the other so the rig, which
  // reads cy first, cannot mix the two.
  const base = { ...(hair.layout || {}) };
  if (own.top != null) delete base.cy;
  if (own.cy != null) delete base.top;
  return { ...base, ...own };
}
