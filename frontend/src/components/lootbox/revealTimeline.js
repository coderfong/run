// The whole opening, from the last swipe to "Tap to continue", as ONE clock.
//
// WHY ONE CLOCK. The chest and the item used to be two screens: LootboxGamble
// played the chest, then a timer closed its modal and a caller mounted a
// second one (RewardReveal) for the item. For a frame or several the screen
// underneath showed through, and the item arrived as an unrelated animation
// instead of coming OUT of the chest. Now every moving part — the shake, the
// flash, the chest backing away, the item rising, the page recolouring, the
// captions — is a pure function of one number, `t`, the ms since the last
// swipe. Two things driven off the same `t` cannot drift apart, so the item
// is guaranteed to start rising on the frame the flash hits.
//
// TWO CONSUMERS, ONE TABLE.
//   poses   `chestPose`, `itemPose` and friends are worklets. LootboxGamble
//           runs `t` on the UI thread (one withTiming) and every animated
//           style reads it through these.
//   cues    the discrete beats — haptics, a phase change, a caption mounting,
//           the tap that dismisses unlocking — are listed in `cues`, and one
//           cue clock in LootboxGamble walks that list in order.
//
// PURE NUMBERS, NO REACT, like openingPlan.js: the tests read the table
// directly, because the ORDER of these beats is the feature.

import { PEAK_MS, openingPlan } from './openingPlan';

export const REVEAL_PHASE = {
  // The shut chest is on screen, waiting for its swipes.
  ENTER: 'enter',
  // The last swipe landed: shake, light climbing through the tiers.
  CHARGE: 'charge',
  // The top of the build: harder rattle, the lock flashing, a squash.
  OPEN: 'open',
  // The hit. White flash, rings, sparks, confetti; the item starts rising.
  BURST: 'burst',
  // Under the flash the chest has swapped to open; the item is coming out.
  ITEM_EMERGE: 'item_emerge',
  // The item has reached full size, above where the chest was.
  ITEM_HERO: 'item_hero',
  // Everything has landed. Only now does a tap dismiss.
  COMPLETE: 'complete',
};

export const PHASE_ORDER = Object.values(REVEAL_PHASE);

/** True once `phase` has reached `target` (or gone past it). */
export function reached(phase, target) {
  return PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(target);
}

// From the flash's first frame to the item at full size (it overshoots to
// 1.12 here), then the settle back to 1.
export const EMERGE_MS = 560;
export const SETTLE_MS = 300;
// The chest backs off and fades while the item comes out of it. It starts at
// the swap (under the white) so the overlap is never visible as a cut.
export const CHEST_OUT_MS = 460;
// The page morphs from the mystery night blue into the tier's own colour.
export const PAGE_MORPH_MS = 380;
export const RAYS_IN_MS = 700;
export const GLOW_MS = 700;
// Captions: the name a beat after the item is readable, the tier after it,
// the hint last and alone.
export const NAME_DELAY = 220;
export const RARITY_DELAY = 180;
export const HINT_DELAY = 300;
export const COPY_IN_MS = 260;
export const HINT_IN_MS = 320;
// Light haptic ticks through the build: sparse at first, quickening as the
// charge climbs.
const TICK_FIRST = 180;
const TICK_SLOW = 260;
const TICK_FAST = 150;
// A tick this close to a colour step is dropped; the step has its own.
const TICK_CLEAR = 70;

/**
 * Every mark and cue of one box's reveal, in ms from the last swipe.
 *
 *   plan    openingPlan(rarity), which still owns the build and the flash
 *   marks   plain numbers the worklets read (safe to capture on the UI thread)
 *   cues    [{ at, phase?, light?, haptic?, copy?, impact? }] sorted by `at`
 *   end     when `t` stops
 */
export function revealTimeline(rarity) {
  const plan = openingPlan(rarity);
  const { flashAt, swapAt, flash, hitch, tier } = plan;
  const whiteEnd = flashAt + flash.up + flash.hold;
  const heroAt = flashAt + EMERGE_MS;
  const settledAt = heroAt + SETTLE_MS;
  const nameAt = whiteEnd + NAME_DELAY;
  const rarityAt = nameAt + RARITY_DELAY;
  const hintAt = Math.max(rarityAt + HINT_DELAY, settledAt);

  const marks = {
    peakAt: flashAt - PEAK_MS[tier],
    flashAt,
    flashUp: flash.up,
    whiteEnd,
    flashEnd: whiteEnd + flash.down,
    swapAt,
    hitchAt: hitch ? hitch.at : -1,
    hitchEnd: hitch ? hitch.at + hitch.ms : -1,
    emergeAt: flashAt,
    heroAt,
    settledAt,
    nameAt,
    rarityAt,
    hintAt,
    end: hintAt + HINT_IN_MS,
  };

  const cues = [
    { at: 0, phase: REVEAL_PHASE.CHARGE },
    ...plan.steps.map((s) => ({ at: s.at, light: s.rarity, haptic: 'light' })),
    ...shakeTicks(marks, plan.steps),
    { at: marks.peakAt, phase: REVEAL_PHASE.OPEN, haptic: 'medium' },
    { at: flashAt, phase: REVEAL_PHASE.BURST, impact: true, haptic: plan.reveal.haptic },
    { at: swapAt, phase: REVEAL_PHASE.ITEM_EMERGE },
    { at: nameAt, copy: 1 },
    { at: heroAt, phase: REVEAL_PHASE.ITEM_HERO },
    { at: rarityAt, copy: 2 },
    { at: settledAt, haptic: 'success' },
    { at: hintAt, phase: REVEAL_PHASE.COMPLETE, copy: 3 },
  ].sort((a, b) => a.at - b.at);

  return { plan, tier, marks, cues, end: marks.end };
}

function shakeTicks(m, steps) {
  const ticks = [];
  let at = TICK_FIRST;
  while (at < m.peakAt) {
    const inHitch = m.hitchAt >= 0 && at >= m.hitchAt && at < m.hitchEnd;
    const nearStep = steps.some((s) => Math.abs(s.at - at) < TICK_CLEAR);
    if (!inHitch && !nearStep) ticks.push({ at, haptic: 'light' });
    at += Math.round(TICK_SLOW + (TICK_FAST - TICK_SLOW) * (at / m.flashAt));
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// POSES. Worklets: called from useAnimatedStyle on the UI thread, and as plain
// functions from the tests.
// ---------------------------------------------------------------------------

export function ramp(t, from, to) {
  'worklet';
  if (to <= from) return t >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

function outCubic(x) {
  'worklet';
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

function inOutQuad(x) {
  'worklet';
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) * (-2 * x + 2)) / 2;
}

/** 0..1 through the build, eased in so it is a trickle that becomes a flood. */
export function chargeAt(t, m) {
  'worklet';
  const c = ramp(t, 0, m.flashAt);
  return t > 0 ? c * c : 0;
}

/** Legendary's held breath: 1 while the chest goes dead still before gold. */
export function calmAt(t, m) {
  'worklet';
  if (m.hitchAt < 0 || t < m.hitchAt) return 0;
  if (t < m.hitchEnd) return ramp(t, m.hitchAt, m.hitchAt + 180);
  return 1 - ramp(t, m.hitchEnd, m.hitchEnd + 90);
}

/** 0..1 through the top of the build, the OPEN phase. 0 again at the hit. */
export function peakAt(t, m) {
  'worklet';
  return t >= m.flashAt ? 0 : ramp(t, m.peakAt, m.flashAt);
}

/** The white hit. Snaps up, holds (hiding the swap), falls off. */
export function flashAt(t, m) {
  'worklet';
  if (t < m.flashAt) return 0;
  if (t < m.flashAt + m.flashUp) return ramp(t, m.flashAt, m.flashAt + m.flashUp);
  if (t < m.whiteEnd) return 1;
  const d = ramp(t, m.whiteEnd, m.flashEnd);
  return 1 - d * (2 - d);
}

/**
 * The chest, from the shut box through the rattle to backing off out of the
 * item's way. `closed` / `silhouette` / `open` pick which drawing shows; the
 * swap between them happens at `swapAt`, while the screen is solid white.
 */
export function chestPose(t, m) {
  'worklet';
  const c = chargeAt(t, m);
  const k = calmAt(t, m);
  const o = peakAt(t, m);
  const building = t > 0 && t < m.flashAt;
  // Shake phase, integrated so the rattle can quicken through the peak
  // without the sine jumping: the extra 45% of frequency only accrues while
  // `o` ramps, so the phase is the area under that ramp.
  const span = Math.max(1, m.flashAt - m.peakAt);
  const into = Math.min(Math.max(0, t - m.peakAt), span);
  const phase = (t + 0.45 * ((into * into) / (2 * span))) / 110;
  const amp = building ? (3 + 7 * c + 5 * o) * (1 - k) : 0;
  const out = inOutQuad(ramp(t, m.swapAt, m.swapAt + CHEST_OUT_MS));
  const shrink = 1 - 0.12 * out;
  return {
    shakeX: Math.sin(phase * Math.PI * 2) * amp,
    squashX: building ? 1 + 0.05 * o : 1,
    squashY: building ? 1 - 0.06 * o : 1,
    exitY: 60 * out,
    exitScale: shrink,
    opacity: 1 - out,
    closed: t < m.swapAt ? 1 : 0,
    silhouette: t >= m.flashAt && t < m.swapAt ? 1 : 0,
    open: t >= m.swapAt ? 1 : 0,
  };
}

/**
 * The item. It exists (opacity 0, pre-rendered) from the first frame; at the
 * hit it starts rising out of the chest's mouth UNDER the white, overshoots to
 * 1.12 as it reaches its hero spot, and settles to 1.
 *
 * `rise` is how far below its hero spot the chest's mouth is, in points.
 */
export function itemPose(t, m, rise) {
  'worklet';
  const p = outCubic(ramp(t, m.emergeAt, m.heroAt));
  const q = inOutQuad(ramp(t, m.heroAt, m.settledAt));
  const emerging = t < m.heroAt;
  return {
    opacity: t < m.emergeAt ? 0 : ramp(t, m.emergeAt, m.whiteEnd + 60),
    translateY: (1 - p) * rise,
    scale: emerging ? 0.45 + 0.67 * p : 1.12 - 0.12 * q,
    rotate: emerging ? -4 + 6 * p : 2 - 2 * q,
  };
}

/** The page recolouring, the gold glow thrown out of the mouth, the rays. */
export function stagePose(t, m) {
  'worklet';
  const g = outCubic(ramp(t, m.flashAt, m.flashAt + GLOW_MS));
  const r = ramp(t, m.flashAt + m.flashUp, m.flashAt + m.flashUp + RAYS_IN_MS);
  return {
    page: ramp(t, m.flashAt + m.flashUp, m.flashAt + m.flashUp + PAGE_MORPH_MS),
    glowOpacity: t < m.flashAt ? 0 : 1 - 0.6 * g,
    glowScale: 0.3 + 2.7 * g,
    rays: r * (2 - r),
    raysScale: 0.6 + 0.4 * r,
  };
}

/** A caption fading up from `at`. */
export function copyPose(t, at, ms = COPY_IN_MS) {
  'worklet';
  const x = outCubic(ramp(t, at, at + ms));
  return { opacity: x, translateY: 12 * (1 - x) };
}
