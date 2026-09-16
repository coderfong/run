// How long a run's unplaced land has left.
//
// A runner can leave the claim screen and plan the attack later. The server
// holds the land for a while after the run ends (`claim_defer_hours`) and
// sends the deadline as `claim_expires_at`; this turns it into the few words
// the screens show. A null deadline means there is none at all.

import { serverTime } from './time';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function claimTimeLeft(expiresAt, now = Date.now()) {
  if (expiresAt == null) return { expired: false, ms: null, label: null };
  const at = serverTime(expiresAt);
  if (!Number.isFinite(at)) return { expired: false, ms: null, label: null };
  const ms = at - now;
  if (ms <= 0) return { expired: true, ms: 0, label: null };
  let label;
  if (ms < HOUR) label = `${Math.min(59, Math.max(1, Math.ceil(ms / MINUTE)))}m left`;
  // Rounded rather than floored, so a run that has only just finished reads
  // as the whole window ("24h left") instead of an hour short of it.
  else if (ms < 2 * DAY) label = `${Math.max(1, Math.round(ms / HOUR))}h left`;
  else label = `${Math.round(ms / DAY)}d left`;
  return { expired: false, ms, label };
}

// The waiting runs worth offering. The list is cached, so anything whose
// window closed since it was fetched is dropped here rather than offered and
// then refused.
export function openClaims(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter(
    (claim) => claim?.run_id && !claimTimeLeft(claim.claim_expires_at, now).expired
  );
}
