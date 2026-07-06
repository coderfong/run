// Thin fetch wrapper for the Territory Run API.
// - Auth: Bearer token managed via setAuthToken().
// - Errors: throws ApiError with .status and .message; UI catches and toasts.
// - Base URL: from EXPO_PUBLIC_API_BASE if set, otherwise the dev tunnel.

import Constants from 'expo-constants';

const FALLBACK_BASE =
  'https://chargers-use-asylum-composed.trycloudflare.com';

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ||
  Constants?.expoConfig?.extra?.apiBase ||
  FALLBACK_BASE;

let _token = null;

export function setAuthToken(token) {
  _token = token || null;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch (e) {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) {
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      try {
        const text = await res.text();
        if (text) detail = text;
      } catch {}
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // ----- auth ----------------------------------------------------------
  signup: (username, password) =>
    request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  refresh: () => request('/auth/refresh', { method: 'POST', body: '{}' }),
  me: () => request('/me'),
  renameMe: (username) =>
    request('/me', { method: 'PATCH', body: JSON.stringify({ username }) }),
  deleteMe: () => request('/me', { method: 'DELETE' }),

  // ----- runs ----------------------------------------------------------
  startRun: () => request('/start-run', { method: 'POST', body: '{}' }),
  submitPath: (runId, points) =>
    request('/submit-path', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, points }),
    }),
  endRun: (runId, points, stepCount = null) =>
    request('/end-run', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, points, step_count: stepCount }),
    }),

  // ----- feed + profile stats ------------------------------------------
  feed: (cursor) =>
    request(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  meStats: () => request('/me/stats'),
  meRuns: () => request('/me/runs'),

  // ----- run detail + social -------------------------------------------
  runDetail: (runId) => request(`/runs/${runId}`),
  toggleKudos: (runId) => request(`/runs/${runId}/kudos`, { method: 'POST', body: '{}' }),
  registerPushToken: (token, platform) =>
    request('/me/push-token', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  getNotifPrefs: () => request('/me/notif-prefs'),
  setNotifPrefs: (prefs) => request('/me/notif-prefs', { method: 'PUT', body: JSON.stringify(prefs) }),
  notifications: () => request('/me/notifications'),
  markNotificationsRead: () => request('/me/notifications/read', { method: 'POST', body: '{}' }),
  requestJoin: (clanId) => request(`/clans/${clanId}/request`, { method: 'POST', body: '{}' }),
  listJoinRequests: (clanId) => request(`/clans/${clanId}/requests`),
  actOnJoinRequest: (clanId, reqId, action) =>
    request(`/clans/${clanId}/requests/${reqId}/${action}`, { method: 'POST', body: '{}' }),

  // ----- territories + leaderboard -------------------------------------
  // ----- clans ----------------------------------------------------------
  myClan: () => request('/me/clan'),
  createClan: (body) => request('/clans', { method: 'POST', body: JSON.stringify(body) }),
  getClan: (clanId) => request(`/clans/${clanId}`),
  searchClans: (q) => request(`/clans/search?q=${encodeURIComponent(q || '')}`),
  joinClan: (clanId) => request(`/clans/${clanId}/join`, { method: 'POST', body: '{}' }),
  joinByCode: (code) => request('/clans/join-by-code', { method: 'POST', body: JSON.stringify({ code }) }),
  leaveClan: () => request('/clans/leave', { method: 'POST', body: '{}' }),
  createInvite: (clanId) => request(`/clans/${clanId}/invites`, { method: 'POST', body: '{}' }),
  setClanRole: (clanId, userId, role) =>
    request(`/clans/${clanId}/members/${userId}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  kickMember: (clanId, userId) =>
    request(`/clans/${clanId}/members/${userId}/kick`, { method: 'POST', body: '{}' }),
  updateClan: (clanId, body) => request(`/clans/${clanId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  clanFeed: (clanId) => request(`/clans/${clanId}/feed`),
  clanLeaderboard: () => request('/leaderboard/clans'),

  mapPolygons: (bbox, zoom) => {
    const parts = [];
    if (bbox) {
      parts.push(
        `min_lon=${bbox.minLon}`,
        `min_lat=${bbox.minLat}`,
        `max_lon=${bbox.maxLon}`,
        `max_lat=${bbox.maxLat}`
      );
    }
    if (zoom != null) parts.push(`zoom=${zoom.toFixed(1)}`);
    const qs = parts.length ? `?${parts.join('&')}` : '';
    return request(`/map-polygons${qs}`);
  },
  leaderboard: () => request('/leaderboard'),
};
