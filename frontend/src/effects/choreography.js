// The choreography vocabulary.
//
// A capture style used to be a playlist: effect A appears, effect B appears,
// the stage rattles, the ground turns over, effect C appears. Fifteen of them,
// different sprites and anchors each time, and every one of them the same
// EVENT. Changing the paint on an identical movement is why a run of claims
// read as recolours.
//
// So a style is no longer a list of effects. It is five parallel tracks:
//
//     actor      what the runner's character does
//     camera     what the scene does
//     effects    what the art does, including art that TRAVELS
//     territory  how the ground itself changes hands
//     feel       haptics, and the pauses that make an impact land
//
// and the thing that distinguishes two celebrations is the shape of those
// tracks, not which sprite sheet turned up. `choreographySignature` at the
// bottom is the check, and it deliberately cannot see effect ids: two styles
// that jump, slam and crack the ground are the same animation whether one of
// them is on fire and the other is frozen.
//
// This module is plain data and plain functions on purpose — no Reanimated, no
// React. The transform chains that execute an actor action live in
// ClaimActor.js, the stage cues in useCaptureStage.js, and the ground
// transitions in claim/TerritoryRevealCanvas.js. Here is only what happens,
// when, and in what order.

// ---------------------------------------------------------------------------
// What the actor can do
// ---------------------------------------------------------------------------
//
// Deliberately transform-level. The PASER character is assembled at runtime
// from live cosmetics (CharacterRig), so there are no pose sprites to cut to —
// but a container that can translate, scale, squash and rotate covers every
// beat below, and reads as intent because of its TIMING rather than its
// drawing. A wind-up that takes 320ms and a release that takes 90ms is a punch
// whatever the arms are doing.
//
// `duration` is how long the action owns the actor. Archetypes schedule off
// these, so changing one here retimes every style that uses it.
export const ACTOR_ACTION = Object.freeze({
  IDLE: 'idle',
  LOOK: 'look',
  BRACE: 'brace',
  CHARGE: 'charge',
  CAST: 'cast',
  PUNCH: 'punch',
  STOMP: 'stomp',
  JUMP: 'jump',
  SLAM: 'slam',
  JUMP_SLAM: 'jumpSlam',
  STEP_FORWARD: 'stepForward',
  DASH_FORWARD: 'dashForward',
  THROW: 'throw',
  PLANT: 'plant',
  RECOIL: 'recoil',
  KNOCKBACK: 'knockback',
  PULLED: 'pulled',
  CELEBRATE: 'celebrate',
});

// duration  — how long the actor is busy
// anticipation — how much of that is wind-up BEFORE the committed movement.
//   The player uses it to align a cue (a projectile leaving a hand, a bolt
//   landing) with the moment the action actually commits, rather than with the
//   moment it started. This is the single most load-bearing number in the file:
//   an impact that lands during the wind-up looks like the effect caused the
//   character rather than the other way round.
const ACTOR_SPECS = Object.freeze({
  [ACTOR_ACTION.IDLE]: { duration: 200, anticipation: 0 },
  [ACTOR_ACTION.LOOK]: { duration: 420, anticipation: 0 },
  [ACTOR_ACTION.BRACE]: { duration: 500, anticipation: 180 },
  [ACTOR_ACTION.CHARGE]: { duration: 760, anticipation: 640 },
  [ACTOR_ACTION.CAST]: { duration: 620, anticipation: 300 },
  [ACTOR_ACTION.PUNCH]: { duration: 650, anticipation: 360 },
  [ACTOR_ACTION.STOMP]: { duration: 560, anticipation: 300 },
  [ACTOR_ACTION.JUMP]: { duration: 520, anticipation: 140 },
  [ACTOR_ACTION.SLAM]: { duration: 420, anticipation: 120 },
  [ACTOR_ACTION.JUMP_SLAM]: { duration: 900, anticipation: 560 },
  [ACTOR_ACTION.STEP_FORWARD]: { duration: 380, anticipation: 60 },
  [ACTOR_ACTION.DASH_FORWARD]: { duration: 420, anticipation: 120 },
  [ACTOR_ACTION.THROW]: { duration: 600, anticipation: 340 },
  [ACTOR_ACTION.PLANT]: { duration: 620, anticipation: 300 },
  [ACTOR_ACTION.RECOIL]: { duration: 520, anticipation: 0 },
  [ACTOR_ACTION.KNOCKBACK]: { duration: 780, anticipation: 0 },
  [ACTOR_ACTION.PULLED]: { duration: 700, anticipation: 0 },
  [ACTOR_ACTION.CELEBRATE]: { duration: 900, anticipation: 0 },
});

export function actorActionSpec(action) {
  return ACTOR_SPECS[action] || ACTOR_SPECS[ACTOR_ACTION.IDLE];
}

/** When an actor action is finished and the body is free again. */
export function actorEndsAt(start, action, options = {}) {
  return start + (options.duration || actorActionSpec(action).duration);
}

/**
 * The earliest an actor beat can start without cancelling the one before it.
 *
 * There is ONE body. Two overlapping actor steps means the second silently
 * takes over the transform chain and the first never finishes — the beat the
 * style was written around simply does not play, and nothing errors. Four of
 * the fifteen archetypes were doing this: a throw begun 120ms into a 380ms step
 * forward, a recoil begun while a slam was still landing.
 *
 * Archetypes therefore schedule the body through this rather than by picking
 * numbers that look about right. Effects, camera and ground are unaffected —
 * those tracks are SUPPOSED to overlap, and that overlap is the choreography.
 */
export function afterActor(wanted, previousStart, previousAction, options = {}) {
  return Math.max(wanted, actorEndsAt(previousStart, previousAction, options));
}

/** When an actor action commits — the frame its effect should be caused by. */
export function actorCommitAt(step) {
  const spec = actorActionSpec(step.name);
  const scale = step.duration ? step.duration / spec.duration : 1;
  return Math.round(step.start + spec.anticipation * scale);
}

// ---------------------------------------------------------------------------
// What the scene can do
// ---------------------------------------------------------------------------
//
// These move the OVERLAY STACK — the reveal, the actor and the effects
// together — and not the Mapbox camera. That is a hard constraint, not a
// shortcut: the reveal is screen-space, projected once from a camera that is
// flat and stopped, and moving the real camera mid-sequence invalidates every
// pixel the overlay was laid out in (see the note in useClaimReveal.focus).
// A 1.1x push over 300ms still reads as a camera move because everything that
// is moving is on the stage; the ground under it is a static backdrop.
export const CAMERA_ACTION = Object.freeze({
  ZOOM_IN: 'zoomIn',
  ZOOM_OUT: 'zoomOut',
  PUNCH_IN: 'punchIn',
  WHIP_DOWN: 'whipDown',
  WHIP_UP: 'whipUp',
  TILT: 'tilt',
  FREEZE: 'freeze',
  RELEASE: 'release',
});

// A HOLDING camera action stays where it puts the stage until something
// releases it. Anything else returns to rest on its own. The player releases
// every hold when a style ends, so a style cannot leave the scene zoomed.
const HOLDING_CAMERA_ACTIONS = new Set([
  CAMERA_ACTION.ZOOM_IN,
  CAMERA_ACTION.ZOOM_OUT,
  CAMERA_ACTION.FREEZE,
]);

export const isHoldingCamera = (action) => HOLDING_CAMERA_ACTIONS.has(action);

// ---------------------------------------------------------------------------
// How the ground changes hands
// ---------------------------------------------------------------------------
//
// `reveal` used to take a `style` argument that was passed to a canvas which
// ignored it — every claim in the app's history wiped as a circle growing from
// the claim point, whether the style called itself radial or glitch. These are
// real now (see REVEAL_TRANSITIONS in TerritoryRevealCanvas), and WHICH one a
// style uses is part of its identity: a claim that freezes over from the edge
// is not the same event as one that shatters outward from a fist.
export const REVEAL_TRANSITION = Object.freeze({
  RADIAL: 'radial',
  SHOCKWAVE: 'shockwave',
  TILE_CONVERT: 'tile_convert',
  SPREAD_FROM_CENTER: 'spread_from_center',
  SPREAD_FROM_EDGE: 'spread_from_edge',
  CRACK_GLOW: 'crack_glow',
  PIXEL_REFORM: 'pixel_reform',
  TEAR_REVEAL: 'tear_reveal',
  FLIP_REVEAL: 'flip_reveal',
  ELECTRIFY: 'electrify',
  CRACK: 'crack',
  FREEZE_SPREAD: 'freezeSpread',
  BURN_SPREAD: 'burnSpread',
  PERIMETER_BURN: 'perimeterBurn',
  DISSOLVE: 'dissolve',
  IMPLODE: 'implode',
  BLOOM: 'bloom',
  LIGHT_SWEEP: 'lightSweep',
  CORRUPTION_SPREAD: 'corruptionSpread',
});

// The encounter is a style decision. Only DUEL asks CaptureEncounter to run
// its attacker/defender contact animation; every other mode is free to start a
// one-character, projectile, summoned-object or ground-only scene instead.
export const ENCOUNTER_MODE = Object.freeze({
  DUEL: 'duel',
  ATTACKER_ONLY: 'attacker_only',
  TERRITORY_ONLY: 'territory_only',
  SUMMON_ONLY: 'summon_only',
  PROJECTILE: 'projectile',
  TERRAIN_TRANSFORM: 'terrain_transform',
});

// Where a wipe starts from. Reuses the effect anchor vocabulary so a style can
// put the reveal's origin on the same point as the strike that caused it.
export const REVEAL_ORIGIN = Object.freeze({
  CLAIM_POINT: 'claimPoint',
  CHARACTER_FEET: 'characterFeet',
  TERRITORY_CENTER: 'territoryVisualCenter',
  TERRITORY_TOP: 'territoryTop',
  TERRITORY_BOTTOM: 'territoryBottom',
  PERIMETER: 'perimeter',
});

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------
//
// Every step carries `start`, in ms from the beginning of the style. Flat and
// absolute rather than nested and relative, because the whole point of a
// choreography is that tracks OVERLAP — the actor is still recoiling while the
// debris flies and the ground is already turning over.

/** The runner's character does something. */
export const actor = (start, name, options = {}) => ({
  track: 'actor', action: 'actor', name, start, ...options,
});

/** A sprite plays in one place. */
export const effect = (start, id, options = {}) => ({
  track: 'effect', effect: id, start,
  anchor: REVEAL_ORIGIN.TERRITORY_CENTER, size: 220, ...options,
});

/**
 * A sprite TRAVELS from one anchor to another.
 *
 * The single biggest omission in the old vocabulary. `at()` could put a bolt
 * at the top of the screen and another at the middle, but nothing ever crossed
 * the gap, so a strike from the sky was two unrelated flashes rather than one
 * object arriving. A projectile is what makes a throw a throw.
 */
export const projectile = (start, id, from, to, options = {}) => ({
  track: 'effect', action: 'projectile', effect: id, start,
  from, to, duration: 260, size: 150, spin: 0, arc: 0, ...options,
});

/** The scene moves. */
export const camera = (start, name, options = {}) => ({
  track: 'camera', action: 'camera', name, start, ...options,
});

/** The stage rattles. Kept separate from `camera` — a shake is not a move. */
export const shake = (start, options = {}) => ({
  track: 'camera', action: 'screenShake', start,
  intensity: 1, axis: 'x', ...options,
});

/**
 * The ground changes hands.
 *
 * Exactly one per style, and its POSITION in the sequence is a choice: before
 * the impact the land arrives and is then struck, after it the strike is what
 * put it there. `transition` and `origin` now reach the canvas.
 */
export const reveal = (start, options = {}) => ({
  track: 'territory', action: 'territoryReveal', start,
  transition: REVEAL_TRANSITION.RADIAL,
  origin: REVEAL_ORIGIN.CLAIM_POINT,
  ...options,
});

export const haptic = (start, style = 'medium') => ({
  track: 'feel', action: 'haptic', style, start,
});

/**
 * A beat where nothing happens.
 *
 * A no-op at runtime and load-bearing in the signature: the silence between a
 * charge finishing and a detonation starting is the difference between a bomb
 * and a bang, and a style that has one is not the same animation as a style
 * that does not.
 */
export const pause = (start, duration) => ({
  track: 'feel', action: 'pause', start, duration,
});

export const sound = (start, name) => ({ track: 'feel', action: 'sound', name, start });

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------
//
// The MOVEMENT, with no art in it. A style picks one and supplies paint.
//
// Each builder takes `paint` (effect ids, all optional — a missing one drops
// only its own step) and `tune` (a few beat lengths worth varying), and returns
// a flat sequence plus the duration the player should hold the stage for.
//
// Fifteen archetypes for fifteen styles, one-to-one. That is two deviations
// from the obvious reading of the brief, both deliberate: a portal that hands
// you the ground and a collapse that swallows it are opposite movements and
// cannot share a skeleton, so PORTAL_DELIVERY and IMPLOSION are separate; and
// "ground punch" and "ground stomp" are beats rather than skeletons, so they
// live inside JUMP_SLAM and PERIMETER_SWEEP.

const ms = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** Drop any step whose art the caller did not supply. */
const compact = (steps) => steps.filter((step) => {
  if (step.track !== 'effect') return true;
  return !!step.effect;
});

const build = (duration, steps) => ({ duration, sequence: compact(steps).sort((a, b) => a.start - b.start) });

export const ARCHETYPES = Object.freeze({
  /**
   * SKY_STRIKE — something is coming, and the runner knows it.
   * brace → sky charges → bolt TRAVELS down → strike → recoil → spread
   */
  skyStrike: (paint = {}, tune = {}) => {
    const brace = 0;
    const charge = ms(tune.charge, 260);
    const travel = ms(tune.travel, 220);
    const strike = charge + travel + 180;
    return build(strike + 900, [
      actor(brace, ACTOR_ACTION.BRACE, { lookAt: REVEAL_ORIGIN.TERRITORY_CENTER }),
      effect(charge, paint.charge, { anchor: 'screenTop', size: 240, speed: 1.3 }),
      camera(charge + 60, CAMERA_ACTION.WHIP_DOWN, { duration: 200 }),
      projectile(charge + 160, paint.bolt, 'screenTop', REVEAL_ORIGIN.TERRITORY_CENTER, {
        duration: travel, size: 170, speed: 1.6,
      }),
      effect(strike, paint.impact, { size: 300, speed: 1.15 }),
      haptic(strike, 'medium'),
      shake(strike + 20, { intensity: 1.1, axis: 'x' }),
      actor(strike + 30, ACTOR_ACTION.RECOIL),
      reveal(strike + 90, {
        transition: REVEAL_TRANSITION.SHOCKWAVE,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
      }),
      effect(strike + 260, paint.residue, { anchor: 'territoryBottom', size: 230, opacity: 0.9 }),
    ]);
  },

  /**
   * JUMP_SLAM — the heaviest thing in the pack, and the only one with hang time.
   * jump → HANG → fall → punch the ground → shockwave → cracks
   * The pause is the whole point: a slam with no hang is a hop.
   */
  jumpSlam: (paint = {}, tune = {}) => {
    const hang = ms(tune.hang, 240);
    const jump = actorActionSpec(ACTOR_ACTION.JUMP).duration;
    const land = jump + hang + 260;
    return build(land + 1000, [
      actor(0, ACTOR_ACTION.JUMP),
      camera(60, CAMERA_ACTION.WHIP_UP, { duration: 240 }),
      pause(jump, hang),
      camera(jump + hang - 80, CAMERA_ACTION.WHIP_DOWN, { duration: 200 }),
      actor(jump + hang, ACTOR_ACTION.SLAM),
      effect(land, paint.impact, { anchor: 'characterFeet', size: 300, speed: 1.25 }),
      haptic(land, 'medium'),
      shake(land + 10, { intensity: 1.4, axis: 'y' }),
      camera(land + 20, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
      reveal(land + 80, {
        transition: REVEAL_TRANSITION.CRACK,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
      }),
      effect(land + 240, paint.debris, { anchor: 'randomTerritoryPoint', size: 220, opacity: 0.85 }),
    ]);
  },

  /**
   * PROJECTILE_THROW — cause and effect separated by a flight and a silence.
   * step in → throw → charge ARCS to the ground → pause → detonation
   */
  projectileThrow: (paint = {}, tune = {}) => {
    const flight = ms(tune.flight, 380);
    const fuse = ms(tune.fuse, 260);
    // NO STEP FORWARD. There used to be one, thrown away 120ms in by a throw
    // that overlapped it — so it never actually played, and sequencing it
    // properly instead pushed the whole style past the 2.4s a celebration is
    // allowed to take. A throw already reads as planting and swinging; the
    // step was costing 380ms to show nothing.
    const throwAt = 0;
    const release = actorCommitAt(actor(throwAt, ACTOR_ACTION.THROW));
    const lands = release + flight;
    const braceAt = afterActor(lands + 40, throwAt, ACTOR_ACTION.THROW);
    // The fuse burns at least as long as the brace takes, so the blast never
    // lands on top of the runner still bracing for it.
    const blast = Math.max(lands + fuse, actorEndsAt(braceAt, ACTOR_ACTION.BRACE));
    return build(blast + 950, [
      actor(throwAt, ACTOR_ACTION.THROW, { toward: REVEAL_ORIGIN.TERRITORY_CENTER }),
      projectile(release, paint.charge, 'characterCenter', REVEAL_ORIGIN.TERRITORY_BOTTOM, {
        duration: flight, size: 130, arc: -90, spin: 320, speed: 1.2,
      }),
      effect(lands, paint.settle, { anchor: 'territoryBottom', size: 150, opacity: 0.8 }),
      pause(lands, fuse),
      actor(braceAt, ACTOR_ACTION.BRACE),
      effect(blast, paint.blast, { size: 320, speed: 1.1 }),
      haptic(blast, 'medium'),
      shake(blast + 10, { intensity: 1.25, axis: 'both' }),
      camera(blast + 20, CAMERA_ACTION.PUNCH_IN, { amount: 1.14 }),
      actor(blast + 40, ACTOR_ACTION.KNOCKBACK),
      reveal(blast + 180, {
        transition: REVEAL_TRANSITION.BURN_SPREAD,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
      }),
      effect(blast + 320, paint.smoke, { anchor: 'territoryTop', size: 240, speed: 1.2, opacity: 0.85 }),
    ]);
  },

  /**
   * CHANNEL_SPREAD — the runner is the SOURCE and holds it the whole way.
   * cast and hold → it starts at their feet → travels outward → ground freezes
   * No impact anywhere: a spread that banged would be a blast.
   */
  channelSpread: (paint = {}, tune = {}) => {
    const spread = ms(tune.spread, 900);
    const start = actorActionSpec(ACTOR_ACTION.CAST).anticipation;
    return build(start + spread + 800, [
      actor(0, ACTOR_ACTION.CAST, { hold: true }),
      effect(start, paint.source, { anchor: 'characterFeet', size: 200, speed: 1.2 }),
      haptic(start, 'light'),
      camera(start, CAMERA_ACTION.ZOOM_IN, { amount: 1.06, duration: 600 }),
      reveal(start + 90, {
        transition: REVEAL_TRANSITION.FREEZE_SPREAD,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
        duration: spread,
      }),
      effect(start + 260, paint.spread, { size: 300, speed: 0.9 }),
      effect(start + spread * 0.7, paint.crust, {
        anchor: 'randomTerritoryPoint', size: 220, speed: 1.4, opacity: 0.75,
      }),
      camera(start + spread, CAMERA_ACTION.RELEASE, { duration: 420 }),
      actor(start + spread + 40, ACTOR_ACTION.CELEBRATE),
    ]);
  },

  /**
   * PERIMETER_SWEEP — the border is the animation.
   * stomp → a spark runs the whole outline → the ring closes → the inside floods
   * The only archetype whose reveal starts at the EDGE and works inward.
   */
  perimeterSweep: (paint = {}, tune = {}) => {
    const lap = ms(tune.lap, 820);
    const stomp = actorCommitAt(actor(0, ACTOR_ACTION.STOMP));
    const closes = stomp + lap;
    return build(closes + 1000, [
      actor(0, ACTOR_ACTION.STOMP),
      effect(stomp, paint.spark, { anchor: 'characterFeet', size: 190, speed: 1.5 }),
      // The stomp is felt as a shake, not a tap. One haptic per style, saved
      // for the beat that IS the claim — see theme/haptics.js.
      shake(stomp + 20, { intensity: 0.6, axis: 'y' }),
      effect(stomp + 120, paint.ring, { size: 300, speed: 0.85, opacity: 0.9 }),
      reveal(stomp + 140, {
        transition: REVEAL_TRANSITION.PERIMETER_BURN,
        origin: REVEAL_ORIGIN.PERIMETER,
        duration: lap,
      }),
      pause(closes - 120, 120),
      effect(closes, paint.flood, { size: 300, speed: 1.1 }),
      haptic(closes, 'medium'),
      camera(closes + 20, CAMERA_ACTION.PUNCH_IN, { amount: 1.08 }),
      actor(closes + 40, ACTOR_ACTION.CELEBRATE),
    ]);
  },

  /**
   * IMPLOSION — everything goes IN, and there is a silence before it lands.
   * camera creeps in → the runner is dragged toward it → particles collapse
   * → nothing → implode
   */
  implosion: (paint = {}, tune = {}) => {
    const pull = ms(tune.pull, 700);
    const silence = ms(tune.silence, 320);
    const collapse = pull + silence;
    return build(collapse + 1000, [
      camera(0, CAMERA_ACTION.ZOOM_IN, { amount: 1.14, duration: pull }),
      effect(0, paint.well, { size: 290, speed: 0.8 }),
      actor(120, ACTOR_ACTION.PULLED, { toward: REVEAL_ORIGIN.TERRITORY_CENTER }),
      effect(240, paint.debris, { anchor: 'randomTerritoryPoint', size: 200, speed: 1.4, opacity: 0.8 }),
      camera(pull, CAMERA_ACTION.FREEZE, { duration: silence }),
      pause(pull, silence),
      effect(collapse, paint.collapse, { size: 200, speed: 1.3 }),
      haptic(collapse, 'medium'),
      camera(collapse + 20, CAMERA_ACTION.ZOOM_OUT, { amount: 0.94, duration: 160 }),
      camera(collapse + 200, CAMERA_ACTION.RELEASE, { duration: 320 }),
      reveal(collapse + 120, {
        transition: REVEAL_TRANSITION.IMPLODE,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
      }),
      actor(collapse + 160, ACTOR_ACTION.RECOIL),
    ]);
  },

  /**
   * PORTAL_DELIVERY — the ground is HANDED OVER rather than taken.
   * a door opens underneath → light comes through it → the land arrives
   * → the door folds away
   * Nothing shakes anywhere in this one, and the reveal is early.
   */
  portalDelivery: (paint = {}, tune = {}) => {
    const open = ms(tune.open, 420);
    const close = ms(tune.close, 520);
    // Step back first, then look. Looking 160ms into a 380ms step cancelled
    // the step, so the runner never actually gave ground to the portal.
    const lookAt = actorEndsAt(0, ACTOR_ACTION.STEP_FORWARD);
    return build(open + close + 900, [
      actor(0, ACTOR_ACTION.STEP_FORWARD, { away: true }),
      effect(0, paint.portal, { anchor: 'territoryBottom', size: 280, speed: 1.4 }),
      actor(lookAt, ACTOR_ACTION.LOOK, { lookAt: REVEAL_ORIGIN.TERRITORY_BOTTOM }),
      effect(open, paint.through, { size: 250, speed: 1.05 }),
      haptic(open, 'light'),
      reveal(open + 60, {
        transition: REVEAL_TRANSITION.LIGHT_SWEEP,
        origin: REVEAL_ORIGIN.TERRITORY_BOTTOM,
      }),
      camera(open + 120, CAMERA_ACTION.ZOOM_IN, { amount: 1.05, duration: 420 }),
      effect(open + close, paint.fold, { anchor: 'territoryBottom', size: 240 }),
      camera(open + close, CAMERA_ACTION.RELEASE, { duration: 380 }),
      actor(open + close + 60, ACTOR_ACTION.CELEBRATE),
    ]);
  },

  /**
   * BEAM_DOWN — earned, not won. Arrives on the runner and opens out.
   * raise → beam lands ON them → rings push out → the ground lights up
   */
  beamDown: (paint = {}, tune = {}) => {
    const arrive = ms(tune.arrive, 340);
    return build(arrive + 1400, [
      actor(0, ACTOR_ACTION.CAST, { raise: true }),
      projectile(120, paint.beam, 'screenTop', 'characterHead', {
        duration: arrive - 120, size: 150, speed: 1.5,
      }),
      effect(arrive, paint.land, { anchor: 'characterFeet', size: 250 }),
      haptic(arrive, 'success'),
      camera(arrive + 20, CAMERA_ACTION.ZOOM_IN, { amount: 1.07, duration: 500 }),
      reveal(arrive + 80, {
        transition: REVEAL_TRANSITION.RADIAL,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
        duration: 900,
      }),
      effect(arrive + 200, paint.rings, { size: 300, speed: 1.3 }),
      effect(arrive + 520, paint.halo, { anchor: 'characterHead', size: 210, opacity: 0.75 }),
      camera(arrive + 700, CAMERA_ACTION.RELEASE, { duration: 400 }),
      actor(arrive + 760, ACTOR_ACTION.CELEBRATE),
    ]);
  },

  /**
   * MAGIC_CAST — three places in order, and the sheets TRAVEL between them.
   * cast left → cast right → glyphs land apart → they connect → the rune fires
   */
  magicCast: (paint = {}, tune = {}) => {
    const beat = ms(tune.beat, 320);
    // TWO CASTS AND A CHARGE, back to back — the beat only controls how much
    // air sits between them. Each has to finish before the next begins: at a
    // 320ms beat the second cast used to start 320ms into the first's 620ms,
    // so the left glyph was thrown by a gesture that never played, and the
    // charge cancelled the right one in turn.
    //
    // They are also SHORTENED here rather than left at their natural lengths.
    // Three full-length body actions back to back is 2000ms of casting before
    // the rune even fires, which made this the one style that outran the whole
    // sequence's budget. These are flicks of the wrist, not full casts, so they
    // are written as such — the anticipation ratio scales with the duration, so
    // they still read as wind-up-then-release.
    const FLICK = 380;
    const GATHER = 520;
    const castLeft = 0;
    const castRight = afterActor(beat, castLeft, ACTOR_ACTION.CAST, { duration: FLICK });
    const chargeAt = afterActor(castRight + beat, castRight, ACTOR_ACTION.CAST, { duration: FLICK });
    const connect = actorEndsAt(chargeAt, ACTOR_ACTION.CHARGE, { duration: GATHER });
    return build(connect + 1100, [
      actor(castLeft, ACTOR_ACTION.CAST, { side: 'left', duration: FLICK }),
      effect(actorCommitAt(actor(castLeft, ACTOR_ACTION.CAST, { duration: FLICK })), paint.glyph, {
        anchor: 'territoryTop', size: 200, speed: 1.3,
      }),
      actor(castRight, ACTOR_ACTION.CAST, { side: 'right', duration: FLICK }),
      effect(actorCommitAt(actor(castRight, ACTOR_ACTION.CAST, { duration: FLICK })), paint.glyph, {
        anchor: 'territoryBottom', size: 200, speed: 1.3,
      }),
      actor(chargeAt, ACTOR_ACTION.CHARGE, { duration: GATHER }),
      projectile(chargeAt + 180, paint.link, REVEAL_ORIGIN.TERRITORY_TOP, REVEAL_ORIGIN.TERRITORY_BOTTOM, {
        duration: beat * 0.7, size: 160, speed: 1.5,
      }),
      effect(connect, paint.rune, { size: 260, speed: 1.2 }),
      haptic(connect, 'medium'),
      shake(connect + 20, { intensity: 0.7, axis: 'both' }),
      actor(connect + 40, ACTOR_ACTION.RECOIL),
      reveal(connect + 120, {
        transition: REVEAL_TRANSITION.DISSOLVE,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
      }),
    ]);
  },

  /**
   * WITNESS_GROWTH — the runner does almost nothing, and that is the choice.
   * a seed lands → they watch → it grows across the whole claim on its own
   * The one archetype where the actor is not the cause.
   */
  witnessGrowth: (paint = {}, tune = {}) => {
    const land = ms(tune.land, 300);
    const grow = ms(tune.grow, 1100);
    return build(land + grow + 700, [
      projectile(0, paint.seed, 'screenTop', REVEAL_ORIGIN.TERRITORY_CENTER, {
        duration: land, size: 120, speed: 1.2,
      }),
      actor(land - 160, ACTOR_ACTION.LOOK, { lookAt: REVEAL_ORIGIN.TERRITORY_CENTER }),
      effect(land, paint.sprout, { size: 200, speed: 1.1 }),
      reveal(land + 60, {
        transition: REVEAL_TRANSITION.BLOOM,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
        duration: grow,
      }),
      effect(land + grow * 0.35, paint.grow, { size: 300, speed: 0.85 }),
      camera(land + grow * 0.4, CAMERA_ACTION.ZOOM_OUT, { amount: 0.95, duration: 600 }),
      effect(land + grow * 0.8, paint.settle, { anchor: 'randomTerritoryPoint', size: 220, opacity: 0.75 }),
      camera(land + grow, CAMERA_ACTION.RELEASE, { duration: 420 }),
      haptic(land + grow, 'success'),
    ]);
  },

  /**
   * CHARGE_RELEASE — a long wind-up and a short violent release.
   * charge between the hands → the orb grows → THRUST it down → nova
   */
  chargeRelease: (paint = {}, tune = {}) => {
    const wind = ms(tune.wind, actorActionSpec(ACTOR_ACTION.CHARGE).duration);
    // The charge has to finish before the slam starts, and the slam before the
    // recoil: the wind-up is tunable, so a style asking for a long charge would
    // otherwise have its slam begin partway through it.
    const slamAt = afterActor(wind, 0, ACTOR_ACTION.CHARGE);
    const thrust = slamAt + 140;
    const recoilAt = afterActor(thrust + 140, slamAt, ACTOR_ACTION.SLAM);
    return build(recoilAt + 960, [
      actor(0, ACTOR_ACTION.CHARGE),
      effect(80, paint.gather, { anchor: 'characterCenter', size: 180, speed: 0.9 }),
      camera(120, CAMERA_ACTION.ZOOM_IN, { amount: 1.1, duration: wind }),
      effect(wind * 0.55, paint.orb, { anchor: 'characterCenter', size: 230, speed: 0.8 }),
      pause(wind, 140),
      actor(slamAt, ACTOR_ACTION.SLAM, { toward: REVEAL_ORIGIN.TERRITORY_CENTER }),
      effect(thrust, paint.nova, { size: 320, speed: 1.35 }),
      haptic(thrust, 'medium'),
      shake(thrust + 10, { intensity: 1.2, axis: 'both' }),
      camera(thrust + 20, CAMERA_ACTION.RELEASE, { duration: 260 }),
      reveal(thrust + 100, {
        transition: REVEAL_TRANSITION.SHOCKWAVE,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
      }),
      actor(recoilAt, ACTOR_ACTION.RECOIL),
      effect(thrust + 300, paint.wake, { anchor: 'territoryTop', size: 230, opacity: 0.8 }),
    ]);
  },

  /**
   * FALLING_OBJECTS — one thing forms overhead, breaks, and rains down.
   * form → crack → three fragments fall on different points → the big one lands
   */
  fallingObjects: (paint = {}, tune = {}) => {
    const form = ms(tune.form, 420);
    const stagger = ms(tune.stagger, 140);
    const finale = form + stagger * 3 + 240;
    return build(finale + 1000, [
      actor(0, ACTOR_ACTION.LOOK, { lookAt: 'screenTop' }),
      effect(0, paint.form, { anchor: 'screenTop', size: 260, speed: 1.1 }),
      effect(form, paint.crack, { anchor: 'screenTop', size: 220, speed: 1.4 }),
      actor(form, ACTOR_ACTION.BRACE),
      projectile(form + stagger, paint.shard, 'screenTop', REVEAL_ORIGIN.TERRITORY_TOP, {
        duration: 220, size: 120, spin: 220,
      }),
      projectile(form + stagger * 2, paint.shard, 'screenTop', 'randomTerritoryPoint', {
        duration: 240, size: 110, spin: -260,
      }),
      projectile(form + stagger * 3, paint.shard, 'screenTop', REVEAL_ORIGIN.TERRITORY_BOTTOM, {
        duration: 200, size: 130, spin: 180,
      }),
      shake(form + stagger + 220, { intensity: 0.5, axis: 'y' }),
      camera(finale - 200, CAMERA_ACTION.WHIP_DOWN, { duration: 180 }),
      effect(finale, paint.strike, { size: 310, speed: 1.2 }),
      haptic(finale, 'heavy'),
      shake(finale + 10, { intensity: 1.3, axis: 'x' }),
      reveal(finale + 90, {
        transition: REVEAL_TRANSITION.CRACK,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
      }),
      actor(finale + 40, ACTOR_ACTION.KNOCKBACK),
    ]);
  },

  /**
   * RAIN_BARRAGE — no single impact at all. It gets heavier, then it has won.
   * throw the cloud up → sparse drops → dense drops → the ground gives way
   */
  rainBarrage: (paint = {}, tune = {}) => {
    const drops = Math.max(3, ms(tune.drops, 5));
    const spacing = ms(tune.spacing, 130);
    const open = actorCommitAt(actor(0, ACTOR_ACTION.THROW));
    const last = open + 200 + spacing * drops;
    const rain = [];
    for (let i = 0; i < drops; i += 1) {
      // Accelerating, not metronomic: the gaps shrink so the barrage builds.
      const at = open + 200 + spacing * i * (1 - i / (drops * 2.4));
      rain.push(projectile(Math.round(at), paint.drop, 'screenTop', 'randomTerritoryPoint', {
        duration: 200 + i * 12, size: 90 + i * 8, opacity: 0.85,
      }));
    }
    return build(last + 1000, [
      actor(0, ACTOR_ACTION.THROW, { upward: true }),
      effect(open, paint.cloud, { anchor: 'screenTop', size: 280, speed: 1.1, opacity: 0.9 }),
      ...rain,
      camera(open + 400, CAMERA_ACTION.TILT, { amount: 1.5, duration: 400 }),
      actor(open + 300, ACTOR_ACTION.BRACE),
      reveal(last - 320, {
        transition: REVEAL_TRANSITION.DISSOLVE,
        origin: REVEAL_ORIGIN.TERRITORY_CENTER,
        duration: 900,
      }),
      effect(last, paint.pool, { anchor: 'randomTerritoryPoint', size: 250, speed: 1.5, opacity: 0.8 }),
      haptic(last, 'success'),
    ]);
  },

  /**
   * PLANT_GROWTH — planted deliberately, then it runs away from the runner.
   * plant → sprout → vines race outward → flowers pop in sequence → full bloom
   */
  plantGrowth: (paint = {}, tune = {}) => {
    const plant = actorCommitAt(actor(0, ACTOR_ACTION.PLANT));
    const run = ms(tune.run, 900);
    const pops = [0.45, 0.62, 0.8].map((fraction, i) =>
      effect(Math.round(plant + run * fraction), paint.pop, {
        anchor: 'randomTerritoryPoint', size: 170 + i * 20, speed: 1.3, opacity: 0.85,
      })
    );
    return build(plant + run + 900, [
      actor(0, ACTOR_ACTION.PLANT),
      effect(plant, paint.sprout, { anchor: 'characterFeet', size: 190 }),
      reveal(plant + 80, {
        transition: REVEAL_TRANSITION.BLOOM,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
        duration: run,
      }),
      effect(plant + 160, paint.vines, { size: 280, speed: 0.95 }),
      ...pops,
      camera(plant + run, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
      effect(plant + run, paint.bloom, { size: 300, speed: 1.15 }),
      haptic(plant + run, 'success'),
      actor(plant + run + 40, ACTOR_ACTION.CELEBRATE),
    ]);
  },

  /**
   * CORRUPTION — the only one where the runner is not in control.
   * it starts off-screen → the actor glitches with it → it snaps into place
   */
  corruption: (paint = {}, tune = {}) => {
    const creep = ms(tune.creep, 620);
    const snap = creep + 380;
    return build(snap + 900, [
      effect(0, paint.corrupt, { anchor: 'screenBottom', size: 300, speed: 1.7, optional: true }),
      actor(140, ACTOR_ACTION.LOOK, { lookAt: 'screenBottom' }),
      camera(200, CAMERA_ACTION.TILT, { amount: 2.4, duration: 300 }),
      reveal(creep - 200, {
        transition: REVEAL_TRANSITION.CORRUPTION_SPREAD,
        origin: REVEAL_ORIGIN.TERRITORY_BOTTOM,
        duration: 700,
      }),
      effect(creep, paint.spread, { size: 250, speed: 1.5 }),
      actor(creep, ACTOR_ACTION.RECOIL, { jitter: true }),
      shake(creep + 60, { intensity: 0.6, axis: 'both' }),
      effect(snap, paint.snap, { size: 270, speed: 1.35 }),
      haptic(snap, 'medium'),
      shake(snap + 10, { intensity: 1.1, axis: 'x' }),
      camera(snap + 20, CAMERA_ACTION.PUNCH_IN, { amount: 1.1 }),
    ]);
  },
});

export const ARCHETYPE_IDS = Object.freeze(Object.keys(ARCHETYPES));

// ---------------------------------------------------------------------------
// The uniqueness check
// ---------------------------------------------------------------------------

/**
 * A style's CHOREOGRAPHY, with the art taken out of it.
 *
 * The old `captureStyleShape` compared anchors and stage cues, which was the
 * right idea against the wrong vocabulary: every style was a stack of sheets,
 * so anchors were all there was to tell them apart. Two styles that both
 * explode in the middle, rattle and wipe radially were "different" because one
 * of them put its third sheet at the bottom.
 *
 * This compares the things a viewer actually reads: what the character did,
 * what the scene did, which art TRAVELLED and along what path, how the ground
 * turned over and from where, and where the silences were. Effect ids, sizes,
 * opacities and exact timings are all invisible to it on purpose — fire and
 * ice over the same movement is one animation painted twice.
 */
export function choreographySignature(style) {
  const steps = [...(style?.sequence || [])].sort((a, b) => a.start - b.start);
  return steps
    .map((step) => {
      if (step.action === 'actor') return `actor:${step.name}`;
      if (step.action === 'camera') return `cam:${step.name}`;
      if (step.action === 'screenShake') return `shake:${step.axis || 'x'}`;
      if (step.action === 'projectile') return `fly:${step.from}>${step.to}`;
      if (step.action === 'territoryReveal') return `ground:${step.transition}@${step.origin}`;
      if (step.action === 'pause') return 'pause';
      if (step.action === 'haptic') return null; // felt, not seen
      if (step.action === 'sound') return null;
      return `fx@${step.anchor || REVEAL_ORIGIN.TERRITORY_CENTER}`;
    })
    .filter(Boolean)
    .join(' > ');
}

/**
 * The coarse version: what KIND of animation this is, ignoring order within a
 * track. Two styles may legitimately share this (a slam and a stomp are both
 * ground-impact animations); no two should share the full signature.
 */
export function choreographyProfile(style) {
  const steps = style?.sequence || [];
  const actors = steps.filter((s) => s.action === 'actor').map((s) => s.name);
  const cameras = steps.filter((s) => s.action === 'camera').map((s) => s.name);
  const flights = steps.filter((s) => s.action === 'projectile').length;
  const ground = steps.find((s) => s.action === 'territoryReveal');
  const impact = steps.find((s) => s.action === 'haptic');
  return {
    actors,
    cameras,
    flights,
    pauses: steps.filter((s) => s.action === 'pause').length,
    transition: ground?.transition || null,
    origin: ground?.origin || null,
    // Whether the land arrives and is then struck, or the strike is what put
    // it there. Still the biggest single difference between two celebrations.
    revealsBeforeImpact: !!ground && !!impact && ground.start < impact.start,
  };
}

const KNOWN_ACTIONS = new Set([
  'actor', 'camera', 'screenShake', 'projectile', 'territoryReveal',
  'haptic', 'pause', 'sound', 'character',
]);

/**
 * What a style must satisfy to be playable. Run over the whole pack by the
 * tests, so a hand-written style cannot ship half-wired.
 */
export function validateChoreography(style) {
  const errors = [];
  const steps = style?.sequence;
  if (!Array.isArray(steps)) return ['missing sequence'];
  if (!(style.duration > 0)) errors.push('duration must be positive');
  if (!Object.values(ENCOUNTER_MODE).includes(style.encounterMode)) {
    errors.push(`unknown encounter mode ${style.encounterMode}`);
  }
  if (typeof style.showAttacker !== 'boolean') errors.push('showAttacker metadata is required');
  if (typeof style.showDefender !== 'boolean') errors.push('showDefender metadata is required');
  if (typeof style.usesProjectile !== 'boolean') errors.push('usesProjectile metadata is required');

  const reveals = steps.filter((s) => s.action === 'territoryReveal');
  if (reveals.length !== 1) errors.push('exactly one territory reveal is required');
  reveals.forEach((step) => {
    if (!Object.values(REVEAL_TRANSITION).includes(step.transition)) {
      errors.push(`unknown reveal transition ${step.transition}`);
    }
  });
  if (reveals[0] && style.territoryTransition !== reveals[0].transition) {
    errors.push('territoryTransition metadata does not match the reveal');
  }
  if (reveals[0] && style.revealOrigin !== reveals[0].origin) {
    errors.push('revealOrigin metadata does not match the reveal');
  }
  if (style.usesProjectile !== steps.some((s) => s.action === 'projectile')) {
    errors.push('usesProjectile metadata does not match the sequence');
  }

  // Exactly one, not "at least one". Haptics in this app are deliberately
  // restrained (see theme/haptics.js) and a claim already spends its budget:
  // a style that buzzed at its wind-up AND its impact would be twice the feel
  // of every other beat in the app. Secondary beats get a shake instead.
  if (steps.filter((s) => s.action === 'haptic').length !== 1) {
    errors.push('exactly one primary haptic is required');
  }

  steps.forEach((step, index) => {
    if (!Number.isFinite(step.start) || step.start < 0) errors.push(`step ${index} has an invalid start`);
    if (step.action && !KNOWN_ACTIONS.has(step.action)) errors.push(`step ${index} has unknown action ${step.action}`);
    if (step.action === 'actor' && !ACTOR_SPECS[step.name]) errors.push(`step ${index} has unknown actor action ${step.name}`);
    if (step.action === 'camera' && !Object.values(CAMERA_ACTION).includes(step.name)) {
      errors.push(`step ${index} has unknown camera action ${step.name}`);
    }
    if (step.start > style.duration) errors.push(`step ${index} starts after the style ends`);
  });

  // One actor, one body: two actions overlapping means the second silently
  // cancels the first's transform chain, and the beat the style was written
  // for never plays.
  const actorSteps = steps
    .filter((s) => s.action === 'actor')
    .sort((a, b) => a.start - b.start);
  actorSteps.forEach((step, i) => {
    const next = actorSteps[i + 1];
    if (!next) return;
    const spec = actorActionSpec(step.name);
    const ends = step.start + (step.duration || spec.duration);
    // `hold` actions are explicitly written to be interrupted by the next beat.
    if (!step.hold && next.start < ends - 1) {
      errors.push(`actor steps overlap: ${step.name} still running when ${next.name} starts`);
    }
  });

  // A camera hold that is never released would leave the scene zoomed when the
  // victory beat takes over.
  const holds = steps.filter((s) => s.action === 'camera' && isHoldingCamera(s.name));
  const releases = steps.filter((s) => s.action === 'camera' && s.name === CAMERA_ACTION.RELEASE);
  if (holds.length && !releases.length) {
    // FREEZE resolves itself after `duration`; a zoom does not.
    const zooms = holds.filter((s) => s.name !== CAMERA_ACTION.FREEZE);
    if (zooms.length) errors.push('a held camera move is never released');
  }

  return errors;
}
