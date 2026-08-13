// Capture styles are mini-scenes, not effect palettes.
//
// `encounterMode` decides the scene skeleton before anything appears. Only a
// DUEL mounts CaptureEncounter's attacker/defender contact choreography. Every
// other style starts CaptureStylePlayer in its place, so a projectile, terrain
// conversion or summoned object can be the cause of the takeover.

import {
  ACTOR_ACTION,
  ARCHETYPES,
  CAMERA_ACTION,
  ENCOUNTER_MODE,
  REVEAL_ORIGIN,
  REVEAL_TRANSITION,
  actor,
  camera,
  choreographyProfile,
  choreographySignature,
  effect,
  haptic,
  pause,
  projectile,
  reveal,
  shake,
} from './choreography';

const sort = (steps) => [...steps].sort((a, b) => a.start - b.start);

function scene({
  id,
  name,
  encounterMode,
  showAttacker,
  // On occupied ground the rival remains part of the mini-scene by default.
  // Their response is driven by the takeover transition in the player; this
  // does not opt the style into duel/collision choreography.
  showDefender = true,
  description,
  beats,
  duration,
  sequence,
  archetype = `scene:${id}`,
}) {
  const ordered = sort(sequence);
  const ground = ordered.find((step) => step.action === 'territoryReveal');
  return Object.freeze({
    id,
    name,
    archetype,
    description,
    beats: Object.freeze(beats),
    encounterMode,
    showAttacker: !!showAttacker,
    showDefender: !!showDefender,
    usesProjectile: ordered.some((step) => step.action === 'projectile'),
    territoryTransition: ground?.transition || REVEAL_TRANSITION.SPREAD_FROM_CENTER,
    revealOrigin: ground?.origin || REVEAL_ORIGIN.TERRITORY_CENTER,
    duration,
    sequence: Object.freeze(ordered),
  });
}

function archetypeScene(config, archetype, paint, tune, revealOverride = {}) {
  const built = ARCHETYPES[archetype](paint, tune);
  return scene({
    ...config,
    archetype,
    duration: built.duration,
    sequence: built.sequence.map((step) => (
      step.action === 'territoryReveal' ? { ...step, ...revealOverride } : step
    )),
  });
}

const S = REVEAL_ORIGIN;
const T = REVEAL_TRANSITION;
const M = ENCOUNTER_MODE;

export const CAPTURE_STYLES = Object.freeze([
  archetypeScene({
    id: 'meteor_claim', name: 'Meteor Claim', encounterMode: M.PROJECTILE,
    showAttacker: true,
    description: 'The runner spots a forming meteor; its fragments fall and the final strike claims the ground.',
    beats: ['Look up as a meteor forms', 'Fragments rain onto separate tiles', 'The final meteor hits', 'A shockwave converts the territory'],
  }, 'fallingObjects', {
    form: 'sunburn_ring_01', crack: 'solar_shrapnel_01', shard: 'solar_shrapnel_01', strike: 'warm_explosion_01',
  }, { form: 440, stagger: 120 }, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER }),

  scene({
    id: 'neon_grid_hack', name: 'Neon Grid Hack', encounterMode: M.TERRITORY_ONLY,
    showAttacker: false,
    description: 'A scanline enters from the edge, selects tiles, then snaps the hacked grid into the new colour.',
    beats: ['A neon scanline enters from below', 'Grid cells unlock in rows', 'The last row flashes', 'Tiles snap to the new owner'],
    duration: 1700,
    sequence: [
      effect(0, 'magic_infinity_01', { anchor: 'screenBottom', size: 290, speed: 1.4 }),
      camera(180, CAMERA_ACTION.TILT, { amount: 2, duration: 280 }),
      reveal(360, { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 760 }),
      effect(620, 'electric_burst_01', { anchor: 'territoryTop', size: 230, speed: 1.5 }),
      haptic(980, 'medium'),
      camera(1000, CAMERA_ACTION.PUNCH_IN, { amount: 1.06 }),
    ],
  }),

  scene({
    id: 'kings_banner', name: 'King’s Banner', encounterMode: M.ATTACKER_ONLY,
    showAttacker: true,
    description: 'The runner plants a royal standard; the planted point becomes the first owned tile and the banner’s claim spreads.',
    beats: ['The runner kneels with the banner', 'The pole strikes the ground', 'Ownership spreads from the planted flag', 'A crown flare seals the claim'],
    duration: 1900,
    sequence: [
      actor(0, ACTOR_ACTION.PLANT),
      effect(300, 'radiant_heal_01', { anchor: 'characterFeet', size: 190 }),
      reveal(420, { transition: T.SPREAD_FROM_CENTER, origin: S.CHARACTER_FEET, duration: 820 }),
      haptic(620, 'success'),
      effect(800, 'sunburn_ring_01', { anchor: 'territoryTop', size: 230 }),
      actor(700, ACTOR_ACTION.CELEBRATE),
    ],
  }),

  archetypeScene({
    id: 'paint_bomb', name: 'Paint Bomb', encounterMode: M.PROJECTILE,
    showAttacker: true,
    description: 'A paint charge is thrown, bounces once, pauses, then bursts colour across the claim.',
    beats: ['The runner lobs a paint charge', 'It arcs to the ground', 'A short fuse creates anticipation', 'The burst paints outward from the landing point'],
  }, 'projectileThrow', {
    charge: 'bomb_blast_01', blast: 'warm_explosion_01', smoke: 'magic_bubbles_01',
  }, { flight: 360, fuse: 260 }, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_BOTTOM }),

  archetypeScene({
    id: 'earth_crack', name: 'Earth Crack', encounterMode: M.ATTACKER_ONLY,
    showAttacker: true,
    description: 'The runner jumps, hangs, then slams down; glowing fissures race out from their fists.',
    beats: ['The runner jumps', 'A held beat builds weight', 'Both fists hit the ground', 'Glowing cracks split and recolour the territory'],
  }, 'jumpSlam', {
    impact: 'impact_shock_01', debris: 'earth_rupture_01',
  }, { hang: 240 }, { transition: T.CRACK_GLOW, origin: S.CHARACTER_FEET }),

  archetypeScene({
    id: 'black_hole', name: 'Black Hole', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'A gravity well pulls the runner and loose ground inward, holds in silence, then reforms the territory from the void.',
    beats: ['A gravity well opens', 'The runner and debris are pulled inward', 'Everything holds still', 'The collapsed ground dissolves back under the new owner'],
  }, 'implosion', {
    well: 'vortex_red_01', debris: 'magic_infinity_01', collapse: 'void_implosion_01',
  }, { pull: 620, silence: 260 }, { transition: T.DISSOLVE, origin: S.TERRITORY_CENTER }),

  archetypeScene({
    id: 'lightning_conquest', name: 'Lightning Conquest', encounterMode: M.PROJECTILE,
    showAttacker: true,
    description: 'The runner braces beneath a charging sky; one bolt travels down and electrifies the whole claim.',
    beats: ['The runner braces', 'Cloud charge gathers overhead', 'A bolt travels to the claim', 'Electric branches convert every connected tile'],
  }, 'skyStrike', {
    charge: 'electric_burst_01', bolt: 'magical_projectile_01', impact: 'electric_impact_01', residue: 'solar_shrapnel_01',
  }, { charge: 240, travel: 210 }, { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER }),

  scene({
    id: 'sword_slash', name: 'Sword Slash', encounterMode: M.DUEL,
    showAttacker: true, showDefender: true,
    description: 'The two runners square up; the attacker crosses the defender and the completed slash tears the territory open.',
    beats: ['Attacker and defender face off', 'The attacker crosses the defender', 'A slash line hangs for one beat', 'The cut tears the territory into the new colour'],
    duration: 1800,
    sequence: [
      effect(120, 'magical_projectile_01', { anchor: 'territoryTop', size: 180, speed: 1.5 }),
      camera(360, CAMERA_ACTION.PUNCH_IN, { amount: 1.08 }),
      pause(460, 160),
      reveal(620, { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 640 }),
      effect(720, 'arcane_parry_01', { anchor: 'territoryBottom', size: 250, speed: 1.3 }),
      haptic(760, 'medium'),
    ],
  }),

  archetypeScene({
    id: 'portal_takeover', name: 'Portal Takeover', encounterMode: M.SUMMON_ONLY,
    showAttacker: true,
    description: 'A portal opens below the runner, delivers the new territory through its doorway, then folds shut.',
    beats: ['The runner steps clear', 'A portal opens under the claim', 'New ground pours through the doorway', 'The portal folds itself away'],
  }, 'portalDelivery', {
    portal: 'vortex_red_01', through: 'spectral_bloom_01', fold: 'void_implosion_01',
  }, { open: 400, close: 440 }, { transition: T.SPREAD_FROM_EDGE, origin: S.TERRITORY_BOTTOM }),

  archetypeScene({
    id: 'freeze_over', name: 'Freeze Over', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'The runner holds a cold channel while frost starts at the border and closes over the territory.',
    beats: ['The runner channels cold', 'The outer border frosts first', 'Ice closes inward without an impact', 'The frozen surface settles into the team colour'],
  }, 'channelSpread', {
    source: 'frost_nova_01', spread: 'freezing_bloom_01', crust: 'magic_bubbles_01',
  }, { spread: 900 }, { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER }),

  archetypeScene({
    id: 'lava_claim', name: 'Lava Claim', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'A stomp lights the border like a fuse; lava completes the lap and floods the middle.',
    beats: ['The runner stomps', 'A hot spark catches the perimeter', 'The lava ring completes a lap', 'The enclosed ground floods inward'],
  }, 'perimeterSweep', {
    spark: 'fire_spin_01', ring: 'fire_column_01', flood: 'warm_explosion_01',
  }, { lap: 760 }, { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER }),

  scene({
    id: 'stamp_of_ownership', name: 'Stamp of Ownership', encounterMode: M.ATTACKER_ONLY,
    showAttacker: true,
    description: 'The runner raises a giant stamp and brings it down once; the stamped cells become owned immediately.',
    beats: ['The runner winds up', 'A single giant stamp lands', 'The impression holds', 'Stamped tiles convert all at once'],
    duration: 1600,
    sequence: [
      actor(0, ACTOR_ACTION.STOMP),
      effect(280, 'impact_shock_01', { anchor: 'territoryVisualCenter', size: 280 }),
      shake(300, { intensity: 0.8, axis: 'y' }),
      reveal(380, { transition: T.TILE_CONVERT, origin: S.TERRITORY_CENTER, duration: 520 }),
      haptic(520, 'heavy'),
      effect(700, 'sunburn_ring_01', { anchor: 'territoryVisualCenter', size: 210 }),
    ],
  }),

  scene({
    id: 'orbital_strike', name: 'Orbital Strike', encounterMode: M.PROJECTILE,
    showAttacker: false,
    description: 'A target locks from above, an orbital beam descends, and its impact ring takes the territory.',
    beats: ['A target reticle locks on', 'The sky pauses over the marked point', 'An orbital beam travels down', 'The impact shockwave claims the ground'],
    duration: 1800,
    sequence: [
      effect(0, 'sunburn_ring_01', { anchor: 'territoryVisualCenter', size: 230 }),
      pause(260, 180),
      projectile(440, 'magical_projectile_01', 'screenTop', S.TERRITORY_CENTER, { duration: 260, size: 170 }),
      effect(700, 'electric_impact_01', { anchor: 'territoryVisualCenter', size: 300 }),
      reveal(760, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 560 }),
      haptic(700, 'heavy'),
      shake(720, { intensity: 1.3, axis: 'both' }),
    ],
  }),

  scene({
    id: 'domino_capture', name: 'Domino Capture', encounterMode: M.TERRITORY_ONLY,
    showAttacker: false,
    description: 'A first territory tile tips the next; a visible chain crosses the claim before the last tile locks ownership.',
    beats: ['The first tile tips', 'The chain travels through three points', 'The final tile pauses upright', 'All fallen tiles convert together'],
    duration: 1800,
    sequence: [
      effect(0, 'magic_spell_01', { anchor: 'territoryTop', size: 150 }),
      effect(190, 'magic_spell_01', { anchor: 'randomTerritoryPoint', size: 170 }),
      effect(380, 'magic_spell_01', { anchor: 'territoryBottom', size: 190 }),
      pause(560, 140),
      reveal(700, { transition: T.TILE_CONVERT, origin: S.TERRITORY_TOP, duration: 720 }),
      haptic(980, 'success'),
      effect(1020, 'radiant_heal_01', { anchor: 'territoryBottom', size: 220 }),
    ],
  }),

  archetypeScene({
    id: 'pixel_takeover', name: 'Pixel Takeover', encounterMode: M.TERRITORY_ONLY,
    showAttacker: true,
    description: 'Corruption climbs from off-screen, pixelates the runner and territory, then reassembles both under the new owner.',
    beats: ['Pixel noise climbs from below', 'The runner glitches with it', 'The territory breaks into blocks', 'Blocks snap back in the new colour'],
  }, 'corruption', {
    // Optional on purpose: older binaries do not carry this licensed sheet.
    // The style still pixel-reforms, snaps, reveals and completes without it.
    corrupt: 'glitch_portal_01', spread: 'magic_infinity_01', snap: 'electric_burst_01',
  }, { creep: 560 }, { transition: T.PIXEL_REFORM, origin: S.TERRITORY_BOTTOM }),

  archetypeScene({
    id: 'vine_overgrowth', name: 'Vine Overgrowth', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'The runner plants one seed; vines race toward the edges and flowers mark the completed takeover.',
    beats: ['The runner plants a seed', 'A sprout appears at their feet', 'Vines race outward along the ground', 'Flowers pop as the territory finishes changing'],
  }, 'plantGrowth', {
    sprout: 'radiant_heal_01', vines: 'spectral_bloom_01', pop: 'magic_bubbles_01', bloom: 'nebula_burst_01',
  }, { run: 840 }, { transition: T.SPREAD_FROM_CENTER, origin: S.CHARACTER_FEET }),

  archetypeScene({
    id: 'golden_crown', name: 'Golden Crown', encounterMode: M.SUMMON_ONLY,
    showAttacker: true,
    description: 'A crown beam chooses the runner; golden rings expand from their feet and the claimed land answers.',
    beats: ['The runner raises their hands', 'A crown beam descends onto them', 'Golden rings push across the claim', 'The territory lights from the chosen runner outward'],
  }, 'beamDown', {
    beam: 'magical_projectile_01', land: 'radiant_heal_01', rings: 'sunburn_ring_01', halo: 'spectral_bloom_01',
  }, { arrive: 320 }, { transition: T.SPREAD_FROM_CENTER, origin: S.CHARACTER_FEET }),

  scene({
    id: 'ghost_theft', name: 'Ghost Theft', encounterMode: M.TERRITORY_ONLY,
    showAttacker: false, showDefender: true,
    description: 'The defender watches their colour lift away like a ghost; the empty shape fades into its new ownership.',
    beats: ['The defender stands alone', 'A ghostly copy lifts from the ground', 'The old colour drains with it', 'The claim dissolves quietly into the new colour'],
    duration: 1900,
    sequence: [
      camera(0, CAMERA_ACTION.ZOOM_IN, { amount: 1.05, duration: 380 }),
      effect(120, 'spectral_bloom_01', { anchor: 'territoryVisualCenter', size: 260, speed: 0.8 }),
      reveal(420, { transition: T.DISSOLVE, origin: S.TERRITORY_CENTER, duration: 920 }),
      effect(720, 'magic_infinity_01', { anchor: 'territoryTop', size: 190, opacity: 0.7 }),
      haptic(920, 'light'),
      camera(1180, CAMERA_ACTION.RELEASE, { duration: 300 }),
    ],
  }),

  scene({
    id: 'ufo_abduction', name: 'UFO Abduction', encounterMode: M.SUMMON_ONLY,
    showAttacker: false, showDefender: true,
    description: 'A UFO beam selects the defender’s ground, lifts its old colour away, then drops the new territory back.',
    beats: ['A saucer glow appears overhead', 'A beam targets the defender', 'The old territory is lifted upward', 'New ownership materialises where it was'],
    duration: 2000,
    sequence: [
      effect(0, 'sunburn_ring_01', { anchor: 'screenTop', size: 260, speed: 0.8 }),
      projectile(260, 'magical_projectile_01', 'screenTop', S.TERRITORY_CENTER, { duration: 360, size: 160 }),
      camera(420, CAMERA_ACTION.WHIP_UP, { duration: 240 }),
      reveal(640, { transition: T.DISSOLVE, origin: S.TERRITORY_TOP, duration: 840 }),
      effect(760, 'spectral_bloom_01', { anchor: 'territoryVisualCenter', size: 270 }),
      haptic(980, 'medium'),
    ],
  }),

  archetypeScene({
    id: 'ink_flood', name: 'Ink Flood', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'The runner throws an ink cloud up; drops accelerate until connected pools flood the territory from its edge.',
    beats: ['The runner throws an ink cloud', 'Sparse drops become a barrage', 'Pools join along the boundary', 'Ink floods inward from the edge'],
  }, 'rainBarrage', {
    cloud: 'magic_bubbles_01', drop: 'magical_projectile_01', pool: 'acid_splash_01',
  }, { drops: 5, spacing: 120 }, { transition: T.SPREAD_FROM_EDGE, origin: S.PERIMETER }),

  archetypeScene({
    id: 'energy_pulse', name: 'Energy Pulse', encounterMode: M.ATTACKER_ONLY,
    showAttacker: true,
    description: 'The runner gathers a growing orb, drives it into the ground, and sends one clean energy pulse across the claim.',
    beats: ['Energy gathers between the runner’s hands', 'The orb grows during a held wind-up', 'The runner thrusts it into the ground', 'One pulse converts the territory'],
  }, 'chargeRelease', {
    gather: 'blue_fire_01', orb: 'magic_infinity_01', nova: 'frost_nova_01', wake: 'electric_burst_01',
  }, { wind: 720 }, { transition: T.SHOCKWAVE, origin: S.CHARACTER_FEET }),

  scene({
    id: 'card_flip', name: 'Card Flip', encounterMode: M.TERRITORY_ONLY,
    showAttacker: false,
    description: 'The territory divides into cards that flip row by row, showing the new colour on their reverse.',
    beats: ['The territory freezes into a deck', 'Top cards flip first', 'The flip rolls down in rows', 'The last card lands face-up for the new owner'],
    duration: 1700,
    sequence: [
      camera(0, CAMERA_ACTION.FREEZE, { duration: 240 }),
      effect(100, 'magic_spell_01', { anchor: 'territoryTop', size: 190 }),
      reveal(300, { transition: T.FLIP_REVEAL, origin: S.TERRITORY_TOP, duration: 720 }),
      effect(520, 'magic_spell_01', { anchor: 'territoryBottom', size: 210 }),
      haptic(880, 'success'),
      camera(900, CAMERA_ACTION.PUNCH_IN, { amount: 1.04 }),
    ],
  }),

  scene({
    id: 'paper_tear', name: 'Paper Tear', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: false,
    description: 'An invisible hand tears the map surface from one edge; the new territory is the layer underneath.',
    beats: ['The paper edge wrinkles', 'A tear starts at the top', 'The ripped seam travels across the claim', 'The old layer peels away to reveal new ownership'],
    duration: 1800,
    sequence: [
      effect(0, 'arcane_parry_01', { anchor: 'territoryTop', size: 210 }),
      camera(180, CAMERA_ACTION.TILT, { amount: -1.6, duration: 260 }),
      reveal(380, { transition: T.TEAR_REVEAL, origin: S.TERRITORY_TOP, duration: 820 }),
      effect(620, 'solar_shrapnel_01', { anchor: 'territoryBottom', size: 220, opacity: 0.8 }),
      haptic(860, 'medium'),
    ],
  }),

  scene({
    id: 'construction_crew', name: 'Construction Crew', encounterMode: M.SUMMON_ONLY,
    showAttacker: false,
    description: 'Tiny work lights mark three zones, a crew converts them in sequence, and the finished grid is signed off.',
    beats: ['Work lights mark the top zone', 'The crew reaches the middle', 'The bottom zone completes last', 'A final inspection converts the full grid'],
    duration: 1900,
    sequence: [
      effect(0, 'radiant_heal_01', { anchor: 'territoryTop', size: 150 }),
      effect(260, 'radiant_heal_01', { anchor: 'randomTerritoryPoint', size: 170 }),
      effect(520, 'radiant_heal_01', { anchor: 'territoryBottom', size: 190 }),
      reveal(600, { transition: T.TILE_CONVERT, origin: S.TERRITORY_BOTTOM, duration: 760 }),
      effect(980, 'impact_shock_01', { anchor: 'territoryVisualCenter', size: 220 }),
      haptic(1040, 'success'),
    ],
  }),

  scene({
    id: 'lucky_duck', name: 'Lucky Duck', encounterMode: M.SUMMON_ONLY,
    showAttacker: false,
    description: 'A lucky duck drops into the centre, bobs once, and sends a playful ring of ownership across the ground.',
    beats: ['Bubbles announce something overhead', 'The lucky duck drops into the centre', 'It bobs once on landing', 'A playful ring spreads the takeover'],
    duration: 1800,
    sequence: [
      effect(0, 'magic_bubbles_01', { anchor: 'screenTop', size: 200 }),
      projectile(180, 'radiant_heal_01', 'screenTop', S.TERRITORY_CENTER, { duration: 360, size: 130, arc: -50, spin: 80 }),
      effect(540, 'magic_bubbles_01', { anchor: 'territoryVisualCenter', size: 230 }),
      reveal(620, { transition: T.SPREAD_FROM_CENTER, origin: S.TERRITORY_CENTER, duration: 700 }),
      haptic(760, 'success'),
    ],
  }),

  scene({
    id: 'disco_capture', name: 'Disco Capture', encounterMode: M.SUMMON_ONLY,
    showAttacker: true, showDefender: true,
    description: 'Nobody collides: both runners watch a disco light sweep between them until every floor tile joins the party.',
    beats: ['Attacker and defender take opposite sides', 'A disco light sweeps between them', 'Floor tiles flash in rhythm', 'The final beat locks the territory colour'],
    duration: 1900,
    sequence: [
      effect(0, 'spectral_bloom_01', { anchor: 'territoryTop', size: 220 }),
      projectile(260, 'magical_projectile_01', S.TERRITORY_TOP, S.TERRITORY_BOTTOM, { duration: 420, size: 120, spin: 240 }),
      reveal(480, { transition: T.ELECTRIFY, origin: S.TERRITORY_TOP, duration: 820 }),
      effect(760, 'nebula_burst_01', { anchor: 'territoryBottom', size: 270 }),
      haptic(980, 'success'),
    ],
  }),

  scene({
    id: 'mech_drop', name: 'Mech Drop', encounterMode: M.SUMMON_ONLY,
    showAttacker: false,
    description: 'A mech drops feet-first from off-screen, compresses on landing, and converts the ground with its stabiliser blast.',
    beats: ['A mech silhouette appears overhead', 'The mech drops feet-first', 'Its landing compresses the scene', 'Stabilisers fire a claiming shockwave'],
    duration: 1800,
    sequence: [
      effect(0, 'impact_shock_01', { anchor: 'screenTop', size: 180, opacity: 0.75 }),
      projectile(180, 'solar_shrapnel_01', 'screenTop', S.TERRITORY_CENTER, { duration: 360, size: 190 }),
      shake(540, { intensity: 1.2, axis: 'y' }),
      effect(540, 'earth_rupture_01', { anchor: 'territoryVisualCenter', size: 290 }),
      reveal(620, { transition: T.SHOCKWAVE, origin: S.TERRITORY_CENTER, duration: 620 }),
      haptic(560, 'heavy'),
    ],
  }),

  scene({
    id: 'angel_vs_demon', name: 'Angel vs Demon', encounterMode: M.DUEL,
    showAttacker: true, showDefender: true,
    description: 'The runners collide only in this explicit duel; opposing halos clash, split, and the winning wave rewrites the ground.',
    beats: ['Angel and demon auras charge on opposite sides', 'The two runners collide', 'Opposing energy holds at the centre', 'The attacker’s wave wins and electrifies the claim'],
    duration: 2000,
    sequence: [
      effect(0, 'radiant_heal_01', { anchor: 'territoryTop', size: 210 }),
      effect(160, 'vortex_red_01', { anchor: 'territoryBottom', size: 230 }),
      projectile(420, 'magical_projectile_01', S.TERRITORY_TOP, S.TERRITORY_CENTER, { duration: 300, size: 130 }),
      pause(720, 180),
      reveal(900, { transition: T.ELECTRIFY, origin: S.TERRITORY_CENTER, duration: 680 }),
      effect(920, 'spectral_bloom_01', { anchor: 'territoryVisualCenter', size: 290 }),
      haptic(940, 'heavy'),
    ],
  }),

  archetypeScene({
    id: 'reality_rewrite', name: 'Reality Rewrite', encounterMode: M.TERRAIN_TRANSFORM,
    showAttacker: true,
    description: 'The runner casts two anchors, connects them, and fires a rewrite rune that pixel-reforms the space between.',
    beats: ['The runner casts an anchor to each edge', 'A line connects the anchors', 'A rewrite rune fires in the middle', 'Reality breaks into pixels and reforms under the new owner'],
  }, 'magicCast', {
    glyph: 'magic_spell_01', link: 'magical_projectile_01', rune: 'arcane_parry_01',
  }, { beat: 280 }, { transition: T.PIXEL_REFORM, origin: S.TERRITORY_CENTER }),
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
