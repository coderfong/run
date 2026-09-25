import SwiftUI

struct RunScreen: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var phoneLink: PhoneLink
    /// Re-reads phoneRunActive now and then: it goes stale by time alone.
    @State private var now = Date()
    private let refresh = Timer.publish(every: 15, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            PaserStyle.background.ignoresSafeArea()
            content
                .id(phaseID)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
        }
        .animation(.spring(response: 0.48, dampingFraction: 0.78), value: phaseID)
        .onReceive(refresh) { now = $0 }
    }

    @ViewBuilder private var content: some View {
        switch workout.phase {
        // One PASER run per person: with the phone recording, the watch shows
        // and controls that run rather than offering to start another.
        case .ready: if phoneLink.phoneRunActive { PhoneRunView() } else { ReadyView() }
        case .countdown: CountdownView()
        case .running: ActiveRunPager()
        case .paused: PausedView()
        case .saving: SavingView()
        case .summary: PostRunPager()
        case .error: ErrorView()
        }
    }

    private var phaseID: String {
        _ = now // read, so the 15 s refresh re-evaluates staleness
        let mirrored = workout.phase == .ready && phoneLink.phoneRunActive
        return String(describing: workout.phase) + (mirrored ? ".phone" : "")
    }
}

// MARK: - Run in progress on the iPhone

/// The phone is recording this person's run. The watch mirrors it and sends
/// Pause, Resume and Finish to it (the phone checks each one against its own
/// state before acting). No Start here: that would be a second run.
struct PhoneRunView: View {
    @EnvironmentObject private var phoneLink: PhoneLink

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(8)) {
            PaserMark()
            Text("RUN IN PROGRESS")
                .font(.system(size: WatchLayout.font(15, floor: 13), weight: .black, design: .rounded))
                .multilineTextAlignment(.center)
            Text("Recording on your iPhone")
                .font(.system(size: WatchLayout.font(11), weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .multilineTextAlignment(.center)
            Text("\(phoneLink.state.distance) KM")
                .font(.system(size: WatchLayout.font(22, floor: 18), weight: .black, design: .rounded))
                .foregroundColor(phoneLink.state.accent)
            if phoneLink.state.phase == .paused {
                Button("RESUME") { phoneLink.send(.resume) }
                    .font(.system(size: WatchLayout.font(13), weight: .black, design: .rounded))
                    .buttonStyle(PaserCapsuleStyle(color: PaserStyle.pink))
            } else if phoneLink.state.phase == .running {
                Button("PAUSE") { phoneLink.send(.pause) }
                    .font(.system(size: WatchLayout.font(13), weight: .black, design: .rounded))
                    .buttonStyle(PaserCapsuleStyle(color: PaserStyle.yellow))
            }
            if phoneLink.state.phase == .running || phoneLink.state.phase == .paused {
                Button("FINISH") { phoneLink.send(.finish) }
                    .font(.system(size: WatchLayout.font(13), weight: .black, design: .rounded))
                    .buttonStyle(PaserCapsuleStyle(color: PaserStyle.cream))
            }
        }
    }
}

// MARK: - Error View (Kept from original)

struct ErrorView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        // The one screen whose length is not known in advance: the message is
        // whatever went wrong, and on a compact watch a long one is several
        // lines. It scrolls, so Try Again is always reachable.
        WatchScreen(spacing: WatchLayout.size(10)) {
            PaserMark()
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: WatchLayout.font(32), weight: .bold))
                .foregroundColor(PaserStyle.yellow)
            Text("RUN NOT STARTED")
                .font(.system(size: WatchLayout.font(16, floor: 13), weight: .black, design: .rounded))
                .multilineTextAlignment(.center)
            Text(workout.errorMessage)
                .font(.system(size: WatchLayout.font(11), weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .multilineTextAlignment(.center)
            Button("TRY AGAIN", action: workout.reset)
                .font(.system(size: WatchLayout.font(13), weight: .black, design: .rounded))
                .buttonStyle(PaserCapsuleStyle(color: PaserStyle.pink))
        }
    }
}

// MARK: - Paser Mark (Kept from original)

struct PaserMark: View {
    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(PaserStyle.pink)
                .frame(width: WatchLayout.size(7), height: WatchLayout.size(13))
                .rotationEffect(.degrees(12))
            Text("PASER")
                .font(.system(size: WatchLayout.font(12), weight: .black, design: .rounded))
                .tracking(1)
        }
    }
}

// MARK: - Button Style (Kept from original)

struct PaserCapsuleStyle: ButtonStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundColor(PaserStyle.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Capsule().fill(color))
            .overlay(Capsule().stroke(PaserStyle.cream, lineWidth: 2))
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
    }
}

// MARK: - Paser Style Colors (Kept from original)

enum PaserStyle {
    static let background = Color(red: 7 / 255, green: 9 / 255, blue: 13 / 255)
    static let card = Color(red: 24 / 255, green: 27 / 255, blue: 34 / 255)
    static let cream = Color(red: 251 / 255, green: 247 / 255, blue: 238 / 255)
    static let muted = Color(red: 157 / 255, green: 163 / 255, blue: 176 / 255)
    static let ink = Color(red: 7 / 255, green: 9 / 255, blue: 13 / 255)
    static let pink = Color(red: 244 / 255, green: 70 / 255, blue: 190 / 255)
    static let teal = Color(red: 80 / 255, green: 239 / 255, blue: 210 / 255)
    static let yellow = Color(red: 250 / 255, green: 204 / 255, blue: 21 / 255)
    static let green = Color(red: 74 / 255, green: 222 / 255, blue: 128 / 255)
}
