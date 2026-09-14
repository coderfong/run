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
        case .running, .paused: WorkoutPages()
        case .saving: SavingView()
        case .summary: SummaryView()
        case .error: ErrorView()
        }
    }

    private var phaseID: String { String(describing: workout.phase) }
}

struct ReadyView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 7) {
            HStack { PaserMark(); Spacer(); SignalPill(ready: workout.gpsReady) }
            Spacer(minLength: 0)
            ZStack {
                Circle()
                    .stroke(PaserStyle.pink.opacity(0.35), lineWidth: 3)
                    .frame(width: 76, height: 76)
                    .scaleEffect(pulse ? 1.16 : 0.92)
                    .opacity(pulse ? 0 : 1)
                Button(action: workout.start) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 31, weight: .black))
                        .foregroundColor(PaserStyle.ink)
                        .frame(width: 66, height: 66)
                        .background(Circle().fill(PaserStyle.pink))
                        .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 3))
                        .shadow(color: PaserStyle.pink.opacity(0.65), radius: 9)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Start run")
            }
            Text("START RUN")
                .font(.system(size: 16, weight: .black, design: .rounded)).tracking(1.2)
            Text("Recorded on this watch")
                .font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundColor(PaserStyle.muted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9).padding(.vertical, 7)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

struct CountdownView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var spin = false

    var body: some View {
        ZStack {
            AngularGradient(gradient: Gradient(colors: [PaserStyle.pink, PaserStyle.teal, PaserStyle.pink]), center: .center)
                .mask(Circle().stroke(lineWidth: 7))
                .frame(width: 114, height: 114)
                .rotationEffect(.degrees(spin ? 360 : 0))
            VStack(spacing: 0) {
                Text("GET READY").font(.system(size: 11, weight: .black, design: .rounded)).tracking(1.4).foregroundColor(PaserStyle.teal)
                Text("\(workout.countdown)")
                    .font(.system(size: 66, weight: .black, design: .rounded)).foregroundColor(PaserStyle.cream)
                    .id(workout.countdown).transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.58), value: workout.countdown)
        .onAppear { withAnimation(.linear(duration: 2.8)) { spin = true } }
    }
}

struct WorkoutPages: View {
    var body: some View {
        TabView { PrimaryMetricsView(); DetailMetricsView(); ControlsView() }
            .tabViewStyle(.page(indexDisplayMode: .always))
    }
}

struct PrimaryMetricsView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        VStack(spacing: 4) {
            RunHeader()
            Text("DISTANCE").metricLabel()
            HStack(alignment: .lastTextBaseline, spacing: 3) {
                Text(workout.distanceText)
                    .font(.system(size: 47, weight: .black, design: .rounded)).foregroundColor(PaserStyle.cream)
                    .minimumScaleFactor(0.7).monospacedDigit()
                Text("KM").font(.system(size: 11, weight: .black, design: .rounded)).foregroundColor(PaserStyle.pink)
            }
            HStack(spacing: 6) {
                MiniMetric(label: "TIME", value: workout.elapsedText, accent: PaserStyle.teal)
                MiniMetric(label: "PACE", value: workout.pace, accent: PaserStyle.yellow)
            }
        }
        .padding(.horizontal, 8).padding(.bottom, 9)
    }
}

struct DetailMetricsView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var heartPulse = false
    var body: some View {
        VStack(spacing: 9) {
            RunHeader()
            HStack(spacing: 7) {
                Image(systemName: "heart.fill")
                    .foregroundColor(PaserStyle.pink).scaleEffect(heartPulse ? 1.12 : 0.9)
                Text(workout.heartRateText).font(.system(size: 43, weight: .black, design: .rounded)).monospacedDigit()
                Text("BPM").font(.system(size: 10, weight: .black, design: .rounded)).foregroundColor(PaserStyle.muted)
            }
            MetricCard(label: "AVERAGE PACE", value: workout.pace + (workout.pace == RunState.empty ? "" : " /KM"))
            Text("Swipe for controls").font(.system(size: 9, weight: .semibold, design: .rounded)).foregroundColor(PaserStyle.muted)
        }
        .padding(.horizontal, 9).padding(.bottom, 9)
        .onAppear { withAnimation(.easeInOut(duration: 0.7).repeatForever()) { heartPulse = true } }
    }
}

struct ControlsView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        VStack(spacing: 10) {
            RunHeader()
            HStack(spacing: 14) {
                RoundControl(icon: workout.phase == .paused ? "play.fill" : "pause.fill",
                             label: workout.phase == .paused ? "RESUME" : "PAUSE",
                             color: workout.phase == .paused ? PaserStyle.teal : PaserStyle.yellow) {
                    workout.phase == .paused ? workout.resume() : workout.pause()
                }
                HoldFinishButton(action: workout.finish)
            }
            Text("Hold Finish to save").font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundColor(PaserStyle.muted)
        }
        .padding(.horizontal, 10).padding(.bottom, 10)
    }
}

struct SavingView: View {
    @State private var spin = false
    var body: some View {
        VStack(spacing: 13) {
            ZStack {
                Circle().stroke(PaserStyle.card, lineWidth: 8)
                Circle().trim(from: 0.05, to: 0.72)
                    .stroke(AngularGradient(gradient: Gradient(colors: [PaserStyle.pink, PaserStyle.teal]), center: .center), style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(spin ? 360 : 0))
            }.frame(width: 72, height: 72)
            Text("SAVING RUN").font(.system(size: 16, weight: .black, design: .rounded)).tracking(1)
            Text("Keeping your route safe").font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundColor(PaserStyle.muted)
        }
        .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { spin = true } }
    }
}

struct SummaryView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var celebrate = false
    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ZStack {
                    ForEach(0..<8, id: \.self) { index in
                        Capsule().fill(index.isMultiple(of: 2) ? PaserStyle.pink : PaserStyle.teal)
                            .frame(width: 3, height: 13).offset(y: celebrate ? -43 : -22)
                            .rotationEffect(.degrees(Double(index) * 45)).opacity(celebrate ? 0 : 1)
                    }
                    Image(systemName: "checkmark").font(.system(size: 27, weight: .black)).foregroundColor(PaserStyle.ink)
                        .frame(width: 50, height: 50).background(Circle().fill(PaserStyle.teal))
                }
                Text("RUN SAVED").font(.system(size: 19, weight: .black, design: .rounded)).tracking(1)
                Text(workout.distanceText + " KM").font(.system(size: 32, weight: .black, design: .rounded)).foregroundColor(PaserStyle.pink).monospacedDigit()
                HStack(spacing: 6) {
                    MiniMetric(label: "TIME", value: workout.elapsedText, accent: PaserStyle.teal)
                    MiniMetric(label: "PACE", value: workout.pace, accent: PaserStyle.yellow)
                }
                Button("DONE", action: workout.reset).font(.system(size: 13, weight: .black, design: .rounded)).buttonStyle(PaserCapsuleStyle(color: PaserStyle.cream))
            }.padding(.horizontal, 9).padding(.vertical, 8)
        }
        .onAppear { withAnimation(.easeOut(duration: 0.8)) { celebrate = true } }
    }
}

struct ErrorView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        VStack(spacing: 9) {
            PaserMark()
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 32, weight: .bold)).foregroundColor(PaserStyle.yellow)
            Text("RUN NOT STARTED").font(.system(size: 15, weight: .black, design: .rounded))
            Text(workout.errorMessage).font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundColor(PaserStyle.muted).multilineTextAlignment(.center)
            Button("TRY AGAIN", action: workout.reset).font(.system(size: 12, weight: .black, design: .rounded)).buttonStyle(PaserCapsuleStyle(color: PaserStyle.pink))
        }.padding(10)
    }
}

private struct RunHeader: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        HStack {
            PaserMark(); Spacer()
            Circle().fill(workout.phase == .paused ? PaserStyle.yellow : PaserStyle.green).frame(width: 6, height: 6)
            Text(workout.phase == .paused ? "PAUSED" : "LIVE")
                .font(.system(size: 9, weight: .black, design: .rounded)).foregroundColor(workout.phase == .paused ? PaserStyle.yellow : PaserStyle.green)
        }
    }
}

private struct PaserMark: View {
    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(PaserStyle.pink).frame(width: 7, height: 13).rotationEffect(.degrees(12))
            Text("PASER").font(.system(size: 12, weight: .black, design: .rounded)).tracking(1)
        }
    }
}

private struct SignalPill: View {
    let ready: Bool
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "location.fill").font(.system(size: 8, weight: .bold))
            Text(ready ? "GPS READY" : "FINDING GPS").font(.system(size: 8, weight: .black, design: .rounded))
        }.foregroundColor(ready ? PaserStyle.green : PaserStyle.yellow).padding(.horizontal, 6).padding(.vertical, 4).background(Capsule().fill(PaserStyle.card))
    }
}

private struct MiniMetric: View {
    let label: String; let value: String; let accent: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 8, weight: .black, design: .rounded)).foregroundColor(PaserStyle.ink.opacity(0.62))
            Text(value).font(.system(size: 17, weight: .black, design: .rounded)).foregroundColor(PaserStyle.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
        }.padding(.horizontal, 8).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(accent))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(PaserStyle.cream, lineWidth: 1.5))
    }
}

private struct MetricCard: View {
    let label: String; let value: String
    var body: some View {
        HStack {
            Text(label).font(.system(size: 9, weight: .black, design: .rounded)).foregroundColor(PaserStyle.muted)
            Spacer()
            Text(value).font(.system(size: 14, weight: .black, design: .rounded)).foregroundColor(PaserStyle.teal).monospacedDigit()
        }.padding(9).background(RoundedRectangle(cornerRadius: 10).fill(PaserStyle.card))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PaserStyle.cream.opacity(0.25), lineWidth: 1))
    }
}

private struct RoundControl: View {
    let icon: String; let label: String; let color: Color; let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 23, weight: .black)).foregroundColor(PaserStyle.ink).frame(width: 58, height: 58)
                    .background(Circle().fill(color)).overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                Text(label).font(.system(size: 9, weight: .black, design: .rounded))
            }
        }.buttonStyle(.plain)
    }
}

private struct HoldFinishButton: View {
    let action: () -> Void
    @State private var holding = false
    var body: some View {
        VStack(spacing: 5) {
            ZStack {
                Circle().fill(PaserStyle.card)
                Circle().trim(from: 0, to: holding ? 1 : 0).stroke(PaserStyle.pink, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Image(systemName: "stop.fill").font(.system(size: 21, weight: .black)).foregroundColor(PaserStyle.cream)
            }.frame(width: 58, height: 58)
            Text("FINISH").font(.system(size: 9, weight: .black, design: .rounded))
        }.contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 1) { holding = false; action() } onPressingChanged: { pressing in
                if pressing { withAnimation(.linear(duration: 1)) { holding = true } }
                else { withAnimation(.easeOut(duration: 0.2)) { holding = false } }
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("Finish run")
            .accessibilityHint("Press and hold to save the run").accessibilityAddTraits(.isButton).accessibilityAction(action)
    }
}

private struct PaserCapsuleStyle: ButtonStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundColor(PaserStyle.ink).frame(maxWidth: .infinity).padding(.vertical, 8)
            .background(Capsule().fill(color)).overlay(Capsule().stroke(PaserStyle.cream, lineWidth: 2))
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
    }
}

private extension View {
    func metricLabel() -> some View { font(.system(size: 10, weight: .black, design: .rounded)).tracking(1.4).foregroundColor(PaserStyle.muted) }
}

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
