/**
 * The player identity system: three modes, contain scaling, rank beside the
 * runner rather than round it.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import CharacterRig, {
  BODY_RATIO,
  CharacterBust,
  FIGURE_ENVELOPE,
  HEADROOM,
  figureBounds,
} from '../src/components/character/CharacterRig';
import PortraitBorder from '../src/components/PortraitBorder';
import PlayerIdentity, {
  RankCrest,
  RunnerBust,
  RunnerFigure,
  figureLayout,
  resolvePose,
} from '../src/components/identity/PlayerIdentity';
import PlayerShowcaseCard from '../src/components/identity/PlayerShowcaseCard';
import { ITEMS } from '../src/config/cosmetics';
import { standingFrom } from '../src/config/rankLadder';

// react-test-renderer matches a React.memo(function) by its inner function.
const all = (tree, C) => {
  const a = tree.root.findAllByType(C);
  return a.length || !C.type ? a : tree.root.findAllByType(C.type);
};

const render = (element) => {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
};

// The tallest hat and the widest accessory in the catalogue, found rather than
// named, so the test keeps meaning something as the wardrobe grows.
function extreme(slot, pick) {
  let best = null;
  let bestVal = -Infinity;
  for (const item of ITEMS[slot]) {
    if (!item.layout) continue;
    const v = pick(item.layout);
    if (v > bestVal) { bestVal = v; best = item; }
  }
  return best;
}
const TALL_HAT = extreme('headwear', (l) => -(l.top ?? 0));
const WIDE_ACC = extreme('accessory', (l) => l.w ?? 0);

describe('figureBounds', () => {
  it('never reports less than the standard envelope', () => {
    const b = figureBounds(null);
    expect(b.up).toBeGreaterThanOrEqual(FIGURE_ENVELOPE.up);
    expect(b.down).toBeGreaterThanOrEqual(FIGURE_ENVELOPE.down);
    expect(b.half).toBeGreaterThanOrEqual(FIGURE_ENVELOPE.half);
  });

  // Jest's asset stub carries no pixel size, so without this every layer is
  // skipped and the envelope is all that comes back. Read the real PNG header
  // instead, which is exactly what RN's resolver reports on a device.
  describe('against the real art sizes', () => {
    const fs = require('fs');
    const path = require('path');
    const { Image } = require('react-native');
    let spy;
    beforeAll(() => {
      const real = Image.resolveAssetSource;
      spy = jest.spyOn(Image, 'resolveAssetSource').mockImplementation((src) => {
        const uri = src?.testUri || '';
        const at = uri.indexOf('assets/');
        if (at < 0) return real(src);
        const buf = fs.readFileSync(path.join(__dirname, '..', uri.slice(at)));
        return { uri, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      });
    });
    afterAll(() => spy.mockRestore());

    it('gives a tall hat the room above the head that HEADROOM does not', () => {
      const b = figureBounds({ headwear: TALL_HAT.id });
      expect(b.up).toBeGreaterThan(FIGURE_ENVELOPE.up + 0.05);
    });

    it('gives wide wings the width the body box does not', () => {
      const b = figureBounds({ accessory: WIDE_ACC.id });
      expect(b.half).toBeGreaterThan(FIGURE_ENVELOPE.half);
    });

    it('fits both inside the box, whole', () => {
      for (const equipped of [{ headwear: TALL_HAT.id }, { accessory: WIDE_ACC.id }]) {
        const g = figureLayout(equipped, { height: 200, width: 120 });
        expect(g.figH).toBeLessThanOrEqual(200 + 1e-6);
        expect(g.figW).toBeLessThanOrEqual(120 + 1e-6);
      }
    });
  });

  it('is the same object for the same loadout (memoized per loadout)', () => {
    const a = { hair: 'hs1' };
    expect(figureBounds(a)).toBe(figureBounds(a));
  });
});

describe('figureLayout (contain, never crop)', () => {
  const loadouts = [
    null,
    {},
    TALL_HAT ? { headwear: TALL_HAT.id } : {},
    WIDE_ACC ? { accessory: WIDE_ACC.id } : {},
  ];
  const boxes = [
    { height: 120 },
    { height: 240 },
    { height: 240, width: 60 },
    { width: 90 },
  ];

  it.each(loadouts.flatMap((l) => boxes.map((b) => [l, b])))('%j fits %j', (equipped, box) => {
    const g = figureLayout(equipped, box);
    expect(g.size).toBeGreaterThan(0);
    if (box.height) expect(g.figH).toBeLessThanOrEqual(box.height + 1e-6);
    if (box.width) expect(g.figW).toBeLessThanOrEqual(box.width + 1e-6);
    // The rig's own box starts no higher than the figure's top: the headroom
    // above the rig is inside what was reserved.
    expect(g.rigTop).toBeGreaterThanOrEqual(-1e-6);
    // Aspect ratio is the rig's own: its box is size wide, size * ratio tall.
    const b = figureBounds(equipped);
    expect(g.figH).toBeCloseTo(g.size * BODY_RATIO * (b.up + b.down), 6);
  });

  it('keeps the rig box, feet included, inside the reserved height', () => {
    const g = figureLayout({}, { height: 200 });
    const rigBottom = g.rigTop + g.size * BODY_RATIO * (1 + HEADROOM);
    expect(rigBottom).toBeLessThanOrEqual(200 + 1e-6);
  });
});

describe('RunnerFigure', () => {
  it('draws one whole rig (not headOnly) sized from the box', () => {
    const tree = render(<RunnerFigure equipped={{}} height={200} />);
    const rigs = all(tree, CharacterRig);
    expect(rigs).toHaveLength(1);
    expect(rigs[0].props.headOnly).toBeFalsy();
    expect(rigs[0].props.size).toBeCloseTo(figureLayout({}, { height: 200 }).size, 6);
    act(() => tree.unmount());
  });

  it('stands the figure on the floor of a taller box', () => {
    const tree = render(<RunnerFigure equipped={{}} height={300} width={200} />);
    const rig = tree.root.findByType(CharacterRig);
    const g = figureLayout({}, { height: 300, width: 200 });
    const top = StyleSheet.flatten(rig.props.style).top;
    expect(top).toBeCloseTo(300 - g.figH + g.rigTop, 6);
    act(() => tree.unmount());
  });
});

describe('poses', () => {
  it('falls back to neutral for a pose with no art', () => {
    expect(resolvePose('arms-crossed')).toBe('neutral');
    expect(resolvePose(undefined)).toBe('neutral');
    expect(resolvePose('victory')).toBe('celebrate');
  });
});

describe('PlayerIdentity modes', () => {
  it('portrait keeps the rank ring round the circular bust', () => {
    const tree = render(<PlayerIdentity mode="portrait" equipped={{}} rankKey="gold" size={40} />);
    expect(all(tree, PortraitBorder)).toHaveLength(1);
    expect(all(tree, CharacterBust)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it('bust shows rank as a crest, not a ring round the runner', () => {
    const tree = render(<PlayerIdentity mode="bust" equipped={{}} rankKey="gold" size={96} />);
    expect(all(tree, RunnerBust)).toHaveLength(1);
    expect(all(tree, RankCrest)).toHaveLength(1);
    expect(all(tree, CharacterBust)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('full draws the whole runner with a crest beside it', () => {
    const tree = render(
      <PlayerIdentity mode="full" equipped={{}} standing={standingFrom({ rank_key: 'mythic', points: 2484 })} size={220} />
    );
    expect(all(tree, RunnerFigure)).toHaveLength(1);
    expect(all(tree, RankCrest)).toHaveLength(1);
    expect(all(tree, CharacterBust)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('survives a runner who never opened the studio (avatar null)', () => {
    for (const mode of ['portrait', 'bust', 'full']) {
      const tree = render(<PlayerIdentity mode={mode} equipped={null} rankKey="wood" size={80} />);
      expect(all(tree, CharacterRig)).toHaveLength(1);
      act(() => tree.unmount());
    }
  });
});

describe('PlayerShowcaseCard', () => {
  it('leads with the runner and states the rank as a crest', () => {
    const tree = render(
      <PlayerShowcaseCard
        name="jonfong78"
        equipped={{}}
        standing={standingFrom({ rank_key: 'mythic', points: 2484 })}
        stats={['2.57 km² held', '157 runs', null]}
      />
    );
    expect(all(tree, RunnerFigure)).toHaveLength(1);
    const texts = tree.root.findAll((n) => typeof n.props?.children === 'string').map((n) => n.props.children);
    expect(texts).toContain('jonfong78');
    expect(texts).toContain('MYTHIC III');
    expect(texts).toContain('2.57 km² held · 157 runs');
    act(() => tree.unmount());
  });
});
