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
import { StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Path as SvgPath } from 'react-native-svg';

import RunShareSheet from '../src/components/share/RunShareSheet';
import RunShareCard, {
  DEFAULT_STATS,
  SHARE_FORMAT,
  availableStats,
} from '../src/components/share/RunShareCard';
import LogoRunner, { MARK_FOOT } from '../src/components/character/LogoRunner';
import OutlinedText from '../src/components/ui/OutlinedText';
import { fonts } from '../src/theme';
import TrailDecorations, {
  TRAIL_DECORATIONS,
  trailMarks,
  trailSpec,
} from '../src/components/share/trailDecorations';

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
  climbPerKm: 4.1,
  bestKmSeconds: 331,
  consistencySeconds: 18,
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

  // Not "somewhere near it" — ON it. The mark is a running pose whose planted
  // foot sits about two thirds of the way across its own square, so anchoring
  // the figure by the middle of its box stood it a stride clear of wherever the
  // run ended. The box therefore has to land LEFT of the end point by that
  // fraction, which is what MARK_FOOT says and what this checks.
  test('stands the runner avatar on the end of the route', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard
          width={300}
          team={TEAM}
          run={RUN}
          path={PATH}
          rings={RINGS}
          equipped={EQUIPPED}
        />
      );
    });
    const runner = tree.root.findByType(LogoRunner);
    expect(runner.props.equipped).toBe(EQUIPPED);

    // The end dot the figure is meant to be standing on, straight off the card.
    const size = runner.props.size;
    const box = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'share-route-runner' }).props.style
    );
    // The end dot is the one wearing the clan colour; the start dot is white,
    // and the avatar's own rig draws circles of its own.
    const dot = tree.root
      .findAll((n) => typeof n.props?.cx === 'number' && n.props?.fill === TEAM.glow)
      .map((n) => n.props)[0];

    // The dot's cx is in the ART BOX's own pixels and the runner's left is in
    // the card's, so the column's offset has to come back in — the same
    // correction the card itself makes. Getting this wrong is invisible in the
    // stacked layout, where the box starts at 0.
    const art = tree.root
      .findAll((n) => n.props?.style?.position === 'absolute')
      .map((n) => n.props.style)
      .find((st) => typeof st.width === 'number' && typeof st.height === 'number' && st.top > 0);
    const footX = box.left + size * MARK_FOOT;
    expect(Math.abs(footX - (art.left + dot.cx))).toBeLessThan(1);
    // The box centre is NOT the anchor — if it were, this would be ~0 too.
    expect(Math.abs(box.left + size / 2 - (art.left + dot.cx))).toBeGreaterThan(size * 0.1);
    act(() => tree.unmount());
  });

  test('mounts with no route, no rings and no avatar', () => {
    // The claim can be declined, and a run can end with nothing to draw. The
    // card still has numbers to show, so it still has to come up.
    expect(() =>
      mount(<RunShareCard width={300} run={{ distanceM: 0, durationS: 0 }} />)
    ).not.toThrow();
  });

  test('mounts with a single recorded point', () => {
    // Fewer than two points cannot be projected. The guard for that is what
    // decides whether the runner gets a card with no route on it or a NaN in a
    // layout prop, which is a native crash rather than a missing line.
    expect(() =>
      mount(
        <RunShareCard
          width={300}
          run={RUN}
          path={[PATH[0]]}
          rings={[[PATH[0]].map((p) => [p.longitude, p.latitude])]}
          equipped={EQUIPPED}
        />
      )
    ).not.toThrow();
  });

  test('filters malformed persisted route points and numeric strings', () => {
    expect(() =>
      mount(
        <RunShareCard
          width={300}
          run={{ distanceM: '10310', durationS: '3550', consistencySeconds: '18' }}
          path={[PATH[0], null, { latitude: undefined, longitude: 103 }, PATH[1]]}
          rings={[[RINGS[0][0], null, RINGS[0][1], RINGS[0][2]]]}
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

  test('offers useful PRO insights instead of average speed', () => {
    const stats = availableStats(RUN);
    const keys = stats.map((stat) => stat.key);
    expect(keys).toEqual(expect.arrayContaining(['bestKm', 'elevation', 'climbPerKm', 'consistency']));
    expect(keys).not.toContain('avgSpeed');
    expect(stats.find((stat) => stat.key === 'consistency')).toMatchObject({
      value: '±0:18',
      unit: '/km',
    });
  });

  test('a perfectly even run can share a zero-variation consistency', () => {
    const stat = availableStats({ consistencySeconds: 0 }).find((item) => item.key === 'consistency');
    expect(stat).toMatchObject({ value: '±0:00', unit: '/km' });
  });

  test('a run with nothing measured still offers distance and time only', () => {
    const keys = availableStats({}).map((s) => s.key);
    expect(keys).toEqual(['distance', 'time']);
  });

  // The rebuilt card, 2026-08-24: three numbers, no labels over them, the route
  // and the runner in a column beside them.
  test('shows three unlabelled numbers by default and no territory headline', () => {
    expect(DEFAULT_STATS).toEqual(['distance', 'pace', 'time']);

    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard width={360} team={TEAM} run={RUN} path={PATH} rings={RINGS} />
      );
    });
    const text = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children);
    // The eyebrow and the 44pt km² that used to head the card are gone; area is
    // a chip now rather than a default, so it is not said at all unless asked
    // for.
    expect(text).not.toContain('TERRITORY CLAIMED');
    expect(text).not.toContain('TERRITORY EARNED');
    // The LABELS are gone too — the unit is what says what a number is.
    expect(text).not.toContain('Territory');
    expect(text).not.toContain('Elev gain');
    expect(text).not.toContain('Distance');
    expect(text).not.toContain('Pace');
    expect(text).toContain('km');
    expect(text).toContain('/km');
    expect(text).toContain('PASER');
    act(() => tree.unmount());
  });

  test('frames the running stats and route with square brackets', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard width={360} team={TEAM} run={RUN} path={PATH} rings={RINGS} />
      );
    });
    const bracket = tree.root.findByProps({ testID: 'share-bracket-frame' });
    expect(bracket.props.accessibilityLabel).toContain('run stats and route');
    // Two dark under-strokes plus two white bracket faces.
    expect(bracket.findAllByType(SvgPath)).toHaveLength(4);
    act(() => tree.unmount());
  });

  test('uses chunky poster type and keeps the PASER stamp centered', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard width={360} team={TEAM} run={RUN} path={PATH} rings={RINGS} />
      );
    });
    const value = tree.root.findAllByType(OutlinedText)[0];
    expect(StyleSheet.flatten(value.props.style).fontFamily).toBe(fonts.hero);
    const lockup = tree.root.findAll(
      (node) => String(node.props?.testID || '').startsWith('share-stat-lockup-')
    )[0];
    expect(StyleSheet.flatten(lockup.props.style).transform[0].scaleX).toBeGreaterThan(1);
    const signature = tree.root.findByProps({ testID: 'share-signature' });
    expect(StyleSheet.flatten(signature.props.style).justifyContent).toBe('center');
    act(() => tree.unmount());
  });

  // ONE SIZE for every number on the card. `fit` shrinks each string on its own
  // and that is the backstop, not the mechanism: a card whose over-the-hour
  // duration is set smaller than the distance above it is three type sizes in a
  // column, which is the one thing the poster layout must not do.
  test('draws every number at the same size', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        // A long run: "1:38:22" is the string that used to shrink on its own.
        <RunShareCard
          width={360}
          team={TEAM}
          run={{ distanceM: 21097, durationS: 5902 }}
          path={PATH}
          rings={RINGS}
        />
      );
    });
    const sizes = tree.root
      .findAllByType(OutlinedText)
      .map((n) => StyleSheet.flatten(n.props.style).fontSize);
    expect(sizes.length).toBeGreaterThan(1);
    expect(new Set(sizes).size).toBe(1);
    act(() => tree.unmount());
  });

  // SIDE BY SIDE: the route is a column beside the numbers, not a band across
  // the card. It is narrower than the card and offset from its edge, and it
  // still sits clear of Instagram's own chrome at the top.
  test('stands the route in a column beside the numbers', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard width={360} team={TEAM} run={RUN} path={PATH} rings={RINGS} />
      );
    });
    const height = 360 * (16 / 9);
    const band = tree.root
      .findAll((n) => typeof n.props?.style?.height === 'number' && n.props?.style?.top > 0)
      .map((n) => n.props.style)
      .find((s) => typeof s.width === 'number' && s.width < 360 && s.width > 60);
    expect(band).toBeDefined();
    // Its own column, on the side the numbers are not.
    expect(band.left).toBeGreaterThan(360 * 0.4);
    expect(band.left + band.width).toBeLessThanOrEqual(360);
    expect(band.top).toBeGreaterThanOrEqual(height * 0.11);
    act(() => tree.unmount());
  });

  // Centre is the OLD shape, kept: route in a capped band across the top with
  // the numbers under it. It is the one layout where the route gets the full
  // width of the card, and it must still not take the whole card.
  test('centre keeps the stacked layout, route capped to a band', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard width={360} align="center" team={TEAM} run={RUN} path={PATH} rings={RINGS} />
      );
    });
    const height = 360 * (16 / 9);
    const band = tree.root
      .findAll((n) => typeof n.props?.style?.height === 'number' && n.props?.style?.top > 0)
      .map((n) => n.props.style)
      .find((s) => s.width === 360);
    expect(band.height).toBeLessThanOrEqual(height * 0.31);
    expect(band.top).toBeGreaterThanOrEqual(height * 0.11);
    act(() => tree.unmount());
  });

  // With no route to stand on the figure is the subject, not a detail stuck at
  // the end of an invisible line. The "Character showcase" preset is exactly
  // this combination, and it used to render no character at all.
  test('still draws the runner with the route switched off', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard
          width={360}
          team={TEAM}
          run={RUN}
          path={PATH}
          rings={RINGS}
          equipped={EQUIPPED}
          showRoute={false}
        />
      );
    });
    expect(tree.root.findAllByType(LogoRunner).length).toBe(1);
    act(() => tree.unmount());
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

  // THE HOLE THAT LET THE CRASH SHIP. Everything below the head bar waits on
  // `editorReady`, which is an InteractionManager callback plus a timer — so a
  // plain mount test renders the title, the Close button and NOTHING ELSE, and
  // every test above passed for months while the destinations row threw on a
  // real device. Getting to ready is the whole point of this one.
  test('renders its destinations once ready, which is where the crash lived', () => {
    jest.useFakeTimers();
    let tree;
    try {
      act(() => {
        tree = renderer.create(
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
        );
      });
      // Interactions first, then the 80ms beat they schedule.
      act(() => jest.runOnlyPendingTimers());
      act(() => jest.runOnlyPendingTimers());

      // Instagram is the destination that was `undefined`: lucide v1 has no
      // brand icons, so the import silently resolved to nothing and creating
      // the element threw. Finding the button proves the row got rendered.
      const labels = tree.root
        .findAll((n) => !!n.props?.accessibilityLabel)
        .map((n) => n.props.accessibilityLabel);
      expect(labels).toContain('Instagram Story');
      expect(labels).toContain('More');
      act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  // The card is white type on nothing: the Light/Dark switch that used to sit
  // in the Text row is gone for good. The trail decorations that briefly took
  // its place are PARKED behind TRAIL_DECORATIONS_ENABLED — kept whole, not
  // offered — so their row must not be on the sheet either.
  test('offers neither dark text nor the parked trail row', () => {
    jest.useFakeTimers();
    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <RunShareSheet visible onClose={() => {}} team={TEAM} path={PATH} rings={RINGS} run={RUN} />
        );
      });
      act(() => jest.runOnlyPendingTimers());
      act(() => jest.runOnlyPendingTimers());

      const labels = tree.root
        .findAll((n) => !!n.props?.accessibilityLabel)
        .map((n) => n.props.accessibilityLabel);
      expect(labels).not.toContain('Dark');
      expect(labels).not.toContain('Flowers');
      // The controls that DO ship are still there.
      expect(labels).toContain('Centre');
      expect(labels).toContain('Instagram Story');
      act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  // ONE SHAPE. The card is a story sticker and the 1:1 "Post" is gone, so there
  // is no format switch on the sheet and nothing that can hand the card a
  // second aspect ratio.
  test('offers the story shape only, with no format switch', () => {
    expect(SHARE_FORMAT.ratio).toBe(16 / 9);
    expect(SHARE_FORMAT.export).toEqual({ width: 1080, height: 1920 });

    jest.useFakeTimers();
    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <RunShareSheet visible onClose={() => {}} team={TEAM} path={PATH} rings={RINGS} run={RUN} />
        );
      });
      act(() => jest.runOnlyPendingTimers());
      act(() => jest.runOnlyPendingTimers());

      const text = tree.root
        .findAll((n) => typeof n.props?.children === 'string')
        .map((n) => n.props.children);
      // The switch labelled its two shapes by ratio, so the ratios are what
      // proves it is gone. ("Home post" is the caption row and stays.)
      expect(text.some((t) => /1:1|9:16|Square/i.test(t))).toBe(false);
      act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });

  // The mascot is ON when the sheet opens. It started off, which in practice
  // meant the part of the card that is actually the runner never left the app.
  test('opens with the runner already standing on the route', () => {
    jest.useFakeTimers();
    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <RunShareSheet
            visible
            onClose={() => {}}
            team={TEAM}
            path={PATH}
            rings={RINGS}
            run={RUN}
            equipped={EQUIPPED}
          />
        );
      });
      act(() => jest.runOnlyPendingTimers());
      act(() => jest.runOnlyPendingTimers());

      expect(tree.root.findByType(RunShareCard).props.showCharacter).toBe(true);
      expect(tree.root.findAllByType(LogoRunner).length).toBe(1);
      act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the trail decorations', () => {
  // A straight 100pt line: every mark's position is checkable by hand.
  const LINE = [[0, 0], [100, 0]];

  test('none puts nothing on the route', () => {
    expect(trailMarks(LINE, trailSpec('none'))).toEqual([]);
    expect(TRAIL_DECORATIONS[0].key).toBe('none');
  });

  test('spaces marks by distance along the line, ends left clear', () => {
    const marks = trailMarks(LINE, { key: 'heart', spacing: 25, size: 16 });
    expect(marks).toHaveLength(4);
    expect(marks.map((m) => Math.round(m.x))).toEqual([20, 40, 60, 80]);
    marks.forEach((m) => expect(m.y).toBe(0));
  });

  test('a short route still gets one mark rather than none', () => {
    expect(trailMarks([[0, 0], [3, 0]], { key: 'star', spacing: 40, size: 16 })).toHaveLength(1);
  });

  test('is deterministic, because capture re-renders the card', () => {
    const spec = { key: 'flower', spacing: 25, size: 18, spin: 30 };
    expect(trailMarks(LINE, spec)).toEqual(trailMarks(LINE, spec));
  });

  // Side on, not from above: these things GROW OUT of the route, so they point
  // at the top of the card whichever way the runner was going. Only a small
  // lean, never a rotation to the direction of travel.
  test('stands its marks up whatever direction the route runs', () => {
    const spec = { key: 'tree', spacing: 30, size: 40, lean: 5 };
    for (const line of [[[0, 0], [0, 120]], [[0, 0], [120, 0]], [[120, 90], [0, 0]]]) {
      trailMarks(line, spec).forEach((m) => expect(Math.abs(m.rot)).toBeLessThanOrEqual(5));
    }
  });

  // Depth is what stops it looking like a sticker sheet: nearer the bottom of
  // the card is nearer the viewer, and the component sizes and stacks by it.
  test('reads depth off the card, bottom nearest', () => {
    const marks = trailMarks([[0, 0], [100, 100]], { key: 'flower', spacing: 25, size: 34 });
    expect(marks.length).toBeGreaterThan(2);
    expect(marks[0].depth).toBeCloseTo(0);
    expect(marks[marks.length - 1].depth).toBeCloseTo(1);
    // A route with no rise at all cannot divide by its span.
    trailMarks([[0, 50], [100, 50]], { key: 'flower', spacing: 25, size: 34 })
      .forEach((m) => expect(Number.isFinite(m.depth)).toBe(true));
  });

  test('survives a path with nothing drawable in it', () => {
    expect(trailMarks([], trailSpec('flower'))).toEqual([]);
    expect(trailMarks([[0, 0], [0, 0]], trailSpec('flower'))).toEqual([]);
    expect(trailMarks([[NaN, 0], null, [1, 1]], trailSpec('flower'))).toEqual([]);
  });

  test('every decoration in the list actually draws', () => {
    for (const d of TRAIL_DECORATIONS) {
      expect(() =>
        mount(<TrailDecorations points={LINE} decoration={d.key} color="#EC4899" u={1} />)
      ).not.toThrow();
    }
  });

  // The feed hands the card [lon, lat] PAIRS, the recorder hands it
  // {latitude, longitude} objects, and the same card is drawn from both. That
  // half ships; the decorations on top of it do not.
  test('the card projects a feed-shaped path, and stays parked on top of it', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <RunShareCard
          width={300}
          team={TEAM}
          run={RUN}
          path={RINGS[0]}
          rings={RINGS}
          trail="flower"
        />
      );
    });
    const drawn = tree.root.findByType(TrailDecorations);
    expect(drawn.props.points.length).toBeGreaterThan(1);
    // Asked for flowers, gets none: the switch beats the caller, so no route on
    // any screen can put decorations back on a card by passing a prop.
    expect(drawn.props.decoration).toBe('none');
    act(() => tree.unmount());
  });
});
