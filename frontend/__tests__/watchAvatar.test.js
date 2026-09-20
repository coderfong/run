/**
 * The runner's portrait on the wrist.
 *
 * The watch cannot draw the character, so the phone rasterises it and sends a
 * picture. Two rules make that affordable, and both are here: it travels on
 * its own rather than inside the run state (which is re-sent on a ten second
 * heartbeat), and it is sent once per LOOK rather than once per launch, which
 * is what `avatarKey` is for.
 */

// From the pure module, not from the component that re-exports it: drawing a
// portrait means reaching the whole cosmetics catalogue and every PNG in it,
// and when to SEND one is a rule that should hold with no art at all.
import { avatarKey } from '../src/watch/avatarKey';
import { buildWatchState } from '../src/watch/watchState';

let mockModule = null;
jest.mock('../src/watch/nativeWatch', () => ({
  __esModule: true,
  default: () => mockModule,
}));

const link = require('../src/watch/watchLink');

const LOOK = {
  face: 'smiley',
  hair: 'curtains',
  hairColor: 4,
  headwear: 'none',
  glasses: 'none',
  top: 'stripetee',
  topColor: 7,
  bottom: 'wb009',
  bottomColor: 1,
  footwear: 'none',
  accessory: 'none',
};

afterEach(() => {
  mockModule = null;
});

describe('naming a look', () => {
  it('is stable for the same loadout', () => {
    expect(avatarKey(LOOK)).toBe(avatarKey({ ...LOOK }));
  });

  it('does not depend on the order the slots were written in', () => {
    const reversed = Object.fromEntries(Object.entries(LOOK).reverse());
    expect(avatarKey(reversed)).toBe(avatarKey(LOOK));
  });

  it('changes when anything drawn changes', () => {
    const base = avatarKey(LOOK);
    expect(avatarKey({ ...LOOK, headwear: 'cap' })).not.toBe(base);
    expect(avatarKey({ ...LOOK, hairColor: 5 })).not.toBe(base);
    expect(avatarKey({ ...LOOK, face: 'laugh' })).not.toBe(base);
  });

  it('ignores everything that does not draw, so a portrait is not re-sent for it', () => {
    expect(avatarKey({ ...LOOK, updatedAt: 12345, rank_key: 'gold' })).toBe(avatarKey(LOOK));
  });

  it('survives a runner who has never opened the studio', () => {
    expect(typeof avatarKey(null)).toBe('string');
    expect(avatarKey(null)).toBe(avatarKey({}));
  });
});

describe('sending it', () => {
  it('does nothing and throws nothing without the native module', async () => {
    await expect(link.syncAvatarToWatch('AAAA', 'k1')).resolves.toBe(false);
  });

  it('does nothing on a binary too old to carry a portrait', async () => {
    mockModule = { updateState: jest.fn() };
    await expect(link.syncAvatarToWatch('AAAA', 'k1')).resolves.toBe(false);
  });

  it('hands the bytes and the look to the native side', async () => {
    mockModule = { updateAvatar: jest.fn().mockResolvedValue(true) };
    await expect(link.syncAvatarToWatch('AAAA', 'k1')).resolves.toBe(true);
    expect(mockModule.updateAvatar).toHaveBeenCalledWith('AAAA', 'k1');
  });

  it('refuses an empty capture rather than clearing the wrist', async () => {
    mockModule = { updateAvatar: jest.fn().mockResolvedValue(true) };
    await expect(link.syncAvatarToWatch('', 'k1')).resolves.toBe(false);
    await expect(link.syncAvatarToWatch('AAAA', '')).resolves.toBe(false);
    expect(mockModule.updateAvatar).not.toHaveBeenCalled();
  });

  it('reports a refused transfer as not sent, so the next change tries again', async () => {
    mockModule = { updateAvatar: jest.fn().mockRejectedValue(new Error('no watch')) };
    await expect(link.syncAvatarToWatch('AAAA', 'k1')).resolves.toBe(false);
    mockModule.updateAvatar.mockResolvedValue(false);
    await expect(link.syncAvatarToWatch('AAAA', 'k1')).resolves.toBe(false);
  });
});

describe('the run state stays small', () => {
  // A picture in here would ride the ten second heartbeat for the length of
  // every run, and the live message it goes out on is size limited.
  it('carries no image data', () => {
    const state = buildWatchState({ avatarData: 'x'.repeat(100000) }, { seq: 1, nowMs: 1 });
    const values = Object.values(state).filter((v) => typeof v === 'string');
    expect(Math.max(...values.map((v) => v.length))).toBeLessThan(64);
    expect(state).not.toHaveProperty('avatarData');
  });
});
