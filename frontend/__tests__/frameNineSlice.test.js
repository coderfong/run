/**
 * The native nine slice, and whether it draws the same box as the slice path.
 *
 * A frame used to cost sixteen native views per layer: eight clipped windows,
 * each holding an offset copy of the drawing. Measured, one feed card was 241
 * native views and about 150 of them were frames. iOS can do the whole job in
 * one view with `capInsets`, and ArtFrame now uses it wherever it can.
 *
 * The pixels are the compositor's business and no test here can see them. What
 * CAN be pinned is the arithmetic, and the arithmetic is the entire risk:
 *
 *   * a cap inset is measured in the IMAGE's points, not the box's, so it only
 *     lands on the corner boundary if the image's declared density is right;
 *   * and the app never draws these at their own scale — every frame is fitted
 *     to a point-valued line weight (see `weightScale`), which is exactly what
 *     a fixed cap inset would ignore.
 *
 * Get either wrong and every box in the app comes out with a corner two or
 * three times too heavy. So: same corner as the slice path, cut at the same
 * fraction of the drawing, at every weight and every box size.
 */

import React from 'react';
import { Image, Platform } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import ArtFrame, { capFrameGeometry, frameScale, sliceLayout } from '../src/ui/ArtFrame';
import { FRAMES, INK, getFrame, weightScale } from '../src/ui/frameRegistry';

const ALL = Object.keys(FRAMES);
const WEIGHTS = Object.values(INK);
const BOXES = [
  [320, 120],
  [140, 44],
  [64, 64],
  [300, 220],
];

describe('cap inset geometry', () => {
  it('cuts every frame at the same fraction of the drawing its insets were measured at', () => {
    // THE correctness property. `capInsets` are points into the image, so the
    // cut only falls on the corner the cutter measured if inset/point-size
    // equals inset/pixel-size. Anything else slices through the drawing.
    for (const id of ALL) {
      const spec = FRAMES[id];
      const g = capFrameGeometry(spec, 320, 160, weightScale(id, INK.base));
      expect(g).toBeTruthy();
      for (const [side, axis] of [
        ['left', 'width'],
        ['right', 'width'],
        ['top', 'height'],
        ['bottom', 'height'],
      ]) {
        const sourceAxis = axis === 'width' ? spec.frameWidth : spec.frameHeight;
        expect(g.capInsets[side] / g[axis]).toBeCloseTo(spec.insets[side] / sourceAxis, 10);
      }
    }
  });

  it('declares a density that makes the drawing measure what it is cut for', () => {
    // points * density === pixels, or the size hint and the cut disagree.
    for (const id of ALL) {
      const spec = FRAMES[id];
      const g = capFrameGeometry(spec, 200, 200, weightScale(id, INK.thin));
      expect(g.width * g.scale).toBeCloseTo(spec.frameWidth, 6);
      expect(g.height * g.scale).toBeCloseTo(spec.frameHeight, 6);
    }
  });

  it('draws the same corner the eight slices would, at every weight and size', () => {
    // The slice path rounds its corners to whole points; cap insets are left
    // exact, because rounding them would move the cut off the boundary. Half a
    // point apart is that rounding and nothing else.
    for (const id of ALL) {
      for (const weight of WEIGHTS) {
        for (const [w, h] of BOXES) {
          const spec = FRAMES[id];
          const scale = weightScale(id, weight);
          const g = capFrameGeometry(spec, w, h, scale);
          const layout = sliceLayout(spec, w, h, scale);
          const corner = layout.find((s) => s.key === 'tl');
          // The slice path's top-left corner box, in points.
          const drawnLeft = corner.rect.w * (corner.box.sheetW / spec.frameWidth);
          const drawnTop = corner.rect.h * (corner.box.sheetH / spec.frameHeight);
          expect(Math.abs(g.capInsets.left - drawnLeft)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(g.capInsets.top - drawnTop)).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('honours the line weight rather than the drawing’s own size', () => {
    // The whole reason a fixed cap inset is not enough. A heavier weight has to
    // come out as a proportionally heavier corner, on the same box.
    const spec = getFrame('panel');
    const thin = capFrameGeometry(spec, 300, 200, weightScale('panel', INK.thin));
    const bold = capFrameGeometry(spec, 300, 200, weightScale('panel', INK.bold));
    expect(bold.capInsets.left / thin.capInsets.left).toBeCloseTo(INK.bold / INK.thin, 6);
    // And a heavier line means a denser declared image, not a bigger one.
    expect(bold.scale).toBeLessThan(thin.scale);
  });

  it('always leaves a middle to stretch, even on a box smaller than its corners', () => {
    // `frameScale` is the clamp that guarantees this; cap insets that met or
    // crossed in the middle would be an invalid resizable image.
    for (const id of ALL) {
      const g = capFrameGeometry(FRAMES[id], 24, 20, weightScale(id, INK.heavy));
      expect(g.capInsets.left + g.capInsets.right).toBeLessThan(24);
      expect(g.capInsets.top + g.capInsets.bottom).toBeLessThan(20);
    }
  });

  it('has nothing to draw when the box has no size', () => {
    expect(capFrameGeometry(FRAMES[ALL[0]], 0, 100, 1)).toBeNull();
    expect(capFrameGeometry(null, 100, 100, 1)).toBeNull();
    // A zero fit would mean a division by zero in the declared density.
    expect(frameScale(FRAMES[ALL[0]], 100, 100, 0)).toBe(0);
    expect(capFrameGeometry(FRAMES[ALL[0]], 100, 100, 0)).toBeNull();
  });
});

// Every frame has to have been cut, or the fast path silently never engages and
// the win quietly disappears. scripts/split-frame-poses.py emits these.
describe('the pose files', () => {
  it('exist for both layers of every frame, one per drawing', () => {
    for (const id of ALL) {
      const spec = FRAMES[id];
      expect(spec.posesInk).toHaveLength(spec.frameCount);
      expect(spec.posesPaper).toHaveLength(spec.frameCount);
      spec.posesInk.forEach((src) => expect(src).toBeTruthy());
      spec.posesPaper.forEach((src) => expect(src).toBeTruthy());
    }
  });
});

const hosts = (tree) => {
  let n = 0;
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (typeof node.type === 'string') n += 1;
    walk(node.children);
  };
  walk(tree.toJSON());
  return n;
};

const render = (element) => {
  let tree;
  act(() => { tree = renderer.create(element); });
  return tree;
};

describe('what ArtFrame actually renders', () => {
  // These assert the SHAPE of the output, not a magic number: one view per
  // layer plus the container, versus two per slice per layer plus the
  // container. Stated as a comparison so the numbers cannot drift apart.
  const SLICES = 8;

  it('draws a still frame as one view per layer on iOS', () => {
    expect(Platform.OS).toBe('ios');
    const ink = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    // container + one image
    expect(hosts(ink)).toBe(2);
    act(() => ink.unmount());

    const both = render(
      <ArtFrame name="panel" layer="both" width={300} height={140} tint="#111" fill="#fff" />
    );
    // container + paper + ink
    expect(hosts(both)).toBe(3);
    act(() => both.unmount());
  });

  it('passes cap insets and a density down to the image', () => {
    const tree = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    const [img] = tree.root.findAllByType(Image);
    const spec = getFrame('panel');
    const g = capFrameGeometry(spec, 300, 140, 1);
    expect(img.props.capInsets).toEqual(g.capInsets);
    expect(img.props.source.scale).toBeCloseTo(g.scale, 10);
    expect(img.props.resizeMode).toBe('stretch');
    act(() => tree.unmount());
  });

  it('falls back to the eight slices for a boiling frame', () => {
    // The boil steps through the three drawings by translating one strip on the
    // UI thread. There is no source to swap per frame in a resizable image, so
    // this path keeps its windows — and boiling frames are deliberately rare.
    const tree = render(<ArtFrame name="panel" width={300} height={140} tint="#111" boil />);
    expect(hosts(tree)).toBe(1 + SLICES * 2);
    act(() => tree.unmount());
  });
});
