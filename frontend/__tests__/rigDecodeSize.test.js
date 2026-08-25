/**
 * What size the character art is DECODED at.
 *
 * The rig is drawn two very different ways, and the difference costs real
 * memory. In the studio it is one large runner that springs on a tap and on a
 * part landing, so every layer has to be decoded at full resolution or the
 * scale-up magnifies a bitmap that was never that big (see ui/image.js —
 * `crisp` is what turns expo-image's `allowDownscaling` off). Everywhere else
 * it is a 26-44pt PORTRAIT that never moves: on every feed card, over every
 * territory on the map, beside every leaderboard row.
 *
 * Those portraits used to take the studio's treatment too. The character art
 * is ~512px square, so a single layer is about a megabyte of decoded bitmap
 * and a dressed runner is eight of them — paid per bust, for a thumbnail. A
 * screenful of runners was hundreds of megabytes of bitmap, which is most of
 * why building one was slow and holding several on screen was worse.
 *
 * The rule is now "decode crisply only when the rig's own scale can move",
 * and it is decidable from the props: `animateSwaps`, or a `ref` (the only
 * route to the imperative `play()` nod). This pins both halves of it, because
 * a regression in either direction is invisible — one costs memory silently,
 * the other blurs the runner only while they are mid-spring.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CharacterRig, { CharacterBust, PartThumb } from '../src/components/character/CharacterRig';
import { Image } from '../src/ui/image';

// Every layer the rig drew, as the props handed to our expo-image wrapper.
const layers = (tree) => tree.root.findAllByType(Image);

// `crisp` is opt-in, so anything that is not exactly true decodes to the size
// the view draws at.
const crispCount = (tree) => layers(tree).filter((n) => n.props.crisp === true).length;

const render = (element) => {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
};

// A dressed runner, so the layers under test actually exist. Item ids that do
// not resolve simply draw nothing, and a rig with no layers would pass every
// assertion below without testing anything — hence the count check first.
const EQUIPPED = {};

describe('character art decode size', () => {
  it('draws a bust without a single full-resolution decode', () => {
    const tree = render(<CharacterBust equipped={EQUIPPED} size={38} />);
    expect(layers(tree).length).toBeGreaterThan(0);
    expect(crispCount(tree)).toBe(0);
    act(() => tree.unmount());
  });

  it('keeps the full decode where the rig springs on a part landing', () => {
    // The studio and the onboarding character step: `animateSwaps` is the
    // whole-runner spring that fires when changed art finishes loading.
    const tree = render(<CharacterRig equipped={EQUIPPED} size={140} animate animateSwaps />);
    expect(crispCount(tree)).toBe(layers(tree).length);
    act(() => tree.unmount());
  });

  it('keeps the full decode where a caller can play the nod', () => {
    // A ref is the only way to reach `play('thumbs')`, which springs to 1.07.
    // A rig nobody holds a handle to cannot be asked to.
    const ref = React.createRef();
    const withRef = render(<CharacterRig ref={ref} equipped={EQUIPPED} size={110} animate />);
    expect(crispCount(withRef)).toBe(layers(withRef).length);
    act(() => withRef.unmount());

    const withoutRef = render(<CharacterRig equipped={EQUIPPED} size={110} animate />);
    expect(crispCount(withoutRef)).toBe(0);
    act(() => withoutRef.unmount());
  });

  it('lets a caller ask for the full decode when it is the PARENT that scales', () => {
    // The run screen's live marker sits inside a Pulse. The rig cannot see an
    // animation above it, so that one says so by hand.
    const tree = render(<CharacterBust equipped={EQUIPPED} size={40} crisp />);
    expect(crispCount(tree)).toBe(layers(tree).length);
    act(() => tree.unmount());
  });

  it('draws customizer tiles at tile size', () => {
    // The grid is a wall of these and nothing ever magnifies one —
    // PressableScale only goes down (scaleTo 0.97).
    const tree = render(<PartThumb slot="hair" item={{ id: 'h1' }} size={56} />);
    expect(crispCount(tree)).toBe(0);
    act(() => tree.unmount());
  });
});
