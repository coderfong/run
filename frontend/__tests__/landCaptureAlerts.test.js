import {
  isRecentNotification,
  landCaptureAlertKey,
  normaliseLandCaptureAlert,
} from '../src/utils/landCaptureAlerts';

describe('land capture alert normalisation', () => {
  it('turns an inbox item into animation and map context', () => {
    const alert = normaliseLandCaptureAlert({
      id: 'notification-1',
      category: 'stolen',
      body: 'RivalKai took 1,240 m² of your territory.',
      actor_id: 'kai',
      actor_username: 'RivalKai',
      actor_avatar: { hair: 'curtains' },
      data: {
        capture_id: 'run-1:me',
        taken_m2: 1240.4,
        lat: 1.3521,
        lon: 103.8198,
        territory_id: 'territory-42',
      },
    });

    expect(alert).toMatchObject({
      captureId: 'run-1:me',
      takenM2: 1240.4,
      lat: 1.3521,
      lon: 103.8198,
      territoryId: 'territory-42',
      attacker: {
        id: 'kai',
        username: 'RivalKai',
        avatar: { hair: 'curtains' },
      },
    });
    expect(landCaptureAlertKey(alert)).toBe('capture:run-1:me');
  });

  it('falls back to old notification copy without inventing a map point', () => {
    const alert = normaliseLandCaptureAlert({
      id: 'old-1',
      category: 'stolen',
      actor_username: 'DevRival',
      body: 'DevRival took 9,876 m² of your territory.',
    });

    expect(alert.takenM2).toBe(9876);
    expect(alert.lat).toBeNull();
    expect(alert.lon).toBeNull();
    expect(alert.territoryId).toBeNull();
  });

  it('reads territory_id off a foreground push the same way as an inbox item', () => {
    const alert = normaliseLandCaptureAlert({
      category: 'stolen',
      title: 'Your land was captured',
      body: 'NeonFox took your territory.',
      data: { attacker_username: 'NeonFox', territory_id: 'territory-9' },
    });
    expect(alert.territoryId).toBe('territory-9');
  });

  it('keeps a valid attacker ring and drops non-finite vertices', () => {
    const alert = normaliseLandCaptureAlert({
      category: 'stolen',
      actor_username: 'RivalKai',
      data: {
        territory_ring: [
          [103.8198, 1.3521],
          [103.8205, 1.3521],
          ['nope', 1.35],
          [103.8205, 1.3528],
          [103.8198, 1.3528],
        ],
      },
    });
    expect(alert.territoryRing).toEqual([
      [103.8198, 1.3521],
      [103.8205, 1.3521],
      [103.8205, 1.3528],
      [103.8198, 1.3528],
    ]);
  });

  it('drops a ring that is too short to be a shape', () => {
    const alert = normaliseLandCaptureAlert({
      category: 'stolen',
      actor_username: 'RivalKai',
      data: { territory_ring: [[103.8, 1.35], [103.81, 1.35]] },
    });
    expect(alert.territoryRing).toBeNull();
  });

  it('has a null ring when the payload omits one', () => {
    const alert = normaliseLandCaptureAlert({
      category: 'stolen',
      actor_username: 'RivalKai',
      data: { territory_id: 't-1' },
    });
    expect(alert.territoryRing).toBeNull();
  });

  it('reads the new km²-only notification copy back into square metres', () => {
    const alert = normaliseLandCaptureAlert({
      category: 'stolen',
      actor_username: 'NeonFox',
      body: 'NeonFox took 0.013 km² of your territory.',
    });
    expect(alert.takenM2).toBe(13000);
  });

  it('ignores other notification categories', () => {
    expect(normaliseLandCaptureAlert({ category: 'kudos' })).toBeNull();
  });

  it('only treats first-fetch notifications from this app session as live', () => {
    const now = Date.parse('2026-08-11T12:00:00Z');
    expect(
      isRecentNotification({ created_at: '2026-08-11T11:59:58Z' }, now - 3000, now)
    ).toBe(true);
    expect(
      isRecentNotification({ created_at: '2026-08-11T11:30:00Z' }, now - 3000, now)
    ).toBe(false);
  });
});
