import WatchKit

/// Taps on the wrist for the moments a runner would otherwise have to look
/// for: the countdown, the run starting, pausing and resuming, each finished
/// kilometre, the run earning land, and the run being saved or failing to
/// save. Nothing else buzzes, and nothing buzzes for a button press (the
/// system already does that).
enum Haptics {
    static func play(from old: RunState, to new: RunState) {
        guard let type = haptic(from: old, to: new) else { return }
        WKInterfaceDevice.current().play(type)
    }

    private static func haptic(from old: RunState, to new: RunState) -> WKHapticType? {
        switch new.phase {
        case .countdown:
            if new.countdown != old.countdown { return WKHapticType.click }
            return nil
        case .running:
            if old.phase == .paused || old.phase == .countdown || old.phase == .ready {
                return WKHapticType.start
            }
            if old.phase == .running {
                if new.km > old.km { return WKHapticType.notification }
                if new.qualified && !old.qualified { return WKHapticType.success }
            }
            return nil
        case .paused:
            if old.phase == .running { return WKHapticType.stop }
            return nil
        case .saved:
            if old.phase != .saved { return WKHapticType.success }
            return nil
        case .unsaved:
            if old.phase != .unsaved { return WKHapticType.failure }
            return nil
        default:
            return nil
        }
    }
    
    /// Haptic for UI interactions (button presses, etc.)
    static func lightTap() {
        WKInterfaceDevice.current().play(.click)
    }
    
    /// Haptic for success states
    static func success() {
        WKInterfaceDevice.current().play(.success)
    }
    
    /// Haptic for failure/error states
    static func failure() {
        WKInterfaceDevice.current().play(.failure)
    }
    
    /// Haptic for notification
    static func notification() {
        WKInterfaceDevice.current().play(.notification)
    }
}
