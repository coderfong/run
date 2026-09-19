import SwiftUI

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
                .font(.system(size: 14, weight: .black, design: .rounded))
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
                    .font(.system(size: 14, weight: .black))
                Text(label)
                    .font(.system(size: 10, weight: .black, design: .rounded))
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
        .font(.system(size: 10, weight: .semibold, design: .rounded))
    }
}

/// GPS state indicator with appropriate color and label.
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
    
    var label: String {
        switch self {
        case .searching: return "GPS"
        case .ready: return "GPS"
        case .weak: return "GPS WEAK"
        case .unavailable: return "GPS OFF"
        }
    }
}

struct GPSIndicator: View {
    let state: GPSState
    
    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(state.color)
                .frame(width: 4, height: 4)
            Text(state.label)
                .foregroundColor(state.color)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Capsule().fill(PaserStyle.card))
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
                .font(.system(size: 11, weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
            
            HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 42, weight: .black, design: .rounded))
                    .foregroundColor(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .monospacedDigit()
                
                if let unit = unit {
                    Text(unit)
                        .font(.system(size: 12, weight: .black, design: .rounded))
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
                .font(.system(size: 9, weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.muted)
            
            Text(value)
                .font(.system(size: 16, weight: .black, design: .rounded))
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
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .tracking(0.8)
            
            Text(value)
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.teal)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(PaserStyle.card)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(PaserStyle.cream.opacity(0.2), lineWidth: 1))
        )
    }
}
