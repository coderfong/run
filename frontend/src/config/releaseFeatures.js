// Store-facing release switches.
//
// Paid products stay off until a StoreKit client, product metadata, purchase
// restoration, and server-side transaction verification are all exercised in
// a sandbox build. The existing purchase sheets intentionally remain in the
// codebase for that work, but a release must not advertise buttons that cannot
// complete a real App Store transaction.
//
// Health sync is ON: the HealthKit module, entitlement, and write-only
// purpose string ship in the binary, and src/health.js writes a finished run
// as a running workout. It stays a per-runner opt-in switch in Settings and
// still degrades to a no-op anywhere Health is unavailable.
export const IAP_ENABLED = false;
export const HEALTH_SYNC_ENABLED = true;
