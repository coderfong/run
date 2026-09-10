/**
 * The payoff fits on the screen, and it states the two ladders as movement.
 *
 * TWO THINGS THIS PINS.
 *
 * It does not scroll. The payoff is the four seconds a run is for, and it was
 * a ScrollView: the faces you took the land from sat below the fold on a small
 * phone, the bars moved where nobody was looking, and the one way off the
 * screen took a flick to reach. Nothing here can put a scroller back without
 * this failing.
 *
 * And it does not print rank as a receipt. "+21 rank points · 2,471 total" is
 * a number nobody counts in — what a runner holds is a RUNG, and the only
 * question a claim answers is whether it moved them. The bar answers it, in
 * whichever direction the claim went.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';

import ClaimPayoff, { density, faceCap, fittedHeight } from '../src/components/ClaimPayoff';
import RankProgress from '../src/components/rank/RankProgress';
import { RANK_FLOORS, rankBands, rankSteps } from '../src/config/rankLadder';

const victim = (n, extra) => ({
  user_id: `u${n}`,
  username: `runner${n}`,
  area_m2: 12_000,
  defended: false,
  avatar: {},
  ...extra,
});

const claim = (extra) => ({
  territory: { id: 't1', area_m2: 640_000, rings: [] },
  gained_m2: 630_000,
  reinforced_m2: 0,
  victims: [victim(1)],
  xp_gained: 205,
  xp: 1_240,
  next_level_xp: 1_500,
  level: 11,
  solo_elo: 2_471,
  solo_elo_delta: 21,
  ...extra,
});

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

describe('the payoff fits the screen it is on', () => {
  it('has nothing to scroll', () => {
    const tree = render(claim());
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('counts everyone it hit even when it can only show some of them', () => {
    // Six runners, and no phone has room for six portraits above a button.
    // The headline still says six; the faces that did not fit are counted.
    const tree = render(claim({ victims: Array.from({ length: 6 }, (_, i) => victim(i)) }));
    const text = copy(tree);
    expect(text).toContain('YOU TOOK LAND FROM 6 RUNNERS');
    expect(text).toMatch(/and \d+ more/);
    act(() => tree.unmount());
  });

  it('still fits when a claim took nothing rated and gave no XP', () => {
    const tree = render(claim({ victims: [], solo_elo_delta: 0, xp_gained: 0 }));
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe('the fit, on every phone and every claim', () => {
  // Bottom to top: SE, the 8, the 11/XR, a 14, a Pro Max, a tall Android.
  const PHONES = [
    { name: 'SE', h: 667, top: 20, bottom: 0 },
    { name: '8', h: 667, top: 20, bottom: 0 },
    { name: 'XR', h: 812, top: 44, bottom: 34 },
    { name: '14', h: 844, top: 47, bottom: 34 },
    { name: 'Pro Max', h: 932, top: 59, bottom: 34 },
    { name: 'tall Android', h: 915, top: 24, bottom: 24 },
  ];

  // Every shape a claim comes in, from the quietest to the loudest.
  const SHAPES = [
    { name: 'a quiet reinforcement', v: 0, reinforced: true, steal: false, held: false, rank: false, xp: true },
    { name: 'one steal', v: 1, reinforced: false, steal: true, held: false, rank: true, xp: true },
    { name: 'a steal that also reinforced', v: 1, reinforced: true, steal: true, held: false, rank: true, xp: true },
    { name: 'a brawl with defences that held', v: 6, reinforced: true, steal: true, held: true, rank: true, xp: true },
  ];

  PHONES.forEach((phone) => {
    SHAPES.forEach((shape) => {
      it(`${shape.name} fits a ${phone.name}`, () => {
        const rows = Math.min(shape.v, faceCap(phone.h));
        const extra = shape.v - rows;
        const blocks = {
          reinforced: shape.reinforced,
          steal: shape.steal,
          held: shape.held,
          rank: shape.rank,
          xp: shape.xp,
        };
        const d = density({ winH: phone.h, top: phone.top, bottom: phone.bottom, rows, extra, blocks });
        // The same box `density` was handed. Anything taller than this is a
        // scroll on a screen that is not allowed to have one. Measured against
        // `d.show` — what the screen actually draws — since a tight fit sheds
        // its footnotes before it starts squeezing.
        const avail = phone.h - phone.top - phone.bottom - 60 - 12 - d.pad * 2;
        expect(fittedHeight({ d, rows, extra, blocks: d.show })).toBeLessThanOrEqual(avail);
        expect(d.fits).toBe(true);
      });
    });
  });

  it('gives the slack back to the character rather than to the margins', () => {
    // A big phone with a small claim on it: the runner is drawn at full size
    // and the stage grows into what is left, which is why the stage — and only
    // the stage — is the flexible box in the layout.
    const blocks = { reinforced: false, steal: false, held: false, rank: false, xp: true };
    const d = density({ winH: 932, top: 59, bottom: 34, rows: 0, extra: 0, blocks });
    expect(d.k).toBe(1);
    expect(d.rig).toBe(104);
  });

  it('shrinks rather than clipping when a brawl lands on the smallest phone', () => {
    const blocks = { reinforced: true, steal: true, held: true, rank: true, xp: true };
    const d = density({ winH: 667, top: 20, bottom: 0, rows: 1, extra: 5, blocks });
    expect(d.k).toBeLessThan(1);
    // ...but never past the floor, where the frames stop reading as frames.
    expect(d.k).toBeGreaterThanOrEqual(0.62);
  });

  it('drops the footnotes before it makes the subject small', () => {
    // A brawl on an SE has more to say than there is room for. What goes is
    // the context — a defence that held, ground reinforced — and never the
    // ground taken, the faces, or the ladders.
    const blocks = { reinforced: true, steal: true, held: true, rank: true, xp: true };
    const tight = density({ winH: 667, top: 20, bottom: 0, rows: 1, extra: 5, blocks });
    expect(tight.show.held).toBe(false);
    expect(tight.show.steal).toBe(true);
    expect(tight.show.rank).toBe(true);
    expect(tight.show.xp).toBe(true);

    // ...and it keeps them whenever they fit, which is most of the time.
    const roomy = density({ winH: 932, top: 59, bottom: 34, rows: 1, extra: 0, blocks });
    expect(roomy.show).toMatchObject({ held: true, reinforced: true });
  });
});

describe('rank as movement, not a receipt', () => {
  it('draws the bar instead of the points the claim paid', () => {
    const tree = render(claim());
    const text = copy(tree);
    expect(tree.root.findAllByType(RankProgress)).toHaveLength(1);
    expect(text).not.toContain('rank points · ');
    expect(text).not.toContain('+21');
    act(() => tree.unmount());
  });

  it('leaves the bar off a claim the ladder did not judge', () => {
    // A neutral expansion moves nothing. A bar that travels nowhere says the
    // claim was weighed and found worthless, which is not what happened.
    const tree = render(claim({ victims: [], solo_elo_delta: 0 }));
    expect(tree.root.findAllByType(RankProgress)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe('the ladder the bar runs on', () => {
  const bands = rankBands();

  it('cuts every tier but the top into its three divisions', () => {
    // Nine tiers × 3 divisions, and Mythic as one band with no ceiling.
    expect(bands).toHaveLength(9 * 3 + 1);
    expect(bands[0]).toMatchObject({ key: 'wood', division: 1, lo: RANK_FLOORS[0] });
    expect(bands[bands.length - 1]).toMatchObject({ key: 'mythic', hi: null });
  });

  it('climbs in one pass when the move stays inside a division', () => {
    const steps = rankSteps(1_360, 1_380, bands);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBeGreaterThan(steps[0].from);
    expect(steps[0].band.name).toBe('Gold I');
  });

  it('fills each division it crosses on the way up', () => {
    const steps = rankSteps(1_340, 1_460, bands);
    expect(steps.map((s) => s.band.name)).toEqual(['Silver III', 'Gold I', 'Gold II', 'Gold III']);
    // Every pass but the last runs to a full track, and the last stops where
    // the runner did.
    expect(steps.slice(0, -1).every((s) => s.to === 1)).toBe(true);
    expect(steps[steps.length - 1].to).toBeLessThan(1);
  });

  it('EMPTIES back through the divisions below when rank falls', () => {
    const steps = rankSteps(1_460, 1_340, bands);
    expect(steps.map((s) => s.band.name)).toEqual(['Gold III', 'Gold II', 'Gold I', 'Silver III']);
    expect(steps.slice(0, -1).every((s) => s.to === 0)).toBe(true);
    expect(steps[steps.length - 1].to).toBeGreaterThan(0);
  });

  it('reads full at the top of the ladder, which has nothing above it', () => {
    const steps = rankSteps(2_600, 2_900, bands);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: 1, to: 1 });
  });

  it('keeps an unrated account at the bottom rung rather than off the ladder', () => {
    const steps = rankSteps(200, 400, bands);
    expect(steps[0].band.name).toBe('Wood I');
    expect(steps[0].from).toBe(0);
  });
});
