// PASERBY — the copy and the small amount of logic behind Crossed Paths.
//
// Deliberately PURE and dependency-free: no React, no theme, no api. The
// familiar-faces ladder is a mirror of the server's (backend/app/paserby.py
// FAMILIARITY), which is the same arrangement `config/economy.js` has with the
// backend economy — the server is authoritative and always sends the label it
// decided, so everything here is a fallback and a place to keep the wording in
// one piece rather than scattered through three screens.
//
// The one rule the whole feature rests on: nothing in this file, and nothing
// the API sends it, is more precise about WHERE or WHEN than a phrase. If a
// string here ever needs a coordinate or a time to render, something upstream
// has gone wrong.

// Rungs, highest first — `familiarityFor` takes the first one reached.
export const FAMILIARITY = [
  { at: 10, key: 'local_legend', label: 'Local Legend' },
  { at: 5, key: 'running_regular', label: 'Running Regular' },
  { at: 2, key: 'familiar_face', label: 'Familiar Face' },
  { at: 1, key: 'crossed_paths', label: 'Crossed Paths' },
];

export function familiarityFor(times) {
  const n = Number(times) || 0;
  return FAMILIARITY.find((f) => n >= f.at) || FAMILIARITY[FAMILIARITY.length - 1];
}

// How many characters walk on during the post-run reveal. The server caps the
// list it sends to the same number and reports the remainder separately, so
// this is only the client's own guard.
export const REVEAL_CAST = 3;

// --- copy -------------------------------------------------------------------
// "StreetPass" appears nowhere in the app, by name or by paraphrase.

export const COPY = {
  feature: 'PASERBY',
  screen: 'Crossroads',
  revealHeading: 'CROSSED PATHS',
  empty: 'Keep running and you may meet another PASER.',
  emptyTitle: 'No crossed paths yet',
  disabled: "Crossed Paths is off. Turn it on to meet the runners you pass.",
  setting: 'Allow Crossed Paths',
  settingHint:
    'Discover runners whose recent runs crossed near yours. They never see your route, your location, or when you crossed.',
  highFive: 'HIGH FIVE',
  highFiveAll: 'HIGH FIVE ALL',
  highFiveSent: 'HIGH FIVED',
  viewCrossroads: 'VIEW CROSSROADS',
  continue: 'Continue',
  introTitle: 'The Crossroads',
  introCta: 'GOT IT',
};

// The one time explainer that opens the first time a runner reaches the plaza
// (components/paserby/CrossroadsIntro.js). The plaza teaches nothing on its
// own: characters simply stand there, and the whole feature — who they are,
// what tapping does, what they can see of you — has to be said once.
//
// DATA ONLY, like the rest of this file. Each beat's icon is the component's
// business; `key` is what it looks the icon up by.
//
// Three beats, one short sentence each: who is here, what to do, what it
// costs them in privacy. The last one is not filler — it is the answer to the
// question the screen provokes. The familiarity ladder (Familiar Face →
// Running Regular → Local Legend) used to be a fourth beat here; it is
// already printed under each character's own card, so a first-time reader
// meets it there instead of in a wall of text before they have met anyone.
export const INTRO_BEATS = [
  {
    key: 'plaza',
    text: 'These runners crossed paths with you on a recent run.',
  },
  {
    key: 'tap',
    text: 'Tap anyone to high five them or see their profile.',
  },
  {
    key: 'privacy',
    text: 'They never see your route, location or crossing time. Hide or block anyone, any time.',
  },
];

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

// The post-run headline. Counts only — no names.
export function crossedPathsLine(count) {
  const n = Number(count) || 0;
  return `You crossed paths with ${n} ${plural(n, 'PASER', 'PASERs')} today.`;
}

// The notification body, in both the places it appears: the push Expo delivers
// while the app is shut, and the banner CrossroadsAlert raises when that same
// push lands with the app open. Mirrors `crossroads_waiting_line` in
// backend/app/paserby.py exactly — one runner can see both wordings for the
// same arrival, so they must not drift.
export function crossroadsWaitingLine(count) {
  const n = Number(count) || 0;
  if (n <= 1) return 'A new PASER is waiting for you at the Crossroads.';
  return `${n} new PASERs are waiting for you at the Crossroads.`;
}

// The line a repeat encounter earns. Reads as recognition, not as a stat.
export function repeatLine(times) {
  const n = Number(times) || 0;
  if (n < 2) return null;
  return `Familiar face! You have crossed paths ${n} times.`;
}

// Where the rest of a big reveal went.
export function moreLine(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return `+${n} more at the Crossroads`;
}

// The Home entry point's badge. Null when there is nothing waiting, so the
// caller can render no badge at all rather than a zero.
export function badgeLabel(unseen) {
  const n = Number(unseen) || 0;
  if (n <= 0) return null;
  return `${n > 99 ? '99+' : n} NEW`;
}

// One card's subtitle: the broad date and, once they are a familiar face, how
// many times. Falls back gracefully if the server ever sends a partial card.
export function encounterSubtitle(encounter) {
  const when = encounter?.when || 'Recently';
  const times = Number(encounter?.times_crossed) || 1;
  return times > 1 ? `${when} · ${times} times` : when;
}

// The server sends `familiarity_label`; this is the fallback for a client that
// is ahead of a deploy.
export function familiarityLabel(encounter) {
  return encounter?.familiarity_label || familiarityFor(encounter?.times_crossed).label;
}

// Who walks on during the reveal, and how many are left over. Takes the
// server's own `more_at_crossroads` when it sent one, so the two can never
// disagree about the "+N more" line.
export function revealCast(reveal, cast = REVEAL_CAST) {
  const all = reveal?.encounters || [];
  const shown = all.slice(0, cast);
  const more =
    reveal?.more_at_crossroads != null
      ? Number(reveal.more_at_crossroads) || 0
      : Math.max(0, all.length - shown.length);
  return { shown, more };
}

// Whether the post-run beat should play at all. A run that turned nobody up
// must not add a screen to the sequence.
export function shouldReveal(reveal) {
  return !!(reveal && (reveal.encounters || []).length > 0);
}
