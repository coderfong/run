/**
 * A device with no saved runner is NOT an account that never made one.
 *
 * A reinstall, a new phone or a cleared app used to send a veteran back
 * through the character intro. The server's copy decides now, and an answer it
 * cannot give reads as "do not know" (show nothing), never as "has none".
 */

jest.mock('../src/api/client', () => ({ api: { me: jest.fn() } }));

import { serverAvatar } from '../src/state/avatar';

describe('serverAvatar', () => {
  it('uses the avatar the signed-in user already carries', async () => {
    const fetchMe = jest.fn();
    await expect(serverAvatar({ id: 'u1', avatar: { hair: 'hs2' } }, fetchMe)).resolves.toEqual({
      known: true,
      avatar: { hair: 'hs2' },
    });
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('knows an account that genuinely has none', async () => {
    await expect(serverAvatar({ id: 'u1', avatar: null })).resolves.toEqual({ known: true, avatar: null });
  });

  it('asks /me when the cached user predates the field', async () => {
    const fetchMe = jest.fn(() => Promise.resolve({ id: 'u1', avatar: { top: 't3' } }));
    await expect(serverAvatar({ id: 'u1' }, fetchMe)).resolves.toEqual({ known: true, avatar: { top: 't3' } });
  });

  it('reads a failed or old server as UNKNOWN, never as "has none"', async () => {
    await expect(serverAvatar({ id: 'u1' }, () => Promise.reject(new Error('offline')))).resolves.toEqual({
      known: false,
      avatar: null,
    });
    await expect(serverAvatar({ id: 'u1' }, () => Promise.resolve({ id: 'u1' }))).resolves.toEqual({
      known: false,
      avatar: null,
    });
  });
});
