// The Water Point's geometry.
//
// The shop's illustration is a PAINTING with drawn objects standing on it, and
// nothing in the code knows where the painted shelves or the painted counter
// are — the numbers in `config/pitStop.js` were measured off the file by hand.
// That makes every frame in there a claim about a picture, and a claim nothing
// else in the suite can check: the scene takes no touches, has no accessibility
// tree to speak of, and renders identically whether a prop lands on a shelf or
// eight units above it.
//
// So this asserts the claims. Each landmark below is a row of the table in
// `PIT_STOP_LAYOUT`'s header, and each test is one of the constraints those
// numbers were chosen to satisfy. Re-cut the art and these fail, which is the
// point: they are what says the layout no longer matches the painting.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import PitStopScene from '../src/components/shop/PitStopScene';
import {
  PIT_STOP_CREW,
  PIT_STOP_LAYOUT as L,
  PIT_STOP_PLATES,
  SCENE,
  SCENE_ASPECT,
  SCENE_VIEW,
  shopSceneLayout,
} from '../src/config/pitStop';
import CharacterRig, { BODY_RATIO, HEADROOM } from '../src/components/character/CharacterRig';
import { getItem } from '../src/config/cosmetics';

// Where things are in the Seedance movie, in scene units (the clip is drawn
// SHOP_VIDEO_OFFSET above the origin; see config/pitStop.js).
const PAINTING = {
  signBoard: { x: [373, 1163], y: [430, 644] },
  // The water drop hanging off the board's left end.
  signDropRight: 512,
  wallTop: 708,
  counterTop: 1188,
  woodBottom: 1582,
};

const right = (f) => f.x + f.width;
const bottom = (f) => f.y + f.height;

// CharacterRig's geometry, re-derived rather than copied: the frame is the
// body plus headroom, the body starts below that headroom, and the catalogue
// says where on the body each garment sits.
const rigHeight = (w) => w * BODY_RATIO * (1 + HEADROOM);
const bodyTop = ({ y, width }) => y + rigHeight(width) * (HEADROOM / (1 + HEADROOM));
const bodyHeight = (w) => w * BODY_RATIO;
// The `bottom` slot's top edge is where the legs start — the hip line.
const HIP = 0.554;
const hips = (f) => bodyTop(f) + bodyHeight(f.width) * HIP;
const crown = (f, role) => {
  const hat = getItem('headwear', PIT_STOP_CREW[role].equipped.headwear);
  return bodyTop(f) + bodyHeight(f.width) * hat.layout.top;
};

const CREW = ['keeper', 'restocker', 'helper'];

describe('the painted plates', () => {
  test('both are in the build', () => {
    expect(PIT_STOP_PLATES.backdrop()).toBeTruthy();
    expect(PIT_STOP_PLATES.counter()).toBeTruthy();
  });

  test('the scene box is the shape the plates were cut at', () => {
    // scripts/install-pit-stop-art.py crops 913 of the master's 1672 rows at
    // full width and scales to 1536. Anything else here and the plates are
    // stretched off their own aspect, which slides the counter's top edge out
    // from under the crew.
    expect(SCENE.height).toBe(Math.round((913 * 1536) / 941));
    expect(SCENE_ASPECT).toBeCloseTo(SCENE.width / SCENE.height, 6);
  });
});

describe('the crew stand behind the counter', () => {
  test.each(CREW)('%s is cut just below the hip, not through the chest', (role) => {
    const f = L[role];
    // Below the hip: a counter that cut higher would take the torso with it.
    expect(hips(f)).toBeLessThan(SCENE.counterTop);
    // But not far below, or they are standing in front of it rather than
    // behind. Half a body-width of leg is the whole allowance.
    expect(SCENE.counterTop - hips(f)).toBeLessThan(f.width * 0.5);
  });

  test.each(CREW)('%s wears a hat that clears the canopy', (role) => {
    expect(crown(L[role], role)).toBeGreaterThan(PAINTING.wallTop);
  });

  test('the keeper is the largest, and centred in the stall', () => {
    expect(L.keeper.x).toBe(SCENE.width / 2);
    expect(L.keeper.width).toBeGreaterThan(L.restocker.width);
    expect(L.keeper.width).toBeGreaterThan(L.helper.width);
  });

  test('nobody overlaps anybody', () => {
    const spans = CREW
      .map((role) => [L[role].x - L[role].width / 2, L[role].x + L[role].width / 2])
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
  });
});

describe('the offered cup', () => {
  test('stands above the counter line the crew are clipped at', () => {
    expect(bottom(L.cup)).toBeLessThan(SCENE.counterTop);
    // And it stays out of the helper's lane; the cup is drawn after the crew.
    expect(right(L.cup)).toBeLessThanOrEqual(L.helper.x - L.helper.width / 2);
  });
});

describe('the station sign', () => {
  test('is lettered onto the blank board in the movie, clear of the hanging drop', () => {
    expect(L.sign.x).toBeGreaterThanOrEqual(PAINTING.signDropRight);
    expect(right(L.sign)).toBeLessThanOrEqual(PAINTING.signBoard.x[1]);
    expect(L.sign.y).toBeGreaterThanOrEqual(PAINTING.signBoard.y[0]);
    expect(bottom(L.sign)).toBeLessThanOrEqual(PAINTING.signBoard.y[1]);
  });
});

// Small phone, 6.1", Pro Max, and an iPad for the clamp. `headroom` is the
// floating header: status bar + 4 + a 38pt button + 8.
const DEVICES = [
  { name: 'SE', width: 375, height: 667, headroom: 20 + 50 },
  { name: '6.1"', width: 390, height: 844, headroom: 47 + 50 },
  { name: 'Pro Max', width: 430, height: 932, headroom: 59 + 50 },
  { name: 'iPad', width: 820, height: 1180, headroom: 24 + 50 },
];

describe('the shop split', () => {
  test.each(DEVICES)('$name: the scene keeps 36..52% of the screen, the panel the rest', (d) => {
    const { panelTop } = shopSceneLayout(d);
    expect(panelTop / d.height).toBeGreaterThanOrEqual(0.36 - 1e-9);
    expect(panelTop / d.height).toBeLessThanOrEqual(0.52 + 1e-9);
  });

  test.each(DEVICES.slice(0, 3))('$name: the sign sits below the floating header', (d) => {
    const { scale, cropTop } = shopSceneLayout(d);
    expect((L.sign.y - cropTop) * scale).toBeGreaterThanOrEqual(d.headroom);
  });

  test.each(DEVICES)('$name: the whole blue counter front shows above the panel', (d) => {
    // The panel starts on the counter's wooden base, never above its top.
    expect(SCENE_VIEW.panelLine).toBeGreaterThan(PAINTING.counterTop);
    expect(SCENE_VIEW.panelLine).toBeLessThan(PAINTING.woodBottom);
    const { scale, cropTop, panelTop } = shopSceneLayout(d);
    expect((SCENE_VIEW.panelLine - cropTop) * scale).toBeCloseTo(panelTop, 6);
  });
});

describe('the scene itself', () => {
  test('renders, takes no touches, and is hidden from screen readers', () => {
    let tree;
    act(() => {
      tree = renderer.create(<PitStopScene active={false} />);
    });
    const root = tree.root.children[0];
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    // The one thing in here a screen reader should reach: the stall's name.
    // Counted on host nodes only — the composite and the View it renders both
    // carry the prop, so the raw count is two for one label.
    expect(
      tree.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Water point'
      ).length
    ).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  test('every layer the SCENE positions lands at a real number', () => {
    // A renamed layout key reads as `undefined`, turns a style into NaN, and
    // React Native drops it silently — the layer simply stops appearing, with
    // nothing in the tree to say so. This is the check that notices.
    //
    // The crew are excluded, and the exclusion is about jest rather than about
    // them: CharacterRig sizes each garment from `resolveAssetSource`, which
    // reports no dimensions under the test renderer, so every rig layer has a
    // NaN height here and a correct one on device. What is left is exactly the
    // set this file owns — the plates, the props, the sign.
    let tree;
    act(() => {
      tree = renderer.create(<PitStopScene active={false} />);
    });
    const rigged = new Set(
      tree.root.findAllByType(CharacterRig).flatMap((rig) => rig.findAll(() => true))
    );
    const flat = (s) => (Array.isArray(s) ? s.flat(4).filter(Boolean) : [s].filter(Boolean));
    const bad = [];
    for (const node of tree.root.findAll(() => true)) {
      if (rigged.has(node)) continue;
      for (const style of flat(node.props?.style)) {
        for (const [key, value] of Object.entries(style || {})) {
          if (typeof value === 'number' && Number.isNaN(value)) bad.push(key);
        }
      }
    }
    expect(bad).toEqual([]);
    act(() => tree.unmount());
  });
});
