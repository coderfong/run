// The PASER Apple Watch app: a SwiftUI companion that mirrors the run the
// iPhone is recording and carries its start, pause, resume and finish
// controls. See docs/APPLE_WATCH.md.
//
// @bacons/apple-targets turns this folder into a watchOS target at prebuild
// (every file in it joins the target), embeds it in the iOS app, syncs its
// marketing version to app.json's, and lists it under
// extra.eas.build.experimental.ios.appExtensions so EAS signs it.
//
// Info.plist beside this file is hand kept and merged over what Xcode
// generates: WKApplication marks a single target SwiftUI watch app, and
// WKRunsIndependentlyOfCompanionApp false says it needs PASER on the iPhone,
// which is true (the phone does all the recording).

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
  // watchOS 10 runs on Series 4 and later. Nothing in the app needs newer.
  deploymentTarget: '10.0',
  icon: '../../assets/icon.png',
};
