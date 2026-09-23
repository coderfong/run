// How a component says "the tutorial may point at me".
//
// Three shapes, because three different situations turn up in this app:
//
//   useTutorialTarget(id)     spread { ref, onLayout } onto a view that
//                             ALREADY exists. The first choice everywhere: it
//                             adds no view to the tree and cannot change a
//                             layout that is already right.
//   <TutorialTarget id>       wrap something. For the call sites where there
//                             is no existing view to hang the ref on.
//   <TutorialAnchor id>       an invisible, untouchable, absolutely positioned
//                             rectangle. For regions that are not a view at
//                             all: a patch of Mapbox, the ground under the
//                             runner's own dot. Nothing native can be measured
//                             there, so the screen declares the rectangle it
//                             means and the tutorial measures THAT.
//
// Registering costs nothing until a step actually asks where the target is.

import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useOnScreen } from '../ui/motion';
import { useTutorial } from './TutorialContext';

/**
 * Register an existing view as a tutorial target.
 *
 * @param {string} id  a value from targets.js
 * @returns {{ref: Function, onLayout: Function}} spread onto the view
 */
export function useTutorialTarget(id) {
  const { registerTarget } = useTutorial();
  const node = useRef(null);

  // A callback ref, memoised on two stable values, so React does not tear the
  // registration down and put it back on every render of a busy screen.
  const ref = useCallback(
    (instance) => {
      node.current = instance;
      registerTarget(id, instance);
    },
    [id, registerTarget]
  );

  // Re-measure when the view moves or resizes: a rotation, a keyboard, a
  // header that grew by a line.
  const onLayout = useCallback(() => {
    if (node.current) registerTarget(id, node.current);
  }, [id, registerTarget]);

  useEffect(
    () => () => {
      registerTarget(id, null);
    },
    [id, registerTarget]
  );

  return { ref, onLayout };
}

/**
 * Wrap a component so the tutorial can spotlight it.
 *
 * `style` is forwarded; by default the wrapper lays out exactly as its child
 * would, because it adds no flex and no size of its own.
 */
export function TutorialTarget({ id, style, children, ...rest }) {
  const target = useTutorialTarget(id);
  return (
    <View {...target} style={style} collapsable={false} {...rest}>
      {children}
    </View>
  );
}

/**
 * Declare a rectangle for the tutorial to light, without drawing anything.
 *
 * Takes no touches and paints nothing: it exists only to be measured. Position
 * it with `style` exactly as you would any absolute overlay.
 */
export function TutorialAnchor({ id, style }) {
  const target = useTutorialTarget(id);
  return (
    <View
      {...target}
      pointerEvents="none"
      // Without this, a view with no children and no background is a candidate
      // for view flattening on Android and there is nothing left to measure.
      collapsable={false}
      style={[styles.anchor, style]}
    />
  );
}

/**
 * Ask for a contextual tip the first time this screen is actually LOOKED AT.
 *
 * Focus, not mount: all four tabs are mounted from launch (App.js preloads
 * them), so a mount-triggered tip would fire for Club and the boards while the
 * runner is still reading Home, and be marked seen by somebody who never saw
 * it.
 *
 * The provider does the rest of the deciding — never during the core tutorial,
 * never twice, one at a time.
 *
 * @param {string} key      a value from progress.js TIP
 * @param {boolean} [ready] extra condition: don't teach a screen that has not
 *                          loaded the thing being described yet
 */
export function useTutorialTip(key, ready = true) {
  const { requestTip } = useTutorial();
  const onScreen = useOnScreen();

  useEffect(() => {
    if (!onScreen || !ready || !key) return;
    requestTip(key);
  }, [onScreen, ready, key, requestTip]);
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', backgroundColor: 'transparent' },
});

export default TutorialTarget;
