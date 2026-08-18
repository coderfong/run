// Run something only while PASER is the app on screen.
//
// THE BUG THIS EXISTS FOR: sharing to an Instagram story ended with a black
// screen that never went away.
//
// The handoff to Instagram is a `UIApplication.openURL`, and the promise
// react-native-share hands back resolves the moment iOS accepts that URL —
// which is BEFORE the app has finished leaving the foreground, not after the
// runner comes back. The share sheet took that resolution as "posted" and
// immediately called its `onClose`, which on the result screen dismisses the
// whole Record stack — and that stack is presented as `fullScreenModal`, so
// the dismissal is a real UIViewController transition with an animation.
//
// Starting that transition while the app is on its way to the background is
// the whole problem. iOS stops servicing the animation as soon as the app
// resigns active, the controller is left half dismissed, and the window it
// was covering is never restored: a black screen, and no touch reaches
// anything because the modal technically still owns the presentation.
//
// So: do not navigate during the handoff. Wait for the app to actually be
// back on screen and do it then. The runner sees the share sheet for the
// instant it takes them to return, and then it closes — which is also the
// honest thing to show, because until they come back nothing has happened.
//
// This is not specific to Instagram. Anything that leaves the app and wants to
// change what is on screen afterwards has the same shape, which is why it is a
// helper rather than four lines inside the share sheet.

import { AppState } from 'react-native';

/**
 * Run `fn` once the app is foreground-active.
 *
 * Immediate when it already is, so an ordinary in-app call pays nothing for
 * this. For work that follows a handoff to ANOTHER app, use `afterHandoff` —
 * see the note there about why "currently active" is the wrong question.
 *
 * Returns a cancel function. CALL IT on unmount: the runner may never come
 * back to the screen that armed this, and a callback that fires into an
 * unmounted tree is the same class of bug in the other direction.
 */
export function whenActive(fn) {
  if (AppState.currentState === 'active') {
    fn();
    return () => {};
  }
  return onNextActive(fn);
}

/**
 * Run `fn` after the app has been away and come back.
 *
 * `whenActive` is not enough for a handoff, and the difference is the whole
 * reason this second function exists. `openURL` resolves while iOS is still
 * deciding to switch apps: at that instant `AppState.currentState` is very
 * often STILL 'active', because the app has not resigned yet. A helper that
 * asks "are we active?" therefore answers yes and fires immediately — which
 * is exactly the mistimed navigation we were trying to avoid.
 *
 * So this waits for the trip itself: it arms on the first state that is not
 * 'active' (the app really did leave) and fires on the next 'active' after
 * that (the runner really did come back).
 *
 * `graceMs` covers the case where the switch never happens at all — the other
 * app declined, the URL went nowhere, the device is a simulator with no
 * Instagram on it. Nothing left the foreground, so nothing is at risk, and
 * `fn` runs as it would have before. Long enough that a slow app switch is
 * not mistaken for one that never started.
 *
 * Returns a cancel function, same contract as `whenActive`.
 */
export function afterHandoff(fn, { graceMs = 2500 } = {}) {
  let left = AppState.currentState !== 'active';
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    sub.remove();
    // One frame past 'active'. The state change fires as the app becomes
    // active, and a native presentation started inside that same callback
    // races the OS restoring the window it is about to touch — which is a
    // quieter version of the bug this file is here to fix.
    requestAnimationFrame(fn);
  };

  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      left = true;
      // The app went away, so the grace fallback has done its job and must
      // not fire from the background — which would be the original bug with
      // extra steps.
      clearTimeout(timer);
      return;
    }
    if (left) finish();
  });

  const timer = setTimeout(() => {
    if (!left) finish();
  }, graceMs);

  return () => {
    done = true;
    clearTimeout(timer);
    sub.remove();
  };
}

// The plain "next time we are active" subscription, shared by both helpers.
function onNextActive(fn) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sub.remove();
    requestAnimationFrame(fn);
  };
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') finish();
  });
  return () => {
    done = true;
    sub.remove();
  };
}
