// The map-specific half of the claim sequence: fly there, project, reveal,
// hand off to the permanent Mapbox fill.
//
// Two ways in:
//
//   play()  — the whole map beat end to end. Self-contained, still used by
//             anything that just wants "claim → territory on screen".
//   focus() + startReveal() + showFinalTerritory() — the same steps as
//             primitives, so useClaimSequence can slot the capture encounter
//             between the camera landing and the reveal starting.
//
// Either way every failure path ends identically: the real territory layer
// visible. A missing native module, a projection that returns nothing, an
// unmount mid-flight — the runner still sees the land they took.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useReduceMotion, haptic } from '../../ui/motion';
import { sleep, timingFor } from './timing';
import { projectRings, ringsToLatLngs, territoryRings } from './geometry';

export default function useClaimReveal(mapRef) {
  const reduced = useReduceMotion();
  // Screen-space shape being revealed; null whenever the overlay is off.
  const [reveal, setReveal] = useState(null);
  // True for the duration of play(); the standalone entry point's own flag.
  const [active, setActive] = useState(false);
  // Whether the permanent Mapbox territory layer should be drawn yet.
  const [finalVisible, setFinalVisible] = useState(false);

  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const reset = useCallback(() => {
    setReveal(null);
    setFinalVisible(false);
    setActive(false);
  }, []);

  // Frame the claimed ground, wait for the camera to actually stop, then read
  // back where every vertex landed in pixels. Returns null on any miss — the
  // caller shows the permanent fill instead of an overlay that would be wrong.
  const focus = useCallback(
    async (territory, center) => {
      const T = timingFor(reduced);
      const rings = territoryRings(territory);
      const map = mapRef.current;
      if (!rings.length || !map) return null;

      try {
        map.fitToPoints(ringsToLatLngs(rings), 90, T.focus);
        await sleep(T.focus + T.settle);
        if (cancelled.current) return null;

        const [screenRings, claimPoint] = await Promise.all([
          projectRings(map, rings),
          map.projectCoordinate(center),
        ]);
        if (cancelled.current || !screenRings || !claimPoint) return null;
        return { rings: screenRings, claimPoint };
      } catch (e) {
        return null;
      }
    },
    [mapRef, reduced]
  );

  const startReveal = useCallback((projection) => {
    if (!projection) return;
    setReveal(projection);
    haptic.light();
  }, []);

  const showFinalTerritory = useCallback(() => setFinalVisible(true), []);
  const clearOverlay = useCallback(() => setReveal(null), []);

  // The whole map beat in one call, timed internally.
  const play = useCallback(
    async (territory, center) => {
      const T = timingFor(reduced);
      setActive(true);
      setFinalVisible(false);

      try {
        const projection = await focus(territory, center);
        if (cancelled.current) return;

        // No shape, no live map, or projection failed — skip to the result
        // rather than leaving the runner on a locked, empty map.
        if (!projection) {
          setFinalVisible(true);
          return;
        }

        startReveal(projection);
        await sleep(T.reveal);
        if (cancelled.current) return;

        // The map layer takes over while the overlay is still up, so the
        // polygon never blinks between the two renderers.
        setFinalVisible(true);
        await sleep(T.handoff);
        if (cancelled.current) return;
        setReveal(null);
      } catch (e) {
        setFinalVisible(true);
        setReveal(null);
      } finally {
        if (!cancelled.current) setActive(false);
      }
    },
    [focus, reduced, startReveal]
  );

  return {
    play,
    focus,
    startReveal,
    showFinalTerritory,
    clearOverlay,
    reset,
    reveal,
    active,
    finalVisible,
    reduced,
  };
}
