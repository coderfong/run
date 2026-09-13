import SwiftUI

// Every view the watch app has. Copy rules are the app's: short, plain, and
// no dashes of any kind (__tests__/watchProtocol.test.js checks the strings).

struct RunScreen: View {
    @EnvironmentObject private var link: PhoneLink
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            PaserStyle.background.ignoresSafeArea()
            content.padding(.horizontal, 3)
        }
        .tint(link.state.accent)
        // Use the watchOS 9 overload. The two-argument closure is only
        // available from watchOS 10 and would make the lower target lie.
        .onChange(of: scenePhase) { phase in
            if phase == .active { link.refresh() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch link.state.phase {
        case .idle:
            MessageView(
                title: "PASER",
                message: link.reachable
                    ? "Open PASER on your iPhone to start a run."
                    : "Your iPhone is out of reach."
            )
        case .ready:
            ReadyView()
        case .countdown:
            CountdownView()
        case .running, .paused:
            LiveRunView()
        case .saving:
            MessageView(title: "Saving", message: "Your iPhone is saving the run.", busy: true)
        case .saved:
            SavedView()
        case .unsaved:
            MessageView(
                title: "Not saved",
                message: link.state.notice.isEmpty ? "Open PASER on your iPhone." : link.state.notice
            )
        }
    }
}

// MARK: Before the run

struct ReadyView: View {
    @EnvironmentObject private var link: PhoneLink

    var body: some View {
        VStack(spacing: 9) {
            HStack(spacing: 5) {
                Circle()
                    .fill(link.state.accent)
                    .frame(width: 8, height: 8)
                Text("PASER")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .tracking(1.2)
                Spacer(minLength: 0)
                Text("READY")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(PaserStyle.muted)
            }
            Text("OWN YOUR RUN")
                .font(.system(size: 23, weight: .black, design: .rounded))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Button {
                link.send(.start)
            } label: {
                Text("Start run")
                    .font(.system(size: 18, weight: .black, design: .rounded))
                    .foregroundStyle(PaserStyle.ink)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(PaserActionStyle(accent: link.state.accent))
            .disabled(link.pending != nil || !link.reachable)
            .opacity(link.pending != nil ? 0.6 : 1)
            Text(footnote)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(link.state.notice.isEmpty ? PaserStyle.muted : Color.orange)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .paserPanel(accent: link.state.accent)
    }

    private var footnote: String {
        if !link.reachable { return "Your iPhone is out of reach." }
        if !link.state.notice.isEmpty { return link.state.notice }
        return "Your iPhone records the route."
    }
}

struct CountdownView: View {
    @EnvironmentObject private var link: PhoneLink

    var body: some View {
        VStack(spacing: 2) {
            Text("GET READY")
                .font(.system(size: 11, weight: .black, design: .rounded))
                .tracking(1.3)
                .foregroundStyle(PaserStyle.yellow)
            Text(link.state.countdown.isEmpty ? "3" : link.state.countdown)
                .font(.system(size: 74, weight: .black, design: .rounded))
                .foregroundStyle(link.state.accent)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .padding(12)
        .paserPanel(accent: PaserStyle.teal)
    }
}

// MARK: During the run

struct LiveRunView: View {
    @EnvironmentObject private var link: PhoneLink
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let state = link.state
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(gpsColor(state.gps))
                        .frame(width: 7, height: 7)
                    ElapsedText(state: state, receivedAt: link.receivedAt, dimmed: dimmed)
                    Spacer(minLength: 0)
                    if state.phase == .paused {
                        Text("PAUSED")
                            .font(.system(size: 12, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.yellow)
                    }
                }

                VStack(alignment: .leading, spacing: 0) {
                    Text(state.distance)
                        .font(.system(size: 46, weight: .heavy, design: .rounded))
                        .foregroundStyle(state.accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text("KM")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.gray)
                }

                HStack(alignment: .top, spacing: 8) {
                    StatView(
                        label: "PACE", value: state.pace, unit: "/km",
                        fill: PaserStyle.teal
                    )
                    StatView(
                        label: "LAND",
                        value: state.land,
                        unit: "km²",
                        fill: state.land == RunState.empty ? PaserStyle.muted : PaserStyle.yellow
                    )
                }

                // Always On: numbers only. A control nobody can see clearly
                // is a control somebody presses by accident.
                if !dimmed {
                    if link.reachable {
                        RunControls()
                            .padding(.top, 4)
                    } else {
                        Text("Your iPhone is out of reach.")
                            .font(.footnote)
                            .foregroundStyle(Color.orange)
                    }
                    if !state.hint.isEmpty {
                        Text(state.hint)
                            .font(.footnote)
                            .foregroundStyle(Color.gray)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(8)
            .paserPanel(accent: state.accent)
        }
    }

    private func gpsColor(_ quality: String) -> Color {
        switch quality {
        case "good": return .green
        case "ok": return .yellow
        case "poor": return .red
        default: return .gray
        }
    }
}

/// The run clock. The phone sends the elapsed time with each update and the
/// watch counts on from there, so the seconds tick without a message a second.
struct ElapsedText: View {
    let state: RunState
    let receivedAt: Date
    let dimmed: Bool

    var body: some View {
        TimelineView(.periodic(from: receivedAt, by: 1)) { context in
            Text(label(at: context.date))
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.white)
        }
    }

    private func label(at date: Date) -> String {
        var seconds = state.elapsedS
        if state.phase == .running {
            seconds += max(0, date.timeIntervalSince(receivedAt))
        }
        return dimmed ? RunFormat.minutes(seconds) : RunFormat.clock(seconds)
    }
}

struct StatView: View {
    let label: String
    let value: String
    let unit: String
    let fill: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(PaserStyle.ink.opacity(0.7))
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(PaserStyle.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if value != RunState.empty {
                    Text(unit)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PaserStyle.ink.opacity(0.65))
                }
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(fill))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(PaserStyle.ink, lineWidth: 1.5)
        )
    }
}

struct RunControls: View {
    @EnvironmentObject private var link: PhoneLink

    var body: some View {
        let paused = link.state.phase == .paused
        HStack(spacing: 8) {
            Button {
                link.send(paused ? .resume : .pause)
            } label: {
                Image(systemName: paused ? "play.fill" : "pause.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(paused ? Color.black : Color.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(paused ? link.state.accent : Color.white.opacity(0.18)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(paused ? "Resume run" : "Pause run")

            HoldToFinishButton {
                link.send(.finish)
            }
        }
        .disabled(link.pending != nil)
        .opacity(link.pending != nil ? 0.6 : 1)
    }
}

/// Press and hold, like the phone's finish button, so a jostled wrist cannot
/// end a run. The fill tracks the hold and empties if the finger lifts early.
struct HoldToFinishButton: View {
    let onFinish: () -> Void

    @State private var progress: CGFloat = 0
    @State private var holding = false

    private let holdSeconds = 1.0

    var body: some View {
        ZStack {
            Capsule().fill(Color.red.opacity(0.35))
            GeometryReader { geo in
                Capsule()
                    .fill(Color.red)
                    .frame(width: geo.size.width * progress)
            }
            Text(holding ? "Keep holding" : "Hold to finish")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(Color.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 6)
        }
        .frame(height: 44)
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onLongPressGesture(minimumDuration: holdSeconds, maximumDistance: 40) {
            holding = false
            progress = 0
            onFinish()
        } onPressingChanged: { pressing in
            holding = pressing
            if pressing {
                withAnimation(.linear(duration: holdSeconds)) { progress = 1 }
            } else {
                withAnimation(.easeOut(duration: 0.15)) { progress = 0 }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Finish run")
        .accessibilityHint("Press and hold to finish the run")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onFinish() }
    }
}

// MARK: After the run

struct SavedView: View {
    @EnvironmentObject private var link: PhoneLink

    var body: some View {
        let state = link.state
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(state.accent)
            Text("Run saved")
                .font(.system(size: 18, weight: .heavy, design: .rounded))
            if !state.summaryDistance.isEmpty {
                Text(summary(state))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            Text("Claim your land on your iPhone.")
                .font(.footnote)
                .foregroundStyle(Color.gray)
                .multilineTextAlignment(.center)
        }
        .padding(12)
        .paserPanel(accent: PaserStyle.green)
    }

    private func summary(_ state: RunState) -> String {
        if state.summaryTime.isEmpty { return "\(state.summaryDistance) km" }
        return "\(state.summaryDistance) km \u{00B7} \(state.summaryTime)"
    }
}

struct MessageView: View {
    let title: String
    let message: String
    var busy = false

    var body: some View {
        VStack(spacing: 8) {
            if busy { ProgressView() }
            Text(title)
                .font(.system(size: 18, weight: .heavy, design: .rounded))
            Text(message)
                .font(.footnote)
                .foregroundStyle(Color.gray)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .paserPanel(accent: PaserStyle.pink)
    }
}

// The phone's run screen is a dark game board with cream ink, thick framed
// cards and a coloured hard drop. These small primitives carry that same
// neo-brutalist language to the wrist without importing phone-only assets.
private enum PaserStyle {
    static let background = Color(red: 11 / 255, green: 13 / 255, blue: 16 / 255)
    static let card = Color(red: 21 / 255, green: 24 / 255, blue: 29 / 255)
    static let cream = Color(red: 251 / 255, green: 247 / 255, blue: 238 / 255)
    static let muted = Color(red: 174 / 255, green: 178 / 255, blue: 187 / 255)
    static let ink = Color(red: 11 / 255, green: 13 / 255, blue: 16 / 255)
    static let pink = Color(red: 236 / 255, green: 72 / 255, blue: 153 / 255)
    static let teal = Color(red: 124 / 255, green: 240 / 255, blue: 208 / 255)
    static let yellow = Color(red: 250 / 255, green: 204 / 255, blue: 21 / 255)
    static let green = Color(red: 74 / 255, green: 222 / 255, blue: 128 / 255)
}

private struct PaserPanel: ViewModifier {
    let accent: Color

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(accent)
                    .offset(x: 3, y: 4)
            )
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(PaserStyle.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(PaserStyle.cream, lineWidth: 2)
            )
    }
}

private extension View {
    func paserPanel(accent: Color) -> some View {
        modifier(PaserPanel(accent: accent))
    }
}

private struct PaserActionStyle: ButtonStyle {
    let accent: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Capsule()
                    .fill(PaserStyle.cream)
                    .offset(x: 2, y: 3)
            )
            .background(Capsule().fill(accent))
            .overlay(Capsule().stroke(PaserStyle.ink, lineWidth: 2))
            .offset(y: configuration.isPressed ? 2 : 0)
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}
