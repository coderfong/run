/**
 * The rank frame is a PLAYER STATUS FRAME: it goes round the runner's face,
 * centred on it, at every size and for every tier — and nowhere else.
 *
 * The bug this guards: the frame used to be laid out on its ART's canvas and
 * the portrait pushed to wherever the opening happened to be, so the face sat
 * above or below the middle of its own box (Mythic's flame and Prismatic's
 * crystals push the ring down, Gold's medal pushes it up), and anything lined
 * up against the box was off-centre from the face.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import PortraitBorder, { FRAME_BOX, FRAME_MAX, frameGeometry } from '../src/components/PortraitBorder';
import RankedAvatar, { rankedAvatarBox, rankedAvatarSizeFor } from '../src/components/identity/RankedAvatar';
import RankCrest from '../src/components/identity/RankCrest';
import { CharacterBust } from '../src/components/character/CharacterRig';
import { BORDER_ART } from '../src/config/borderArt';
import { standingFrom } from '../src/config/rankLadder';
import { plotStatus } from '../src/territory/landStatus';

const TIERS = Object.keys(BORDER_ART);
const SIZES = [24, 40, 46, 64, 104];

const render = (element) => {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
};

describe('frameGeometry', () => {
  it.each(TIERS.flatMap((t) => SIZES.map((s) => [t, s])))('%s at %ipt shares one centre', (tier, size) => {
    const g = frameGeometry(tier, size);
    const art = BORDER_ART[tier];
    // The box is the same for every tier at a size.
    expect(g.box).toBeCloseTo(size * FRAME_BOX, 6);
    // The ring's OPENING centre lands on the box's centre.
    expect(g.ringLeft + art.cx * g.ring).toBeCloseTo(g.box / 2, 6);
    expect(g.ringTop + art.cy * g.ring).toBeCloseTo(g.box / 2, 6);
    // The portrait fills the opening exactly: ring = portrait / hole.
    expect(g.portrait / g.ring).toBeCloseTo(art.hole, 6);
    // And the ring never grows past the cap.
    expect(g.ring).toBeLessThanOrEqual(size * FRAME_MAX + 1e-6);
  });

  it('scales proportionally: nothing in it is a fixed offset', () => {
    for (const tier of TIERS) {
      const a = frameGeometry(tier, 40);
      const b = frameGeometry(tier, 80);
      for (const k of ['box', 'portrait', 'ring', 'ringLeft', 'ringTop']) {
        expect(b[k]).toBeCloseTo(a[k] * 2, 6);
      }
    }
  });

  it('round-trips a footprint to a portrait size', () => {
    expect(rankedAvatarBox(rankedAvatarSizeFor(30))).toBeCloseTo(30, 6);
  });
});

describe('PortraitBorder layout', () => {
  it.each(TIERS)('%s: portrait and ring both centred in the same square', (tier) => {
    const size = 46;
    const tree = render(
      <PortraitBorder borderKey={tier} size={size}>
        <Text>face</Text>
      </PortraitBorder>
    );
    const root = tree.root.findAll((n) => n.type === 'View')[0];
    const box = StyleSheet.flatten(root.props.style);
    expect(box.width).toBeCloseTo(size * FRAME_BOX, 6);
    expect(box.height).toBeCloseTo(size * FRAME_BOX, 6);

    // The portrait slot: a `size` square centred on the box.
    const slot = root.findAll(
      (n) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.position === 'absolute'
        && StyleSheet.flatten(n.props.style)?.width === size
    )[0];
    const s = StyleSheet.flatten(slot.props.style);
    expect(s.left + size / 2).toBeCloseTo(box.width / 2, 6);
    expect(s.top + size / 2).toBeCloseTo(box.height / 2, 6);
    act(() => tree.unmount());
  });
});

describe('RankedAvatar', () => {
  it('is the bust inside the frame', () => {
    const tree = render(<RankedAvatar equipped={{}} rankKey="mythic" size={40} />);
    expect(tree.root.findAllByType(PortraitBorder)).toHaveLength(1);
    const busts = tree.root.findAll((n) => n.type === CharacterBust || n.type === CharacterBust.type);
    expect(busts.length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('keeps the same box for a runner with no avatar yet', () => {
    const tree = render(<RankedAvatar equipped={null} initials="jo" rankKey="wood" size={40} />);
    const texts = tree.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain('JO');
    act(() => tree.unmount());
  });

  it('falls back to the bottom frame for an unknown tier', () => {
    const tree = render(<RankedAvatar equipped={{}} rankKey={null} size={40} />);
    expect(tree.root.findByType(PortraitBorder).props.borderKey).toBe('wood');
    act(() => tree.unmount());
  });
});

describe('RankCrest', () => {
  // The frame goes round a FACE. A crest is the numeral on its own badge.
  it('never wraps the numeral in a portrait frame', () => {
    const standing = standingFrom({ key: 'mythic', points: 2481, floor: 2400 });
    const tree = render(<RankCrest standing={standing} size={30} label />);
    expect(tree.root.findAllByType(PortraitBorder)).toHaveLength(0);
    const words = tree.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
    expect(words).toContain('III');
    expect(words).toContain('MYTHIC III');
    act(() => tree.unmount());
  });
});

describe('plotStatus (the one short status on a summary land row)', () => {
  it('is what the plot has been through, never where it came from', () => {
    expect(plotStatus({ held: 1 })).toBe('Held 1 attack');
    expect(plotStatus({ held: 3, reinforcements: 2 })).toBe('Held 3 attacks');
    // Reinforcement is what the life bar already shows; it earns no word.
    expect(plotStatus({ reinforcements: 1 })).toBeNull();
    expect(plotStatus({ run_distance_m: 5200, claimed_at: new Date().toISOString() })).toBeNull();
    expect(plotStatus(null)).toBeNull();
  });
});
