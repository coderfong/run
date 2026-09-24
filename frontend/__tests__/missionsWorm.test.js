// The Missions board worm: an inchworm loop that always comes home.
//
// The pose is a pure function of time into the loop, so these walk it frame by
// frame and hold it to the acceptance rules: it inches (the two ends move in
// turn and the body squashes and stretches), it rests, it travels a little,
// and every loop ends exactly where it began.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { HEAD, LOOP_MS, TAIL, wormPose, wormTransform } from '../src/components/missions/wormTimeline';
import MissionsBoard, { BOARD, PAPER, WORM_BOX, boardFrame } from '../src/components/missions/MissionsBoard';

const LENGTH = 69; // the worm's drawn length on a 393pt iPhone
const REST = { tailX: 0, scaleX: 1, scaleY: 1, tilt: 0 };
const frames = (step = 10) => Array.from({ length: LOOP_MS / step + 1 }, (_, i) => i * step);

function expectPose(pose, want) {
  for (const k of Object.keys(want)) expect(pose[k]).toBeCloseTo(want[k], 6);
}

describe('the worm loop', () => {
  test('starts and ends every loop at rest, exactly', () => {
    expectPose(wormPose(0, LENGTH), REST);
    expectPose(wormPose(LOOP_MS - 1e-9, LENGTH), REST);
    expectPose(wormPose(LOOP_MS, LENGTH), REST);
    // Ten loops in, still the same pose at the same point in the loop.
    for (const ms of [800, 1300, 2400, 3300]) {
      expect(wormPose(ms + 10 * LOOP_MS, LENGTH)).toEqual(wormPose(ms, LENGTH));
    }
  });

  test('both ends finish every track back at 0', () => {
    expect(TAIL[TAIL.length - 1][3]).toBe(0);
    expect(HEAD[HEAD.length - 1][3]).toBe(0);
  });

  test('inches rather than slides: the ends never move together, and the body squashes and stretches', () => {
    const moving = (keys, ms) => keys.some(([a, b]) => ms > a && ms < b);
    for (const ms of frames()) expect(moving(TAIL, ms) && moving(HEAD, ms)).toBe(false);
    const sx = frames().map((ms) => wormPose(ms, LENGTH).scaleX);
    expect(Math.min(...sx)).toBeLessThan(0.9);
    expect(Math.max(...sx)).toBeGreaterThan(1.03);
    // Squashed means taller (the arch); stretched means flatter.
    const bunched = frames().map((ms) => wormPose(ms, LENGTH)).find((p) => p.scaleX < 0.9);
    expect(bunched.scaleY).toBeGreaterThan(1.05);
  });

  test('travels a little, forward then back, and never behind where it started', () => {
    const heads = frames().map((ms) => {
      const p = wormPose(ms, LENGTH);
      return p.tailX + LENGTH * p.scaleX - LENGTH;
    });
    const tails = frames().map((ms) => wormPose(ms, LENGTH).tailX);
    expect(Math.max(...tails)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...tails)).toBeLessThanOrEqual(24);
    expect(Math.min(...tails)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heads)).toBeLessThanOrEqual(24 + 0.05 * LENGTH);
  });

  test('rests: long stretches of the loop with nothing moving at all', () => {
    const still = (a, b) => frames().filter((ms) => ms >= a && ms <= b)
      .every((ms) => wormPose(ms, LENGTH).scaleX === wormPose(a, LENGTH).scaleX
        && wormPose(ms, LENGTH).tailX === wormPose(a, LENGTH).tailX);
    expect(still(0, 700)).toBe(true);
    expect(still(1900, 3000)).toBe(true); // it looks around, but does not travel
    expect(still(3800, LOOP_MS)).toBe(true);
  });

  test('looks up a few degrees while it rests at the far end, and only then', () => {
    const tilts = frames().map((ms) => [ms, wormPose(ms, LENGTH).tilt]);
    const peak = Math.min(...tilts.map(([, t]) => t));
    expect(peak).toBeLessThanOrEqual(-2.5);
    expect(peak).toBeGreaterThanOrEqual(-3);
    for (const [ms, t] of tilts) if (ms < 1900 || ms > 3000) expect(t).toBe(0);
  });

  test('the transform keeps the tail planted at tailX, whatever the squash or tilt', () => {
    const w = LENGTH;
    const h = 45;
    for (const ms of frames(50)) {
      const pose = wormPose(ms, w);
      const [tx, ty, rot, sx, sy] = wormTransform(pose, w, h);
      // Apply scale, rotate, translate to the bottom-left corner about the centre.
      const r = (parseFloat(rot.rotate) * Math.PI) / 180;
      const px = (-w / 2) * sx.scaleX;
      const py = (h / 2) * sy.scaleY;
      const x = px * Math.cos(r) - py * Math.sin(r) + tx.translateX;
      const y = px * Math.sin(r) + py * Math.cos(r) + ty.translateY;
      expect(x).toBeCloseTo(-w / 2 + pose.tailX, 6);
      expect(y).toBeCloseTo(h / 2, 6);
    }
    expect(wormTransform(wormPose(0, w), w, h).slice(0, 2)).toEqual([{ translateX: 0 }, { translateY: 0 }]);
  });
});

describe('the board', () => {
  test('the worm sits in the grass below the parchment it is drawn under', () => {
    expect(WORM_BOX.y).toBeGreaterThan(PAPER.bottom);
    expect(WORM_BOX.x + WORM_BOX.width).toBeLessThan(BOARD.width);
    const f = boardFrame(393, 852);
    expect(f.y(WORM_BOX.y)).toBeGreaterThan(f.y(PAPER.bottom));
    expect(f.y(WORM_BOX.y + WORM_BOX.height)).toBeLessThanOrEqual(852);
  });

  test('is decoration: nothing on it takes a touch, and it unmounts cleanly', () => {
    jest.useFakeTimers();
    let tree;
    act(() => { tree = renderer.create(<MissionsBoard />); });
    const root = tree.root.findAll((n) => n.props?.pointerEvents === 'none');
    expect(root.length).toBeGreaterThan(0);
    act(() => tree.update(<MissionsBoard active={false} />));
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
