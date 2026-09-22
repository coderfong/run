// Headwear-fit system — reusable HAIR + HEADWEAR occlusion, not per-combo
// hacks. See CharacterRig.js for where this actually clips the hair layer.
//
// THE BUG THIS FIXES: the rig used to draw hair at full size, then draw
// headwear on top, and rely entirely on the headwear PNG's own opacity to
// mask whatever hair sat underneath it. That reads fine for a snug swim cap
// over short hair, but for anything with real volume — an afro, a topknot, a
// pair of space buns — the hairstyle's silhouette is taller and wider than
// the hat's own art, so the extra hair pokes out past the hat instead of
// being tucked under it: a hat FLOATING ON TOP of an unchanged hairstyle
// rather than a hat someone is actually wearing.
//
// THE FIX: every headwear item resolves (via `getHeadwearFitProfile`) to a
// small FIT PROFILE that says how deep into the skull its crown reaches.
// CharacterRig clips the hair layer to that line before drawing the hat —
// anchored to the rig's own fixed HEAD box (see CharacterRig's `HEAD` /
// `headFrac`), NEVER to the hairstyle's own bounding box. That's what keeps
// a cap sitting at the same skull depth whether the hair under it is a buzz
// cut or a big afro: only how much of THAT hair still pokes out changes,
// which is the whole point (see CharacterRig's acceptance comment).
//
// Categories that don't enclose the crown at all — a headphone band +
// earcups, a thin headband, cat ears, a visor — do NO clipping. The existing
// draw order (hair, then the item, painted after) already reads correctly
// for those: nothing about them ever claims the whole scalp, so it's a
// z-order problem, not a crop problem, and they already have correct
// z-order (see the reference sheets' headphones/visor notes).
//
// WHY THIS DOESN'T NEED PER-COMBINATION AUTHORING: `crownCoverY` is a
// constant per CATEGORY, derived once from how deep that kind of headwear
// physically sits on a skull — never from a specific hairstyle's art. A
// hairstyle only visibly changes shape under a hat if its own ink actually
// reaches past that universal line; a buzz cut's ink never gets close, so
// cropping is a no-op for it under every category, while an afro's ink
// reaches deep past it under all of them. New hairstyles and new headwear
// items both plug into the existing system for free: a hairstyle needs
// nothing extra at all, and a headwear item needs only the SAME two flags
// the catalog already carries (`hideHair` / `hidesBulky` — see
// config/cosmetics.js) to get a sensible category, or an explicit entry
// below if its physical silhouette needs to be pinned down precisely.

export const HEADWEAR_CATEGORY = {
  CLOSED_HAT: 'closed_hat', // structured cap/hat with a dome — cricket cap, baseball cap, ball cap
  WIDE_BRIM_HAT: 'wide_brim_hat', // tall/brimmed hat with real headroom under the crown
  BEANIE: 'beanie', // snug knit/fabric cap that follows the skull closely
  HELMET: 'helmet', // rigid shell, sits snug like a beanie but doesn't flex
  HEADWRAP: 'headwrap', // wraps around the scalp — turban, headscarf, mob cap
  VISOR: 'visor', // open-top band across the forehead, crown fully exposed
  HEADBAND: 'headband', // thin band, doesn't claim the scalp at all
  HEADPHONES: 'headphones', // band + earcups; z-order only, no crop
  OPEN_HEADWEAR: 'open_headwear', // decorative — ears, horns, crowns, clips, bows, wings
};

// `crownCoverY` / `crownCoverYBulky` are HEAD-fractions (0 = the fixed
// skull top of CharacterRig's HEAD box, 1 = the chin; negative sits ABOVE
// the skull, inside the natural volume a hairstyle draws into). Hair ink
// above this line is clipped away before the headwear art is drawn.
//
// `crownCoverYBulky` applies when the equipped hairstyle carries the
// existing `bulky` flag (afros, buns, topknots, space buns, high ponies —
// see config/cosmetics.js). Two families need genuinely different depths:
//
//   - Items the catalog already flags `hidesBulky` (a structured cap/hat
//     that has room under its dome) were clearly authored on the
//     assumption that ORDINARY hair sits fine under them as-is — only
//     bulky hair needs compressing. So `crownCoverY` for closed_hat /
//     wide_brim_hat stays shallow (near a no-op for a buzz cut or
//     curtains) and only `crownCoverYBulky` reaches deep enough to
//     actually compress an afro or a bun.
//   - Items flagged `hideHair` (beanie, helmet, headwrap families) were
//     authored to hide hair outright, regardless of volume, so both
//     values sit deep — `crownCoverYBulky` just a little deeper still.
const FIT_PROFILES = {
  [HEADWEAR_CATEGORY.BEANIE]: { cropHair: true, crownCoverY: 0.06, crownCoverYBulky: 0.10 },
  [HEADWEAR_CATEGORY.HELMET]: { cropHair: true, crownCoverY: 0.04, crownCoverYBulky: 0.08 },
  [HEADWEAR_CATEGORY.HEADWRAP]: { cropHair: true, crownCoverY: 0.05, crownCoverYBulky: 0.09 },
  [HEADWEAR_CATEGORY.CLOSED_HAT]: { cropHair: true, crownCoverY: -0.06, crownCoverYBulky: 0.055 },
  [HEADWEAR_CATEGORY.WIDE_BRIM_HAT]: { cropHair: true, crownCoverY: -0.08, crownCoverYBulky: 0.035 },
  [HEADWEAR_CATEGORY.VISOR]: { cropHair: false },
  [HEADWEAR_CATEGORY.HEADBAND]: { cropHair: false },
  [HEADWEAR_CATEGORY.HEADPHONES]: { cropHair: false },
  [HEADWEAR_CATEGORY.OPEN_HEADWEAR]: { cropHair: false },
};

// Explicit categorisation, by item id, for silhouettes the `hideHair` /
// `hidesBulky` heuristic below would get wrong — mostly the wide-brim,
// helmet, wrap, visor and headband families, since a cap-shaped default
// would put their crown line at the wrong depth. Everything NOT listed
// here (the large majority of the ~130-item catalog) falls through to
// `getHeadwearCategory`'s heuristic, which is deliberate: a new hat only
// needs the two flags it already carries for the picker/unlocks, not a
// third bespoke entry, unless its fit needs pinning down precisely.
const CATEGORY_OVERRIDES = {
  // snug knit / fabric caps
  beanie: 'beanie', pombeanie: 'beanie', knitbeanie: 'beanie', cuffbeanie: 'beanie',
  catbeanie: 'beanie', frogbeanie: 'beanie', ushanka: 'beanie', trapperhat: 'beanie',
  santahat: 'beanie', cur_knitbeanie: 'beanie',

  // rigid shells
  vikinghelm: 'helmet', bikehelmet: 'helmet', skatehelmet: 'helmet', hardhat: 'helmet',
  spacehelmet: 'helmet', firehelmet: 'helmet', minerhelmet: 'helmet', samuraihelm: 'helmet',
  kabuto: 'helmet', aviatorcap: 'helmet', flightcap: 'helmet',
  cur_knighthelmet: 'helmet', cur_astronauthelmet: 'helmet',

  // wraps / turbans / fully-enclosing scarves
  headwrap: 'headwrap', turban: 'headwrap', sultanturban: 'headwrap', headscarf: 'headwrap',
  mobcap: 'headwrap', tiedbandana: 'headwrap', bandana: 'headwrap', chefhat: 'headwrap',
  cheftoque: 'headwrap', paradeshako: 'headwrap', jestercap: 'headwrap', skullcap: 'headwrap',
  swimcap: 'headwrap', scrumcap: 'headwrap',

  // structured caps (visible dome, brim near the brow)
  cap: 'closed_hat', snapback: 'closed_hat', ballcap: 'closed_hat', classiccap: 'closed_hat',
  dadcap: 'closed_hat', jockeycap: 'closed_hat', sportcap: 'closed_hat', golfcap: 'closed_hat',
  navycap: 'closed_hat', officercap: 'closed_hat', ribboncap: 'closed_hat', flatsnap: 'closed_hat',
  lightweightracecap: 'closed_hat', reflectivenightcap: 'closed_hat', trailsuncap: 'closed_hat',
  bucket: 'closed_hat', gradcap: 'closed_hat', mortarboard: 'closed_hat',
  cur_technicalracecap: 'closed_hat', cur_sunprotectionrunningcap: 'closed_hat',
  cur_runclubcap: 'closed_hat', cur_cyclingcap: 'closed_hat', cur_nightstripecap: 'closed_hat',
  cur_desertflapcap: 'closed_hat', cur_trailflapcap: 'closed_hat', cur_buckethat: 'closed_hat',
  cur_truckercap: 'closed_hat', cur_tealbrimcap: 'closed_hat', cur_snapback: 'closed_hat',
  cur_glowingracecap: 'closed_hat',

  // taller/brimmed hats with real headroom under the crown
  fedora: 'wide_brim_hat', tophat: 'wide_brim_hat', cowboyhat: 'wide_brim_hat',
  cowpokehat: 'wide_brim_hat', rodeohat: 'wide_brim_hat', witchhat: 'wide_brim_hat',
  boater: 'wide_brim_hat', boaterhat: 'wide_brim_hat', bowler: 'wide_brim_hat',
  gardenhat: 'wide_brim_hat', sunbowhat: 'wide_brim_hat', derbyhat: 'wide_brim_hat',
  clochehat: 'wide_brim_hat', tricorn: 'wide_brim_hat', piratehat: 'wide_brim_hat',
  sailorhat: 'wide_brim_hat', newsboy: 'wide_brim_hat', flatcap: 'wide_brim_hat',
  captaincap: 'wide_brim_hat', beret: 'wide_brim_hat', flatberet: 'wide_brim_hat',
  slouchberet: 'wide_brim_hat', bowberet: 'wide_brim_hat', bowcap: 'wide_brim_hat',
  fez: 'wide_brim_hat', wizardhat: 'wide_brim_hat',
  cur_wizardhat: 'wide_brim_hat', cur_piratehat: 'wide_brim_hat', cur_cowboyhat: 'wide_brim_hat',
  cur_beret: 'wide_brim_hat', cur_sailorcap: 'wide_brim_hat', cur_tropicalstrawhat: 'wide_brim_hat',

  // band + earcups — z-order only, crown stays visible
  headphones: 'headphones', puffmuffs: 'headphones',

  // open-top band across the forehead
  visor: 'visor', runvisor: 'visor', cur_racingvisor: 'visor',

  // thin bands that never claim the scalp
  sweatband: 'headband', wideband: 'headband', daisyband: 'headband', bowband: 'headband',
  maidband: 'headband', scallopband: 'headband', spikecrown: 'headband', punkcrown: 'headband',
  cur_sweatband: 'headband', cur_performanceheadband: 'headband', cur_shinobiheadband: 'headband',
  cur_neonantennaheadband: 'headband',
};

// Resolve a headwear item to its fit category. Order: an explicit override,
// then the catalog's own `hideHair` (encloses the head regardless of hair
// volume → treat like a beanie) or `hidesBulky` (structured cap that only
// needs to compress a bulky style → treat like a closed hat), then anything
// left over — decorative pieces (ears, horns, crowns, clips, bows, wings)
// that were never meant to hide hair at all.
export function getHeadwearCategory(item) {
  if (!item || !item.id || item.id === 'none') return null;
  if (CATEGORY_OVERRIDES[item.id]) return CATEGORY_OVERRIDES[item.id];
  if (item.hideHair) return HEADWEAR_CATEGORY.BEANIE;
  if (item.hidesBulky) return HEADWEAR_CATEGORY.CLOSED_HAT;
  return HEADWEAR_CATEGORY.OPEN_HEADWEAR;
}

export function getHeadwearFitProfile(item) {
  const category = getHeadwearCategory(item);
  if (!category) return { cropHair: false, category: null };
  const profile = FIT_PROFILES[category] || { cropHair: false };
  return { ...profile, category };
}
