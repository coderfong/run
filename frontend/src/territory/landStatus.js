// Your land — how a plot's clock and its fights read, in words.
//
// Pure, so the rules are testable without rendering, and shared by the card
// on You and the full page so the two can never word the same plot two ways.
// Every fact comes from GET /me/territory. The one thing done here is reading
// the server's instants against the phone's clock, which is what keeps a
// cached response honest: a list opened from cache three hours after it was
// fetched says how long each plot has NOW, not how long it had then.
//
// House copy rules apply: no dashes anywhere, and no `·` between facts (a
// comma joins them, and the second fact drops its capital). The mid dot is
// kept only for an
// unknown value.

import { serverTime, timeAgo } from '../utils/time';

// The server's "fading" window, which is also when the "Territory expires
// soon" push goes out (backend reminders.TERRITORY_EXPIRING_HOURS). The
// response carries its own `fading_hours`; this is only for before it lands.
export const FADING_HOURS = 36;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// One unit for land throughout the app (RivalCard's fmtArea): small plots get
// a third decimal rather than a switch into a different unit.
export function fmtArea(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

/** Milliseconds left on a plot's clock, against the phone's. NaN if unknown. */
export function msLeft(plot, now = Date.now()) {
  const at = serverTime(plot?.expires_at);
  return Number.isFinite(at) ? at - now : NaN;
}

/** Inside the fading window right now. The server's flag when there is no clock. */
export function isFading(plot, { now = Date.now(), fadingHours = FADING_HOURS } = {}) {
  const ms = msLeft(plot, now);
  return Number.isFinite(ms) ? ms <= fadingHours * HOUR : !!plot?.fading;
}

/**
 * How long a plot has, the way a runner would say it:
 * "Fading now", "Fades in 40m", "Fades in 20h", "40h left", "4d left".
 *
 * Inside the fading window it names the deadline; outside it, the time in
 * hand. It FLOORS: "Fades in 1h" with 1h59m to go is a promise kept, and
 * "Fades in 2h" with 1h01m to go is not.
 */
export function timeLeftLabel(plot, { now = Date.now(), fadingHours = FADING_HOURS } = {}) {
  const ms = msLeft(plot, now);
  if (!Number.isFinite(ms)) return '·';
  if (ms <= MIN) return 'Fading now';
  if (ms < HOUR) return `Fades in ${Math.floor(ms / MIN)}m`;
  if (ms <= fadingHours * HOUR) return `Fades in ${Math.floor(ms / HOUR)}h`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h left`;
  return `${Math.floor(ms / DAY)}d left`;
}

/** Share of the plot's life still to run, 0..1, read now. */
export function lifeLeft(plot, now = Date.now()) {
  const end = serverTime(plot?.expires_at);
  const start = serverTime(plot?.claimed_at);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) {
    const served = Number(plot?.life_left);
    return Number.isFinite(served) ? Math.max(0, Math.min(1, served)) : 0;
  }
  return Math.max(0, Math.min(1, (end - now) / (end - start)));
}

const km = (m) => (Math.max(0, Number(m) || 0) / 1000).toFixed(1);

/**
 * The line under a plot: what it has been through, then where it came from.
 * Two facts at most, because this is one line on a phone.
 */
export function plotDetail(plot) {
  const held = Number(plot?.held) || 0;
  const again = Number(plot?.reinforcements) || 0;
  return [
    held > 0 ? (held === 1 ? 'Held 1 attack' : `Held ${held} attacks`) : null,
    again > 0 ? `Reinforced ${again}×` : null,
    plot?.club ? 'Club land' : null,
    plot?.run_distance_m ? `From a ${km(plot.run_distance_m)} km run` : null,
    plot?.claimed_at ? `Claimed ${timeAgo(plot.claimed_at)}` : null,
  ]
    .filter(Boolean)
    .slice(0, 2)
    // One sentence rather than a list: a comma joins the two facts, and the
    // second one drops its capital.
    .map((fact, i) => (i ? fact.charAt(0).toLowerCase() + fact.slice(1) : fact))
    .join(', ');
}

/**
 * The one short status a plot earns on a summary row, or null.
 *
 * The summary row is for scanning — area, time left, life — so it carries only
 * NEWS: an attack the plot held off. Where it came from ("from a 5.2 km run")
 * is provenance, and how often it was reinforced is already in the life bar
 * (a reinforcement is what refills it), so neither earns a word here. Both
 * stay on the full Territory page, which is where a plot's history is read.
 */
export function plotStatus(plot) {
  const held = Number(plot?.held) || 0;
  if (held > 0) return held === 1 ? 'Held 1 attack' : `Held ${held} attacks`;
  return null;
}

/** The three numbers across the top of the card and the page. */
export function summaryCells(summary) {
  const s = summary || {};
  const fading = Number(s.fading_plots) || 0;
  return [
    { key: 'fading', label: 'Fading soon', value: fading, alarm: fading > 0 },
    { key: 'held', label: 'Held this week', value: Number(s.held_times) || 0, alarm: false },
    { key: 'lost', label: 'Lost this week', value: Number(s.lost_times) || 0, alarm: false },
  ];
}

const BEAT_ICON = { lost: 'steal', held: 'verified', faded: 'timer' };

/** What happened, in the second person. */
export function beatTitle(beat) {
  const who = beat?.rival_username;
  switch (beat?.kind) {
    case 'lost':
      return who ? `Lost to ${who}` : 'Lost ground';
    case 'held':
      return who ? `Held against ${who}` : 'Held an attack';
    case 'faded':
      return 'Faded';
    default:
      return '·';
  }
}

export function beatIcon(kind) {
  return BEAT_ICON[kind] || 'claim';
}

function point(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return lat != null && lon != null && Number.isFinite(la) && Number.isFinite(lo)
    ? { lat: la, lon: lo }
    : null;
}

/**
 * The map `focus` for a plot: its bounds as a ring, so the camera frames the
 * WHOLE plot (GlobalMapScreen fits a focus ring) rather than dropping onto a
 * point at a fixed zoom, plus a point on it for the fallback.
 */
export function plotFocus(plot) {
  const b = Array.isArray(plot?.bbox) && plot.bbox.length === 4 ? plot.bbox.map(Number) : null;
  const ring = b && b.every(Number.isFinite)
    ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
    : null;
  const at = point(plot?.lat, plot?.lon);
  if (!at && !ring) return null;
  return { ...(at || {}), ...(ring ? { ring } : null) };
}

/** The map `focus` for a beat: where it happened. */
export function beatFocus(beat) {
  return point(beat?.lat, beat?.lon);
}
