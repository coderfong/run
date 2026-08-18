// Capture styles are short, directed cutscenes. Each one tells ONE story.
//
// -------------------------------------------------------------------------
// WHY THIS FILE LOOKS DIFFERENT NOW
// -------------------------------------------------------------------------
//
// The previous version was a flat list of steps per style, and the freedom that
// gave was the problem. A style could — and most of them did — schedule six
// unrelated sprites, half of them at `randomTerritoryPoint`, several of them
// still playing three beats later, with the last one fired over the top of the
// territory reveal. Every rule was followed and the result was unreadable:
// random particles, characters moving, more particles, a flash, an explosion,
// more particles, and somewhere in there the ground had changed colour.
//
// A style is now written as the five beats a viewer actually reads, and the
// spine that carries them is generated rather than retyped thirty-eight times:
//
//     SETUP      the runner commits, the world warns, the rivals notice
//     ACTION     one thing is released and travels. One thing to follow.
//     IMPACT     one moment. Everything that sells it lands on the same frame.
//     TERRITORY  the ground turns over, from the point the impact landed on
//     REACTION   the rivals are displaced and leave
//     CLEANUP    the aftermath clears and the runner takes the ground
//
// What an author writes is the ONE IDEA: what the runner does, what the world
// does, what travels, what the hit looks like, and how the ground converts.
// Everything else — walking on, celebrating, the victory marker, releasing the
// camera, the rivals noticing and leaving — is the spine, and `scene()` builds
// it. That is not convenience: a spine that is written once cannot drift, and
// thirty-eight hand-typed copies of it did.
//
// -------------------------------------------------------------------------
// THE RULES, AND WHERE THEY ARE ENFORCED
// -------------------------------------------------------------------------
//
//   * One hero sprite on screen at a time, plus at most one thing it caused.
//     `EFFECT_SLOT` in choreography.js; overlap inside a slot is a failing test.
//   * Every sprite declares the window it may occupy (`hold`). The player
//     derives playback speed from it and removes the art at the end of it, so a
//     beat physically cannot bleed into the next. This replaced authored
//     `speed` numbers that were guesses: several were below 1 on sheets already
//     2-3 seconds long, producing single effects that ran for five seconds.
//   * Every sprite is anchored to something that happened. `randomTerritoryPoint`
//     is no longer a legal effect anchor, which removed one decorative sprite
//     from each of eighteen styles — all of them fired after the impact, none
//     of them caused by anything.
//   * Nothing is fired after the ground has finished turning over. The takeover
//     is the payoff and it gets the screen to itself.
//   * The ingredients of a hit land within 60ms of each other or they are two
//     events, not one.
//
// -------------------------------------------------------------------------
// FAMILIES
// -------------------------------------------------------------------------
//
// Not every capture is a person hitting a person. `CHOREOGRAPHY_FAMILY` names
// what KIND of event takes the ground, and it is the first thing to decide:
//
//     PROJECTILE   attacker → something travels → it lands on them
//     TERRITORY    something happens to the zone itself
//     SUMMON       the runner calls something in and it does the work
//     TAKEOVER     the ground itself converts and crowds them off
//     DUEL         the two characters actually touch. Two styles. That is all.
//
// Only a DUEL may emit `contact` — validation rejects it anywhere else — which
// is what stops every environmental style opening with a shoulder-check.

import {
  ACTION,
  BEAT,
  CAMERA_ACTION,
  DRAMA_SCALE,
  EFFECT_SLOT,
  ENCOUNTER_MODE,
  ENVIRONMENT,
  REVEAL_ORIGIN,
  REVEAL_TRANSITION,
  VECTOR_ENVIRONMENT_KINDS,
  actorEndsAt,
  attacker,
  camera,
  choreographyProfile,
  choreographySignature,
  contact,
  defenders,
  effect,
  environment,
  haptic,
  pause,
  projectile,
  reveal,
  scaleSequence,
  scatter,
  shake,
  sound,
  support,
  victory,
} from './choreography';

const S = REVEAL_ORIGIN;
const T = REVEAL_TRANSITION;
const M = ENCOUNTER_MODE;
const E = ENVIRONMENT;

export const CHOREOGRAPHY_FAMILY = Object.freeze({
  PROJECTILE: 'projectile',
  TERRITORY: 'territory',
  SUMMON: 'summon',
  TAKEOVER: 'takeover',
  DUEL: 'duel',
});

const F = CHOREOGRAPHY_FAMILY;

// ---------------------------------------------------------------------------
// The spine
// ---------------------------------------------------------------------------
//
// These timestamps are the shape in the DRAMA_SCALE note in claim/timing.js,
// written down once. Individual scenes shift `impact.at` and `territory.at`
// where their idea needs it; nothing else moves, because the whole point of a
// shared spine is that a viewer learns to read it after two captures.
//
// Load-bearing against the one-body-per-character rule, which validation checks
// by expanding every style at cast sizes 0 to 3:
//
//   attacker  open (≤760) → strike/brace (950) → walk (2000, 440) → win (2440)
//   defender  notice (380, +70 stagger, 320) ends ≤840
//             displaced (1270, 480) ends 1750
//             exit (1820, +60 stagger, 560) ends ≤2500
const SPINE = Object.freeze({
  OPEN: 0,
  WARN: 200,
  NOTICE: 380,
  RELEASE: 560,
  IMPACT: 1150,
  DISPLACE: 1270,
  CONVERT: 1300,
  SETTLE: 1720,
  EXIT: 1820,
  WALK: 2000,
  WIN: 2440,
  END: 2640,
});

// The framing push. A capture used to play out at map scale with characters
// under a hundred points tall in the middle of an empty card; this holds the
// stage 14% in for the whole performance so the runner, the rival and the one
// hero effect fill the middle of the screen, and hands it back at the settle.
const FRAME_SCALE = 1.14;

const NOTICE_DURATION = 320;
const NOTICE_STAGGER = 70;
const DISPLACE_DURATION = 480;
const EXIT_DURATION = 560;
const EXIT_STAGGER = 60;

// Reaction pools. The point of a pool is that one event produces several
// different human responses; a style reusing a pool is reusing that idea.
const NOTICE_POOL = [ACTION.NOTICE, ACTION.SURPRISED, ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT];
const FLIGHT_POOL = [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.FLEE_FROM];

/**
 * One beat addressed to every rival, uniform or varied.
 *
 * A POOL when the event could come from anywhere and several human responses
 * are equally honest. A SINGLE action when there is one right answer: everybody
 * looking up at the same meteor reads instantly, and one rival glancing left
 * while a rock falls on them is worse choreography rather than more variety.
 * The variety belongs in how they LEAVE, where the pool is always used.
 */
const group = (start, action, options = {}) => (
  Array.isArray(action)
    ? scatter(start, action, options)
    // Still staggered: heads turning one after another is how a group notices
    // something. Uniform means they all do the SAME thing, not at the same
    // instant.
    : defenders(start, action, options)
);

// Short aliases, because a scene body should read as choreography rather than
// as function calls.
const fx = effect;
const sup = support;
const fly = projectile;
const env = environment;
const cam = camera;

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/** Which of the five beats a step at this time is serving. */
function beatAt(start, impactAt, convertAt) {
  if (start < SPINE.RELEASE) return BEAT.SETUP;
  if (start < impactAt) return BEAT.ACTION;
  if (start < convertAt) return BEAT.IMPACT;
  if (start < SPINE.EXIT) return BEAT.TERRITORY;
  if (start < SPINE.WALK) return BEAT.REACTION;
  return BEAT.CLEANUP;
}

/**
 * One hit, assembled so its ingredients cannot drift apart.
 *
 * The old pack got this mostly right by hand and then undermined it by leaving
 * two-second sprites from earlier beats playing over the top, so the loudest
 * frame in the scene was sharing it with leftovers. With bounded holds the
 * stage is genuinely empty when this lands.
 *
 * Nothing here is mandatory except the haptic — a style whose event is a stain
 * spreading or a light going out should not detonate, and `impact` for those is
 * a single quiet line.
 */
function impactSteps(impact, defaultAnchor) {
  const at = impact.at ?? SPINE.IMPACT;
  const anchor = impact.anchor || defaultAnchor;
  const steps = [];

  // The hit pause, a hair before the frame it is holding for. Stops everything
  // mid-motion so the punch that follows reads as a blow rather than a drift.
  if (impact.freeze) {
    steps.push(cam(at - 40, CAMERA_ACTION.FREEZE, { duration: impact.freeze }));
    steps.push(pause(at - 40, impact.freeze));
  }
  if (impact.sprite) {
    steps.push(fx(at, impact.sprite, {
      anchor,
      size: impact.size || 300,
      hold: impact.hold || 520,
      slot: EFFECT_SLOT.HERO,
    }));
  }
  if (impact.flash) {
    steps.push(env(at, E.FLASH, {
      duration: impact.flash.duration || 240,
      opacity: impact.flash.opacity ?? 0.6,
      color: impact.flash.color,
    }));
  }
  steps.push(haptic(at, impact.haptic || 'heavy'));
  if (impact.shake) {
    steps.push(shake(at, { intensity: impact.shake.intensity || 1.2, axis: impact.shake.axis || 'y' }));
  }
  if (impact.punch) steps.push(cam(at + 20, CAMERA_ACTION.PUNCH_IN, { amount: impact.punch }));
  if (impact.debris) {
    // The one legal second sprite: something the hit threw, at a named place,
    // inside the impact's own window. Not a decoration — a consequence.
    steps.push(sup(at + (impact.debris.delay ?? 140), impact.debris.sprite, {
      anchor: impact.debris.anchor || anchor,
      size: impact.debris.size || 150,
      hold: impact.debris.hold || 320,
      opacity: impact.debris.opacity,
    }));
  }
  return steps;
}

/**
 * A whole scene from its idea.
 *
 * Every literal below is authored at the real target pace — DRAMA_SCALE is 1.0
 * and the styles are written against the shape directly — but the scaling pass
 * stays wired so the entire pack can still be retuned from one constant if the
 * whole thing ever needs to breathe differently again.
 */
function scene({
  id,
  name,
  family,
  mode,
  concept,
  beats,
  // The runner. `open` is their first move; `strike` is an optional action
  // timed so it COMMITS on the impact frame rather than starting there — a
  // slam whose wind-up begins at the bang looks like the explosion moved the
  // character rather than the other way round.
  attacker: attackerSpec,
  // The style's own idea: the world primitives, the travelling art, the camera.
  // Free-form, and the only part that differs between two scenes in the same
  // family.
  world = [],
  impact,
  territory,
  // What the rivals do. `notice` before anything lands, `displace` when it
  // does, `exit` on their own feet afterwards.
  defenders: defenderSpec = {},
  // A duel, and only a duel, may add a collision here.
  duel = null,
  archetype,
}) {
  const impactAt = impact.at ?? SPINE.IMPACT;
  const convertAt = territory.at ?? SPINE.CONVERT;
  const impactAnchor = impact.anchor || S.TERRITORY_CENTER;

  const spine = [
    // --- SETUP: the runner starts it, and the stage pushes in ---------------
    attacker(SPINE.OPEN, attackerSpec.open, attackerSpec.openOptions || {}),
    cam(SPINE.WARN, CAMERA_ACTION.ZOOM_IN, { amount: FRAME_SCALE, duration: 520 }),

    // --- SETUP: the rivals see it coming ------------------------------------
    //
    // A POOL when the event could come from anywhere and several human
    // responses are honest; a SINGLE action when there is one right answer.
    // Everybody looking up at the same meteor is the clearer read, and one
    // rival glancing left while a rock falls on them is worse choreography, not
    // more variety. The variety belongs in how they leave.
    group(defenderSpec.noticeAt ?? SPINE.NOTICE, defenderSpec.notice || NOTICE_POOL, {
      stagger: NOTICE_STAGGER,
      duration: NOTICE_DURATION,
      from: defenderSpec.noticeFrom || impactAnchor,
    }),

    // --- IMPACT -------------------------------------------------------------
    ...impactSteps(impact, impactAnchor),

    // --- TERRITORY: caused by the impact, from where the impact landed ------
    reveal(convertAt, {
      transition: territory.transition,
      origin: territory.origin || impactAnchor,
      duration: territory.duration || 720,
    }),

    // --- REACTION -----------------------------------------------------------
    ...(defenderSpec.displace === null ? [] : [
      defenders(SPINE.DISPLACE, defenderSpec.displace || ACTION.SHOCKWAVE_KNOCKBACK, {
        duration: DISPLACE_DURATION,
        ...(defenderSpec.displaceToward
          ? { toward: defenderSpec.displaceToward }
          : { from: defenderSpec.displaceFrom || impactAnchor }),
      }),
    ]),
    scatter(SPINE.EXIT, defenderSpec.exit || FLIGHT_POOL, {
      stagger: EXIT_STAGGER,
      duration: EXIT_DURATION,
      ...(defenderSpec.exitToward
        ? { toward: defenderSpec.exitToward }
        : { from: defenderSpec.exitFrom || impactAnchor }),
    }),

    // --- CLEANUP: the stage settles and the runner takes the ground ---------
    cam(SPINE.SETTLE, CAMERA_ACTION.RELEASE, { duration: 420 }),
    attacker(SPINE.WALK, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER, duration: 440 }),
    attacker(SPINE.WIN, ACTION.CELEBRATE, { duration: 400 }),
    victory(SPINE.WIN),
    sound(SPINE.WIN, 'claim'),
  ];

  // The runner's own commitment to the hit.
  //
  // Either an action that COMMITS on the impact frame — timed off its own
  // wind-up, because a slam whose anticipation begins at the bang looks like the
  // explosion moved the character rather than the other way round — or a brace,
  // when the event is not theirs to swing.
  if (attackerSpec.strike) {
    const strikeAt = attackerSpec.strikeAt
      ?? Math.max(760, impactAt - (attackerSpec.strikeLead ?? 300));
    const strikeOptions = attackerSpec.strikeOptions || {};
    spine.push(attacker(strikeAt, attackerSpec.strike, strikeOptions));
    // ...and the follow-through. A swing with no recoil is half a movement: the
    // body stops dead on the frame of impact and then teleports into a walk.
    // Only strikes get one — a brace settles out of its own accord.
    spine.push(attacker(
      actorEndsAt(strikeAt, attackerSpec.strike, strikeOptions),
      ACTION.RECOIL
    ));
  } else {
    spine.push(attacker(impactAt - 200, ACTION.BRACE, { duration: 500 }));
  }

  if (duel) spine.push(contact(duel.at, { variant: duel.variant, target: duel.target || 'nearest' }));

  const authored = [...spine, ...world]
    .filter(Boolean)
    .map((step) => ({ beat: beatAt(step.start, impactAt, convertAt), ...step }));

  const ordered = [...scaleSequence(authored)].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // Ties resolve by beat so the compiled list reads in narrative order, which
    // is what the beat-order rule in validateChoreography checks.
    return BEAT_RANK[a.beat] - BEAT_RANK[b.beat];
  });

  const ground = ordered.find((step) => step.action === 'territoryReveal');
  const usesVectorEnvironment = ordered.some(
    (step) => step.action === 'environment' && VECTOR_ENVIRONMENT_KINDS.has(step.kind)
  );

  return Object.freeze({
    id,
    name,
    family,
    archetype: archetype || `${family}:${id}`,
    // One sentence naming the single visual idea. If this needs an "and", the
    // style is doing two things and one of them should go.
    concept,
    description: concept,
    beats: Object.freeze(beats),
    encounterMode: mode,
    usesProjectile: ordered.some((step) => step.action === 'projectile'),
    usesContact: ordered.some((step) => step.action === 'contact'),
    usesEnvironment: ordered.some((step) => step.action === 'environment'),
    usesVectorEnvironment,
    territoryTransition: ground?.transition || REVEAL_TRANSITION.SPREAD_FROM_CENTER,
    revealOrigin: ground?.origin || REVEAL_ORIGIN.TERRITORY_CENTER,
    duration: Math.round(SPINE.END * DRAMA_SCALE),
    sequence: Object.freeze(ordered),
  });
}

const BEAT_RANK = {
  [BEAT.SETUP]: 0,
  [BEAT.ACTION]: 1,
  [BEAT.IMPACT]: 2,
  [BEAT.TERRITORY]: 3,
  [BEAT.REACTION]: 4,
  [BEAT.CLEANUP]: 5,
};

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

export const CAPTURE_STYLES = Object.freeze([

  // =========================================================================
  // PROJECTILE — attacker → something travels → it lands on them
  // =========================================================================

  // METEOR CLAIM — the reference implementation.
  //
  // Watch it with the sound off and the colour removed and it still reads: the
  // runner calls something down, a shadow spreads on the ground under the
  // rivals, they look up, the thing arrives growing, it lands ONCE, they are
  // thrown off the crater, the crater takes the territory, the dust clears.
  // Nothing else is on screen at any point.
  scene({
    id: 'meteor_claim',
    name: 'Meteor Claim',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'A meteor falls on the contested ground and the crater it leaves is the new territory.',
    beats: [
      'The runner points at the sky and a shadow spreads over the claim',
      'The rivals look up as the meteor grows on its way down',
      'It lands once, hard, and throws them off the ground',
      'The crater spreads the new colour outward and the dust clears',
    ],
    attacker: { open: ACTION.POINT_SKY, openOptions: { toward: 'screenTop' } },
    defenders: { notice: ACTION.LOOK_UP, noticeFrom: 'screenTop' },
    world: [
      // The shadow is the warning, and it is the reason a viewer knows to look
      // up before there is anything to see. It costs no art.
      env(SPINE.WARN, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 300, duration: 950, opacity: 0.55 }),
      env(SPINE.WARN + 60, E.DARKEN, { duration: 900, opacity: 0.22 }),
      // ONE object to follow, growing as it comes.
      fly(SPINE.RELEASE, 'solar_shrapnel_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 560, size: 110, grow: 2.4, spin: 70,
      }),
      cam(SPINE.IMPACT - 260, CAMERA_ACTION.WHIP_DOWN, { duration: 240 }),
      // The aftermath: cracks that stay, seams glowing the colour the ground is
      // about to become, then dust lifting off it. Consequence, not decoration.
      env(SPINE.IMPACT + 60, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 460, count: 7 }),
      env(SPINE.IMPACT + 90, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 900, count: 8 }),
      env(SPINE.CONVERT - 40, E.GLOW_SEAMS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 600, count: 7 }),
    ],
    impact: {
      sprite: 'warm_explosion_01',
      anchor: S.TERRITORY_CENTER,
      size: 320,
      hold: 520,
      flash: { opacity: 0.72, color: '#FFD9A8', duration: 260 },
      haptic: 'heavy',
      shake: { intensity: 1.5, axis: 'y' },
      punch: 1.16,
      freeze: 90,
      // A second, smaller pop of falling debris, so the meteor lands as a chain
      // hit rather than one flat bang. `boom_mid_01` (64px) rather than the
      // 32px pixel explosion this used to use: at the size a capture renders
      // at, a thumbnail sheet is a blur, which is a rule the effect tests
      // enforce for openings and which applies just as much here.
      debris: { sprite: 'boom_mid_01', size: 130, hold: 300, delay: 180, opacity: 0.85 },
    },
    territory: { transition: T.SHOCKWAVE, duration: 760 },
  }),

  scene({
    id: 'paint_bomb',
    name: 'Paint Bomb',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'A paint charge is lobbed into the rivals, bounces once, and bursts colour across the ground they were standing on.',
    beats: [
      'The runner lobs a paint charge at the group',
      'The rivals track it down and it lands between them',
      'It bounces, sits for a beat, and bursts',
      'The colour sets outward from where it went off',
    ],
    attacker: { open: ACTION.THROW, openOptions: { toward: 'defenderGroupCenter' } },
    defenders: {
      noticeFrom: 'characterCenter',
      displaceFrom: 'defenderGroupCenter',
      exitFrom: 'defenderGroupCenter',
    },
    world: [
      fly(SPINE.RELEASE - 220, 'bomb_blast_01', 'characterCenter', 'defenderGroupCenter', {
        duration: 400, size: 110, arc: -110, spin: 300,
        bounce: { height: 30, duration: 300, drift: 18 },
      }),
      // The fuse: nothing on screen at all, on purpose. A charge that lands and
      // instantly detonates is a cut; one that sits there is a thing everybody
      // in the scene has to look at.
      pause(SPINE.IMPACT - 300, 300),
    ],
    impact: {
      sprite: 'warm_explosion_01',
      anchor: 'defenderGroupCenter',
      size: 320,
      hold: 500,
      flash: { opacity: 0.5, color: '#FF9CE0', duration: 240 },
      haptic: 'heavy',
      shake: { intensity: 1.25, axis: 'both' },
      punch: 1.14,
    },
    territory: {
      transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 740,
    },
  }),

  scene({
    id: 'lightning_conquest',
    name: 'Lightning Conquest',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'One bolt earths through the rivals and the charge branches out along every tile they were standing on.',
    beats: [
      'The runner raises a storm and the sky closes over the claim',
      'The rivals look up and brace',
      'A single bolt earths into the middle of them',
      'The charge runs out along the ground and throws them off it',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displaceFrom: 'defenderGroupCenter', exitFrom: 'defenderGroupCenter',
    },
    world: [
      env(SPINE.WARN, E.DARKEN, { duration: 1000, opacity: 0.32 }),
      fly(SPINE.IMPACT - 260, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
        duration: 220, size: 80, speed: 1.6,
      }),
    ],
    impact: {
      sprite: 'electric_impact_01',
      anchor: 'defenderGroupCenter',
      size: 300,
      hold: 460,
      flash: { opacity: 0.8, color: '#CFF6FF', duration: 220 },
      haptic: 'heavy',
      shake: { intensity: 1.2, axis: 'x' },
      punch: 1.12,
    },
    territory: { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER, duration: 720 },
  }),

  scene({
    id: 'orbital_strike',
    name: 'Orbital Strike',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'A reticle locks onto the rivals, holds long enough for them to understand it, and the beam comes down on the mark.',
    beats: [
      'The runner paints a target on the claim',
      'The reticle locks over the rivals and holds',
      'They scramble off the mark, too late',
      'The beam lands on it and the shockwave takes the ground',
    ],
    attacker: { open: ACTION.POINT_SKY, openOptions: { toward: 'screenTop' } },
    defenders: {
      noticeFrom: 'defenderGroupCenter',
      displaceFrom: 'defenderGroupCenter', exitFrom: 'defenderGroupCenter',
    },
    world: [
      // The reticle IS the setup. It sits on the people it has locked onto and
      // nothing else happens while it does.
      fx(SPINE.WARN, 'sunburn_ring_01', {
        anchor: 'defenderGroupCenter', size: 200, hold: 620, opacity: 0.9,
      }),
      env(SPINE.RELEASE, E.DARKEN, { duration: 640, opacity: 0.28 }),
      // The silence before it fires. The lock is what makes it frightening.
      pause(SPINE.IMPACT - 320, 260),
      fly(SPINE.IMPACT - 300, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
        duration: 280, size: 85, grow: 1.6,
      }),
      env(SPINE.IMPACT + 80, E.DUST, { anchor: 'defenderGroupCenter', size: 280, duration: 880, count: 7 }),
    ],
    impact: {
      sprite: 'electric_impact_01',
      anchor: 'defenderGroupCenter',
      size: 310,
      hold: 480,
      flash: { opacity: 0.8, duration: 280 },
      haptic: 'heavy',
      shake: { intensity: 1.3, axis: 'both' },
      punch: 1.15,
      freeze: 80,
    },
    territory: { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 720 },
  }),

  scene({
    id: 'chain_reaction',
    name: 'Chain Reaction',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'One small charge sets off a bigger one, and a bigger one, walking across the claim until the last blast takes everything.',
    beats: [
      'The runner rolls a charge onto the edge of the claim',
      'The first pop is small and the rivals barely look',
      'Each blast is bigger than the last, and coming this way',
      'The last one goes off under everybody',
    ],
    attacker: { open: ACTION.THROW, openOptions: { toward: S.TERRITORY_TOP } },
    defenders: {
      noticeFrom: S.TERRITORY_TOP,
      displaceFrom: 'defenderGroupCenter', exitFrom: 'defenderGroupCenter',
    },
    world: [
      fly(SPINE.RELEASE - 260, 'bomb_blast_01', 'characterCenter', S.TERRITORY_TOP, {
        duration: 360, size: 90, arc: -70, spin: 260,
        bounce: { height: 22, duration: 240, drift: 16 },
      }),
      // Escalation is the idea, so the three sheets are genuinely different
      // sizes of drawing rather than one sprite scaled up. Tight windows: each
      // must be gone before the next goes off or it is not a chain.
      fx(640, 'boom_mid_01', { anchor: S.TERRITORY_TOP, size: 110, hold: 220 }),
      fx(880, 'boom_large_01', { anchor: S.TERRITORY_CENTER, size: 180, hold: 220 }),
      pause(SPINE.IMPACT - 140, 140),
      env(SPINE.IMPACT + 80, E.DUST, {
        anchor: 'defenderGroupCenter', size: 320, duration: 900, count: 9, color: '#4A3A32',
      }),
    ],
    impact: {
      sprite: 'boom_huge_01',
      anchor: 'defenderGroupCenter',
      size: 330,
      hold: 540,
      flash: { opacity: 0.7, color: '#FFC98A', duration: 280 },
      haptic: 'heavy',
      shake: { intensity: 1.5, axis: 'both' },
      punch: 1.16,
      freeze: 90,
    },
    territory: { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 760 },
  }),

  scene({
    id: 'storm_front',
    name: 'Storm Front',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'A weather front crosses the claim and three strikes walk down it in order, so the rivals can see exactly where the next one lands.',
    beats: [
      'The runner pulls a front in over the claim',
      'The sky closes and the rivals look up',
      'Strikes walk down the ground, one after another, getting closer',
      'The last one lands under them and the front passes over',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displaceFrom: S.TERRITORY_BOTTOM, exitFrom: S.TERRITORY_BOTTOM,
    },
    world: [
      env(SPINE.WARN, E.DARKEN, { duration: 1150, opacity: 0.34 }),
      env(SPINE.RELEASE, E.WIND, { duration: 900, count: 10, color: '#9FD8FF' }),
      // Strike one, at the top of the claim. Nobody is under it yet.
      fly(600, 'magical_projectile_01', 'screenTop', S.TERRITORY_TOP, { duration: 170, size: 75, speed: 1.7 }),
      fx(770, 'electric_impact_01', { anchor: S.TERRITORY_TOP, size: 190, hold: 220 }),
      // Strike two, closer. Its window closes exactly on the impact frame, so
      // the third strike lands on an empty stage.
      fly(860, 'magical_projectile_01', 'screenTop', S.TERRITORY_CENTER, { duration: 150, size: 80, speed: 1.7 }),
      fx(1010, 'electric_burst_01', { anchor: S.TERRITORY_CENTER, size: 210, hold: 140 }),
      // Strike three arrives on the impact frame.
      fly(SPINE.IMPACT - 170, 'magical_projectile_01', 'screenTop', S.TERRITORY_BOTTOM, {
        duration: 170, size: 85, speed: 1.8,
      }),
    ],
    impact: {
      sprite: 'electric_impact_01',
      anchor: S.TERRITORY_BOTTOM,
      size: 290,
      hold: 480,
      flash: { opacity: 0.75, color: '#CFF6FF', duration: 240 },
      haptic: 'heavy',
      shake: { intensity: 1.25, axis: 'x' },
      punch: 1.12,
    },
    territory: { transition: T.SPREAD_FROM_EDGE, origin: S.TERRITORY_TOP, duration: 780 },
  }),

  scene({
    id: 'ink_flood',
    name: 'Ink Flood',
    family: F.PROJECTILE,
    mode: M.PROJECTILE,
    concept: 'Ink rains onto the claim, the drops get heavier, and the pools join at the border and flood inward.',
    beats: [
      'The runner throws a cloud up over the claim',
      'The first drops land and the rivals look up',
      'The barrage gets heavier and drives them off the ground',
      'The pools join at the border and flood inward',
    ],
    attacker: { open: ACTION.THROW, openOptions: { upward: true, toward: 'screenTop' } },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displace: ACTION.SLIDE_TOWARD, displaceToward: 'perimeter',
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      env(SPINE.WARN, E.DARKEN, { duration: 1100, opacity: 0.26 }),
      // Accelerating, so the barrage builds rather than ticking. Each drop is
      // aimed at a NAMED place — a person, the middle, the far edge — and none
      // of them at a point picked by a hash.
      fly(560, 'magical_projectile_01', 'screenTop', S.TERRITORY_TOP, { duration: 200, size: 50 }),
      fly(700, 'magical_projectile_01', 'screenTop', 'nearestDefender', { duration: 190, size: 58 }),
      fly(840, 'magical_projectile_01', 'screenTop', S.TERRITORY_BOTTOM, { duration: 180, size: 64 }),
      fly(970, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', { duration: 170, size: 70 }),
    ],
    impact: {
      sprite: 'acid_splash_01',
      anchor: 'defenderGroupCenter',
      size: 260,
      hold: 460,
      flash: { opacity: 0.4, color: '#1B1030', duration: 200 },
      haptic: 'medium',
      shake: { intensity: 0.8, axis: 'y' },
      punch: 1.08,
    },
    territory: { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER, duration: 800 },
  }),

  scene({
    id: 'mech_drop',
    name: 'Mech Drop',
    family: F.PROJECTILE,
    mode: M.SUMMON_ONLY,
    concept: 'Something heavy drops feet first into the middle of the claim and the ground gives way under it.',
    beats: [
      'The runner calls the drop in and a shadow squares up on the ground',
      'The rivals run for the edge of it',
      'The mech lands feet first, once',
      'The ground ruptures outward from where it hit',
    ],
    attacker: { open: ACTION.POINT_SKY, openOptions: { toward: 'screenTop' } },
    defenders: { notice: ACTION.LOOK_UP, noticeFrom: 'screenTop' },
    world: [
      env(SPINE.WARN, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 280, duration: 900, opacity: 0.6 }),
      fly(SPINE.RELEASE, 'solar_shrapnel_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 520, size: 120, grow: 1.9,
      }),
      env(SPINE.IMPACT + 80, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 900, count: 8 }),
      env(SPINE.IMPACT + 200, E.WIND, { duration: 700, count: 8 }),
    ],
    impact: {
      sprite: 'earth_rupture_01',
      anchor: S.TERRITORY_CENTER,
      size: 290,
      hold: 540,
      flash: { opacity: 0.45, duration: 200 },
      haptic: 'heavy',
      shake: { intensity: 1.4, axis: 'y' },
      punch: 1.14,
      freeze: 80,
    },
    territory: { transition: T.SHOCKWAVE, duration: 740 },
  }),

  // =========================================================================
  // TERRITORY EVENT — something happens to the zone itself
  // =========================================================================

  scene({
    id: 'earth_crack',
    name: 'Earth Crack',
    family: F.TERRITORY,
    mode: M.ATTACKER_ONLY,
    concept: 'The runner slams the ground, the fracture races out under the rivals, and the claim colour comes up through the seams.',
    beats: [
      'The runner jumps and comes down on the ground',
      'The first fissure opens at their feet and races outward',
      'The slabs lift under everybody and drop back',
      'The new colour glows up through the cracks',
    ],
    attacker: { open: ACTION.JUMP, strike: ACTION.SLAM, strikeOptions: { toward: S.TERRITORY_CENTER } },
    defenders: {
      notice: [ACTION.NOTICE, ACTION.LOOK_LEFT, ACTION.SURPRISED, ACTION.LOOK_RIGHT],
      noticeFrom: 'characterFeet',
      displaceFrom: 'characterFeet', exitFrom: 'characterFeet',
    },
    world: [
      cam(SPINE.RELEASE, CAMERA_ACTION.WHIP_DOWN, { duration: 200 }),
      // The fracture starts at the fist and travels; the slabs lift; the seams
      // light in the colour the ground is about to become. Three primitives,
      // one continuous idea, and no sprite art at all beyond the strike itself.
      env(SPINE.IMPACT + 40, E.CRACKS, { anchor: 'characterFeet', size: 360, duration: 500, count: 8 }),
      env(SPINE.IMPACT + 120, E.RISE, { anchor: S.TERRITORY_CENTER, size: 340, duration: 700, count: 5 }),
      env(SPINE.CONVERT, E.GLOW_SEAMS, { anchor: 'characterFeet', size: 360, duration: 620, count: 8 }),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: 'characterFeet',
      size: 300,
      hold: 420,
      haptic: 'heavy',
      shake: { intensity: 1.4, axis: 'y' },
      punch: 1.12,
      freeze: 90,
    },
    territory: { transition: T.CRACK_GLOW, origin: S.CHARACTER_FEET, duration: 780 },
  }),

  scene({
    id: 'black_hole',
    name: 'Black Hole',
    family: F.TERRITORY,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'A void opens in the middle of the claim and pulls everything on it inward until it collapses.',
    beats: [
      'The runner opens a small void over the claim',
      'Loose ground starts moving before anybody has noticed',
      'The rivals slide toward it and dig in',
      'It collapses, takes them with it, and the claim reforms',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      displace: ACTION.SLIDE_TOWARD, displaceToward: S.TERRITORY_CENTER,
      exit: [ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT, ACTION.FLEE_FROM],
      exitToward: S.TERRITORY_CENTER,
    },
    world: [
      // The world reacts a full beat before anybody does. That ordering is the
      // whole read: this is dread, not an explosion played backwards.
      fx(SPINE.WARN, 'vortex_red_01', { anchor: S.TERRITORY_CENTER, size: 130, hold: 700 }),
      env(SPINE.WARN + 60, E.PULL_FIELD, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1000, count: 12 }),
    ],
    impact: {
      sprite: 'void_implosion_01',
      anchor: S.TERRITORY_CENTER,
      size: 240,
      hold: 500,
      flash: { opacity: 0.55, color: '#C79BFF', duration: 260 },
      haptic: 'heavy',
      shake: { intensity: 1.1, axis: 'both' },
      punch: 1.1,
      freeze: 120,
    },
    territory: { transition: T.DISSOLVE, duration: 800 },
  }),

  scene({
    id: 'neon_grid_hack',
    name: 'Neon Grid Hack',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'A scan line walks down the claim and converts every tile it passes over.',
    beats: [
      'The runner opens a console over the claim',
      'A warning flickers and the rivals notice',
      'Scan lines walk down the ground in steps',
      'The last line lands and the whole grid flips owner',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      notice: [ACTION.SURPRISED, ACTION.NOTICE, ACTION.GLITCH_JUMP, ACTION.SURPRISED],
      noticeFrom: 'screenBottom',
      displace: ACTION.SLIDE_TOWARD, displaceToward: 'perimeter',
      exit: [ACTION.PORTAL_EXIT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT],
      exitToward: 'perimeter',
    },
    world: [
      // Deliberately NOT a flash. A full-screen flash is the app's impact
      // signal, and one fired 950ms before the real hit reads as two hits —
      // which is the whole reason the impact rule rejects it. The scene dims
      // instead: anticipation without motion, systems going down.
      env(SPINE.WARN, E.DARKEN, { duration: 700, opacity: 0.3 }),
      // The scan itself, quantised, walking the shape. The style's whole idea
      // is one primitive; there is no sprite until the line lands.
      env(SPINE.RELEASE, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 320, duration: 580, steps: 8 }),
      cam(SPINE.RELEASE, CAMERA_ACTION.TILT, { amount: 2, duration: 300 }),
      env(SPINE.IMPACT + 120, E.WIND, { duration: 700, count: 8, color: '#7CF7FF' }),
    ],
    impact: {
      sprite: 'electric_burst_01',
      anchor: S.TERRITORY_CENTER,
      size: 260,
      hold: 400,
      flash: { opacity: 0.5, color: '#7CF7FF', duration: 200 },
      haptic: 'medium',
      shake: { intensity: 0.7, axis: 'x' },
      punch: 1.08,
    },
    territory: { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 760 },
  }),

  scene({
    id: 'pixel_takeover',
    name: 'Pixel Takeover',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'The claim breaks into blocks and reassembles under a new owner, taking the rivals apart with it.',
    beats: [
      'The runner corrupts the ground',
      'Noise climbs up from underneath and the rivals glitch with it',
      'The territory breaks into blocks',
      'It reassembles claimed, and they are put back outside it',
    ],
    attacker: { open: ACTION.CAST },
    defenders: {
      notice: [ACTION.SURPRISED, ACTION.GLITCH_JUMP, ACTION.NOTICE, ACTION.GLITCH_JUMP],
      noticeFrom: 'screenBottom',
      displace: ACTION.GLITCH_JUMP, displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT, ACTION.RUN_RIGHT],
      exitToward: 'perimeter',
    },
    world: [
      // Optional on purpose: older binaries do not carry this licensed sheet,
      // and the scene still glitches, reforms and completes without it.
      fx(SPINE.WARN, 'glitch_portal_01', {
        anchor: 'screenBottom', size: 260, hold: 500, optional: true,
      }),
      cam(SPINE.WARN, CAMERA_ACTION.TILT, { amount: 2.4, duration: 300 }),
      env(SPINE.RELEASE, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 540, steps: 6 }),
    ],
    impact: {
      sprite: 'electric_burst_01',
      anchor: S.TERRITORY_CENTER,
      size: 270,
      hold: 420,
      flash: { opacity: 0.45, color: '#B8FF6A', duration: 180 },
      haptic: 'medium',
      shake: { intensity: 1.1, axis: 'x' },
      punch: 1.1,
    },
    territory: { transition: T.PIXEL_REFORM, origin: S.TERRITORY_BOTTOM, duration: 760 },
  }),

  scene({
    id: 'geyser_break',
    name: 'Geyser Break',
    family: F.TERRITORY,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'The ground swells under the rivals for a beat and then a column comes up through them.',
    beats: [
      'The runner drives a heel into the ground',
      'The surface swells under the rivals and they lose their footing',
      'A column erupts up through them',
      'It falls back over ground that has changed hands',
    ],
    attacker: { open: ACTION.STOMP },
    defenders: {
      notice: [ACTION.LOOK_LEFT, ACTION.NOTICE, ACTION.LOOK_RIGHT, ACTION.SURPRISED],
      noticeFrom: 'defenderGroupCenter',
      displaceFrom: 'defenderGroupCenter', exitFrom: 'defenderGroupCenter',
    },
    world: [
      // The dread beat: the ground they are standing on is moving and nothing
      // has broken yet.
      env(SPINE.WARN, E.RISE, { anchor: 'defenderGroupCenter', size: 280, duration: 800, count: 5 }),
      env(SPINE.IMPACT + 100, E.DUST, {
        anchor: 'defenderGroupCenter', size: 280, duration: 850, count: 6, color: '#8FB8CC',
      }),
    ],
    impact: {
      sprite: 'fire_column_01',
      anchor: 'defenderGroupCenter',
      size: 200,
      hold: 540,
      flash: { opacity: 0.5, color: '#BFE9FF', duration: 220 },
      haptic: 'heavy',
      shake: { intensity: 1.3, axis: 'y' },
      punch: 1.12,
    },
    territory: { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 760 },
  }),

  scene({
    id: 'dragon_sweep',
    name: 'Dragon Sweep',
    family: F.TERRITORY,
    mode: M.SUMMON_ONLY,
    concept: 'A shadow crosses the claim and the breath that follows it burns the length of the ground.',
    beats: [
      'A shadow crosses the ground before anything else happens',
      'The rivals look up and run ahead of it',
      'The breath sweeps the length of the claim',
      'The smoke clears onto ground that has changed hands',
    ],
    attacker: { open: ACTION.POINT_SKY, openOptions: { toward: 'screenTop' } },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displaceFrom: S.TERRITORY_TOP, exitFrom: S.TERRITORY_TOP,
    },
    world: [
      // The shadow comes FIRST, alone. Nothing else is on screen — which is the
      // clearest demonstration in the pack that the narrative does the work and
      // the sprite sheet does not.
      env(SPINE.OPEN + 120, E.SHADOW_SWEEP, { anchor: S.TERRITORY_CENTER, size: 320, duration: 850 }),
      env(SPINE.WARN, E.DARKEN, { duration: 900, opacity: 0.3 }),
      env(SPINE.RELEASE + 140, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 340, duration: 620, opacity: 0.65, color: '#FF8A3D',
      }),
      env(SPINE.IMPACT + 100, E.DUST, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 900, count: 9, color: '#4A3A32',
      }),
    ],
    impact: {
      sprite: 'fire_spin_01',
      anchor: S.TERRITORY_CENTER,
      size: 200,
      hold: 520,
      haptic: 'heavy',
      shake: { intensity: 1.2, axis: 'x' },
      punch: 1.1,
    },
    territory: { transition: T.BURN_SPREAD, origin: S.TERRITORY_TOP, duration: 780 },
  }),

  scene({
    id: 'stamp_of_ownership',
    name: 'Stamp of Ownership',
    family: F.TERRITORY,
    mode: M.ATTACKER_ONLY,
    concept: 'One enormous stamp comes down on the claim and everything inside the impression is signed over.',
    beats: [
      'The runner winds up over the claim',
      'A shadow squares off on the ground and the rivals dive clear',
      'The stamp lands once, hard',
      'Every stamped tile converts inside the print',
    ],
    attacker: { open: ACTION.STEP_FORWARD, strike: ACTION.STOMP },
    defenders: {
      notice: [ACTION.LOOK_UP, ACTION.DODGE_LEFT, ACTION.DODGE_RIGHT, ACTION.DUCK],
      noticeFrom: S.TERRITORY_CENTER,
    },
    world: [
      env(SPINE.WARN, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 300, duration: 880, opacity: 0.52 }),
      env(SPINE.IMPACT + 80, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 850, count: 7 }),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: S.TERRITORY_CENTER,
      size: 300,
      hold: 420,
      flash: { opacity: 0.45, duration: 200 },
      haptic: 'heavy',
      shake: { intensity: 1.4, axis: 'y' },
      punch: 1.14,
      freeze: 100,
    },
    territory: { transition: T.TILE_CONVERT, duration: 640 },
  }),

  scene({
    id: 'domino_capture',
    name: 'Domino Capture',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'The runner tips the first tile and the chain crosses the claim, flipping each one it reaches.',
    beats: [
      'The runner tips the first tile at the top of the claim',
      'The chain travels and the rivals track it toward themselves',
      'Each of them goes over as it arrives',
      'The last tile lands and the whole line is flipped',
    ],
    attacker: { open: ACTION.PLANT },
    defenders: {
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.FALL_AND_RECOVER, displaceFrom: S.TERRITORY_TOP,
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      // A band travelling down the claim IS the chain. It needs no sprite: the
      // three magic circles this style used to fire at spaced-out points read
      // as three unrelated spells, not as one thing falling over.
      env(SPINE.RELEASE - 120, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 300, duration: 900, axis: 'y', opacity: 0.4,
      }),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: S.TERRITORY_BOTTOM,
      size: 260,
      hold: 400,
      haptic: 'medium',
      shake: { intensity: 0.9, axis: 'y' },
      punch: 1.06,
    },
    territory: { transition: T.FLIP_REVEAL, origin: S.TERRITORY_TOP, duration: 780 },
  }),

  scene({
    id: 'card_flip',
    name: 'Card Flip',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'The claim freezes into a deck and flips row by row, tipping the rivals off the cards they were standing on.',
    beats: [
      'The runner freezes the claim into a deck',
      'The rivals feel the ground stop being ground',
      'The flip rolls down in rows and tips them over',
      'The last card lands face up for its new owner',
    ],
    attacker: { open: ACTION.CAST },
    defenders: {
      notice: [ACTION.SURPRISED, ACTION.NOTICE, ACTION.LOOK_RIGHT, ACTION.LOOK_LEFT],
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.STUMBLE_LEFT,
      displaceFrom: S.TERRITORY_TOP,
      exit: [ACTION.RUN_RIGHT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT],
    },
    world: [
      cam(SPINE.WARN + 40, CAMERA_ACTION.FREEZE, { duration: 200 }),
      pause(SPINE.WARN + 40, 200),
      fx(SPINE.RELEASE, 'magic_spell_01', { anchor: S.TERRITORY_TOP, size: 130, hold: 500 }),
      env(SPINE.RELEASE + 120, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 820, axis: 'y', opacity: 0.32,
      }),
    ],
    impact: {
      sprite: 'magic_spell_01',
      anchor: S.TERRITORY_BOTTOM,
      size: 150,
      hold: 460,
      haptic: 'success',
      shake: { intensity: 0.6, axis: 'y' },
      punch: 1.05,
    },
    territory: { transition: T.FLIP_REVEAL, origin: S.TERRITORY_TOP, duration: 780 },
  }),

  scene({
    id: 'paper_tear',
    name: 'Paper Tear',
    family: F.TERRITORY,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'The map surface tears from one edge and peels away, taking the rivals with the layer they were standing on.',
    beats: [
      'The runner takes hold of the map surface',
      'A tear opens along the top edge',
      'The seam travels and the rivals scramble on the moving layer',
      'The old surface peels away and takes them with it',
    ],
    attacker: { open: ACTION.PLANT },
    defenders: {
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.SLIDE_TOWARD, displaceToward: S.TERRITORY_TOP,
      exit: [ACTION.PORTAL_EXIT, ACTION.FLEE_FROM, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      cam(SPINE.WARN + 60, CAMERA_ACTION.TILT, { amount: -1.6, duration: 260 }),
      env(SPINE.RELEASE, E.CRACKS, { anchor: S.TERRITORY_TOP, size: 320, duration: 560, count: 5 }),
    ],
    impact: {
      sprite: 'arcane_parry_01',
      anchor: S.TERRITORY_TOP,
      size: 230,
      hold: 440,
      haptic: 'medium',
      shake: { intensity: 0.9, axis: 'x' },
      punch: 1.07,
    },
    territory: { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 800 },
  }),

  scene({
    id: 'reality_rewrite',
    name: 'Reality Rewrite',
    family: F.TERRITORY,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'Two anchors are cast to opposite edges of the claim and everything between them is rewritten.',
    beats: [
      'The runner casts an anchor to each edge of the claim',
      'The rivals watch the line connect around them',
      'A rewrite fires between the anchors',
      'Reality breaks into pixels and reforms under its new owner',
    ],
    attacker: { open: ACTION.CAST, openOptions: { side: 'left', duration: 360 }, strike: ACTION.CHARGE, strikeOptions: { duration: 480 } },
    defenders: {
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.GLITCH_JUMP, displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT, ACTION.RUN_LEFT],
      exitToward: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN, 'magic_spell_01', { anchor: S.TERRITORY_TOP, size: 130, hold: 420 }),
      // The line between the two anchors, drawn by something crossing it.
      fly(680, 'magical_projectile_01', S.TERRITORY_TOP, S.TERRITORY_BOTTOM, {
        duration: 280, size: 75, speed: 1.5,
      }),
      env(SPINE.IMPACT + 60, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 620, steps: 7 }),
    ],
    impact: {
      sprite: 'arcane_parry_01',
      anchor: S.TERRITORY_CENTER,
      size: 250,
      hold: 440,
      flash: { opacity: 0.55, color: '#C79BFF', duration: 220 },
      haptic: 'medium',
      shake: { intensity: 0.8, axis: 'both' },
      punch: 1.09,
    },
    territory: { transition: T.PIXEL_REFORM, duration: 780 },
  }),

  scene({
    id: 'lights_out',
    name: 'Lights Out',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'The lights go out over the claim and the rivals lose interest and wander off it.',
    beats: [
      'The runner hums one note over the claim',
      'The lights go down across the ground',
      'The rivals yawn and stop paying attention',
      'They drift off, and the claim is already someone else’s',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      notice: [ACTION.NOTICE, ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT, ACTION.SURPRISED],
      noticeFrom: 'characterCenter',
      displace: ACTION.SHAKE_OFF,
      displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      // The one style with no strike at all. Nothing hits anybody, so nothing
      // flashes, nothing shakes and the haptic is the lightest in the pack —
      // a heavy buzz under a light going out would be a lie about the event.
      // The lights going down IS the whole idea, so a 32px emote balloon over
      // the runner's head was the only art here and it was both blurry at
      // capture scale and beside the point.
      env(SPINE.WARN, E.DARKEN, { duration: 1200, opacity: 0.42 }),
      env(SPINE.IMPACT + 150, E.WIND, { duration: 700, count: 6 }),
    ],
    impact: {
      sprite: 'midnight_01',
      anchor: S.TERRITORY_CENTER,
      size: 280,
      hold: 620,
      haptic: 'light',
    },
    territory: { transition: T.RADIAL, duration: 820 },
  }),

  scene({
    id: 'energy_pulse',
    name: 'Energy Pulse',
    family: F.TERRITORY,
    mode: M.ATTACKER_ONLY,
    concept: 'The runner gathers a charge in plain sight and drives it into the ground as one clean pulse.',
    beats: [
      'The runner gathers a charge between their hands',
      'It grows where everyone can see it and the rivals back away',
      'They drive it into the ground',
      'One pulse crosses the claim and clears it',
    ],
    attacker: { open: ACTION.CHARGE, strike: ACTION.SLAM, strikeOptions: { toward: S.TERRITORY_CENTER } },
    defenders: {
      noticeFrom: 'characterCenter',
      displaceFrom: 'characterFeet', exitFrom: 'characterFeet',
    },
    world: [
      // The charge is visible on the runner the whole way up. That is the
      // anticipation: the rivals back off from a thing they can see building.
      fx(SPINE.WARN - 80, 'blue_fire_01', { anchor: 'characterCenter', size: 110, hold: 700 }),
      pause(SPINE.IMPACT - 200, 160),
    ],
    impact: {
      sprite: 'frost_nova_01',
      anchor: 'characterFeet',
      size: 260,
      hold: 480,
      flash: { opacity: 0.6, color: '#BFE9FF', duration: 220 },
      haptic: 'heavy',
      shake: { intensity: 1.2, axis: 'both' },
      punch: 1.13,
      freeze: 90,
    },
    territory: { transition: T.SHOCKWAVE, origin: S.CHARACTER_FEET, duration: 760 },
  }),

  scene({
    id: 'overdrive_claim',
    name: 'Overdrive',
    family: F.TERRITORY,
    mode: M.ATTACKER_ONLY,
    concept: 'The runner powers up in plain sight and takes the whole claim with one stomp.',
    beats: [
      'The runner starts stacking power',
      'The aura builds and the rivals stop to watch it',
      'They drive one stomp into the ground',
      'A single pulse clears the claim',
    ],
    attacker: { open: ACTION.CHARGE, openOptions: { duration: 740 }, strike: ACTION.STOMP },
    defenders: {
      noticeFrom: 'characterCenter',
      displaceFrom: 'characterFeet', exitFrom: 'characterFeet',
    },
    world: [
      // ONE aura, not three. This style used to stack attack_up, defense_up and
      // haste onto the runner and then fire a shockwave, a frost nova and a
      // nebula of stars — six unrelated sheets for a single stomp.
      fx(SPINE.WARN - 100, 'haste_01', { anchor: 'characterCenter', size: 200, hold: 780 }),
      pause(SPINE.IMPACT - 180, 180),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: 'characterFeet',
      size: 310,
      hold: 440,
      flash: { opacity: 0.6, color: '#FFD9A8', duration: 220 },
      haptic: 'heavy',
      shake: { intensity: 1.35, axis: 'both' },
      punch: 1.15,
      freeze: 100,
    },
    territory: { transition: T.SHOCKWAVE, origin: S.CHARACTER_FEET, duration: 780 },
  }),

  scene({
    id: 'hex_seal',
    name: 'Seal of Ownership',
    family: F.TERRITORY,
    mode: M.TERRITORY_ONLY,
    concept: 'A seal inscribes itself under the claim and snaps shut around everyone standing on it.',
    beats: [
      'The runner starts drawing a seal under the claim',
      'The rings tighten and the rivals feel it closing',
      'The last ring snaps shut',
      'The pattern spreads cell by cell and the claim is signed',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      displace: ACTION.RESIST_PULL, displaceToward: S.TERRITORY_CENTER,
      exit: [ACTION.PORTAL_EXIT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT],
      exitToward: 'perimeter',
    },
    world: [
      // The seal itself, drawn once and held while it tightens. The opposite of
      // Stamp of Ownership: nothing lands anywhere until the last ring closes.
      fx(SPINE.WARN, 'protection_circle_01', { anchor: S.TERRITORY_CENTER, size: 170, hold: 760 }),
      env(SPINE.RELEASE, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 620, opacity: 0.35, color: '#FFD98A',
      }),
    ],
    impact: {
      sprite: 'protection_circle_01',
      anchor: S.TERRITORY_CENTER,
      size: 190,
      hold: 480,
      flash: { opacity: 0.5, color: '#FFD98A', duration: 200 },
      haptic: 'success',
      shake: { intensity: 0.9, axis: 'y' },
      punch: 1.09,
    },
    territory: { transition: T.TILE_CONVERT, duration: 780 },
  }),

  scene({
    id: 'ward_break',
    name: 'Ward Break',
    family: F.TERRITORY,
    mode: M.ATTACKER_ONLY,
    concept: 'The rivals raise a ward over the claim and the runner breaks it with one shot.',
    beats: [
      'The rivals throw a ward up over the claim and hold it',
      'The runner charges a single shot',
      'It cracks the ward and they strain to hold it together',
      'The ward collapses inward and takes the ground with it',
    ],
    attacker: { open: ACTION.CHARGE, openOptions: { duration: 720 } },
    defenders: {
      // The one style where the rivals have a defence, so their first beat is
      // holding something up rather than noticing something coming.
      notice: [ACTION.BRACE, ACTION.BRACE, ACTION.RESIST_PULL, ACTION.BRACE],
      noticeFrom: S.TERRITORY_CENTER, noticeAt: 300,
      displaceFrom: S.TERRITORY_CENTER, exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN, 'protection_circle_01', { anchor: S.TERRITORY_CENTER, size: 180, hold: 680 }),
      fly(SPINE.IMPACT - 240, 'magical_projectile_01', 'characterCenter', S.TERRITORY_CENTER, {
        duration: 220, size: 80, speed: 1.6,
      }),
      // Cracks in the WARD, at the ward's own anchor, so the thing that breaks
      // is visibly the thing they raised.
      env(SPINE.IMPACT + 40, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 300, duration: 440, count: 6 }),
    ],
    impact: {
      sprite: 'void_implosion_01',
      anchor: S.TERRITORY_CENTER,
      size: 280,
      hold: 520,
      flash: { opacity: 0.6, color: '#9BE8FF', duration: 240 },
      haptic: 'heavy',
      shake: { intensity: 1.3, axis: 'both' },
      punch: 1.14,
      freeze: 110,
      debris: { sprite: 'weapon_hit_01', size: 140, hold: 300, delay: 160 },
    },
    territory: { transition: T.IMPLODE, duration: 760 },
  }),

  scene({
    id: 'disco_capture',
    name: 'Disco Capture',
    family: F.TERRITORY,
    mode: M.SUMMON_ONLY,
    concept: 'A light sweeps the claim until the floor itself joins in and dances the rivals off it.',
    beats: [
      'The runner starts the music',
      'A light sweeps across the ground between both sides',
      'The floor flashes in rhythm and the rivals are dancing whether they like it or not',
      'The last beat locks the colour in',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: {
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.BOUNCE_REACTION, displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.RUN_RIGHT, ACTION.FLEE_FROM, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN, 'spectral_bloom_01', { anchor: S.TERRITORY_TOP, size: 200, hold: 480 }),
      env(SPINE.RELEASE, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 300, duration: 700, opacity: 0.42 }),
    ],
    impact: {
      // The only style where a burst of stars is the point rather than
      // decoration: a disco IS the sparkle.
      sprite: 'nebula_burst_01',
      anchor: S.TERRITORY_BOTTOM,
      size: 260,
      hold: 500,
      haptic: 'success',
      shake: { intensity: 0.7, axis: 'y' },
      punch: 1.06,
    },
    territory: { transition: T.ELECTRIFY, origin: S.TERRITORY_TOP, duration: 780 },
  }),

  // =========================================================================
  // SUMMON — the runner calls something in and it does the work
  // =========================================================================

  scene({
    id: 'kings_banner',
    name: 'King’s Banner',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'A giant standard falls out of the sky into the claim and the wind off it clears the ground.',
    beats: [
      'The runner raises a hand and a shadow falls across the claim',
      'The rivals look up as the pole comes down',
      'It crashes into the ground and plants itself',
      'The wind off the unfurling banner pushes them off the claim',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: { notice: ACTION.LOOK_UP, noticeFrom: 'screenTop' },
    world: [
      env(SPINE.WARN, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 240, duration: 820, opacity: 0.5 }),
      fly(SPINE.RELEASE, 'magical_projectile_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 480, size: 70, grow: 1.7,
      }),
      env(SPINE.IMPACT + 80, E.DUST, { anchor: S.TERRITORY_CENTER, size: 240, duration: 820, count: 6 }),
      env(SPINE.IMPACT + 220, E.WIND, { duration: 800, count: 10 }),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: S.TERRITORY_CENTER,
      size: 290,
      hold: 440,
      haptic: 'heavy',
      shake: { intensity: 1.3, axis: 'y' },
      punch: 1.12,
      freeze: 80,
    },
    territory: { transition: T.SPREAD_FROM_CENTER, duration: 760 },
  }),

  scene({
    id: 'portal_takeover',
    name: 'Portal Takeover',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'A doorway opens under the claim, the rivals are pulled through it, and it snaps shut on new ground.',
    beats: [
      'The runner opens a doorway under the edge of the claim',
      'The rivals back away from it',
      'It pulls them in and takes them through',
      'The portal collapses and the ground behind it has changed hands',
    ],
    attacker: { open: ACTION.CAST, openOptions: { away: true } },
    defenders: {
      noticeFrom: S.TERRITORY_BOTTOM,
      displace: ACTION.SLIDE_TOWARD, displaceToward: S.TERRITORY_BOTTOM,
      exit: [ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT],
      exitToward: S.TERRITORY_BOTTOM,
    },
    world: [
      // The portal opens, holds while they are drawn toward it, and collapses
      // ON the impact frame. One object, three states, no other art.
      fx(SPINE.WARN, 'vortex_red_01', { anchor: S.TERRITORY_BOTTOM, size: 240, hold: 780 }),
      env(SPINE.RELEASE + 100, E.PULL_FIELD, {
        anchor: S.TERRITORY_BOTTOM, size: 280, duration: 560, count: 10,
      }),
    ],
    impact: {
      sprite: 'void_implosion_01',
      anchor: S.TERRITORY_BOTTOM,
      size: 230,
      hold: 500,
      flash: { opacity: 0.45, color: '#C79BFF', duration: 200 },
      haptic: 'medium',
      shake: { intensity: 0.9, axis: 'both' },
      punch: 1.08,
    },
    territory: { transition: T.LIGHT_SWEEP, origin: S.TERRITORY_BOTTOM, duration: 800 },
  }),

  scene({
    id: 'ufo_abduction',
    name: 'UFO Abduction',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'A beam settles over the rivals, lifts them off the claim, and puts the ground back down under new ownership.',
    beats: [
      'The runner signals something overhead',
      'A glow settles over the rivals and they look up',
      'The beam lifts them off the ground',
      'The old territory goes up with them and comes back down claimed',
    ],
    attacker: { open: ACTION.POINT_SKY, openOptions: { toward: 'screenTop' } },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displace: null,
      exit: [ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT, ACTION.PORTAL_EXIT],
      exitToward: 'screenTop',
    },
    world: [
      env(SPINE.WARN, E.DARKEN, { duration: 950, opacity: 0.3 }),
      fx(SPINE.WARN + 40, 'sunburn_ring_01', { anchor: 'screenTop', size: 220, hold: 520, opacity: 0.85 }),
      cam(SPINE.RELEASE + 200, CAMERA_ACTION.WHIP_UP, { duration: 240 }),
      // The beam: a band standing on the group, holding through the lift.
      env(SPINE.RELEASE + 240, E.SWEEP_BAND, {
        anchor: 'defenderGroupCenter', size: 220, duration: 800, axis: 'y', opacity: 0.42, color: '#CFF6FF',
      }),
    ],
    impact: {
      sprite: 'spectral_bloom_01',
      anchor: 'defenderGroupCenter',
      size: 260,
      hold: 520,
      flash: { opacity: 0.5, color: '#CFF6FF', duration: 200 },
      haptic: 'medium',
      shake: { intensity: 0.7, axis: 'y' },
      punch: 1.07,
    },
    territory: { transition: T.DISSOLVE, origin: S.TERRITORY_TOP, duration: 800 },
  }),

  scene({
    id: 'golden_crown',
    name: 'Golden Crown',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'A crown of light comes down onto the runner and spreads outward from where they are standing.',
    beats: [
      'The runner raises their hands and the scene darkens around them',
      'A beam comes down onto them and the rivals turn to look',
      'It lands, and gold breaks out from their feet',
      'The light takes the ground and pushes the rivals off it',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: {
      noticeFrom: 'characterFeet',
      displace: ACTION.HOP_BACK, displaceFrom: 'characterFeet',
      exitFrom: 'characterFeet',
    },
    world: [
      env(SPINE.WARN, E.DARKEN, { duration: 900, opacity: 0.3 }),
      fly(SPINE.RELEASE, 'magical_projectile_01', 'screenTop', 'characterHead', {
        duration: 420, size: 75, speed: 1.4,
      }),
    ],
    impact: {
      sprite: 'radiant_heal_01',
      anchor: 'characterFeet',
      size: 250,
      hold: 520,
      flash: { opacity: 0.62, color: '#FFF3C4', duration: 240 },
      haptic: 'success',
      shake: { intensity: 0.8, axis: 'y' },
      punch: 1.1,
    },
    territory: { transition: T.SPREAD_FROM_CENTER, origin: S.CHARACTER_FEET, duration: 800 },
  }),

  scene({
    id: 'construction_crew',
    name: 'Construction Crew',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'The site is marked out in zones and converted one zone at a time, moving the rivals politely along.',
    beats: [
      'The runner marks out the site',
      'Work lights come on around the rivals',
      'The crew signs off each zone in turn and moves them along',
      'A final stamp signs off the whole grid',
    ],
    attacker: { open: ACTION.RAISE_ARMS },
    defenders: {
      notice: [ACTION.LOOK_LEFT, ACTION.NOTICE, ACTION.LOOK_RIGHT, ACTION.SURPRISED],
      noticeFrom: S.TERRITORY_TOP,
      displace: ACTION.SLIDE_TOWARD, displaceToward: 'perimeter',
      exit: [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN, 'radiant_heal_01', { anchor: S.TERRITORY_TOP, size: 150, hold: 420 }),
      env(SPINE.RELEASE, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 560, steps: 3 }),
    ],
    impact: {
      sprite: 'impact_shock_01',
      anchor: S.TERRITORY_CENTER,
      size: 250,
      hold: 400,
      haptic: 'success',
      shake: { intensity: 0.8, axis: 'y' },
      punch: 1.06,
    },
    territory: { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 780 },
  }),

  scene({
    id: 'lucky_duck',
    name: 'Lucky Duck',
    family: F.SUMMON,
    mode: M.SUMMON_ONLY,
    concept: 'Something small and yellow lands between the rivals, bobs once, and bounces every one of them off the claim.',
    beats: [
      'The runner tosses something small and yellow',
      'The rivals track it down and it lands between them',
      'It bobs once, and everybody goes up',
      'A ring of ownership rolls out from where it settled',
    ],
    attacker: { open: ACTION.THROW, openOptions: { toward: 'defenderGroupCenter' } },
    defenders: {
      notice: ACTION.LOOK_UP, noticeFrom: 'screenTop',
      displace: ACTION.BOUNCE_REACTION, displaceFrom: 'defenderGroupCenter',
      exitFrom: 'defenderGroupCenter',
    },
    world: [
      fly(SPINE.RELEASE - 200, 'radiant_heal_01', 'screenTop', 'defenderGroupCenter', {
        duration: 380, size: 110, arc: -60, spin: 90,
        bounce: { height: 34, duration: 280, drift: 10 },
      }),
      // The joke needs the beat of nothing. It lands, it sits there, everybody
      // looks at it, and only then does anyone leave the ground.
      pause(SPINE.IMPACT - 280, 260),
    ],
    impact: {
      // The one legitimate use of the bubble sheet in the pack: a comedy pop,
      // not a stand-in for paint, ink, vines and water as it used to be.
      sprite: 'magic_bubbles_01',
      anchor: 'defenderGroupCenter',
      size: 150,
      hold: 480,
      haptic: 'success',
      shake: { intensity: 0.7, axis: 'y' },
      punch: 1.07,
    },
    territory: { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 760 },
  }),

  // =========================================================================
  // TAKEOVER — the ground itself converts and crowds them off
  // =========================================================================

  scene({
    id: 'freeze_over',
    name: 'Freeze Over',
    family: F.TAKEOVER,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'Cold closes in from the border of the claim until the surface goes over and the rivals cannot keep their feet on it.',
    beats: [
      'The runner channels cold into the ground',
      'Frost closes in from the border and the rivals feel it arrive',
      'The surface goes over under them',
      'They slide off the ice and the claim settles frozen',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      notice: [ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT, ACTION.NOTICE, ACTION.SURPRISED],
      noticeFrom: 'perimeter',
      displace: ACTION.SLIDE_TOWARD, displaceToward: 'perimeter',
      exit: [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN - 40, 'frost_nova_01', { anchor: 'characterFeet', size: 170, hold: 520 }),
      env(SPINE.RELEASE - 100, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 800, opacity: 0.35, color: '#9BE8FF',
      }),
    ],
    impact: {
      // No bang anywhere in this one. A spread that detonated would be a blast,
      // and the whole idea is that it is not one.
      sprite: 'freezing_bloom_01',
      anchor: S.TERRITORY_CENTER,
      size: 280,
      hold: 600,
      haptic: 'medium',
      punch: 1.06,
    },
    territory: { transition: T.FREEZE_SPREAD, origin: S.PERIMETER, duration: 840 },
  }),

  scene({
    id: 'lava_claim',
    name: 'Lava Claim',
    family: F.TAKEOVER,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'The border of the claim catches like a fuse, runs a lap around the rivals, and floods inward.',
    beats: [
      'The runner stomps and the border catches',
      'The rivals watch the ring run all the way around them',
      'The lap closes and the middle erupts',
      'They break out through the ring as the ground goes over',
    ],
    attacker: { open: ACTION.STOMP },
    defenders: {
      noticeFrom: 'perimeter',
      displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.FLEE_FROM, ACTION.FLEE_FROM, ACTION.RUN_RIGHT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      fx(SPINE.WARN - 60, 'fire_spin_01', { anchor: 'characterFeet', size: 150, hold: 500 }),
      env(SPINE.RELEASE - 60, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 760, opacity: 0.45, color: '#FF8A3D',
      }),
      // The fuse catching right before it goes off: one beat of visible
      // anticipation instead of cutting straight to the bang.
      sup(SPINE.IMPACT - 260, 'ember_jet_01', { anchor: S.TERRITORY_CENTER, size: 160, hold: 240 }),
      env(SPINE.IMPACT + 90, E.DUST, {
        anchor: S.TERRITORY_CENTER, size: 280, duration: 820, count: 6, color: '#3A3230',
      }),
    ],
    impact: {
      sprite: 'warm_explosion_01',
      anchor: S.TERRITORY_CENTER,
      size: 300,
      hold: 500,
      flash: { opacity: 0.55, color: '#FF8A3D', duration: 220 },
      haptic: 'heavy',
      shake: { intensity: 1.3, axis: 'y' },
      punch: 1.12,
      freeze: 90,
    },
    territory: { transition: T.PERIMETER_BURN, origin: S.PERIMETER, duration: 820 },
  }),

  scene({
    id: 'vine_overgrowth',
    name: 'Vine Overgrowth',
    family: F.TAKEOVER,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'One seed goes in and the growth runs outward under the rivals until it has crowded them off the claim.',
    beats: [
      'The runner plants a seed',
      'The ground moves and the growth races outward',
      'It reaches them and lifts them off balance',
      'The claim blooms over and they are crowded out',
    ],
    attacker: { open: ACTION.PLANT },
    defenders: {
      noticeFrom: 'characterFeet',
      displace: ACTION.STUMBLE_RIGHT, displaceFrom: 'characterFeet',
      exit: [ACTION.RUN_LEFT, ACTION.FLEE_FROM, ACTION.RUN_RIGHT],
      exitFrom: 'characterFeet',
    },
    world: [
      env(SPINE.WARN, E.CRACKS, { anchor: 'characterFeet', size: 320, duration: 620, count: 6 }),
      env(SPINE.RELEASE + 120, E.RISE, { anchor: S.TERRITORY_CENTER, size: 320, duration: 700, count: 5 }),
    ],
    impact: {
      sprite: 'spectral_bloom_01',
      anchor: S.TERRITORY_CENTER,
      size: 280,
      hold: 560,
      haptic: 'success',
      shake: { intensity: 0.8, axis: 'y' },
      punch: 1.08,
    },
    territory: { transition: T.BLOOM, origin: S.CHARACTER_FEET, duration: 840 },
  }),

  scene({
    id: 'corrosion_creep',
    name: 'Corrosion Creep',
    family: F.TAKEOVER,
    mode: M.TERRAIN_TRANSFORM,
    concept: 'One drop goes down and eats outward in branches until there is nothing left to stand on.',
    beats: [
      'The runner puts a single drop on the ground',
      'It starts eating outward in branches',
      'The rivals give up a step to every branch that reaches them',
      'The whole surface goes over',
    ],
    attacker: { open: ACTION.PLANT },
    defenders: {
      noticeFrom: 'characterFeet',
      displace: ACTION.SLIDE_TOWARD, displaceToward: 'perimeter',
      exit: [ACTION.RUN_LEFT, ACTION.FLEE_FROM, ACTION.RUN_RIGHT],
      exitFrom: 'characterFeet',
    },
    world: [
      fx(SPINE.WARN - 60, 'acid_splash_01', { anchor: 'characterFeet', size: 150, hold: 440 }),
      env(SPINE.WARN + 80, E.CRACKS, { anchor: 'characterFeet', size: 260, duration: 580, count: 5 }),
      env(SPINE.RELEASE + 120, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 340, duration: 620, count: 7 }),
      env(SPINE.CONVERT, E.GLOW_SEAMS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 620, count: 7 }),
    ],
    impact: {
      // Nothing is thrown and nobody is hit, so `medium` — a heavy buzz under a
      // spreading stain would be a lie about what happened.
      sprite: 'fel_spell_01',
      anchor: S.TERRITORY_CENTER,
      size: 280,
      hold: 560,
      haptic: 'medium',
      shake: { intensity: 0.8, axis: 'x' },
      punch: 1.06,
    },
    territory: { transition: T.CORRUPTION_SPREAD, origin: S.CHARACTER_FEET, duration: 840 },
  }),

  scene({
    id: 'ghost_theft',
    name: 'Ghost Theft',
    family: F.TAKEOVER,
    mode: M.TERRITORY_ONLY,
    concept: 'The old colour lifts off the ground like a ghost and the rivals watch their own claim leave.',
    beats: [
      'The runner reaches for the ground',
      'A ghost of the old colour lifts out of it',
      'The rivals watch their own claim rise and go',
      'The shape dissolves into its new ownership and they turn away',
    ],
    attacker: { open: ACTION.CAST, openOptions: { hold: true } },
    defenders: {
      notice: [ACTION.NOTICE, ACTION.LOOK_LEFT, ACTION.SURPRISED, ACTION.NOTICE],
      noticeFrom: S.TERRITORY_CENTER,
      displace: ACTION.WINCE,
      displaceFrom: S.TERRITORY_CENTER,
      exit: [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT],
      exitFrom: S.TERRITORY_CENTER,
    },
    world: [
      // Nothing detonates, nobody is thrown, and the pull field goes UPWARD —
      // the colour leaving is the only motion in the scene.
      env(SPINE.RELEASE - 120, E.PULL_FIELD, { anchor: 'screenTop', size: 260, duration: 820, count: 8 }),
    ],
    impact: {
      sprite: 'spectral_bloom_01',
      anchor: S.TERRITORY_CENTER,
      size: 260,
      hold: 620,
      haptic: 'light',
    },
    territory: { transition: T.DISSOLVE, duration: 860 },
  }),

  // =========================================================================
  // DUEL — the characters actually touch. Two styles. That is deliberate.
  // =========================================================================

  scene({
    id: 'sword_slash',
    name: 'Sword Slash',
    family: F.DUEL,
    mode: M.DUEL,
    concept: 'The runner crosses the nearest rival with a single cut, and the cut tears the ground open.',
    beats: [
      'The two square up to each other',
      'The runner commits and crosses the nearest rival',
      'The cut lands and hangs there for a beat',
      'It tears the territory open along the line of the slash',
    ],
    attacker: {
      open: ACTION.STEP_FORWARD,
      strike: ACTION.DASH_FORWARD,
      strikeOptions: { toward: 'nearestDefender' },
    },
    defenders: {
      notice: [ACTION.NOTICE, ACTION.BRACE, ACTION.LOOK_LEFT, ACTION.NOTICE],
      noticeFrom: 'characterCenter',
      displace: ACTION.FALL_AND_RECOVER, displaceFrom: 'characterCenter',
      exitFrom: 'characterCenter',
    },
    duel: { at: SPINE.IMPACT - 40, variant: 'grin-knock', target: 'nearest' },
    world: [
      pause(SPINE.IMPACT - 300, 200),
      env(SPINE.IMPACT + 80, E.CRACKS, { anchor: 'nearestDefender', size: 300, duration: 500, count: 5 }),
    ],
    impact: {
      // An actual blade crossing somebody, at the person it crossed. This style
      // used to fire the slash AND a magic orb on the same frame, so the cut it
      // is named after was competing with a second unrelated sprite.
      sprite: 'crescent_slash_01',
      anchor: 'nearestDefender',
      size: 170,
      hold: 400,
      haptic: 'medium',
      shake: { intensity: 1, axis: 'x' },
      punch: 1.12,
      freeze: 110,
    },
    territory: { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 740 },
  }),

  scene({
    id: 'angel_vs_demon',
    name: 'Angel vs Demon',
    family: F.DUEL,
    mode: M.DUEL,
    concept: 'Opposing auras charge on both sides, the two collide, and the runner’s wave wins the ground.',
    beats: [
      'Opposing auras charge on both sides',
      'The runner and the nearest rival commit to each other',
      'They collide and the energy holds at the point of contact',
      'The runner’s wave wins and rewrites the claim',
    ],
    attacker: {
      open: ACTION.CHARGE,
      strike: ACTION.DASH_FORWARD,
      strikeOptions: { toward: 'nearestDefender' },
    },
    defenders: {
      notice: [ACTION.BRACE, ACTION.HOP_BACK, ACTION.BRACE, ACTION.NOTICE],
      noticeFrom: 'characterCenter',
      displaceFrom: 'characterCenter',
      exitFrom: 'characterCenter',
    },
    duel: { at: SPINE.IMPACT - 60, variant: 'bonk', target: 'nearest' },
    world: [
      // Both auras, one on each side, in one window: the opposition IS the
      // idea, so the two are allowed to share the beat as hero and support.
      fx(SPINE.OPEN + 80, 'radiant_heal_01', { anchor: 'characterCenter', size: 180, hold: 620 }),
      sup(SPINE.OPEN + 140, 'vortex_red_01', { anchor: 'nearestDefender', size: 180, hold: 560 }),
      pause(SPINE.IMPACT - 220, 180),
    ],
    impact: {
      sprite: 'spectral_bloom_01',
      anchor: 'nearestDefender',
      size: 280,
      hold: 500,
      flash: { opacity: 0.6, color: '#FFE6FF', duration: 240 },
      haptic: 'heavy',
      shake: { intensity: 1.2, axis: 'both' },
      punch: 1.12,
      freeze: 110,
    },
    territory: { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER, duration: 760 },
  }),
]);

export const DEFAULT_CAPTURE_STYLE_ID = 'meteor_claim';

// Old ids may exist in persisted dev replays and gallery deep links. Resolve
// them to the closest surviving scene rather than keeping near-duplicates in
// the pool: several of the styles below were the same animation with a
// different sprite id, which is exactly the sameness this rework removes.
const LEGACY_ALIASES = Object.freeze({
  thunderstrike: 'lightning_conquest',
  earthshaker: 'earth_crack',
  warm_detonation: 'paint_bomb',
  frostbite: 'freeze_over',
  inferno: 'lava_claim',
  void_collapse: 'black_hole',
  arcane_portal: 'portal_takeover',
  radiant_claim: 'golden_crown',
  spellbound: 'reality_rewrite',
  cosmic_bloom: 'vine_overgrowth',
  blue_nova: 'energy_pulse',
  solar_shatter: 'meteor_claim',
  acid_rain: 'ink_flood',
  flower_power: 'vine_overgrowth',
  glitch_takeover: 'pixel_takeover',
});

export function getCaptureStyle(id) {
  const resolved = LEGACY_ALIASES[id] || id;
  return CAPTURE_STYLES.find((item) => item.id === resolved) || null;
}

export function isReleaseApprovedCaptureStyle(item) {
  return !!item && item.releaseApproved !== false;
}

/**
 * Whether a scene is built purely from drawn art.
 *
 * KEPT AS A QUERY, REMOVED AS A GATE, and that change is the single largest
 * behavioural difference in this file.
 *
 * `PLAYABLE_CAPTURE_STYLES` used to filter on this, on the reasoning that a
 * capture should show real drawn animation or not ship. The effect in practice
 * was that thirty of the thirty-eight styles never played: every scene that
 * used a shadow, a crack, a rise, a sweep, a scanline, wind, a pull field or
 * dust was held back, and those primitives are precisely how a scene says
 * "something is above you", "the ground is breaking", "this is the aftermath".
 *
 * So the eight styles that actually reached players were the eight with no
 * environmental storytelling at all — the pure sprite stacks. What a player saw
 * on every single claim was some particles, some characters moving, more
 * particles, a flash, an explosion and more particles, because that is
 * literally all those eight had. The pack was never the problem; the filter in
 * front of it was throwing away every scene that could explain itself.
 *
 * The primitives cost no art, carry no licence and cannot fail to load, and
 * they are the causal language of the whole system. They ship.
 */
export function isSpriteOnlyCaptureStyle(item) {
  return !!item && !item.usesVectorEnvironment;
}

export const PLAYABLE_CAPTURE_STYLES = Object.freeze(
  CAPTURE_STYLES.filter(isReleaseApprovedCaptureStyle)
);

function hashSeed(seed) {
  let hash = 0x811c9dc5;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function pickCaptureStyle(seed) {
  const pool = PLAYABLE_CAPTURE_STYLES;
  if (!pool.length) return DEFAULT_CAPTURE_STYLE_ID;
  const index = seed == null
    ? Math.floor(Math.random() * pool.length)
    : hashSeed(seed) % pool.length;
  return pool[index].id;
}

export function resolveCaptureStyle(id) {
  return getCaptureStyle(id) || getCaptureStyle(DEFAULT_CAPTURE_STYLE_ID);
}

export { ENCOUNTER_MODE, choreographySignature, choreographyProfile };
