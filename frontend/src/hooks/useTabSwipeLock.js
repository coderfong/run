// Holds the tab pager still while a finger is on a sideways scroller.
//
// The main tabs are a swipeable pager (App.js: material top tabs over a native
// pager). A horizontal ScrollView on a tab page fights it for the same gesture,
// and on You the pager won: the rank rail opens scrolled to your own tier, so
// near the top of the ladder the only way it can move is a drag to the right —
// which is exactly the swipe back to Club.
//
// So while the finger is down, the tab this screen lives in turns its swipe
// off, and turns it back on when the finger lifts. Letting go of the lock the
// moment the scroller takes the gesture (its touch is cancelled then) is fine:
// a recogniser that was off when the touch began does not pick it up later.

import { useCallback, useEffect, useRef } from 'react';

/**
 * @param navigation the screen's own navigation prop. The screen sits in its
 *                   tab's stack, so the TAB is the parent navigator.
 * @returns lock(on: boolean)
 */
export function useTabSwipeLock(navigation) {
  const locked = useRef(false);

  const lock = useCallback((on) => {
    // A drag ends in a touch end AND a scroll end; set the option once.
    if (locked.current === on) return;
    locked.current = on;
    navigation?.getParent?.()?.setOptions?.({ swipeEnabled: !on });
  }, [navigation]);

  // Never leave a tab unswipeable behind a screen that has gone.
  useEffect(() => () => lock(false), [lock]);

  return lock;
}

export default useTabSwipeLock;
