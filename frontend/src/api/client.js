// Thin fetch wrapper for the PACER API.
// - Auth: Bearer token managed via setAuthToken().
// - Errors: throws ApiError with .status and .message; UI catches and toasts.
// - Base URL: from EXPO_PUBLIC_API_BASE if set, otherwise the dev tunnel.

import Constants from 'expo-constants';

// Last-resort default when no EXPO_PUBLIC_API_BASE / extra.apiBase is set —
// the deployed Render backend. Dev overrides this via .env; prod via eas.json.
const FALLBACK_BASE = 'https://run-mdlv.onrender.com';

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

// A socket that never answers used to hang a request forever — on the launch
// path that meant the loading mascot stayed on screen until the OS gave up.
// Every call now has a ceiling; pass `timeoutMs` to tighten or widen it.
const DEFAULT_TIMEOUT_MS = 20000;

async function request(path, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = opts;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const controller = init.signal ? null : new AbortController();
  const timer = controller && timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      ...(controller ? { signal: controller.signal } : null),
    });
  } catch (e) {
    throw new ApiError(
      0,
      e?.name === 'AbortError'
        ? 'The server took too long to respond.'
        : "Can't reach the server. Check your connection."
    );
  } finally {
    if (timer) clearTimeout(timer);
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
  signup: (username, password, email) =>
    request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, email: email || null }),
    }),
  login: (username, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  refresh: () => request('/auth/refresh', { method: 'POST', body: '{}' }),
  // OAuth: send the provider's identity token; backend verifies it and returns
  // our own access token (find-or-create the user). provider = 'google'|'apple'.
  oauthLogin: (provider, idToken, extra = {}) =>
    request(`/auth/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, ...extra }),
    }),
  // ----- account recovery ------------------------------------------------
  // Three calls, and the client holds the mailed code only long enough to
  // trade it for a ticket. `sent: false` is a normal answer, not an error: it
  // carries the reason (no recovery email on the account, or the account signs
  // in with Google or Apple) so the screen can say what to do instead.
  forgotPassword: (username) =>
    request('/auth/forgot', { method: 'POST', body: JSON.stringify({ username }) }),
  verifyResetCode: (username, code) =>
    request('/auth/verify-reset-code', {
      method: 'POST',
      body: JSON.stringify({ username, code }),
    }),
  // Resolves to the same shape as login: the runner is signed straight in
  // rather than sent back to type the password they just chose.
  resetPassword: (ticket, password) =>
    request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ ticket, password }),
    }),

  // The recovery address (owner only). `can_recover` is the field the profile
  // acts on: false means this account has no way back in if the password goes.
  recovery: () => request('/me/recovery'),
  setRecoveryEmail: (email, currentPassword) =>
    request('/me/recovery/email', {
      method: 'PUT',
      body: JSON.stringify({ email, current_password: currentPassword || null }),
    }),
  verifyRecoveryEmail: (code) =>
    request('/me/recovery/email/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  resendRecoveryCode: () =>
    request('/me/recovery/email/resend', { method: 'POST', body: '{}' }),
  clearRecoveryEmail: (currentPassword) =>
    request('/me/recovery/email', {
      method: 'DELETE',
      body: JSON.stringify({ current_password: currentPassword || null }),
    }),

  me: (opts) => request('/me', opts),
  renameMe: (username) =>
    request('/me', { method: 'PATCH', body: JSON.stringify({ username }) }),
  deleteMe: () => request('/me', { method: 'DELETE' }),
  setAvatar: (avatar) => request('/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar }) }),
  runDays: () => request('/me/run-days'),

  // ----- runs ----------------------------------------------------------
  // `startedAtMs` backdates the run. A real run never passes it — the server
  // clocks the start itself, and duration is measured from that row rather than
  // from anything the client claims. It exists for the dev run simulator, whose
  // trace covers half an hour in the instant it takes to submit.
  //
  // The Z is stripped deliberately. Run timestamps are naive UTC server-side
  // (the column carries no timezone, and durations are taken against utcnow),
  // so an offset-aware value would land in a column with nowhere to put it.
  startRun: (startedAtMs = null) =>
    request('/start-run', {
      method: 'POST',
      body: JSON.stringify(
        startedAtMs
          ? { started_at: new Date(startedAtMs).toISOString().replace('Z', '') }
          : {}
      ),
    }),
  submitPath: (runId, points) =>
    request('/submit-path', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, points }),
    }),
  // A finished run is unrecoverable if this call is abandoned, and the payload
  // (every GPS point) is the heaviest we send — so it gets a far longer
  // ceiling than the default.
  endRun: (runId, points, stepCount = null, simulated = false) =>
    request('/end-run', {
      method: 'POST',
      timeoutMs: 60000,
      body: JSON.stringify({ run_id: runId, points, step_count: stepCount, simulated }),
    }),
  // The run's one claim shape and where it can go: `base_ring` / `base_centre`
  // / `base_t` / `route` are what the client transforms locally to draw any
  // pose, and `placements` is a coarse sample of the space, there to seed the
  // first breakdown and back the one-tap recommendations.
  claimOptions: (runId) => request(`/runs/${runId}/claim-options`),
  // What an arbitrary pose would take. Position and heading are continuous, so
  // there is no cell to read a breakdown out of once the claim has been
  // dragged between two samples — this prices the exact pose. Debounced by the
  // caller: the picture on the map is already local and correct, and only the
  // numbers are worth a round trip.
  claimPreview: (runId, t, rotationDeg) =>
    request(`/runs/${runId}/claim-preview`, {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, t, rotation_deg: rotationDeg }),
    }),
  // The territory is grown around the run's own route, server-side, so only
  // the POSE travels: `t` (where along the route its centre sits) and
  // `rotationDeg` (which way it faces). The server rebuilds the shape from the
  // stored route and moves it rigidly, so a pose can only ever describe a
  // claim along the run that earned it. Omitting them claims it where it was
  // run, unturned.
  claimTerritory: (runId, t = null, rotationDeg = null) =>
    request('/claim-territory', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, t, rotation_deg: rotationDeg }),
    }),
  // Allowlisted development scenarios. The server applies the same account
  // gate as the run simulator and returns 404 for every ordinary account.
  devSeedRivalForRun: (runId) =>
    request(`/dev/runs/${runId}/seed-rival`, { method: 'POST', body: '{}' }),
  devRivalTakesMine: () =>
    request('/dev/rival-takes-mine', { method: 'POST', body: '{}' }),

  // ----- feed + profile stats ------------------------------------------
  feed: (cursor) =>
    request(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  meStats: () => request('/me/stats'),
  meRuns: () => request('/me/runs'),

  // ----- run detail + social -------------------------------------------
  runDetail: (runId) => request(`/runs/${runId}`),
  updateRunPost: (runId, caption, media) =>
    request(`/runs/${runId}/post`, {
      method: 'PUT',
      timeoutMs: 60000,
      body: JSON.stringify({ caption: caption || null, media: media || [] }),
    }),
  toggleKudos: (runId) => request(`/runs/${runId}/kudos`, { method: 'POST', body: '{}' }),
  runComments: (runId) => request(`/runs/${runId}/comments`),
  // Comments are text. Emoji live in the run-reaction endpoint so reactions
  // and discussion remain distinct controls.
  addRunComment: (runId, body) =>
    request(`/runs/${runId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  runReactions: (runId) => request(`/runs/${runId}/reactions`),
  // One reaction per person per run: this SETS yours. Passing the emote you
  // already left, or null, takes it back off. Both directions come back as the
  // whole summary, so a caller never has to reconcile counts by hand.
  setRunReaction: (runId, emote) =>
    request(`/runs/${runId}/reactions`, { method: 'POST', body: JSON.stringify({ emote: emote || null }) }),
  clanMessages: (clanId, before) =>
    request(`/clans/${clanId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  sendClanMessage: (clanId, body) =>
    request(`/clans/${clanId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  registerPushToken: (token, platform) =>
    request('/me/push-token', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  // ----- progression + energy ------------------------------------------
  progression: () => request('/me/progression'),
  energyStatus: () => request('/me/energy'),
  openLootbox: () => request('/me/lootbox/open', { method: 'POST', body: '{}' }),
  addUnlock: (itemId) =>
    request('/me/unlocks', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }),
  purchaseEnergy: (productId, receipt, platform) =>
    request('/me/energy/purchase', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, receipt, platform }),
    }),
  claimReward: (level, track) =>
    request('/me/rewards/claim', { method: 'POST', body: JSON.stringify({ level, track }) }),
  // Sweeps every unlocked, unclaimed tier server-side — a returning player can
  // have eighty of them, and eighty round trips is not a reward.
  claimAllRewards: () => request('/me/rewards/claim-all', { method: 'POST', timeoutMs: 60000 }),
  purchasePass: (receipt, platform) =>
    request('/me/pass/purchase', {
      method: 'POST',
      body: JSON.stringify({ product_id: 'premium_pass', receipt, platform }),
    }),

  // Standings by rank points (the competitive board) rather than land held.
  rankLeaderboard: (limit = 50) => request(`/leaderboard/ranks?limit=${limit}`),

  // ----- coin shop -------------------------------------------------------
  // The catalogue (prices, owned flags) is SERVER-side; never price locally.
  shop: () => request('/me/coins'),
  purchaseCoins: (productId, receipt, platform) =>
    request('/me/coins/purchase', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, receipt, platform }),
    }),
  buyCosmetic: (itemId) =>
    request('/me/coins/buy', { method: 'POST', body: JSON.stringify({ item_id: itemId }) }),

  // ----- pasers (mutual friends) ---------------------------------------
  // Every mutation returns the other runner's card with a fresh `state`, so
  // callers can swap the button straight from the response.
  pasers: () => request('/pasers'),
  searchPasers: (q) => request(`/pasers/search?q=${encodeURIComponent(q)}`),
  addPaser: (userId) =>
    request('/pasers/requests', { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  respondToPaser: (linkId, action) =>
    request(`/pasers/requests/${linkId}/${action}`, { method: 'POST', body: '{}' }),
  removePaser: (userId) => request(`/pasers/${userId}`, { method: 'DELETE' }),

  // ----- PASERBY (crossed paths) ---------------------------------------
  // Nothing these return carries a coordinate, a route or a time — an
  // encounter is a person, a character and a broad phrase ("Earlier today").
  // Paged by offset rather than by a cursor for exactly that reason: a cursor
  // would have to be the moment the two runners crossed.
  paserby: () => request('/me/paserby'),
  setPaserby: (enabled) =>
    request('/me/paserby', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  crossroads: (limit = 50, offset = 0) =>
    request(`/me/paserby/encounters?limit=${limit}&offset=${offset}`),
  // The post-run beat. Forces the match server-side if the background task
  // hasn't got there yet, so the reveal is never empty by a race.
  paserbyReveal: (runId) => request(`/me/paserby/reveal/${runId}`),
  markPaserbySeen: (ids) =>
    request('/me/paserby/seen', { method: 'POST', body: JSON.stringify({ ids: ids || [] }) }),
  highFive: (encounterId) =>
    request(`/me/paserby/encounters/${encounterId}/high-five`, { method: 'POST', body: '{}' }),
  hideEncounter: (encounterId) =>
    request(`/me/paserby/encounters/${encounterId}/hide`, { method: 'POST', body: '{}' }),

  // ----- blocking + reporting (general, used by Crossroads) -------------
  blockUser: (userId) =>
    request('/me/blocks', { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  unblockUser: (userId) => request(`/me/blocks/${userId}`, { method: 'DELETE' }),
  reportUser: (userId, reason, detail, encounterId) =>
    request('/me/reports', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        reason,
        detail: detail || null,
        encounter_id: encounterId || null,
      }),
    }),

  // ----- rivalries (head-to-head land history) --------------------------
  // Cards are always phrased from the caller's side: `you_took_m2` is land
  // YOU took from them. Ordered by most recent beat, not biggest score.
  rivals: (limit = 25) => request(`/me/rivals?limit=${limit}`),
  rivalDetail: (userId) => request(`/me/rivals/${userId}`),
  runnerProfile: (userId) => request(`/users/${userId}/profile`),

  // ----- route privacy ---------------------------------------------------
  // What of your runs other people can see. The server applies these; the
  // client only displays and edits them, and never sees another runner's.
  // Age decides the FLOOR on route privacy, and only the server can enforce a
  // floor — so the birthday onboarding collects is mirrored here.
  setBirthday: (birthday) =>
    request('/me/birthday', { method: 'PUT', body: JSON.stringify({ birthday }) }),
  privacy: () => request('/me/privacy'),
  setPrivacy: (body) => request('/me/privacy', { method: 'PUT', body: JSON.stringify(body) }),
  setRunVisibility: (runId, visibility) =>
    request(`/runs/${runId}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ visibility }),
    }),

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
  seasonLeaderboard: (scope = 'clans', category = 'land') =>
    request(`/leaderboard/season?scope=${encodeURIComponent(scope)}&category=${encodeURIComponent(category)}`),

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
  leaderboard: (opts) => request(`/leaderboard${opts?.solo ? '?solo=true' : ''}`),
};
