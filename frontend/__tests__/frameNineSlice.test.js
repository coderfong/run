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
import { Image, Platform, StyleSheet } from 'react-native';
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

  it('lays the image out at the BOX, not at the drawing’s own size', () => {
    // THE ONE THAT GOT AWAY. Everything above pins what is HANDED to the
    // image; nothing pinned how big the image is drawn, and that is where the
    // fast path broke on the first device that ran it — every frame in the app
    // came out as a small box in the top left corner of whatever it was meant
    // to wrap.
    //
    // The cause is in RN itself. `Image.ios.js` builds its style as
    //
    //   [{width, height}, styles.base, props.style]
    //
    // where the width and height are the SOURCE's declared point size — and
    // this path declares one deliberately, because that is how the line weight
    // survives a cap inset. `StyleSheet.absoluteFill` is `position` and four
    // offsets with no dimensions of its own, so it cannot overwrite them, and
    // an absolutely positioned node with an explicit width ignores `right`.
    //
    // So: assert the style resolves to the box, and assert the drawing's own
    // size is genuinely a different number, or this passes for the wrong
    // reason the day the art is redrawn at 300x140.
    for (const [w, h] of BOXES) {
      const tree = render(<ArtFrame name="panel" width={w} height={h} tint="#111" />);
      const [img] = tree.root.findAllByType(Image);
      const style = StyleSheet.flatten([
        // Exactly what RN prepends, so this fails if the style ever stops
        // overriding it rather than merely if the box is wrong.
        { width: img.props.source.width, height: img.props.source.height },
        img.props.style,
      ]);
      expect(style.width).toBe(w);
      expect(style.height).toBe(h);
      expect(img.props.source.width).not.toBeCloseTo(w, 3);
      act(() => tree.unmount());
    }
  });

  it('remounts the image when the fitted geometry moves', () => {
    // Fabric applies `capInsets` only as a freshly loaded image is made
    // resizable, and treats two sources with the same uri as the same image
    // however their density differs — so nothing short of a remount re-cuts
    // the corners. A frame small enough for the corner-fit clamp to bite has a
    // different `fitted` from the same frame given room, and must not be
    // reconciled onto the first one's image.
    const spec = getFrame('panel');
    const big = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    const small = render(<ArtFrame name="panel" width={30} height={24} tint="#111" />);
    expect(frameScale(spec, 30, 24, 1)).toBeLessThan(frameScale(spec, 300, 140, 1));
    expect(big.root.findAllByType(Image)[0].props.capInsets).not.toEqual(
      small.root.findAllByType(Image)[0].props.capInsets
    );
    expect(capFrameGeometry(spec, 30, 24, 1).fitted).not.toBe(
      capFrameGeometry(spec, 300, 140, 1).fitted
    );
    act(() => big.unmount());
    act(() => small.unmount());
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
