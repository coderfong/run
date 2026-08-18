// Was this run worth saying anything about?
//
// The Territory Report is shown after every claimed run and always will be —
// it is mostly free content and it is the point of finishing. This decides
// something narrower: whether the run was notable enough that PASER may, once
// the exposure rules also agree, raise PRO on its own.
//
// EVERY TEST BELOW READS A FIELD THE SERVER ALREADY SENDS. See the free half
// of `RunInsights` in backend/app/routes/insights.py. Nothing here is modelled,
// smoothed or inferred, and there is deliberately no "engagement score".
//
// WHAT IS DELIBERATELY MISSING, and why. The brief for this asked for personal
// bests and leaderboard CLIMBS as triggers. Both need history the free
// response does not carry: `is_personal_best` lives in the `pro` block (which
// is null for exactly the people this would be shown to), and a climb needs a
// previous rank, which nothing stores. Rather than approximate either — a
// "probably a PB" is a lie with a friendly face — they are left out, and the
// exact contract that would let them in is in docs/PRO_BACKEND.md.

import { NOTABLE_RUN } from '../config/proExposure';

/**
 * @param {object} insights the /runs/{id}/insights payload
 * @returns {{ notable: boolean, reason: string|null, headline: string|null }}
 *          `headline` is real, specific copy naming what actually happened, so
 *          the teaser can lead with the achievement rather than with the sale.
 */
export function notableRun(insights) {
  const none = { notable: false, reason: null, headline: null };
  if (!insights) return none;

  const claimed = Number(insights.territory_m2) || 0;
  const taken = Number(insights.rivals_taken) || 0;
  const rank = Number(insights.standing_rank) || 0;
  const field = Number(insights.standing_field) || 0;

  // Took ground off somebody. The most charged thing that can happen in a run,
  // and the moment a rivalry becomes worth reading about.
  if (taken >= NOTABLE_RUN.rivalsTaken) {
    return {
      notable: true,
      reason: 'rival_steal',
      headline:
        taken === 1
          ? 'You took ground off another runner'
          : `You took ground off ${taken} runners`,
    };
  }

  // A big day out on its own terms.
  if (claimed >= NOTABLE_RUN.bigClaimM2) {
    return {
      notable: true,
      reason: 'big_claim',
      headline: 'That was a big claim',
    };
  }

  // Standing high in a field worth standing in. The field-size guard stops a
  // board of four people from making everybody notable.
  if (rank > 0 && field >= 20 && rank / field <= NOTABLE_RUN.topRankFraction) {
    return {
      notable: true,
      reason: 'high_standing',
      headline: `You are in the top ${Math.max(1, Math.round((rank / field) * 100))}% for land held`,
    };
  }

  return none;
}

export default notableRun;
