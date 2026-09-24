// The Missions board worm, as pure numbers.
//
// AN INCHWORM IS TWO ENDS, NOT ONE SLIDE. The worm's tail and head are tracked
// separately, and they never move at the same time: the tail pulls up behind
// the head (the body bunches and arches), then the head reaches forward (the
// body stretches out again). Sliding the whole sprite reads as a sticker being
// dragged; moving the two ends in turn is what reads as a creature walking.
//
// The sprite is drawn between the two ends: its length is (head - tail), so it
// squashes when they are close and stretches when they are far, and it arches
// (grows taller) as it squashes, which is what a real one does.
//
// ONE LOOP, ONE CLOCK, NO DRIFT. The pose is a pure function of the time into
// the loop. The loop begins and ends at rest (both ends at 0, no tilt, scale 1),
// so the clock can wrap from LOOP_MS back to 0 forever without the worm ever
// creeping away from where the art put it. Nothing accumulates between loops.
//
// Worklets, so the UI thread can read them directly; plain functions to the
// tests.

export const LOOP_MS = 5800;

// Tail and head keyframes, in STEPS (one step = STEP_OF_LENGTH of the worm's
// drawn length). Each track holds, then moves on a segment [from, to, a, b]:
// between ms `from` and `to` it goes a → b.
//
//   0.0–0.7s  rest
//   0.7–1.1s  tail pulls up           (bunch)
//   1.1–1.5s  head reaches forward    (stretch)          — first inch
//   1.5–1.7s  tail pulls up again
//   1.7–1.9s  head reaches again                          — second, smaller inch
//   1.9–3.0s  rest; the worm lifts its head and looks around
//   3.0–3.2s  head draws back         (bunch)
//   3.2–3.4s  tail pushes back        (stretch)          — first inch home
//   3.4–3.6s  head draws back
//   3.6–3.8s  tail pushes back                            — home, exactly
//   3.8–5.8s  rest
export const TAIL = [
  [700, 1100, 0, 1],
  [1500, 1700, 1, 2],
  [3200, 3400, 2, 1],
  [3600, 3800, 1, 0],
];
export const HEAD = [
  [1100, 1500, 0, 1],
  [1700, 1900, 1, 2],
  [3000, 3200, 2, 1],
  [3400, 3600, 1, 0],
];
// The look-around, during the long pause at the far end.
export const LOOK = [1950, 2900];

// One step is 12% of the worm's length, so two steps take it about a quarter
// of its own length forward — 16pt on a phone, where it draws ~69pt long.
export const STEP_OF_LENGTH = 0.12;
// How far the head reaches past its mark late in the stroke (once the tail
// has caught up, so the body visibly stretches), as a share of the length.
export const REACH = 0.08;
// How much taller the body gets per unit it is squashed (volume, roughly).
export const ARCH = 0.6;
// The look-up tilt, degrees. Negative is counter-clockwise: head up.
export const LOOK_DEG = -3;

function smooth(x) {
  'worklet';
  return x * x * (3 - 2 * x);
}

function clamp01(x) {
  'worklet';
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Where one end is (in steps) at `ms`, and how far through a move it is. */
function track(keys, ms) {
  'worklet';
  let at = 0;
  let moving = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (ms >= k[1]) at = k[3];
    else if (ms > k[0]) {
      const x = (ms - k[0]) / (k[1] - k[0]);
      at = k[2] + (k[3] - k[2]) * smooth(x);
      // Forward reaches overshoot; the way home does not.
      moving = k[3] > k[2] ? Math.sin(Math.PI * x ** 1.6) : 0;
      break;
    } else break;
  }
  return { at, moving };
}

/**
 * The worm at `ms` into the loop, for a sprite `length` points long.
 *
 *   tailX    how far the tail end has moved from rest, points
 *   length   the drawn length as a share of the art's (scaleX)
 *   arch     the drawn height as a share of the art's (scaleY)
 *   tilt     degrees, pivoting on the tail
 */
export function wormPose(ms, length) {
  'worklet';
  const t = ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const step = STEP_OF_LENGTH * length;
  const tail = track(TAIL, t);
  const head = track(HEAD, t);
  const headX = head.at * step + head.moving * REACH * length;
  const tailX = tail.at * step;
  const sx = (length + headX - tailX) / length;
  // Exactly 0 outside the look-around, not sin(π)'s 1e-16: the rest pose has
  // to be the rest pose, bit for bit, or the loop is not truly closed.
  const u = clamp01((t - LOOK[0]) / (LOOK[1] - LOOK[0]));
  const look = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
  return {
    tailX,
    scaleX: sx,
    scaleY: 1 + ARCH * (1 - sx),
    tilt: look === 0 ? 0 : LOOK_DEG * look * look,
  };
}

/**
 * The pose as a React Native transform for a `w`×`h` sprite whose bottom-left
 * corner (the tail, on the ground) stays planted at `tailX`.
 *
 * RN transforms pivot on the view's centre, so the pivot is done by hand: the
 * translate is whatever puts the scaled, rotated bottom-left corner back where
 * the tail should be. Numbers only — no transformOrigin string (see Chest.js).
 */
export function wormTransform(pose, w, h) {
  'worklet';
  const r = (pose.tilt * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // The bottom-left corner relative to the centre, after scale then rotate.
  const px = (-w / 2) * pose.scaleX;
  const py = (h / 2) * pose.scaleY;
  const rx = px * cos - py * sin;
  const ry = px * sin + py * cos;
  return [
    { translateX: -w / 2 + pose.tailX - rx },
    { translateY: h / 2 - ry },
    { rotate: `${pose.tilt}deg` },
    { scaleX: pose.scaleX },
    { scaleY: pose.scaleY },
  ];
}
