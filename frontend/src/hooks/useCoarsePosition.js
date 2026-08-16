// useCoarsePosition — roughly where the runner is, for features that want to
// show something nearby.
//
// IT NEVER ASKS. It reads the permission the app already has and gives up
// quietly if there isn't one. Prompting here would put a location dialog in
// front of somebody who tapped a leaderboard chip, which is both the wrong
// moment to explain why PASER wants location and the kind of unexplained
// prompt App Review has already rejected this app over once (5.1.1(iv)).
// The real ask lives in onboarding, attached to the thing that needs it.
//
// `enabled` gates the whole effect, so a screen that merely renders a "near
// me" option costs nothing until somebody chooses it.

import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export default function useCoarsePosition(enabled = true) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!enabled || pos) return undefined;
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return; // no permission, no prompt, no position
        // Last known first: it is instant and this is a filter, not a
        // navigation fix. A stale-by-minutes position picks the same city.
        const loc =
          (await Location.getLastKnownPositionAsync()) ||
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        if (alive && loc?.coords) {
          setPos({ lat: loc.coords.latitude, lon: loc.coords.longitude });
        }
      } catch {
        // Location services off, hardware busy, timeout. The caller renders
        // its own "needs location" state; there is nothing to report here.
      }
    })();
    return () => { alive = false; };
  }, [enabled, pos]);

  return pos;
}
