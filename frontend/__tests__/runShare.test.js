// The share stage, mounted.
//
// It is reached by pressing Continue on the post-run recap, and React Native's
// Modal renders NOTHING while `visible` is false — so every component under
// this sheet mounts for the first time at exactly that press. Anything that
// throws on mount therefore reads to a runner as "the app dies when I try to
// share my run", with the recap it came from still on screen behind it.
//
// These are mount tests and nothing more. They do not assert what the card
// looks like; they assert that it comes up at all, on the run shapes the result
// screen can actually hand it.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import RunShareSheet from '../src/components/share/RunShareSheet';
import RunShareCard, { availableStats } from '../src/components/share/RunShareCard';

// `act` so effects run: the sheet asks whether Instagram is installed on the
// first frame it is visible, and a throw in there is as fatal as one in render.
const mount = (element) => {
  let tree;
  act(() => { tree = renderer.create(element); });
  act(() => { tree.unmount(); });
};

// A short loop, as the recorder stores it: objects, not [lon, lat] pairs.
const PATH = Array.from({ length: 24 }, (_, i) => ({
  latitude: 1.28 + Math.sin((i / 24) * Math.PI * 2) * 0.002,
  longitude: 103.85 + Math.cos((i / 24) * Math.PI * 2) * 0.002,
}));

// Rings are the other convention — [lon, lat] pairs — which is exactly the
// pairing that makes this worth a test.
const RINGS = [PATH.map((p) => [p.longitude, p.latitude])];

const RUN = {
  distanceM: 10310,
  durationS: 3550,
  areaM2: 77000,
  elevationM: 42,
  bestKmSeconds: 331,
  avgSpeedKmh: 10.5,
  claimed: true,
};

const TEAM = { fill: '#fde7f1', stroke: '#ec4899', glow: '#ec4899' };

const EQUIPPED = {
  face: 'smile',
  hair: 'twoblock',
  hairColor: 4,
  top: 'tee',
  topColor: 1,
  bottom: 'joggers',
  bottomColor: 1,
};

describe('the run share card', () => {
  test('mounts with a full run', () => {
    expect(() =>
      mount(
        <RunShareCard
          format="story"
          width={300}
          team={TEAM}
          run={RUN}
          path={PATH}
          rings={RINGS}
          equipped={EQUIPPED}
        />
      )
    ).not.toThrow();
  });

  test('mounts with no route, no rings and no avatar', () => {
    // The claim can be declined, and a run can end with nothing to draw. The
    // card still has numbers to show, so it still has to come up.
    expect(() =>
      mount(<RunShareCard format="story" width={300} run={{ distanceM: 0, durationS: 0 }} />)
    ).not.toThrow();
  });

  test('mounts with a single recorded point', () => {
    // Fewer than two points cannot be projected. The guard for that is what
    // decides whether the runner gets a card with no route on it or a NaN in a
    // layout prop, which is a native crash rather than a missing line.
    expect(() =>
      mount(
        <RunShareCard
          format="square"
          width={300}
          run={RUN}
          path={[PATH[0]]}
          rings={[[PATH[0]].map((p) => [p.longitude, p.latitude])]}
          equipped={EQUIPPED}
        />
      )
    ).not.toThrow();
  });

  test('every offered stat has a finite value', () => {
    for (const stat of availableStats(RUN)) {
      expect(stat.value).toEqual(expect.any(String));
      expect(stat.value).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  test('a run with nothing measured still offers distance and time only', () => {
    const keys = availableStats({}).map((s) => s.key);
    expect(keys).toEqual(['distance', 'time']);
  });
});

describe('the share sheet', () => {
  test('mounts visible, which is what Continue does to it', () => {
    expect(() =>
      mount(
        <RunShareSheet
          visible
          onClose={() => {}}
          closeLabel="Done"
          team={TEAM}
          path={PATH}
          rings={RINGS}
          run={RUN}
          equipped={EQUIPPED}
        />
      )
    ).not.toThrow();
  });

  test('mounts visible with nothing to draw', () => {
    expect(() =>
      mount(
        <RunShareSheet
          visible
          onClose={() => {}}
          team={null}
          path={[]}
          rings={null}
          run={{}}
          equipped={null}
        />
      )
    ).not.toThrow();
  });
});
