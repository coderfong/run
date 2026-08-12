// The parallax scene registry.
//
// Every layer is a literal require() that no other test reaches, and a wrong
// path here is a bundling failure rather than a runtime one — which means the
// first thing that notices is a thirty-minute EAS build. The registry is also
// the only place the installer's measured numbers meet the app, so this is
// where a manifest that drifted from the art gets caught.

import { SCENES, SCENE_LICENSE, sceneLayerSources } from '../src/config/scenes';
import { sceneBox } from '../src/components/ParallaxScene';

describe('parallax scenes', () => {
  test('the first-run meadow is in the build with all of its layers', () => {
    const scene = SCENES.nature5;
    expect(scene).toBeTruthy();
    expect(scene.layers).toHaveLength(5);
    expect(sceneLayerSources('nature5')).toHaveLength(5);
    for (const source of sceneLayerSources('nature5')) expect(source).toBeTruthy();
  });

  test('layer order is back to front, and only the back one is opaque', () => {
    const { layers } = SCENES.nature5;
    expect(layers.map((l) => l.index)).toEqual([1, 2, 3, 4, 5]);
    // The sky is the only layer that fills its frame. If a later one ever
    // reported opaque, it would be painting over everything behind it and the
    // parallax would be invisible.
    expect(layers.filter((l) => l.opaque).map((l) => l.index)).toEqual([1]);
  });

  test('the sky does not drift, and everything else does', () => {
    const { layers } = SCENES.nature5;
    expect(layers[0].amplitude).toBe(0);
    for (const layer of layers.slice(1)) {
      expect(layer.amplitude).toBeGreaterThan(0);
      expect(layer.seconds).toBeGreaterThan(0);
    }
  });

  test('the drift is quick enough to read as weather, not as a screensaver', () => {
    // The first pass ran 11 to 26 seconds a sway, which on a screen you pass
    // through in under a minute is indistinguishable from a still image.
    for (const layer of SCENES.nature5.layers.slice(1)) {
      expect(layer.seconds).toBeLessThanOrEqual(10);
    }
  });
});

describe('fitting a landscape into a portrait box', () => {
  const spec = () => SCENES.nature5;
  const phone = { width: 393, height: 844 };
  const box = (over = {}) => sceneBox({
    ...phone,
    aspect: spec().aspect,
    cover: spec().cover,
    focusX: spec().focusX,
    travel: 0.05 * phone.width,
    ...over,
  });

  test('the art keeps its aspect exactly, so nothing is ever stretched', () => {
    const b = box();
    expect(b.width / b.height).toBeCloseTo(spec().aspect, 4);
  });

  test('it fills the height it promised', () => {
    // The complaint this exists for: pinned to the bottom at its own aspect the
    // scene covered about a quarter of a tall phone and the rest was a flat
    // slab of sky.
    expect(box().height).toBeGreaterThanOrEqual(phone.height * spec().cover - 1);
  });

  test('it always covers the box width, whatever the focus', () => {
    for (const focusX of [0, 0.2, 0.5, 1]) {
      const b = box({ focusX });
      expect(b.left).toBeLessThanOrEqual(0);
      expect(b.left + b.width).toBeGreaterThanOrEqual(phone.width);
    }
  });

  test('the sway can never pull an edge into view', () => {
    // The layer translates by +/- travel about this offset, so both extremes
    // have to keep covering the box. Getting this wrong shows the backdrop's
    // own background colour down one side, once a cycle, forever.
    const travel = 0.05 * phone.width;
    for (const focusX of [0, 0.2, 0.5, 1]) {
      const b = box({ focusX, travel });
      expect(b.left + travel).toBeLessThanOrEqual(0);
      expect(b.left - travel + b.width).toBeGreaterThanOrEqual(phone.width);
    }
  });

  test('a wide box needs no crop and gets none', () => {
    const b = sceneBox({ width: 1000, height: 400, aspect: spec().aspect, cover: 0.5, focusX: 0.2 });
    expect(b.width).toBeCloseTo(1000, 0);
    expect(b.left).toBeCloseTo(0, 5);
  });

  test('the sky colour and aspect are real numbers read off the art', () => {
    expect(SCENES.nature5.sky).toMatch(/^#[0-9A-F]{6}$/);
    expect(SCENES.nature5.aspect).toBeGreaterThan(1);
  });

  test('an unknown scene draws nothing rather than throwing', () => {
    expect(sceneLayerSources('not-a-scene')).toEqual([]);
    expect(SCENES['not-a-scene']).toBeUndefined();
  });

  test('provenance is recorded, and says what was actually checked', () => {
    expect(SCENE_LICENSE.package).toMatch(/CraftPix/);
    expect(SCENE_LICENSE.note).toEqual(expect.any(String));
  });
});
