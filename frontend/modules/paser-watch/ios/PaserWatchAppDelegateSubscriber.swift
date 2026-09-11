import ExpoModulesCore

/// Activates the watch session as the app launches. A message from the watch
/// can be what launched the app, and it is only delivered to a session that
/// has a delegate, so this cannot wait for JavaScript to load the module.
public class PaserWatchAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PhoneWatchSession.shared.activate()
    return true
  }
}
