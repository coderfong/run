// buildBoardRows — which standings rows the post-claim beat shows.
//
// Worth a test rather than a look: every failure mode here is silent. A gap
// marker over zero skipped runners still renders, the row directly above the
// player going missing still renders, and a board that quietly falls back to
// the top five (which is what this replaced) renders perfectly happily while
// telling the runner nothing about themselves.

import {
  appendOffBoardPlayer,
  buildBoardRows,
  GAP_ID,
} from '../src/components/claim/leaderboardData';

const board = (n) =>
  Array.from({ length: n }, (_, i) => ({ user_id: `u${i + 1}`, rank: i + 1 }));

const ranks = (rows) => rows.map((r) => (r.user_id === GAP_ID ? `gap:${r.gap}` : r.rank));

describe('buildBoardRows', () => {
  test('an empty page is an empty board, not a crash', () => {
    expect(buildBoardRows([], -1)).toEqual([]);
    expect(buildBoardRows([], 0)).toEqual([]);
  });

  test('a player off the page gets the top of the board', () => {
    expect(ranks(buildBoardRows(board(50), -1))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('a short page is not padded past its end', () => {
    expect(ranks(buildBoardRows(board(4), -1))).toEqual([1, 2, 3, 4]);
  });

  test('a player near the top gets one continuous run, with no gap marker', () => {
    // Rank 5 (index 4): the window reaches back to rank 2, which touches the
    // podium, so the board runs 1..8 unbroken.
    const rows = buildBoardRows(board(50), 4);
    expect(ranks(rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.some((r) => r.user_id === GAP_ID)).toBe(false);
  });

  test('the podium and the window are stitched with the number skipped', () => {
    // Rank 21 (index 20): podium 1..3, then ranks 4..17 skipped, then 18..24.
    expect(ranks(buildBoardRows(board(50), 20))).toEqual([
      1, 2, 3, 'gap:14', 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  test('the boundary case draws no zero-width gap', () => {
    // Rank 7 (index 6) windows back to rank 4 — the row straight after the
    // podium. Nothing is skipped, so nothing claims to have been.
    const rows = buildBoardRows(board(50), 6);
    expect(ranks(rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.some((r) => r.user_id === GAP_ID)).toBe(false);
  });

  test('the smallest real gap is one runner, and it says so', () => {
    // Rank 8 (index 7) windows back to rank 5, skipping rank 4 alone.
    const rows = buildBoardRows(board(50), 7);
    expect(ranks(rows)).toEqual([1, 2, 3, 'gap:1', 5, 6, 7, 8, 9, 10, 11]);
  });

  test('the window does not run off the end of the page', () => {
    // Last place on a 50-row page: three above, nothing below.
    expect(ranks(buildBoardRows(board(50), 49))).toEqual([
      1, 2, 3, 'gap:43', 47, 48, 49, 50,
    ]);
  });

  test('the player is always on the board it builds', () => {
    const rows = board(50);
    for (let i = 0; i < rows.length; i++) {
      const built = buildBoardRows(rows, i);
      expect(built.some((r) => r.user_id === `u${i + 1}`)).toBe(true);
    }
  });
});

// appendOffBoardPlayer — the runner who is BELOW the fetched page.
//
// This is what gives the standings beat somewhere to travel to. Its failures
// are silent in the same way buildBoardRows' are: a board that quietly ends at
// rank 50 still renders, a duplicate row for the same runner still renders, and
// a gap marker claiming zero skipped runners still renders.
describe('appendOffBoardPlayer', () => {
  const me = (rank) => ({ user_id: 'me', rank, username: 'me' });

  test('the runner is stitched on under a marker for everyone skipped', () => {
    expect(ranks(appendOffBoardPlayer(board(10), me(380)))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'gap:369', 380,
    ]);
  });

  test('the runner directly after the page needs no marker', () => {
    expect(ranks(appendOffBoardPlayer(board(10), me(11)))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  test('a rank already inside the page is not duplicated on the end', () => {
    // The page and /leaderboard/standing disagreeing is a real possibility
    // (they are two queries against a moving board). Showing the runner twice
    // is worse than showing them once, where the page already has them.
    expect(ranks(appendOffBoardPlayer(board(10), me(7)))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(ranks(appendOffBoardPlayer(board(10), me(10)))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test('nothing trustworthy to append leaves the board alone', () => {
    const rows = board(10);
    // A runner who has not scored on this board at all: `standing` answers
    // with a null rank, which is a real answer, not a missing one.
    expect(appendOffBoardPlayer(rows, { user_id: 'me', rank: null })).toBe(rows);
    expect(appendOffBoardPlayer(rows, null)).toBe(rows);
    expect(appendOffBoardPlayer([], me(380))).toEqual([]);
  });
});
