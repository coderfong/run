/**
 * Planning the attack later.
 *
 * The post-run claim screen can be left without placing the run's land. The
 * land then waits (the server's `claim_defer_hours`), Home offers it back,
 * and PlanAttackScreen reopens the same claim screen for that one run. Pinned
 * here is everything that can be pinned without a device: the time-left
 * words, which waiting runs are worth offering, the Home card, and how the
 * reopened screen loads and fails.
 *
 * ResultScreen itself is stubbed. Its "Plan later" button and its deferred
 * mode are covered in ResultScreen.test.js.
 */

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('../src/api/client', () => ({
  api: { claimResume: jest.fn() },
  ApiError: class ApiError extends Error {},
  API_BASE: 'http://test',
}));
jest.mock('../src/api/cache', () => ({ invalidate: jest.fn() }));
jest.mock('../src/hooks/useAccent', () => ({
  useAccentColor: () => ({ fill: '#222', stroke: '#4af', glow: '#7cf' }),
  useAccent: () => '#4af',
}));
jest.mock('../src/screens/ResultScreen', () => {
  const React2 = require('react');
  return {
    __esModule: true,
    default: (props) => React2.createElement('ResultScreenStub', props),
  };
});

import { api } from '../src/api/client';
import { invalidate } from '../src/api/cache';
import { claimTimeLeft, openClaims } from '../src/utils/claimWindow';
import PendingClaimCard, { pendingClaimLine } from '../src/components/claim/PendingClaimCard';
import PlanAttackScreen, { resumeFailure, toMapPath } from '../src/screens/PlanAttackScreen';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const MIN = 60000;
const HOUR = 60 * MIN;
const at = (ms) => new Date(NOW + ms).toISOString();

function copyOf(tree) {
  return tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .flat(Infinity)
    .filter((value) => typeof value === 'string')
    .join(' | ');
}

afterEach(() => jest.clearAllMocks());

describe('claimTimeLeft', () => {
  it('says nothing when there is no deadline', () => {
    expect(claimTimeLeft(null, NOW)).toEqual({ expired: false, ms: null, label: null });
    expect(claimTimeLeft('not a date', NOW).label).toBeNull();
  });

  it('reads a run that has just finished as the whole window', () => {
    expect(claimTimeLeft(at(24 * HOUR - 5000), NOW).label).toBe('24h left');
    expect(claimTimeLeft(at(3 * HOUR + 10 * MIN), NOW).label).toBe('3h left');
  });

  it('counts the last hour in minutes, and never says 0m or 60m', () => {
    expect(claimTimeLeft(at(30 * MIN), NOW).label).toBe('30m left');
    expect(claimTimeLeft(at(20000), NOW).label).toBe('1m left');
    expect(claimTimeLeft(at(HOUR - 1000), NOW).label).toBe('59m left');
  });

  it('switches to days only for a long window', () => {
    expect(claimTimeLeft(at(47 * HOUR), NOW).label).toBe('47h left');
    expect(claimTimeLeft(at(3 * 24 * HOUR), NOW).label).toBe('3d left');
  });

  it('is expired at the deadline and after it', () => {
    expect(claimTimeLeft(at(0), NOW).expired).toBe(true);
    expect(claimTimeLeft(at(-HOUR), NOW)).toEqual({ expired: true, ms: 0, label: null });
  });

  it('reads a timestamp with no zone as UTC, never as phone time', () => {
    expect(claimTimeLeft('2026-09-15T15:00:00', NOW).label).toBe('3h left');
  });
});

describe('openClaims', () => {
  it('offers only runs whose land can still be placed', () => {
    const list = [
      { run_id: 'a', claim_expires_at: at(HOUR) },
      { run_id: 'b', claim_expires_at: at(-MIN) },
      { run_id: 'c', claim_expires_at: null },
      { claim_expires_at: at(HOUR) },
      null,
    ];
    expect(openClaims(list, NOW).map((claim) => claim.run_id)).toEqual(['a', 'c']);
    expect(openClaims(undefined, NOW)).toEqual([]);
  });
});

describe('PendingClaimCard', () => {
  const claim = {
    run_id: 'r1',
    distance_m: 5020,
    claim_area_m2: 250000,
    claim_expires_at: at(21 * HOUR),
  };

  it('names the run, the land and the time left, in plain words', () => {
    const line = pendingClaimLine(claim, NOW);
    expect(line).toBe('5.02 km run covering 0.25 km², 21h left');
    // PASER copy carries no dashes of any kind.
    expect(line).not.toMatch(/[-–—]/);
  });

  it('drops the time when there is no deadline', () => {
    expect(pendingClaimLine({ ...claim, claim_expires_at: null }, NOW)).toBe('5.02 km run covering 0.25 km²');
  });

  it('opens the claim on tap, and counts the other waiting runs', () => {
    const onPress = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(<PendingClaimCard claim={claim} count={2} onPress={onPress} />);
    });
    const copy = copyOf(tree);
    expect(copy).toContain('2 RUNS HAVE LAND WAITING');
    expect(copy).toContain('Plan your attack');
    act(() => {
      tree.root
        .findByProps({ accessibilityLabel: 'Plan your attack. Your land is waiting' })
        .props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('renders nothing without a claim', () => {
    let tree;
    act(() => {
      tree = renderer.create(<PendingClaimCard claim={null} />);
    });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });
});

describe('PlanAttackScreen', () => {
  const route = { params: { runId: 'r1' } };

  it('reopens the claim screen in its deferred mode, with a route it can draw', async () => {
    api.claimResume.mockResolvedValueOnce({
      result: {
        run_id: 'r1',
        claim_area_m2: 250000,
        claim_ring: [[103.82, 1.36], [103.83, 1.36], [103.83, 1.37]],
      },
      path: [[103.82, 1.36], [103.83, 1.37], ['bad', 1]],
      splits: [{ km: 1, seconds: 330 }],
    });
    const navigation = { goBack: jest.fn() };
    let tree;
    await act(async () => {
      tree = renderer.create(<PlanAttackScreen navigation={navigation} route={route} />);
    });
    expect(api.claimResume).toHaveBeenCalledWith('r1');
    const { params } = tree.root.findByType('ResultScreenStub').props.route;
    expect(params.deferred).toBe(true);
    expect(params.path).toEqual([
      { latitude: 1.36, longitude: 103.82 },
      { latitude: 1.37, longitude: 103.83 },
    ]);
    expect(params.result.run_id).toBe('r1');
    expect(params.result.splits).toEqual([{ km: 1, seconds: 330 }]);
    expect(invalidate).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('says why when the land is gone, and stops Home offering it', async () => {
    api.claimResume.mockRejectedValueOnce(
      Object.assign(new Error('The land from this run has expired.'), { status: 410 })
    );
    const navigation = { goBack: jest.fn() };
    let tree;
    await act(async () => {
      tree = renderer.create(<PlanAttackScreen navigation={navigation} route={route} />);
    });
    expect(copyOf(tree)).toContain('This land has expired.');
    expect(invalidate).toHaveBeenCalledWith('me:pending-claims');
    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Close' }).props.onPress();
    });
    expect(navigation.goBack).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('keeps offering the land when only the network failed', async () => {
    api.claimResume.mockRejectedValueOnce(new Error('Network request failed'));
    let tree;
    await act(async () => {
      tree = renderer.create(<PlanAttackScreen navigation={{ goBack: jest.fn() }} route={route} />);
    });
    expect(copyOf(tree)).toContain('Network request failed');
    expect(invalidate).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe('resume helpers', () => {
  it('treats expired, placed and landless runs as gone for good', () => {
    expect(resumeFailure({ status: 410 }).gone).toBe(true);
    expect(resumeFailure({ status: 409 }).gone).toBe(true);
    expect(resumeFailure({ status: 422 }).gone).toBe(true);
    expect(resumeFailure({ status: 500, message: 'x' })).toEqual({ gone: false, message: 'x' });
  });

  it('turns the stored [lon, lat] route into map points, dropping junk', () => {
    expect(toMapPath([[1, 2], [null, 3], 'x'])).toEqual([{ latitude: 2, longitude: 1 }]);
    expect(toMapPath(null)).toEqual([]);
  });
});
