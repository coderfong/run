// Pit Stop — the race-day hydration station the shop is staged in.
//
// ONE COORDINATE SYSTEM. Every layer in the scene is authored against the
// reference box below (1536 x 1146, the brief's 1.34 illustration ratio) and
// scaled uniformly to whatever width the device gives us. Nothing in the
// scene may carry a device pixel value: a hardcoded `left: 42` reads fine on
// a 390pt phone and lands in the wrong place on a 320.
//
// THE CREW IS NOT NEW ART. The three volunteers are ordinary PASER avatars —
// real loadouts from the cosmetics catalogue rendered through CharacterRig,
// the same paper doll the profile and the studio draw. That buys us the
// house style for free, and it means expression swaps are exact by
// construction: only the face layer changes, so a blink cannot make the head
// jump (the alignment problem the asset brief spends a section on).
//
// The environment (tent, counter, cooler, bunting, props) is drawn as vector
// art in components/shop/PitStopArt.js rather than shipped as PNG layers.
// Flat fills inside a heavy black outline is exactly what SVG is good at, it
// stays crisp at every width, and it means the screen has no missing-art
// state to degrade into. `PIT_STOP_ART_OVERRIDES` below is the seam for
// swapping any layer for painted art later without touching animation code.

import { art } from './onboardingArt';

// ---------------------------------------------------------------------------
// Scene box
// ---------------------------------------------------------------------------

export const SCENE = {
  width: 1536,
  height: 1146,
  // Everything standing behind the counter is cut off at this line.
  counterTop: 830,
  counterFront: 900,
  // How much of that height the hero actually SHOWS. The scene is still
  // authored, drawn and positioned against the full 1146 — this crops the
  // bottom off, it does not rescale anything, so every frame in the layout
  // below keeps meaning what it says. The cut lands on the counter skirt's
  // lower rule (y 1010) plus its stroke, so the purple stripe becomes the
  // hero's bottom trim instead of a band floating above dead cloth.
  //
  // Anything that fills the whole scene must therefore be sized to
  // SCENE.height explicitly and NOT to the container — see `sceneBox` in
  // PitStopScene. A full-scene SVG left on `absoluteFill` would shrink its
  // viewBox to the shorter box and drift out of register with the crew.
  visibleHeight: 1014,
};

export const SCENE_ASPECT = SCENE.width / SCENE.visibleHeight; // ~1.51

/** Reference units -> fraction of the scene box, for percentage layout. */
export const px = (x) => `${(x / SCENE.width) * 100}%`;
export const py = (y) => `${(y / SCENE.height) * 100}%`;

/**
 * A layer frame in reference units. `x`/`y` are the TOP-LEFT corner unless
 * `anchor: 'bottom-center'`, which places the frame by the centre of its
 * bottom edge — the useful anchor for anything standing on the counter.
 */
export const frame = ({ x, y, width, height, anchor }) => {
  if (anchor === 'bottom-center') {
    return { x: x - width / 2, y: y - height, width, height };
  }
  return { x, y, width, height };
};

// ---------------------------------------------------------------------------
// Layout — where every layer sits in reference units
// ---------------------------------------------------------------------------
//
// Character frames are sized from CharacterRig's own geometry: the rig draws
// a body `w` wide and `w * 2.58` tall, plus 14% headroom above it for tall
// hair. The `y` values below are chosen so the counter line lands just above
// each volunteer's hips — that overlap is what makes them read as standing
// BEHIND the counter rather than pasted on top of it.

export const PIT_STOP_LAYOUT = {
  keeper: { x: 768, y: 183, width: 330 },      // centre attendant, x = centre
  restocker: { x: 330, y: 320, width: 260 },   // left
  helper: { x: 1210, y: 310, width: 265 },     // right

  // Three bodies across a 1536 frame leave exactly two clear lanes of counter
  // — x 460-603 and x 933-1077 — and every hero prop has to live in one of
  // them. Anything placed dead centre lands on the attendant's chest and
  // reads as pinned to them rather than standing on the counter.
  //
  // Right lane: the cup, just off the attendant's shoulder, where a cup held
  // out across the counter would actually be.
  cup: frame({ x: 1005, y: 828, width: 96, height: 132, anchor: 'bottom-center' }),
  // The LEFT lane used to hold `featured` — the selected product, risen off
  // the counter. It moved out of the illustration entirely (see PitStopScene),
  // because the one thing on this screen you have to read should not live in a
  // decorative layer that takes no touches. The lane stays clear: it is what
  // keeps the counter from reading as a solid wall of props.

  // Hanging props. `y` is the pivot (where the strap meets the frame rail) —
  // these rotate about their top edge, not their centre.
  //
  // The two bottles hang at the tent poles, outside the back wall entirely.
  // Anywhere else they swing across either a face or the shelf stock: with
  // three heads and two shelves in the frame there are only two clear lanes
  // left on the wall (x 476-603 and x 933-1064), and those are spoken for by
  // the route board and the bib.
  hangBottleLeft: { x: 56, y: 292, width: 74, height: 210 },
  // The right cluster keeps a clean 16-unit gap: the medal ends at the tent
  // pole, while the bottle sits just inside the scene edge. The old bottle
  // frame ended 18 units off-canvas and visibly lost its right outline at
  // 320pt.
  hangMedal: { x: 1342, y: 286, width: 96, height: 232 },
  hangBottleRight: { x: 1454, y: 292, width: 74, height: 196 },

  // Back wall furniture.
  //
  // `sign` is the stall's one piece of signage, and it is the OPEN sign: it
  // hangs from the peak of the tent where a painted banner used to, dead
  // centre, and it is drawn last so nothing in the scene crosses it. Square,
  // because the art is — the badge fills the width and the string it hangs
  // from occupies the air above.
  //
  // It is deliberately wide enough to clip the top corner of the route board
  // and to hang in front of the garland. A sign that cleared every other
  // object would have to be small enough not to read.
  sign: frame({ x: 768, y: 368, width: 340, height: 340, anchor: 'bottom-center' }),

  routeBoard: { x: 486, y: 360, width: 128, height: 114 },
  raceBib: { x: 946, y: 372, width: 128, height: 116 },
  shelfLeft: { x: 116, y: 520, width: 360, height: 18 },
  shelfRight: { x: 1064, y: 520, width: 360, height: 18 },
  // A real PASER icon standing on the shelf, rather than a drawn lookalike —
  // see PIT_STOP_ICON_PROPS. It goes at the LEFT end because the supports
  // occlude the middle of both shelves; x 116-200 is the only strip of the
  // left shelf an audience ever sees.
  stopwatch: frame({ x: 166, y: 522, width: 100, height: 100, anchor: 'bottom-center' }),

  // On the counter, IN FRONT of the crew — this is what sells the depth.
  //
  // THE STOCK IS ALL REAL ART NOW. The drawn towels, cooler, gel tray and
  // fruit bowl are gone; what stands on the counter is the supplied clips,
  // sized to be read rather than to keep out of the way. Every master is
  // SQUARE, so every frame here is square: GameAnimation sizes by width and
  // lets the asset's own aspect set the height, and a frame that disagreed
  // would just move the art off its mark.
  //
  // Left to right: coconut, lootbox, [clear], watermelon, [the offered cup],
  // soda. The gap at x 444-620 is the old featured-product lane and the one at
  // x 957-1053 is where the attendant holds a cup out — a prop parked in
  // either would be drawn over, or would crowd the hand offering the cup.
  //
  // `watermelon` sits in front of the ATTENDANT, which the lane comment above
  // warns off, and it is the biggest prop on the counter. It works because the
  // prop is SHORT relative to where the crew's faces are: at 250 it spans
  // y 656-906 against a counter top at 830, so it reaches their hip and stops
  // well below the chest. That is the line the warning is really drawing —
  // grow this past ~280 and it starts eating the attendant's torso.
  coconut: frame({ x: 150, y: 906, width: 220, height: 220, anchor: 'bottom-center' }),
  lootbox: frame({ x: 330, y: 902, width: 132, height: 132, anchor: 'bottom-center' }),
  watermelon: frame({ x: 760, y: 906, width: 250, height: 250, anchor: 'bottom-center' }),
  // This is the prop the helper raises on `presentBeat`, so it has to stay in
  // their lane.
  sodaBottles: frame({ x: 1400, y: 906, width: 220, height: 220, anchor: 'bottom-center' }),

  // `balloons` was here — a clip in the top-left pocket of air. It is gone:
  // the canopy's bunting is the tent's decoration, and the balloons were the
  // one prop on this screen that neither held stock nor reacted to anything,
  // so they cost a looping decoder for nothing.
};

// ---------------------------------------------------------------------------
// The crew
// ---------------------------------------------------------------------------
//
// Real catalogue ids (see config/cosmetics.js). Colour numbers index the
// palettes there: CLOTH_COLORS 0 white, 1 ink, 2 red, 3 orange, 4 yellow,
// 5 green, 6 teal, 7 blue, 8 purple, 9 pink; HAIR_COLORS 0 black, 2 brown,
// 4 blond, 5 ginger, 6 grey, 7 pink.
//
// THE CREW IS NEVER UNHAPPY. The expression ladder only ever climbs — happy
// at rest, happier at a highlight, happiest on a purchase — because a shop
// attendant who resets to a flat mouth every few seconds reads as bored, and
// because the flat face was doing most of the work in making the scene feel
// twitchy. There is no "neutral" rung any more:
//
//   happy   content (dot eyes, soft closed smile)   the resting face
//   happier smiley  (same dot eyes, wide smile)     cup offer, item selected
//   cheer   laugh   (arc eyes, open mouth)          purchase / rare reveal
//   sorry   uneasy                                  can't sell you this one
//
// Faces are chosen in MATCHED PAIRS. A blink is a face swap, so the closed
// face has to differ from the open one in the EYES ONLY — swap in a face
// whose mouth also moved and the blink reads as the whole head twitching.
// `blink` maps a shown face to its partner; a face with no partner simply
// doesn't blink, which is correct: nobody blinks mid-cheer.
//
//   content (dot eyes, soft smile)  -> wink (one lid down, same smile)
//
// `smiley` has no eyes-only partner in the catalogue, so it never blinks —
// which is why it is reserved for the SHORT beats. Every state a user can sit
// in for a long time resolves to `content`, so the crew always has a face
// that can blink while you browse.

export const PIT_STOP_CREW = {
  keeper: {
    equipped: {
      face: 'content',
      hair: 'curls', hairColor: 0,
      headwear: 'visor', headwearColor: 9,
      glasses: 'none', glassesColor: 1,
      top: 'polo', topColor: 6,
      bottom: 'none', bottomColor: 1,
      accessory: 'hydrovest',
    },
    faces: { happy: 'content', happier: 'smiley', cheer: 'laugh', sorry: 'uneasy' },
    blink: { content: 'wink' },
  },
  restocker: {
    equipped: {
      face: 'content',
      hair: 'curls', hairColor: 0,
      headwear: 'cap', headwearColor: 6,
      glasses: 'none', glassesColor: 1,
      top: 'windbreaker', topColor: 3,
      bottom: 'none', bottomColor: 1,
      accessory: 'none',
    },
    faces: { happy: 'content', happier: 'smiley', cheer: 'laugh', sorry: 'content' },
    blink: { content: 'wink' },
  },
  helper: {
    equipped: {
      face: 'content',
      hair: 'spacebuns', hairColor: 4,
      headwear: 'sweatband', headwearColor: 0,
      glasses: 'none', glassesColor: 1,
      top: 'singlet', topColor: 9,
      bottom: 'none', bottomColor: 1,
      accessory: 'goldmedal',
    },
    faces: { happy: 'content', happier: 'smiley', cheer: 'laugh', sorry: 'content' },
    blink: { content: 'wink' },
  },
};

// ---------------------------------------------------------------------------
// Animation constants — every duration in the scene lives here
// ---------------------------------------------------------------------------

export const PIT_STOP_ANIM = {
  // Idle bob. Deliberately tiny: 3px of travel on a 1536-wide reference is
  // sub-pixel drift on a phone, which is what "alive but not distracting"
  // means. The three loops are coprime-ish so they never march in step.
  idle: {
    keeper: { duration: 2600, travel: 3, delay: 0 },
    restocker: { duration: 3100, travel: 2, delay: 260 },
    helper: { duration: 2900, travel: 2.5, delay: 520 },
  },

  // Blink: a swap, not an eyelid tween. A blink IS a face change, so the gaps
  // are wide — at the old 2.5s floor the three of them were between them
  // swapping a face about once a second, which is what made the counter look
  // restless rather than alive.
  blink: { minGap: 4200, maxGap: 9000, closed: 92, doubleChance: 0.22, doubleGap: 108 },

  // The cup-offer cycle, ~13s: a long plain idle, then an unhurried offer.
  // Every phase here is a face or body change, so these are the numbers that
  // decide how busy the scene feels. They were roughly halved before, which
  // put four expression changes inside two and a half seconds.
  offer: { gap: 8200, hold: 4600, prep: 1400, rise: 620, present: 1800, lower: 900 },

  // The floor on how long any expression stays on screen before another one
  // may replace it. Reactions the user caused (a purchase, an item they can't
  // afford) jump the queue — see `useHeldExpression`. Everything else waits,
  // so flicking through the grid can't strobe the crew's faces.
  expression: { minHold: 1100 },

  // Support beats. Jittered inside these bounds so the two never lock.
  restock: { minGap: 8000, maxGap: 13000, duration: 1400 },
  present: { minGap: 9000, maxGap: 15000, duration: 1500 },

  // Hanging props.
  sway: {
    bottleLeft: { duration: 3100, from: -2.5, to: 2.5 },
    bottleRight: { duration: 3500, from: 2, to: -2 },
    medal: { duration: 4100, from: -1.5, to: 1.5 },
    bunting: { duration: 4800, travel: 1.5 },
  },

  // Ambient backdrop — the moving parts behind the crew.
  //
  // A garland used to live here: thirteen flags reading one shared 0->1 ramp,
  // each offset by its index so the row rippled instead of flapping as a sheet.
  // It was replaced by a supplied clip and then dropped altogether, so both the
  // ramp and the per-flag geometry are gone. The back wall carries no flags now
  // — the tent's own bunting on the canopy is the scene's only garland.
  ambient: {
    // Cloud drift on the far side of the course. Three SEAMLESSLY TILING
    // strips of the same band, not three lone puffs crossing the sky: the
    // supplied clip was a rigid scroll of a repeating band, so it ships as one
    // still frame (art `pitStopCloudBand`) and the scroll happens in the
    // scene. That is what lets one asset serve three layers at three speeds —
    // an animated clip drifts only at the rate it was authored at.
    //
    // `width` is therefore a TILE width, not a cloud width, and each strip
    // repeats it across the scene.
    //
    // `speed` MUST BE A POSITIVE INTEGER. The strips share one ramp, and a
    // strip's offset is `(clock * speed + offset) % 1`. When the ramp resets
    // from 1 to 0 that expression only lands back where it was if `speed` is a
    // whole number of cycles — at 1.4 the strip jumps 40% of a tile sideways
    // every time the clock wraps. Bigger and faster reads as nearer, so the
    // three are ordered far to near.
    //
    // The opacities are higher than the vector puffs they replace (0.09-0.15),
    // which were tuned for flat shapes and made real cloud art invisible — but
    // only about twice as high, not five times. THESE THREE STACK: the strips
    // overlap in the same sliver of sky the canopy leaves, so opacities that
    // each look reasonable alone compound into a grey smear across the top of
    // the tent. What should survive is a peek of cloud tops, not a sky anyone
    // can study.
    clouds: [
      { y: 8, width: 220, speed: 1, offset: 0.45, opacity: 0.14 },
      { y: 3, width: 330, speed: 2, offset: 0.0, opacity: 0.2 },
      { y: 0, width: 460, speed: 3, offset: 0.78, opacity: 0.28 },
    ],
    cloudTravel: 96000,
  },

  // Interaction feedback.
  select: { rise: 180, glow: 250, react: 320 },
  purchase: { pop: 260, settle: 420, total: 1150 },
  shrug: { duration: 470 },
  reveal: { rare: 900, epic: 1200, legendary: 1550 },
};

/** How hard the scene reacts to a purchase, by rarity. */
export const REVEAL_INTENSITY = {
  common: { rise: 0, glow: 0.0, sparkles: 0, column: false, spin: 0 },
  rare: { rise: 4, glow: 0.55, sparkles: 4, column: false, spin: 0 },
  epic: { rise: 6, glow: 0.75, sparkles: 6, column: false, spin: 0 },
  legendary: { rise: 8, glow: 0.95, sparkles: 8, column: true, spin: 5 },
};

// ---------------------------------------------------------------------------
// Scene palette
// ---------------------------------------------------------------------------
//
// Off-white tent fabric, teal hydration, warm orange for the food end of the
// counter, PASER pink for the event branding — all inside the same heavy ink
// outline the character art uses, so the crew doesn't look pasted in.

export const PIT_STOP_COLORS = {
  ink: '#0C0C10',
  skyTop: '#16273D',
  skyBottom: '#0F3946',

  fabric: '#F5EFE6',
  fabricShade: '#E2D8C8',
  fabricDeep: '#CFC2AE',
  stripe: '#2DD4BF',
  stripeAlt: '#EC4899',

  wall: '#17323F',
  wallShade: '#122834',

  counterTop: '#1C5B69',
  counterFace: '#12414E',
  counterSkirt: '#2DD4BF',
  counterEdge: '#8B5CF6',

  cooler: '#F59E0B',
  coolerLid: '#2DD4BF',
  bottleTeal: '#2DD4BF',
  bottlePink: '#EC4899',
  bottleBlue: '#60A5FA',
  cup: '#FAF7F2',
  gold: '#F5C451',
  towel: '#F9A8D4',
  towelAlt: '#FDE68A',
  gel: '#F97316',
  fruit: '#EAB308',
  board: '#123243',
  paper: '#FAF7F2',

  glow: '#FDE68A',
  glowRare: '#60A5FA',
  glowEpic: '#C084FC',
  glowLegendary: '#F5C451',
};

/** Rarity -> the colour the featured glow burns. */
export const REVEAL_GLOW = {
  common: PIT_STOP_COLORS.glow,
  rare: PIT_STOP_COLORS.glowRare,
  epic: PIT_STOP_COLORS.glowEpic,
  legendary: PIT_STOP_COLORS.glowLegendary,
};

// ---------------------------------------------------------------------------
// Optional painted-art overrides
// ---------------------------------------------------------------------------
//
// The scene draws itself. If painted layers land later, register them in
// config/onboardingArt.js under these keys and the scene prefers them — no
// animation code changes, because the frames above stay the source of truth
// for position. `art()` returns null for anything missing, which is the
// "graceful handling of missing artwork" path: today, every one of these is
// null and every layer falls back to vector.

export const PIT_STOP_ART_OVERRIDES = {
  background: () => art('pitStopBg'),
  tent: () => art('pitStopTent'),
  backWall: () => art('pitStopBackWall'),
  counterBase: () => art('pitStopCounterBase'),
  counterForeground: () => art('pitStopCounterForeground'),
};

/** Props drawn from icon art the app already ships (see components/AppIcon). */
export const PIT_STOP_ICON_PROPS = {
  lootbox: 'lootbox',
  stopwatch: 'timer',
  trophy: 'trophy',
  route: 'route',
};
