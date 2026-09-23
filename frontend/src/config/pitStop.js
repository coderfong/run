// Pit Stop — the race-day hydration station the shop is staged in.
//
// ONE COORDINATE SYSTEM. Every layer in the scene is authored against the
// reference box below and scaled uniformly to whatever width the device gives
// us. Nothing in the scene may carry a device pixel value: a hardcoded
// `left: 42` reads fine on a 390pt phone and lands in the wrong place on a
// 320.
//
// THE BOX IS THE PAINTING NOW. The stall used to be drawn as vector layers
// against an invented 1536x1146; it is a painted illustration since, and every
// number below is MEASURED OFF THAT PICTURE — the awning's lower outline, the
// two shelves, the counter's top edge. Change the art and these all move
// together, which is why `scripts/install-pit-stop-art.py` carries the same
// crop numbers in source pixels and why the QA compositor
// (`scripts/gen-pit-stop-preview.py`) draws against the real plates rather
// than an approximation of them.
//
// THE CREW IS NOT NEW ART. The three volunteers are ordinary PASER avatars —
// real loadouts from the cosmetics catalogue rendered through CharacterRig,
// the same paper doll the profile and the studio draw. That buys us the
// house style for free, and it means expression swaps are exact by
// construction: only the face layer changes, so a blink cannot make the head
// jump (the alignment problem the asset brief spends a section on).
//
// The environment is TWO PAINTED PLATES (see PIT_STOP_PLATES), cut from one
// illustration by `scripts/install-pit-stop-art.py`. It used to be vector art;
// that drawing code is still exported from components/shop/PitStopArt.js and
// still used for the small props, but its five full-scene layers are retired.

import { art } from './onboardingArt';

// ---------------------------------------------------------------------------
// Scene box
// ---------------------------------------------------------------------------

export const SCENE = {
  width: 1536,
  // The painting is close to square once the empty sand below the stall is
  // dropped — a taller hero than the vector stall it replaces. That is
  // affordable because the scene is the FIRST thing in a ScrollView, and
  // picking an item scrolls past it (ShopScreen scrolls to `sceneH`).
  height: 1490,
  // The counter's top edge: where the crew is cut off. This is the back edge
  // of the counter's top surface, not its front — a counter occludes a person
  // from where the surface starts receding, not from the lip.
  counterTop: 1188,
  // Where the top surface ends and the front face begins. Nothing is
  // positioned against this any more (the plate draws both), but it is what
  // the stock on the counter is measured down from.
  counterFront: 1267,
};

export const SCENE_ASPECT = SCENE.width / SCENE.height; // ~1.03

// The Seedance master keeps the sand foreground below the interactive stall.
// Express its portrait height in scene units so movie and overlays share one
// cover scale on every phone.
export const SHOP_VIDEO = { width: 720, height: 1280 };
export const SHOP_VIDEO_SCENE_HEIGHT = SCENE.width * SHOP_VIDEO.height / SHOP_VIDEO.width;

// What the shop SHOWS of that box: everything below `top`, less whatever the
// page's floating chrome covers. The sky above the canopy is cut so the stock
// is on screen the moment the shop opens, but the shop runs the art up under
// the status bar with its buttons floating over it, so PitStopScene hands back
// as much sky as that `headroom` covers and the canopy always starts below the
// buttons. Every frame is still measured in the FULL box: the scene slides the
// whole stack up rather than re-measuring anything.
export const SCENE_VIEW = { top: 360 };

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
// THE PAINTING'S LANDMARKS, so every frame below can be read against them:
//
//   awning        375 .. 563 striped, valance hanging to 671
//   back wall     673 .. 1188, x 184 .. 1352
//   shelves       top surface at y 911; left x 199..532, right x 1010..1330
//   counter       top edge 1188, front lip 1267, lower outline 1479,
//                 x 87 .. 1445
//
// Character frames are sized from CharacterRig's own geometry: the rig draws
// a body `w` wide and `w * 2.58` tall, plus 14% headroom above it for tall
// hair. Two consequences are worth writing down because every crew number
// here follows from them:
//
//   hips  = y + 1.79 * w      what the counter has to cut just below
//   crown = y + 0.18 * w      the top of the headwear, which must clear 673
//                             or a visor grows into the canopy
//
// Those two together are what fixes the crew's SIZE, not taste: the wall is
// only 515 units tall, so a volunteer whose hips reach the counter and whose
// hat clears the awning cannot be much wider than 270. They are smaller
// against this scene than they were against the vector one, and that is the
// picture being honest about how much room a market stall leaves a person.

export const PIT_STOP_LAYOUT = {
  keeper: { x: 768, y: 668, width: 265 },      // centre attendant, x = centre
  restocker: { x: 418, y: 766, width: 215 },   // left
  helper: { x: 1112, y: 758, width: 220 },     // right

  // Three bodies across the wall leave exactly two clear lanes — x 525..636
  // and x 900..1002 — and every hanging prop lives in one of them. The lanes
  // are also the only places on the wall with no shelf beneath, which is why
  // nothing hanging can collide with anything standing.
  //
  // The cup sits just off the attendant's right shoulder, at the counter's
  // back edge, which is where a cup held out across it would be. Its BOTTOM
  // is two units above `counterTop`: the counter plate is drawn after this,
  // so anything lower would be swallowed by it.
  cup: frame({ x: 960, y: 1186, width: 82, height: 112, anchor: 'bottom-center' }),

  // Hanging props. `y` is the pivot — the canopy's lower edge, where a strap
  // would be tied — and these rotate about their top edge, not their centre.
  //
  // There used to be a second bottle at the far right. It is gone: the
  // painting hangs its own pennant banners on both tent poles, so a drawn
  // bottle swinging there was a second object in the same place doing the
  // same job.
  hangBottle: { x: 545, y: 671, width: 66, height: 178 },
  hangMedal: { x: 918, y: 671, width: 84, height: 196 },

  // The stall's name, on a board across the canopy. It stays inside the
  // STRIPED band (375..563) rather than crossing the scalloped valance below
  // it, which is the only part of the awning with a broken edge.
  //
  // The back wall was the other candidate and it does not work: the crew's
  // heads start at ~700, so a board wide enough to read would hang behind
  // them.
  //
  // It is as big as the band allows because it is the page's TITLE: the shop
  // has no header text of its own, so this board is where the screen says
  // what it is.
  sign: { x: 448, y: 400, width: 640, height: 150 },

  // Real PASER icons standing on the painted shelves, one per side. Both go
  // at the shelf ends the crew does NOT stand in front of — the restocker
  // covers the left shelf from x 311, the helper the right one to x 1222 —
  // which leaves one usable pocket on each.
  //
  // THE ICON FILES CARRY PADDING and `contain` keeps it, so a frame whose
  // bottom is the shelf line leaves the drawing hovering above the shelf by
  // however much empty canvas the file ends with. Each frame is therefore
  // sunk by that padding — 10.4% of the timer's height, 14.6% of the
  // trophy's — which is what lands the INK on the shelf.
  stopwatch: frame({ x: 252, y: 920, width: 88, height: 88, anchor: 'bottom-center' }),
  trophy: frame({ x: 1276, y: 924, width: 88, height: 88, anchor: 'bottom-center' }),

  // On the counter, IN FRONT of the crew — this is what sells the depth.
  //
  // Every master is SQUARE, so every frame here is square: GameAnimation
  // sizes by width and lets the asset's own aspect set the height, and a
  // frame that disagreed would just move the art off its mark.
  //
  // They stand a few units BELOW the front lip (1267) rather than on the top
  // surface, because the surface is only 79 units deep at this angle: a base
  // sitting inside it reads as floating behind the counter rather than
  // standing on it.
  //
  // Left to right: coconut, lootbox, [clear], watermelon, [the offered cup],
  // soda. The gap at x 508..666 keeps the two halves of the counter from
  // reading as one wall of stock, and the one at x 870..1207 is where the
  // attendant holds a cup out.
  //
  // `watermelon` sits in front of the ATTENDANT and is the biggest prop on
  // the counter. It works because it is SHORT relative to where the faces
  // are: at 204 its top lands just above the keeper's hips and well below the
  // chest. Grow it past ~230 and it starts eating their torso.
  coconut: frame({ x: 236, y: 1272, width: 186, height: 186, anchor: 'bottom-center' }),
  // Sunk by its own 14.6% of bottom padding, same as the shelf icons.
  lootbox: frame({ x: 452, y: 1288, width: 112, height: 112, anchor: 'bottom-center' }),
  watermelon: frame({ x: 768, y: 1272, width: 204, height: 204, anchor: 'bottom-center' }),
  // This is the prop the helper raises on `presentBeat`, so it has to stay in
  // their lane.
  sodaBottles: frame({ x: 1300, y: 1272, width: 186, height: 186, anchor: 'bottom-center' }),
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
      // The visor, and it only works because the CATALOGUE was fixed: it used
      // to hang at `top: 0.0327`, which put its brim across the eyes at body
      // y 127 with the eyes at 108-120. That blindfolded every runner wearing
      // one, and on this character it switched off the scene — every blink
      // and three of the four rungs of the expression ladder are read off
      // these eyes. See the note on `visor` in config/cosmetics.js. If that
      // layout is ever touched again, look at THIS face first.
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

  // Hanging props. Two of them now, one per clear lane on the wall.
  sway: {
    bottle: { duration: 3100, from: -2.5, to: 2.5 },
    medal: { duration: 4100, from: -1.5, to: 1.5 },
  },

  // AMBIENT MOTION IS THE PAINTING'S JOB NOW, and it does none — which is the
  // right answer for what used to live here.
  //
  // Two things were in this block. A vector garland, thirteen flags rippling
  // off one shared ramp, dropped when the canopy grew its own bunting. And
  // three seamlessly tiling cloud strips drifting at three speeds behind the
  // tent, which the painted sky retires for a reason worth keeping: the
  // painting's sky is not a strip of sky, it is a picture with trees in the
  // top corners and a sun in it. A cloud band crossing that would slide
  // clouds in front of the treetops.
  //
  // `art/shop/pitstop-cloud-band.png` is still installed and still wired in
  // config/onboardingArt.js — PlazaScene is the pattern if anything ever wants
  // a drifting sky again — but nothing in the shop reads it.

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
//
// MOST OF THIS IS NOW THE PROPS' PALETTE, not the stall's: the painting brings
// its own colours, and the layers these were mixed for are retired. The three
// that still describe the SCENE are `plateSky` and `signBoard` (both sampled
// off the painting) and `ink`. The rest dress the small vector props that
// still draw — the hanging bottle, the medal, the offered cup, the sparkles —
// and the reveal glows.

export const PIT_STOP_COLORS = {
  ink: '#0C0C10',
  // Sampled off the top of the painted sky. This is what shows for the frame
  // before the backdrop plate decodes, so it has to be the plate's own colour
  // and not the old night-teal, or the shop opens with a dark flash.
  plateSky: '#55C1FD',
  // The station sign's board, sampled off the counter's deeper blue so the
  // one drawn object on the canopy belongs to the same picture.
  signBoard: '#1173AE',

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
// The painted plates
// ---------------------------------------------------------------------------
//
// TWO DEPTHS, AND THE CREW STANDS BETWEEN THEM. That is the whole reason the
// illustration is cut in two rather than shipped whole:
//
//   backdrop  sky, canopy, back wall, both shelves, the counter's top surface
//   counter   the counter from its back edge down — drawn AFTER the crew, so
//             it cuts them off at the hip the way a real counter would
//
// Both are the full scene box and both come out of one resize of one crop
// (scripts/install-pit-stop-art.py), so they register exactly. There is no
// vector fallback behind them any more: this art ships, and a `require` that
// cannot resolve fails the build rather than degrading at runtime.
//
// The five old override keys (`pitStopBg`, `pitStopTent`, `pitStopBackWall`,
// `pitStopCounterBase`, `pitStopCounterForeground`) were the seam this arrived
// through and are gone with the layers they replaced.

export const PIT_STOP_PLATES = {
  backdrop: () => art('pitStopBackdrop'),
  counter: () => art('pitStopCounter'),
};

/** Props drawn from icon art the app already ships (see components/AppIcon). */
export const PIT_STOP_ICON_PROPS = {
  lootbox: 'lootbox',
  stopwatch: 'timer',
  trophy: 'trophy',
  route: 'route',
};
