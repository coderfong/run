/**
 * The first-run tutorial.
 *
 * Everything here is pinned WITHOUT a device, because the three things most
 * likely to go wrong are all decidable from numbers:
 *
 *   1. who gets put through it (an existing runner must never be),
 *   2. where the card and the runner land on a small phone,
 *   3. that the hole in the scrim is never covered by the thing that blocks
 *      touches — which is what keeps the real Start button pressable.
 *
 * The config itself is checked too: a step pointing at a target that does not
 * exist, or copy carrying a dash, are both invisible until somebody opens the
 * app.
 */

import { PHASE, CORE_ORDER, RECORD_PHASES, nextPhase, resumePhase } from '../src/tutorial/phases';
import {
  CORE,
  TIP,
  TUTORIAL_VERSION,
  advanced,
  armed,
  coreActive,
  decideCoreState,
  hasSeenTip,
  normalise,
  skipped,
  tipSeen,
} from '../src/tutorial/progress';
import {
  CARD_MAX_W,
  EDGE,
  blockerSlabs,
  cardWidth,
  placeCard,
  placeCoach,
  roundedRectPath,
  scrimPath,
  spotlightRect,
} from '../src/tutorial/layout';
import { parseHighlights, plainText } from '../src/tutorial/highlight';
import { STEPS, stepFor } from '../src/tutorial/steps';
import { TIPS } from '../src/tutorial/tips';
import { TARGET_NAMES } from '../src/tutorial/targets';
import { SIGNAL_NAMES } from '../src/tutorial/signals';

// A 375x812 phone (iPhone SE 3 / 13 mini territory) — the small one everything
// has to survive — and a 430x932 one for the other end.
const SMALL = { width: 375, height: 812 };
const LARGE = { width: 430, height: 932 };
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
const NO_INSETS = { top: 20, bottom: 0, left: 0, right: 0 };

// ---------------------------------------------------------------------------
// Who is put through it
// ---------------------------------------------------------------------------

describe('decideCoreState', () => {
  it('arms an account that has just finished the intro', () => {
    const out = decideCoreState({ tutorialPending: true, introDone: true, runCount: 0 });
    expect(out.core).toBe(CORE.RUNNING);
    expect(out.phase).toBe(PHASE.WELCOME);
    expect(out.reason).toBe('intro_just_finished');
  });

  it('arms an account that ran the intro but has never finished a run', () => {
    const out = decideCoreState({ tutorialPending: false, introDone: true, runCount: 0 });
    expect(out.core).toBe(CORE.RUNNING);
    expect(out.reason).toBe('no_runs_yet');
  });

  it('LEAVES AN EXISTING RUNNER ALONE', () => {
    const out = decideCoreState({ tutorialPending: false, introDone: true, runCount: 42 });
    expect(out.core).toBe(CORE.IDLE);
    expect(out.reason).toBe('existing_account');
  });

  it('leaves alone an account that predates the intro entirely', () => {
    const out = decideCoreState({ tutorialPending: false, introDone: false, runCount: 3 });
    expect(out.core).toBe(CORE.IDLE);
  });

  // The conservative rule: absence of evidence arms nothing.
  it('does not decide anything while the run count is unknown', () => {
    const out = decideCoreState({ tutorialPending: false, introDone: true, runCount: null });
    expect(out.core).toBe(CORE.IDLE);
    expect(out.reason).toBe('runs_unknown');
  });

  it('still arms on the pending flag even with the run count unknown', () => {
    const out = decideCoreState({ tutorialPending: true, introDone: true, runCount: null });
    expect(out.core).toBe(CORE.RUNNING);
  });

  it('never overrides a decision already stored', () => {
    const record = { ...normalise(null), core: CORE.SKIPPED, phase: PHASE.COMPLETE };
    const out = decideCoreState({ record, tutorialPending: true, introDone: true, runCount: 0 });
    expect(out.core).toBe(CORE.SKIPPED);
  });
});

// ---------------------------------------------------------------------------
// The stored record
// ---------------------------------------------------------------------------

describe('normalise', () => {
  it('fills an empty record', () => {
    const out = normalise(null);
    expect(out.version).toBe(TUTORIAL_VERSION);
    expect(out.core).toBe(CORE.IDLE);
    expect(out.tips).toEqual({});
  });

  it('survives junk', () => {
    expect(normalise('nonsense').core).toBe(CORE.IDLE);
    expect(normalise({ core: 'banana', tips: 7 }).tips).toEqual({});
  });

  it('treats a record from an older tutorial as already taught', () => {
    const out = normalise({ version: 0, core: CORE.DONE, tips: { club: true } });
    expect(out.core).toBe(CORE.DONE);
    expect(out.version).toBe(TUTORIAL_VERSION);
    // Tips a runner has already seen are not shown again by a version bump.
    expect(out.tips.club).toBe(true);
  });

  it('rewinds a running record to a phase that can actually resolve', () => {
    const out = normalise({ version: TUTORIAL_VERSION, core: CORE.RUNNING, phase: 'not-a-phase' });
    expect(CORE_ORDER).toContain(out.phase);
  });
});

describe('progress transitions', () => {
  it('completes when it reaches the end', () => {
    const out = advanced(armed(null), PHASE.COMPLETE);
    expect(out.core).toBe(CORE.DONE);
    expect(out.completedAt).toBeTruthy();
    expect(coreActive(out)).toBe(false);
  });

  it('skipping is not completing', () => {
    expect(skipped(armed(null)).core).toBe(CORE.SKIPPED);
  });

  it('records tips without disturbing the core', () => {
    const out = tipSeen(advanced(armed(null), PHASE.COMPLETE), TIP.CLUB);
    expect(hasSeenTip(out, TIP.CLUB)).toBe(true);
    expect(hasSeenTip(out, TIP.LEADERBOARD)).toBe(false);
    expect(out.core).toBe(CORE.DONE);
  });

  it('replaying clears nothing but the tutorial', () => {
    const out = armed({ version: TUTORIAL_VERSION, core: CORE.DONE, tips: { club: true } });
    expect(out.core).toBe(CORE.RUNNING);
    expect(out.phase).toBe(PHASE.WELCOME);
  });
});

// ---------------------------------------------------------------------------
// Interruption
// ---------------------------------------------------------------------------

describe('resumePhase', () => {
  // The run branch is the PRACTICE run now: an abandoned one plays again from
  // its own card, and never re-teaches the world before it.
  it('restarts an abandoned practice run from its own card', () => {
    RECORD_PHASES.forEach((phase) => {
      if (phase === PHASE.FIRST_CLAIM_SUCCESS) return;
      expect(resumePhase(phase)).toBe(PHASE.TRAINING_RUN);
    });
  });

  // Once the practice claim has landed there is nothing left to replay.
  it('carries on forward from a practice claim that already landed', () => {
    expect(resumePhase(PHASE.FIRST_CLAIM_SUCCESS)).toBe(PHASE.TRAINING_RIVAL);
  });

  it('plays the practice run straight after the practice card', () => {
    expect(nextPhase(PHASE.TRAINING_RUN)).toBe(PHASE.ACTIVE_RUN);
    expect(nextPhase(PHASE.FIRST_CLAIM_SUCCESS)).toBe(PHASE.TRAINING_RIVAL);
    expect(nextPhase(PHASE.START_RUN)).toBe(PHASE.COMPLETE);
  });

  it('picks up exactly where it was during the tour', () => {
    expect(resumePhase(PHASE.TERRITORY)).toBe(PHASE.TERRITORY);
    expect(resumePhase(PHASE.CORE_LOOP)).toBe(PHASE.CORE_LOOP);
  });

  it('stays finished once finished', () => {
    expect(resumePhase(PHASE.COMPLETE)).toBe(PHASE.COMPLETE);
  });

  it('falls back to the start for a phase it does not know', () => {
    expect(resumePhase('who-knows')).toBe(PHASE.WELCOME);
    expect(resumePhase(undefined)).toBe(PHASE.WELCOME);
  });
});

describe('nextPhase', () => {
  it('walks the tour in order and stops at complete', () => {
    let phase = PHASE.WELCOME;
    const seen = [phase];
    for (let i = 0; i < 20 && phase !== PHASE.COMPLETE; i += 1) {
      phase = nextPhase(phase);
      seen.push(phase);
    }
    expect(phase).toBe(PHASE.COMPLETE);
    expect(seen).toEqual(CORE_ORDER);
  });
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

describe('placeCard', () => {
  const height = 140;

  it('sits BELOW a target near the top', () => {
    const rect = { x: 40, y: 80, width: 200, height: 60 };
    const out = placeCard({ rect, screen: SMALL, insets: INSETS, height });
    expect(out.side).toBe('below');
    expect(out.top).toBeGreaterThan(rect.y + rect.height);
  });

  it('sits ABOVE a target near the bottom', () => {
    const rect = { x: 150, y: 700, width: 72, height: 72 };
    const out = placeCard({ rect, screen: SMALL, insets: INSETS, height });
    expect(out.side).toBe('above');
    expect(out.top + height).toBeLessThan(rect.y);
  });

  it('never runs off the left or right of a small phone', () => {
    [0, 10, 180, 360, 375].forEach((x) => {
      const out = placeCard({
        rect: { x, y: 300, width: 40, height: 40 },
        screen: SMALL,
        insets: INSETS,
        height,
      });
      expect(out.left).toBeGreaterThanOrEqual(EDGE);
      expect(out.left + out.width).toBeLessThanOrEqual(SMALL.width - EDGE);
    });
  });

  it('never runs off the top or bottom, whatever the target', () => {
    [-50, 0, 400, 780, 900].forEach((y) => {
      const out = placeCard({
        rect: { x: 100, y, width: 120, height: 60 },
        screen: SMALL,
        insets: INSETS,
        height,
      });
      expect(out.top).toBeGreaterThanOrEqual(INSETS.top + EDGE);
      expect(out.top + height).toBeLessThanOrEqual(SMALL.height - INSETS.bottom - EDGE);
    });
  });

  it('centres a step with no target', () => {
    const out = placeCard({ rect: null, screen: SMALL, insets: INSETS, height });
    expect(out.side).toBe('center');
    expect(Math.abs(out.left + out.width / 2 - SMALL.width / 2)).toBeLessThan(1);
  });

  it('overlaps a target too tall for either side rather than going off screen', () => {
    // The map board: almost the whole window.
    const rect = { x: 20, y: 60, width: 335, height: 700 };
    const out = placeCard({ rect, screen: SMALL, insets: INSETS, height });
    expect(out.top).toBeGreaterThanOrEqual(INSETS.top + EDGE);
    expect(out.top + height).toBeLessThanOrEqual(SMALL.height - INSETS.bottom - EDGE);
  });

  it('caps its width on a big phone and fills a small one', () => {
    expect(cardWidth(LARGE)).toBe(CARD_MAX_W);
    expect(cardWidth({ width: 320, height: 640 })).toBe(320 - EDGE * 2);
  });
});

describe('placeCoach', () => {
  const card = { left: 30, top: 400, width: 320, height: 140 };
  const size = { width: 46, height: 135 };

  it('stands on the card and looks toward the spotlight', () => {
    const right = placeCoach({
      rect: { x: 300, y: 600, width: 60, height: 60 },
      card,
      screen: SMALL,
      insets: INSETS,
      ...size,
    });
    expect(right.visible).toBe(true);
    expect(right.facing).toBe(1);
    expect(right.top + right.height).toBeLessThanOrEqual(card.top + 12);

    const left = placeCoach({
      rect: { x: 0, y: 600, width: 60, height: 60 },
      card,
      screen: SMALL,
      insets: INSETS,
      ...size,
    });
    expect(left.facing).toBe(-1);
  });

  it('shrinks rather than covering its own card when the card is high up', () => {
    const tight = placeCoach({
      rect: null,
      card: { ...card, top: INSETS.top + 100 },
      screen: SMALL,
      insets: INSETS,
      ...size,
    });
    if (tight.visible) {
      expect(tight.height).toBeLessThan(size.height);
      expect(tight.top).toBeGreaterThanOrEqual(INSETS.top);
    }
  });

  it('steps off the screen entirely when there is no room at all', () => {
    const out = placeCoach({
      rect: null,
      card: { ...card, top: INSETS.top + 4 },
      screen: SMALL,
      insets: INSETS,
      ...size,
    });
    expect(out.visible).toBe(false);
  });

  it('stays inside the screen horizontally', () => {
    const out = placeCoach({
      rect: { x: 360, y: 700, width: 20, height: 20 },
      card: { left: 300, top: 400, width: 60, height: 140 },
      screen: SMALL,
      insets: INSETS,
      ...size,
    });
    if (out.visible) {
      expect(out.left).toBeGreaterThanOrEqual(EDGE);
      expect(out.left + out.width).toBeLessThanOrEqual(SMALL.width - EDGE);
    }
  });
});

// ---------------------------------------------------------------------------
// The hole
// ---------------------------------------------------------------------------

describe('spotlightRect', () => {
  it('pads a target, and pads a small one harder', () => {
    const big = spotlightRect({ x: 100, y: 100, width: 200, height: 200 }, SMALL);
    expect(big.width).toBeGreaterThan(200);

    const small = spotlightRect({ x: 100, y: 100, width: 34, height: 34 }, SMALL);
    const bigPad = (big.width - 200) / 2;
    const smallPad = (small.width - 34) / 2;
    expect(smallPad).toBeGreaterThan(bigPad);
  });

  it('is nothing at all for a target with no size', () => {
    expect(spotlightRect(null, SMALL)).toBeNull();
    expect(spotlightRect({ x: 0, y: 0, width: 0, height: 0 }, SMALL)).toBeNull();
  });

  it('trims to the window rather than sliding off the thing it points at', () => {
    const out = spotlightRect({ x: -20, y: -10, width: 80, height: 80 }, SMALL);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.x + out.width).toBeLessThanOrEqual(SMALL.width);
  });

  it('keeps the corner radius under half the short side', () => {
    const out = spotlightRect({ x: 10, y: 10, width: 200, height: 12 }, SMALL);
    expect(out.radius).toBeLessThanOrEqual(out.height / 2);
  });
});

describe('blockerSlabs', () => {
  const rect = { x: 140, y: 600, width: 90, height: 90, radius: 20 };

  const covers = (slabs, px, py) =>
    slabs.some((s) => px >= s.left && px <= s.left + s.width && py >= s.top && py <= s.top + s.height);

  it('NEVER covers the hole — this is what keeps the real button pressable', () => {
    const slabs = blockerSlabs(rect, SMALL);
    expect(covers(slabs, rect.x + rect.width / 2, rect.y + rect.height / 2)).toBe(false);
    expect(covers(slabs, rect.x + 1, rect.y + 1)).toBe(false);
  });

  it('covers everything else', () => {
    const slabs = blockerSlabs(rect, SMALL);
    expect(covers(slabs, 10, 10)).toBe(true);
    expect(covers(slabs, 300, 700)).toBe(true);
    expect(covers(slabs, 187, 300)).toBe(true);
    expect(covers(slabs, 187, 790)).toBe(true);
  });

  it('leaves the escape strip at the top unblocked', () => {
    const slabs = blockerSlabs(rect, SMALL, { safeTop: 90 });
    // The close button lives up here. It must keep working.
    expect(covers(slabs, 24, 60)).toBe(false);
    expect(covers(slabs, 24, 120)).toBe(true);
  });

  it('covers the window when there is no hole', () => {
    const slabs = blockerSlabs(null, SMALL);
    expect(covers(slabs, 1, 1)).toBe(true);
    expect(covers(slabs, SMALL.width - 1, SMALL.height - 1)).toBe(true);
  });

  it('emits no zero-sized slabs', () => {
    const flush = { x: 0, y: 0, width: SMALL.width, height: 100 };
    blockerSlabs(flush, SMALL).forEach((s) => {
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
    });
  });
});

describe('scrimPath', () => {
  it('is the window with a second, closed subpath cut out of it', () => {
    const d = scrimPath({ x: 10, y: 20, width: 100, height: 60, radius: 12 }, SMALL);
    // Two subpaths: the outer window and the hole. `evenodd` is what makes the
    // second one a hole rather than a second filled box.
    expect(d.match(/M/g).length).toBeGreaterThanOrEqual(2);
    expect(d.startsWith(`M0,0 H${SMALL.width} V${SMALL.height} H0 Z`)).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('is just the window when there is no hole', () => {
    expect(scrimPath(null, SMALL)).toBe(`M0,0 H${SMALL.width} V${SMALL.height} H0 Z`);
  });

  // scrimPath is a worklet and cannot call out of itself (a cross-module call
  // from the UI thread comes back "not a function", which is a silent abort in
  // release), so it carries its own copy of the rounded rectangle. This is the
  // test that stops the two drifting apart.
  it('builds exactly the rectangle roundedRectPath builds', () => {
    [
      { x: 10, y: 20, width: 100, height: 60, radius: 12 },
      { x: 0, y: 0, width: 40, height: 40, radius: 0 },
      { x: 5, y: 5, width: 10, height: 200, radius: 40 },
    ].forEach((rect) => {
      expect(scrimPath(rect, SMALL)).toBe(
        `M0,0 H${SMALL.width} V${SMALL.height} H0 Z ${roundedRectPath(rect)}`
      );
    });
  });

  it('draws a square corner when the radius is zero', () => {
    expect(roundedRectPath({ x: 0, y: 0, width: 10, height: 10 })).toBe('M0,0 H10 V10 H0 Z');
  });

  it('never lets the corner arcs overrun each other', () => {
    const d = roundedRectPath({ x: 0, y: 0, width: 10, height: 10, radius: 40 });
    // Clamped to half the short side: 5, not 40.
    expect(d).toContain('A5,5');
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe('parseHighlights', () => {
  it('splits emphasis out of a line', () => {
    expect(parseHighlights('This is *YOUR TERRITORY*.')).toEqual([
      { text: 'This is ', strong: false },
      { text: 'YOUR TERRITORY', strong: true },
      { text: '.', strong: false },
    ]);
  });

  it('leaves a stray marker visible rather than eating the sentence', () => {
    expect(plainText('Ready * set go')).toBe('Ready * set go');
  });

  it('copes with nothing', () => {
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights(undefined)).toEqual([]);
  });

  it('reads back the same words without the markup', () => {
    expect(plainText('Tap here to *start your run*.')).toBe('Tap here to start your run.');
  });
});

// ---------------------------------------------------------------------------
// The config itself
// ---------------------------------------------------------------------------

const FACT_SHAPES = [
  {},
  { ownsLand: true, route: 'MapMain', running: true, claimReady: true },
  { ownsLand: false, route: 'HomeMain', playerLocated: false },
];

function everyLine() {
  const lines = [];
  STEPS.forEach((step) => {
    FACT_SHAPES.forEach((facts) => {
      const copy = step.copy(facts);
      lines.push(copy.title, ...copy.lines);
    });
    if (step.cta) lines.push(step.cta);
  });
  Object.values(TIPS).forEach((tip) => lines.push(tip.title, ...tip.lines));
  return lines;
}

describe('the step config', () => {
  it('has one step per core phase, in order', () => {
    const phases = STEPS.map((s) => s.phase);
    expect(phases).toEqual(CORE_ORDER.filter((p) => p !== PHASE.COMPLETE));
  });

  it('puts the run and claim steps in the modal host, and nothing else there', () => {
    STEPS.forEach((step) => {
      expect(step.host).toBe(RECORD_PHASES.has(step.phase) ? 'record' : 'root');
    });
  });

  it('only points at targets that exist', () => {
    STEPS.forEach((step) => {
      if (step.target) expect(TARGET_NAMES).toContain(step.target);
    });
    Object.values(TIPS).forEach((tip) => {
      if (tip.target) expect(TARGET_NAMES).toContain(tip.target);
    });
  });

  it('only listens for signals that exist, and only moves to real phases', () => {
    STEPS.forEach((step) => {
      Object.entries(step.on || {}).forEach(([signal, phase]) => {
        expect(SIGNAL_NAMES).toContain(signal);
        expect(CORE_ORDER).toContain(phase);
      });
    });
  });

  it('gives every action step a real signal to end on', () => {
    STEPS.filter((s) => s.dismiss === 'action').forEach((step) => {
      // START_RUN is ended by the navigator reaching the record modal, which
      // is derived rather than signalled; everything else names its signals.
      if (step.phase === PHASE.START_RUN) return;
      expect(Object.keys(step.on || {}).length).toBeGreaterThan(0);
    });
  });

  it('gives every cta step something to press', () => {
    STEPS.filter((s) => s.dismiss === 'cta').forEach((step) => {
      expect(typeof step.cta).toBe('string');
      expect(step.cta.length).toBeGreaterThan(0);
    });
  });

  it('gives every auto step a duration', () => {
    STEPS.filter((s) => s.dismiss === 'auto').forEach((step) => {
      expect(step.autoMs).toBeGreaterThan(1000);
    });
  });

  it('is reachable: stepFor answers for every phase in the order', () => {
    CORE_ORDER.filter((p) => p !== PHASE.COMPLETE).forEach((phase) => {
      expect(stepFor(phase)).toBeTruthy();
    });
    expect(stepFor(PHASE.COMPLETE)).toBeNull();
  });
});

describe('the copy', () => {
  // The app-wide rule: no em dash, no en dash, no hyphen anywhere a runner can
  // read it. `·` is the placeholder for an empty value; a dash is never one.
  it('carries no dashes of any kind', () => {
    everyLine().forEach((line) => {
      expect(line).not.toMatch(/[-‐-―−]/);
    });
  });

  it('stays short enough to read at a glance', () => {
    everyLine().forEach((line) => {
      const words = plainText(line).split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(12);
    });
  });

  it('says something on every step, for every shape the facts can take', () => {
    STEPS.forEach((step) => {
      FACT_SHAPES.forEach((facts) => {
        const copy = step.copy(facts);
        expect(typeof copy.title).toBe('string');
        expect(copy.title.length).toBeGreaterThan(0);
        expect(Array.isArray(copy.lines)).toBe(true);
        expect(copy.lines.length).toBeLessThanOrEqual(2);
      });
    });
  });

  it('gives the territory step a true sentence whether or not there is land', () => {
    const step = stepFor(PHASE.TERRITORY);
    expect(step.copy({ ownsLand: true }).title).not.toBe(step.copy({ ownsLand: false }).title);
  });
});

describe('the tips', () => {
  it('has one for every TIP key', () => {
    Object.values(TIP).forEach((key) => {
      expect(TIPS[key]).toBeTruthy();
      expect(TIPS[key].key).toBe(key);
    });
  });
});
