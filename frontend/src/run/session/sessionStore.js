// Durable storage for an open run session.
//
// WHY CHUNKS. The crash snapshot used to be the whole trail, re-serialised
// every 20 points: O(n²) writes over a run, and a single blob that grows past
// what AsyncStorage handles comfortably long before a 12 hour run ends. Here
// every kind of evidence is an append-only list stored as fixed-size chunks.
// A flush writes the small open tail and the meta record; a chunk, once full,
// is written once and never again. A 24 hour run at one fix a second is ~290
// chunks of 300 fixes, and no single write is larger than one of them.
//
// WHAT IS STORED: the run id, when it started, the runner's pause windows, the
// last confirmed movement, the step-counter epochs, and every fix, step
// sample and motion reading. Distance, moving time and state are NOT stored:
// they are re-derived from the evidence by the session engine, so a restored
// run can never disagree with one that never crashed.

import AsyncStorage from '@react-native-async-storage/async-storage';

const META_KEY = 'tr.session.meta';
// The pre-session crash snapshot ({ runId, startedAt, path }). Read once on
// upgrade so a run open across the update is not lost.
const LEGACY_KEY = 'tr.activeRun';
const KINDS = ['fixes', 'steps', 'motion'];
export const CHUNK_SIZE = 300;
const VERSION = 2;

const chunkKey = (kind, i) => `tr.session.${kind}.${i}`;
const tailKey = (kind) => `tr.session.${kind}.tail`;

export function createSessionStore() {
  // Items not yet sealed into a chunk, per kind, and how many chunks exist.
  let pending = { fixes: [], steps: [], motion: [] };
  let chunks = { fixes: 0, steps: 0, motion: 0 };
  let writing = Promise.resolve();

  function reset(counts = { fixes: 0, steps: 0, motion: 0 }, tails = { fixes: [], steps: [], motion: [] }) {
    chunks = { ...counts };
    pending = { fixes: [...tails.fixes], steps: [...tails.steps], motion: [...tails.motion] };
  }

  return {
    reset,

    append(kind, items) {
      if (items?.length) pending[kind].push(...items);
    },

    /**
     * Seal full chunks and write the tails and the meta. Serialised: a flush
     * never interleaves with another, so a chunk index is never reused.
     */
    flush(meta) {
      writing = writing.then(async () => {
        const pairs = [];
        for (const kind of KINDS) {
          while (pending[kind].length >= CHUNK_SIZE) {
            pairs.push([chunkKey(kind, chunks[kind]), JSON.stringify(pending[kind].slice(0, CHUNK_SIZE))]);
            chunks[kind] += 1;
            pending[kind] = pending[kind].slice(CHUNK_SIZE);
          }
          pairs.push([tailKey(kind), JSON.stringify(pending[kind])]);
        }
        pairs.push([META_KEY, JSON.stringify({ ...meta, version: VERSION, chunks, savedAt: Date.now() })]);
        try {
          await AsyncStorage.multiSet(pairs);
        } catch {
          // Storage full or unavailable: the run carries on in memory and the
          // next flush tries again with everything still pending.
        }
      });
      return writing;
    },

    async clear() {
      await writing.catch(() => {});
      let meta = null;
      try {
        meta = JSON.parse(await AsyncStorage.getItem(META_KEY));
      } catch {}
      const counts = meta?.chunks || chunks;
      const keys = [META_KEY, LEGACY_KEY];
      for (const kind of KINDS) {
        keys.push(tailKey(kind));
        for (let i = 0; i < (counts[kind] || 0) + 2; i += 1) keys.push(chunkKey(kind, i));
      }
      try {
        await AsyncStorage.multiRemove(keys);
      } catch {}
      reset();
    },
  };
}

/**
 * The open session on this device, or null. Returns { meta, evidence } where
 * evidence is { fixes, steps, motion } in time order.
 */
export async function loadSession() {
  let meta = null;
  try {
    meta = JSON.parse(await AsyncStorage.getItem(META_KEY));
  } catch {}
  if (!meta) return loadLegacy();
  const keys = [];
  for (const kind of KINDS) {
    for (let i = 0; i < (meta.chunks?.[kind] || 0); i += 1) keys.push(chunkKey(kind, i));
    keys.push(tailKey(kind));
  }
  const evidence = { fixes: [], steps: [], motion: [] };
  const tails = { fixes: [], steps: [], motion: [] };
  try {
    const rows = await AsyncStorage.multiGet(keys);
    for (const [key, raw] of rows) {
      const kind = KINDS.find((k) => key.startsWith(`tr.session.${k}.`));
      if (!kind || !raw) continue;
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) continue;
      evidence[kind].push(...items);
      if (key === tailKey(kind)) tails[kind] = items;
    }
  } catch {
    return null;
  }
  for (const kind of KINDS) evidence[kind].sort((a, b) => a.t - b.t);
  return { meta, evidence, tails };
}

// A run recorded by a build before sessions: its smoothed trail becomes the
// evidence, with no steps or motion. Enough to recover it honestly.
async function loadLegacy() {
  let saved = null;
  try {
    saved = JSON.parse(await AsyncStorage.getItem(LEGACY_KEY));
  } catch {}
  if (!saved?.runId || !Array.isArray(saved.path) || saved.path.length < 2) return null;
  const fixes = saved.path.map((p) => ({
    t: p.timestamp, lat: p.latitude, lon: p.longitude, acc: p.accuracyM ?? null, spd: p.speedMps ?? null,
  }));
  const last = fixes[fixes.length - 1]?.t ?? saved.startedAt;
  return {
    meta: {
      runId: saved.runId,
      startedAt: saved.startedAt || fixes[0].t,
      savedAt: last,
      lastActiveAt: last,
      userPauses: [],
      legacy: true,
    },
    evidence: { fixes, steps: [], motion: [] },
    tails: { fixes: [], steps: [], motion: [] },
  };
}
