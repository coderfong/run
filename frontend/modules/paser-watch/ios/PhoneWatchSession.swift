import Foundation
import UserNotifications
import WatchConnectivity

/// The iPhone end of the link to the PASER watch app (targets/watch).
///
/// One per process, activated at launch by PaserWatchAppDelegateSubscriber so
/// that a message which wakes the app from the watch finds a delegate waiting.
///
/// It keeps the latest run state JavaScript published and serves it three
/// ways: as the application context (the system hands it to the watch app the
/// next time it opens), as a live message while the watch app is on screen,
/// and as the reply to any message the watch sends. The reply needs no
/// JavaScript at all, so a watch asking what is happening gets an answer even
/// while the JS thread is busy or has not started yet.
final class PhoneWatchSession: NSObject, WCSessionDelegate {
  static let shared = PhoneWatchSession()

  /// Hands a command from the watch (start, pause, resume, finish) to
  /// JavaScript, with the watch's send time in epoch milliseconds. Always
  /// called on the main queue. JavaScript decides whether to act on it
  /// (commandAllowed in src/watch/watchState.js); nothing here does.
  var onCommand: ((String, Double) -> Void)?

  private let lock = NSLock()

  /// Starts idle whatever the last context said: a run lives in JavaScript
  /// memory, so a process that has only just started cannot be in one, and a
  /// context left over from a crash must not show the wrist a phantom run.
  private var latest: [String: Any] = PhoneWatchSession.idleState()

  private static func idleState() -> [String: Any] {
    return ["v": 1, "phase": "idle", "seq": Date().timeIntervalSince1970 * 1000]
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState == .notActivated {
      session.activate()
    }
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  func status() -> [String: Bool] {
    guard WCSession.isSupported() else {
      return ["supported": false, "paired": false, "installed": false, "reachable": false]
    }
    let session = WCSession.default
    let active = session.activationState == .activated
    return [
      "supported": true,
      "paired": active && session.isPaired,
      "installed": active && session.isWatchAppInstalled,
      "reachable": active && session.isReachable,
    ]
  }

  func update(_ state: [String: Any]) {
    let clean = PhoneWatchSession.propertyListOnly(state)
    lock.lock()
    latest = clean
    lock.unlock()
    push(clean, live: true)
  }

  private func current() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return latest
  }

  private func push(_ state: [String: Any], live: Bool) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else {
      return
    }
    do {
      try session.updateApplicationContext(state)
    } catch {
      // Nothing to recover: the next update carries the whole state again.
    }
    if live && session.isReachable {
      session.sendMessage(state, replyHandler: nil, errorHandler: nil)
    }
  }

  /// WatchConnectivity refuses anything that is not a property list value, and
  /// one stray null would sink the whole update. Values are passed on exactly
  /// as they came; only the types that cannot travel are dropped.
  private static func propertyListOnly(_ state: [String: Any]) -> [String: Any] {
    var out: [String: Any] = [:]
    for (key, value) in state {
      if value is String || value is NSNumber || value is Bool || value is Int || value is Double {
        out[key] = value
      }
    }
    return out
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated else { return }
    push(current(), live: false)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // The runner switched to another watch. Activating again connects to it.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    // PASER was just installed on the watch, or the paired watch changed.
    guard session.activationState == .activated else { return }
    push(current(), live: false)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    replyHandler(current())
    forward(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    forward(message)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard userInfo["event"] as? String == "watchRunFinished" else { return }
    let distance = userInfo["distance"] as? String ?? "0.00"
    let time = userInfo["time"] as? String ?? ""
    let pace = userInfo["pace"] as? String ?? ""
    
    let content = UNMutableNotificationContent()
    content.title = "Run saved · \(distance) km"
    content.body = "Your route is ready. Open PASER to plan your attack."
    content.sound = .default
    // Include more data for proper routing
    content.userInfo = [
      "category": "watch_run_saved",
      "screen": "record",
      "distance": distance,
      "time": time,
      "pace": pace,
      "source": "watch"
    ]
    let request = UNNotificationRequest(
      identifier: "watch-run-\(UUID().uuidString)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request)
  }

  private func forward(_ message: [String: Any]) {
    guard let command = message["cmd"] as? String, command != "sync" else { return }
    let at = (message["at"] as? NSNumber)?.doubleValue ?? 0
    DispatchQueue.main.async { [weak self] in
      self?.onCommand?(command, at)
    }
  }
}
