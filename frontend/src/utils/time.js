// Server timestamps, parsed the way the server actually means them.
//
// THE BUG THIS EXISTS TO KILL. Every datetime column in the backend is a naive
// `DateTime` holding `datetime.utcnow()` (see backend/app/models.py), so what
// lands on the wire is `2026-08-18T02:00:00` with no offset and no `Z`. The
// ECMAScript date parser has a rule for exactly that shape and the rule is the
// wrong one for us: a date-TIME form with no offset is interpreted as LOCAL
// time. On a phone at UTC+8 a run finished thirty seconds ago therefore parses
// as eight hours old, and the feed says "8h ago" under a run you just did.
//
// It read as a caching bug for a long time because it scales with the offset
// rather than with the data: the same build is correct in London and eight
// hours wrong in Singapore, and every card is wrong by the SAME amount, which
// looks far more like a stale response than a parse.
//
// Three call sites had already worked this out and grown their own
// `iso.endsWith('Z') ? iso : iso + 'Z'` (RivalCard, map/intelligence,
// RivalDetailScreen). The other eight had not, which is why "8h ago" survived
// on the feed while the rival screens beside it were right. One parser now.
//
// The backend has been fixed too, so `Z` arrives on new responses (see
// schemas.py's `utc` serializer). This stays regardless: the app talks to a
// deployed Render backend that is not always the code in this repo (a trap
// this project has hit before), and an already-correct string goes through
// here untouched.

/** True for a string the JS parser would read as local time. */
function isNaiveIso(value) {
  // Anything carrying a zone — `Z`, `+08:00`, `-0500` — is already unambiguous.
  // The offset test only looks at the TIME half, or a date like `2026-08-18`
  // would match its own hyphens.
  const timePart = value.slice(value.indexOf('T') + 1);
  return !/[Zz]$/.test(value) && !/[+-]\d{2}:?\d{2}$/.test(timePart);
}

/**
 * Parse a timestamp the server sent, as UTC.
 *
 * Returns a Date, which may be Invalid — callers that render should check.
 * Accepts a Date or an epoch number unchanged, so this can sit in front of a
 * field whose type varies.
 */
export function parseServerDate(value) {
  if (value == null) return new Date(NaN);
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).trim();
  if (!text) return new Date(NaN);
  return new Date(text.includes('T') && isNaiveIso(text) ? `${text}Z` : text);
}

/** Epoch milliseconds, or NaN. */
export function serverTime(value) {
  return parseServerDate(value).getTime();
}

/** Milliseconds between a server timestamp and now. Negative for the future. */
export function sinceServer(value) {
  return Date.now() - serverTime(value);
}

/**
 * "just now" · "6m ago" · "3h ago" · "2d ago".
 *
 * CLAMPED AT ZERO, not at one second. A run is posted the moment it ends, so
 * the phone's clock and the server's disagreeing by a couple of seconds used to
 * put a fresh run slightly in the FUTURE, and the old `Math.max(1, ...)` turned
 * that negative age into "just now" only by accident. Anything within a minute
 * either way is "just now" deliberately.
 */
export function timeAgo(value) {
  const ms = serverTime(value);
  if (!Number.isFinite(ms)) return '·';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A short local calendar date, for rows that show a day rather than an age. */
export function shortDate(value) {
  const date = parseServerDate(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '·';
}

/** Local date and time, for a run's own detail header. */
export function longDateTime(value) {
  const date = parseServerDate(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '·';
}
