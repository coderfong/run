// The phone's half of the Apple Watch protocol, kept pure so every rule about
// what the wrist is told, and what it is allowed to ask for, is testable
// without a watch. The native link is watchLink.js; the watch app that reads
// these fields is targets/watch/RunState.swift, and the two move together:
// __tests__/watchProtocol.test.js fails if a field, phase or command exists on
// one side only. Bump WATCH_PROTOCOL if a field changes meaning, because the
// watch refuses a version it does not speak.
//
// Everything sent is already formatted. The watch draws strings, it does not
// derive them, so the wrist and the phone can never show two different paces
// for one run, and the copy rules (no dashes, `·` for a value not measured
// yet) are enforced here, where tests can see them.

import { runTuning } from '../theme/tokens';

export const WATCH_PROTOCOL = 1;

export const PHASE = Object.freeze({
  // No Run screen, or it is not in front. Nothing can start from the wrist.
  IDLE: 'idle',
  // Run screen open and in front with location allowed: Start works from the
  // wrist. Also carries a notice after a run too short to save.
  READY: 'ready',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  SAVING: 'saving',
  SAVED: 'saved',
  UNSAVED: 'unsaved',
});

const PHASES = new Set(Object.values(PHASE));

// What the watch may ask for, and the only phases each one is honoured in.
// A Map, not an object, so a command named after something on
// Object.prototype is simply unknown.
const COMMAND_PHASES = new Map([
  ['start', [PHASE.READY]],
  ['pause', [PHASE.RUNNING]],
  ['resume', [PHASE.PAUSED]],
  ['finish', [PHASE.RUNNING, PHASE.PAUSED]],
]);

export const WATCH_COMMANDS = Object.freeze([...COMMAND_PHASES.keys()]);

// A command is a message, and one that turns up late is a stale press, not an
// instruction. Generous, because the watch sets its clock from the phone's but
// not to the millisecond.
export const COMMAND_MAX_AGE_MS = 30000;

// The app's placeholder for a value it does not have yet. Never a dash.
export const EMPTY = '·';

// Brand pink, for an accent that is not a plain hex colour.
const FALLBACK_ACCENT = '#ec4899';

export function formatDistanceKm(distanceM) {
  const m = Number(distanceM);
  return ((Number.isFinite(m) && m > 0 ? m : 0) / 1000).toFixed(2);
}

// Minutes and seconds per kilometre, without the unit (the watch prints it).
// The same rounding as the Run screen's own pace, carry included.
export function formatPace(sPerKm) {
  const p = Number(sPerKm);
  if (sPerKm == null || !Number.isFinite(p) || p <= 0) return EMPTY;
  const m = Math.floor(p / 60);
  const s = Math.round(p % 60);
  const carry = s === 60;
  return `${carry ? m + 1 : m}:${String(carry ? 0 : s).padStart(2, '0')}`;
}

// Square kilometres without the unit, at the Run screen's precision.
export function formatLand(m2) {
  const a = Number(m2);
  if (m2 == null || !Number.isFinite(a) || a < 0) return EMPTY;
  return (a / 1e6).toFixed(a >= 1e5 ? 2 : 3);
}

// The Run screen's clock: mm:ss, or h:mm:ss past the hour.
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// The Run screen's GPS dot, as a word the watch maps to its own colour.
export function gpsQuality(accuracyM) {
  const a = Number(accuracyM);
  if (accuracyM == null || !Number.isFinite(a)) return 'none';
  if (a < runTuning.gpsGoodM) return 'good';
  if (a < runTuning.gpsOkM) return 'ok';
  return 'poor';
}

// The watch reads "#rrggbb" and nothing else.
export function sanitizeAccent(color) {
  if (typeof color !== 'string') return FALLBACK_ACCENT;
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return FALLBACK_ACCENT;
}

// One snapshot for the watch. Every value is a string, a finite number or a
// boolean: WatchConnectivity only carries property list values, and a null
// would sink the whole update.
//
// The runner's PORTRAIT is deliberately not in here. It is a picture, it
// changes when somebody visits the studio rather than when a run moves, and
// this state is re-sent on a ten second heartbeat: it travels on its own as a
// file transfer instead (src/watch/watchAvatar.js).
//
// `input` is what the Run screen knows: phase, getElapsedMs() (or elapsedMs),
// distanceM, paceSPerKm, landM2 (null while the run earns nothing),
// accuracyM, hint, accent, countdown, qualified, and afterRun, the ended run's
// { distanceM, elapsedMs, notice }.
export function buildWatchState(input = {}, { seq = 0, nowMs = Date.now() } = {}) {
  const phase = PHASES.has(input.phase) ? input.phase : PHASE.IDLE;
  const live = phase === PHASE.RUNNING || phase === PHASE.PAUSED;
  const elapsedMs =
    typeof input.getElapsedMs === 'function' ? input.getElapsedMs() : input.elapsedMs;
  const distanceM = Math.max(0, Number(input.distanceM) || 0);
  const after = input.afterRun || null;
  const ended = !!after && after.distanceM != null;

  return {
    v: WATCH_PROTOCOL,
    seq: Number(seq) || 0,
    sentAt: Number(nowMs) || 0,
    phase,
    elapsedS: live ? Math.max(0, Math.floor((Number(elapsedMs) || 0) / 1000)) : 0,
    distance: formatDistanceKm(distanceM),
    pace: live ? formatPace(input.paceSPerKm) : EMPTY,
    land: live ? formatLand(input.landM2) : EMPTY,
    gps: gpsQuality(input.accuracyM),
    hint: live && typeof input.hint === 'string' ? input.hint : '',
    accent: sanitizeAccent(input.accent),
    km: Math.floor(distanceM / 1000),
    qualified: !!input.qualified,
    countdown: phase === PHASE.COUNTDOWN && input.countdown != null ? String(input.countdown) : '',
    notice: after && typeof after.notice === 'string' ? after.notice : '',
    summaryDistance: ended ? formatDistanceKm(after.distanceM) : '',
    summaryTime: ended && Number(after.elapsedMs) > 0 ? formatClock(after.elapsedMs) : '',
  };
}

// What the watch would actually draw, minus the clock. The watch counts the
// clock on by itself, so a state is re-sent when this changes (or on the
// heartbeat), not every time a second turns.
export function watchStateKey(state) {
  // eslint-disable-next-line no-unused-vars
  const { seq, sentAt, elapsedS, ...shown } = state;
  return JSON.stringify(shown);
}

// Whether a command from the watch may act, given the phase the Run screen is
// in right now. The watch only offers what its last state allowed, but that
// state can be a second old, so the phone checks again rather than trusting
// the button.
export function commandAllowed(command, phase, nowMs = Date.now()) {
  if (!command || typeof command.cmd !== 'string') return false;
  const phases = COMMAND_PHASES.get(command.cmd);
  if (!phases || !phases.includes(phase)) return false;
  const at = Number(command.at);
  if (!Number.isFinite(at) || at <= 0) return false;
  return Math.abs(nowMs - at) <= COMMAND_MAX_AGE_MS;
}
