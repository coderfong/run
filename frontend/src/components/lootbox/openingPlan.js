// The opening, beat by beat, for every tier a box can land on.
//
// PURE NUMBERS, NO REACT. LootboxGamble schedules its beats off this table and
// the tests read it directly: the order and the proportion of the beats IS the
// feature, and a table is far easier to hold to that than a render is.
//
// THE SHAPE. The last swipe starts a BUILD, the build ends in a FLASH, and the
// swap from the shut chest to the reward happens under the flash. What differs
// between tiers is how long the build runs and what the flash lets out.
//
// THE LIGHT CLIMBS. Once the swipes are spent the chest starts leaking light,
// white at first. A rare box turns it blue before it pops; an epic one goes
// blue, then purple; a legendary one goes blue, purple, then stops dead, long
// enough to believe it has finished, and bursts gold. So a better box is not
// only a louder reveal but a longer wait that keeps promising more, which is
// where the anticipation actually lives. The colour is the tease; the item is
// only ever shown after the flash.

export const TIERS = ['common', 'rare', 'epic', 'legendary'];

// White light and a building shake, before any colour shows.
export const LEAD_MS = 700;
// How long the light holds each colour it climbs through before the next.
export const DWELL_MS = 480;
// Legendary only. The chest goes still and the light sinks back, right before
// gold: long enough to read as the end, short enough that nobody looks away.
export const HITCH_MS = 520;
// The rattle at the top of the build, after the last colour and before the
// flash. It grows with the tier, because the top of a legendary build is the
// moment everything before it was winding toward.
export const PEAK_MS = { common: 250, rare: 500, epic: 560, legendary: 760 };

// The flash. `up` is under four frames so it lands as a hit rather than a fade
// to white. `hold` is how long the screen stays blank, which is what hides the
// swap underneath, and what makes a bigger box feel like a bigger hit.
export const FLASH = {
  common: { up: 55, hold: 40, down: 320 },
  rare: { up: 55, hold: 60, down: 380 },
  epic: { up: 55, hold: 100, down: 460 },
  legendary: { up: 50, hold: 190, down: 640 },
};

// The reveal, in ms from the swap. Shared by every tier so the acts stay in
// proportion; only how long the tier leaves you with it before Collect differs.
export const REVEAL_BEATS = {
  // The item starts up out of the chest while the flash is still falling.
  rise: 90,
  riseMs: 640,
  // The tier's name slams down once the item is most of the way out.
  title: 300,
  titleMs: 220,
  // Then what the item is called.
  label: 640,
  // Legendary only: a second, smaller hit once everything has landed.
  aftershock: 760,
};

// What the flash lets out. Nothing here shrinks as the tier goes up, and the
// tests hold it to that.
//
//   sunburst    the lightning master's opaque gold fan instead of the soft rays
//   rayAlpha    how hard the rays show over the tier's page
//   spinMs      one turn of the rays
//   sparks      glints thrown out of the chest at the hit
//   rings       shockwaves out of the chest at the hit
//   confetti    full screen paper
//   quake       how far the whole stage is thrown at the hit, in points
//   bursts      animated clips fired at the mouth (config/gameAnimations.js)
//   bolts       the lightning crackling over the backdrop
//   twinkles    stars riding the item's corners
//   aftershock  a second hit once the reveal has landed
//   settleMs    from the swap to Collect appearing
export const REVEAL = {
  common: {
    sunburst: false, rayAlpha: 0.45, spinMs: 22000,
    sparks: 8, rings: 1, confetti: 0, quake: 0,
    bursts: [], bolts: false, twinkles: false, aftershock: false,
    haptic: 'medium', settleMs: 950,
  },
  rare: {
    sunburst: false, rayAlpha: 0.7, spinMs: 16000,
    sparks: 10, rings: 1, confetti: 18, quake: 3,
    bursts: ['rewardBurst'], bolts: false, twinkles: false, aftershock: false,
    haptic: 'medium', settleMs: 1100,
  },
  epic: {
    sunburst: false, rayAlpha: 0.9, spinMs: 11000,
    sparks: 12, rings: 2, confetti: 36, quake: 6,
    bursts: ['rewardBurst', 'confettiBurst'], bolts: false, twinkles: true, aftershock: false,
    haptic: 'heavy', settleMs: 1300,
  },
  legendary: {
    sunburst: true, rayAlpha: 1, spinMs: 8000,
    sparks: 16, rings: 3, confetti: 56, quake: 10,
    bursts: ['impactGold', 'rewardBurst', 'confettiBurst'], bolts: true, twinkles: true, aftershock: true,
    haptic: 'heavy', settleMs: 1750,
  },
};

/** The tier a rarity opens as. Anything unrecognised opens at the floor. */
export function tierOf(rarity) {
  return TIERS.includes(rarity) ? rarity : 'common';
}

/**
 * Every beat of one box's opening, in ms from the last swipe.
 *
 *   steps    [{ at, rarity }]  each colour the light climbs to, in order
 *   hitch    { at, ms } | null the held breath before gold (legendary only)
 *   flashAt  when the build is spent and the flash is due
 *   swapAt   when the screen underneath the flash changes over
 */
export function openingPlan(rarity) {
  const tier = tierOf(rarity);
  const climb = TIERS.slice(1, TIERS.indexOf(tier) + 1);
  const steps = [];
  let hitch = null;
  let at = LEAD_MS;
  climb.forEach((r, i) => {
    if (r === 'legendary') {
      hitch = { at, ms: HITCH_MS };
      at += HITCH_MS;
    }
    steps.push({ at, rarity: r });
    if (i < climb.length - 1) at += DWELL_MS;
  });
  const flashAt = at + PEAK_MS[tier];
  const flash = FLASH[tier];
  return {
    tier,
    steps,
    hitch,
    flashAt,
    flash,
    // Halfway through the blank, so a timer that fires a frame or two late
    // still lands while the screen is white.
    swapAt: flashAt + flash.up + Math.round(flash.hold / 2),
    reveal: REVEAL[tier],
  };
}
