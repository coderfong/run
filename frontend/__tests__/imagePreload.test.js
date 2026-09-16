jest.mock('../src/ui/image', () => ({
  Image: { prefetch: jest.fn(), resolveAssetSource: (source) => ({ uri: String(source) }) },
}));

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const uris = (mock) => mock.mock.calls.map(([uri]) => uri);

describe('image warming budget', () => {
  let Image;
  let preloadImage;
  let preloadImages;

  beforeEach(() => {
    jest.resetModules();
    ({ Image } = require('../src/ui/image'));
    ({ preloadImage, preloadImages } = require('../src/utils/imagePreload'));
  });

  it('shares three loader slots across overlapping groups and deduplicates queued images', async () => {
    const finishes = {};
    Image.prefetch.mockImplementation((uri) => new Promise((resolve) => { finishes[uri] = resolve; }));
    const first = preloadImages(['a', 'b', 'c', 'd']);
    const second = preloadImages(['d', 'e']);
    await settle();
    // Three at once: the native prefetcher's own ceiling.
    expect(uris(Image.prefetch)).toEqual(['a', 'b', 'c']);
    finishes.a(true);
    await settle();
    expect(uris(Image.prefetch)).toEqual(['a', 'b', 'c', 'd']);
    finishes.b(true);
    await settle();
    // `d` was asked for by both groups and is fetched once.
    expect(uris(Image.prefetch)).toEqual(['a', 'b', 'c', 'd', 'e']);
    finishes.c(true);
    finishes.d(true);
    finishes.e(true);
    await expect(first).resolves.toEqual([true, true, true, true]);
    await expect(second).resolves.toEqual([true, true]);
    await preloadImage('d');
    expect(Image.prefetch).toHaveBeenCalledTimes(5);
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

  // The disk cache is decoded on one serial queue, so bundled art warmed "into
  // disk" was lined up single file. It goes to memory, where its views read.
  it('warms bundled art into memory and keeps the disk cache for remote art', async () => {
    Image.prefetch.mockResolvedValue(true);
    await preloadImages([42, 'https://cdn.example/photo.jpg', 'file:///bundle/assets/art.png']);
    expect(Image.prefetch.mock.calls).toEqual([
      ['42', 'memory'],
      ['https://cdn.example/photo.jpg', 'memory-disk'],
      ['file:///bundle/assets/art.png', 'memory'],
    ]);
  });
});
