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
import { getCached } from '../../api/cache';
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

/**
 * Put a runner who is BELOW the fetched page onto the board anyway.
 *
 * /leaderboard is a top fifty. Everybody outside it used to get the top ten
 * and nothing else — a standings screen with the runner's own name nowhere on
 * it, which is both the wrong answer and the reason there was nothing for the
 * board to travel to. `/leaderboard/standing` knows their place at any depth
 * (it is free for exactly this reason), so the row is built from that and
 * stitched on under a gap marker.
 *
 * Pure, and separate from `buildBoardRows`, because the two answer different
 * questions: that one windows a page it can see, this one appends a row that
 * is not on the page at all.
 *
 * Returns `rows` untouched when there is nothing trustworthy to append — no
 * standing, no rank, or a rank that claims to be inside the slice we already
 * have (which would mean the page and the standing disagree, and inventing a
 * duplicate row is worse than showing neither).
 */
export function appendOffBoardPlayer(rows, playerRow) {
  if (!playerRow || !playerRow.rank || !rows.length) return rows;
  const last = rows[rows.length - 1];
  if (!last || !last.rank || playerRow.rank <= last.rank) return rows;

  const skipped = playerRow.rank - last.rank - 1;
  return [
    ...rows,
    ...(skipped > 0 ? [{ user_id: GAP_ID, gap: skipped }] : []),
    playerRow,
  ];
}

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
  const pagedRow = playerIndex >= 0 ? worldwideRows[playerIndex] : null;
  // The page first, because it is the same number the rows are showing. The
  // standing endpoint only has to answer for runners below the page.
  const newRank = pagedRow ? pagedRow.rank : (standing?.rank ?? null);

  // Only a real before AND a real after make a real delta.
  const rankDelta =
    previousRank != null && newRank != null ? previousRank - newRank : null;

  // The runner's row, whether or not the page had it. Off the page it is built
  // from `standing` plus the cached club membership — the same two fields
  // LeaderboardRow needs to draw the tag and the colour dot, read from the
  // cache the ClanProvider already keeps rather than costing this beat a
  // fourth request. `territory_count` is deliberately absent rather than
  // guessed at zero; the row omits the clause when it does not know (see
  // LeaderboardRow).
  const myClan = pagedRow ? null : getCached('me:clan');
  const playerRow = pagedRow
    ? { ...pagedRow, delta: rankDelta || 0 }
    : (newRank != null && standing
        ? {
            user_id: userId,
            username: standing.username,
            rank: newRank,
            total_area_m2: standing.value ?? 0,
            territory_count: null,
            clan_tag: myClan?.clan_id ? myClan.tag : null,
            clan_color: myClan?.clan_id ? myClan.color : null,
            delta: rankDelta || 0,
          }
        : null);

  return {
    previousRank,
    newRank,
    // How many runners the rank is out of. Null when the standing call failed.
    fieldSize: standing?.field_size ?? null,
    // Positive = moved up. Null when there is nothing trustworthy to show.
    rankDelta: rankDelta || null,
    playerRow,
    // Land held in m², from whichever of the two sources knows it.
    playerArea: pagedRow ? pagedRow.total_area_m2 : (standing?.value ?? null),
    playerTerritories: pagedRow ? pagedRow.territory_count : null,
    // Travel through every fetched standing rather than jumping from the
    // podium to the neighbourhood. Only unavailable ranks need a gap.
    travelRows: pagedRow
      ? worldwideRows.slice(0, playerIndex + WINDOW + 1).map(row =>
          row.user_id === userId ? playerRow : row)
      : appendOffBoardPlayer(worldwideRows, playerRow),
    // The podium, the player's neighbourhood, and a marker for the runners
    // skipped between them (buildBoardRows) — then the runner themselves,
    // stitched on the end when they were below the page (appendOffBoardPlayer).
    // The board ALWAYS ends at the player's row, which is what the transition's
    // travel animation scrolls to.
    boardRows: pagedRow
      ? buildBoardRows(worldwideRows, playerIndex)
      : appendOffBoardPlayer(buildBoardRows(worldwideRows, playerIndex), playerRow),
    // No country board exists on this backend — see the note above.
    countryRows: null,
    worldwideRows,
  };
}
