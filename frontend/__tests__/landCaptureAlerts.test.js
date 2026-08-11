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
      },
    });

    expect(alert).toMatchObject({
      captureId: 'run-1:me',
      takenM2: 1240.4,
      lat: 1.3521,
      lon: 103.8198,
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
