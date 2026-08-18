// The choreography vocabulary.
//
// A capture style used to be a playlist of sprites over ONE actor. The people
// whose ground was being taken were not in it: they were handled upstream by
// CaptureEncounter, which ran the same shoulder-check for every style, threw
// them off screen, and only then let the style play. So every claim was
// "attacker bumps rival, rival vanishes, some art happens" — the art changed,
// the EVENT never did, and a meteor read exactly like a paint bomb.
//
// A style is now a complete mini cutscene with a CAST, and it owns the whole
// encounter. Eight parallel tracks:
//
//     attacker     what the runner's character does
//     defenders    what each rival does, individually
//     camera       what the scene does
//     effects      what the art does, including art that TRAVELS
//     environment  what the WORLD does: shadows, cracks, wind, sweeps, dust
//     territory    how the ground itself changes hands
//     feel         haptics, and the pauses that make an impact land
//     victory      the beat the attacker has actually won on
//
// Two rules follow from that and are enforced below rather than trusted:
//
//   1. Defenders are cast members, not a mode. If the claim returned people,
//      they are on screen and they participate. `encounterMode` describes the
//      SHAPE of the scene; it must never decide whether rivals exist.
//   2. Direct character contact is a style choice. Only a style whose fantasy
//      IS a clash (Sword Slash) may emit a `contact` step. An environmental
//      style that wants a rival knocked over says so with a defender action
//      caused by the event, not with a collision borrowed from somewhere else.
//
// Narrative shape every style is held to (see `validateChoreography`):
//
//     setup → anticipation → reaction → commit → impact → consequence
//           → territory takeover → defender exit → victory
//
// This module is plain data and plain functions on purpose — no Reanimated, no
// React. The transform chains that execute an actor action live in
// ClaimActor.js, the multi-character routing in CaptureCast.js, the stage cues
// in useCaptureStage.js, the world primitives in EnvironmentLayer.js and the
// ground transitions in claim/TerritoryRevealCanvas.js. Here is only what
// happens, to whom, when, and in what order.

import { HAPTIC_STYLES } from '../theme/haptics';
import { CLAIM_TIMING, DRAMA_SCALE } from '../components/claim/timing';
import { EFFECT_ANCHOR } from './effectTypes';

export { DRAMA_SCALE };

// ---------------------------------------------------------------------------
// The five beats
// ---------------------------------------------------------------------------
//
// Every step belongs to exactly one of these, and the whole point of naming
// them is that the question "what is this effect FOR" now has a required
// answer. A step that cannot be placed in a beat does not belong in the scene.
//
//     SETUP      the runner commits, the world warns, the rivals notice
//     ACTION     the attack is released and travels. ONE thing to follow.
//     IMPACT     one moment. The loudest thing in the scene, and alone in it.
//     TERRITORY  the ground turns over, caused by the impact, from its point
//     REACTION   the rivals are displaced and leave
//     CLEANUP    the aftermath clears and the runner takes the ground
//
// Ordering is enforced, not just documented: `validateChoreography` fails a
// style whose beats interleave out of sequence.
export const BEAT = Object.freeze({
  SETUP: 'setup',
  ACTION: 'action',
  IMPACT: 'impact',
  TERRITORY: 'territory',
  REACTION: 'reaction',
  CLEANUP: 'cleanup',
});

export const BEAT_ORDER = Object.freeze([
  BEAT.SETUP, BEAT.ACTION, BEAT.IMPACT, BEAT.TERRITORY, BEAT.REACTION, BEAT.CLEANUP,
]);

/**
 * Where a sprite is allowed to live.
 *
 * The old player kept up to three sprites alive and evicted the OLDEST when a
 * fourth arrived — so which art you saw depended on how many steps happened to
 * have fired recently, and a sprite could vanish mid-play for no reason a
 * viewer could infer. Two named slots instead:
 *
 *   HERO     the one thing the scene is about right now. A new hero replaces
 *            the previous hero immediately: there is only ever one.
 *   SUPPORT  something caused BY the hero, at a different point (debris from a
 *            crater, a splash where a drop landed). Also exactly one.
 *
 * A projectile is neither; it owns its flight and is removed on arrival.
 */
export const EFFECT_SLOT = Object.freeze({
  HERO: 'hero',
  SUPPORT: 'support',
});

/**
 * Anchors an effect may be placed on.
 *
 * `randomTerritoryPoint` is deliberately absent. It was used by eighteen of the
 * thirty-eight styles, almost always for a decorative sprite fired AFTER the
 * impact, and it is the single clearest example of the thing this rework
 * exists to remove: art that appears at a place chosen by a hash, caused by
 * nothing, moving nowhere, on top of the beat the viewer is trying to read.
 * Every effect must be able to answer "what put you there", and a random
 * interior point of a polygon cannot.
 */
export const CAUSAL_EFFECT_ANCHORS = Object.freeze(new Set([
  EFFECT_ANCHOR.TERRITORY_CENTER,
  EFFECT_ANCHOR.TERRITORY_VISUAL_CENTER,
  EFFECT_ANCHOR.TERRITORY_TOP,
  EFFECT_ANCHOR.TERRITORY_BOTTOM,
  EFFECT_ANCHOR.CHARACTER_HEAD,
  EFFECT_ANCHOR.CHARACTER_FEET,
  EFFECT_ANCHOR.CHARACTER_CENTER,
  EFFECT_ANCHOR.DEFENDER_GROUP_CENTER,
  EFFECT_ANCHOR.NEAREST_DEFENDER,
  EFFECT_ANCHOR.FURTHEST_DEFENDER,
  EFFECT_ANCHOR.SCREEN_TOP,
  EFFECT_ANCHOR.SCREEN_BOTTOM,
]));

export const isCausalAnchor = (name) =>
  CAUSAL_EFFECT_ANCHORS.has(name) || /^defender\[\d+\]\.(head|center|feet)$/.test(String(name || ''));

// ---------------------------------------------------------------------------
// Who is on stage
// ---------------------------------------------------------------------------

export const ROLE = Object.freeze({
  ATTACKER: 'attacker',
  DEFENDER: 'defender',
});

/**
 * Which defenders a step is addressed to.
 *
 * A style is authored WITHOUT knowing how many people it will be played
 * against — the same Meteor Claim has to work over empty ground and over three
 * rivals. So defender steps address the group, and `expandCast` resolves them
 * against the real cast at play time.
 *
 *   ALL       every defender, same action (optionally staggered)
 *   EACH      every defender, one action chosen per person from a pool, seeded
 *   <number>  one specific defender by index
 *   NEAREST   index 0 — the layout sorts the cast by distance from the claim
 *   FURTHEST  the last index, for the same reason
 */
export const TARGET = Object.freeze({
  ALL: 'all',
  EACH: 'each',
  NEAREST: 'nearest',
  FURTHEST: 'furthest',
});

// ---------------------------------------------------------------------------
// What a character can do
// ---------------------------------------------------------------------------
//
// Deliberately transform-level. A PASER character is assembled at runtime from
// live cosmetics (CharacterRig), so there are no pose sprites to cut to — but a
// container that can translate, scale, squash and rotate covers every beat
// below, and reads as intent because of its TIMING rather than its drawing. A
// wind-up that takes 320ms and a release that takes 90ms is a punch whatever
// the arms are doing.
//
// The second half of this list is the defender vocabulary, and it is the whole
// point of the rework: a rival can now notice, track, dodge, brace, be blown
// off their feet by something that landed somewhere specific, resist a pull,
// and leave under their own power. None of it needs new art.

export const ACTOR_ACTION = Object.freeze({
  // --- shared ---
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
  POINT_SKY: 'pointSky',
  RAISE_ARMS: 'raiseArms',
  MOVE_TO: 'moveTo',

  // --- the defender vocabulary ---
  LOOK_UP: 'lookUp',
  LOOK_LEFT: 'lookLeft',
  LOOK_RIGHT: 'lookRight',
  NOTICE: 'notice',
  SURPRISED: 'surprised',
  DUCK: 'duck',
  DODGE_LEFT: 'dodgeLeft',
  DODGE_RIGHT: 'dodgeRight',
  HOP_BACK: 'hopBack',
  STUMBLE_LEFT: 'stumbleLeft',
  STUMBLE_RIGHT: 'stumbleRight',
  SHOCKWAVE_KNOCKBACK: 'shockwaveKnockback',
  SLIDE_TOWARD: 'slideToward',
  RESIST_PULL: 'resistPull',
  RUN_LEFT: 'runLeft',
  RUN_RIGHT: 'runRight',
  FLEE_FROM: 'fleeFrom',
  FALL_AND_RECOVER: 'fallAndRecover',
  GLITCH_JUMP: 'glitchJump',
  BOUNCE_REACTION: 'bounceReaction',
  WINCE: 'wince',
  SHAKE_OFF: 'shakeOff',
  PORTAL_EXIT: 'portalExit',
});

/** Ergonomic alias — styles read better as `ACTION.LOOK_UP`. */
export const ACTION = ACTOR_ACTION;

// duration  — how long the actor is busy
// anticipation — how much of that is wind-up BEFORE the committed movement.
//   The player uses it to align a cue (a projectile leaving a hand, a bolt
//   landing) with the moment the action actually commits, rather than with the
//   moment it started. This is the single most load-bearing number in the file:
//   an impact that lands during the wind-up looks like the effect caused the
//   character rather than the other way round.
// directional — the action needs a point to work from or towards. A shockwave
//   blows a character along `defenderPosition - impactPosition`, so two people
//   on opposite sides of the same crater move in opposite directions.
// exit — the character is gone when it finishes. The cast holds everyone on
//   screen until an exit beat says otherwise, which is what stops the old
//   "defender is deleted before the style starts" behaviour coming back.
const ACTOR_SPECS_BASE = Object.freeze({
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
  // Points at something above the scene and HOLDS it, so the thing arriving has
  // somebody already looking at it. The hold is why it is not just a LOOK.
  [ACTOR_ACTION.POINT_SKY]: { duration: 560, anticipation: 220, hold: true },
  [ACTOR_ACTION.RAISE_ARMS]: { duration: 620, anticipation: 260, hold: true },
  [ACTOR_ACTION.MOVE_TO]: { duration: 620, anticipation: 80, directional: true },

  // --- defenders ---
  [ACTOR_ACTION.LOOK_UP]: { duration: 420, anticipation: 120 },
  [ACTOR_ACTION.LOOK_LEFT]: { duration: 380, anticipation: 100 },
  [ACTOR_ACTION.LOOK_RIGHT]: { duration: 380, anticipation: 100 },
  [ACTOR_ACTION.NOTICE]: { duration: 460, anticipation: 90, directional: true },
  [ACTOR_ACTION.SURPRISED]: { duration: 520, anticipation: 60 },
  [ACTOR_ACTION.DUCK]: { duration: 560, anticipation: 130 },
  [ACTOR_ACTION.DODGE_LEFT]: { duration: 520, anticipation: 120 },
  [ACTOR_ACTION.DODGE_RIGHT]: { duration: 520, anticipation: 120 },
  [ACTOR_ACTION.HOP_BACK]: { duration: 480, anticipation: 140, directional: true },
  [ACTOR_ACTION.STUMBLE_LEFT]: { duration: 560, anticipation: 0 },
  [ACTOR_ACTION.STUMBLE_RIGHT]: { duration: 560, anticipation: 0 },
  [ACTOR_ACTION.SHOCKWAVE_KNOCKBACK]: { duration: 820, anticipation: 0, directional: true },
  [ACTOR_ACTION.SLIDE_TOWARD]: { duration: 700, anticipation: 0, directional: true },
  [ACTOR_ACTION.RESIST_PULL]: { duration: 760, anticipation: 0, directional: true },
  [ACTOR_ACTION.RUN_LEFT]: { duration: 720, anticipation: 100, exit: true },
  [ACTOR_ACTION.RUN_RIGHT]: { duration: 720, anticipation: 100, exit: true },
  [ACTOR_ACTION.FLEE_FROM]: { duration: 780, anticipation: 120, directional: true, exit: true },
  [ACTOR_ACTION.FALL_AND_RECOVER]: { duration: 900, anticipation: 0 },
  [ACTOR_ACTION.GLITCH_JUMP]: { duration: 460, anticipation: 0 },
  [ACTOR_ACTION.BOUNCE_REACTION]: { duration: 500, anticipation: 80 },
  [ACTOR_ACTION.WINCE]: { duration: 420, anticipation: 0 },
  [ACTOR_ACTION.SHAKE_OFF]: { duration: 620, anticipation: 0 },
  [ACTOR_ACTION.PORTAL_EXIT]: { duration: 640, anticipation: 160, directional: true, exit: true },
});

// Stretched by DRAMA_SCALE, same as every step's `start`/`duration`/`stagger`
// below — so an actor step with no explicit duration override (the common
// case) still runs proportionally longer, and the "clears before the next
// beat" arithmetic authored against the old numbers stays true.
const ACTOR_SPECS = Object.freeze(
  Object.fromEntries(
    Object.entries(ACTOR_SPECS_BASE).map(([action, spec]) => [
      action,
      Object.freeze({
        ...spec,
        duration: Math.round(spec.duration * DRAMA_SCALE),
        anticipation: Math.round((spec.anticipation || 0) * DRAMA_SCALE),
      }),
    ])
  )
);

export function actorActionSpec(action) {
  return ACTOR_SPECS[action] || ACTOR_SPECS[ACTOR_ACTION.IDLE];
}

/** Does this action need a point to work from or towards? */
export const isDirectionalAction = (action) => !!actorActionSpec(action).directional;

/** Does this action end with the character off the scene? */
export const isExitAction = (action) => !!actorActionSpec(action).exit;

/** When an actor action is finished and that body is free again. */
export function actorEndsAt(start, action, options = {}) {
  return start + (options.duration || actorActionSpec(action).duration);
}

/**
 * The earliest a beat can start without cancelling the one before it ON THE
 * SAME BODY.
 *
 * There is one body per character. Two overlapping steps means the second
 * silently takes over the transform chain and the first never finishes — the
 * beat the style was written around simply does not play, and nothing errors.
 * `validateChoreography` now checks this per ROLE AND PER DEFENDER INDEX, so a
 * style may quite legally have defender 0 dodging while defender 2 braces, and
 * may not have defender 0 doing both.
 */
export function afterActor(wanted, previousStart, previousAction, options = {}) {
  return Math.max(wanted, actorEndsAt(previousStart, previousAction, options));
}

/** When an actor action commits — the frame its effect should be caused by. */
export function actorCommitAt(step) {
  const spec = actorActionSpec(step.name || step.action_name || step.actionName);
  const scale = step.duration ? step.duration / spec.duration : 1;
  return Math.round(step.start + spec.anticipation * scale);
}

// ---------------------------------------------------------------------------
// What the scene can do
// ---------------------------------------------------------------------------
//
// These move the OVERLAY STAGE — the reveal, the cast and the effects together
// — and not the Mapbox camera. That is a hard constraint, not a shortcut: the
// reveal is screen-space, projected once from a camera that is flat and
// stopped, and moving the real camera mid-sequence invalidates every pixel the
// overlay was laid out in (see the note in useClaimReveal.focus). A 1.1x push
// over 300ms still reads as a camera move because everything that is moving is
// on the stage; the ground under it is a static backdrop.
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
// What the world can do
// ---------------------------------------------------------------------------
//
// The environment track exists because the alternative was more sprites, and
// more sprites was the thing that made every style the same. What actually
// tells a viewer "a meteor is coming" is not a fireball — it is a shadow
// growing on the ground under them while people look up. These are drawn as
// primitives (SVG shapes and plain views, tinted from the live palette) by
// EnvironmentLayer, so they cost no art, carry no licence and never fail to
// load.
export const ENVIRONMENT = Object.freeze({
  // A shadow growing on the ground: something is above you and getting closer.
  SHADOW: 'shadow',
  // A shadow CROSSING the ground: something is flying over.
  SHADOW_SWEEP: 'shadowSweep',
  // One frame of light. The cheapest possible impact.
  FLASH: 'flash',
  // The scene dims. Anticipation without motion.
  DARKEN: 'darken',
  // Fissures crawling out from a point, and staying.
  CRACKS: 'cracks',
  // The claim colour coming up through those fissures BEFORE the reveal, so
  // the ground looks like it is about to change hands rather than being told.
  GLOW_SEAMS: 'glowSeams',
  // Slabs of ground lifting and dropping back.
  RISE: 'rise',
  // A band travelling across the territory: a breath weapon, a scanline.
  SWEEP_BAND: 'sweepBand',
  // A line of light stepping down the claim, quantised.
  SCANLINE: 'scanline',
  // Streaks pushing one way. Wind off a banner, blast off an explosion.
  WIND: 'wind',
  // Streaks pulling inward, plus a horizon. A gravity well, before anybody
  // has reacted to it.
  PULL_FIELD: 'pullField',
  // A veil that arrives and then CLEARS, which is what makes an impact have an
  // aftermath instead of just ending.
  DUST: 'dust',
});

// Which of the above are drawn as vector shapes rather than as sprite art.
//
// The project's direction is that a capture scene shows real drawn animation or
// it does not ship: a handful of fully-authored scenes beats a large pool
// padded out with shapes. FLASH and DARKEN are excluded from this set on
// purpose — they are full-screen tinted views, not drawings of anything, and
// carry no illustrative content a sprite would replace.
export const VECTOR_ENVIRONMENT_KINDS = Object.freeze(new Set([
  ENVIRONMENT.SHADOW,
  ENVIRONMENT.SHADOW_SWEEP,
  ENVIRONMENT.CRACKS,
  ENVIRONMENT.GLOW_SEAMS,
  ENVIRONMENT.RISE,
  ENVIRONMENT.SWEEP_BAND,
  ENVIRONMENT.SCANLINE,
  ENVIRONMENT.WIND,
  ENVIRONMENT.PULL_FIELD,
  ENVIRONMENT.DUST,
]));

// ---------------------------------------------------------------------------
// How the ground changes hands
// ---------------------------------------------------------------------------

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

/**
 * The SHAPE of the scene, and nothing else.
 *
 * This used to decide whether rivals appeared at all, which is how a claim
 * against three people could play out with none of them on screen. It no
 * longer has any say in that: the cast comes from the claim, and a style's mode
 * only describes what KIND of event takes the ground. DUEL is the one mode
 * whose fantasy is direct contact, and it is the only one allowed to emit a
 * `contact` step.
 */
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
  DEFENDER_GROUP: 'defenderGroupCenter',
});

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------
//
// Every step carries `start`, in ms from the beginning of the style. Flat and
// absolute rather than nested and relative, because the whole point of a
// choreography is that tracks OVERLAP — the attacker is still recoiling while
// the defenders are blown outward and the ground is already turning over.

/**
 * A character does something.
 *
 * Object form, because a step now has to say WHO as well as what:
 *
 *   actor({ role: 'attacker', start: 250, action: ACTION.POINT_SKY })
 *   actor({ role: 'defender', target: 'all', start: 600, action: ACTION.LOOK_UP })
 *   actor({ role: 'defender', target: 0, start: 1000, action: ACTION.DODGE_LEFT })
 *   actor({ role: 'defender', target: 'each', start: 950, stagger: 90,
 *           actions: [ACTION.DODGE_LEFT, ACTION.BRACE, ACTION.DODGE_RIGHT] })
 *
 * `from` / `toward` are anchor NAMES. The player resolves them with the same
 * resolver the effects use and hands the result to the action as a point, so a
 * shockwave knocks each person away from the crater that actually formed
 * rather than away from an assumed centre.
 */
export const actor = (config) => {
  const { role = ROLE.ATTACKER, action, actions, ...rest } = config;
  return {
    track: role === ROLE.DEFENDER ? 'defenders' : 'attacker',
    action: 'actor',
    role,
    // `name` is the resolved single action; `actions` is a pool that
    // `expandCast` picks from per defender. Exactly one of them is set.
    name: action || null,
    actions: actions || null,
    target: role === ROLE.DEFENDER ? (config.target ?? TARGET.ALL) : null,
    ...rest,
  };
};

/** Shorthand for the runner. */
export const attacker = (start, action, options = {}) =>
  actor({ role: ROLE.ATTACKER, start, action, ...options });

/** Shorthand for the group. */
export const defenders = (start, action, options = {}) =>
  actor({ role: ROLE.DEFENDER, target: TARGET.ALL, start, action, ...options });

/** Shorthand for "everybody reacts, but not identically". */
export const scatter = (start, actions, options = {}) =>
  actor({ role: ROLE.DEFENDER, target: TARGET.EACH, start, actions, stagger: 70, ...options });

/**
 * A sprite plays in one place, for a KNOWN length of time.
 *
 * `hold` is the window the art is allowed to occupy, and it is required. It is
 * the fix for the single biggest source of visual noise in the old pack: a step
 * authored as a quick flourish rendered whatever the sheet happened to be, and
 * the sheets are long. `magic_spell_01` is 81 frames at 30fps — 2.7 seconds —
 * so a "flourish" at 560ms was still playing over the impact, the reveal and
 * the defender exit. `freezing_bloom_01` at the speed one style asked for ran
 * for over five seconds, i.e. the entire rest of the scene.
 *
 * The player now derives playback speed from `hold` so the art plays through
 * exactly once inside its window, and removes it at the end of that window
 * whether the sheet has finished or not. A beat cannot leak into the next one.
 */
export const effect = (start, id, options = {}) => ({
  track: 'effect', effect: id, start,
  anchor: REVEAL_ORIGIN.TERRITORY_CENTER,
  size: 220,
  slot: EFFECT_SLOT.HERO,
  hold: 420,
  ...options,
});

/** Something the hero effect caused, somewhere else. Never the main read. */
export const support = (start, id, options = {}) =>
  effect(start, id, { slot: EFFECT_SLOT.SUPPORT, size: 150, hold: 340, ...options });

/**
 * A sprite TRAVELS from one anchor to another.
 *
 * A projectile is what makes a throw a throw. `grow` scales it as it goes, so
 * a meteor arrives bigger than it left, and `bounce` gives it a second, shorter
 * hop on landing — the difference between a bomb that lands and a bomb that
 * simply appears where it exploded.
 */
export const projectile = (start, id, from, to, options = {}) => ({
  track: 'effect', action: 'projectile', effect: id, start,
  from, to, duration: 260, size: 150, spin: 0, arc: 0, grow: 1, ...options,
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

/** The world does something. */
export const environment = (start, kind, options = {}) => ({
  track: 'environment', action: 'environment', kind, start,
  duration: 600, anchor: REVEAL_ORIGIN.TERRITORY_CENTER, ...options,
});

/**
 * The ground changes hands.
 *
 * Exactly one per style, and its POSITION in the sequence is a choice: before
 * the impact the land arrives and is then struck, after it the strike is what
 * put it there.
 */
export const reveal = (start, options = {}) => ({
  track: 'territory', action: 'territoryReveal', start,
  transition: REVEAL_TRANSITION.RADIAL,
  origin: REVEAL_ORIGIN.CLAIM_POINT,
  ...options,
});

/**
 * Direct character contact.
 *
 * The ONLY way a style gets a collision, and validation rejects it outside a
 * duel. It exists so Sword Slash can keep its clash — the clash is that style's
 * whole fantasy — without every environmental style inheriting a bump it never
 * asked for.
 */
export const contact = (start, options = {}) => ({
  track: 'attacker', action: 'contact', start,
  variant: 'grin-knock', duration: 520, ...options,
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

/**
 * The beat the attacker has won on.
 *
 * A marker rather than a movement — the celebrate itself is an actor step. It
 * exists so the narrative contract can be checked: a style must end with the
 * runner owning the ground, AFTER the reveal, and not simply stop once the
 * fireball has finished.
 */
export const victory = (start, options = {}) => ({
  track: 'victory', action: 'victory', start, ...options,
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

const scaleMs = (value) => (Number.isFinite(value) ? Math.round(value * DRAMA_SCALE) : value);

/**
 * Stretch one authored step by `DRAMA_SCALE`, in place.
 *
 * Only the timing fields move: `start`, `duration` and `stagger` (a group
 * beat's spacing) all scale by the same constant, which is what keeps every
 * inequality `validateChoreography` checks true after the retune. A sprite's
 * `speed` is not a timestamp — it is the ART's own playback rate — so it goes
 * the OTHER way, divided by the same factor, or a stretched beat would still
 * finish its effect at the old speed and hold a dead frame for the rest of
 * the beat it is now sitting inside.
 */
function scaleStep(step) {
  const scaled = { ...step };
  if (Number.isFinite(step.start)) scaled.start = scaleMs(step.start);
  if (Number.isFinite(step.duration)) scaled.duration = scaleMs(step.duration);
  if (Number.isFinite(step.stagger)) scaled.stagger = scaleMs(step.stagger);
  // A sprite's window scales with everything else. Its playback rate is then
  // DERIVED from that window by the player, rather than being an authored
  // number that had to be divided by the same factor and got it wrong.
  if (Number.isFinite(step.hold)) scaled.hold = scaleMs(step.hold);
  return scaled;
}

/** Stretch a whole authored timeline. `scene()` in captureStyles.js calls this once per style. */
export function scaleSequence(sequence) {
  return (sequence || []).map(scaleStep);
}

// ---------------------------------------------------------------------------
// Resolving the cast
// ---------------------------------------------------------------------------

/** FNV-1a. Small, stable, and the same function the style picker uses. */
function hashSeed(seed) {
  let hash = 0x811c9dc5;
  const text = String(seed == null ? '' : seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function resolveTargets(target, count) {
  if (count <= 0) return [];
  if (target === TARGET.ALL || target === TARGET.EACH) {
    return Array.from({ length: count }, (_, i) => i);
  }
  // The cast layout sorts defenders by distance from the claim point, so
  // "nearest" and "furthest" are the ends of that ordering rather than a
  // runtime geometry question the timeline cannot answer.
  if (target === TARGET.NEAREST) return [0];
  if (target === TARGET.FURTHEST) return [count - 1];
  if (Array.isArray(target)) return target.filter((i) => i >= 0 && i < count);
  if (Number.isInteger(target)) return target < count ? [target] : [];
  return [];
}

/**
 * Turn an authored timeline into the one this cast will actually play.
 *
 * Defender steps address the group; this resolves them to individuals against
 * the real defender count and a seed. Same claim, same reactions, every replay
 * — and different claims get different combinations, which is what stops three
 * people all dodging the same way like a chorus line.
 *
 * With no defenders every defender step simply disappears, which is how one
 * authored style covers both occupied and empty ground.
 */
export function expandCast(sequence, { defenderCount = 0, seed = '' } = {}) {
  const out = [];
  (sequence || []).forEach((step, position) => {
    if (step.action !== 'actor' || step.role !== ROLE.DEFENDER) {
      if (step.action === 'actor') out.push({ ...step, index: 0 });
      else out.push(step);
      return;
    }
    const targets = resolveTargets(step.target, defenderCount);
    targets.forEach((defenderIndex, n) => {
      const pool = step.actions;
      // Seeded per person AND per step, so one defender does not get the same
      // slot of every pool in the style and end up the designated left-dodger.
      // `position` alone already identifies the step uniquely — deliberately
      // NOT `step.start`, which moves whenever the choreography is retuned
      // (see DRAMA_SCALE) and would silently reshuffle who gets which slot,
      // or coincidentally collide and make every defender pick the same one.
      const name = pool && pool.length
        ? pool[hashSeed(`${seed}|${position}|${defenderIndex}`) % pool.length]
        : step.name;
      out.push({
        ...step,
        name,
        actions: null,
        index: defenderIndex,
        start: Math.round(step.start + (step.stagger || 0) * n),
      });
    });
  });
  return out.sort((a, b) => a.start - b.start);
}

/** Every actor step for one body, in order. */
export function timelineFor(sequence, role, index = 0) {
  return sequence
    .filter((step) => step.action === 'actor' && step.role === role && (step.index || 0) === index)
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// The uniqueness check
// ---------------------------------------------------------------------------

/**
 * A style's CHOREOGRAPHY, with the art taken out of it.
 *
 * This compares the things a viewer actually reads: what each side did, what
 * the world did, what the scene did, which art TRAVELLED and along what path,
 * how the ground turned over and from where, and where the silences were.
 * Effect ids, sizes, opacities and exact timings are all invisible to it on
 * purpose — fire and ice over the same movement is one animation painted twice.
 */
export function choreographySignature(style) {
  const steps = [...(style?.sequence || [])].sort((a, b) => a.start - b.start);
  return steps
    .map((step) => {
      if (step.action === 'actor') {
        const who = step.role === ROLE.DEFENDER ? `def:${step.target}` : 'atk';
        const what = step.name || (step.actions || []).join('/');
        return `${who}:${what}`;
      }
      if (step.action === 'contact') return `contact:${step.variant}`;
      if (step.action === 'camera') return `cam:${step.name}`;
      if (step.action === 'screenShake') return `shake:${step.axis || 'x'}`;
      if (step.action === 'projectile') return `fly:${step.from}>${step.to}`;
      if (step.action === 'environment') return `world:${step.kind}@${step.anchor}`;
      if (step.action === 'territoryReveal') return `ground:${step.transition}@${step.origin}`;
      if (step.action === 'pause') return 'pause';
      if (step.action === 'victory') return 'win';
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
  const ground = steps.find((s) => s.action === 'territoryReveal');
  const impact = steps.find((s) => s.action === 'haptic');
  const defenderSteps = steps.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER);
  return {
    actors: steps.filter((s) => s.action === 'actor' && s.role === ROLE.ATTACKER).map((s) => s.name),
    defenderBeats: defenderSteps.length,
    cameras: steps.filter((s) => s.action === 'camera').map((s) => s.name),
    world: steps.filter((s) => s.action === 'environment').map((s) => s.kind),
    flights: steps.filter((s) => s.action === 'projectile').length,
    pauses: steps.filter((s) => s.action === 'pause').length,
    contact: steps.some((s) => s.action === 'contact'),
    transition: ground?.transition || null,
    origin: ground?.origin || null,
    // Whether the land arrives and is then struck, or the strike is what put
    // it there. Still the biggest single difference between two celebrations.
    revealsBeforeImpact: !!ground && !!impact && ground.start < impact.start,
  };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const KNOWN_ACTIONS = new Set([
  'actor', 'camera', 'screenShake', 'projectile', 'territoryReveal',
  'environment', 'contact', 'victory', 'haptic', 'pause', 'sound',
]);

// How long a style may still be running after it has cued the reveal.
//
// The controller keeps the style mounted from its cue through the reveal and
// the handoff to the permanent Mapbox layer, and unmounts it there. A style
// whose rivals are still retreating past this point has those beats cut off
// mid-movement — which is exactly the "characters vanish" failure this rework
// exists to remove, arriving by a different door. Derived from the timing
// table rather than written down twice, so retuning the reveal cannot silently
// invalidate thirty styles.
export const POST_REVEAL_BUDGET = CLAIM_TIMING.reveal + CLAIM_TIMING.handoff;

// How far apart the ingredients of a single hit may be and still read as one
// hit. Anything outside this is two events, whatever it was meant to be.
export const IMPACT_WINDOW = 60;

// The counts every style is validated against. Three is the practical ceiling
// on a claim's victim list on screen at once; zero has to work because empty
// ground is a real claim and the same authored style has to cover it.
const VALIDATION_CAST_SIZES = [0, 1, 2, 3];

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
  if (typeof style.usesProjectile !== 'boolean') errors.push('usesProjectile metadata is required');
  if (typeof style.usesContact !== 'boolean') errors.push('usesContact metadata is required');

  // --- the ground ---------------------------------------------------------
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

  // The style stays mounted from its reveal cue until the permanent map layer
  // has taken over. Anything it schedules after that window is a beat nobody
  // will ever see.
  if (reveals[0] && style.duration > reveals[0].start + POST_REVEAL_BUDGET) {
    errors.push(
      `style runs ${style.duration - reveals[0].start}ms past its reveal cue, `
      + `over the ${POST_REVEAL_BUDGET}ms the controller keeps it mounted for`
    );
  }

  // --- feel ---------------------------------------------------------------
  //
  // Exactly one, not "at least one". Haptics in this app are deliberately
  // restrained (see theme/haptics.js) and a claim already spends its budget: a
  // style that buzzed at its wind-up AND its impact would be twice the feel of
  // every other beat in the app. Secondary beats get a shake instead.
  const haptics = steps.filter((s) => s.action === 'haptic');
  if (haptics.length !== 1) errors.push('exactly one primary haptic is required');
  haptics.forEach((step) => {
    // `haptic[name]?.()` makes a typo a silent no-op, which is how five styles
    // shipped asking for a 'heavy' that did not exist and felt like nothing at
    // their own climax. An unknown name is now a failing test instead.
    if (!HAPTIC_STYLES.includes(step.style)) {
      errors.push(`unknown haptic style ${step.style}`);
    }
  });

  // --- the narrative ------------------------------------------------------
  const wins = steps.filter((s) => s.action === 'victory');
  if (wins.length !== 1) errors.push('exactly one victory beat is required');
  if (wins[0] && reveals[0] && wins[0].start < reveals[0].start) {
    errors.push('the victory beat happens before the ground changes hands');
  }

  const contacts = steps.filter((s) => s.action === 'contact');
  if (contacts.length && style.encounterMode !== ENCOUNTER_MODE.DUEL) {
    errors.push(
      'only a duel may use direct contact: an environmental style must not '
      + 'open with a generic attacker/defender collision'
    );
  }
  if (style.usesContact !== contacts.length > 0) {
    errors.push('usesContact metadata does not match the sequence');
  }

  // The runner starts it. Every scene opens on somebody DOING something —
  // throwing, casting, calling something down — because an event with no cause
  // is a cutaway, and a claim the runner did not visibly make is the thing the
  // whole post-run flow exists to sell.
  const attackerSteps = steps.filter((s) => s.action === 'actor' && s.role === ROLE.ATTACKER);
  if (!attackerSteps.length) errors.push('the attacker never does anything');
  if (reveals[0] && !attackerSteps.some((s) => s.start < reveals[0].start)) {
    errors.push('the attacker never initiates: the ground turns over before they act');
  }

  const defenderSteps = steps.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER);
  if (!defenderSteps.length) {
    errors.push('no defender choreography: rivals would stand still through their own defeat');
  }
  // Somebody has to react BEFORE the thing that takes their ground, or the
  // scene has no anticipation and the event reads as a cutaway.
  if (reveals[0] && !defenderSteps.some((s) => s.start < reveals[0].start)) {
    errors.push('defenders never react before the territory turns over');
  }
  // ...and the scene has to say how they leave. Without this the cast simply
  // holds position under a finished claim, which is the other half of the old
  // bug: rivals deleted by the system rather than displaced by the event.
  const exits = defenderSteps.filter((s) => {
    const pool = s.actions || [s.name];
    return s.exit || pool.every((name) => isExitAction(name));
  });
  if (!exits.length) errors.push('defenders never leave: the style needs an exit beat');

  // --- the impact ---------------------------------------------------------
  //
  // There must be exactly one moment a viewer can point at and say "that was
  // the hit", and everything that sells it has to be ON it. The old pack put
  // the sprite, the flash, the shake and the punch-in within ~20ms of each
  // other, which was right, and then also had two-second sprites from earlier
  // beats still playing over the top of it, which meant the loudest frame in
  // the scene was competing with leftovers. `IMPACT_WINDOW` is what the player
  // clears the stage for.
  const impacts = steps.filter((s) => s.action === 'haptic');
  const impactAt = impacts[0]?.start ?? null;
  if (impactAt != null) {
    const late = steps.filter((s) => (
      (s.action === 'screenShake' || (s.action === 'environment' && s.kind === ENVIRONMENT.FLASH))
      && Math.abs(s.start - impactAt) > IMPACT_WINDOW
    ));
    late.forEach((s) => {
      errors.push(
        `${s.action === 'screenShake' ? 'a shake' : 'a flash'} at ${s.start}ms is `
        + `${Math.abs(s.start - impactAt)}ms from the impact at ${impactAt}ms: `
        + 'the ingredients of a hit must land on the same frame or they read as separate events'
      );
    });
  }

  // --- the art ------------------------------------------------------------
  //
  // Two rules, and between them they are most of this rework.
  const sprites = steps.filter((s) => s.track === 'effect' && s.action !== 'projectile');
  sprites.forEach((step, i) => {
    if (!Number.isFinite(step.hold) || step.hold <= 0) {
      errors.push(`effect ${step.effect} has no hold: a sprite with no window outlives its beat`);
    }
    if (!isCausalAnchor(step.anchor)) {
      errors.push(
        `effect ${step.effect} is anchored to "${step.anchor}", which is not a causal anchor: `
        + 'every piece of art must be placed by something that happened'
      );
    }
    if (step.slot && !Object.values(EFFECT_SLOT).includes(step.slot)) {
      errors.push(`effect ${step.effect} has unknown slot ${step.slot}`);
    }
    // One sprite per slot at a time. Overlap inside a slot is what produced
    // "explosion + stars + smoke + magic circle" all at once; the player would
    // resolve it by replacing, so the authored beat simply would not play.
    for (let j = i + 1; j < sprites.length; j += 1) {
      const other = sprites[j];
      if ((other.slot || EFFECT_SLOT.HERO) !== (step.slot || EFFECT_SLOT.HERO)) continue;
      if (other.start < step.start + (step.hold || 0) - 1) {
        errors.push(
          `${step.effect} and ${other.effect} overlap in the ${step.slot || EFFECT_SLOT.HERO} slot `
          + `(${step.start}-${step.start + (step.hold || 0)} vs ${other.start}): `
          + 'two unrelated sprites on screen at once is the thing that reads as random particles'
        );
      }
    }
  });

  // Nothing decorative after the ground has finished changing hands. The
  // aftermath belongs to the environment track (dust clearing, seams cooling),
  // which is drawn from primitives and reads as consequence; a fresh sprite
  // fired over a completed reveal is a new event with no cause, arriving at
  // exactly the moment the viewer is trying to read the outcome.
  if (reveals[0]) {
    const revealEnds = reveals[0].start + (reveals[0].duration || 0);
    sprites
      .filter((s) => s.start >= revealEnds)
      .forEach((s) => errors.push(
        `${s.effect} starts at ${s.start}ms, after the ground has finished turning over at `
        + `${revealEnds}ms: the takeover is the payoff and nothing may be fired over it`
      ));
  }

  // --- beat order ---------------------------------------------------------
  //
  // A step declares which of the five beats it serves, and the beats have to
  // happen in order. Without this a style can satisfy every rule above and
  // still be incoherent — a "cleanup" sprite in the middle of the setup passes
  // slot and anchor checks and is still an effect nobody can explain.
  let highest = -1;
  let highestName = null;
  steps.forEach((step) => {
    if (!step.beat) return;
    const rank = BEAT_ORDER.indexOf(step.beat);
    if (rank < 0) {
      errors.push(`unknown beat ${step.beat}`);
      return;
    }
    if (rank < highest) {
      errors.push(
        `a ${step.beat} step at ${step.start}ms comes after a ${highestName} step: `
        + 'the five beats must read in order'
      );
    } else {
      highest = rank;
      highestName = step.beat;
    }
  });

  // --- per-step sanity ----------------------------------------------------
  steps.forEach((step, index) => {
    if (!Number.isFinite(step.start) || step.start < 0) errors.push(`step ${index} has an invalid start`);
    if (step.action && !KNOWN_ACTIONS.has(step.action)) errors.push(`step ${index} has unknown action ${step.action}`);
    if (step.action === 'actor') {
      const pool = step.actions || [step.name];
      if (!pool.length || pool.some((name) => !ACTOR_SPECS[name])) {
        errors.push(`step ${index} has unknown actor action ${step.name || (step.actions || []).join('/')}`);
      }
      if (!Object.values(ROLE).includes(step.role)) errors.push(`step ${index} has unknown role ${step.role}`);
      // A directional action with nothing to work from would silently fall
      // back to a default direction, which is how a shockwave ends up blowing
      // everybody the same way regardless of where the crater is.
      if (pool.some((name) => isDirectionalAction(name)) && !step.from && !step.toward) {
        errors.push(`step ${index} is directional but names no origin anchor`);
      }
    }
    if (step.action === 'environment' && !Object.values(ENVIRONMENT).includes(step.kind)) {
      errors.push(`step ${index} has unknown environment kind ${step.kind}`);
    }
    if (step.action === 'camera' && !Object.values(CAMERA_ACTION).includes(step.name)) {
      errors.push(`step ${index} has unknown camera action ${step.name}`);
    }
    if (step.start > style.duration) errors.push(`step ${index} starts after the style ends`);
  });

  // --- one body per character --------------------------------------------
  //
  // Checked against the REAL expansion at every cast size the style can be
  // played at, because "does defender 1 have two overlapping beats" is not a
  // question the authored timeline can answer: it depends on how `each` and
  // `stagger` land for that many people.
  VALIDATION_CAST_SIZES.forEach((count) => {
    const expanded = expandCast(steps, { defenderCount: count, seed: `validate:${style.id}` });
    if (count > 0) {
      const mounted = new Set(
        expanded.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER).map((s) => s.index)
      );
      for (let i = 0; i < count; i += 1) {
        if (!mounted.has(i)) errors.push(`defender ${i} of ${count} has nothing to do`);
      }
    }
    const bodies = [[ROLE.ATTACKER, 0], ...Array.from({ length: count }, (_, i) => [ROLE.DEFENDER, i])];
    bodies.forEach(([role, index]) => {
      const timeline = timelineFor(expanded, role, index);
      timeline.forEach((step, i) => {
        const next = timeline[i + 1];
        if (!next) return;
        const spec = actorActionSpec(step.name);
        const ends = step.start + (step.duration || spec.duration);
        // `hold` actions are explicitly written to be interrupted by the next
        // beat: a character pointing at the sky holds the pose until whatever
        // they are pointing at arrives.
        if (!step.hold && !spec.hold && next.start < ends - 1) {
          errors.push(
            `${role}${role === ROLE.DEFENDER ? ` ${index}` : ''} steps overlap at cast size ${count}: `
            + `${step.name} still running when ${next.name} starts`
          );
        }
      });
    });
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
