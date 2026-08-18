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
//   2. The product ids in config/pro.js and BuyEnergySheet.js registered in
//      App Store Connect and the Play Console, at the prices those files
//      assume until the store answers with the real ones. PASER PRO is an
//      AUTO RENEWABLE SUBSCRIPTION, and its two plans must be created in one
//      subscription group — across two groups, switching plan bills for both.
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
// Trail decorations on the share card — the things that sprout out of the
// route line (flowers, grass, mushrooms, trees; see
// components/share/trailDecorations.js and docs/SHARING.md). Built 2026-08-16
// and PARKED the same day: the card ships without the control, and nothing
// draws on the route.
//
// Kept whole rather than deleted, because it is wanted later. Everything it
// needs is behind this one switch: flip it true and the Trail row is back on
// the sheet with the decorations drawing on the card. The module, its tests and
// its documentation stay live either way, so it cannot rot in the meantime.
export const TRAIL_DECORATIONS_ENABLED = false;

export const IAP_ENABLED = false;

// Whether PASER PRO EXISTS in the app, as distinct from whether it can be sold.
//
// These were one switch, and conflating them turned out to be a real bug
// rather than a tidiness point. `IAP_ENABLED` is false until a sandbox
// purchase has been taken end to end, which is correct — but every PRO
// surface asked that same question before rendering, so with the store off the
// subscription was not merely unbuyable, it was INVISIBLE. No card on Home, no
// poster on You, no padlocks on the gated features, no sheet. The app looked
// like one that had never had a subscription, which made the whole feature
// impossible to look at, review, or judge, and made "I don't see PASER PRO
// anywhere" the accurate description of a build where all of it was written
// and wired.
//
// Split, each switch answers only its own question:
//
//   PRO_SURFACES_ENABLED  the marketing, the padlocks and the pitch are shown,
//                         and gated features actually behave as gated.
//   IAP_ENABLED           the subscribe button can complete a transaction.
//
// With surfaces on and the store off, the paywall opens and makes its case,
// and its primary button says so plainly instead of failing when pressed (see
// BuyProSheet). That is honest, and it is what a store reviewer should see if
// they reach it before the products are live.
//
// This does NOT weaken the release rule it came from. The rule is that a
// release must not advertise a button that cannot complete a real App Store
// transaction, and no such button exists in this state.
export const PRO_SURFACES_ENABLED = true;

export const HEALTH_SYNC_ENABLED = true;
