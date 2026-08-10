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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../../api/client';
import { RANKS_KEY } from '../LeaderboardView';

// How many rows either side of the player the compact board shows.
const WINDOW = 2;

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

export async function loadClaimLeaderboard(userId) {
  const [rows, previousRank] = await Promise.all([
    api.leaderboard(),
    readPreviousRank(userId),
  ]);

  const worldwideRows = (rows || []).map((row, index) => ({ ...row, rank: index + 1 }));
  const playerIndex = worldwideRows.findIndex((row) => row.user_id === userId);
  const playerRow = playerIndex >= 0 ? worldwideRows[playerIndex] : null;
  const newRank = playerRow ? playerRow.rank : null;

  // Only a real before AND a real after make a real delta.
  const rankDelta =
    previousRank != null && newRank != null ? previousRank - newRank : null;

  // The rows the runner cares about: themselves, and who they're chasing.
  const nearbyRows =
    playerIndex >= 0
      ? worldwideRows.slice(
          Math.max(0, playerIndex - WINDOW),
          Math.min(worldwideRows.length, playerIndex + WINDOW + 1)
        )
      : worldwideRows.slice(0, WINDOW * 2 + 1);

  return {
    previousRank,
    newRank,
    // Positive = moved up. Null when there is nothing trustworthy to show.
    rankDelta: rankDelta || null,
    playerRow: playerRow ? { ...playerRow, delta: rankDelta || 0 } : null,
    nearbyRows,
    // No country board exists on this backend — see the note above.
    countryRows: null,
    worldwideRows,
  };
}
