import {
  MAX_ROUTE_STICKERS,
  expandReactionStickers,
  scatterReactionStickers,
} from '../src/components/feedReactionStickers';

describe('feed route reaction stickers', () => {
  test('turns aggregate counts into individual emoji', () => {
    const stickers = expandReactionStickers([
      { emote: 'love', count: 3 },
      { emote: 'wow', count: 2 },
    ]);
    expect(stickers).toHaveLength(5);
    expect(stickers.filter((row) => row.emote === 'love')).toHaveLength(3);
    expect(stickers.filter((row) => row.emote === 'wow')).toHaveLength(2);
    expect(new Set(stickers.map((row) => row.key)).size).toBe(5);
  });

  test('caps a busy card without replacing emoji with a number', () => {
    const stickers = expandReactionStickers([{ emote: 'love', count: 99 }]);
    expect(stickers).toHaveLength(MAX_ROUTE_STICKERS);
    expect(stickers.every((row) => row.emote === 'love')).toBe(true);
  });

  test('scatters deterministically and clear of a simple route', () => {
    const stickers = expandReactionStickers([
      { emote: 'love', count: 3 },
      { emote: 'wow', count: 3 },
    ]);
    const route = [[[150, 5], [150, 105]]];
    const first = scatterReactionStickers(stickers, route, 'run-42');
    const second = scatterReactionStickers(stickers, route, 'run-42');

    expect(second).toEqual(first);
    expect(new Set(first.map((row) => `${row.x}:${row.y}`)).size).toBe(first.length);
    // Clear candidates exist on both sides of this vertical route, so none of
    // the 28pt stickers should cover it.
    expect(first.every((row) => Math.abs(row.x - 150) >= 20)).toBe(true);
    expect(first.every((row) => row.x >= 14 && row.x <= 286)).toBe(true);
    expect(first.every((row) => row.y >= 14 && row.y <= 96)).toBe(true);
  });
});
