import SwiftUI
import WatchKit

// MARK: - Screen metrics

/// PASER runs on watches from 136 points wide (38mm) to 208 (46mm), and a
/// layout written in fixed points fits exactly one of them. Everything here is
/// measured off the screen the app is actually on, so nothing has to be
/// guessed and nothing ends up under the curve of the glass.
enum WatchLayout {
    /// 41mm, which is the middle of the range and what the fixed sizes in this
    /// app were originally drawn against.
    private static let reference: CGFloat = 176

    static var screen: CGSize { WKInterfaceDevice.current().screenBounds.size }

    /// 38mm, 40mm and 41mm. If a screen fits on one of these it fits on all of
    /// them, which is why this, and not the large sizes, is what layout here
    /// is checked against.
    static var isCompact: Bool { screen.width <= reference }

    /// Bounded: past about a fifth either way, type and stroke weights stop
    /// looking like the same design and start looking like a different one.
    static var scale: CGFloat { min(1.2, max(0.78, screen.width / reference)) }

    /// A box, a gap or a diameter.
    static func size(_ points: CGFloat) -> CGFloat { (points * scale).rounded() }

    /// Type shrinks more slowly than boxes do, and never past legibility at
    /// arm's length in daylight.
    static func font(_ points: CGFloat, floor: CGFloat = 9) -> CGFloat {
        max(floor, (points * (1 + (scale - 1) * 0.6)).rounded())
    }

    /// The side gutter. The display's corners are round, so a button laid out
    /// to the very edge of a small watch is cut by the glass rather than by
    /// anything in this code, which is what "the content is cut off" looks
    /// like on a 40mm.
    static var gutter: CGFloat { max(8, (screen.width * 0.055).rounded()) }

    /// Clearance at the bottom of a screen, where the corner curves in
    /// hardest and where the primary button always is.
    static var floorInset: CGFloat { 8 }

    /// The strip at the top of the display where watchOS draws the time.
    ///
    /// PASER is not in a NavigationStack, so the system insets NOTHING for
    /// it: anything laid out at the top of a screen is drawn UNDER the clock.
    /// That is what put the GPS pill and RUN STATS on top of 1:20. The old
    /// screens only escaped it where a Spacer happened to push content into
    /// the middle. Every screen reserves it now (WatchScreen).
    static var clockInset: CGFloat { size(20) }

    /// Room at the foot of a page inside a pager, where the dots are drawn
    /// OVER the page rather than beside it.
    static var pagerInset: CGFloat { size(13) }

    /// How wide the picture in the hero portrait may be. Measured against the
    /// screen's HEIGHT as well as its width, because on a short watch the
    /// portrait is what pushes everything below it off the bottom. The ring
    /// around it adds about a seventh on top of this (PaserPortrait).
    ///
    /// Sized so that the Ready screen fits a 40mm outright rather than by
    /// scrolling: portrait, prompt and Start button, with the supporting line
    /// still above the fold.
    static var hero: CGFloat { min(screen.width * 0.44, screen.height * 0.29).rounded() }
}

// MARK: - Accessibility Helpers

extension View {
    /// Larger touch targets for accessibility.
    func accessibleTouchTarget() -> some View {
        self.frame(minWidth: 44, minHeight: 44)
    }

    /// Accessibility label for metric displays.
    func metricAccessibility(label: String, value: String, unit: String? = nil) -> some View {
        var fullLabel = label
        if let unit = unit {
            fullLabel += " \(value) \(unit)"
        } else {
            fullLabel += " \(value)"
        }
        return self.accessibilityLabel(fullLabel)
    }
}
