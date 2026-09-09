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
} from '../src/config/pitStop';
import CharacterRig, { BODY_RATIO, HEADROOM } from '../src/components/character/CharacterRig';
import { getItem } from '../src/config/cosmetics';

// Where things are in the painting, in scene units.
const PAINTING = {
  awningStripes: [375, 563],
  wallTop: 673,
  shelfTop: 911,
  shelfLeft: [199, 532],
  shelfRight: [1010, 1330],
  counterX: [87, 1445],
  counterLip: 1267,
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

describe('what stands on the painted furniture', () => {
  test('the shelf props sit on their shelves, past the volunteer in front', () => {
    const restocker = L.restocker.x - L.restocker.width / 2;
    expect(L.stopwatch.x).toBeGreaterThanOrEqual(PAINTING.shelfLeft[0]);
    expect(right(L.stopwatch)).toBeLessThan(restocker);

    const helper = L.helper.x + L.helper.width / 2;
    expect(L.trophy.x).toBeGreaterThan(helper);
    expect(right(L.trophy)).toBeLessThanOrEqual(PAINTING.shelfRight[1]);
  });

  test('the shelf props are SUNK, so their ink lands on the shelf', () => {
    // The icon files carry transparent padding and `contain` keeps it, so a
    // frame ending on the shelf line leaves the drawing hovering. Both frames
    // deliberately reach past it — but by less than a fifth of their height,
    // or the prop is buried in the shelf instead of standing on it.
    for (const f of [L.stopwatch, L.trophy]) {
      expect(bottom(f)).toBeGreaterThan(PAINTING.shelfTop);
      expect(bottom(f) - PAINTING.shelfTop).toBeLessThan(f.height * 0.2);
    }
  });

  test('the counter stock stands on the counter, in front of it', () => {
    for (const key of ['coconut', 'lootbox', 'watermelon', 'sodaBottles']) {
      const f = L[key];
      expect(f.x).toBeGreaterThan(PAINTING.counterX[0]);
      expect(right(f)).toBeLessThan(PAINTING.counterX[1]);
      // Standing at the front lip, not floating inside the top surface.
      expect(bottom(f)).toBeGreaterThanOrEqual(PAINTING.counterLip);
    }
  });

  test('the offered cup clears the counter plate that is drawn over it', () => {
    expect(bottom(L.cup)).toBeLessThan(SCENE.counterTop);
    // And it stays out of the helper's lane — the cup is drawn after the crew.
    expect(right(L.cup)).toBeLessThanOrEqual(L.helper.x - L.helper.width / 2);
  });
});

describe('what hangs off the canopy', () => {
  test('both hang from the canopy edge, in the lanes between the crew', () => {
    const lanes = [
      [L.restocker.x + L.restocker.width / 2, L.keeper.x - L.keeper.width / 2],
      [L.keeper.x + L.keeper.width / 2, L.helper.x - L.helper.width / 2],
    ];
    for (const f of [L.hangBottle, L.hangMedal]) {
      expect(f.y).toBe(PAINTING.wallTop - 2);
      expect(lanes.some(([a, b]) => f.x >= a && right(f) <= b)).toBe(true);
    }
  });

  test('neither reaches the shelves below', () => {
    for (const f of [L.hangBottle, L.hangMedal]) {
      expect(bottom(f)).toBeLessThan(PAINTING.shelfTop);
    }
  });
});

describe('the station sign', () => {
  test('sits on the striped part of the canopy, clear of the valance', () => {
    expect(L.sign.y).toBeGreaterThan(PAINTING.awningStripes[0]);
    expect(bottom(L.sign)).toBeLessThan(PAINTING.awningStripes[1]);
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
