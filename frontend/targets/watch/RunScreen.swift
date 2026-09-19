import SwiftUI

struct RunScreen: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        ZStack {
            PaserStyle.background.ignoresSafeArea()
            content
                .id(phaseID)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
        }
        .animation(.spring(response: 0.48, dampingFraction: 0.78), value: phaseID)
    }

    @ViewBuilder private var content: some View {
        switch workout.phase {
        case .ready: ReadyView()
        case .countdown: CountdownView()
        case .running: ActiveRunPager()
        case .paused: PausedView()
        case .saving: SavingView()
        case .summary: PostRunPager()
        case .error: ErrorView()
        }
    }

    private var phaseID: String { String(describing: workout.phase) }
}

// MARK: - Error View (Kept from original)

struct ErrorView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        VStack(spacing: 12) {
            PaserMark()
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 36, weight: .bold))
                .foregroundColor(PaserStyle.yellow)
            Text("RUN NOT STARTED")
                .font(.system(size: 16, weight: .black, design: .rounded))
            Text(workout.errorMessage)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .multilineTextAlignment(.center)
            Button("TRY AGAIN", action: workout.reset)
                .font(.system(size: 13, weight: .black, design: .rounded))
                .buttonStyle(PaserCapsuleStyle(color: PaserStyle.pink))
        }
        .padding(14)
    }
}

// MARK: - Paser Mark (Kept from original)

struct PaserMark: View {
    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(PaserStyle.pink)
                .frame(width: 7, height: 13)
                .rotationEffect(.degrees(12))
            Text("PASER")
                .font(.system(size: 12, weight: .black, design: .rounded))
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
