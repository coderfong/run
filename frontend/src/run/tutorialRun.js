// The tutorial's own run, and its own claim — entirely client-side.
//
// DevRunSimulator (see simulatedRun.js) submits a REAL run through the real
// /start-run -> /end-run path so a dev_tools account can look at the post-run
// screens from a desk; the server cannot tell it apart from a run, which is
// exactly why it is gated to an allowlisted account. A brand-new runner going
// through the first-run tutorial has no such grant, and should not be given
// one just to see the game once — so this never reaches the network at all.
//
// It builds a GPS-shaped trace with the SAME generator DevRunSimulator uses
// (so the map looks and moves the way a real run does), then fabricates a
// RunResultOut / ClaimOptionsOut / ClaimOut-shaped response entirely on the
// device. RunningScreen and ResultScreen read this exactly where they would
// read the server's answer — see their own `tutorialSim` branches — so
// nothing here can mint real territory, XP or currency, and nothing outside
// the tutorial's simulated run/claim segment may import it.
//
// SANDBOX, stated once. Every id in here starts `tutorial-`, nothing is
// written to storage, the API client is never imported, and every reward and
// energy number is zero. The demo's run, claim and territory live in the run
// and claim screens' component state and are gone when the Record modal
// closes. RunningScreen and ResultScreen hold the other half of the promise:
// each network call they make is behind a `tutorialSim` branch that answers
// from this file instead.

import { buildSimulatedRun, FALLBACK_ORIGIN } from './simulatedRun';

export { FALLBACK_ORIGIN };

export const TUTORIAL_RUN_DISTANCE_M = 5000;
export const TUTORIAL_RUN_PACE_S_PER_KM = 355; // matches SIM_PRESETS 'mid'

// Mirrors backend/app/config.py `claim_area_per_m` / `max_polygon_area_m2`.
// The server is the only real source of truth for this number; this is a
// fixed shadow of it purely so a fabricated run's territory reads at a
// believable size. If the server's rate ever moves this goes stale, but only
// for the tutorial's own made-up run — nothing a real runner claims is priced
// off this file.
const CLAIM_AREA_PER_M = 75;
const MAX_CLAIM_AREA_M2 = 1_250_000;
const M_PER_DEG_LAT = 110540;

function metresPerDegreeLon(latitude) {
  return 111320 * Math.cos((latitude * Math.PI) / 180);
}

// Planar shoelace area, in square metres, of a lon/lat ring around `centre`.
function ringAreaM2(ring, centre) {
  const mLon = metresPerDegreeLon(centre[1]);
  const pts = ring.map(([lon, lat]) => [
    (lon - centre[0]) * mLon,
    (lat - centre[1]) * M_PER_DEG_LAT,
  ]);
  let twice = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    twice += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(twice) / 2;
}

function ringCentroidLonLat(ring) {
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / ring.length, lat / ring.length];
}

/** The fabricated GPS trace: same shape a real 5 km run's points take. */
export function buildTutorialTrace({ origin = FALLBACK_ORIGIN, seed = 1 } = {}) {
  return buildSimulatedRun({
    origin,
    distanceM: TUTORIAL_RUN_DISTANCE_M,
    paceSPerKm: TUTORIAL_RUN_PACE_S_PER_KM,
    seed,
  });
}

// The claim's footprint. Mirrors the real formula (`claim_area_m2 =
// distance_m * claim_area_per_m`, capped — backend/app/geospatial.py
// `claim_area_m2`) so the NUMBER reads like a real one; the SHAPE is a
// stand-in — the loop the trace already ran, scaled about its own centre
// until it encloses that area — rather than the server's true buffered
// corridor. Nobody outside this fabricated run ever sees the difference.
export function tutorialClaimShape(path, distanceM) {
  const ring = path.map((p) => [p.longitude, p.latitude]);
  const centre = ringCentroidLonLat(ring);
  const rawAreaM2 = ringAreaM2(ring, centre) || 1;
  const areaM2 = Math.min(distanceM * CLAIM_AREA_PER_M, MAX_CLAIM_AREA_M2);
  const scale = Math.sqrt(areaM2 / rawAreaM2);
  const scaledRing = ring.map(([lon, lat]) => [
    centre[0] + (lon - centre[0]) * scale,
    centre[1] + (lat - centre[1]) * scale,
  ]);
  return { ring: scaledRing, areaM2, centre };
}

/** A RunResultOut-shaped object — what a real /end-run would answer. */
export function buildTutorialResult({ path, distanceM, startedAtMs, endedAtMs }) {
  const shape = tutorialClaimShape(path, distanceM);
  const durationS = Math.max(60, (endedAtMs - startedAtMs) / 1000);
  return {
    run_id: `tutorial-${startedAtMs}`,
    distance_m: distanceM,
    duration_s: durationS,
    closed_loop: false,
    territory: null,
    claim_radius_m: 0,
    claim_area_m2: shape.areaM2,
    claim_ring: shape.ring,
    stolen_m2: 0,
    stolen_from: null,
    achievements: [],
    // Nothing is paid for a demo. These numbers are never sent anywhere and
    // never shown, but zero is the honest value.
    xp_gained: 0,
    tier: 'qualified_for_claim',
    qualification_reason: null,
    claim_eligible: true,
    verification_state: 'verified',
    gate_reason: null,
    coins_gained: 0,
    energy_gained: 0,
    coins_capped: false,
    energy_capped: false,
    replayed: false,
    claim_expires_at: null,
  };
}

/** A ClaimPlacement-shaped object: this run's one, uncontested, placement. */
function tutorialPlacement({ ring, areaM2, t = 0.5, deg = 0 }) {
  return {
    index: 0,
    placement: 0,
    rotation: 0,
    t,
    rotation_deg: deg,
    route_attachment: 1,
    ring,
    area_m2: areaM2,
    held_m2: areaM2,
    new_m2: areaM2,
    enemy_m2: 0,
    defended_m2: 0,
    mine_m2: 0,
    ally_m2: 0,
    rivals: [],
    action: 'empty',
    // The demo claim costs nothing, and says so: the tutorial card tells the
    // runner it won't use their real energy.
    energy_cost: 0,
    base_energy_cost: 0,
    applied_discounts: [],
    energy_before: null,
    energy_after: null,
    available: true,
    unavailable_reason: null,
    expected_xp: 0,
    expected_rank_points: 0,
  };
}

/** A ClaimOptionsOut-shaped object — open ground, one placement, no rivals. */
export function buildTutorialOptions({ run_id, claim_ring, claim_area_m2 }, routeLonLat) {
  return {
    run_id,
    claim_area_m2,
    base_ring: claim_ring,
    base_centre: ringCentroidLonLat(claim_ring),
    base_t: 0.5,
    route: routeLonLat,
    window_frac: 1,
    placement_count: 1,
    rotation_count: 1,
    placements: [tutorialPlacement({ ring: claim_ring, areaM2: claim_area_m2 })],
    default_index: 0,
    most_land_index: 0,
    biggest_steal_index: null,
    best_defence_index: null,
    energy: null,
    energy_max: null,
    first_claim_of_day: false,
    neutral_claims_remaining: 3,
    min_route_attachment: 0,
    rank_tier: 0,
    tier: 'qualified_for_claim',
    qualification_reason: null,
    claim_eligible: true,
  };
}

// What a pose preview would say. Open ground everywhere along this loop, so
// the breakdown does not actually depend on the pose the runner drags to —
// there is nobody here to steal from or defend against.
export function tutorialPreviewAt({ t, deg, claim_ring, claim_area_m2 }) {
  return { ...tutorialPlacement({ ring: claim_ring, areaM2: claim_area_m2, t, deg }), index: -1 };
}

/** A ClaimOut-shaped object — placing the tutorial's one claim. */
export function buildTutorialClaimOut({ result, user, equipped }) {
  const ring = result.claim_ring;
  const areaM2 = result.claim_area_m2;
  return {
    territory: {
      id: `tutorial-territory-${result.run_id}`,
      user_id: user?.id || 'tutorial',
      username: user?.username || 'you',
      area_m2: areaM2,
      created_at: new Date().toISOString(),
      polygon: ring,
      rings: [ring],
      contested: false,
      clan_tag: null,
      clan_color: null,
      defenders: 1,
      strength: 1,
      avatar: equipped || null,
      freshness: 1,
      reinforcements: 0,
      rank_key: 'wood',
      rank_tier: 0,
      rank_label: 'Wood',
      clan_rank_key: null,
      clan_rank_tier: null,
      clan_rank_label: null,
    },
    claimed_m2: areaM2,
    gained_m2: areaM2,
    reinforced_m2: 0,
    claim_rings: [ring],
    gained_rings: [ring],
    stolen_m2: 0,
    stolen_from: null,
    victims: [],
    xp_gained: 0,
    level: 1,
    xp: 0,
    next_level_xp: 100,
    leveled_up: false,
    energy: null,
    energy_max: null,
    action: 'empty',
    energy_cost: 0,
    neutral_claims_remaining: 2,
    solo_elo: 1000,
    solo_elo_delta: 0,
    club_elo: null,
    club_elo_delta: 0,
    rank_up: false,
    rank_down: false,
    rank_key_before: 'wood',
    rank_key_after: 'wood',
  };
}
