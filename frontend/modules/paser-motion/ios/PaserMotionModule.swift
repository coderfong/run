import CoreMotion
import ExpoModulesCore

/// Core Motion activity history for the run-session classifier
/// (src/run/session/activityClassifier.js).
///
/// Query only, no live stream: Core Motion keeps seven days of history, so the
/// JavaScript side asks for the stretch it needs — the last couple of minutes
/// while the Run screen is open, the whole run when it finishes or is
/// recovered. That covers the time the app spent suspended in a pocket, which
/// a live subscription would have missed anyway.
///
/// Uses the same Motion & Fitness permission as the pedometer
/// (NSMotionUsageDescription in app.json). Without it, or on a device with no
/// motion coprocessor, every query answers an empty list rather than failing:
/// the classifier treats a missing signal as no evidence, never as evidence.
public class PaserMotionModule: Module {
  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let q = OperationQueue()
    q.name = "PaserMotion"
    q.maxConcurrentOperationCount = 1
    return q
  }()

  public func definition() -> ModuleDefinition {
    Name("PaserMotion")

    Function("isAvailable") { () -> Bool in
      return CMMotionActivityManager.isActivityAvailable()
    }

    Function("authorizationStatus") { () -> String in
      switch CMMotionActivityManager.authorizationStatus() {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unknown"
      }
    }

    /// [{ t: epoch ms, kind, conf: 0 low | 1 medium | 2 high }], oldest first.
    AsyncFunction("queryActivities") { (fromMs: Double, toMs: Double, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable(), toMs > fromMs else {
        promise.resolve([])
        return
      }
      let from = Date(timeIntervalSince1970: fromMs / 1000)
      let to = Date(timeIntervalSince1970: toMs / 1000)
      self.manager.queryActivityStarting(from: from, to: to, to: self.queue) { activities, error in
        guard error == nil, let activities = activities else {
          promise.resolve([])
          return
        }
        let rows: [[String: Any]] = activities.map { a in
          [
            "t": a.startDate.timeIntervalSince1970 * 1000,
            "kind": PaserMotionModule.kind(of: a),
            "conf": a.confidence.rawValue,
          ]
        }
        promise.resolve(rows)
      }
    }
  }

  /// One label per reading. Core Motion can set several flags at once (a car
  /// stopped at lights is automotive AND stationary); the more specific
  /// movement wins, because that is what the run needs to know.
  private static func kind(of a: CMMotionActivity) -> String {
    if a.automotive { return "automotive" }
    if a.cycling { return "cycling" }
    if a.running { return "running" }
    if a.walking { return "walking" }
    if a.stationary { return "stationary" }
    return "unknown"
  }
}
