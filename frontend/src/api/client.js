// Thin fetch wrapper for the Territory Run API.
// - Auth: Bearer token managed via setAuthToken().
// - Errors: throws ApiError with .status and .message; UI catches and toasts.
// - Base URL: from EXPO_PUBLIC_API_BASE if set, otherwise the dev tunnel.

import Constants from 'expo-constants';

const FALLBACK_BASE =
  'https://displayed-characterized-lucas-answering.trycloudflare.com';

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

  // ----- territories + leaderboard -------------------------------------
  mapPolygons: (bbox) => {
    const qs = bbox
      ? `?min_lon=${bbox.minLon}&min_lat=${bbox.minLat}&max_lon=${bbox.maxLon}&max_lat=${bbox.maxLat}`
      : '';
    return request(`/map-polygons${qs}`);
  },
  leaderboard: () => request('/leaderboard'),
};
