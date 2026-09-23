// The box gamble, driven by taps.
//
// The static checks catch a missing import; only rendering catches a screen
// that mounts and then does the wrong thing when you press it. These press the
// real component through whole server sequences and assert on what it says,
// because the captions and the pips ARE the mechanic: they are the only thing
// telling the player what a tap just did.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import LootboxGamble from '../src/components/lootbox/LootboxGamble';
import Chest, {
  CHEST_COLORS,
  ChestBase,
  ChestLid,
  ChestLidInside,
  chestColors,
} from '../src/components/lootbox/Chest';
import { TIERS } from '../src/components/lootbox/openingPlan';
import {
  REVEAL_PHASE,
  chestPose,
  flashAt,
  itemPose,
  revealTimeline,
  stagePose,
} from '../src/components/lootbox/revealTimeline';
import RewardArt from '../src/components/RewardArt';
import { Modal } from 'react-native';

// Sequences exactly as backend/app/lootbox.py hands them over.
const lucky = {
  rarity: 'rare',
  final_rarity: 'epic',
  chances: 3,
  steps: [
    { upgraded: false, rarity: 'rare' },
    { upgraded: true, rarity: 'epic' },
    { upgraded: false, rarity: 'epic' },
  ],
};
const unlucky = {
  rarity: 'common',
  final_rarity: 'common',
  chances: 3,
  steps: [
    { upgraded: false, rarity: 'common' },
    { upgraded: false, rarity: 'common' },
    { upgraded: false, rarity: 'common' },
  ],
};
const topped = { rarity: 'legendary', final_rarity: 'legendary', chances: 0, steps: [] };
const reward = { kind: 'cosmetic', key: 'headwear:test-hat', label: 'Test Hat' };

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

/** The one full-screen pressable that spends a chance. */
function tapOnce(tree) {
  const area = tree.root.findAll(
    (n) => typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.includes('chest')
      && typeof n.props.onPress === 'function'
  )[0];
  act(() => { area.props.onPress(); });
}

describe('the chest drawing', () => {
  test('has a full palette for every rarity a box can be', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
      const c = chestColors(rarity);
      for (const slot of ['page', 'body', 'shade', 'deep', 'ink']) {
        expect(c[slot]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  test('an unknown rarity still draws, at the floor', () => {
    expect(chestColors('mythic-typo')).toBe(CHEST_COLORS.common);
  });

  test('renders shut and open without throwing', () => {
    let t;
    act(() => { t = renderer.create(<Chest width={200} rarity="epic" />); });
    expect(t.toJSON()).toBeTruthy();
    act(() => { t.update(<Chest width={200} rarity="epic" open />); });
    expect(t.toJSON()).toBeTruthy();
  });

  test('the gamble swaps from its shut pose to its open pose under the flash', () => {
    // Every drawing is mounted from the start; the clock picks which one
    // shows, and the pick flips while the screen is solid white.
    for (const rarity of TIERS) {
      const { marks: m } = revealTimeline(rarity);
      expect(chestPose(m.swapAt - 1, m)).toMatchObject({ closed: 1, open: 0 });
      expect(chestPose(m.swapAt, m)).toMatchObject({ closed: 0, open: 1 });
      expect(flashAt(m.swapAt, m)).toBe(1);
    }
    let t;
    act(() => { t = renderer.create(<LootboxGamble visible sequence={lucky} reward={reward} />); });
    expect(t.root.findAllByType(ChestLid)).toHaveLength(1);
    expect(t.root.findAllByType(ChestLidInside)).toHaveLength(1);
    act(() => t.unmount());
  });
});

describe('one reveal timeline', () => {
  test.each(TIERS)('%s: the item starts coming out of the chest on the frame the flash hits', (rarity) => {
    const { marks: m } = revealTimeline(rarity);
    const rise = 120;
    expect(itemPose(m.flashAt - 1, m, rise).opacity).toBe(0);
    expect(flashAt(m.flashAt - 1, m)).toBe(0);
    // Hidden under the flash as it starts: rising, but the screen is white.
    const early = itemPose(m.flashAt + m.flashUp, m, rise);
    expect(early.opacity).toBeGreaterThan(0);
    expect(early.translateY).toBeLessThan(rise);
    expect(flashAt(m.flashAt + m.flashUp, m)).toBe(1);
    // Solid by the time the white starts to fall away.
    expect(itemPose(m.whiteEnd + 60, m, rise).opacity).toBe(1);
  });

  test.each(TIERS)('%s: the chest and the item are on screen together', (rarity) => {
    const { marks: m } = revealTimeline(rarity);
    const overlap = [];
    for (let t = m.flashAt; t <= m.settledAt; t += 10) {
      const chest = chestPose(t, m).opacity;
      const item = itemPose(t, m, 120).opacity;
      if (chest > 0.1 && item > 0.1) overlap.push(t);
    }
    expect(overlap.length * 10).toBeGreaterThanOrEqual(200);
    // ...and the chest backs off down and shrinks while it goes.
    const out = chestPose(m.swapAt + 460, m);
    expect(out.opacity).toBe(0);
    expect(out.exitY).toBe(60);
    expect(out.exitScale).toBeCloseTo(0.88);
  });

  test.each(TIERS)('%s: the item overshoots, then settles at its hero size, upright', (rarity) => {
    const { marks: m } = revealTimeline(rarity);
    expect(itemPose(m.flashAt, m, 120).scale).toBeCloseTo(0.45);
    expect(itemPose(m.heroAt, m, 120).scale).toBeCloseTo(1.12);
    expect(itemPose(m.settledAt, m, 120)).toMatchObject({ scale: 1, rotate: 0, translateY: 0, opacity: 1 });
  });

  test.each(TIERS)('%s: the page morphs into the tier under the flash, never cuts', (rarity) => {
    const { marks: m } = revealTimeline(rarity);
    expect(stagePose(m.flashAt, m).page).toBe(0);
    const mid = stagePose(m.flashAt + m.flashUp + 190, m).page;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(stagePose(m.settledAt, m).page).toBe(1);
  });

  test.each(TIERS)('%s: beats run in order, and the captions follow the item', (rarity) => {
    const { cues, marks: m, end } = revealTimeline(rarity);
    const phases = cues.filter((c) => c.phase).map((c) => c.phase);
    expect(phases).toEqual([
      REVEAL_PHASE.CHARGE, REVEAL_PHASE.OPEN, REVEAL_PHASE.BURST,
      REVEAL_PHASE.ITEM_EMERGE, REVEAL_PHASE.ITEM_HERO, REVEAL_PHASE.COMPLETE,
    ]);
    const at = (pred) => cues.find(pred).at;
    expect(at((c) => c.phase === REVEAL_PHASE.BURST)).toBe(m.flashAt);
    // Item visible → 150–250ms → name → tier → ~300ms → hint.
    expect(m.nameAt - m.whiteEnd).toBeGreaterThanOrEqual(150);
    expect(m.nameAt - m.whiteEnd).toBeLessThanOrEqual(250);
    expect(at((c) => c.copy === 2)).toBeGreaterThan(at((c) => c.copy === 1));
    expect(at((c) => c.copy === 3) - at((c) => c.copy === 2)).toBeGreaterThanOrEqual(300);
    expect(at((c) => c.phase === REVEAL_PHASE.COMPLETE)).toBeGreaterThanOrEqual(m.settledAt);
    expect(end).toBeGreaterThan(m.hintAt);
    // Haptics: light ticks through the build, a hard hit, success on landing.
    expect(cues.filter((c) => c.haptic === 'light' && c.at < m.flashAt).length).toBeGreaterThanOrEqual(2);
    expect(['medium', 'heavy']).toContain(cues.find((c) => c.impact).haptic);
    expect(at((c) => c.haptic === 'success')).toBe(m.settledAt);
  });

  test('legendary goes dead still for its held breath', () => {
    const { marks: m, cues } = revealTimeline('legendary');
    const mid = (m.hitchAt + m.hitchEnd) / 2;
    expect(chestPose(mid, m).shakeX).toBeCloseTo(0);
    expect(cues.some((c) => c.haptic === 'light' && c.at > m.hitchAt && c.at < m.hitchEnd && !c.light)).toBe(false);
  });
});

describe('mystery swipes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** The full-screen pressable, once the item has landed. */
  function continueArea(tree) {
    return tree.root.findAll(
      (n) => typeof n.props?.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.includes('Tap to continue')
        && typeof n.props.onPress === 'function'
    )[0];
  }

  test.each([lucky, unlucky, topped])('one scene from the chest to the item, and only a tap after it lands leaves: %j', (sequence) => {
    const onCollect = jest.fn();
    const { marks: m } = revealTimeline(sequence.final_rarity);
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={sequence} reward={reward} onCollect={onCollect} />); });
    // The reward is known and already drawn (invisibly) before the first swipe.
    expect(tree.root.findAllByType(RewardArt)[0].props.reward).toBe(reward);
    expect(texts(tree)).toContain('MYSTERY');
    for (let i = 0; i < 2; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
      expect(texts(tree)).toContain('MYSTERY');
    }
    tapOnce(tree);
    expect(texts(tree)).toContain('MYSTERY');
    // Through the hit and the item coming out: still the same single modal,
    // still no way out, and the captions arrive in order.
    act(() => jest.advanceTimersByTime(m.flashAt + 5));
    expect(texts(tree)).not.toContain('MYSTERY');
    expect(texts(tree)).not.toContain('Test Hat');
    act(() => jest.advanceTimersByTime(m.nameAt - m.flashAt));
    expect(texts(tree)).toContain('Test Hat');
    expect(texts(tree)).not.toContain(sequence.final_rarity.toUpperCase());
    act(() => jest.advanceTimersByTime(m.rarityAt - m.nameAt));
    expect(texts(tree)).toContain(sequence.final_rarity.toUpperCase());
    expect(texts(tree)).not.toContain('Tap to continue');
    expect(continueArea(tree)).toBeUndefined();
    expect(tree.root.findAllByType(Modal)).toHaveLength(1);
    expect(onCollect).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(m.hintAt - m.rarityAt));
    expect(texts(tree)).toContain('Tap to continue');
    expect(onCollect).not.toHaveBeenCalled();
    // A burst of taps, and the back button, collect exactly once.
    const area = continueArea(tree);
    act(() => { area.props.onPress(); area.props.onPress(); });
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith(sequence.final_rarity, reward);
    act(() => tree.unmount());
  });

  test('taps during the build are ignored and cannot restart the opening', () => {
    const onCollect = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} reward={reward} onCollect={onCollect} />); });
    for (let i = 0; i < 3; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
    }
    const opening = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Opening chest' && typeof n.props.onPress === 'function')[0];
    expect(opening.props.disabled).toBe(true);
    act(() => { opening.props.onPress(); opening.props.onPress(); });
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(onCollect).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('rapid repeated inputs cannot skip the mystery beats', () => {
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} />); });
    tapOnce(tree);
    tapOnce(tree);
    const area = tree.root.findAll((n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('Mystery chest'))[0];
    expect(area.props.accessibilityLabel).toContain('2 charges remaining');
    act(() => tree.unmount());
  });

  test('closing mid-open cancels the reveal and never collects', () => {
    const onCollect = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} reward={reward} onCollect={onCollect} />); });
    for (let i = 0; i < 3; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
    }
    act(() => tree.update(<LootboxGamble visible={false} sequence={lucky} reward={reward} onCollect={onCollect} />));
    act(() => jest.advanceTimersByTime(2000));
    expect(onCollect).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('unmounting mid-reveal leaves no timer behind', () => {
    const haptics = require('expo-haptics');
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={topped} reward={reward} />); });
    for (let i = 0; i < 3; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
    }
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
    haptics.impactAsync.mockClear();
    haptics.notificationAsync.mockClear();
    act(() => jest.advanceTimersByTime(10000));
    expect(haptics.impactAsync).not.toHaveBeenCalled();
    expect(haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
