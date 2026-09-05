// Where a notification takes you when you tap it.
//
// Every push the backend sends now carries `data.screen` (see
// backend/app/notifications.py call sites) plus whatever that screen needs to
// land on the right thing — a run id, a map point, a user id. This is the one
// place that turns that payload into a navigation action, used by BOTH the
// warm tap listener and the cold-start handler (src/notifications/setup.js)
// and by a tapped row in the inbox (screens/NotificationsScreen.js), so a
// capture opens the same place however the runner got to it.
//
// It is deliberately total: an unknown or missing screen falls back to the
// inbox rather than doing nothing, because a tap that goes nowhere reads as a
// broken notification.

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The attacker's ring, [[lon,lat], …], when the capture carried one — lets the
// map fit the exact ground instead of just centring on a point.
function ringFrom(data) {
  const ring = data?.territory_ring;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const cleaned = ring
    .map((pt) =>
      Array.isArray(pt) && finite(pt[0]) != null && finite(pt[1]) != null
        ? [Number(pt[0]), Number(pt[1])]
        : null
    )
    .filter(Boolean);
  return cleaned.length >= 3 ? cleaned : null;
}

function mapFocus(data) {
  const lat = finite(data?.lat);
  const lon = finite(data?.lon);
  const ring = ringFrom(data);
  if (lat != null && lon != null) return { focus: { lat, lon, ring } };
  if (ring) return { focus: { ring } };
  return undefined;
}

function tab(screen, params) {
  return ['Tabs', { screen, params }];
}

// data.screen → [rootRouteName, params] for navigationRef.navigate(...).
// `initial: false` on a nested screen keeps the tab's root underneath, so the
// back button returns there instead of dead-ending the tab.
export function targetForNotification(data) {
  const d = data && typeof data === 'object' ? data : {};
  const screen = d.screen || screenFromCategory(d.category);

  switch (screen) {
    case 'map':
      return tab('Map', { screen: 'MapMain', params: mapFocus(d) });
    case 'run': {
      const runId = d.run_id || d.runId || null;
      if (!runId) return inbox();
      return tab('Home', {
        screen: 'RunDetail',
        params: { runId, focusComments: d.kind === 'run_comment' },
        initial: false,
      });
    }
    case 'club':
      return tab('Club', { screen: 'ClubMain' });
    case 'pasers':
      return tab('You', { screen: 'Pasers', initial: false });
    case 'crossroads':
      return tab('Home', { screen: 'Crossroads', initial: false });
    case 'season':
      return tab('Home', { screen: 'Season', initial: false });
    case 'home':
      return tab('Home', { screen: 'HomeMain' });
    case 'record':
      return ['Record'];
    default:
      return inbox();
  }
}

function inbox() {
  return tab('Home', { screen: 'Notifications', initial: false });
}

// Older payloads (before every call site set `screen`) still route by category.
function screenFromCategory(category) {
  switch (category) {
    case 'stolen':
    case 'defended':
    case 'captured':
      return 'map';
    case 'clan_goal':
      return 'club';
    case 'pasers':
      return 'pasers';
    case 'paserby':
      return 'crossroads';
    case 'season':
      return 'season';
    case 'recap':
      return 'home';
    case 'reminder':
      return 'record';
    default:
      return null;
  }
}

/**
 * Navigate to wherever `data` points. Safe to call before the tree is ready —
 * it no-ops until the ref reports it can navigate, and the caller retries.
 * Returns true once it actually navigated.
 */
export function routeNotification(navigationRef, data) {
  if (!navigationRef?.isReady?.()) return false;
  const [route, params] = targetForNotification(data);
  navigationRef.navigate(route, params);
  return true;
}
