import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import ChooseAttack from '../src/components/claim/ChooseAttack';

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
  it('keeps four compact move modes above the rotator', () => {
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
    expect(copy).toContain('AS RUN');
    expect(copy).not.toMatch(/\bTURN\b|\bSLIDE\b/);

    // PressableScale applies `style` to its animated child. Flex belongs on
    // the outer pressable so all four options share one row without wrapping.
    const mostLand = tree.root.findByProps({ accessibilityLabel: 'Move claim to most land' });
    expect(mostLand.props.containerStyle).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
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
