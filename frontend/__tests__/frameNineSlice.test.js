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
 *   * a cap inset is measured in the UIImage's OWN points, and which density
 *     that image comes back at is decided by where it is loaded from — not by
 *     anything the source declares (see `capImageDensity`);
 *   * and the app never draws these at their own scale — every frame is fitted
 *     to a point-valued line weight (see `weightScale`), which a cap inset
 *     cannot carry, so a transform does.
 *
 * Get either wrong and every box in the app comes out with its corners two or
 * three times too heavy and smeared along the edges. That shipped, in release
 * builds, while every dev build looked right — because Metro's art decodes at
 * the screen's 3x and a bundled file loads at 1x. So the arithmetic is pinned
 * at every density a device can hand back, not only the one dev happens to use.
 */

import React from 'react';
import { Image, PixelRatio, Platform, StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import ArtFrame, {
  capDensityHolds,
  capFrameGeometry,
  capImageDensity,
  frameScale,
  resetCapTrust,
  sliceLayout,
} from '../src/ui/ArtFrame';
import { FRAMES, INK, getFrame, weightScale } from '../src/ui/frameRegistry';

const ALL = Object.keys(FRAMES);
const WEIGHTS = Object.values(INK);
const DENSITIES = [1, 2, 3];
const SIDES = ['left', 'right', 'top', 'bottom'];
const BOXES = [
  [320, 120],
  [140, 44],
  [64, 64],
  [300, 220],
];

describe('the density the image comes back at', () => {
  it('is the screen scale for art streamed from Metro', () => {
    // Fabric stamps the screen's scale on every image request, and the network
    // decoder honours it. This is the dev build, and it is why dev looked right.
    const metro = 'http://192.168.1.4:8081/assets/assets/frames/poses/frame_panel_p0.png?platform=ios&hash=ab12';
    expect(capImageDensity(metro, 3)).toBe(3);
    expect(capImageDensity('https://cdn.example.com/frame.png', 2)).toBe(2);
  });

  it('is the file’s own density for art bundled into the app', () => {
    // THE CASE THAT BROKE. A release build loads the pose out of the app bundle
    // through UIImage imageNamed:, which reads the density off the FILE NAME
    // and ignores the request. A 1x file is a 1x image, even on a 3x phone.
    const bundled = 'file:///var/containers/Bundle/Application/X/PASER.app/assets/assets/frames/poses/frame_panel_p0.png';
    expect(capImageDensity(bundled, 3)).toBe(1);
    expect(capImageDensity('file:///x/PASER.app/assets/frame@3x.png', 2)).toBe(3);
    expect(capImageDensity('file:///x/PASER.app/assets/frame@2x.png?v=1', 3)).toBe(2);
  });

  it('assumes a plain 1x file when there is nothing to read', () => {
    expect(capImageDensity(undefined, 3)).toBe(1);
    expect(capImageDensity('', 3)).toBe(1);
  });
});

describe('cap inset geometry', () => {
  it('cuts exactly where the cutter measured, whatever the weight, box or density', () => {
    // A cap inset in the image's points, times the image's density, is the
    // inset in pixels — the manifest. The weight and the box must not move the
    // cut; they move the zoom.
    for (const id of ALL) {
      const spec = FRAMES[id];
      for (const density of DENSITIES) {
        for (const weight of WEIGHTS) {
          const g = capFrameGeometry(spec, 320, 160, weightScale(id, weight), density);
          expect(g).toBeTruthy();
          for (const side of SIDES) {
            expect(g.capInsets[side] * density).toBeCloseTo(spec.insets[side], 10);
          }
        }
      }
    }
  });

  it('draws the same corner the eight slices would, at every weight, size and density', () => {
    // A corner is drawn at its cap's point size inside the layer, and then
    // scaled with the layer. The slice path rounds its corners to whole points;
    // cap insets are left exact, because rounding them would move the cut off
    // the boundary. Half a point apart is that rounding and nothing else.
    for (const id of ALL) {
      const spec = FRAMES[id];
      for (const weight of WEIGHTS) {
        const scale = weightScale(id, weight);
        for (const [w, h] of BOXES) {
          const corner = sliceLayout(spec, w, h, scale).find((s) => s.key === 'tl');
          const sliceLeft = corner.rect.w * (corner.box.sheetW / spec.frameWidth);
          const sliceTop = corner.rect.h * (corner.box.sheetH / spec.frameHeight);
          for (const density of DENSITIES) {
            const g = capFrameGeometry(spec, w, h, scale, density);
            expect(Math.abs(g.capInsets.left * g.zoom - sliceLeft)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(g.capInsets.top * g.zoom - sliceTop)).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it('scales its layer back onto exactly the box', () => {
    // The transform scales about the layer's centre, so the layer is centred on
    // the box, and zoom times its size is the box.
    const spec = getFrame('panel');
    for (const [w, h] of BOXES) {
      for (const density of DENSITIES) {
        const g = capFrameGeometry(spec, w, h, weightScale('panel', INK.base), density);
        expect(g.layer.width * g.zoom).toBeCloseTo(w, 6);
        expect(g.layer.height * g.zoom).toBeCloseTo(h, 6);
        expect(g.layer.left + g.layer.width / 2).toBeCloseTo(w / 2, 6);
        expect(g.layer.top + g.layer.height / 2).toBeCloseTo(h / 2, 6);
      }
    }
  });

  it('carries the line weight in the zoom, never in the cut', () => {
    // A heavier weight has to come out as a proportionally heavier corner on
    // the same box — and the cut staying put is what means the image never has
    // to be reloaded for it.
    const spec = getFrame('panel');
    const thin = capFrameGeometry(spec, 300, 200, weightScale('panel', INK.thin), 1);
    const bold = capFrameGeometry(spec, 300, 200, weightScale('panel', INK.bold), 1);
    expect(bold.zoom / thin.zoom).toBeCloseTo(INK.bold / INK.thin, 6);
    expect(bold.capInsets).toEqual(thin.capInsets);
  });

  it('always leaves a middle to stretch, even on a box smaller than its corners', () => {
    // `frameScale` is the clamp that guarantees this; cap insets that met or
    // crossed in the middle would be an invalid resizable image.
    for (const id of ALL) {
      for (const density of DENSITIES) {
        const g = capFrameGeometry(FRAMES[id], 24, 20, weightScale(id, INK.heavy), density);
        // On the box, after the zoom...
        expect((g.capInsets.left + g.capInsets.right) * g.zoom).toBeLessThan(24);
        expect((g.capInsets.top + g.capInsets.bottom) * g.zoom).toBeLessThan(20);
        // ...and inside the image's own layer, which is the one UIKit sees.
        expect(g.capInsets.left + g.capInsets.right).toBeLessThan(g.layer.width);
        expect(g.capInsets.top + g.capInsets.bottom).toBeLessThan(g.layer.height);
      }
    }
  });

  it('has nothing to draw when the box has no size', () => {
    expect(capFrameGeometry(FRAMES[ALL[0]], 0, 100, 1, 1)).toBeNull();
    expect(capFrameGeometry(null, 100, 100, 1, 1)).toBeNull();
    // A zero fit or a zero density would be a division by zero in the zoom.
    expect(frameScale(FRAMES[ALL[0]], 100, 100, 0)).toBe(0);
    expect(capFrameGeometry(FRAMES[ALL[0]], 100, 100, 0, 1)).toBeNull();
    expect(capFrameGeometry(FRAMES[ALL[0]], 100, 100, 1, 0)).toBeNull();
  });
});

describe('asking the device whether it agrees', () => {
  // The load event reports the decoded image's point size times the screen
  // scale, so an agreeing load can be predicted exactly.
  const spec = getFrame('panel');
  const loadedAt = (density, pixelRatio) => ({
    width: (spec.frameWidth / density) * pixelRatio,
    height: (spec.frameHeight / density) * pixelRatio,
  });

  it('agrees when the image came back at the density it was cut for', () => {
    expect(capDensityHolds(spec, 1, loadedAt(1, 3), { pixelRatio: 3 })).toBe(true);
    expect(capDensityHolds(spec, 3, loadedAt(3, 3), { pixelRatio: 3, remote: true })).toBe(true);
  });

  it('catches a bundled image at another density, in either direction', () => {
    expect(capDensityHolds(spec, 3, loadedAt(1, 3), { pixelRatio: 3 })).toBe(false);
    expect(capDensityHolds(spec, 1, loadedAt(3, 3), { pixelRatio: 3 })).toBe(false);
  });

  it('lets a streamed image be shrunk by the decoder, but never grown', () => {
    const cut = loadedAt(3, 3);
    const shrunk = { width: cut.width * 0.6, height: cut.height * 0.6 };
    expect(capDensityHolds(spec, 3, shrunk, { pixelRatio: 3, remote: true })).toBe(true);
    expect(capDensityHolds(spec, 3, loadedAt(1, 3), { pixelRatio: 3, remote: true })).toBe(false);
  });

  it('gives no verdict without a measurement', () => {
    expect(capDensityHolds(spec, 1, undefined, { pixelRatio: 3 })).toBe(true);
    expect(capDensityHolds(spec, 1, { width: 0, height: 0 }, { pixelRatio: 3 })).toBe(true);
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

// The density the test renderer's image will be read at — whatever the jest
// asset stub resolves to, so these do not hard-code the environment.
const densityOf = (source) => capImageDensity(Image.resolveAssetSource(source)?.uri);

describe('what ArtFrame actually renders', () => {
  // These assert the SHAPE of the output, not a magic number: one view per
  // layer plus the container, versus two per slice per layer plus the
  // container. Stated as a comparison so the numbers cannot drift apart.
  const SLICES = 8;

  afterEach(() => {
    act(() => resetCapTrust());
  });

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

  it('hands the image its own source, cut in that image’s own points', () => {
    const tree = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    const [img] = tree.root.findAllByType(Image);
    const spec = getFrame('panel');
    // Untouched: a density or a size declared here would be thrown away by
    // Fabric, and relying on one is what drew every release build wrong.
    expect(img.props.source).toBe(spec.posesInk[0]);
    const g = capFrameGeometry(spec, 300, 140, 1, densityOf(spec.posesInk[0]));
    expect(img.props.capInsets).toEqual(g.capInsets);
    expect(img.props.resizeMode).toBe('stretch');
    act(() => tree.unmount());
  });

  it('lays the image out at its layer and scales that onto the box', () => {
    // THE ONE THAT GOT AWAY, the first time. RN's `Image.ios.js` builds its
    // style as
    //
    //   [{width, height}, styles.base, props.style]
    //
    // where the width and height are the SOURCE's own point size, so a layer
    // that leaves its size to offsets is drawn at the drawing's natural size,
    // pinned to one corner. Flatten exactly what RN prepends in front of the
    // style, so this fails if the style ever stops overriding it.
    const spec = getFrame('panel');
    for (const [w, h] of BOXES) {
      const tree = render(<ArtFrame name="panel" width={w} height={h} tint="#111" />);
      const [img] = tree.root.findAllByType(Image);
      const resolved = Image.resolveAssetSource(img.props.source);
      const g = capFrameGeometry(spec, w, h, 1, densityOf(img.props.source));
      const style = StyleSheet.flatten([
        { width: resolved?.width, height: resolved?.height },
        img.props.style,
      ]);
      expect(style.position).toBe('absolute');
      expect(style.width).toBeCloseTo(g.layer.width, 6);
      expect(style.height).toBeCloseTo(g.layer.height, 6);
      expect(style.left).toBeCloseTo(g.layer.left, 6);
      expect(style.top).toBeCloseTo(g.layer.top, 6);
      expect(style.transform).toEqual([{ scale: g.zoom }]);
      act(() => tree.unmount());
    }
  });

  it('keeps the same cut when the fitted geometry moves', () => {
    // Fabric applies `capInsets` only as a freshly loaded image is made
    // resizable. When the cut depended on the fit, a box crossing the
    // corner-fit clamp had to remount its image to get new corners. The cut
    // depends on the density alone now, so the same image serves every size.
    const spec = getFrame('panel');
    expect(frameScale(spec, 30, 24, 1)).toBeLessThan(frameScale(spec, 300, 140, 1));
    const big = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    const small = render(<ArtFrame name="panel" width={30} height={24} tint="#111" />);
    const [bigImg] = big.root.findAllByType(Image);
    const [smallImg] = small.root.findAllByType(Image);
    expect(smallImg.props.capInsets).toEqual(bigImg.props.capInsets);
    expect(StyleSheet.flatten(smallImg.props.style).transform).not.toEqual(
      StyleSheet.flatten(bigImg.props.style).transform
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

  it('keeps the fast path when the device agrees with the cut', () => {
    const spec = getFrame('panel');
    const pr = PixelRatio.get();
    const density = densityOf(spec.posesInk[0]);
    const tree = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    const [img] = tree.root.findAllByType(Image);
    act(() => img.props.onLoad({
      nativeEvent: {
        source: { width: (spec.frameWidth / density) * pr, height: (spec.frameHeight / density) * pr },
      },
    }));
    expect(hosts(tree)).toBe(2);
    act(() => tree.unmount());
  });

  it('drops every frame to the eight slices once the device disagrees', () => {
    // The release bug, seen from the device: the image came back three times
    // bigger than the cut was made for. The frame already on screen redraws
    // the slow way, and so does every frame after it.
    const spec = getFrame('panel');
    const pr = PixelRatio.get();
    const density = densityOf(spec.posesInk[0]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tree = render(<ArtFrame name="panel" width={300} height={140} tint="#111" />);
    expect(hosts(tree)).toBe(2);
    const [img] = tree.root.findAllByType(Image);
    act(() => img.props.onLoad({
      nativeEvent: {
        source: {
          width: (spec.frameWidth / density) * pr * 3,
          height: (spec.frameHeight / density) * pr * 3,
        },
      },
    }));
    expect(warn).toHaveBeenCalled();
    expect(hosts(tree)).toBe(1 + SLICES * 2);
    const next = render(<ArtFrame name="card" width={200} height={120} tint="#111" />);
    expect(hosts(next)).toBe(1 + SLICES * 2);
    act(() => tree.unmount());
    act(() => next.unmount());
    warn.mockRestore();
  });
});
