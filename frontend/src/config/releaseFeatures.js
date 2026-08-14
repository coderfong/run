// Store-facing release switches.
//
// Paid products stay off until this has been exercised in a sandbox build.
// The client and server sides are now both actually wired — src/iap.js talks
// to the store through expo-iap, and the backend verifies what it hands back
// (app/iap.py: StoreKit 2's signed transaction locally against Apple's own
// root certificate, Play Billing tokens against the Android Publisher API).
// What is still outside this repo, and has to happen before this flips on:
//   1. A fresh dev-client / EAS build — expo-iap is a new native module,
//      Fast Refresh will not pick it up and Expo Go can't run it at all.
//   2. The product ids in BuyPassSheet.js / BuyEnergySheet.js registered in
//      App Store Connect and the Play Console, at the prices those files
//      assume until the store answers with the real ones.
//   3. Two settings only the app owner can produce, both on the backend
//      (Render env vars, not anything in this repo): `apple_app_apple_id`
//      (App Store Connect → App Information → Apple ID — needed only for
//      PRODUCTION verification; sandbox works without it) and
//      `google_play_access_token` + `android_package` for Android. Then
//      `iap_verify_receipts=true`, or every purchase call still grants for
//      free — see the warning on that setting in app/config.py.
// A release must not advertise buttons that cannot complete a real App Store
// transaction, so this stays false until all three are done and a sandbox
// purchase has actually been taken through the flow once.
//
// Health sync is ON: the HealthKit module, entitlement, and write-only
// purpose string ship in the binary, and src/health.js writes a finished run
// as a running workout. It stays a per-runner opt-in switch in Settings and
// still degrades to a no-op anywhere Health is unavailable.
export const IAP_ENABLED = false;
export const HEALTH_SYNC_ENABLED = true;
