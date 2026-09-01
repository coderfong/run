// Standings for the post-claim leaderboard beat.
//
// What this app actually has, checked against the backend rather than assumed:
//
//   * /leaderboard returns a flat, already-ordered list — rank IS the index.
//     That list is global, so it is the worldwide board.
//   * The claim response (ClaimOut) carries no rank data at all, so a rank
//     CHANGE cannot come from the claim.
//   * There is no country board on the backend. Not "not fetched" — it does
//     not exist. `countryRows` is therefore always null and the UI omits that
//     section rather than showing the global list mislabelled.
//
// The only honest source of a previous rank is the snapshot LeaderboardView
// writes when the runner last looked at the standings, so that is what this
// reads — the same AsyncStorage key, never written here (writing it would
// corrupt the delta the leaderboard screen itself shows).
//
// If no snapshot exists, previousRank/rankDelta come back null and the caller
// shows the current position with no "+N ranks" animation.
//
// The CURRENT rank is a second question, and the fetched page cannot always
// answer it: /leaderboard is a top fifty, so every runner below that was
// coming back with newRank null and no summary at all. `/leaderboard/standing`
// answers at any depth and is free for everybody (see the rule at the top of
// backend/app/routes/leaderboard.py), so it fills that in.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../../api/client';
import { RANKS_KEY } from '../LeaderboardView';

// The shape of the board this beat shows.
//
// It was five rows: the player and two either side. That is the right answer
// only while the player is ON the fetched page — and when they are not, the
// fallback was the top five with nothing above it, so the screen said nothing
// whatsoever about the runner who had just claimed. Hence three numbers rather
// than one: the podium is always worth seeing, the runner's own neighbourhood
// is the part they came for, and the two get stitched together with a marker
// for whatever was skipped between them.
const WINDOW = 3;
const TOP = 3;
// What to show when the player is nowhere on the page. Their position still
// arrives via `standing`, so this is the board itself rather than a fallback.
const OFF_BOARD_ROWS = 10;

// A break in the rank sequence. Rendered as a "N more runners" divider rather
// than letting #38 sit directly under #3 as though it followed it.
export const GAP_ID = '__gap__';

async function readPreviousRank(userId) {
  try {
    const raw = await AsyncStorage.getItem(`${RANKS_KEY}.land`);
    const snapshot = JSON.parse(raw) || {};
    const previous = snapshot[userId];
    return typeof previous === 'number' && previous > 0 ? previous : null;
  } catch (e) {
    return null;
  }
}

// Reassurance, never an obstacle: a standing that fails to load costs the
// screen its "#N of M" line and nothing else.
async function readStanding() {
  try {
    return await api.myStanding('land');
  } catch (e) {
    return null;
  }
}

/**
 * The rows to show, given the whole fetched page and where the player sits in
 * it (`playerIndex` < 0 when they are not on it).
 *
 * Pure and exported because it is easy to get subtly wrong in ways nothing
 * would report: an off-by-one here draws a gap marker over zero skipped rows,
 * or quietly drops the row immediately above the player.
 */
export function buildBoardRows(rows, playerIndex) {
  if (!rows.length) return [];
  if (playerIndex < 0) return rows.slice(0, OFF_BOARD_ROWS);

  const from = Math.max(0, playerIndex - WINDOW);
  const to = Math.min(rows.length, playerIndex + WINDOW + 1);

  // The player's window already reaches the podium: one continuous run, with
  // nothing skipped for a marker to describe.
  if (from <= TOP) return rows.slice(0, to);

  return [
    ...rows.slice(0, TOP),
    { user_id: GAP_ID, gap: from - TOP },
    ...rows.slice(from, to),
  ];
}

export async function loadClaimLeaderboard(userId) {
  const [rows, previousRank, standing] = await Promise.all([
    api.leaderboard(),
    readPreviousRank(userId),
    readStanding(),
  ]);

  const worldwideRows = (rows || []).map((row, index) => ({ ...row, rank: index + 1 }));
  const playerIndex = worldwideRows.findIndex((row) => row.user_id === userId);
  const playerRow = playerIndex >= 0 ? worldwideRows[playerIndex] : null;
  // The page first, because it is the same number the rows are showing. The
  // standing endpoint only has to answer for runners below the page.
  const newRank = playerRow ? playerRow.rank : (standing?.rank ?? null);

  // Only a real before AND a real after make a real delta.
  const rankDelta =
    previousRank != null && newRank != null ? previousRank - newRank : null;

  return {
    previousRank,
    newRank,
    // How many runners the rank is out of. Null when the standing call failed.
    fieldSize: standing?.field_size ?? null,
    // Positive = moved up. Null when there is nothing trustworthy to show.
    rankDelta: rankDelta || null,
    playerRow: playerRow ? { ...playerRow, delta: rankDelta || 0 } : null,
    // Land held in m², from whichever of the two sources knows it.
    playerArea: playerRow ? playerRow.total_area_m2 : (standing?.value ?? null),
    playerTerritories: playerRow ? playerRow.territory_count : null,
    // The podium, the player's neighbourhood, and a marker for the runners
    // skipped between them. See buildBoardRows.
    boardRows: buildBoardRows(worldwideRows, playerIndex),
    // No country board exists on this backend — see the note above.
    countryRows: null,
    worldwideRows,
  };
}
