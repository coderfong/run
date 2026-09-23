/**
 * A claim reports the ground it WON, not the ground its owner now holds.
 *
 * THE BUG THIS EXISTS FOR. Claiming on top of your own land merges the two
 * into one territory row, and `claim.territory.area_m2` is that merged row —
 * every block you have taken around there, going back weeks. The payoff led
 * with it, so a lap around your own street celebrated "+2.41 km²" for a run
 * that moved no border at all, and the reveal flew out to light up the whole
 * estate as though the run had just taken it.
 *
 * The server now sends `gained_m2` (the part of the claim that was not already
 * yours), `reinforced_m2` (the part that was) and the two shapes. This pins
 * what the screens do with them.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { revealGround } from '../src/components/claim/useClaimSequence';
import { victoryLabel } from '../src/components/claim/TerritoryVictoryBeat';
import ClaimPayoff from '../src/components/ClaimPayoff';

const ring = (n) => Array.from({ length: 4 }, (_, i) => [103.8 + i * 0.001 * n, 1.3 + i * 0.001]);

describe('the ground a claim reveals', () => {
  it('turns over the new ground, not the whole holding', () => {
    const gained = [ring(1)];
    expect(
      revealGround({
        territory: { rings: [ring(9)] },
        claim_rings: [ring(3)],
        gained_rings: gained,
      })
    ).toEqual({ rings: gained });
  });

  it('falls back to the claim footprint when a claim won nothing', () => {
    // A pure reinforcement still has to show WHERE it landed — an empty
    // reveal reads as a claim that failed.
    const footprint = [ring(3)];
    expect(
      revealGround({
        territory: { rings: [ring(9)] },
        claim_rings: footprint,
        gained_rings: [],
      })
    ).toEqual({ rings: footprint });
  });

  it('falls back to the territory for a backend that sends neither', () => {
    const territory = { rings: [ring(9)] };
    expect(revealGround({ territory })).toBe(territory);
  });
});

describe('the victory beat headline', () => {
  it('does not call reinforced ground new territory', () => {
    expect(victoryLabel({ victims: [], gained_m2: 0 })).toBe('TERRITORY REINFORCED');
    expect(victoryLabel({ victims: [], gained_m2: 61_000 })).toBe('NEW TERRITORY');
  });

  it('still says NEW TERRITORY for a backend that sends no figure', () => {
    expect(victoryLabel({ victims: [] })).toBe('NEW TERRITORY');
  });

  it('leaves a steal alone — that ground was somebody else\'s', () => {
    expect(victoryLabel({ victims: [{ defended: false }], gained_m2: 0 })).toBe('TERRITORY STOLEN');
  });
});

const claim = (extra) => ({
  territory: { id: 't1', area_m2: 2_410_000, rings: [ring(9)] },
  claimed_m2: 74_000,
  gained_m2: 61_000,
  reinforced_m2: 13_000,
  victims: [],
  xp_gained: 40,
  xp: 120,
  next_level_xp: 300,
  level: 3,
  ...extra,
});

// Every string this screen puts on the page, so an assertion is about what a
// runner can read rather than about which node it landed in.
function copy(tree) {
  return tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .flat(Infinity)
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function render(c) {
  let tree;
  act(() => {
    tree = renderer.create(
      <ClaimPayoff visible claim={c} myAvatar={{}} onClose={() => {}} onViewLeaderboard={() => {}} />
    );
  });
  return tree;
}

describe('the claim payoff', () => {
  it('leads with the land won, never the merged holding', () => {
    const tree = render(claim());
    const text = copy(tree);
    expect(text).toContain('+0.061 km²');
    // 2.41 km² is what the runner HOLDS. It is not what this run did.
    expect(text).not.toContain('2.41');
    act(() => tree.unmount());
  });

  it('names the reinforced half instead of folding it into the total', () => {
    const tree = render(claim());
    const text = copy(tree);
    expect(text).toContain('You reinforced your previous land and newly claimed 0.061 km²');
    expect(text).toContain('Reinforced');
    expect(text).toContain('0.013 km²');
    act(() => tree.unmount());
  });

  it('shows the land held before the claim: the holding less what it won', () => {
    const tree = render(claim());
    const text = copy(tree);
    expect(text).toContain('Previous land');
    // 2.41 km² held now, 0.061 of it new.
    expect(text).toContain('2.35 km²');
    act(() => tree.unmount());
  });

  it('names the runner who defended when every attack bounced', () => {
    const tree = render(claim({ victims: [{ user_id: 'd1', username: 'darylcheong', defended: true }] }));
    const text = copy(tree);
    expect(text).toContain('DARYLCHEONG DEFENDED THEIR LAND AGAINST YOU');
    // The headline already says it; the footnote does not repeat it.
    expect(text).not.toContain('held their ground');
    act(() => tree.unmount());
  });

  it('says so when a claim took nothing new', () => {
    const tree = render(claim({ gained_m2: 0, reinforced_m2: 74_000 }));
    const text = copy(tree);
    expect(text).toContain('TERRITORY REINFORCED');
    expect(text).not.toContain('TERRITORY CLAIMED');
    act(() => tree.unmount());
  });

  it('still reads the merged area for a backend too old to send gained_m2', () => {
    const { gained_m2, reinforced_m2, ...old } = claim();
    const tree = render(old);
    expect(copy(tree)).toContain('+2.41 km²');
    act(() => tree.unmount());
  });
});
