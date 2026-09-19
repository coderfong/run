import SwiftUI

/// Where the run on the phone is. Mirrors PHASE in src/watch/watchState.js
/// (__tests__/watchProtocol.test.js keeps the two lists equal).
enum RunPhase: String {
    case idle
    case ready
    case countdown
    case running
    case paused
    case saving
    case saved
    case unsaved
}

/// What the watch can ask the phone to do. The phone checks every one against
/// its own state before acting on it (commandAllowed in watchState.js).
enum RunCommand: String {
    case start
    case pause
    case resume
    case finish
}

/// One snapshot of the phone's run screen. The phone formats every value
/// before sending it, so the wrist and the phone can never show two different
/// numbers for the same run.
struct RunState: Equatable {
    static let protocolVersion = 1
    /// The app's placeholder for a value it does not have yet (U+00B7).
    static let empty = "\u{00B7}"

    var seq: Double = 0
    var phase: RunPhase = .idle
    var elapsedS: Double = 0
    var distance = "0.00"
    var pace = RunState.empty
    var land = RunState.empty
    var gps = "none"
    var hint = ""
    var accentHex = "#ec4899"
    var km = 0
    var qualified = false
    var countdown = ""
    var notice = ""
    var summaryDistance = ""
    var summaryTime = ""
    var avatarData: String? // Base64 encoded avatar image data

    init() {}

    /// Nil for anything that is not a state in the protocol version this watch
    /// speaks, so a newer phone can never put half understood values on screen.
    init?(_ dict: [String: Any]) {
        guard (dict["v"] as? NSNumber)?.intValue == RunState.protocolVersion,
              let raw = dict["phase"] as? String,
              let phase = RunPhase(rawValue: raw)
        else { return nil }
        self.phase = phase
        seq = (dict["seq"] as? NSNumber)?.doubleValue ?? 0
        elapsedS = (dict["elapsedS"] as? NSNumber)?.doubleValue ?? 0
        distance = (dict["distance"] as? String) ?? distance
        pace = (dict["pace"] as? String) ?? pace
        land = (dict["land"] as? String) ?? land
        gps = (dict["gps"] as? String) ?? gps
        hint = (dict["hint"] as? String) ?? hint
        accentHex = (dict["accent"] as? String) ?? accentHex
        km = (dict["km"] as? NSNumber)?.intValue ?? 0
        qualified = (dict["qualified"] as? NSNumber)?.boolValue ?? false
        countdown = (dict["countdown"] as? String) ?? countdown
        notice = (dict["notice"] as? String) ?? notice
        summaryDistance = (dict["summaryDistance"] as? String) ?? summaryDistance
        summaryTime = (dict["summaryTime"] as? String) ?? summaryTime
        avatarData = dict["avatarData"] as? String
    }

    var accent: Color {
        Color(hex: accentHex) ?? Color(red: 0.925, green: 0.282, blue: 0.6)
    }
}

extension Color {
    /// "#rrggbb" only, which is all the phone ever sends.
    init?(hex: String) {
        var digits = hex.trimmingCharacters(in: .whitespaces)
        if digits.hasPrefix("#") { digits.removeFirst() }
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

enum RunFormat {
    /// The phone's own clock format (formatDuration in RunningScreen): mm:ss,
    /// or h:mm:ss past the hour.
    static func clock(_ seconds: Double) -> String {
        let total = seconds.isFinite ? max(0, Int(seconds)) : 0
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%02d:%02d", m, s)
    }

    /// Always On redraws about once a minute, so seconds would sit there wrong.
    static func minutes(_ seconds: Double) -> String {
        let total = seconds.isFinite ? max(0, Int(seconds)) : 0
        return "\(total / 60) min"
    }
}
