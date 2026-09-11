jest.mock('../src/ui/image', () => ({
  Image: { prefetch: jest.fn(), resolveAssetSource: (source) => ({ uri: String(source) }) },
}));

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

describe('image warming budget', () => {
  let Image;
  let preloadImage;
  let preloadImages;

  beforeEach(() => {
    jest.resetModules();
    ({ Image } = require('../src/ui/image'));
    ({ preloadImage, preloadImages } = require('../src/utils/imagePreload'));
  });

  it('shares two loader slots across overlapping groups and deduplicates queued images', async () => {
    const finishes = {};
    Image.prefetch.mockImplementation((uri) => new Promise((resolve) => { finishes[uri] = resolve; }));
    const first = preloadImages(['a', 'b', 'c']);
    const second = preloadImages(['c', 'd']);
    await settle();
    expect(Image.prefetch.mock.calls).toEqual([['a'], ['b']]);
    finishes.a(true);
    await settle();
    expect(Image.prefetch.mock.calls).toEqual([['a'], ['b'], ['c']]);
    finishes.b(true);
    await settle();
    finishes.c(true);
    finishes.d(true);
    await expect(first).resolves.toEqual([true, true, true]);
    await expect(second).resolves.toEqual([true, true]);
    await preloadImage('c');
    expect(Image.prefetch).toHaveBeenCalledTimes(4);
  });

  it('releases slots on synchronous and asynchronous failures and allows retries', async () => {
    Image.prefetch
      .mockImplementationOnce(() => { throw new Error('missing'); })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(true);
    await expect(preloadImages(['a', 'b', 'c'])).resolves.toEqual([false, false, true]);
    await expect(preloadImage('a')).resolves.toBe(true);
    expect(Image.prefetch).toHaveBeenCalledTimes(4);
  });
});
