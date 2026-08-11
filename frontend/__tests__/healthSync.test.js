/**
 * Apple Health sync is write-only, opt-in, and allowed to fail. The rules that
 * matter to App Review, and to anyone whose Health record this touches:
 *
 *   - nothing is written unless the runner turned the switch on;
 *   - nothing is written unless Health reports write access;
 *   - only the workout and its distance are written, never a read request;
 *   - a failure inside HealthKit returns false and never throws, because the
 *     caller is the end of a run and a lost workout must not cost the run.
 *
 * src/health.js memoises its module lookup on first use, so every case builds
 * a fresh registry: that also keeps the HealthKit fake and the copy of it that
 * health.js sees as one and the same object.
 */

const SHARING_AUTHORIZED = 2;
const SHARING_DENIED = 1;
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';
const DISTANCE_TYPE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

const START = Date.UTC(2026, 7, 12, 6, 0, 0);
const END = Date.UTC(2026, 7, 12, 6, 40, 0);
const RUN = { startMs: START, endMs: END, distanceM: 5432.7 };

let hk;
let health;

// Platform.OS is a plain property on some React Native versions and a getter
// on others; defineProperty is the one form that works either way.
function load(platform = 'ios') {
  jest.resetModules();
  Object.defineProperty(require('react-native').Platform, 'OS', {
    value: platform,
    configurable: true,
  });
  hk = require('@kingstinct/react-native-healthkit');
  hk.isHealthDataAvailable.mockReturnValue(true);
  hk.authorizationStatusFor.mockReturnValue(SHARING_AUTHORIZED);
  hk.requestAuthorization.mockResolvedValue(true);
  hk.saveWorkoutSample.mockResolvedValue({});
  health = require('../src/health');
  return health;
}

describe('availability', () => {
  it('is unsupported off iOS', () => {
    expect(load('android').healthSyncSupported()).toBe(false);
  });

  it('is unsupported on an iOS device with no health store', () => {
    load();
    hk.isHealthDataAvailable.mockReturnValue(false);
    expect(health.healthSyncSupported()).toBe(false);
  });

  it('survives a module that cannot load at all', async () => {
    load();
    hk.isHealthDataAvailable.mockImplementation(() => {
      throw new Error('no native half');
    });
    expect(health.healthSyncSupported()).toBe(false);
    await expect(health.writeWorkout(RUN)).resolves.toBe(false);
  });
});

describe('permission', () => {
  it('asks to write only, never to read', async () => {
    load();
    await health.requestHealthPermission();
    expect(hk.requestAuthorization).toHaveBeenCalledWith({
      toShare: [WORKOUT_TYPE, DISTANCE_TYPE],
    });
    expect(hk.requestAuthorization.mock.calls[0][0].toRead).toBeUndefined();
  });

  it('reports false when the runner refuses', async () => {
    load();
    hk.authorizationStatusFor.mockReturnValue(SHARING_DENIED);
    await expect(health.requestHealthPermission()).resolves.toBe(false);
  });
});

describe('writeWorkout', () => {
  it('writes nothing while the switch is off', async () => {
    load();
    await expect(health.writeWorkout(RUN)).resolves.toBe(false);
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
  });

  it('writes a running workout with distance once enabled', async () => {
    load();
    await health.setHealthEnabled(true);

    await expect(health.writeWorkout(RUN)).resolves.toBe(true);

    const [activity, samples, start, end, totals] = hk.saveWorkoutSample.mock.calls[0];
    expect(activity).toBe(hk.WorkoutActivityType.running);
    expect(start.getTime()).toBe(START);
    expect(end.getTime()).toBe(END);
    expect(totals).toEqual({ distance: 5433 });
    expect(samples).toEqual([
      {
        startDate: start,
        endDate: end,
        quantityType: DISTANCE_TYPE,
        quantity: 5433,
        unit: 'm',
      },
    ]);
  });

  it('still writes the workout when only the distance type is refused', async () => {
    load();
    await health.setHealthEnabled(true);
    hk.authorizationStatusFor.mockImplementation((t) =>
      t === DISTANCE_TYPE ? SHARING_DENIED : SHARING_AUTHORIZED
    );

    await expect(health.writeWorkout(RUN)).resolves.toBe(true);
    expect(hk.saveWorkoutSample.mock.calls[0][1]).toEqual([]);
    expect(hk.saveWorkoutSample.mock.calls[0][4]).toEqual({ distance: 5433 });
  });

  it('does not write when the workout type is not authorized', async () => {
    load();
    await health.setHealthEnabled(true);
    hk.authorizationStatusFor.mockReturnValue(SHARING_DENIED);

    await expect(health.writeWorkout(RUN)).resolves.toBe(false);
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
  });

  it('rejects a run that ends before it starts', async () => {
    load();
    await health.setHealthEnabled(true);

    await expect(health.writeWorkout({ ...RUN, endMs: START - 1 })).resolves.toBe(false);
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
  });

  it('swallows a HealthKit failure instead of throwing at the runner', async () => {
    load();
    await health.setHealthEnabled(true);
    hk.saveWorkoutSample.mockRejectedValue(new Error('HealthKit is busy'));

    await expect(health.writeWorkout(RUN)).resolves.toBe(false);
  });
});
