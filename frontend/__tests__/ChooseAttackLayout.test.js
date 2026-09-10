import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import ChooseAttack, { rivalNote } from '../src/components/claim/ChooseAttack';

const placement = (t, rotation_deg) => ({
  t,
  rotation_deg,
  action: 'empty',
  available: true,
  area_m2: 200000,
  held_m2: 200000,
  new_m2: 200000,
  enemy_m2: 0,
  defended_m2: 0,
  mine_m2: 0,
  ally_m2: 0,
  rivals: [],
});

const options = {
  base_t: 0.5,
  placements: [placement(0.2, 0), placement(0.55, 45), placement(0.8, 90)],
  most_land_index: 0,
  biggest_steal_index: 1,
  best_defence_index: 2,
};

describe('capture placement controls', () => {
  it('keeps three compact move modes above the rotator', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <ChooseAttack
          options={options}
          pose={{ t: 0.5, deg: 0 }}
          onPose={() => {}}
          placement={options.placements[0]}
          team={{ fill: '#22162B', stroke: '#EC4899', glow: '#EC4899' }}
        />
      );
    });

    const rotatorRow = tree.root.findByProps({ testID: 'claim-rotator-row' });
    expect(rotatorRow).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'claim-recommendations' })).toBeTruthy();

    const copy = tree.root.findAllByType(Text)
      .map((node) => node.props.children)
      .flat(Infinity)
      .filter((value) => typeof value === 'string')
      .join(' ');
    expect(copy).toContain('MOST LAND');
    expect(copy).toContain('ATTACK');
    expect(copy).toContain('BEST DEFENCE');
    expect(copy).not.toContain('AS RUN');
    expect(copy).not.toMatch(/\bTURN\b|\bSLIDE\b/);

    // PressableScale applies `style` to its animated child. Flex belongs on
    // the outer pressable so all three options share one row without wrapping.
    const mostLand = tree.root.findByProps({ accessibilityLabel: 'Move claim to most land' });
    expect(mostLand.props.containerStyle).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
    act(() => tree.unmount());
  });

  it('shows the ground that holds as its own number', () => {
    // A stretch where every border out-defends the runner used to read as
    // ENEMY 0.000 with the real figure buried in a sentence. ATTACK stays
    // pressable there (the server points it at the fight it can see), and the
    // breakdown says how much of the ground is theirs.
    const defendedPose = {
      ...placement(0.55, 45),
      action: 'fortified',
      held_m2: 230000,
      new_m2: 230000,
      enemy_m2: 0,
      defended_m2: 43000,
      area_m2: 273000,
      rivals: [{ user_id: 'r1', username: 'nix', avatar: null, area_m2: 43000, defended: true }],
    };
    let tree;
    act(() => {
      tree = renderer.create(
        <ChooseAttack
          options={options}
          pose={{ t: 0.55, deg: 45 }}
          onPose={() => {}}
          placement={defendedPose}
          team={{ fill: '#22162B', stroke: '#EC4899', glow: '#EC4899' }}
        />
      );
    });

    const attack = tree.root.findByProps({ accessibilityLabel: 'Move claim to attack' });
    expect(attack.props.accessibilityState.disabled).toBeFalsy();

    const copy = tree.root.findAllByType(Text)
      .map((node) => node.props.children)
      .flat(Infinity)
      .filter((value) => typeof value === 'string')
      .join(' ');
    expect(copy).toContain('THEIRS');
    expect(copy).toContain('0.043 km²');
    act(() => tree.unmount());
  });

  it('counts everyone under the claim, not only the ones who lose', () => {
    // THE BUG. The row dropped the defended half whenever anything at all was
    // takeable, so a claim covering four borders said "1 runner loses ground
    // here" and showed one face. With the map now drawing exactly the tier the
    // claim fights, every one of those plots is on screen — a sentence that
    // counts one of them reads as a miscount rather than as a fight.
    const mixed = {
      ...placement(0.55, 45),
      action: 'attack',
      enemy_m2: 51000,
      defended_m2: 96000,
      rivals: [
        { user_id: 'r1', username: 'nix', avatar: null, area_m2: 51000, defended: false },
        { user_id: 'r2', username: 'bex', avatar: null, area_m2: 60000, defended: true },
        { user_id: 'r3', username: 'ola', avatar: null, area_m2: 36000, defended: true },
      ],
    };
    let tree;
    act(() => {
      tree = renderer.create(
        <ChooseAttack
          options={options}
          pose={{ t: 0.55, deg: 45 }}
          onPose={() => {}}
          placement={mixed}
          team={{ fill: '#22162B', stroke: '#EC4899', glow: '#EC4899' }}
        />
      );
    });
    const copy = tree.root.findAllByType(Text)
      .map((node) => node.props.children)
      .flat(Infinity)
      .filter((value) => typeof value === 'string')
      .join(' ');
    expect(copy).toContain('1 lose ground');
    expect(copy).toContain('2 hold');
    act(() => tree.unmount());
  });

  it('keeps ATTACK visible but disabled when there is no rival placement', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <ChooseAttack
          options={{ ...options, biggest_steal_index: null }}
          pose={{ t: 0.5, deg: 0 }}
          onPose={() => {}}
          placement={options.placements[0]}
          team={{ fill: '#22162B', stroke: '#EC4899', glow: '#EC4899' }}
        />
      );
    });
    const attack = tree.root.findByProps({ accessibilityLabel: 'Move claim to attack' });
    expect(attack.props.accessibilityState.disabled).toBe(true);
    act(() => tree.unmount());
  });
});


test('enables Attack for a live rival overlap missed by preset suggestions', () => {
  const onPose = jest.fn();
  let tree;
  act(() => { tree = renderer.create(<ChooseAttack
    options={{ placements: [], biggest_steal_index: null }}
    pose={{ t: 0.37, deg: 22 }} onPose={onPose}
    placement={{ ...placement(0.37, 22), action: 'attack', enemy_m2: 100 }}
    stale={false} team={{ glow: '#EC4899' }}
  />); });
  const attack = tree.root.findByProps({ accessibilityLabel: 'Move claim to attack' });
  expect(attack.props.accessibilityState.disabled).toBe(false);
  expect(attack.props.accessibilityState.selected).toBe(true);
  act(() => attack.props.onPress());
  expect(onPose).toHaveBeenCalledWith({ t: 0.37, deg: 22 }, { commit: true });
  act(() => tree.unmount());
});


// The one line that says who is under the claim. Four shapes, because the
// mixed one is the case that used to go missing and the singular ones are
// where a naive `${n} runners` reads as a typo.
describe('rivalNote', () => {
  it('names both sides when the claim meets both', () => {
    expect(rivalNote(2, 1)).toBe('2 lose ground · 1 holds');
    expect(rivalNote(1, 3)).toBe('1 lose ground · 3 hold');
  });
  it('stays grammatical when only ground is lost', () => {
    expect(rivalNote(1, 0)).toBe('1 runner loses ground here');
    expect(rivalNote(4, 0)).toBe('4 runners lose ground here');
  });
  it('says the defence held when nothing gives way', () => {
    expect(rivalNote(0, 2)).toBe('defence holds here');
  });
  it('says nothing when nobody is there', () => {
    expect(rivalNote(0, 0)).toBe('');
  });
});
