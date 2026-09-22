import SwiftUI

// MARK: - Screen container

/// Every screen in the app sits in one of these.
///
/// A watch screen used to be a fixed VStack with a Spacer at each end, which
/// centres content that fits and silently cuts off content that does not: on
/// a 40mm the Ready screen's own Start button ran off the bottom of the glass,
/// with no way to reach it. A ScrollView cannot do that. Content shorter than
/// the screen still sits centred, because the minimum height below keeps the
/// old look on the watches where it worked; content taller than the screen
/// scrolls, under a finger or under the crown.
struct WatchScreen<Content: View>: View {
    var spacing: CGFloat = 10
    /// Off for a screen that reads top down (a list of stats) rather than as
    /// one composition around a hero.
    var centred: Bool = true
    /// A page inside a TabView. Two things are true there and nowhere else:
    /// the pager draws its dots OVER the page, and it hands the page the
    /// whole screen, so the clock strip has to be reserved even on a page
    /// that would otherwise start below it.
    var inPager: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { geo in
            // Reserve only what the system has NOT already reserved. Whether
            // watchOS keeps the clock strip out of this frame depends on where
            // the screen sits (a pager page is handed the whole glass, a plain
            // screen may not be), and adding the full strip on top of a safe
            // area that already excludes it pushed every screen down by twice
            // the clock and cut the bottom of the run page off on a 40mm.
            let topInset = max(0, WatchLayout.clockInset - geo.safeAreaInsets.top)
            let wantedBottom = WatchLayout.floorInset + (inPager ? WatchLayout.pagerInset : 0)
            let bottomInset = max(0, wantedBottom - geo.safeAreaInsets.bottom)
            let usableHeight = max(0, geo.size.height - topInset - bottomInset)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: spacing) {
                    content()
                }
                .frame(maxWidth: .infinity)
                // Padding is outside this frame. Subtract it from the viewport
                // first so a screen that fits does not become scrollable and
                // launch with its centred content pushed below the glass.
                .frame(minHeight: centred ? usableHeight : 0, alignment: .center)
                .padding(.horizontal, WatchLayout.gutter)
                .padding(.top, topInset)
                .padding(.bottom, bottomInset)
            }
        }
    }
}

// MARK: - Page Indicators

/// Page indicator for swipeable content.
/// Subtle dots that don't waste vertical space.
struct PageIndicator: View {
    let currentPage: Int
    let totalPages: Int
    
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<totalPages, id: \.self) { index in
                Circle()
                    .fill(index == currentPage ? PaserStyle.teal : PaserStyle.muted.opacity(0.4))
                    .frame(width: index == currentPage ? 6 : 4, height: index == currentPage ? 6 : 4)
            }
        }
        .padding(.bottom, 4)
    }
}

// MARK: - PASER Buttons

/// Primary PASER button with spring animation and haptic feedback.
struct PaserButton: View {
    let title: String
    let color: Color
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    var body: some View {
        Button(action: {
            WKInterfaceDevice.current().play(.click)
            action()
        }) {
            Text(title)
                .font(.system(size: WatchLayout.font(14), weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(color)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PaserStyle.cream, lineWidth: 2))
                )
                .shadow(color: color.opacity(0.4), radius: 4, x: 0, y: 2)
        }
        .buttonStyle(.plain)
        .scaleEffect(reduceMotion ? 1.0 : 1.0)
    }
}

/// Compact control button for inline use.
struct CompactButton: View {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: {
            WKInterfaceDevice.current().play(.click)
            action()
        }) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: WatchLayout.font(14), weight: .black))
                Text(label)
                    .font(.system(size: WatchLayout.font(10), weight: .black, design: .rounded))
            }
            .foregroundColor(PaserStyle.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(color)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PaserStyle.cream, lineWidth: 2))
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - PASER Rings

/// Progress ring with PASER gradient.
struct PaserRing: View {
    let progress: Double // 0.0 to 1.0
    let size: CGFloat
    let lineWidth: CGFloat
    
    var body: some View {
        ZStack {
            // Background ring
            Circle()
                .stroke(PaserStyle.card, lineWidth: lineWidth)
                .frame(width: size, height: size)
            
            // Progress ring
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [PaserStyle.pink, PaserStyle.teal, PaserStyle.pink]),
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .frame(width: size, height: size)
        }
    }
}

/// Animated ring for countdown or loading states.
struct AnimatedRing: View {
    let size: CGFloat
    let lineWidth: CGFloat
    @State private var rotation = 0.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    var body: some View {
        Circle()
            .trim(from: 0.1, to: 0.7)
            .stroke(
                AngularGradient(
                    gradient: Gradient(colors: [PaserStyle.pink, PaserStyle.teal]),
                    center: .center
                ),
                style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
            )
            .rotationEffect(.degrees(rotation))
            .frame(width: size, height: size)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 2.0).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            }
    }
}

// MARK: - Status Header

/// Compact status header with PASER branding and optional GPS indicator.
struct StatusHeader: View {
    let showGPS: Bool
    let gpsState: GPSState
    
    var body: some View {
        HStack {
            PaserMark()
            Spacer()
            if showGPS {
                GPSIndicator(state: gpsState)
            }
        }
        .font(.system(size: WatchLayout.font(10), weight: .semibold, design: .rounded))
    }
}

/// GPS state indicator. The dot carries the state; spelling out "GPS" beside
/// it consumed scarce horizontal space and competed with the system clock.
enum GPSState {
    case searching
    case ready
    case weak
    case unavailable
    
    var color: Color {
        switch self {
        case .searching: return PaserStyle.yellow
        case .ready: return PaserStyle.green
        case .weak: return PaserStyle.yellow
        case .unavailable: return PaserStyle.pink
        }
    }
    
    var accessibilityLabel: String {
        switch self {
        case .searching: return "Finding location"
        case .ready: return "Location ready"
        case .weak: return "Location signal weak"
        case .unavailable: return "Location unavailable"
        }
    }
}

struct GPSIndicator: View {
    let state: GPSState
    
    var body: some View {
        Circle()
            .fill(state.color)
            .frame(width: WatchLayout.size(8), height: WatchLayout.size(8))
            .shadow(color: state.color.opacity(0.7), radius: 3)
            .accessibilityLabel(state.accessibilityLabel)
    }
}

// MARK: - Motion Tokens

/// Spring animation configuration for PASER UI.
struct PaserMotion {
    /// Standard spring for buttons and state changes
    static let spring = Animation.spring(response: 0.4, dampingFraction: 0.7)
    
    /// Quick press animation
    static let press = Animation.easeOut(duration: 0.15)
    
    /// Soft fade for supporting content
    static let fade = Animation.easeOut(duration: 0.3)
    
    /// Ring draw animation
    static let ring = Animation.easeOut(duration: 0.5)
    
    /// Number transition
    static let number = Animation.easeInOut(duration: 0.2)
}

// MARK: - Metric Typography

/// Large metric display with proper spacing and readability.
struct LargeMetric: View {
    let label: String
    let value: String
    let unit: String?
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: WatchLayout.font(11), weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
            
            HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(value)
                    // A step smaller on a compact watch, so the run page fits
                    // the glass outright instead of leaning on a scroll.
                    .font(.system(size: WatchLayout.font(WatchLayout.isCompact ? 36 : 42, floor: 30), weight: .black, design: .rounded))
                    .foregroundColor(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .monospacedDigit()
                
                if let unit = unit {
                    Text(unit)
                        .font(.system(size: WatchLayout.font(12), weight: .black, design: .rounded))
                        .foregroundColor(PaserStyle.pink)
                }
            }
        }
    }
}

/// Compact metric for secondary information.
struct CompactMetric: View {
    let label: String
    let value: String
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: WatchLayout.font(9), weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.muted)
            
            Text(value)
                .font(.system(size: WatchLayout.font(16, floor: 13), weight: .black, design: .rounded))
                .foregroundColor(color)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

// MARK: - Stat Cards

/// Large stat card for secondary metrics page.
struct StatCard: View {
    let label: String
    let value: String
    var icon: String? = nil
    var color: Color = PaserStyle.teal
    
    var body: some View {
        VStack(alignment: .leading, spacing: WatchLayout.size(5)) {
            HStack(spacing: 3) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: WatchLayout.font(9), weight: .black))
                }
                Text(label)
                    .font(.system(size: WatchLayout.font(9), weight: .black, design: .rounded))
                    .tracking(0.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundColor(PaserStyle.ink.opacity(0.72))
            
            Text(value)
                .font(.system(size: WatchLayout.font(20, floor: 16), weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.ink)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.55)

            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<7, id: \.self) { index in
                    Capsule()
                        .fill(PaserStyle.ink.opacity(0.30))
                        .frame(height: WatchLayout.size(CGFloat(3 + ((index * 5 + label.count) % 9))))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(WatchLayout.size(9))
        .background(
            RoundedRectangle(cornerRadius: 11)
                .fill(color)
        )
    }
}
