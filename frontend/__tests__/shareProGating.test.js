// Which parts of the share card cost money.
//
// The line moved on 2026-08-24 and this is the file that says where it is now.
// It matters more than a normal preference does, because the padlocks are
// drawn by a shared `Row` — adding a control to the wrong row silently either
// gives away something that was meant to be sold or, much worse, locks
// something that was meant to be free, and neither shows up in a mount test.
//
// FREE gets a finished card: three numbers, the route, the runner, the clan's
// own colour. PRO buys making it yours.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import RunShareSheet from '../src/components/share/RunShareSheet';

// A free account in a build where the store is live — the only combination
// that draws a padlock. A subscriber sees none, and neither does a build with
// no store, which is what `canShowPro` is for.
jest.mock('../src/pro/ProProvider', () => ({
  useProEntitlement: () => ({ isPro: false, canShowPro: true, openPaywall: jest.fn() }),
}));

const PATH = Array.from({ length: 12 }, (_, i) => ({
  latitude: 1.28 + i * 0.0005,
  longitude: 103.85 + i * 0.0004,
}));

const RUN = { distanceM: 5200, durationS: 1620, elevationM: 30, areaM2: 41000 };
const TEAM = { fill: '#fde7f1', stroke: '#ec4899', glow: '#ec4899' };

// The sheet holds everything below its title back until an InteractionManager
// callback and an 80ms beat have both run.
function openSheet() {
  let tree;
  act(() => {
    tree = renderer.create(
      <RunShareSheet visible onClose={() => {}} team={TEAM} run={RUN} path={PATH} rings={null} />
    );
  });
  act(() => jest.runOnlyPendingTimers());
  act(() => jest.runOnlyPendingTimers());
  return tree;
}

// A locked Row lays a full-size Pressable over its dimmed controls, labelled
// "<row>, PASER PRO". That label is the padlock, so it is what gets asserted.
// Deduped: one Pressable is several nodes deep by the time it is rendered and
// every layer of it carries the prop, so the raw find returns each row three
// times over.
const lockedRows = (tree) => [
  ...new Set(
    tree.root
      .findAll((n) => /, PASER PRO$/.test(n.props?.accessibilityLabel || ''))
      .map((n) => n.props.accessibilityLabel.replace(', PASER PRO', ''))
  ),
];

describe('what PASER PRO buys on the share card', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('locks the colour, the placement and the stats, and nothing else', () => {
    const tree = openSheet();
    expect(lockedRows(tree).sort()).toEqual(['Accent', 'Placement', 'Stats']);
    act(() => tree.unmount());
  });

  // The one that would be quietly wrong: the Route chip used to live in the
  // Stats row, so gating the metrics took the route and the runner with it.
  test('leaves the route and the runner free', () => {
    const tree = openSheet();
    const labels = tree.root
      .findAll((n) => !!n.props?.accessibilityLabel)
      .map((n) => n.props.accessibilityLabel);
    expect(labels).toContain('Route');
    expect(labels).toContain('Runner');
    expect(lockedRows(tree)).not.toContain('On the card');
    act(() => tree.unmount());
  });

  // Previewing is free, exporting is not — the padlocked rows are about the
  // controls, and every destination still works on the card as it stands.
  test('still offers every destination', () => {
    const tree = openSheet();
    const labels = tree.root
      .findAll((n) => !!n.props?.accessibilityLabel)
      .map((n) => n.props.accessibilityLabel);
    expect(labels).toContain('Instagram Story');
    expect(labels).toContain('More');
    act(() => tree.unmount());
  });
});
