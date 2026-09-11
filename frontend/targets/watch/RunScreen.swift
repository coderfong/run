import SwiftUI

// Every view the watch app has. Copy rules are the app's: short, plain, and
// no dashes of any kind (__tests__/watchProtocol.test.js checks the strings).

struct RunScreen: View {
    @EnvironmentObject private var link: PhoneLink
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .tint(link.state.accent)
            .onChange(of: scenePhase) { _, phase in
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
        VStack(spacing: 10) {
            Text("PASER")
                .font(.system(size: 16, weight: .black, design: .rounded))
                .foregroundStyle(link.state.accent)
            Button {
                link.send(.start)
            } label: {
                Text("Start run")
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(Capsule().fill(link.state.accent))
            }
            .buttonStyle(.plain)
            .disabled(link.pending != nil || !link.reachable)
            .opacity(link.pending != nil ? 0.6 : 1)
            Text(footnote)
                .font(.footnote)
                .foregroundStyle(link.state.notice.isEmpty ? Color.gray : Color.orange)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
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
        Text(link.state.countdown.isEmpty ? "3" : link.state.countdown)
            .font(.system(size: 84, weight: .black, design: .rounded))
            .foregroundStyle(link.state.accent)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
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
                    StatView(label: "PACE", value: state.pace, unit: "/km", tint: .white)
                    StatView(
                        label: "LAND",
                        value: state.land,
                        unit: "km²",
                        tint: state.land == RunState.empty ? .gray : state.accent
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
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.gray)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if value != RunState.empty {
                    Text(unit)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.gray)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        .padding(.horizontal, 4)
    }
}
