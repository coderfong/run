// The shop, after the browse redesign.
//
// Three things changed and all three are behavioural, not decorative: the
// wallet is pinned instead of scrolling away, the shelf is a fixed NINE with
// nothing to filter it by, and selecting an item puts it ON the runner. These
// press the real screen and assert on what a shopper would see.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import ShopScreen from '../src/screens/ShopScreen';
import ShopWallet from '../src/components/shop/ShopWallet';
import CharacterRig, { BODY_RATIO, HEADROOM } from '../src/components/character/CharacterRig';
import { api } from '../src/api/client';
import { invalidate } from '../src/api/cache';

// Real catalogue ids, so the tiles carry the labels a shopper actually sees
// (`getItem` resolves them) rather than raw ids.
const EQUIPPED = { headwear: 'none', top: 'stripetee', hair: 'short' };

jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({
    equipped: { headwear: 'none', top: 'stripetee', hair: 'short' },
    isUnlocked: () => false,
    refreshUnlocks: jest.fn(),
  }),
}));

// The illustration takes no touches and answers to no screen reader; it is
// also the heaviest thing on the page. Nothing here is about it.
jest.mock('../src/components/shop/PitStopScene', () => () => null);

const SHOP = {
  coins: 180,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  items: [
    { item_id: 'cap', slot: 'headwear', rarity: 'common', price: 100, owned: false },
    { item_id: 'beanie', slot: 'headwear', rarity: 'legendary', price: 900, owned: false },
    { item_id: 'wayfarer', slot: 'glasses', rarity: 'rare', price: 240, owned: false },
    { item_id: 'singlet', slot: 'top', rarity: 'common', price: 80, owned: false },
  ],
};

// A window from the OLD twelve-item rotation, in the mix it used to send:
// five common, four rare, two epic, one legendary. Real catalogue ids, so the
// tiles resolve to the labels a shopper reads.
const WIDE = {
  ...SHOP,
  items: [
    ['greenscarf', 'accessory', 'common'],
    ['tealscarf', 'accessory', 'common'],
    ['gaiter', 'accessory', 'common'],
    ['pearls', 'accessory', 'common'],
    ['charmchain', 'accessory', 'common'],
    ['starnecklace', 'accessory', 'rare'],
    ['lacecollar', 'accessory', 'rare'],
    ['dogtags', 'accessory', 'rare'],
    ['pearlcollar', 'accessory', 'rare'],
    ['cape', 'accessory', 'epic'],
    ['angelwings', 'accessory', 'epic'],
    ['fairywings', 'accessory', 'legendary'],
  ].map(([item_id, slot, rarity]) => ({ item_id, slot, rarity, price: 150, owned: false })),
};

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

function pressablesByLabel(tree, match) {
  return tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function'
      && String(n.props?.accessibilityLabel || '').includes(match)
  );
}

function byLabel(tree, match) {
  return pressablesByLabel(tree, match)[0];
}

/**
 * The LABELS of the matching pressables, deduplicated.
 *
 * `findAll` returns the composite element and its host view for the same
 * button, so counting nodes counts every tile twice. One tile is one label.
 */
function labelsFor(tree, match) {
  return [...new Set(
    pressablesByLabel(tree, match).map((n) => String(n.props.accessibilityLabel))
  )];
}

/** Every product tile on the shelf, found by the rarity in its label. */
function tiles(tree) {
  return ['common', 'rare', 'epic', 'legendary']
    .flatMap((rarity) => labelsFor(tree, `, ${rarity},`));
}

// `useIsFocused` and `useQuery` both reach for the navigation object through
// context rather than through props, so the screen has to be mounted inside a
// provider the way the navigator mounts it.
const navigation = {
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  isFocused: () => true,
  getParent: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
};

async function mountShop() {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <ShopScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

beforeEach(() => {
  invalidate('me:');
  jest.restoreAllMocks();
  jest.spyOn(api, 'shop').mockResolvedValue(SHOP);
});

// The restock clock ticks on a one second setInterval for as long as the shop
// is mounted, and a never-settling interval means `act()` never settles either
// — the suite simply hangs. Fake timers hold the clock still; nothing here is
// about the countdown.
beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('the pinned wallet', () => {
  test('says nothing rather than zero before the balance lands', () => {
    // A placeholder 0 on a shop reads as "you are broke".
    let tree;
    act(() => { tree = renderer.create(<ShopWallet coins={null} />); });
    expect(texts(tree)).not.toContain('0');
  });

  test('sits in the header row, beside the way back', async () => {
    const tree = await mountShop();
    expect(byLabel(tree, 'Go back')).toBeTruthy();
    expect(texts(tree)).toContain('180');
  });
});

describe('the shelf', () => {
  test('nine items, even when the server still sends twelve', async () => {
    // The app talks to a deployed backend, so it goes on receiving the old
    // twelve-item window until the new coins.py ships. The shelf is nine
    // either way.
    jest.spyOn(api, 'shop').mockResolvedValue(WIDE);
    const tree = await mountShop();
    expect(tiles(tree)).toHaveLength(9);
  });

  test('the cap keeps one of every rarity, not the first nine', async () => {
    // A plain slice of a rarity-sorted list would hand back commons and rares
    // and drop the legendary, which is the one item anybody is saving for.
    jest.spyOn(api, 'shop').mockResolvedValue(WIDE);
    const tree = await mountShop();
    expect(labelsFor(tree, ', common,')).toHaveLength(4);
    expect(labelsFor(tree, ', rare,')).toHaveLength(3);
    expect(labelsFor(tree, ', epic,')).toHaveLength(1);
    expect(labelsFor(tree, ', legendary,')).toHaveLength(1);
  });

  test('a short window is shown whole rather than padded', async () => {
    const tree = await mountShop();
    expect(tiles(tree)).toHaveLength(SHOP.items.length);
  });

  test('nothing filters it', async () => {
    // The slot tabs are gone: nine tiles is small enough to be its own index,
    // and a "Hats 2" chip implies there is more behind it.
    const tree = await mountShop();
    expect(byLabel(tree, 'Hats, 2 items')).toBeFalsy();
    expect(byLabel(tree, 'All, 4 items')).toBeFalsy();
  });
});

describe('trying it on', () => {
  test('selecting an item draws the runner WEARING it', async () => {
    const tree = await mountShop();
    // Nothing selected: no fitting mirror.
    expect(tree.root.findAllByType(CharacterRig)).toHaveLength(0);

    await act(async () => { byLabel(tree, 'Cap, common').props.onPress(); });

    const rig = tree.root.findAllByType(CharacterRig)[0];
    expect(rig).toBeTruthy();
    // The candidate merged over the live outfit — a hat judged against your
    // own hair and jacket, not floating on a blank runner.
    expect(rig.props.equipped).toEqual({ ...EQUIPPED, headwear: 'cap' });
  });

  test('the preview is a render prop and never writes the outfit', async () => {
    const tree = await mountShop();
    await act(async () => { byLabel(tree, ', legendary,').props.onPress(); });
    const rig = tree.root.findAllByType(CharacterRig)[0];
    expect(rig.props.equipped.headwear).toBe('beanie');
    // The context's own equipped set is untouched.
    expect(EQUIPPED.headwear).toBe('none');
  });

  test('the runner stands in the mirror whole, head to feet', async () => {
    // The rig's `size` is its WIDTH, and a runner is ~2.9x as tall as that.
    // Handing it the mirror's height as a width drew a 388pt runner in a
    // 132pt window that kept only the legs, so the item being tried on was
    // never in the preview.
    const tree = await mountShop();
    await act(async () => { byLabel(tree, 'Cap, common').props.onPress(); });
    const rig = tree.root.findAllByType(CharacterRig)[0];
    const mirror = StyleSheet.flatten(rig.parent.props.style);
    const tall = rig.props.size * BODY_RATIO * (1 + HEADROOM);
    expect(tall + mirror.paddingBottom).toBeLessThanOrEqual(mirror.height);
    expect(rig.props.size).toBeLessThanOrEqual(mirror.width);
    // …and fills it, rather than fitting by shrinking to a speck.
    expect(tall).toBeGreaterThan(mirror.height * 0.8);
  });

  test('the buy button names the price, and refuses what you cannot afford', async () => {
    const tree = await mountShop();
    // 180 coins in the purse.
    await act(async () => { byLabel(tree, ', common, 80 coins').props.onPress(); });
    expect(texts(tree)).toContain('Buy for 80');

    await act(async () => { byLabel(tree, ', legendary,').props.onPress(); });
    expect(texts(tree)).toContain('Not enough coins');
  });

  test('an item you cannot afford says how far short you are', async () => {
    const tree = await mountShop();
    // 180 in the purse, 900 on the legendary: the number that decides the tap.
    await act(async () => { byLabel(tree, ', legendary,').props.onPress(); });
    expect(texts(tree)).toContain('720 coins short. Run to earn more.');

    await act(async () => { byLabel(tree, ', common, 80 coins').props.onPress(); });
    expect(texts(tree)).not.toContain('short');
  });
});
