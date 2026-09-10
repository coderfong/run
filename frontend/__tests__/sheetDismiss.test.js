/**
 * Every sheet can be closed, and the paywall most of all.
 *
 * App Review rejected 2.1.0 (build 59) under guideline 4 — "no back/cancel
 * button when accessing subscriptions purchase page", found on an iPad Air.
 * The sheet was dismissible in three ways and none of them were VISIBLE: the
 * dim backdrop reads as page rather than as a control, the drag handle
 * advertised a gesture the sheet never implemented, and on a short window the
 * paywall was tall enough to run off the top of the screen entirely.
 *
 * So this guards the two things that fix is made of:
 *   1. Sheet draws a labelled Close control, and pressing it closes.
 *   2. The body lives in a scroll view under a capped height, so that control
 *      can never be pushed off the screen by a long sheet.
 *
 * Every sheet in the app — the PRO paywall included — is this component, so
 * this is the whole guarantee rather than one screen's version of it.
 */

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

// The store, the entitlement and the price fetch are not what is under test
// here; the paywall only has to render far enough to be looked at.
jest.mock('../src/iap', () => ({
  fetchProductPrices: jest.fn(async () => ({})),
  finishPurchase: jest.fn(async () => {}),
  restorePurchases: jest.fn(async () => []),
  storeSubscribe: jest.fn(async () => ({})),
}));
jest.mock('../src/pro/storeAvailable', () => ({ useStoreAvailable: () => true }));
jest.mock('../src/hooks/usePro', () => () => ({ pro: null }));

import BuyProSheet from '../src/components/BuyProSheet';
import Sheet from '../src/components/ui/Sheet';

const render = (element) => {
  let tree;
  act(() => { tree = renderer.create(element); });
  return tree;
};

/** Every rendered node carrying this accessibility label. */
const labelled = (tree, label) =>
  tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
    { deep: true }
  );

describe('Sheet dismissal', () => {
  it('draws a close control that is labelled for VoiceOver', () => {
    const tree = render(
      <Sheet visible onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>
    );
    expect(labelled(tree, 'Close').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('closes when the control is pressed', () => {
    const onClose = jest.fn();
    const tree = render(
      <Sheet visible onClose={onClose}>
        <Text>Body</Text>
      </Sheet>
    );
    // The last one is the button on the sheet itself; the first is the
    // backdrop behind it. Both close, which is the point — press the button.
    const controls = labelled(tree, 'Close');
    act(() => controls[controls.length - 1].props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('closes when the backdrop is pressed', () => {
    const onClose = jest.fn();
    const tree = render(
      <Sheet visible onClose={onClose}>
        <Text>Body</Text>
      </Sheet>
    );
    act(() => labelled(tree, 'Close')[0].props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('hands the hardware back and the escape key to onClose', () => {
    const onClose = jest.fn();
    const tree = render(
      <Sheet visible onClose={onClose}>
        <Text>Body</Text>
      </Sheet>
    );
    const asked = tree.root.findAll((node) => node.props?.onRequestClose === onClose, {
      deep: true,
    });
    expect(asked.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('caps its height and scrolls the body, so the control stays on screen', () => {
    const tree = render(
      <Sheet visible onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>
    );
    // A long body scrolls INSIDE the sheet rather than growing it off the top.
    const scroll = tree.root.findAllByType(
      require('react-native').ScrollView
    );
    expect(scroll.length).toBeGreaterThan(0);

    // The cap itself. Flattened because the surface is an animated view and
    // carries an array of styles.
    const { StyleSheet } = require('react-native');
    const capped = tree.root.findAll((node) => {
      const style = StyleSheet.flatten(node.props?.style);
      return !!style && typeof style.maxHeight === 'number' && style.maxHeight > 0;
    });
    expect(capped.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});

describe('the subscriptions page', () => {
  // The page guideline 4 was actually raised against, rendered for real rather
  // than reasoned about: whatever the paywall is built out of tomorrow, this
  // asks the only question App Review asked — can it be left.
  it('renders a close control', () => {
    const tree = render(<BuyProSheet visible onClose={() => {}} context="home" />);
    expect(labelled(tree, 'Close').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('closes when it is pressed', () => {
    const onClose = jest.fn();
    const tree = render(<BuyProSheet visible onClose={onClose} context="home" />);
    const controls = labelled(tree, 'Close');
    act(() => controls[controls.length - 1].props.onPress());
    expect(onClose).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
