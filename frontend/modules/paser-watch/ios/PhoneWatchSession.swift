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

  // MARK: The runner's portrait

  /// Which portrait this phone holds. Kept here rather than in JavaScript so
  /// that a watch asking for it gets an answer whatever the app is doing: the
  /// ask can arrive while PASER is asleep in a pocket and the JS thread does
  /// not exist.
  private static let avatarKeyDefault = "paserWatchAvatarKey"
  private static let avatarPrefix = "paserAvatar_"

  private var avatarDirectory: URL? {
    guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { return nil }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  /// Every look gets its own file. WatchConnectivity reads the file it was
  /// handed on its own schedule, and asks that it not be modified until the
  /// transfer finishes, so a runner trying on five hats in ten seconds must
  /// not be writing each new portrait over the one still going out.
  private func avatarFile(for key: String) -> URL? {
    avatarDirectory?.appendingPathComponent("\(PhoneWatchSession.avatarPrefix)\(key).png")
  }

  /// Queues the portrait for the watch. Returns whether the system took it.
  func sendAvatar(base64: String, key: String) -> Bool {
    guard let data = Data(base64Encoded: base64), !data.isEmpty,
          !key.isEmpty, let file = avatarFile(for: key)
    else { return false }
    // Superseded first: nobody is wearing the look that was going out, and
    // its file is only safe to delete once its transfer has been called off.
    cancelAvatarTransfers()
    do {
      try data.write(to: file, options: .atomic)
    } catch {
      return false
    }
    discardAvatars(except: key)
    UserDefaults.standard.set(key, forKey: PhoneWatchSession.avatarKeyDefault)
    return transferAvatar(key: key)
  }

  private func cancelAvatarTransfers() {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    let superseded = WCSession.default.outstandingFileTransfers.filter {
      $0.file.metadata?["kind"] as? String == "avatar"
    }
    superseded.forEach { $0.cancel() }
  }

  private func discardAvatars(except key: String) {
    guard let directory = avatarDirectory,
          let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path)
    else { return }
    let keep = "\(PhoneWatchSession.avatarPrefix)\(key).png"
    for name in names where name.hasPrefix(PhoneWatchSession.avatarPrefix) && name != keep {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }
  }

  private func transferAvatar(key: String) -> Bool {
    guard WCSession.isSupported(), !key.isEmpty, let file = avatarFile(for: key) else { return false }
    guard FileManager.default.fileExists(atPath: file.path) else { return false }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else {
      // Not a failure to retry: there is nowhere to send it yet. The watch
      // asks for the portrait itself once PASER is installed on it.
      return false
    }
    session.transferFile(file, metadata: ["kind": "avatar", "key": key])
    return true
  }

  /// The portrait this phone holds, or empty on a phone that has never drawn
  /// one (nobody has opened PASER since the watch app was installed).
  private var storedAvatarKey: String {
    UserDefaults.standard.string(forKey: PhoneWatchSession.avatarKeyDefault) ?? ""
  }

  /// A watch with no portrait, or the wrong one, asks for it by name.
  private func answerAvatarRequest(_ message: [String: Any]) {
    let have = message["have"] as? String ?? ""
    let key = storedAvatarKey
    guard !key.isEmpty, key != have else { return }
    _ = transferAvatar(key: key)
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
    // A new watch has never seen the portrait, and one that has just had PASER
    // installed had nowhere to keep it. Either way it starts with no face.
    _ = transferAvatar(key: storedAvatarKey)
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
    guard let command = message["cmd"] as? String else { return }
    // Asking for something is not a command to run. `sync` is answered by the
    // reply handler above, `avatar` here, and neither is anything JavaScript
    // should see as a press on the Run screen.
    if command == "avatar" {
      answerAvatarRequest(message)
      return
    }
    guard command != "sync" else { return }
    let at = (message["at"] as? NSNumber)?.doubleValue ?? 0
    DispatchQueue.main.async { [weak self] in
      self?.onCommand?(command, at)
    }
  }
}
