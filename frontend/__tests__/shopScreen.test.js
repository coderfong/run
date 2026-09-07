// The shop, after the browse redesign.
//
// Three things changed and all three are behavioural, not decorative: the
// wallet is pinned instead of scrolling away, browsing is by SLOT instead of
// by rarity, and selecting an item puts it ON the runner. These press the real
// screen and assert on what a shopper would see.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import ShopScreen from '../src/screens/ShopScreen';
import ShopWallet from '../src/components/shop/ShopWallet';
import ShopSlotTabs, { ALL_SLOTS } from '../src/components/shop/ShopSlotTabs';
import CharacterRig from '../src/components/character/CharacterRig';
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

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

function byLabel(tree, match) {
  return tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function'
      && String(n.props?.accessibilityLabel || '').includes(match)
  )[0];
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

  test('shows the price beside the balance once something is picked', () => {
    let tree;
    act(() => { tree = renderer.create(<ShopWallet coins={180} cost={240} affordable={false} />); });
    const t = texts(tree);
    expect(t).toContain('180');
    expect(t).toContain('240');
    // The number that actually decides the tap.
    expect(t).toContain('60 coins short. Run to earn more.');
  });

  test('an affordable price is not flagged as short', () => {
    let tree;
    act(() => { tree = renderer.create(<ShopWallet coins={500} cost={240} affordable />); });
    expect(texts(tree)).not.toContain('short');
  });
});

describe('browsing by slot', () => {
  test('a tab per slot with stock, counted, All first', async () => {
    const tree = await mountShop();
    const t = texts(tree);
    expect(t).toContain('All');
    expect(t).toContain('Hats');
    expect(t).toContain('Glasses');
    expect(t).toContain('Tops');
    // Nothing in stock for these, so no dead-end tabs.
    expect(t).not.toContain('Shoes');
  });

  test('picking a slot narrows the shelf to it', async () => {
    const tree = await mountShop();
    // Four items on All; two of them are hats.
    expect(byLabel(tree, ', rare,')).toBeTruthy();
    await act(async () => { byLabel(tree, 'Hats, 2 items').props.onPress(); });
    expect(byLabel(tree, ', rare,')).toBeFalsy();
    expect(byLabel(tree, 'Cap, common')).toBeTruthy();
  });

  test('an empty tab list renders nothing at all', () => {
    let tree;
    act(() => { tree = renderer.create(<ShopSlotTabs tabs={[]} value={ALL_SLOTS} />); });
    expect(tree.toJSON()).toBeNull();
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

  test('the buy button names the price, and refuses what you cannot afford', async () => {
    const tree = await mountShop();
    // 180 coins in the purse.
    await act(async () => { byLabel(tree, ', common, 80 coins').props.onPress(); });
    expect(texts(tree)).toContain('Buy for 80');

    await act(async () => { byLabel(tree, ', legendary,').props.onPress(); });
    expect(texts(tree)).toContain('Not enough coins');
  });
});
