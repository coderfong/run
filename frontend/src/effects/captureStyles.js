// Capture styles are complete mini cutscenes.
//
// The rule every style in this file is written to, and that
// `validateChoreography` enforces:
//
//     attacker initiates → defenders notice → the event develops
//       → it hits the defenders AND the ground → they are displaced
//       → the territory finishes changing hands → they leave
//       → the attacker has won
//
// What changed is not the art. It is that the RIVALS ARE IN THE SCENE. They
// used to be handled by a collision that ran before every style, identically,
// and deleted them — so a meteor and a paint bomb both opened with a
// shoulder-check and then played their fireball to an empty field. Now the
// claim's defenders are cast members from frame one, the style decides what
// they do, and they leave when the event throws them out.
//
// Three things follow from that and are worth knowing before editing:
//
//   * a style is authored WITHOUT knowing the cast size. Defender beats
//     address the group (`all` / `each` / an index / nearest / furthest) and
//     `expandCast` resolves them against the real claim. The same authored
//     scene therefore covers empty ground, one rival and three.
//   * `each` picks per person from a pool, seeded off the claim. Three people
//     do not all dodge left, and the same claim replays identically.
//   * only a DUEL may emit `contact`. Sword Slash keeps its clash because the
//     clash IS the style. Nothing else gets a bump.
//
// `encounterMode` describes the SHAPE of the event and nothing else. It has no
// say in whether rivals appear.

import {
  ACTION,
  CAMERA_ACTION,
  DRAMA_SCALE,
  ENCOUNTER_MODE,
  ENVIRONMENT,
  REVEAL_ORIGIN,
  REVEAL_TRANSITION,
  ROLE,
  actor,
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
  victory,
} from './choreography';

const sort = (steps) => [...steps].sort((a, b) => a.start - b.start);

// Every style below is authored at its original, brisk pace and stretched
// here by DRAMA_SCALE — see the note in components/claim/timing.js. Scaling
// every step's start/duration/stagger by the same constant preserves the
// "clears before the next beat" arithmetic the hand-tuned numbers below
// depend on, so the literals in each scene() call are the pre-scale values an
// author would actually read and retune.
function scene({
  id,
  name,
  encounterMode,
  description,
  beats,
  duration,
  sequence,
  archetype = `scene:${id}`,
}) {
  const ordered = sort(scaleSequence(sequence));
  const ground = ordered.find((step) => step.action === 'territoryReveal');
  return Object.freeze({
    id,
    name,
    archetype,
    description,
    beats: Object.freeze(beats),
    encounterMode,
    usesProjectile: ordered.some((step) => step.action === 'projectile'),
    usesContact: ordered.some((step) => step.action === 'contact'),
    usesEnvironment: ordered.some((step) => step.action === 'environment'),
    territoryTransition: ground?.transition || REVEAL_TRANSITION.SPREAD_FROM_CENTER,
    revealOrigin: ground?.origin || REVEAL_ORIGIN.TERRITORY_CENTER,
    duration: Math.round(duration * DRAMA_SCALE),
    sequence: Object.freeze(ordered),
  });
}

// Spacing a group beat, which is the one arithmetic mistake this file invites.
//
// One body may only run one action at a time, so a beat aimed at people who
// are already busy has to clear the SLOWEST of them: with a stagger of `st`
// over three rivals, the last of them starts at `start + 2*st` and finishes
// `duration` after that. Getting it wrong does not throw — the second beat
// silently cancels the first and the reaction the scene was built around never
// plays — so `validateChoreography` expands every style at cast sizes 0 to 3
// and fails the build instead.

const S = REVEAL_ORIGIN;
const T = REVEAL_TRANSITION;
const M = ENCOUNTER_MODE;
const E = ENVIRONMENT;

// Reaction pools. Named because the POINT of a pool is that one event produces
// several different human responses, and a style that reuses a pool is reusing
// that idea deliberately rather than by accident.
const SCATTER_FROM_ABOVE = [ACTION.DODGE_LEFT, ACTION.DODGE_RIGHT, ACTION.BRACE, ACTION.DUCK];
const SCATTER_ON_GROUND = [ACTION.HOP_BACK, ACTION.STUMBLE_LEFT, ACTION.STUMBLE_RIGHT, ACTION.DUCK];
const NOTICE_POOL = [ACTION.NOTICE, ACTION.SURPRISED, ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT];
const FLIGHT_POOL = [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.FLEE_FROM];

export const CAPTURE_STYLES = Object.freeze([
  // -------------------------------------------------------------------------
  // METEOR CLAIM — the reference implementation.
  //
  // Watch it with the territory colour turned off and it still reads: somebody
  // calls something down, everyone on that ground looks up, a shadow spreads
  // under them, they scatter, it lands, they are thrown off it, the ground
  // breaks and glows, they run, the runner walks in.
  //
  // Every number below is load-bearing against the one-body rule: the notice
  // beat clears before the scatter, the scatter clears before the shockwave,
  // and the shockwave clears before they flee. Validation expands this at
  // every cast size and fails if any of that stops being true.
  // -------------------------------------------------------------------------
  scene({
    id: 'meteor_claim',
    name: 'Meteor Claim',
    encounterMode: M.PROJECTILE,
    description: 'The runner calls down a meteor onto occupied ground: the rivals see the shadow spread, scatter, and are thrown off the crater it leaves.',
    beats: [
      'The runner points at the sky',
      'A shadow spreads over the claim and the rivals look up',
      'The meteor grows as it falls and they scatter',
      'It lands, throws them off the ground, and the crater takes the territory',
    ],
    duration: 4140,
    sequence: [
      // --- setup ---
      attacker(200, ACTION.STEP_FORWARD, { duration: 150 }),
      // --- anticipation: the runner causes it, and the world warns first ---
      attacker(350, ACTION.POINT_SKY, { toward: 'screenTop' }),
      environment(500, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1050, opacity: 0.55 }),
      environment(560, E.DARKEN, { duration: 1200, opacity: 0.22 }),
      // --- reaction: everybody on that ground sees it coming ---
      defenders(650, ACTION.LOOK_UP),
      // --- commit: it is visibly getting closer ---
      effect(820, 'sunburn_ring_01', { anchor: 'screenTop', size: 200, speed: 1.2, opacity: 0.8 }),
      projectile(850, 'solar_shrapnel_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 650, size: 120, grow: 2.6, spin: 90, speed: 1.5,
      }),
      camera(1150, CAMERA_ACTION.WHIP_DOWN, { duration: 260 }),
      // Seeded per person: one dives left, one braces, one ducks. Ends at
      // Last of them ends at 1080 + 2*60 + 340 = 1540, clear of 1560.
      scatter(1080, SCATTER_FROM_ABOVE, { stagger: 60, duration: 340, from: S.TERRITORY_CENTER }),
      attacker(1300, ACTION.BRACE),
      // --- impact: one frame, everything at once ---
      effect(1500, 'warm_explosion_01', { anchor: S.TERRITORY_CENTER, size: 320, speed: 1.2 }),
      environment(1500, E.FLASH, { duration: 420, opacity: 0.72, color: '#FFD9A8' }),
      haptic(1500, 'heavy'),
      shake(1510, { intensity: 1.5, axis: 'y' }),
      camera(1520, CAMERA_ACTION.PUNCH_IN, { amount: 1.16 }),
      environment(1520, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1500, count: 8 }),
      // --- consequence: away from the crater that actually formed ---
      defenders(1560, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
      environment(1550, E.CRACKS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 520, count: 7 }),
      environment(1650, E.GLOW_SEAMS, { anchor: S.TERRITORY_CENTER, size: 320, duration: 700, count: 7 }),
      // --- takeover ---
      reveal(1750, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 900 }),
      effect(1900, 'solar_shrapnel_01', { anchor: 'randomTerritoryPoint', size: 190, opacity: 0.8 }),
      // A second, smaller pop of falling debris — a chain-hit after the main
      // detonation rather than one flat bang.
      effect(1980, 'explosion_orange_01', { anchor: 'randomTerritoryPoint', size: 140, speed: 1.3, opacity: 0.85 }),
      // --- exit: they get up and leave, they are not deleted ---
      scatter(2420, FLIGHT_POOL, { stagger: 70, duration: 780, from: S.TERRITORY_CENTER }),
      // --- victory: the runner walks onto the ground they took ---
      attacker(2500, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3140, ACTION.CELEBRATE),
      victory(3140),
      sound(3140, 'claim'),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'neon_grid_hack',
    name: 'Neon Grid Hack',
    encounterMode: M.TERRITORY_ONLY,
    description: 'The runner opens a console; a scanline walks the claim and every rival it reaches is digitally displaced toward the perimeter.',
    beats: [
      'The runner activates the hack',
      'A glitch warning flickers and the rivals notice',
      'Scan lines walk down the claim, glitching each rival they reach',
      'The grid converts and the rivals are pushed off the edge',
    ],
    duration: 3760,
    sequence: [
      attacker(160, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.CAST, { hold: true }),
      // A short warning BEFORE anything scans: the rivals get to notice.
      environment(520, E.FLASH, { duration: 220, opacity: 0.3, color: '#7CF7FF' }),
      effect(560, 'magic_infinity_01', { anchor: 'screenBottom', size: 250, speed: 1.5 }),
      scatter(700, NOTICE_POOL, { stagger: 80, duration: 380, from: 'screenBottom' }),
      camera(880, CAMERA_ACTION.TILT, { amount: 2, duration: 300 }),
      // The scan itself, walking down the shape in quantised steps.
      environment(1000, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 320, duration: 900, steps: 8 }),
      // Each rival glitches as the line reaches them; last ends at 1840.
      scatter(1160, [ACTION.GLITCH_JUMP, ACTION.GLITCH_JUMP, ACTION.SURPRISED], { stagger: 110, duration: 460 }),
      effect(1500, 'electric_burst_01', { anchor: S.TERRITORY_TOP, size: 220, speed: 1.5 }),
      haptic(1900, 'medium'),
      shake(1910, { intensity: 0.7, axis: 'x' }),
      reveal(1960, { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 860 }),
      camera(1980, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
      // Displaced outward by the conversion rather than knocked over by anyone.
      defenders(2000, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
      environment(2120, E.WIND, { duration: 800, count: 8, color: '#7CF7FF' }),
      scatter(2760, [ACTION.PORTAL_EXIT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT], {
        stagger: 60, duration: 640, toward: 'perimeter',
      }),
      attacker(2700, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3340, ACTION.CELEBRATE, { duration: 420 }),
      victory(3340),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'kings_banner',
    name: 'King’s Banner',
    encounterMode: M.SUMMON_ONLY,
    description: 'A giant standard falls out of the sky into occupied ground; the wind off the unfurling banner pushes every rival back off the claim.',
    beats: [
      'The runner raises a hand and a shadow falls across the claim',
      'A giant flagpole crashes into the ground',
      'The rivals recoil from the impact as the banner unfurls',
      'Wind off the banner pushes them back and the colour spreads from the pole',
    ],
    duration: 4020,
    sequence: [
      attacker(180, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(340, ACTION.RAISE_ARMS),
      environment(560, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 240, duration: 800, opacity: 0.5 }),
      defenders(700, ACTION.LOOK_UP),
      projectile(900, 'magical_projectile_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 420, size: 130, grow: 1.6,
      }),
      scatter(1140, SCATTER_FROM_ABOVE, { stagger: 55, duration: 300, from: S.TERRITORY_CENTER }),
      // The pole lands. Vertical shake, because something went INTO the ground.
      effect(1340, 'impact_shock_01', { anchor: S.TERRITORY_CENTER, size: 280 }),
      haptic(1340, 'heavy'),
      shake(1350, { intensity: 1.3, axis: 'y' }),
      camera(1360, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
      environment(1360, E.DUST, { anchor: S.TERRITORY_CENTER, size: 240, duration: 1100, count: 6 }),
      defenders(1560, ACTION.HOP_BACK, { from: S.TERRITORY_CENTER }),
      // The banner opens, and the wind off it is what actually clears the ground.
      effect(1700, 'radiant_heal_01', { anchor: S.TERRITORY_CENTER, size: 230, speed: 0.9 }),
      environment(1780, E.WIND, { duration: 1200, count: 10 }),
      reveal(1860, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 900 }),
      defenders(2060, ACTION.RESIST_PULL, { toward: S.TERRITORY_CENTER }),
      effect(2200, 'sunburn_ring_01', { anchor: S.TERRITORY_TOP, size: 220, opacity: 0.85 }),
      scatter(2840, [ACTION.FLEE_FROM, ACTION.RUN_LEFT, ACTION.FLEE_FROM], {
        stagger: 70, duration: 700, from: S.TERRITORY_CENTER,
      }),
      attacker(2760, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3400, ACTION.CELEBRATE, { duration: 560 }),
      victory(3400),
    ],
  }),

  // -------------------------------------------------------------------------
  // PAINT BOMB — the bounce and the fuse are the whole point. A charge that
  // arrives and instantly detonates is a cut; a charge that lands, hops, and
  // sits there for a beat is a thing everyone in the scene has to react to.
  // -------------------------------------------------------------------------
  scene({
    id: 'paint_bomb',
    name: 'Paint Bomb',
    encounterMode: M.PROJECTILE,
    description: 'The runner lobs a paint charge into the group; it bounces once, sits for a beat, and bursts colour over everybody standing on the claim.',
    beats: [
      'The runner throws a paint charge into the group',
      'The rivals track it as it arcs down',
      'It lands, bounces once and sits there',
      'It bursts, splatters them, and the paint sets into the territory',
    ],
    duration: 4040,
    sequence: [
      attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
      // Thrown at the PEOPLE, not at the middle of a field.
      attacker(320, ACTION.THROW, { toward: 'defenderGroupCenter' }),
      projectile(660, 'bomb_blast_01', 'characterCenter', 'defenderGroupCenter', {
        duration: 420, size: 110, arc: -110, spin: 300, speed: 1.2,
        bounce: { height: 30, duration: 320, drift: 18 },
      }),
      // They watch it come down, then react to the hop.
      scatter(760, [ACTION.LOOK_RIGHT, ACTION.LOOK_LEFT, ACTION.NOTICE], {
        stagger: 70, duration: 340, from: 'characterCenter',
      }),
      effect(1080, 'magic_bubbles_01', { anchor: 'defenderGroupCenter', size: 120, opacity: 0.7 }),
      scatter(1120, [ACTION.BOUNCE_REACTION, ACTION.HOP_BACK, ACTION.DUCK], {
        stagger: 60, duration: 400, from: 'defenderGroupCenter',
      }),
      // The fuse. Nothing happens here on purpose.
      pause(1420, 300),
      attacker(1500, ACTION.BRACE),
      effect(1760, 'warm_explosion_01', { anchor: 'defenderGroupCenter', size: 320, speed: 1.15 }),
      environment(1760, E.FLASH, { duration: 300, opacity: 0.5, color: '#FF9CE0' }),
      haptic(1760, 'heavy'),
      shake(1770, { intensity: 1.25, axis: 'both' }),
      camera(1780, CAMERA_ACTION.PUNCH_IN, { amount: 1.14 }),
      defenders(1800, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
      reveal(1960, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 880 }),
      effect(2100, 'magic_bubbles_01', { anchor: 'randomTerritoryPoint', size: 200, opacity: 0.8 }),
      // Covered in it, and they know it.
      defenders(2640, ACTION.SHAKE_OFF),
      scatter(3280, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'defenderGroupCenter' }),
      attacker(2620, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3300, ACTION.CELEBRATE, { duration: 560 }),
      victory(3300),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'earth_crack',
    name: 'Earth Crack',
    encounterMode: M.ATTACKER_ONLY,
    description: 'The runner slams the ground and the fracture races out under the rivals, lifting slabs of the claim before it drops back and throws them clear.',
    beats: [
      'The runner jumps and slams the ground',
      'The first fissure opens at their feet and the nearest rival sees it',
      'The crack races underneath and the ground lifts under everybody',
      'The slabs drop, the rivals are thrown outward, and the claim glows through',
    ],
    duration: 3900,
    sequence: [
      attacker(120, ACTION.JUMP),
      pause(640, 240),
      camera(700, CAMERA_ACTION.WHIP_DOWN, { duration: 200 }),
      attacker(880, ACTION.SLAM),
      effect(1160, 'impact_shock_01', { anchor: 'characterFeet', size: 280, speed: 1.25 }),
      haptic(1160, 'heavy'),
      shake(1170, { intensity: 1.4, axis: 'y' }),
      // The fissure starts at the fist and travels. The nearest rival is the
      // first to see it, which is what makes it feel like it is coming for them.
      environment(1180, E.CRACKS, { anchor: 'characterFeet', size: 360, duration: 620, count: 8 }),
      actor({ role: ROLE.DEFENDER, target: 'nearest', start: 1220, action: ACTION.NOTICE, from: 'characterFeet' }),
      // Slabs lift under everybody, and they cannot keep their feet on them.
      environment(1500, E.RISE, { anchor: S.TERRITORY_CENTER, size: 340, duration: 900, count: 5 }),
      scatter(1700, SCATTER_ON_GROUND, { stagger: 70, duration: 420, from: 'characterFeet' }),
      environment(1760, E.GLOW_SEAMS, { anchor: 'characterFeet', size: 360, duration: 640, count: 8 }),
      // The ground comes back down. This is the beat that clears the claim.
      shake(2100, { intensity: 1.1, axis: 'y' }),
      camera(2110, CAMERA_ACTION.PUNCH_IN, { amount: 1.1 }),
      reveal(2160, { transition: T.CRACK_GLOW, origin: S.CHARACTER_FEET, duration: 820 }),
      defenders(2280, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'characterFeet' }),
      effect(2260, 'earth_rupture_01', { anchor: 'randomTerritoryPoint', size: 210, opacity: 0.85 }),
      scatter(3120, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'characterFeet' }),
      attacker(2680, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3320, ACTION.CELEBRATE, { duration: 480 }),
      victory(3320),
    ],
  }),

  // -------------------------------------------------------------------------
  // BLACK HOLE — the debris moves before the people do. That ordering is the
  // whole read: the world is already being pulled in before anybody notices,
  // which is what makes it dread rather than an explosion played backwards.
  // -------------------------------------------------------------------------
  scene({
    id: 'black_hole',
    name: 'Black Hole',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'A void opens in the middle of the claim; loose ground goes first, then the rivals slide, dig in, and are finally pulled through it.',
    beats: [
      'The runner opens a tiny void',
      'Loose ground starts moving before anybody reacts',
      'The rivals notice, slide toward it and dig in',
      'The void collapses, takes them with it, and the claim reforms',
    ],
    duration: 4180,
    sequence: [
      attacker(160, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(340, ACTION.CAST, { hold: true }),
      effect(560, 'vortex_red_01', { anchor: S.TERRITORY_CENTER, size: 120, speed: 0.8 }),
      // The world reacts first, and for a full beat nobody has noticed.
      environment(620, E.PULL_FIELD, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1600, count: 12 }),
      camera(700, CAMERA_ACTION.ZOOM_IN, { amount: 1.12, duration: 900 }),
      scatter(1000, NOTICE_POOL, { stagger: 90, duration: 400, from: S.TERRITORY_CENTER }),
      effect(1220, 'magic_infinity_01', { anchor: 'randomTerritoryPoint', size: 170, speed: 1.4, opacity: 0.75 }),
      // Losing ground, then holding it. Both beats, in that order.
      defenders(1600, ACTION.SLIDE_TOWARD, { toward: S.TERRITORY_CENTER }),
      defenders(2320, ACTION.RESIST_PULL, { toward: S.TERRITORY_CENTER, duration: 480 }),
      attacker(1600, ACTION.BRACE),
      camera(2200, CAMERA_ACTION.FREEZE, { duration: 300 }),
      pause(2200, 300),
      effect(2500, 'void_implosion_01', { anchor: S.TERRITORY_CENTER, size: 220, speed: 1.3 }),
      haptic(2500, 'heavy'),
      environment(2500, E.FLASH, { duration: 320, opacity: 0.55, color: '#C79BFF' }),
      camera(2520, CAMERA_ACTION.ZOOM_OUT, { amount: 0.94, duration: 180 }),
      // Taken through it. Not knocked over: consumed.
      defenders(2820, ACTION.PORTAL_EXIT, { toward: S.TERRITORY_CENTER }),
      reveal(2620, { transition: T.DISSOLVE, origin: S.TERRITORY_CENTER, duration: 900 }),
      camera(2700, CAMERA_ACTION.RELEASE, { duration: 340 }),
      attacker(2900, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      effect(3100, 'spectral_bloom_01', { anchor: S.TERRITORY_CENTER, size: 250, opacity: 0.8 }),
      attacker(3560, ACTION.CELEBRATE, { duration: 600 }),
      victory(3560),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'lightning_conquest',
    name: 'Lightning Conquest',
    encounterMode: M.PROJECTILE,
    description: 'The runner charges the sky over occupied ground; the bolt earths through the rivals and branches out along every tile they were standing on.',
    beats: [
      'The runner raises the storm',
      'The sky darkens and the rivals look up',
      'A bolt earths into the middle of them',
      'Electric branches run out and the rivals are thrown off the ground',
    ],
    duration: 3600,
    sequence: [
      attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(300, ACTION.RAISE_ARMS),
      environment(480, E.DARKEN, { duration: 1000, opacity: 0.3 }),
      effect(560, 'electric_burst_01', { anchor: 'screenTop', size: 230, speed: 1.3 }),
      defenders(680, ACTION.LOOK_UP),
      scatter(1120, [ACTION.BRACE, ACTION.DUCK, ACTION.HOP_BACK], {
        stagger: 55, duration: 320, from: 'screenTop',
      }),
      projectile(1180, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
        duration: 240, size: 160, speed: 1.6,
      }),
      attacker(1240, ACTION.BRACE),
      effect(1420, 'electric_impact_01', { anchor: 'defenderGroupCenter', size: 300, speed: 1.15 }),
      environment(1420, E.FLASH, { duration: 260, opacity: 0.8, color: '#CFF6FF' }),
      haptic(1420, 'heavy'),
      shake(1430, { intensity: 1.2, axis: 'x' }),
      camera(1440, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
      defenders(1560, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
      reveal(1600, { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER, duration: 820 }),
      effect(1800, 'solar_shrapnel_01', { anchor: S.TERRITORY_BOTTOM, size: 200, opacity: 0.85 }),
      defenders(2400, ACTION.WINCE),
      scatter(2840, FLIGHT_POOL, { stagger: 60, duration: 600, from: 'defenderGroupCenter' }),
      attacker(2300, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2960, ACTION.CELEBRATE, { duration: 560 }),
      victory(2960),
    ],
  }),

  // -------------------------------------------------------------------------
  // SWORD SLASH — a DUEL, and the only kind of style allowed a collision,
  // because here the collision is the event rather than a preamble to one.
  // -------------------------------------------------------------------------
  scene({
    id: 'sword_slash',
    name: 'Sword Slash',
    encounterMode: M.DUEL,
    description: 'The one style built on contact: the runner squares up to the nearest rival, crosses them, and the completed cut tears the ground open.',
    beats: [
      'The two square up',
      'The runner crosses the nearest rival',
      'The slash line hangs for a beat',
      'The cut tears the territory open and the rest scatter',
    ],
    duration: 3560,
    sequence: [
      attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
      actor({ role: ROLE.DEFENDER, target: 'nearest', start: 320, action: ACTION.NOTICE, from: 'characterCenter' }),
      actor({ role: ROLE.DEFENDER, target: 'furthest', start: 800, action: ACTION.LOOK_LEFT }),
      attacker(560, ACTION.BRACE),
      pause(1060, 160),
      // The clash. Owned by the style, at the moment the style chose.
      contact(1220, { variant: 'grin-knock', target: 'nearest' }),
      // The cut itself — this style had contact and a spark, but nothing that
      // actually read as a BLADE crossing somebody until this.
      effect(1230, 'crescent_slash_01', { anchor: 'nearestDefender', size: 210, speed: 1.3 }),
      effect(1240, 'magical_projectile_01', { anchor: 'nearestDefender', size: 190, speed: 1.6 }),
      attacker(1220, ACTION.DASH_FORWARD, { toward: 'nearestDefender' }),
      haptic(1560, 'medium'),
      shake(1570, { intensity: 1, axis: 'x' }),
      camera(1580, CAMERA_ACTION.PUNCH_IN, { amount: 1.1 }),
      actor({ role: ROLE.DEFENDER, target: 'nearest', start: 1600, action: ACTION.FALL_AND_RECOVER, from: 'characterCenter', duration: 640 }),
      // Everyone else scatters from the fight rather than being part of it.
      actor({
        role: ROLE.DEFENDER, target: 'furthest', start: 2260, action: ACTION.HOP_BACK, from: 'nearestDefender',
      }),
      reveal(1740, { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 780 }),
      effect(1860, 'arcane_parry_01', { anchor: S.TERRITORY_BOTTOM, size: 240, speed: 1.3 }),
      environment(1900, E.CRACKS, { anchor: S.TERRITORY_TOP, size: 300, duration: 560, count: 5 }),
      scatter(2760, FLIGHT_POOL, { stagger: 70, duration: 620, from: 'characterCenter' }),
      attacker(2100, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2760, ACTION.CELEBRATE, { duration: 600 }),
      victory(2760),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'portal_takeover',
    name: 'Portal Takeover',
    encounterMode: M.SUMMON_ONLY,
    description: 'A doorway opens under the claim and the ground is handed through it; the rivals back off, then leave the way the new ground came in.',
    beats: [
      'The runner opens a doorway under the claim',
      'The rivals back away from it',
      'New ground pours through and takes the surface',
      'They step out through the portal and it folds away',
    ],
    duration: 3560,
    sequence: [
      attacker(160, ACTION.STEP_FORWARD, { duration: 150, away: true }),
      attacker(340, ACTION.CAST),
      effect(520, 'vortex_red_01', { anchor: S.TERRITORY_BOTTOM, size: 260, speed: 1.4 }),
      scatter(700, NOTICE_POOL, { stagger: 80, duration: 380, from: S.TERRITORY_BOTTOM }),
      defenders(1260, ACTION.HOP_BACK, { from: S.TERRITORY_BOTTOM }),
      effect(1200, 'spectral_bloom_01', { anchor: S.TERRITORY_BOTTOM, size: 240, speed: 1.05 }),
      haptic(1240, 'light'),
      camera(1280, CAMERA_ACTION.ZOOM_IN, { amount: 1.05, duration: 420 }),
      reveal(1340, { transition: T.LIGHT_SWEEP, origin: S.TERRITORY_BOTTOM, duration: 900 }),
      environment(1400, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 300, duration: 900, axis: 'y', opacity: 0.4 }),
      defenders(1760, ACTION.PORTAL_EXIT, { toward: S.TERRITORY_BOTTOM }),
      effect(2280, 'void_implosion_01', { anchor: S.TERRITORY_BOTTOM, size: 220 }),
      camera(2300, CAMERA_ACTION.RELEASE, { duration: 380 }),
      attacker(2340, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2980, ACTION.CELEBRATE, { duration: 560 }),
      victory(2980),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'freeze_over',
    name: 'Freeze Over',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'The runner channels cold from the border inward; the rivals feel it reach them, lose their footing on the new ice, and slide off the claim.',
    beats: [
      'The runner channels cold into the ground',
      'Frost closes in from the border and the rivals feel it',
      'The surface goes over and they cannot keep their feet',
      'They slide off the ice and the claim settles frozen',
    ],
    duration: 3900,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.CAST, { hold: true }),
      effect(600, 'frost_nova_01', { anchor: 'characterFeet', size: 200, speed: 1.2 }),
      haptic(600, 'light'),
      camera(620, CAMERA_ACTION.ZOOM_IN, { amount: 1.06, duration: 700 }),
      // No impact anywhere in this one. A spread that banged would be a blast.
      environment(700, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 320, duration: 1200, opacity: 0.35, color: '#9BE8FF' }),
      scatter(820, [ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT, ACTION.NOTICE], {
        stagger: 90, duration: 380, from: 'perimeter',
      }),
      reveal(1180, { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER, duration: 1200 }),
      effect(1300, 'freezing_bloom_01', { anchor: S.TERRITORY_CENTER, size: 300, speed: 0.9 }),
      // The ice arrives under them and takes their footing.
      scatter(1300, [ACTION.STUMBLE_LEFT, ACTION.STUMBLE_RIGHT, ACTION.DUCK], {
        stagger: 80, duration: 460,
      }),
      effect(1900, 'magic_bubbles_01', { anchor: 'randomTerritoryPoint', size: 200, speed: 1.4, opacity: 0.7 }),
      defenders(1940, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
      camera(2380, CAMERA_ACTION.RELEASE, { duration: 420 }),
      scatter(2700, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT], {
        stagger: 70, duration: 640,
      }),
      attacker(2560, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3200, ACTION.CELEBRATE, { duration: 620 }),
      victory(3200),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'lava_claim',
    name: 'Lava Claim',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'A stomp lights the border like a fuse; the ring of lava completes a lap around the rivals and floods inward until they have to run through it.',
    beats: [
      'The runner stomps and the border catches',
      'The rivals watch the ring run around them',
      'The lap closes and the middle floods',
      'They break out through the ring as the ground goes over',
    ],
    duration: 3760,
    sequence: [
      attacker(150, ACTION.STOMP),
      effect(450, 'fire_spin_01', { anchor: 'characterFeet', size: 190, speed: 1.5 }),
      shake(470, { intensity: 0.6, axis: 'y' }),
      environment(500, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 320, duration: 1000, opacity: 0.45, color: '#FF8A3D' }),
      scatter(640, NOTICE_POOL, { stagger: 85, duration: 380, from: 'characterFeet' }),
      effect(900, 'fire_column_01', { anchor: S.TERRITORY_CENTER, size: 290, speed: 0.85, opacity: 0.9 }),
      reveal(1020, { transition: T.PERIMETER_BURN, origin: S.PERIMETER, duration: 1000 }),
      // Surrounded: they pull toward the middle before they break out.
      defenders(1200, ACTION.HOP_BACK, { from: 'perimeter' }),
      // The fuse catching right before it goes off, so the eruption has a
      // beat of visible anticipation instead of cutting straight to the bang.
      effect(1780, 'ember_jet_01', { anchor: S.TERRITORY_CENTER, size: 200, speed: 1.2 }),
      pause(1900, 140),
      effect(2040, 'warm_explosion_01', { anchor: S.TERRITORY_CENTER, size: 300, speed: 1.1 }),
      haptic(2040, 'heavy'),
      camera(2060, CAMERA_ACTION.PUNCH_IN, { amount: 1.08 }),
      environment(2060, E.DUST, { anchor: S.TERRITORY_CENTER, size: 280, duration: 900, count: 6, color: '#3A3230' }),
      defenders(2100, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
      scatter(2940, [ACTION.FLEE_FROM, ACTION.FLEE_FROM, ACTION.RUN_RIGHT], {
        stagger: 60, duration: 620, from: S.TERRITORY_CENTER,
      }),
      attacker(2560, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3200, ACTION.CELEBRATE, { duration: 540 }),
      victory(3200),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'stamp_of_ownership',
    name: 'Stamp of Ownership',
    encounterMode: M.ATTACKER_ONLY,
    description: 'One enormous stamp comes down on the claim; the rivals dive clear of the impression and everything inside it converts at once.',
    beats: [
      'The runner winds up over the claim',
      'A shadow squares off on the ground and the rivals dive clear',
      'The stamp lands once, hard',
      'Every stamped tile converts and the rivals are shoved out of the print',
    ],
    duration: 3660,
    sequence: [
      attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.STOMP),
      environment(420, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 280, duration: 560, opacity: 0.5 }),
      defenders(560, ACTION.LOOK_UP),
      scatter(1000, SCATTER_FROM_ABOVE, { stagger: 55, duration: 300, from: S.TERRITORY_CENTER }),
      effect(1180, 'impact_shock_01', { anchor: S.TERRITORY_CENTER, size: 290 }),
      environment(1180, E.FLASH, { duration: 240, opacity: 0.45 }),
      haptic(1180, 'heavy'),
      shake(1190, { intensity: 1.4, axis: 'y' }),
      camera(1200, CAMERA_ACTION.PUNCH_IN, { amount: 1.14 }),
      environment(1200, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1000, count: 7 }),
      defenders(1420, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
      reveal(1420, { transition: T.TILE_CONVERT, origin: S.TERRITORY_CENTER, duration: 640 }),
      effect(1700, 'sunburn_ring_01', { anchor: S.TERRITORY_CENTER, size: 210 }),
      defenders(2260, ACTION.SHAKE_OFF),
      scatter(2900, FLIGHT_POOL, { stagger: 55, duration: 600, from: S.TERRITORY_CENTER }),
      attacker(2080, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2740, ACTION.CELEBRATE, { duration: 600 }),
      victory(2740),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'orbital_strike',
    name: 'Orbital Strike',
    encounterMode: M.PROJECTILE,
    description: 'A reticle locks onto the rivals and holds there long enough for them to understand it, then the beam comes down on the mark.',
    beats: [
      'The runner paints a target on the claim',
      'The reticle locks over the rivals and holds',
      'They scatter off the mark',
      'The beam lands on it and the shockwave takes the ground',
    ],
    duration: 3560,
    sequence: [
      attacker(140, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.POINT_SKY, { toward: 'screenTop' }),
      effect(520, 'sunburn_ring_01', { anchor: 'defenderGroupCenter', size: 210 }),
      scatter(700, NOTICE_POOL, { stagger: 80, duration: 380, from: 'screenTop' }),
      // The lock holds. The silence is what makes the mark frightening.
      pause(1080, 260),
      environment(1100, E.DARKEN, { duration: 600, opacity: 0.26 }),
      scatter(1120, [ACTION.HOP_BACK, ACTION.DODGE_RIGHT, ACTION.DODGE_LEFT], {
        stagger: 60, duration: 380, from: 'defenderGroupCenter',
      }),
      projectile(1400, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
        duration: 300, size: 170, grow: 1.5,
      }),
      attacker(1420, ACTION.BRACE),
      effect(1700, 'electric_impact_01', { anchor: 'defenderGroupCenter', size: 310 }),
      environment(1700, E.FLASH, { duration: 340, opacity: 0.8 }),
      haptic(1700, 'heavy'),
      shake(1710, { intensity: 1.3, axis: 'both' }),
      defenders(1740, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'defenderGroupCenter' }),
      camera(1720, CAMERA_ACTION.PUNCH_IN, { amount: 1.15 }),
      reveal(1860, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 760 }),
      environment(1900, E.DUST, { anchor: 'defenderGroupCenter', size: 280, duration: 1100, count: 7 }),
      scatter(2580, FLIGHT_POOL, { stagger: 60, duration: 620, from: 'defenderGroupCenter' }),
      attacker(2300, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2940, ACTION.CELEBRATE, { duration: 600 }),
      victory(2940),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'domino_capture',
    name: 'Domino Capture',
    encounterMode: M.TERRITORY_ONLY,
    description: 'The runner tips the first tile and the chain crosses the claim, knocking each rival off their feet in the order the ground reaches them.',
    beats: [
      'The runner tips the first tile',
      'The chain travels and the rivals track it toward themselves',
      'Each one goes over as it reaches them',
      'The last tile lands and every fallen tile converts',
    ],
    duration: 3720,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.PLANT),
      effect(600, 'magic_spell_01', { anchor: S.TERRITORY_TOP, size: 150 }),
      scatter(700, [ACTION.LOOK_LEFT, ACTION.NOTICE, ACTION.LOOK_RIGHT], {
        stagger: 90, duration: 360, from: S.TERRITORY_TOP,
      }),
      effect(900, 'magic_spell_01', { anchor: 'randomTerritoryPoint', size: 170 }),
      environment(940, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1000, axis: 'y', opacity: 0.35 }),
      effect(1180, 'magic_spell_01', { anchor: S.TERRITORY_BOTTOM, size: 190 }),
      // Down the line, in order, as the chain arrives at each of them.
      scatter(1160, [ACTION.FALL_AND_RECOVER, ACTION.FALL_AND_RECOVER, ACTION.STUMBLE_RIGHT], {
        stagger: 170, duration: 620, from: S.TERRITORY_TOP,
      }),
      pause(1900, 140),
      haptic(2060, 'medium'),
      shake(2070, { intensity: 0.8, axis: 'y' }),
      reveal(2120, { transition: T.FLIP_REVEAL, origin: S.TERRITORY_TOP, duration: 800 }),
      effect(2300, 'radiant_heal_01', { anchor: S.TERRITORY_BOTTOM, size: 210 }),
      scatter(2460, [ACTION.RUN_RIGHT, ACTION.RUN_LEFT, ACTION.FLEE_FROM], {
        stagger: 70, duration: 640, from: S.TERRITORY_CENTER,
      }),
      attacker(2400, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3040, ACTION.CELEBRATE, { duration: 620 }),
      victory(3040),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'pixel_takeover',
    name: 'Pixel Takeover',
    encounterMode: M.TERRITORY_ONLY,
    description: 'Corruption climbs out of the ground and pixelates everything standing on it; the rivals glitch apart and reassemble somewhere else.',
    beats: [
      'The runner corrupts the ground',
      'Noise climbs from below and the rivals glitch with it',
      'The territory breaks into blocks',
      'They are reassembled outside it and the blocks snap to the new owner',
    ],
    duration: 3480,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.CAST),
      effect(520, 'glitch_portal_01', {
        // Optional on purpose: older binaries do not carry this licensed sheet.
        // The style still glitches, reforms and completes without it.
        anchor: 'screenBottom', size: 280, speed: 1.7, optional: true,
      }),
      camera(600, CAMERA_ACTION.TILT, { amount: 2.4, duration: 300 }),
      scatter(700, [ACTION.SURPRISED, ACTION.NOTICE, ACTION.SURPRISED], {
        stagger: 80, duration: 420, from: 'screenBottom',
      }),
      environment(940, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 700, steps: 6 }),
      defenders(1300, ACTION.GLITCH_JUMP),
      effect(1300, 'magic_infinity_01', { anchor: S.TERRITORY_CENTER, size: 250, speed: 1.5 }),
      defenders(1780, ACTION.GLITCH_JUMP),
      reveal(1760, { transition: T.PIXEL_REFORM, origin: S.TERRITORY_BOTTOM, duration: 820 }),
      effect(1900, 'electric_burst_01', { anchor: S.TERRITORY_CENTER, size: 270, speed: 1.35 }),
      haptic(1900, 'medium'),
      shake(1910, { intensity: 1.1, axis: 'x' }),
      camera(1920, CAMERA_ACTION.PUNCH_IN, { amount: 1.1 }),
      // Reassembled outside the claim.
      defenders(2260, ACTION.PORTAL_EXIT, { toward: 'perimeter' }),
      attacker(2200, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2840, ACTION.CELEBRATE, { duration: 600 }),
      victory(2840),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'vine_overgrowth',
    name: 'Vine Overgrowth',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'One seed goes in and the growth runs outward under the rivals, lifting and crowding them off the ground it is claiming.',
    beats: [
      'The runner plants a seed',
      'Vines race outward and the rivals notice the ground moving',
      'The growth reaches them and lifts them off balance',
      'Flowers open across the claim and they are crowded out',
    ],
    duration: 3780,
    sequence: [
      attacker(150, ACTION.PLANT),
      effect(450, 'radiant_heal_01', { anchor: 'characterFeet', size: 180 }),
      environment(520, E.CRACKS, { anchor: 'characterFeet', size: 320, duration: 800, count: 6 }),
      scatter(660, NOTICE_POOL, { stagger: 90, duration: 380, from: 'characterFeet' }),
      reveal(980, { transition: T.BLOOM, origin: S.CHARACTER_FEET, duration: 1100 }),
      effect(1060, 'spectral_bloom_01', { anchor: S.TERRITORY_CENTER, size: 280, speed: 0.95 }),
      environment(1120, E.RISE, { anchor: S.TERRITORY_CENTER, size: 320, duration: 900, count: 5 }),
      scatter(1200, SCATTER_ON_GROUND, { stagger: 80, duration: 460, from: 'characterFeet' }),
      effect(1600, 'magic_bubbles_01', { anchor: 'randomTerritoryPoint', size: 190, speed: 1.3, opacity: 0.85 }),
      defenders(1840, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
      effect(2100, 'nebula_burst_01', { anchor: S.TERRITORY_CENTER, size: 300, speed: 1.15 }),
      haptic(2100, 'success'),
      camera(2120, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
      scatter(2600, [ACTION.RUN_LEFT, ACTION.FLEE_FROM, ACTION.RUN_RIGHT], {
        stagger: 70, duration: 640, from: 'characterFeet',
      }),
      attacker(2540, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3180, ACTION.CELEBRATE, { duration: 580 }),
      victory(3180),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'golden_crown',
    name: 'Golden Crown',
    encounterMode: M.SUMMON_ONLY,
    description: 'A crown beam picks the runner out; the rivals watch it choose somebody else and the light pushes them off the ground as it spreads.',
    beats: [
      'The runner raises their hands',
      'A beam comes down onto them and the rivals turn to look',
      'Golden rings push out from where it landed',
      'The light takes the ground and the rivals give way to it',
    ],
    duration: 3520,
    sequence: [
      attacker(150, ACTION.RAISE_ARMS),
      environment(420, E.DARKEN, { duration: 900, opacity: 0.28 }),
      projectile(520, 'magical_projectile_01', 'screenTop', 'characterHead', {
        duration: 320, size: 150, speed: 1.5,
      }),
      scatter(640, NOTICE_POOL, { stagger: 85, duration: 380, from: 'characterFeet' }),
      effect(860, 'radiant_heal_01', { anchor: 'characterFeet', size: 250 }),
      environment(860, E.FLASH, { duration: 320, opacity: 0.6, color: '#FFF3C4' }),
      haptic(860, 'success'),
      camera(880, CAMERA_ACTION.ZOOM_IN, { amount: 1.07, duration: 500 }),
      reveal(960, { transition: T.SPREAD_FROM_CENTER, origin: S.CHARACTER_FEET, duration: 1000 }),
      effect(1120, 'sunburn_ring_01', { anchor: S.TERRITORY_CENTER, size: 300, speed: 1.3 }),
      // Pushed back by the light rather than knocked over by a person.
      defenders(1200, ACTION.HOP_BACK, { from: 'characterFeet' }),
      defenders(1700, ACTION.WINCE),
      effect(1700, 'spectral_bloom_01', { anchor: 'characterHead', size: 200, opacity: 0.75 }),
      camera(1900, CAMERA_ACTION.RELEASE, { duration: 400 }),
      scatter(2140, [ACTION.FLEE_FROM, ACTION.RUN_LEFT, ACTION.FLEE_FROM], {
        stagger: 70, duration: 700, from: 'characterFeet',
      }),
      attacker(2280, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2920, ACTION.CELEBRATE, { duration: 580 }),
      victory(2920),
    ],
  }),

  // -------------------------------------------------------------------------
  // GHOST THEFT — the quiet one. Nothing detonates and nobody is thrown; the
  // rivals watch their own colour lift off the ground and walk away from it.
  // -------------------------------------------------------------------------
  scene({
    id: 'ghost_theft',
    name: 'Ghost Theft',
    encounterMode: M.TERRITORY_ONLY,
    description: 'No impact anywhere: the rivals watch their own colour lift off the ground like a ghost, and quietly give it up.',
    beats: [
      'The runner reaches for the ground',
      'A ghost of the old colour lifts out of it',
      'The rivals watch their own claim leave',
      'The shape dissolves into its new ownership and they turn away',
    ],
    duration: 3480,
    sequence: [
      attacker(160, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(340, ACTION.CAST, { hold: true }),
      camera(520, CAMERA_ACTION.ZOOM_IN, { amount: 1.05, duration: 420 }),
      effect(620, 'spectral_bloom_01', { anchor: S.TERRITORY_CENTER, size: 260, speed: 0.8 }),
      // They look DOWN, at their own ground. No threat, no scatter.
      scatter(760, [ACTION.NOTICE, ACTION.LOOK_LEFT, ACTION.NOTICE], {
        stagger: 100, duration: 400, from: S.TERRITORY_CENTER,
      }),
      reveal(1180, { transition: T.DISSOLVE, origin: S.TERRITORY_CENTER, duration: 1100 }),
      environment(1220, E.PULL_FIELD, { anchor: 'screenTop', size: 260, duration: 1000, count: 8 }),
      defenders(1380, ACTION.WINCE),
      effect(1500, 'magic_infinity_01', { anchor: S.TERRITORY_TOP, size: 190, opacity: 0.7 }),
      haptic(1740, 'light'),
      defenders(1820, ACTION.SHAKE_OFF),
      camera(2280, CAMERA_ACTION.RELEASE, { duration: 320 }),
      scatter(2460, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT], {
        stagger: 90, duration: 620,
      }),
      attacker(2340, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2980, ACTION.CELEBRATE, { duration: 480 }),
      victory(2980),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'ufo_abduction',
    name: 'UFO Abduction',
    encounterMode: M.SUMMON_ONLY,
    description: 'A saucer beam picks the rivals up off the claim, holds them, and puts the ground back down under new ownership.',
    beats: [
      'The runner signals something overhead',
      'A saucer glow settles over the rivals',
      'The beam lifts them off the ground',
      'The old territory goes up with them and comes back down claimed',
    ],
    duration: 3640,
    sequence: [
      attacker(150, ACTION.POINT_SKY, { toward: 'screenTop' }),
      effect(420, 'sunburn_ring_01', { anchor: 'screenTop', size: 250, speed: 0.8 }),
      environment(460, E.DARKEN, { duration: 1000, opacity: 0.3 }),
      defenders(620, ACTION.LOOK_UP),
      projectile(880, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', {
        duration: 360, size: 160, grow: 1.4,
      }),
      camera(1080, CAMERA_ACTION.WHIP_UP, { duration: 240 }),
      scatter(1080, [ACTION.SURPRISED, ACTION.DUCK, ACTION.SURPRISED], {
        stagger: 70, duration: 420, from: 'screenTop',
      }),
      environment(1300, E.SWEEP_BAND, {
        anchor: 'defenderGroupCenter', size: 220, duration: 1100, axis: 'y', opacity: 0.4, color: '#CFF6FF',
      }),
      haptic(1520, 'medium'),
      reveal(1600, { transition: T.DISSOLVE, origin: S.TERRITORY_TOP, duration: 900 }),
      // Lifted, not thrown. The beam is the exit.
      defenders(1640, ACTION.PORTAL_EXIT, { toward: 'screenTop' }),
      effect(1900, 'spectral_bloom_01', { anchor: S.TERRITORY_CENTER, size: 270 }),
      attacker(2340, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2980, ACTION.CELEBRATE, { duration: 620 }),
      victory(2980),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'ink_flood',
    name: 'Ink Flood',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'A cloud opens over the claim and the drops get heavier until the rivals are wading; the pools join at the border and flood inward.',
    beats: [
      'The runner throws a cloud up over the claim',
      'The first drops land and the rivals look up',
      'The barrage gets heavier and they are driven off the ground',
      'Pools join along the border and flood inward',
    ],
    duration: 3880,
    sequence: [
      attacker(150, ACTION.THROW, { upward: true, toward: 'screenTop' }),
      effect(460, 'magic_bubbles_01', { anchor: 'screenTop', size: 270, speed: 1.1, opacity: 0.9 }),
      environment(520, E.DARKEN, { duration: 1400, opacity: 0.24 }),
      defenders(640, ACTION.LOOK_UP),
      // Accelerating: the gaps shrink, so the barrage builds instead of ticking.
      projectile(760, 'magical_projectile_01', 'screenTop', 'randomTerritoryPoint', { duration: 220, size: 90 }),
      projectile(880, 'magical_projectile_01', 'screenTop', 'defenderGroupCenter', { duration: 210, size: 100 }),
      projectile(980, 'magical_projectile_01', 'screenTop', 'randomTerritoryPoint', { duration: 200, size: 115 }),
      scatter(1080, [ACTION.DUCK, ACTION.WINCE, ACTION.DODGE_RIGHT], {
        stagger: 70, duration: 420, from: 'screenTop',
      }),
      projectile(1180, 'magical_projectile_01', 'screenTop', 'nearestDefender', { duration: 190, size: 125 }),
      camera(1300, CAMERA_ACTION.TILT, { amount: 1.5, duration: 400 }),
      attacker(1400, ACTION.BRACE),
      defenders(1660, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
      reveal(1820, { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER, duration: 1000 }),
      effect(2000, 'acid_splash_01', { anchor: 'randomTerritoryPoint', size: 240, speed: 1.5, opacity: 0.8 }),
      haptic(2200, 'success'),
      defenders(2420, ACTION.SHAKE_OFF),
      scatter(3060, FLIGHT_POOL, { stagger: 60, duration: 600, from: S.TERRITORY_CENTER }),
      attacker(2560, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3200, ACTION.CELEBRATE, { duration: 620 }),
      victory(3200),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'energy_pulse',
    name: 'Energy Pulse',
    encounterMode: M.ATTACKER_ONLY,
    description: 'A long wind-up in plain sight of everyone, then one clean pulse that clears the ground of them.',
    beats: [
      'The runner gathers an orb between their hands',
      'It grows, and the rivals back away from it',
      'They drive it into the ground',
      'One pulse crosses the claim and clears it',
    ],
    duration: 3600,
    sequence: [
      attacker(150, ACTION.CHARGE),
      effect(240, 'blue_fire_01', { anchor: 'characterCenter', size: 170, speed: 0.9 }),
      // They can see it building. Backing off is the anticipation.
      scatter(560, NOTICE_POOL, { stagger: 80, duration: 380, from: 'characterCenter' }),
      effect(640, 'magic_infinity_01', { anchor: 'characterCenter', size: 220, speed: 0.8 }),
      camera(300, CAMERA_ACTION.ZOOM_IN, { amount: 1.1, duration: 700 }),
      defenders(1120, ACTION.HOP_BACK, { from: 'characterCenter' }),
      pause(1000, 160),
      attacker(1160, ACTION.SLAM, { toward: S.TERRITORY_CENTER }),
      effect(1300, 'frost_nova_01', { anchor: S.TERRITORY_CENTER, size: 320, speed: 1.35 }),
      environment(1300, E.FLASH, { duration: 300, opacity: 0.6, color: '#BFE9FF' }),
      haptic(1300, 'heavy'),
      shake(1310, { intensity: 1.2, axis: 'both' }),
      camera(1320, CAMERA_ACTION.RELEASE, { duration: 260 }),
      defenders(1620, ACTION.SHOCKWAVE_KNOCKBACK, { from: 'characterFeet' }),
      reveal(1560, { transition: T.SHOCKWAVE, origin: S.CHARACTER_FEET, duration: 820 }),
      effect(1740, 'electric_burst_01', { anchor: S.TERRITORY_TOP, size: 220, opacity: 0.8 }),
      attacker(1600, ACTION.RECOIL),
      scatter(2460, FLIGHT_POOL, { stagger: 70, duration: 640, from: 'characterFeet' }),
      attacker(2300, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2940, ACTION.CELEBRATE, { duration: 620 }),
      victory(2940),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'card_flip',
    name: 'Card Flip',
    encounterMode: M.TERRITORY_ONLY,
    description: 'The claim freezes into a deck and flips row by row; the rivals ride the cards they are standing on and are tipped off the far edge.',
    beats: [
      'The runner freezes the claim into a deck',
      'The rivals feel the ground stop being ground',
      'The flip rolls down in rows and tips them over',
      'The last card lands face up for its new owner',
    ],
    duration: 3400,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.CAST),
      camera(480, CAMERA_ACTION.FREEZE, { duration: 240 }),
      pause(480, 240),
      effect(560, 'magic_spell_01', { anchor: S.TERRITORY_TOP, size: 190 }),
      scatter(720, [ACTION.SURPRISED, ACTION.NOTICE, ACTION.LOOK_RIGHT], {
        stagger: 90, duration: 400, from: S.TERRITORY_TOP,
      }),
      reveal(1120, { transition: T.FLIP_REVEAL, origin: S.TERRITORY_TOP, duration: 900 }),
      environment(1160, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 320, duration: 900, axis: 'y', opacity: 0.3 }),
      // Tipped over in the order the rows reach them.
      scatter(1180, [ACTION.STUMBLE_LEFT, ACTION.FALL_AND_RECOVER, ACTION.STUMBLE_RIGHT], {
        stagger: 150, duration: 560,
      }),
      effect(1600, 'magic_spell_01', { anchor: S.TERRITORY_BOTTOM, size: 210 }),
      haptic(1900, 'success'),
      camera(1920, CAMERA_ACTION.PUNCH_IN, { amount: 1.04 }),
      scatter(2140, [ACTION.RUN_RIGHT, ACTION.RUN_LEFT, ACTION.RUN_RIGHT], {
        stagger: 80, duration: 620,
      }),
      attacker(2120, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2760, ACTION.CELEBRATE, { duration: 620 }),
      victory(2760),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'paper_tear',
    name: 'Paper Tear',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'The map surface tears from one edge and peels away; the rivals scramble as the layer they were standing on is pulled out from under them.',
    beats: [
      'The runner takes hold of the map surface',
      'A tear opens at the top edge',
      'The seam travels and the rivals scramble on the moving layer',
      'The old surface peels away and takes them with it',
    ],
    duration: 3520,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.PLANT),
      effect(560, 'arcane_parry_01', { anchor: S.TERRITORY_TOP, size: 200 }),
      camera(680, CAMERA_ACTION.TILT, { amount: -1.6, duration: 260 }),
      scatter(700, NOTICE_POOL, { stagger: 85, duration: 380, from: S.TERRITORY_TOP }),
      reveal(1060, { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 1000 }),
      environment(1100, E.CRACKS, { anchor: S.TERRITORY_TOP, size: 320, duration: 700, count: 5 }),
      scatter(1120, SCATTER_ON_GROUND, { stagger: 90, duration: 440, from: S.TERRITORY_TOP }),
      effect(1500, 'solar_shrapnel_01', { anchor: S.TERRITORY_BOTTOM, size: 210, opacity: 0.8 }),
      haptic(1700, 'medium'),
      shake(1710, { intensity: 0.9, axis: 'x' }),
      // Dragged off with the layer they were standing on.
      defenders(1740, ACTION.SLIDE_TOWARD, { toward: S.TERRITORY_TOP }),
      scatter(2500, [ACTION.PORTAL_EXIT, ACTION.FLEE_FROM, ACTION.RUN_LEFT], {
        stagger: 60, duration: 620, from: S.TERRITORY_CENTER, toward: S.TERRITORY_TOP,
      }),
      attacker(2240, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2880, ACTION.CELEBRATE, { duration: 620 }),
      victory(2880),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'construction_crew',
    name: 'Construction Crew',
    encounterMode: M.SUMMON_ONLY,
    description: 'Work lights mark out three zones and a crew converts them in sequence; the rivals are politely and firmly moved off the site.',
    beats: [
      'The runner marks out the site',
      'Work lights come on around the rivals',
      'The crew converts each zone in turn and moves them along',
      'A final inspection signs off the whole grid',
    ],
    duration: 3660,
    sequence: [
      attacker(150, ACTION.STEP_FORWARD, { duration: 150 }),
      attacker(320, ACTION.RAISE_ARMS),
      effect(520, 'radiant_heal_01', { anchor: S.TERRITORY_TOP, size: 150 }),
      scatter(660, [ACTION.LOOK_LEFT, ACTION.NOTICE, ACTION.LOOK_RIGHT], {
        stagger: 90, duration: 360, from: S.TERRITORY_TOP,
      }),
      effect(880, 'radiant_heal_01', { anchor: 'randomTerritoryPoint', size: 170 }),
      environment(940, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 900, steps: 3 }),
      effect(1180, 'radiant_heal_01', { anchor: S.TERRITORY_BOTTOM, size: 190 }),
      // Moved along zone by zone rather than blown away.
      scatter(1040, [ACTION.HOP_BACK, ACTION.HOP_BACK, ACTION.STUMBLE_LEFT], {
        stagger: 150, duration: 460, from: S.TERRITORY_TOP,
      }),
      reveal(1560, { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 900 }),
      defenders(1840, ACTION.SLIDE_TOWARD, { toward: 'perimeter' }),
      effect(2100, 'impact_shock_01', { anchor: S.TERRITORY_CENTER, size: 220 }),
      haptic(2160, 'success'),
      camera(2180, CAMERA_ACTION.PUNCH_IN, { amount: 1.05 }),
      scatter(2620, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.RUN_LEFT], {
        stagger: 70, duration: 620,
      }),
      attacker(2380, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3020, ACTION.CELEBRATE, { duration: 620 }),
      victory(3020),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'lucky_duck',
    name: 'Lucky Duck',
    encounterMode: M.SUMMON_ONLY,
    description: 'A lucky duck drops into the middle of the rivals, bobs once, and bounces every one of them off the claim.',
    beats: [
      'The runner tosses something small and yellow',
      'The rivals track it down and it lands between them',
      'It bobs once, and everybody bounces',
      'A ring of ownership rolls out from where it settled',
    ],
    duration: 3420,
    sequence: [
      attacker(150, ACTION.THROW, { toward: 'defenderGroupCenter' }),
      effect(400, 'magic_bubbles_01', { anchor: 'screenTop', size: 190 }),
      projectile(470, 'radiant_heal_01', 'screenTop', 'defenderGroupCenter', {
        duration: 380, size: 120, arc: -60, spin: 90,
        bounce: { height: 34, duration: 300, drift: 10 },
      }),
      scatter(620, [ACTION.LOOK_UP, ACTION.NOTICE, ACTION.LOOK_UP], {
        stagger: 70, duration: 340, from: 'screenTop',
      }),
      effect(880, 'magic_bubbles_01', { anchor: 'defenderGroupCenter', size: 220 }),
      pause(880, 260),
      haptic(1160, 'success'),
      shake(1170, { intensity: 0.7, axis: 'y' }),
      // Everybody goes up. Nobody is hurt. That is the joke.
      defenders(1180, ACTION.BOUNCE_REACTION),
      reveal(1300, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 820 }),
      effect(1500, 'nebula_burst_01', { anchor: S.TERRITORY_CENTER, size: 260, speed: 1.2 }),
      defenders(1700, ACTION.SHAKE_OFF),
      scatter(2340, [ACTION.RUN_LEFT, ACTION.RUN_RIGHT, ACTION.FLEE_FROM], {
        stagger: 70, duration: 620, from: 'defenderGroupCenter',
      }),
      attacker(2140, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2780, ACTION.CELEBRATE, { duration: 620 }),
      victory(2780),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'disco_capture',
    name: 'Disco Capture',
    encounterMode: M.SUMMON_ONLY,
    description: 'Nobody collides: a disco light sweeps between the runner and the rivals until the floor itself joins in and dances them off it.',
    beats: [
      'The runner starts the music',
      'A light sweeps between both sides',
      'The floor flashes in rhythm and the rivals are dancing whether they like it or not',
      'The last beat locks the colour in',
    ],
    duration: 3480,
    sequence: [
      attacker(150, ACTION.RAISE_ARMS),
      effect(420, 'spectral_bloom_01', { anchor: S.TERRITORY_TOP, size: 210 }),
      scatter(600, NOTICE_POOL, { stagger: 80, duration: 380, from: S.TERRITORY_TOP }),
      projectile(760, 'magical_projectile_01', S.TERRITORY_TOP, S.TERRITORY_BOTTOM, {
        duration: 420, size: 120, spin: 240,
      }),
      environment(860, E.SWEEP_BAND, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1000, opacity: 0.4 }),
      // Bouncing, in a staggered wave, because a dance floor is a wave.
      scatter(1000, [ACTION.BOUNCE_REACTION, ACTION.BOUNCE_REACTION, ACTION.GLITCH_JUMP], {
        stagger: 130, duration: 460,
      }),
      reveal(1360, { transition: T.ELECTRIFY, origin: S.TERRITORY_TOP, duration: 900 }),
      effect(1600, 'nebula_burst_01', { anchor: S.TERRITORY_BOTTOM, size: 260 }),
      haptic(1860, 'success'),
      camera(1880, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
      defenders(1900, ACTION.HOP_BACK, { from: S.TERRITORY_CENTER }),
      scatter(2400, [ACTION.RUN_RIGHT, ACTION.FLEE_FROM, ACTION.RUN_LEFT], {
        stagger: 70, duration: 620, from: S.TERRITORY_CENTER,
      }),
      attacker(2200, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2840, ACTION.CELEBRATE, { duration: 620 }),
      victory(2840),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'mech_drop',
    name: 'Mech Drop',
    encounterMode: M.SUMMON_ONLY,
    description: 'Something heavy drops feet first into the claim; the rivals see the shadow, scatter, and the stabiliser blast finishes the job.',
    beats: [
      'The runner calls the drop in',
      'A shadow squares up on the ground and the rivals run for it',
      'The mech lands feet first',
      'Stabilisers fire and the claim converts under the blast',
    ],
    duration: 3540,
    sequence: [
      attacker(150, ACTION.POINT_SKY, { toward: 'screenTop' }),
      effect(400, 'impact_shock_01', { anchor: 'screenTop', size: 170, opacity: 0.75 }),
      environment(460, E.SHADOW, { anchor: S.TERRITORY_CENTER, size: 280, duration: 700, opacity: 0.55 }),
      defenders(600, ACTION.LOOK_UP),
      projectile(880, 'solar_shrapnel_01', 'screenTop', S.TERRITORY_CENTER, {
        duration: 300, size: 170, grow: 1.8,
      }),
      scatter(1040, [ACTION.DODGE_LEFT, ACTION.DODGE_RIGHT, ACTION.DUCK], {
        stagger: 55, duration: 300, from: S.TERRITORY_CENTER,
      }),
      effect(1180, 'earth_rupture_01', { anchor: S.TERRITORY_CENTER, size: 290 }),
      haptic(1180, 'heavy'),
      shake(1190, { intensity: 1.4, axis: 'y' }),
      camera(1200, CAMERA_ACTION.PUNCH_IN, { amount: 1.14 }),
      environment(1200, E.DUST, { anchor: S.TERRITORY_CENTER, size: 300, duration: 1200, count: 8 }),
      defenders(1460, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_CENTER }),
      reveal(1420, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 800 }),
      environment(1500, E.WIND, { duration: 800, count: 8 }),
      defenders(2300, ACTION.WINCE),
      scatter(2740, FLIGHT_POOL, { stagger: 60, duration: 620, from: S.TERRITORY_CENTER }),
      attacker(2200, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2840, ACTION.CELEBRATE, { duration: 620 }),
      victory(2840),
    ],
  }),

  // -------------------------------------------------------------------------
  // ANGEL VS DEMON — the second and last duel. Auras charge on both sides,
  // the two actually collide, and the winning wave rewrites the ground.
  // -------------------------------------------------------------------------
  scene({
    id: 'angel_vs_demon',
    name: 'Angel vs Demon',
    encounterMode: M.DUEL,
    description: 'The second style built on contact: opposing auras charge, the runner and the nearest rival collide, and the winning wave rewrites the claim.',
    beats: [
      'Opposing auras charge on both sides',
      'The runner and the nearest rival commit to each other',
      'They collide and the energy holds at the point of contact',
      'The runner wave wins and electrifies the ground',
    ],
    duration: 3860,
    sequence: [
      attacker(150, ACTION.CHARGE),
      effect(200, 'radiant_heal_01', { anchor: 'characterCenter', size: 200 }),
      effect(360, 'vortex_red_01', { anchor: 'nearestDefender', size: 210 }),
      actor({ role: ROLE.DEFENDER, target: 'nearest', start: 420, action: ACTION.BRACE, from: 'characterCenter' }),
      actor({ role: ROLE.DEFENDER, target: 'furthest', start: 940, action: ACTION.HOP_BACK, from: 'characterCenter' }),
      attacker(960, ACTION.DASH_FORWARD, { toward: 'nearestDefender' }),
      contact(1120, { variant: 'bonk', target: 'nearest' }),
      pause(1380, 180),
      effect(1560, 'spectral_bloom_01', { anchor: 'nearestDefender', size: 280 }),
      environment(1560, E.FLASH, { duration: 300, opacity: 0.6, color: '#FFE6FF' }),
      haptic(1560, 'heavy'),
      shake(1570, { intensity: 1.2, axis: 'both' }),
      camera(1580, CAMERA_ACTION.PUNCH_IN, { amount: 1.12 }),
      actor({ role: ROLE.DEFENDER, target: 'nearest', start: 1600, action: ACTION.SHOCKWAVE_KNOCKBACK, from: 'characterCenter' }),
      actor({ role: ROLE.DEFENDER, target: 'furthest', start: 2440, action: ACTION.STUMBLE_RIGHT }),
      reveal(1740, { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER, duration: 860 }),
      attacker(1460, ACTION.RECOIL),
      scatter(3020, FLIGHT_POOL, { stagger: 70, duration: 640, from: 'characterCenter' }),
      attacker(2260, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2900, ACTION.CELEBRATE, { duration: 620 }),
      victory(2900),
    ],
  }),

  // -------------------------------------------------------------------------
  scene({
    id: 'reality_rewrite',
    name: 'Reality Rewrite',
    encounterMode: M.TERRAIN_TRANSFORM,
    description: 'Two anchors are cast to opposite edges and joined; everything between them, rivals included, is rewritten.',
    beats: [
      'The runner casts an anchor to each edge',
      'The rivals watch the line connect around them',
      'A rewrite rune fires between the anchors',
      'Reality breaks into pixels and reforms under its new owner',
    ],
    duration: 3620,
    sequence: [
      attacker(150, ACTION.CAST, { side: 'left', duration: 360 }),
      effect(300, 'magic_spell_01', { anchor: S.TERRITORY_TOP, size: 190, speed: 1.3 }),
      attacker(520, ACTION.CAST, { side: 'right', duration: 360 }),
      effect(660, 'magic_spell_01', { anchor: S.TERRITORY_BOTTOM, size: 190, speed: 1.3 }),
      scatter(760, NOTICE_POOL, { stagger: 85, duration: 380, from: S.TERRITORY_TOP }),
      attacker(900, ACTION.CHARGE, { duration: 480 }),
      projectile(1020, 'magical_projectile_01', S.TERRITORY_TOP, S.TERRITORY_BOTTOM, {
        duration: 300, size: 150, speed: 1.5,
      }),
      defenders(1320, ACTION.RESIST_PULL, { toward: S.TERRITORY_CENTER }),
      effect(1420, 'arcane_parry_01', { anchor: S.TERRITORY_CENTER, size: 260, speed: 1.2 }),
      environment(1420, E.FLASH, { duration: 280, opacity: 0.55, color: '#C79BFF' }),
      haptic(1420, 'medium'),
      shake(1430, { intensity: 0.8, axis: 'both' }),
      attacker(1440, ACTION.RECOIL),
      environment(1500, E.SCANLINE, { anchor: S.TERRITORY_CENTER, size: 300, duration: 800, steps: 7 }),
      reveal(1560, { transition: T.PIXEL_REFORM, origin: S.TERRITORY_CENTER, duration: 900 }),
      defenders(2100, ACTION.GLITCH_JUMP),
      defenders(2580, ACTION.PORTAL_EXIT, { toward: S.TERRITORY_CENTER }),
      attacker(2280, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(2920, ACTION.CELEBRATE, { duration: 620 }),
      victory(2920),
    ],
  }),

  // -------------------------------------------------------------------------
  // DRAGON SWEEP — new, and built entirely out of primitives: the dragon is a
  // shadow crossing the ground and a band of fire following it. No new art,
  // and it is the clearest possible demonstration that the narrative does the
  // work rather than the sprite sheet.
  // -------------------------------------------------------------------------
  scene({
    id: 'dragon_sweep',
    name: 'Dragon Sweep',
    encounterMode: M.SUMMON_ONLY,
    description: 'A shadow crosses the ground before anything else happens; the rivals scatter ahead of the breath that follows it across the claim.',
    beats: [
      'A shadow crosses the ground and the rivals look up',
      'They break and run ahead of it',
      'The breath sweeps the length of the claim',
      'The smoke clears onto ground that has changed hands',
    ],
    duration: 4080,
    sequence: [
      attacker(150, ACTION.POINT_SKY, { toward: 'screenTop' }),
      // The shadow comes FIRST. Nothing else is on screen yet.
      environment(360, E.SHADOW_SWEEP, { anchor: S.TERRITORY_CENTER, size: 320, duration: 1100 }),
      environment(420, E.DARKEN, { duration: 1300, opacity: 0.3 }),
      defenders(620, ACTION.LOOK_UP),
      scatter(1060, NOTICE_POOL, { stagger: 80, duration: 400, from: 'screenTop' }),
      effect(1300, 'fire_column_01', { anchor: S.TERRITORY_TOP, size: 230, speed: 1.3 }),
      // Running AHEAD of the sweep, not away from a person.
      scatter(1640, [ACTION.HOP_BACK, ACTION.DODGE_LEFT, ACTION.DUCK], {
        stagger: 90, duration: 420, from: S.TERRITORY_TOP,
      }),
      environment(1600, E.SWEEP_BAND, {
        anchor: S.TERRITORY_CENTER, size: 340, duration: 1100, opacity: 0.65, color: '#FF8A3D',
      }),
      attacker(1700, ACTION.BRACE),
      haptic(1900, 'heavy'),
      shake(1910, { intensity: 1.2, axis: 'x' }),
      effect(1940, 'fire_spin_01', { anchor: S.TERRITORY_CENTER, size: 300, speed: 1.2 }),
      camera(1960, CAMERA_ACTION.PUNCH_IN, { amount: 1.1 }),
      defenders(2260, ACTION.SHOCKWAVE_KNOCKBACK, { from: S.TERRITORY_TOP }),
      reveal(2120, { transition: T.BURN_SPREAD, origin: S.TERRITORY_TOP, duration: 950 }),
      environment(2160, E.DUST, {
        anchor: S.TERRITORY_CENTER, size: 320, duration: 1400, count: 9, color: '#4A3A32',
      }),
      environment(2400, E.SHADOW_SWEEP, { anchor: S.TERRITORY_CENTER, size: 300, duration: 900, reverse: true }),
      scatter(3100, FLIGHT_POOL, { stagger: 60, duration: 620, from: S.TERRITORY_TOP }),
      attacker(2700, ACTION.MOVE_TO, { toward: S.TERRITORY_CENTER }),
      attacker(3340, ACTION.CELEBRATE, { duration: 620 }),
      victory(3340),
    ],
  }),
]);

export const DEFAULT_CAPTURE_STYLE_ID = 'meteor_claim';

// Old ids may exist in persisted dev replays and gallery deep links. Resolve
// them to the closest new scene without keeping duplicate styles in the pool.
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
