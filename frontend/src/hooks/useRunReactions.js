// One run's emote reactions, owned in one place.
//
// The feed card and the run detail screen both show the same summary and both
// let you change it, so both need the same three things: an optimistic local
// update (the tile has to light up on the tap, not a round trip later), the
// server's authoritative counts once they arrive, and the OTHER screen's copy
// of this run kept in step. That last part is the one that goes wrong quietly:
// react on the detail screen, go back, and the feed row would still show the
// old chips until the next fetch, which reads as the tap not registering.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { updateCached } from '../api/cache';
import { isReaction } from '../effects/reactionRegistry';

// Rebuild the summary as if `next` had replaced `previous` for one person.
// Pure, so the optimistic path and the tests agree on what a tap should do.
export function applyReaction(reactions = [], previous, next) {
  const byEmote = new Map();
  for (const row of reactions) {
    byEmote.set(row.emote, { ...row, mine: false });
  }
  if (previous) {
    const row = byEmote.get(previous);
    if (row) {
      const count = row.count - 1;
      if (count > 0) byEmote.set(previous, { ...row, count });
      else byEmote.delete(previous);
    }
  }
  if (next) {
    const row = byEmote.get(next);
    byEmote.set(next, { emote: next, count: (row?.count || 0) + 1, mine: true });
  }
  // Loudest first, matching the server's ordering so the chips do not reshuffle
  // when the real answer lands.
  return [...byEmote.values()].sort((a, b) => b.count - a.count || a.emote.localeCompare(b.emote));
}

/**
 * `runId`   which run.
 * `initial` the summary the caller already has (a feed row carries one), so a
 *           card renders its chips without a fetch of its own.
 * `onSync`  called with the server's answer, for callers that hold the run in
 *           their own state (the detail screen holds the whole run object).
 */
export function useRunReactions(runId, initial, onSync) {
  const [reactions, setReactions] = useState(initial?.reactions || []);
  const [mine, setMine] = useState(initial?.my_reaction || null);
  // Rising each time a reaction is LEFT (not cleared, not swapped away from),
  // so the caller can fire the one-shot burst animation off it.
  const [burst, setBurst] = useState(0);
  const inFlight = useRef(false);
  const syncRef = useRef(onSync);
  syncRef.current = onSync;

  // `initial` is not always there on the first render. The run detail screen
  // seeds this from its own query, which is `undefined` until the fetch or the
  // cache answers — take the state once at mount and the chips on that screen
  // would stay empty forever. So the summary is ADOPTED whenever the caller's
  // copy actually changes.
  //
  // Compared by content, not by reference: a feed row is a fresh object every
  // render, and adopting on identity would stamp on the optimistic state a few
  // milliseconds after every tap. The in-flight guard is the second half of
  // that — while a change is on the wire, the caller's copy is by definition
  // the old one, and it must not be allowed to win.
  const signature = initial
    ? `${initial.my_reaction || ''}|${(initial.reactions || []).map((r) => `${r.emote}:${r.count}`).join(',')}`
    : null;
  const adopted = useRef(signature);
  useEffect(() => {
    if (signature === null || signature === adopted.current || inFlight.current) return;
    adopted.current = signature;
    setReactions(initial.reactions || []);
    setMine(initial.my_reaction || null);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const react = useCallback(async (emote) => {
    if (inFlight.current || !runId) return;
    if (!isReaction(emote)) return;
    // Tapping the one you already left is how you take it back off, which is
    // also what the server does with a repeat — the two have to agree or the
    // optimistic state flips back a moment later.
    const next = mine === emote ? null : emote;
    const previous = mine;
    const before = reactions;

    inFlight.current = true;
    setMine(next);
    setReactions((rows) => applyReaction(rows, previous, next));
    if (next) setBurst((token) => token + 1);

    try {
      const r = await api.setRunReaction(runId, next);
      setReactions(r.reactions || []);
      setMine(r.my_reaction || null);
      syncRef.current?.(r);
      // The feed holds its own copy of every run it has shown. Without this the
      // card you reacted to from the detail screen keeps the old chips.
      updateCached('feed', (feed) => ({
        ...feed,
        items: (feed.items || []).map((row) => (
          row.id === runId
            ? { ...row, reactions: r.reactions || [], my_reaction: r.my_reaction || null }
            : row
        )),
      }));
      updateCached(`run:${runId}`, (run) => (
        run ? { ...run, reactions: r.reactions || [], my_reaction: r.my_reaction || null } : run
      ));
    } catch {
      // Put it back exactly as it was. A reaction is not worth a toast — the
      // chip returning to where it started says it did not take.
      setMine(previous);
      setReactions(before);
    } finally {
      inFlight.current = false;
    }
  }, [mine, reactions, runId]);

  const total = useMemo(
    () => reactions.reduce((sum, row) => sum + (row.count || 0), 0),
    [reactions]
  );

  return { reactions, mine, total, burst, react };
}
