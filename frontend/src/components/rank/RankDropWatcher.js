// RankDropWatcher — tells a runner, once, that they dropped a tier while away.
//
// Promotions happen on a claim and the claim result celebrates them. Drops
// mostly happen with the app closed (somebody takes your land, the ladder
// decays), so nothing is on screen when they land. This compares the tier
// last shown on this device (rank/rankSeen) with the tier /me/stats reports
// now, every time the app comes back to the foreground, and plays the
// demotion screen when it fell.
//
// It never interrupts a run: on the live run and on its result screen (which
// reports its own tier change) the check simply waits for the next return.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { standingFrom } from '../../config/rankLadder';
import { onRankCheck, rankChange, readSeenRank, writeSeenRank } from '../../rank/rankSeen';
import { useAvatar } from '../../state/avatar';
import RankDownCeremony from './RankDownCeremony';

const QUIET_ROUTES = new Set(['Record', 'Result']);

export default function RankDropWatcher({ navigationRef, ready }) {
  const { user } = useAuth();
  const { equipped } = useAvatar();
  const userId = user?.id;
  const [drop, setDrop] = useState(null);
  // Refs rather than state for the guards, so opening and closing the
  // ceremony does not hand `check` a new identity and re-fire the effects.
  const busy = useRef(false);
  const open = useRef(false);

  const check = useCallback(async () => {
    if (!ready || !userId || busy.current || open.current) return;
    const route = navigationRef?.isReady?.() ? navigationRef.getCurrentRoute?.()?.name : null;
    if (route && QUIET_ROUTES.has(route)) return;
    busy.current = true;
    try {
      const [stats, seen] = await Promise.all([api.meStats(), readSeenRank(userId)]);
      const current = stats?.rank_key;
      const change = rankChange(seen, current);
      if (change === 'down') {
        open.current = true;
        setDrop({ from: standingFrom({ key: seen }), to: standingFrom(stats), key: current });
      } else if (change === 'init' || change === 'up') {
        await writeSeenRank(userId, current);
      }
    } catch (e) {
      // Offline, or a cold server: nothing is recorded, so the next return to
      // the app asks again.
    } finally {
      busy.current = false;
    }
  }, [ready, userId, navigationRef]);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  useEffect(() => onRankCheck(check), [check]);

  // Recorded on DISMISS, not on show: an app killed mid-ceremony tells you
  // again next time rather than never.
  const close = useCallback(() => {
    const shown = drop;
    open.current = false;
    setDrop(null);
    if (shown) writeSeenRank(userId, shown.key);
  }, [drop, userId]);

  return (
    <RankDownCeremony
      visible={!!drop}
      from={drop?.from}
      to={drop?.to}
      equipped={equipped}
      onDone={close}
    />
  );
}
