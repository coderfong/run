function finiteNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function areaFromBody(body) {
  if (typeof body !== 'string') return null;
  const match = body.replace(/,/g, '').match(/took\s+([\d.]+)\s*m²/i);
  return match ? finiteNumber(match[1]) : null;
}

/**
 * Normalise all three ways a land loss reaches the app:
 * - an inbox NotificationItem (`data` plus actor_* fields)
 * - an Expo foreground push (`data` plus title/body)
 * - the direct development scenario response
 */
export function normaliseLandCaptureAlert(raw) {
  if (!raw) return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const category = raw.category || data.category;
  if (category !== 'stolen') return null;

  const takenM2 =
    finiteNumber(raw.taken_m2) ??
    finiteNumber(data.taken_m2) ??
    areaFromBody(raw.body) ??
    0;
  const attackerId =
    raw.actor_id || raw.rival_id || raw.attacker_id || data.attacker_id || null;
  const attackerUsername =
    raw.actor_username ||
    raw.rival_username ||
    raw.attacker_username ||
    data.attacker_username ||
    'A rival runner';

  return {
    id: raw.id || null,
    captureId: raw.capture_id || data.capture_id || raw.id || null,
    category,
    title: raw.title || 'Your land was captured',
    body: raw.body || `${attackerUsername} took your territory.`,
    takenM2,
    lat: finiteNumber(raw.lat) ?? finiteNumber(data.lat),
    lon: finiteNumber(raw.lon) ?? finiteNumber(data.lon),
    createdAt: raw.created_at || raw.createdAt || new Date().toISOString(),
    attacker: {
      id: attackerId,
      username: attackerUsername,
      avatar:
        raw.actor_avatar || raw.rival_avatar || raw.attacker_avatar || data.attacker_avatar || {},
      rankKey: raw.actor_rank_key || data.attacker_rank_key || 'wood',
      clanColor: raw.actor_clan_color || data.attacker_clan_color || null,
    },
  };
}

export function landCaptureAlertKey(alert) {
  if (!alert) return null;
  if (alert.captureId) return `capture:${alert.captureId}`;
  if (alert.id) return `notification:${alert.id}`;
  return `semantic:${alert.attacker?.id || alert.attacker?.username || 'rival'}:${Math.round(
    alert.takenM2 || 0
  )}`;
}

export function isRecentNotification(item, sinceMs, nowMs = Date.now()) {
  const value = item?.created_at || item?.createdAt;
  if (!value) return false;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) && stamp >= sinceMs && stamp <= nowMs + 60_000;
}
