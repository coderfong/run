// One in-app event stream for every notification source. The root setup owns
// the single Expo listener and inbox poll; specialised UI (capture cutscene,
// Crossroads, successful-defense banner) subscribes here instead of each
// installing another global native listener.

const listeners = new Set();
const recentEventIds = new Map();
const DUPLICATE_TTL_MS = 60_000;

export function publishNotificationEvent(event) {
  if (!event || typeof event !== 'object') return;
  // During auth/startup the presentation hosts are not mounted yet. Do not
  // consume the id: the first inbox sync should still be able to present it.
  if (listeners.size === 0) return;
  const eventId = event.event_id || event.data?.event_id;
  if (eventId) {
    const now = Date.now();
    for (const [id, seenAt] of recentEventIds) {
      if (now - seenAt > DUPLICATE_TTL_MS) recentEventIds.delete(id);
    }
    if (recentEventIds.has(eventId)) return;
    recentEventIds.set(eventId, now);
  }
  listeners.forEach((listener) => listener(event));
}

export function subscribeNotificationEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
