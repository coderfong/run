// The last rank tier this device SHOWED its runner.
//
// A promotion happens on a claim, so the claim result can celebrate it. A
// demotion mostly does not: rank points drain away while the app is closed,
// when somebody takes your land or the ladder decays. So the only way to tell
// a runner they dropped is to remember what they last saw and compare it with
// what they hold now, on the way back into the app (RankDropWatcher).
//
// Per account and per device, in AsyncStorage. The comparison is between two
// tier KEYS the server sent, never between thresholds, so the ladder still has
// exactly one owner.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { tierByKey } from '../config/rankLadder';

const storageKey = (userId) => `rank:seen:v1:${userId}`;

export async function readSeenRank(userId) {
  if (!userId) return null;
  try {
    return await AsyncStorage.getItem(storageKey(userId));
  } catch (e) {
    return null;
  }
}

export async function writeSeenRank(userId, rankKey) {
  if (!userId || !rankKey) return;
  try {
    await AsyncStorage.setItem(storageKey(userId), rankKey);
  } catch (e) {
    // A missed write only means the next comparison starts from an older
    // tier; it can never invent a demotion that the server did not report.
  }
}

/**
 * What the move from the tier last shown to the tier held now calls for.
 *
 *   'init'  nothing recorded yet. Record it and show nothing: a fresh install
 *           must not greet a runner with a drop they took weeks ago.
 *   'down'  the tier fell. The demotion screen.
 *   'up'    the tier rose. Record it quietly; promotions are celebrated where
 *           they happen, on the claim result.
 *   'same'  nothing to do.
 */
export function rankChange(seenKey, currentKey) {
  if (!currentKey) return 'same';
  if (!seenKey) return 'init';
  const seen = tierByKey(seenKey).tier;
  const now = tierByKey(currentKey).tier;
  if (now < seen) return 'down';
  if (now > seen) return 'up';
  return 'same';
}

// A nudge to compare NOW rather than at the next return to the app. The dev
// panel uses it to run the real demotion path end to end from a desk.
const listeners = new Set();

export function onRankCheck(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestRankCheck() {
  listeners.forEach((fn) => fn());
}
