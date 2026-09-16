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
        PrimaryMetricsView()
    }
}

struct PrimaryMetricsView: View {
    @EnvironmentObject private var workout: WorkoutManager
    var body: some View {
        GeometryReader { proxy in
            let compact = proxy.size.height < 225
            VStack(spacing: compact ? 3 : 5) {
                RunHeader()
                HStack(alignment: .center, spacing: 6) {
                    RunnerHead(size: compact ? 38 : 43)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("DISTANCE").metricLabel()
                        HStack(alignment: .lastTextBaseline, spacing: 2) {
                            Text(workout.distanceText)
                                .font(.system(size: compact ? 35 : 41, weight: .black, design: .rounded))
                                .foregroundColor(PaserStyle.cream).lineLimit(1).minimumScaleFactor(0.65).monospacedDigit()
                            Text("KM").font(.system(size: 9, weight: .black, design: .rounded)).foregroundColor(PaserStyle.pink)
                        }
                    }
                }
                HStack(spacing: 5) {
                    MiniMetric(label: "TIME", value: workout.elapsedText, accent: PaserStyle.teal)
                    MiniMetric(label: "PACE /KM", value: workout.pace, accent: PaserStyle.yellow)
                    MiniMetric(label: "HEART", value: workout.heartRateText, accent: PaserStyle.pink)
                }
                HStack(spacing: 10) {
                    CompactControl(icon: workout.phase == .paused ? "play.fill" : "pause.fill",
                                   label: workout.phase == .paused ? "RESUME" : "PAUSE",
                                   color: workout.phase == .paused ? PaserStyle.teal : PaserStyle.yellow) {
                        workout.phase == .paused ? workout.resume() : workout.pause()
                    }
                    HoldFinishButton(action: workout.finish)
                }
            }
            .padding(.horizontal, 7).padding(.top, 2).padding(.bottom, 4)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
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
        GeometryReader { proxy in
            VStack(spacing: proxy.size.height < 225 ? 4 : 6) {
                HStack(spacing: 7) {
                    RunnerHead(size: 42)
                ZStack {
                    ForEach(0..<8, id: \.self) { index in
                        Capsule().fill(index.isMultiple(of: 2) ? PaserStyle.pink : PaserStyle.teal)
                            .frame(width: 3, height: 11).offset(y: celebrate ? -31 : -18)
                            .rotationEffect(.degrees(Double(index) * 45)).opacity(celebrate ? 0 : 1)
                    }
                    Image(systemName: "checkmark").font(.system(size: 22, weight: .black)).foregroundColor(PaserStyle.ink)
                        .frame(width: 42, height: 42).background(Circle().fill(PaserStyle.teal))
                        .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                }
                }
                Text("RUN SAVED").font(.system(size: 17, weight: .black, design: .rounded)).tracking(1)
                Text(workout.distanceText + " KM").font(.system(size: 29, weight: .black, design: .rounded)).foregroundColor(PaserStyle.pink).monospacedDigit()
                HStack(spacing: 6) {
                    MiniMetric(label: "TIME", value: workout.elapsedText, accent: PaserStyle.teal)
                    MiniMetric(label: "PACE", value: workout.pace, accent: PaserStyle.yellow)
                }
                Text("PLAN YOUR ATTACK ON PHONE")
                    .font(.system(size: 8, weight: .black, design: .rounded)).tracking(0.5).foregroundColor(PaserStyle.teal)
                Button("DONE", action: workout.reset).font(.system(size: 13, weight: .black, design: .rounded)).buttonStyle(PaserCapsuleStyle(color: PaserStyle.cream))
            }.padding(.horizontal, 8).padding(.vertical, 3)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
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

private struct RunnerHead: View {
    let size: CGFloat
    @EnvironmentObject private var phoneLink: PhoneLink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blink = false
    @State private var bob = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.27).fill(PaserStyle.teal)
                .offset(x: 3, y: 3)
            RoundedRectangle(cornerRadius: size * 0.27).fill(PaserStyle.cream)
                .overlay(RoundedRectangle(cornerRadius: size * 0.27).stroke(PaserStyle.ink, lineWidth: 3))
            // Hair, headband and glasses stay attached as one animated bust.
            RoundedRectangle(cornerRadius: size * 0.12)
                .fill(phoneLink.state.accent).frame(height: size * 0.28).offset(y: -size * 0.34)
            Rectangle().fill(PaserStyle.yellow).frame(height: size * 0.10).offset(y: -size * 0.22)
            HStack(spacing: size * 0.08) {
                eye; eye
            }.offset(y: -size * 0.01)
            HStack(spacing: size * 0.02) {
                Circle().stroke(PaserStyle.ink, lineWidth: 2).frame(width: size * 0.25, height: size * 0.22)
                Rectangle().fill(PaserStyle.ink).frame(width: size * 0.08, height: 2)
                Circle().stroke(PaserStyle.ink, lineWidth: 2).frame(width: size * 0.25, height: size * 0.22)
            }.offset(y: -size * 0.01)
            Capsule().fill(PaserStyle.ink).frame(width: size * 0.27, height: 3).offset(y: size * 0.23)
        }
        .frame(width: size, height: size)
        .rotationEffect(.degrees(bob ? 3 : -3)).offset(y: bob ? -1 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.65).repeatForever(autoreverses: true)) { bob = true }
            withAnimation(.easeInOut(duration: 0.12).repeatForever(autoreverses: true).delay(1.8)) { blink = true }
        }
    }

    private var eye: some View {
        Capsule().fill(PaserStyle.ink).frame(width: size * 0.22, height: blink ? 2 : size * 0.15)
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
            Text(label).font(.system(size: 7, weight: .black, design: .rounded)).foregroundColor(PaserStyle.ink.opacity(0.7)).lineLimit(1)
            Text(value).font(.system(size: 14, weight: .black, design: .rounded)).foregroundColor(PaserStyle.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.55)
        }.padding(.horizontal, 6).padding(.vertical, 5).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 7).fill(accent))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(PaserStyle.ink, lineWidth: 2))
            .shadow(color: PaserStyle.cream.opacity(0.55), radius: 0, x: 2, y: 2)
    }
}

private struct CompactControl: View {
    let icon: String; let label: String; let color: Color; let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 12, weight: .black))
                Text(label).font(.system(size: 9, weight: .black, design: .rounded))
            }.foregroundColor(PaserStyle.ink).frame(maxWidth: .infinity).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(color))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PaserStyle.ink, lineWidth: 2))
        }.buttonStyle(.plain)
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
        HStack(spacing: 5) {
            ZStack {
                Circle().fill(PaserStyle.card).overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                Circle().trim(from: 0, to: holding ? 1 : 0).stroke(PaserStyle.pink, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Image(systemName: "stop.fill").font(.system(size: 21, weight: .black)).foregroundColor(PaserStyle.cream)
            }.frame(width: 29, height: 29)
            Text("FINISH").font(.system(size: 9, weight: .black, design: .rounded))
        }.frame(maxWidth: .infinity).contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 1) { holding = false; action() } onPressingChanged: { pressing in
                if pressing { withAnimation(.linear(duration: 1)) { holding = true } }
                else { withAnimation(.easeOut(duration: 0.2)) { holding = false } }
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("Finish run")
            // Trailing closure on purpose: accessibilityAction(action) resolves to the named: overload and does not compile.
            .accessibilityHint("Press and hold to save the run").accessibilityAddTraits(.isButton).accessibilityAction { action() }
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
