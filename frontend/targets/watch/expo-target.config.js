// PASER's standalone watch workout app. It records outdoor runs using the
// watch's GPS and HealthKit even when the iPhone is not nearby.
//
// @bacons/apple-targets turns this folder into a watchOS target at prebuild
// (every file in it joins the target), embeds it in the iOS app, syncs its
// marketing version to app.json's, and lists it under
// extra.eas.build.experimental.ios.appExtensions so EAS signs it.
//
// Info.plist beside this file is hand kept and merged over what Xcode
// generates: WKApplication marks a single target SwiftUI watch app, and the
// independent flag plus HealthKit entitlement enable wrist only recording.

/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  // Target and product name inside Xcode. Never shown to anyone.
  name: 'PaserWatch',
  // The name under the icon on the watch.
  displayName: 'PASER',
  // Xcode's convention for a companion watch app, and the App ID EAS
  // provisions. Changing it later means a new App ID and a new profile.
  bundleIdentifier: '.watchkitapp',
  // Keep the companion available to watches that cannot update to watchOS 10.
  // The UI intentionally stays within watchOS 9 APIs.
  deploymentTarget: '9.0',
  entitlements: {
    'com.apple.developer.healthkit': true,
  },
  icon: '../../assets/icon.png',
};
