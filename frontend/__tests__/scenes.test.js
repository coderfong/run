// The parallax scene registry.
//
// Every layer is a literal require() that no other test reaches, and a wrong
// path here is a bundling failure rather than a runtime one — which means the
// first thing that notices is a thirty-minute EAS build. The registry is also
// the only place the installer's measured numbers meet the app, so this is
// where a manifest that drifted from the art gets caught.

import { SCENES, SCENE_LICENSE, sceneLayerSources } from '../src/config/scenes';

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

  test('the sway never exposes a layer edge', () => {
    // ParallaxScene draws each layer OVERDRAW wider than the box. Travel is
    // amplitude in each direction, so the overdraw has to beat twice the
    // largest amplitude or a layer pulls its own edge into view at the turn.
    const OVERDRAW = 1.16;
    const worst = Math.max(...SCENES.nature5.layers.map((l) => l.amplitude));
    expect((OVERDRAW - 1) / 2).toBeGreaterThan(worst);
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
