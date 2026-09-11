/**
 * ResultScreen must render on the very first frame after a run.
 *
 * THE BUG THIS EXISTS FOR. `claimCost` was computed ~45 lines above the
 * `useState` that declares `energyStatus`:
 *
 *   const claimCost = options?.placements?.[placement]?.energy_cost
 *                  ?? energyStatus?.claim_cost ?? null;
 *   ...
 *   const [energyStatus, setEnergyStatus] = useState(null);
 *
 * On the first render `options` is null (the /claim-options request has not
 * landed) so the `??` falls through to `energyStatus`, which is still in its
 * temporal dead zone. Optional chaining does not help — reading the binding at
 * all is the error. Result: `ReferenceError: Cannot access 'energyStatus'
 * before initialization` on the payoff screen for every finished run.
 *
 * So the case under test is exactly the first frame: options === null and
 * energyStatus === null. Nothing is asserted about what it looks like; the
 * assertion is that it renders at all.
 *
 * IMPORTANT — THIS TEST CANNOT CATCH THAT PARTICULAR BUG, and it was verified
 * that it does not: reintroducing the original ordering leaves it green.
 * jest-expo's babel transform downlevels `const` to `var`, which erases
 * temporal-dead-zone semantics — the read yields `undefined` instead of
 * throwing. Hermes on a device is a modern engine and DOES enforce TDZ, which
 * is why the crash was real in the app and invisible here.
 *
 * `node scripts/check-tdz.mjs` is what actually guards it. That one was probed
 * with the same bug and fails as it should. This test guards the broader thing
 * — that the post-run screen renders at all on its first frame, with every
 * request still in flight — which is worth having on its own.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

// --- native + heavy leaves -------------------------------------------------
// The broadly-native ones (AsyncStorage, Mapbox, haptics, location,
// reanimated) are mocked once in jest.setup.js. What is left here is specific
// to this screen.
jest.mock('../src/components/GameMap', () => {
  const React2 = require('react');
  const Stub = () => React2.createElement('GameMapStub', null);
  return {
    __esModule: true,
    default: React2.forwardRef((_props, _ref) => React2.createElement('GameMapStub', null)),
    MAP_READY: false, // skips the map subtree entirely — not what we're testing
    TerritoryFill: Stub,
    TerritoryLayer: Stub,
    Trail: Stub,
    UserMarker: Stub,
  };
});
// The screen-level contract is the first render, not animation mechanics.
// Reanimated's generic Jest mock still drives the motion primitives through
// their timing loops, which can leave this otherwise synchronous render open
// indefinitely. Keep the component shapes and remove only those clocks.
jest.mock('../src/ui/motion', () => {
  const React2 = require('react');
  const Pass = ({ children }) => React2.createElement(React2.Fragment, null, children);
  const PressableScale = ({ children, ...props }) =>
    React2.createElement('PressableScaleStub', props, children);
  return {
    haptic: {
      light: jest.fn(),
      medium: jest.fn(),
      heavy: jest.fn(),
      success: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      selection: jest.fn(),
    },
    useReduceMotion: () => true,
    useSystemReduceMotion: () => true,
    useOnScreen: () => true,
    staggerDelay: () => 0,
    shouldStagger: () => false,
    Reveal: Pass,
    Confetti: () => null,
    PressableScale,
    Bar: Pass,
    SteppedBar: Pass,
    Pulse: Pass,
    Pop: Pass,
    MascotLoader: () => null,
    Skeleton: Pass,
    CountUpText: ({ value }) => React2.createElement('CountUpTextStub', { value }),
  };
});
// --- data the screen pulls in ----------------------------------------------
// EVERY api call stays pending, which is precisely the first-frame state:
// `options` is null and `energyStatus` is null. A Proxy rather than a fixed
// list of methods, so this test keeps testing the first render as the screen
// grows new calls instead of failing on an undefined mock.
jest.mock('../src/api/client', () => ({
  api: new Proxy(
    {},
    {
      get: () => jest.fn(() => new Promise(() => {})),
    }
  ),
  ApiError: class ApiError extends Error {},
  API_BASE: 'http://test',
}));
// An empty cache, so the screen renders its first-visit state. A Proxy for the
// same reason as `api` above: this screen mounts children (TerritoryInsights,
// and whatever comes next) whose hooks read through useQuery, so the set of
// cache functions reached from here is not the set ResultScreen imports and
// grows without warning. A hand-listed factory fails that growth as
// `TypeError: getCached is not a function` thrown from inside a component,
// which reads like a bug in the cache rather than a gap in this mock.
//
// Unlike `api`, the exports here do not all have one shape, so the default —
// an inert fn returning undefined, which is correct for every write and
// invalidate — is overridden where a return value is load-bearing.
jest.mock('../src/api/cache', () => {
  const pending = () => new Promise(() => {});
  // Only the contracts a caller actually consumes. `getCached` is deliberately
  // absent: undefined IS "nothing cached", which is the state under test.
  const contracts = {
    // Arithmetic, not a flag — useQuery does `Date.now() - touchedAt(key)`.
    // undefined would make that NaN and quietly invert the staleness check.
    touchedAt: () => 0,
    // Used as a useEffect cleanup, so it has to hand back an unsubscribe.
    subscribeCached: () => () => {},
    // Every request stays in flight, which is the first-frame state this whole
    // file exists to render.
    fetchAndCache: pending,
    dedupe: pending,
    hydrateCache: () => Promise.resolve(),
  };
  // Memoized per name so identities are stable across accesses: hooks put
  // these in dependency arrays, and a fresh fn each read would also make any
  // future `expect(cache.x).toHaveBeenCalled()` silently unable to see the call.
  const fns = new Map();
  return new Proxy(
    // A real own property, so Babel's interop treats this as a module namespace
    // and reads members straight off it instead of copying own enumerable keys
    // (a Proxy over a bare target has none, and the copy would come out empty).
    { __esModule: true },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        // A module that answers `then` with a function is a thenable, and the
        // module registry would try to await it. Symbols reach here from
        // inspection and stringification, and must not become fns either.
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (!fns.has(prop)) fns.set(prop, jest.fn(contracts[prop]));
        return fns.get(prop);
      },
    }
  );
});

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'runner' } }),
}));
jest.mock('../src/state/clan', () => ({
  useClan: () => ({
    color: { fill: '#222', stroke: '#4af', glow: '#7cf' },
    clan: null,
  }),
  NEUTRAL: { fill: '#222', stroke: '#888', glow: '#aaa' },
}));
jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: {}, rankKey: 'wood' }),
}));
jest.mock('../src/state/settings', () => ({
  useSettings: () => ({ trailGlowColor: null }),
}));

import ResultScreen, { mapRootResetState, payoffMapCenter } from '../src/screens/ResultScreen';

const navigation = { navigate: jest.fn(), getParent: () => ({ goBack: jest.fn() }) };

// The shape /end-run returns for a qualifying run that has not been claimed.
const result = {
  run_id: 'r1',
  distance_m: 5000,
  duration_s: 1800,
  claim_area_m2: 375000,
  claim_ring: [
    [103.82, 1.36],
    [103.83, 1.36],
    [103.83, 1.37],
    [103.82, 1.37],
    [103.82, 1.36],
  ],
  achievements: [],
  xp_gained: 250,
  tier: 'qualified_for_claim',
  qualification_reason: null,
  claim_eligible: true,
  coins_gained: 50,
  energy_gained: 8,
};

const path = [
  { latitude: 1.36, longitude: 103.82, timestamp: 1 },
  { latitude: 1.365, longitude: 103.825, timestamp: 2 },
];

describe('ResultScreen', () => {
  it('resets a map jump to one root Tabs route', () => {
    expect(mapRootResetState({ latitude: 1.30, longitude: 103.80 })).toEqual({
      index: 0,
      routes: [{
        name: 'Tabs',
        params: {
          screen: 'Map',
          params: {
            screen: 'MapMain',
            params: { focus: { lat: 1.30, lon: 103.80 } },
          },
        },
      }],
    });
  });

  it('focuses the final claimed shape when its centre differs from placement', () => {
    const center = payoffMapCenter({
      territory: {
        polygon: [[103.8, 1.3], [103.82, 1.3], [103.82, 1.32], [103.8, 1.32]],
      },
    });
    expect(center.latitude).toBeCloseTo(1.31, 5);
    expect(center.longitude).toBeCloseTo(103.81, 5);
  });

  it('renders the first frame with no claim options and no energy status', () => {
    let tree;
    expect(() => {
      act(() => {
        tree = renderer.create(
          <ResultScreen navigation={navigation} route={{ params: { result, path } }} />
        );
      });
    }).not.toThrow();
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('renders an activity that earned nothing', () => {
    const unqualified = {
      ...result,
      claim_area_m2: 0,
      claim_ring: [],
      claim_eligible: false,
      xp_gained: 0,
      coins_gained: 0,
      energy_gained: 0,
      tier: 'unqualified_for_rewards',
      qualification_reason: 'Complete at least 500 m to earn run rewards.',
    };
    let tree;
    expect(() => {
      act(() => {
        tree = renderer.create(
          <ResultScreen
            navigation={navigation}
            route={{ params: { result: unqualified, path } }}
          />
        );
      });
    }).not.toThrow();
    act(() => tree.unmount());
  });

  it('opens the share stage for a simulator-sized route when Continue is pressed', () => {
    const summary = {
      ...result,
      claim_area_m2: 0,
      claim_ring: [],
      claim_eligible: false,
      tier: 'qualified_for_rewards_only',
      qualification_reason: 'Complete at least 1 km to claim territory.',
    };
    const simulatedPath = Array.from({ length: 1600 }, (_, i) => {
      const angle = (i / 1599) * Math.PI * 2;
      return {
        latitude: 1.36 + Math.sin(angle) * 0.006,
        longitude: 103.82 + Math.cos(angle) * 0.006,
        timestamp: i * 1000,
      };
    });
    let tree;
    act(() => {
      tree = renderer.create(
        <ResultScreen
          navigation={navigation}
          route={{ params: { result: summary, path: simulatedPath } }}
        />
      );
    });

    const continueButton = tree.root.findByProps({ accessibilityLabel: 'Continue to sharing' });
    expect(() => {
      act(() => continueButton.props.onPress());
    }).not.toThrow();
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Finish and go home' }).length
    ).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});
