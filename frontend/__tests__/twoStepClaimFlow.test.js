import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import TwoStepClaimFlow, {
  CLAIM_STEPS,
  ClaimSummary,
  claimBreakdown,
  claimCtaLabel,
} from '../src/components/claim/TwoStepClaimFlow';

const team = { fill: '#ec489933', stroke: '#ec4899', glow: '#ec4899' };
const ring = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]];
const placement = (over = {}) => ({
  action: 'empty',
  available: true,
  energy_cost: 8,
  energy_before: 40,
  energy_after: 32,
  applied_discounts: ['first_claim_of_day'],
  new_m2: 380000,
  enemy_m2: 0,
  defended_m2: 0,
  mine_m2: 0,
  ally_m2: 0,
  ...over,
});

const texts = (tree) =>
  tree.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));

function render(el) {
  let tree;
  act(() => { tree = renderer.create(el); });
  return tree;
}

describe('claim breakdown and CTA', () => {
  it('counts open, rival and club ground as gain, never your own', () => {
    const b = claimBreakdown(placement({ enemy_m2: 20000, ally_m2: 5000, mine_m2: 90000 }));
    expect(b.gain).toBe(405000);
    expect(b.mine).toBe(90000);
  });

  it('names what the button claims instead of "here"', () => {
    expect(claimCtaLabel(placement(), 500000).title).toBe('CLAIM 0.38 km²');
    expect(claimCtaLabel(placement(), 500000).spoken).toBe('Claim 0.38 square kilometres');
    // All of it on your own land: that is a reinforcement.
    expect(claimCtaLabel(placement({ new_m2: 0, mine_m2: 300000 }), 300000).title).toBe('REINFORCE 0.30 km²');
    // No breakdown yet: the land the run earned.
    expect(claimCtaLabel(null, 250000).title).toBe('CLAIM 0.25 km²');
  });
});

describe('ClaimSummary', () => {
  it('leads with the gain and states the real energy price', () => {
    const tree = render(
      <ClaimSummary placement={placement()} accent={team.glow} earnedM2={380000} energyStatus={{ energy: 40, energy_max: 40 }} />
    );
    const all = texts(tree);
    expect(all).toContain('+0.38 km²');
    expect(all).toContain('Claim cost: 8 energy');
    expect(all.some((t) => t.includes('You have 40. 32 left after.'))).toBe(true);
    expect(all.some((t) => t.includes('Half price'))).toBe(true);
    // With nothing but open ground the parts would repeat the headline.
    expect(all).not.toContain('New land');
    act(() => tree.unmount());
  });

  it('breaks the gain down only when there is something to break down', () => {
    const tree = render(
      <ClaimSummary placement={placement({ enemy_m2: 20000 })} accent={team.glow} earnedM2={400000} />
    );
    const all = texts(tree);
    expect(all).toContain('New land');
    expect(all).toContain('From rivals');
    expect(all).toContain('Already yours');
    act(() => tree.unmount());
  });

  it('never invents a price it was not sent', () => {
    const tree = render(<ClaimSummary placement={null} accent={team.glow} earnedM2={250000} />);
    expect(texts(tree)).toContain('Claiming spends energy.');
    act(() => tree.unmount());
  });
});

describe('TwoStepClaimFlow', () => {
  const baseProps = {
    options: { base_t: 0.5 },
    pose: { t: 0.5, deg: 0 },
    placement: placement(),
    team,
    ring,
    coach: false,
  };

  it('step 1 says what to do and moves on to the angle', () => {
    const onStepChange = jest.fn();
    const tree = render(
      <TwoStepClaimFlow {...baseProps} onPose={jest.fn()} step={CLAIM_STEPS.PLACE} onStepChange={onStepChange} />
    );
    const all = texts(tree);
    expect(all).toContain('STEP 1 OF 2');
    expect(all).toContain('Choose where');
    expect(all).toContain('Move your claim along your run.');
    expect(all).toContain('Position on your run');
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Claim position along run' }).length).toBeGreaterThan(0);
    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Choose angle' }).props.onPress();
    });
    expect(onStepChange).toHaveBeenCalledWith(CLAIM_STEPS.ROTATE);
    act(() => tree.unmount());
  });

  it('step 2 has a labelled dial, turn buttons and a way back', () => {
    const onPose = jest.fn();
    const onStepChange = jest.fn();
    const tree = render(
      <TwoStepClaimFlow {...baseProps} onPose={onPose} step={CLAIM_STEPS.ROTATE} onStepChange={onStepChange} />
    );
    const all = texts(tree);
    expect(all).toContain('STEP 2 OF 2');
    expect(all).toContain('Choose angle');
    expect(all).toContain('As you ran it');
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Claim rotation' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Rotate left' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Rotate right' }).length).toBeGreaterThan(0);
    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Change position' }).props.onPress();
    });
    expect(onStepChange).toHaveBeenCalledWith(CLAIM_STEPS.PLACE);
    act(() => tree.unmount());
  });

  it('shows the turn in words, left for anticlockwise', () => {
    const tree = render(
      <TwoStepClaimFlow {...baseProps} pose={{ t: 0.5, deg: 45 }} onPose={jest.fn()} step={CLAIM_STEPS.ROTATE} />
    );
    expect(texts(tree)).toContain('Turned 45° left');
    act(() => tree.unmount());
  });
});
