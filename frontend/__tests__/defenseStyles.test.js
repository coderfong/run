import { PLAYABLE_CAPTURE_STYLES } from '../src/effects/captureStyles';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import DefenseStylePlayer from '../src/effects/DefenseStylePlayer';
import {
  DEV_DEFENSE_STYLES,
  getDefenseStyle,
  resolveDefenseStyle,
  validateDefenseStyle,
} from '../src/effects/defenseStyles';

describe('successful defense choreography', () => {
  const style = getDefenseStyle('seedance_shield_counter');

  test('has no ownership transition and resolves independently', () => {
    expect(style.sequence.filter((step) => step.action === 'territoryReveal')).toHaveLength(0);
    expect(validateDefenseStyle(style)).toEqual([]);
    expect(resolveDefenseStyle('missing')).toBe(DEV_DEFENSE_STYLES[0]);
  });

  test('keeps defender and attacker roles explicit', () => {
    const actors = style.sequence.filter((step) => step.action === 'actor');
    expect(actors.some((step) => step.role === 'defender' && step.name === 'celebrate')).toBe(true);
    expect(actors.some((step) => step.role === 'attacker' && step.name === 'knockback')).toBe(true);
  });

  test('never enters capture selection', () => {
    expect(PLAYABLE_CAPTURE_STYLES.some((capture) => capture.id === style.id)).toBe(false);
  });

  test('rejects any attempted territory mutation', () => {
    expect(validateDefenseStyle({
      ...style,
      sequence: [...style.sequence, { action: 'territoryReveal', start: 1200 }],
    })).toContain('defense styles must not reveal or mutate territory ownership');
  });

  test('playback never calls an ownership reveal callback', () => {
    jest.useFakeTimers();
    const onTerritoryReveal = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <DefenseStylePlayer
          style={style.id}
          bounds={{ width: 320, height: 430 }}
          claimPoint={{ x: 160, y: 240 }}
          territoryRings={[]}
          characterRect={{ x: 40, y: 200, width: 80, height: 80 }}
          defenderRects={[{ x: 220, y: 200, width: 88, height: 88 }]}
          defenderCount={1}
          onTerritoryReveal={onTerritoryReveal}
        />
      );
      jest.advanceTimersByTime(style.duration + 100);
    });
    expect(onTerritoryReveal).not.toHaveBeenCalled();
    act(() => tree.unmount());
    jest.useRealTimers();
  });
});
