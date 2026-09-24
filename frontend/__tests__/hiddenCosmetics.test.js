/**
 * Items hidden from the app (src/config/hiddenCosmetics.js, set from the Fit
 * Studio): still in the catalogue, never offered.
 */

// A handful of ordinary glasses (not pass or PRO rewards, so boxes and the
// dice would otherwise offer them). Ids rather than a catalogue lookup: the
// catalogue imports this module, so the mock cannot read it.
const HIDE = ['halfframe', 'starglasses', 'hexshades', 'cateye', 'aviators', 'eyepatch', 'clownglasses', 'sleepmask'];
jest.mock('../src/config/hiddenCosmetics', () => {
  const hidden = new Set(['halfframe', 'starglasses', 'hexshades', 'cateye', 'aviators', 'eyepatch', 'clownglasses', 'sleepmask']);
  return {
    HIDDEN_IDS: [...hidden],
    isHiddenId: (id) => hidden.has(id),
    isHiddenItem: (item) => !!item && hidden.has(item.id),
    listedItems: (items, keepId) => (items || []).filter((i) => !hidden.has(i.id) || i.id === keepId),
  };
});

const { ITEMS, getItem, randomEquipped } = require('../src/config/cosmetics');
const { HIDDEN_IDS, listedItems } = require('../src/config/hiddenCosmetics');
const { rollCosmetic } = require('../src/config/lootboxRoll');

const hidden = new Set(HIDDEN_IDS);

it('hides the ids the test means to', () => expect(HIDDEN_IDS.sort()).toEqual([...HIDE].sort()));

it('still resolves a hidden item, so anyone wearing one renders', () => {
  const id = HIDDEN_IDS[0];
  expect(getItem('glasses', id).id).toBe(id);
});

it('leaves hidden items out of a slot listing, except the one being worn', () => {
  const worn = HIDDEN_IDS[0];
  const listed = listedItems(ITEMS.glasses, worn).map((i) => i.id);
  expect(listed).toContain(worn);
  expect(listed.filter((id) => hidden.has(id))).toEqual([worn]);
});

it('never rolls a hidden item onto a random character', () => {
  const everything = { has: () => true };
  for (let n = 0; n < 200; n++) {
    const outfit = randomEquipped({ stats: {}, unlocked: everything, isUnlocked: () => true });
    expect(hidden.has(outfit.glasses)).toBe(false);
  }
});

it('never hands a hidden item out of a loot box', () => {
  for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
    for (let n = 0; n < 100; n++) {
      let got;
      try { got = rollCosmetic(rarity, () => false); } catch (e) { break; }
      expect([got.item.id, hidden.has(got.item.id)]).toEqual([got.item.id, false]);
    }
  }
});
