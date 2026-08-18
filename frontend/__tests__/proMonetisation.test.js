/**
 * PASER PRO's monetisation, and the four ways it could quietly become
 * something the app promised it would never be.
 *
 *   1. PAY TO WIN CREEPS IN THROUGH COPY. It always starts as a perk line —
 *      "more energy to claim with" shipped on the first-run screen for weeks —
 *      and only later becomes code. So every contextual pitch is scanned for
 *      the vocabulary of advantage.
 *
 *   2. A TEASER SHOWS A NUMBER THAT IS NOT REAL. The single most damaging
 *      failure available here: the runner pays, the real panel loads, and it
 *      says something else. The teaser row contract has nowhere to put an
 *      invented value, and that is asserted rather than trusted.
 *
 *   3. THE EXPOSURE RULES STOP HOLDING. If `canShowAuto` ever returns true for
 *      a brand new account, or twice in a session, the app becomes the thing
 *      the whole design was written to avoid.
 *
 *   4. THE PLANNER'S FREE ALLOWANCE IS SPENT BY ACCIDENT. Charging somebody a
 *      preview for a mis-tap turns a trial into a trap.
 *
 *   5. THE DEV STORE OVERRIDE REACHES A RELEASE BUILD. It exists so the whole
 *      monetisation can be looked at while `IAP_ENABLED` is still false. If it
 *      could ever be true in a shipped build, PASER would advertise a
 *      subscription it cannot sell — a rejected release, and a paywall that
 *      does nothing for everybody who tapped it in the meantime.
 *
 * The geometry is tested too, because every number the planner shows a paying
 * customer comes out of it.
 */

import {
  MAX_AUTO_PAYWALLS_PER_SESSION,
  MIN_MS_BETWEEN_AUTO,
  MIN_RUNS_BEFORE_AUTO,
  FREE_PLANNER_PREVIEWS,
} from '../src/config/proExposure';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Writes to the exposure record are debounced by 400ms so several changes in
 * one frame cost one disk round trip. Tests that care what landed on disk have
 * to let that timer run — a straight read of the mock immediately after a
 * change finds nothing, which is correct behaviour and a confusing test
 * failure. Returns the JSON that was persisted.
 */
async function flushWrite() {
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const call = AsyncStorage.setItem.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return call[1];
}

/** Reload the module as if the app had been restarted, from a saved blob. */
async function restart(blob) {
  jest.resetModules();
  const storage = require('@react-native-async-storage/async-storage');
  storage.getItem.mockResolvedValue(blob);
  const fresh = require('../src/pro/exposure');
  await fresh.hydrateProExposure();
  return fresh;
}

// ---------------------------------------------------------------------------
// 1. Copy
// ---------------------------------------------------------------------------

describe('paywall copy promises depth, never power', () => {
  const { PRO_CONTEXTS, DEFAULT_CONTEXT, proContext } = require('../src/config/proContexts');

  // Deliberately wider than the equivalent list in proEntitlement.test.js:
  // that one guards six static perk lines, this one guards a growing set of
  // contextual pitches written under pressure to convert.
  const BANNED =
    /\b(more energy|extra energy|cheaper|cheaper claims|stronger|slower decay|faster decay|more land|more territory|bonus land|advantage|boost|win more|beat them|out ?rank)\b/i;

  const all = [DEFAULT_CONTEXT, ...Object.values(PRO_CONTEXTS)];

  it('never promises an advantage in any context', () => {
    for (const ctx of all) {
      for (const text of [ctx.title, ctx.subtitle, ctx.cta].filter(Boolean)) {
        expect([text, BANNED.test(text)]).toEqual([text, false]);
      }
      for (const [, label] of ctx.perks || []) {
        expect([label, BANNED.test(label)]).toEqual([label, false]);
      }
    }
  });

  it('names only icons that exist', () => {
    const { hasIcon } = require('../src/components/AppIcon');
    for (const ctx of all) {
      for (const [icon] of ctx.perks || []) {
        expect([icon, hasIcon(icon)]).toEqual([icon, true]);
      }
    }
  });

  it('tags every context with a source the funnel knows', () => {
    const { SOURCES } = require('../src/analytics');
    for (const [key, ctx] of Object.entries(PRO_CONTEXTS)) {
      expect([key, SOURCES.includes(ctx.source)]).toEqual([key, true]);
    }
  });

  it('falls back to the general pitch rather than throwing on a bad key', () => {
    // A typo'd context must never be able to crash the paywall.
    expect(proContext('does_not_exist').title).toBe(DEFAULT_CONTEXT.title);
    expect(proContext(undefined).title).toBe(DEFAULT_CONTEXT.title);
  });

  it('uses no dashes in runner facing copy', () => {
    // House rule: `·` is the separator and the empty-value placeholder.
    for (const ctx of all) {
      for (const text of [ctx.title, ctx.subtitle, ctx.cta].filter(Boolean)) {
        expect([text, /[—–]|(\s-\s)/.test(text)]).toEqual([text, false]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Analytics carries behaviour, not people
// ---------------------------------------------------------------------------

describe('analytics scrubbing', () => {
  it('drops identifying keys and keeps behavioural ones', () => {
    jest.resetModules();
    const analytics = require('../src/analytics');
    const seen = [];
    analytics.setAnalyticsSink((name, props) => seen.push({ name, props }));

    analytics.track('pro_paywall_view', {
      source: 'result',
      username: 'jon',
      user_id: 'abc-123',
      email: 'a@b.c',
      lat: 51.5,
      lon: -0.1,
      run_id: 'run-9',
      receipt: 'jws-token',
      previews_left: 2,
      trigger: 'automatic',
    });

    expect(seen).toHaveLength(1);
    const { props } = seen[0];
    expect(props).toEqual({ source: 'result', previews_left: 2, trigger: 'automatic' });
    for (const banned of ['username', 'user_id', 'email', 'lat', 'lon', 'run_id', 'receipt']) {
      expect([banned, banned in props]).toEqual([banned, false]);
    }
  });

  it('drops nested objects, which is how a route or a profile gets in', () => {
    jest.resetModules();
    const analytics = require('../src/analytics');
    const seen = [];
    analytics.setAnalyticsSink((name, props) => seen.push(props));
    analytics.track('pro_teaser_tap', { source: 'map_planner', route: [[1, 2]], meta: { a: 1 } });
    expect(seen[0]).toEqual({ source: 'map_planner' });
  });

  it('survives a sink that throws', () => {
    jest.resetModules();
    const analytics = require('../src/analytics');
    analytics.setAnalyticsSink(() => {
      throw new Error('vendor down');
    });
    // A broken analytics vendor must never be able to take down the paywall.
    expect(() => analytics.track('pro_paywall_view', { source: 'result' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Exposure rules
// ---------------------------------------------------------------------------

describe('automatic paywall exposure', () => {
  let exposure;
  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    exposure = require('../src/pro/exposure');
    await exposure.hydrateProExposure();
  });
  afterEach(() => jest.useRealTimers());

  it('refuses a brand new account', () => {
    expect(exposure.canShowAuto('run_insights', { runCount: 0 })).toEqual({
      allowed: false,
      reason: 'too_new',
    });
    expect(
      exposure.canShowAuto('run_insights', { runCount: MIN_RUNS_BEFORE_AUTO - 1 }).allowed
    ).toBe(false);
  });

  it('refuses when the run count has not loaded, rather than assuming', () => {
    // The dangerous default. "Unknown" must never read as "eligible", or a
    // slow /me/stats becomes a paywall for a first-time runner.
    expect(exposure.canShowAuto('run_insights', { runCount: null })).toEqual({
      allowed: false,
      reason: 'runs_unknown',
    });
  });

  it('allows one, then caps the session', () => {
    const args = { runCount: MIN_RUNS_BEFORE_AUTO };
    expect(exposure.canShowAuto('run_insights', args).allowed).toBe(true);
    for (let i = 0; i < MAX_AUTO_PAYWALLS_PER_SESSION; i++) {
      exposure.noteAutoShown('run_insights');
    }
    expect(exposure.canShowAuto('run_insights', args)).toEqual({
      allowed: false,
      reason: 'session_cap',
    });
  });

  it('stays quiet for hours after one has been shown, across a restart', async () => {
    // The session cap is deliberately NOT persisted, so a runner who force
    // quits and reopens gets a fresh session. The clock is what has to stop
    // them being sold to four times in an evening, and it only works if it
    // survives the restart — which is what this actually checks.
    const now = 1_000_000_000_000;
    exposure.noteAutoShown('run_insights', { now });
    const blob = await flushWrite();

    const restarted = await restart(blob);
    expect(
      restarted.canShowAuto('run_insights', {
        runCount: 50,
        now: now + MIN_MS_BETWEEN_AUTO - 1,
      }).reason
    ).toBe('too_soon');
    // And opens up again once the window has passed.
    expect(
      restarted.canShowAuto('run_insights', {
        runCount: 50,
        now: now + MIN_MS_BETWEEN_AUTO + 1,
      }).allowed
    ).toBe(true);
  });

  it('gives up on a context that keeps being dismissed', () => {
    const args = { runCount: 50 };
    let guard = 0;
    while (exposure.canShowAuto('rival_insights', args).allowed && guard++ < 10) {
      exposure.noteAutoDismissed('rival_insights');
    }
    expect(exposure.canShowAuto('rival_insights', args).reason).toBe('dismissed_enough');
  });

  it('reports the first teaser impression once, then never again', () => {
    expect(exposure.noteTeaserSeen('cosmetics')).toBe(true);
    expect(exposure.noteTeaserSeen('cosmetics')).toBe(false);
    expect(exposure.hasSeenTeaser('cosmetics')).toBe(true);
  });
});

describe('territory planner allowance', () => {
  let exposure;
  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    exposure = require('../src/pro/exposure');
    await exposure.hydrateProExposure();
  });
  afterEach(() => jest.useRealTimers());

  it('starts at the configured free count and counts down', () => {
    expect(exposure.plannerPreviewsLeft(false)).toBe(FREE_PLANNER_PREVIEWS);
    expect(exposure.notePlannerUse(false)).toBe(FREE_PLANNER_PREVIEWS - 1);
    expect(exposure.notePlannerUse(false)).toBe(FREE_PLANNER_PREVIEWS - 2);
  });

  it('never goes negative, however many times it is spent', () => {
    for (let i = 0; i < FREE_PLANNER_PREVIEWS + 5; i++) exposure.notePlannerUse(false);
    expect(exposure.plannerPreviewsLeft(false)).toBe(0);
  });

  it('is unlimited for PRO and spends nothing', () => {
    expect(exposure.plannerPreviewsLeft(true)).toBe(Infinity);
    exposure.notePlannerUse(true);
    exposure.notePlannerUse(true);
    // The free balance is untouched: a subscription that lapses must not come
    // back to an allowance silently drained while it was active.
    expect(exposure.plannerPreviewsLeft(false)).toBe(FREE_PLANNER_PREVIEWS);
  });

  it('survives a restart, which is the whole point of persisting it', async () => {
    // "Don't let app restarts trivially reset it" is the requirement. This is
    // that requirement.
    exposure.notePlannerUse(false);
    const restarted = await restart(await flushWrite());
    expect(restarted.plannerPreviewsLeft(false)).toBe(FREE_PLANNER_PREVIEWS - 1);
  });

  it('starts clean rather than crashing on an unreadable record', async () => {
    jest.resetModules();
    const storage = require('@react-native-async-storage/async-storage');
    storage.getItem.mockResolvedValueOnce('{not json');
    const fresh = require('../src/pro/exposure');
    await expect(fresh.hydrateProExposure()).resolves.toBeUndefined();
    expect(fresh.plannerPreviewsLeft(false)).toBe(FREE_PLANNER_PREVIEWS);
  });
});

// ---------------------------------------------------------------------------
// 4. Can PASER sell at all?
// ---------------------------------------------------------------------------

describe('store availability', () => {
  // Loaded fresh per test: the override is module state, and a leaked `true`
  // would make the release-build assertions below pass for the wrong reason.
  function load({ dev = true, iapEnabled = false } = {}) {
    jest.resetModules();
    global.__DEV__ = dev;
    jest.doMock('../src/config/releaseFeatures', () => ({
      ...jest.requireActual('../src/config/releaseFeatures'),
      IAP_ENABLED: iapEnabled,
    }));
    return require('../src/pro/storeAvailable');
  }

  const wasDev = global.__DEV__;
  afterEach(() => {
    global.__DEV__ = wasDev;
    jest.dontMock('../src/config/releaseFeatures');
  });

  it('is off by default while the release switch is off', () => {
    expect(load().storeAvailable()).toBe(false);
  });

  it('can be turned on in a dev build, so the surfaces can be looked at', () => {
    const store = load();
    store.setDevStoreOverride(true);
    expect(store.storeAvailable()).toBe(true);
    expect(store.devStoreOverride()).toBe(true);
    store.setDevStoreOverride(false);
    expect(store.storeAvailable()).toBe(false);
  });

  it('CANNOT be turned on in a release build, by any call', () => {
    // The assertion the whole module exists for.
    const store = load({ dev: false });
    store.setDevStoreOverride(true);
    expect(store.storeAvailable()).toBe(false);
    expect(store.devStoreOverride()).toBe(false);
  });

  it('follows the release switch once it is on, override or not', () => {
    const store = load({ iapEnabled: true });
    expect(store.storeAvailable()).toBe(true);
    // Turning the override off must not be able to turn a live store off: the
    // switch is authoritative, the override only ever adds.
    store.setDevStoreOverride(false);
    expect(store.storeAvailable()).toBe(true);
  });

  it('tells subscribers when the answer changes, and stops when unsubscribed', () => {
    const store = load();
    let calls = 0;
    const off = store.subscribeStoreAvailable(() => { calls += 1; });
    store.setDevStoreOverride(true);
    expect(calls).toBe(1);
    off();
    store.setDevStoreOverride(false);
    expect(calls).toBe(1);
  });

  it('survives a listener that throws, because one screen must not take the app', () => {
    const store = load();
    store.subscribeStoreAvailable(() => { throw new Error('bad screen'); });
    let reached = false;
    store.subscribeStoreAvailable(() => { reached = true; });
    expect(() => store.setDevStoreOverride(true)).not.toThrow();
    expect(reached).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Notable runs
// ---------------------------------------------------------------------------

describe('notableRun', () => {
  const { notableRun } = require('../src/pro/notableRun');
  const { NOTABLE_RUN } = require('../src/config/proExposure');

  it('says nothing about an ordinary run', () => {
    expect(
      notableRun({ territory_m2: 1000, rivals_taken: 0, standing_rank: 400, standing_field: 500 })
        .notable
    ).toBe(false);
  });

  it('notices ground taken off another runner', () => {
    const out = notableRun({ territory_m2: 1000, rivals_taken: 1 });
    expect(out.notable).toBe(true);
    expect(out.reason).toBe('rival_steal');
    expect(out.headline).toMatch(/took ground/i);
  });

  it('notices a big claim', () => {
    expect(notableRun({ territory_m2: NOTABLE_RUN.bigClaimM2 }).reason).toBe('big_claim');
  });

  it('will not call a four person board a top placing', () => {
    // rank 1 of 4 is 25% and would otherwise pass the fraction test.
    expect(notableRun({ standing_rank: 1, standing_field: 4 }).notable).toBe(false);
  });

  it('handles a missing payload without throwing', () => {
    expect(notableRun(null).notable).toBe(false);
    expect(notableRun({}).notable).toBe(false);
  });
});
