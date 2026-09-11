# Apple Watch submission review

Checked 2026-09-11. This is a source audit, not App Review approval. The audit
does not establish that a signed archive compiles or that all store metadata
and production services pass review. Existing unrelated workspace changes were
preserved.

## Changes made

- Imported Combine explicitly for the Watch ObservableObject and Published properties.
- Replaced keeping GPS alive after Finish with a bounded UIKit background task,
  released on completion or expiration. Location stops before the upload.
- Captured workout times at Finish and kept them through retries, so upload
  latency does not become Apple Health workout time.
- Corrected the submission pack's false assertion that production Sentry is off.
  Added companion behavior and Sentry disclosures to local privacy documents.
- Added safe-fallback and failure tests for the background-save bridge.

## Source findings

Validation: all 79 Jest suites passed (1,170 tests), including the watch bridge,
protocol, pause windows and Health sync tests. The source scans found no
use-before-declaration or undefined references across 277 files. Expo prebuild
configuration resolved the Watch signing target. Swift compilation, archive
validation and device behavior remain unverified.

The watch declares WKApplication and does not run independently of its iPhone.
The installed apple-targets plugin generates WKCompanionAppBundleIdentifier,
syncs the marketing version, and registers the watch signing target. Expo config
resolves com.pacerrun.app.watchkitapp as PaserWatch. The companion requests no
HealthKit, location, microphone or tracking permissions and has no ad SDK,
purchase UI, or direct network client. These findings do not replace inspection
of the final archived app and its embedded frameworks/privacy manifests.

The watch is a remote display/controller; the phone must remain nearby. Starting
requires Record in the foreground on iPhone. It does not independently record
workouts or heart rate. Without a Watch workout session, continuous foreground
display and background haptics are not guaranteed; do not advertise them.

## Release gates still requiring evidence

- Build and validate a fresh signed production archive with Xcode 26+ and
  iOS/watchOS 26+ SDKs. Expo SDK 54 defaults to Xcode 26, but verify the build log.
  Check watch embedding, icon, companion ID, matching version/build numbers,
  provisioning and the archived privacy report. Windows cannot compile Apple SDKs.
- Run the paired-device checklist in APPLE_WATCH.md, including phone locked,
  pause/resume, disconnection/reconnection, app termination/relaunch, failed
  upload, expiration of background save time, permission denial, and recovery
  of an unfinished run. Verify run distance and Health duration after pauses.
- Specifically test the paused location session: it remains enabled to allow
  wrist resume and buffers fixes locally until they are discarded on merge.
  Check battery use and privacy behavior during long pauses. Apple's 2.5.4
  background-purpose review remains a risk; do not represent pauses as GPS off.
- Test the smallest supported Watch screen, large text, VoiceOver, hold-to-finish
  and its accessibility action, and Always On. Native UI was not rendered here.
- Capture genuine Watch screenshots and upload them in App Store Connect using
  an accepted size consistently across localizations. Include the iPhone
  dependency in the description and review notes; supply working review access.
- Publish the updated privacy policy and verify the public version. Local edits
  have not been deployed. The live policy was checked and still describes
  diagnostics as anonymous crash reports with no Sentry provider disclosure.
  Declare Crash Data and Performance Data for Sentry,
  and inspect actual release payloads to determine linkage/additional data types.
  Reconcile the complete app's privacy label, photos, purchases and SDK report.
- Complete the existing APP_STORE.md gates: sign-in/account deletion, UGC
  reporting/blocking, IAP review and restore, age questionnaire, support URL,
  export declarations, and Health opt-in. No App Store Connect state was changed
  or verified in this audit.

## Suggested additional review notes

PASER on Apple Watch requires the paired iPhone nearby. Sign in on iPhone and
open Record in the foreground, then open PASER on the watch and tap Start run.
The phone records GPS; the watch displays the run and offers pause, resume and
hold-to-finish controls. During a paused run the iPhone location session may
remain active to support wrist resume; paused points are excluded from the
route. Finish stops location and requests limited background time to save.
If saving fails, open PASER on iPhone to retry. Land placement is on iPhone.
The watch does not access HealthKit or independently record GPS/heart rate.
It follows the system Return to Clock behavior.

## Sources

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), especially 2.1, 2.3, 2.5.4, 2.5.18 and 5.1.
- [Apple SDK submission requirements](https://developer.apple.com/news/upcoming-requirements/).
- [Expo SDK 26 build guidance](https://expo.dev/blog/app-store-connect-minimum-sdk-26).
- [WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity).
- [UIKit background execution](https://developer.apple.com/documentation/uikit/uiapplication/beginbackgroundtask(expirationhandler:)).
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).
- [HealthKit privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy).
