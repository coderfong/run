/**
 * The ladder's tier illustrations.
 *
 * Ten scenes, one per rung, and the failure modes are all quiet ones: a
 * copy-pasted require pointing two tiers at the same world, a key that does
 * not match the ladder's (which silently draws nothing), a rung that stops
 * drawing its scene at all. None of those throw, and all of them look
 * deliberate on a screen you have to scroll to reach — so they are pinned
 * here rather than left to be noticed.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import RankLadder from '../src/components/rank/RankLadder';
import RankUpCeremony from '../src/components/rank/RankUpCeremony';
import RankCard from '../src/components/rank/RankCard';
import ClubAvatar from '../src/components/ClubAvatar';
import { RANK_TIERS, standingFrom } from '../src/config/rankLadder';
import ART, { RANK_ART_SOURCES, rankArt } from '../src/config/rankArt';
import { assetsForScreens } from '../src/config/screenAssets';
import { Image } from '../src/ui/image';

const FLOORS = [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400];
const GOLD = standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 });

const render = (element) => {
  let tree;
  act(() => { tree = renderer.create(element); });
  return tree;
};

describe('the tier art registry', () => {
  it('has one scene for every rung of the ladder, and nothing else', () => {
    expect(Object.keys(ART)).toEqual(RANK_TIERS.map((t) => t.key));
  });

  it('gives every tier its OWN world', () => {
    // The copy-paste guard. Two tiers sharing an illustration is the one
    // mistake in this file that renders perfectly.
    const sources = RANK_TIERS.map((t) => rankArt(t.key).source);
    expect(new Set(sources).size).toBe(RANK_TIERS.length);
  });

  it('carries a ground colour for each, for the frame before the decode', () => {
    for (const tier of RANK_TIERS) {
      expect(rankArt(tier.key).ground).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('returns null for a tier with no art rather than another tier’s', () => {
    expect(rankArt('kryptonite')).toBeNull();
    expect(rankArt(undefined)).toBeNull();
  });

  it('warms all ten with the ladder screen', () => {
    const warmed = assetsForScreens('RankLadder');
    for (const source of RANK_ART_SOURCES) {
      expect(warmed).toContain(source);
    }
  });
});

describe('the ladder', () => {
  it('draws each tier’s scene exactly once', () => {
    const tree = render(
      <RankLadder standing={GOLD} floors={FLOORS} shares={[]} equipped={{}} />
    );
    // The rig draws its own layers through the same wrapper, so the scenes are
    // picked out by source rather than by counting images.
    const drawn = tree.root.findAllByType(Image).map((n) => n.props.source);
    for (const source of RANK_ART_SOURCES) {
      expect(drawn.filter((s) => s === source)).toHaveLength(1);
    }
    act(() => tree.unmount());
  });
});

describe('the promotion ceremony', () => {
  const from = standingFrom({ key: 'silver', points: 1340, floor: 1200, next_points: 1350 });
  const to = standingFrom({ key: 'gold', points: 1355, floor: 1350, next_points: 1500 });

  // The ceremony is a timeline of setTimeouts; on real timers they land after
  // the assertions.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens the world you climbed INTO, not the one you left', () => {
    // Reading `from` here instead of `to` is the mistake this screen invites —
    // the badge genuinely does show the old tier for the first second, and the
    // backdrop genuinely must not.
    const tree = render(
      <RankUpCeremony visible from={from} to={to} topPercent={54} equipped={{}} onDone={() => {}} />
    );
    act(() => { jest.advanceTimersByTime(2500); });

    const drawn = tree.root.findAllByType(Image).map((n) => n.props.source);
    expect(drawn).toContain(rankArt('gold').source);
    expect(drawn).not.toContain(rankArt('silver').source);
    act(() => tree.unmount());
  });
});

describe('the compact card', () => {
  it('carries its own tier’s thumb', () => {
    const tree = render(<RankCard standing={GOLD} equipped={{}} />);
    const drawn = tree.root.findAllByType(Image).map((n) => n.props.source);
    expect(drawn).toContain(rankArt('gold').source);
    act(() => tree.unmount());
  });

  it('keeps the thumb on a card wearing somebody else’s emblem', () => {
    // The club cards replace the runner with a crest. The tier is still the
    // tier, so the world stays — this is the prop that would quietly take it
    // away if the thumb had been built into the emblem slot.
    const tree = render(
      <RankCard
        title="Club rank"
        standing={GOLD}
        emblem={<ClubAvatar color="#f2b632" size={70} />}
      />
    );
    const drawn = tree.root.findAllByType(Image).map((n) => n.props.source);
    expect(drawn).toContain(rankArt('gold').source);
    act(() => tree.unmount());
  });
});
