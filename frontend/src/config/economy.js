// The economy rules, mirrored from the server.
//
// WHY THIS FILE EXISTS. The running screen used to preview a claim with
// `(d * d) / (4 * Math.PI)` — the circle model the backend retired. At 5 km it
// promised 1.99 km² while the server granted 0.375 km², so the game appeared to
// take 80% of what it had just shown you. A drifting copy of the rules is worse
// than no copy at all.
//
// So: this is the ONLY place the client is allowed to compute economy numbers,
// it is a line-by-line mirror of `backend/app/economy.py` +
// `backend/app/geospatial.claim_area_m2` + `backend/app/config.Settings`, and
// `economy.fixtures.json` is checked against BOTH sides (see
// `backend/test_economy_contract.py`). Change one, change the other, or the
// contract test fails.
//
// The server stays authoritative in every case that matters — what a claim
// actually grants comes from `/end-run`, never from here. This exists so the
// live readout during a run is honest about what is being earned.

// Bumped whenever a number below changes. The server reports its own value on
// /submit-path; a mismatch means the app is older than the rules it is drawing.
export const ECONOMY_VERSION = 2;

// --- mirrored from backend/app/config.Settings -----------------------------
export const ECONOMY = {
  // what counts as a run
  minRewardedDistanceM: 500.0,
  minRewardedDurationS: 240.0,
  minClaimDistanceM: 1000.0,
  minClaimDurationS: 420.0,
  minUniqueRouteLengthM: 700.0,
  // land earned
  claimAreaPerM: 75.0,
  maxPolygonAreaM2: 1_250_000.0,
  // run payouts
  coinsRunBase: 10,
  coinsRunPerKm: 8,
  coinsRunMax: 100,
  energyRunBase: 3,
  energyRunMax: 15,
  // claim cost
  energyCostClaim: 20,
  energyCostClaimEmpty: 16,
  energyCostClaimReinforce: 12,
  energyCostClaimAttack: 20,
  energyCostClaimFortified: 24,
  energyFirstClaimDiscount: 0.5,
  // Daily territorial limits. 0 = the neutral-expansion ration is OFF, which
  // it has been since 2026-08-10: Energy already caps claiming, continuously
  // and buyably, so a second daily cliff on the same decision only told
  // runners who had done the running and had the Energy that they still could
  // not take open ground. Mirror of the server's
  // `max_neutral_claims_per_game_day` — change both or `check:economy` fails.
  maxNeutralClaimsPerGameDay: 0,
};

// Diminishing returns on distance, as [kmThreshold, marginalRate]. Past 5 km
// each further kilometre is worth less GROUND — not less XP, coins or
// leaderboard credit.
const TERRITORIAL_CURVE = [
  [5.0, 1.0],
  [10.0, 0.65],
  [20.0, 0.3],
  [Infinity, 0.1],
];

/** Distance as the map values it, in metres. */
export function territorialDistanceM(distanceM) {
  const km = Math.max(0, distanceM || 0) / 1000;
  let eq = 0;
  let lower = 0;
  for (const [upper, rate] of TERRITORIAL_CURVE) {
    if (km <= lower) break;
    eq += (Math.min(km, upper) - lower) * rate;
    lower = upper;
  }
  return eq * 1000;
}

/**
 * Land a run earns measured from a standing start, capped.
 *
 * This is the CURVE, not the entitlement — see `entitledAreaM2`, which is what
 * a run is actually worth once the rest of the day is taken into account.
 */
export function claimAreaM2(distanceM) {
  return Math.min(
    territorialDistanceM(distanceM) * ECONOMY.claimAreaPerM,
    ECONOMY.maxPolygonAreaM2
  );
}

/**
 * The land THIS run adds, as a slice of the day's cumulative curve.
 *
 * Applying the curve per run meant ten 1 km runs each earned the untapered
 * first kilometre. The curve is a daily entitlement; a run is worth the
 * difference it makes to the day's total.
 *
 * @param {number} distanceBeforeM claim-qualified metres already banked today
 * @param {number} runDistanceM    this run's distance
 */
export function entitledAreaM2(distanceBeforeM, runDistanceM) {
  const before = Math.max(0, distanceBeforeM || 0);
  const after = before + Math.max(0, runDistanceM || 0);
  return Math.max(0, claimAreaM2(after) - claimAreaM2(before));
}

// --- qualification ---------------------------------------------------------

export const RUN_TIER = {
  UNQUALIFIED: 'unqualified_for_rewards',
  REWARDED: 'qualified_for_rewards_only',
  CLAIMABLE: 'qualified_for_claim',
  SHADOW_FLAGGED: 'shadow_flagged',
};

export const REASON = {
  MIN_REWARD_DISTANCE: 'Complete at least 500 m to earn run rewards.',
  MIN_REWARD_DURATION: 'Keep moving for at least 4 minutes to earn run rewards.',
  MIN_CLAIM_DISTANCE: 'Complete at least 1 km to claim territory.',
  MIN_CLAIM_DURATION: 'Keep moving for at least 7 minutes to claim territory.',
  MIN_UNIQUE: 'This route did not contain enough unique movement.',
  // Mirrors the server's REASON_NEUTRAL_LIMIT. Names no number, because the
  // ration is configurable and is currently off entirely.
  NEUTRAL_LIMIT: 'You have used today’s neutral expansions.',
};

function meetsRewardBar(distanceM, durationS) {
  return (
    (distanceM || 0) >= ECONOMY.minRewardedDistanceM &&
    (durationS || 0) >= ECONOMY.minRewardedDurationS
  );
}

function meetsClaimBar(distanceM, durationS, uniqueLengthM) {
  return (
    (distanceM || 0) >= ECONOMY.minClaimDistanceM &&
    (durationS || 0) >= ECONOMY.minClaimDurationS &&
    (uniqueLengthM || 0) >= ECONOMY.minUniqueRouteLengthM
  );
}

/**
 * Which rewards this activity has earned the right to.
 *
 * `uniqueLengthM` is distinct ground covered, which the client cannot compute
 * (it needs the buffered-corridor area). Pass Infinity for a live preview and
 * treat the answer as optimistic — the server applies the real value.
 */
export function runTier(distanceM, durationS, uniqueLengthM = Infinity) {
  if (!meetsRewardBar(distanceM, durationS)) return RUN_TIER.UNQUALIFIED;
  if (meetsClaimBar(distanceM, durationS, uniqueLengthM)) return RUN_TIER.CLAIMABLE;
  return RUN_TIER.REWARDED;
}

/** Why this activity earned nothing at all, or null if it earned something. */
export function rewardGateReason(distanceM, durationS) {
  if ((distanceM || 0) < ECONOMY.minRewardedDistanceM) return REASON.MIN_REWARD_DISTANCE;
  if ((durationS || 0) < ECONOMY.minRewardedDurationS) return REASON.MIN_REWARD_DURATION;
  return null;
}

/** Why territory is off the table, or null if it isn't. */
export function claimGateReason(distanceM, durationS, uniqueLengthM = Infinity) {
  if ((distanceM || 0) < ECONOMY.minClaimDistanceM) return REASON.MIN_CLAIM_DISTANCE;
  if ((durationS || 0) < ECONOMY.minClaimDurationS) return REASON.MIN_CLAIM_DURATION;
  if ((uniqueLengthM || 0) < ECONOMY.minUniqueRouteLengthM) return REASON.MIN_UNIQUE;
  return null;
}

/** The one sentence this activity should show, whatever its tier. */
export function gateReasonFor(tier, distanceM, durationS, uniqueLengthM = Infinity) {
  if (tier === RUN_TIER.UNQUALIFIED) return rewardGateReason(distanceM, durationS);
  // A flagged run is told exactly what an HONEST run of the same shape would
  // be told, and nothing more — so one that cleared every bar is told nothing.
  // Inventing a reason here would be the tell.
  if (tier === RUN_TIER.SHADOW_FLAGGED) {
    return claimGateReason(distanceM, durationS, uniqueLengthM);
  }
  if (tier === RUN_TIER.REWARDED) return claimGateReason(distanceM, durationS, uniqueLengthM);
  return null;
}

// --- run payouts -----------------------------------------------------------

/** Coins a qualifying run pays, before the daily cap. */
export function runCoins(distanceM) {
  const km = Math.max(0, distanceM || 0) / 1000;
  return Math.min(
    ECONOMY.coinsRunMax,
    ECONOMY.coinsRunBase + Math.floor(km * ECONOMY.coinsRunPerKm)
  );
}

/** Energy a qualifying run pays back, before the daily cap. */
export function runEnergy(distanceM) {
  const km = Math.max(0, distanceM || 0) / 1000;
  return Math.min(ECONOMY.energyRunMax, ECONOMY.energyRunBase + Math.floor(km));
}

// --- claim cost ------------------------------------------------------------

export const CLAIM_ACTION = {
  EMPTY: 'empty',
  REINFORCE: 'reinforce',
  ATTACK: 'attack',
  FORTIFIED: 'fortified',
};

const ACTION_COST = {
  [CLAIM_ACTION.EMPTY]: 'energyCostClaimEmpty',
  [CLAIM_ACTION.REINFORCE]: 'energyCostClaimReinforce',
  [CLAIM_ACTION.ATTACK]: 'energyCostClaimAttack',
  [CLAIM_ACTION.FORTIFIED]: 'energyCostClaimFortified',
};

/** Energy for a claim of this kind. The first each day is half price. */
export function claimCost(action, firstOfDay) {
  const base = ECONOMY[ACTION_COST[action]] ?? ECONOMY.energyCostClaim;
  if (firstOfDay) {
    return Math.max(1, Math.round(base * (1 - ECONOMY.energyFirstClaimDiscount)));
  }
  return base;
}
