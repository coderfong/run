import SwiftUI
import WatchKit

// Every screen here is laid out against the screen it is on (WatchLayout) and
// sits inside a WatchScreen, which scrolls. Fixed point sizes and a VStack
// with a Spacer at each end were what put the Start button under the curve of
// the glass on a 40mm, with no way to reach it.

// MARK: - Ready

struct ReadyView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var portrait: WatchAvatarStore

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(10)) {
            StatusHeader(showGPS: true, gpsState: workout.gpsReady ? .ready : .searching)

            PaserPortrait(size: WatchLayout.hero, motion: .idle)

            // The prompt is the first thing shed on a small watch. It is the
            // one line here that says nothing the button below it does not,
            // and 38mm to 41mm is where the screen runs out.
            if !WatchLayout.isCompact {
                Text("READY?")
                    .font(.system(size: WatchLayout.font(18, floor: 15), weight: .black, design: .rounded))
                    .tracking(1.5)
                    .foregroundColor(PaserStyle.cream)
            }

            Button(action: {
                Haptics.lightTap()
                workout.start()
            }) {
                Text("START RUN")
                    .font(.system(size: WatchLayout.font(16, floor: 14), weight: .black, design: .rounded))
                    .tracking(1.2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundColor(PaserStyle.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WatchLayout.size(13))
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(PaserStyle.pink)
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(PaserStyle.cream, lineWidth: 3))
                    )
            }
            .buttonStyle(.plain)
            .accessibleTouchTarget()

            // ONE supporting line, and it says the most useful thing true
            // right now. Three stacked lines of small print were most of what
            // did not fit, and two of them repeated the header.
            Text(hint)
                .font(.system(size: WatchLayout.font(10), weight: .semibold, design: .rounded))
                .foregroundColor(hintColor)
                .multilineTextAlignment(.center)
        }
    }

    private var hint: String {
        if !workout.gpsReady { return "Finding GPS" }
        if !portrait.hasPortrait { return "Open PASER on iPhone for your runner" }
        return "Recorded on this watch"
    }

    private var hintColor: Color {
        workout.gpsReady ? PaserStyle.muted : PaserStyle.yellow
    }
}

// MARK: - Countdown

struct CountdownView: View {
    @EnvironmentObject private var workout: WorkoutManager

    private var ringSize: CGFloat {
        min(WatchLayout.screen.width * 0.68, WatchLayout.screen.height * 0.48).rounded()
    }

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(8)) {
            Text("GET READY")
                .font(.system(size: WatchLayout.font(12), weight: .black, design: .rounded))
                .tracking(1.4)
                .foregroundColor(PaserStyle.teal)

            ZStack {
                PaserRing(
                    progress: Double(4 - workout.countdown) / 3.0,
                    size: ringSize,
                    lineWidth: WatchLayout.size(6)
                )

                VStack(spacing: WatchLayout.size(1)) {
                    Text(workout.countdown == 0 ? "GO!" : "\(workout.countdown)")
                        .font(.system(size: WatchLayout.font(48, floor: 38), weight: .black, design: .rounded))
                        .foregroundColor(PaserStyle.cream)
                        .lineLimit(1)
                        .id(workout.countdown)

                    PaserPortrait(size: WatchLayout.size(25), motion: .brace, ring: false)
                }
            }
            .frame(width: ringSize, height: ringSize)
            .animation(PaserMotion.spring, value: workout.countdown)
        }
    }
}

// MARK: - Swipeable Active Run Pages

struct ActiveRunPager: View {
    @State private var currentPage = 0

    var body: some View {
        TabView(selection: $currentPage) {
            PrimaryRunPage().tag(0)
            StatsPage().tag(1)
            ControlsPage().tag(2)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .overlay(alignment: .bottom) {
            PageIndicator(currentPage: currentPage, totalPages: 3)
        }
    }
}

// MARK: - Primary Run Page (Distance Dominant)

struct PrimaryRunPage: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(12), inPager: true) {
            // Everything in this row is pushed LEFT. The clock lives in the
            // top right corner of every watch screen, and a GPS pill sitting
            // under it reads as two badges fighting for the same corner.
            HStack(spacing: WatchLayout.size(6)) {
                PaserPortrait(
                    size: WatchLayout.size(26),
                    motion: .run(workout.cadenceHz),
                    ring: false
                )
                GPSIndicator(state: workout.gpsReady ? .ready : .weak)
                Spacer()
            }

            LargeMetric(
                label: "DISTANCE",
                value: workout.distanceText,
                unit: "KM",
                color: PaserStyle.cream
            )
            .metricAccessibility(label: "Distance", value: workout.distanceText, unit: "kilometers")

            HStack(spacing: WatchLayout.size(12)) {
                CompactMetric(label: "TIME", value: workout.elapsedText, color: PaserStyle.teal)
                    .metricAccessibility(label: "Time", value: workout.elapsedText)

                CompactMetric(label: "PACE", value: workout.pace + "/KM", color: PaserStyle.yellow)
                    .metricAccessibility(label: "Pace", value: workout.pace, unit: "per kilometer")
            }
        }
    }
}

// MARK: - Stats Page (Secondary Metrics)

struct StatsPage: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(7), centred: false, inPager: true) {
            // No PASER mark on a page of a run. It repeated what the previous
            // page already said, and on a 40mm it cost a whole row that a
            // stat card wanted.
            Text("RUN STATS")
                .font(.system(size: WatchLayout.font(14), weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
                .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(columns: [
                GridItem(.flexible(), spacing: WatchLayout.size(6)),
                GridItem(.flexible(), spacing: WatchLayout.size(6))
            ], spacing: WatchLayout.size(6)) {
                StatCard(
                    label: "HEART",
                    value: workout.heartRate > 0 ? workout.heartRateText + " BPM" : RunState.empty,
                    icon: "heart.fill",
                    color: PaserStyle.pink
                )
                StatCard(
                    label: "CALORIES",
                    value: workout.caloriesText + " KCAL",
                    icon: "flame.fill",
                    color: PaserStyle.yellow
                )
                StatCard(
                    label: "ELEVATION",
                    value: workout.elevationText,
                    icon: "mountain.2.fill",
                    color: PaserStyle.green
                )
                StatCard(
                    label: "SPEED",
                    value: workout.speedText + " KM/H",
                    icon: "speedometer",
                    color: PaserStyle.teal
                )
            }
        }
    }
}

// MARK: - Finish Page

/// One control, and it is the only one a run needs from the wrist.
///
/// Pause is gone. It was the loudest thing on the page, it sat one swipe from
/// a run in progress, and a yellow bar reading PAUSE beside a small dark dial
/// reading END made the destructive control the quiet one. What is left is the
/// dial, big enough to be the page, and it still takes a deliberate hold.
struct ControlsPage: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(12), inPager: true) {
            HoldToFinishButton(action: workout.finish)
        }
    }
}

// MARK: - Hold to Finish Button

struct HoldToFinishButton: View {
    let action: () -> Void
    @State private var progress: Double = 0

    /// It is the whole page now that Pause has gone, so it is sized off the
    /// screen rather than written down: a thumb on the move needs the target,
    /// and there is nothing left to share the room with.
    private var dial: CGFloat {
        min(WatchLayout.screen.width * 0.42, WatchLayout.screen.height * 0.32).rounded()
    }

    var body: some View {
        VStack(spacing: WatchLayout.size(10)) {
            ZStack {
                Circle()
                    .fill(PaserStyle.card)
                    .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                    .frame(width: dial, height: dial)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(PaserStyle.pink, style: StrokeStyle(lineWidth: max(4, dial * 0.07), lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: dial, height: dial)

                Image(systemName: "stop.fill")
                    .font(.system(size: dial * 0.36, weight: .black))
                    .foregroundColor(PaserStyle.cream)
            }

            Text("PRESS AND HOLD TO END")
                .font(.system(size: WatchLayout.font(10), weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .multilineTextAlignment(.center)
        }
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1.5, pressing: { pressing in
            if pressing {
                withAnimation(.linear(duration: 1.5)) { progress = 1.0 }
            } else {
                withAnimation(.easeOut(duration: 0.2)) { progress = 0 }
            }
        }) {
            WKInterfaceDevice.current().play(.success)
            action()
        }
    }
}

// MARK: - Paused

/// Nothing on the wrist raises this any more: the Pause button is gone (see
/// ControlsPage). The phase, and the paused time bookkeeping behind it, stay
/// on WorkoutManager because that is what keeps elapsed time honest, and
/// because bringing Pause back should be a button rather than a rewrite.
struct PausedView: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(10)) {
            HStack(spacing: WatchLayout.size(6)) {
                Circle()
                    .fill(PaserStyle.yellow)
                    .frame(width: WatchLayout.size(10), height: WatchLayout.size(10))
                Text("PAUSED")
                    .font(.system(size: WatchLayout.font(22, floor: 18), weight: .black, design: .rounded))
                    .tracking(1.5)
                    .foregroundColor(PaserStyle.yellow)
            }

            Text(workout.elapsedText)
                .font(.system(size: WatchLayout.font(38, floor: 28), weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.cream)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            PaserPortrait(size: WatchLayout.size(46), motion: .rest, ring: false)

            Button(action: {
                WKInterfaceDevice.current().play(.start)
                workout.resume()
            }) {
                Text("RESUME RUN")
                    .font(.system(size: WatchLayout.font(16, floor: 14), weight: .black, design: .rounded))
                    .tracking(1.2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundColor(PaserStyle.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WatchLayout.size(13))
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(PaserStyle.teal)
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(PaserStyle.cream, lineWidth: 3))
                    )
            }
            .buttonStyle(.plain)
            .accessibleTouchTarget()
        }
    }
}

// MARK: - Saving

struct SavingView: View {
    private var ringSize: CGFloat {
        min(WatchLayout.screen.width * 0.72, WatchLayout.screen.height * 0.50).rounded()
    }

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(14)) {
            ZStack {
                PaserPortrait(size: ringSize * 0.62, motion: .idle, ring: false)
                AnimatedRing(size: ringSize, lineWidth: WatchLayout.size(6))
            }

            Text("SAVING RUN")
                .font(.system(size: WatchLayout.font(17, floor: 14), weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.cream)
        }
    }
}

// MARK: - Post-Run Pager

struct PostRunPager: View {
    @State private var currentPage = 0

    var body: some View {
        TabView(selection: $currentPage) {
            CelebrationPage().tag(0)
            ResultsPage().tag(1)
            ClaimHandoffPage().tag(2)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .overlay(alignment: .bottom) {
            PageIndicator(currentPage: currentPage, totalPages: 3)
        }
    }
}

// MARK: - Celebration Page

struct CelebrationPage: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var arrived = false

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(8), inPager: true) {
            PaserPortrait(size: WatchLayout.hero, motion: .cheer)

            Text("RUN SAVED")
                .font(.system(size: WatchLayout.font(18, floor: 15), weight: .black, design: .rounded))
                .tracking(1.5)
                .foregroundColor(PaserStyle.cream)
                .opacity(arrived ? 1.0 : 0.0)
                .animation(PaserMotion.fade.delay(0.2), value: arrived)

            Text(workout.distanceText + " KM")
                .font(.system(size: WatchLayout.font(32, floor: 24), weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.pink)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .opacity(arrived ? 1.0 : 0.0)
                .animation(PaserMotion.fade.delay(0.3), value: arrived)
        }
        .onAppear {
            arrived = true
            WKInterfaceDevice.current().play(.success)
        }
    }
}

// MARK: - Results Page

struct ResultsPage: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(10), centred: false, inPager: true) {
            Text("YOUR RUN")
                .font(.system(size: WatchLayout.font(14), weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
                .frame(maxWidth: .infinity, alignment: .leading)

            StatCard(label: "TIME", value: workout.elapsedText)
            StatCard(label: "AVG PACE", value: workout.pace + "/KM")
        }
    }
}

// MARK: - Claim Handoff Page

struct ClaimHandoffPage: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        WatchScreen(spacing: WatchLayout.size(10), inPager: true) {
            PaserPortrait(size: WatchLayout.size(52), motion: .idle, ring: false)

            // There used to be a green RUN SYNCED badge here. The watch hands
            // the run over with transferUserInfo, which the system delivers
            // whenever it can, so a watch out of range of the phone was
            // showing a green light for something that had not happened. It
            // also said the same thing as the two lines under it.
            Text("READY TO CLAIM")
                .font(.system(size: WatchLayout.font(16, floor: 13), weight: .black, design: .rounded))
                .tracking(1.0)
                .foregroundColor(PaserStyle.cream)

            Text("Open PASER on iPhone to plan your attack")
                .font(.system(size: WatchLayout.font(11), weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.teal)
                .multilineTextAlignment(.center)

            Button("DONE", action: workout.reset)
                .font(.system(size: WatchLayout.font(13), weight: .black, design: .rounded))
                .buttonStyle(PaserCapsuleStyle(color: PaserStyle.cream))
        }
    }
}
