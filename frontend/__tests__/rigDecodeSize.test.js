/**
 * Which character layers ask for a crisp (never downscaled) draw.
 *
 * The rule: crisp only where the rig's own scale can move — `animateSwaps`
 * (the studio's part-landing spring) or a `ref` (the only route to the
 * imperative `play()` nod) — and never on a still portrait or a catalogue tile.
 *
 * What the prop BUYS changed on 2026-09-15. It maps to expo-image's
 * `allowDownscaling`, and this file used to say that downscaling the busts
 * saved hundreds of megabytes of bitmap. It did not: SDWebImage decodes the
 * whole image and caches it either way, and downscaling only added a redraw at
 * view size, on the main thread, for every layer of every bust. ui/image.js now
 * draws all bundled art — which is all character art — from its full decode,
 * so for these layers the prop is inert. It is still pinned because it is still
 * the contract for a remote source.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CharacterRig, { CharacterBust, PartThumb } from '../src/components/character/CharacterRig';
import { getItem } from '../src/config/cosmetics';
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

  it('recombines wrap-around item layers in prize and catalogue thumbnails', () => {
    const cape = getItem('accessory', 'cape');
    const tree = render(<PartThumb slot="accessory" item={cape} size={56} />);
    expect(layers(tree)).toHaveLength(2);
    act(() => tree.unmount());
  });

  it('keeps hairstyle details visible beneath enclosing headwear', () => {
    const bald = render(<CharacterRig equipped={{ hair: 'none', headwear: 'beanie' }} size={110} />);
    const styled = render(<CharacterRig equipped={{ hair: 'highpony', headwear: 'beanie' }} size={110} />);
    expect(layers(styled)).toHaveLength(layers(bald).length + 1);
    act(() => bald.unmount());
    act(() => styled.unmount());
  });
});
