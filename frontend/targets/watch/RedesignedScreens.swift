import SwiftUI

// MARK: - Redesigned Ready Screen

struct ReadyView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    
    var body: some View {
        VStack(spacing: 12) {
            // Compact status header
            StatusHeader(showGPS: true, gpsState: workout.gpsReady ? .ready : .searching)
            
            Spacer()
            
            // PASER character head as hero
            ZStack {
                // Gradient halo ring
                Circle()
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(colors: [PaserStyle.pink.opacity(0.5), PaserStyle.teal.opacity(0.3)]),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 4
                    )
                    .frame(width: 120, height: 120)
                    .scaleEffect(pulse ? 1.1 : 0.95)
                    .opacity(pulse ? 0.6 : 1.0)
                
                // PASER character head
                PaserAvatarHead(size: 90)
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 2.0).repeatForever(autoreverses: false)) {
                    pulse = true
                }
            }
            
            // Ready prompt
            Text("READY?")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .tracking(1.5)
                .foregroundColor(PaserStyle.cream)
            
            // Start button
            Button(action: {
                Haptics.lightTap()
                workout.start()
            }) {
                Text("START RUN")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .tracking(1.2)
                    .foregroundColor(PaserStyle.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(PaserStyle.pink)
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(PaserStyle.cream, lineWidth: 3))
                    )
                    .shadow(color: PaserStyle.pink.opacity(0.5), radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .accessibleTouchTarget()
            
            // GPS status text
            Text(workout.gpsReady ? "GPS READY" : "FINDING GPS")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(workout.gpsReady ? PaserStyle.green : PaserStyle.yellow)
            
            Text("Recorded on this watch")
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundColor(PaserStyle.muted)
            
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Redesigned Countdown

struct CountdownView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale = 0.7
    
    var body: some View {
        ZStack {
            // Countdown ring
            PaserRing(
                progress: Double(4 - workout.countdown) / 3.0,
                size: 140,
                lineWidth: 6
            )
            
            VStack(spacing: 8) {
                Text("GET READY")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .tracking(1.4)
                    .foregroundColor(PaserStyle.teal)
                
                // Countdown number
                Text(workout.countdown == 0 ? "GO!" : "\(workout.countdown)")
                    .font(.system(size: 72, weight: .black, design: .rounded))
                    .foregroundColor(PaserStyle.cream)
                    .id(workout.countdown)
                    .transition(.scale.combined(with: .opacity))
                    .scaleEffect(scale)
                
                // Small PASER head during countdown
                PaserAvatarHead(size: 40)
                    .opacity(0.6)
            }
        }
        .animation(PaserMotion.spring, value: workout.countdown)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(PaserMotion.spring) {
                scale = 1.05
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                withAnimation(PaserMotion.spring) {
                    scale = 1.0
                }
            }
        }
    }
}

// MARK: - Swipeable Active Run Pages

struct ActiveRunPager: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var currentPage = 0
    
    var body: some View {
        TabView(selection: $currentPage) {
            PrimaryRunPage()
                .tag(0)
            
            StatsPage()
                .tag(1)
            
            ControlsPage()
                .tag(2)
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
        VStack(spacing: 16) {
            StatusHeader(showGPS: true, gpsState: .ready)
            
            Spacer()
            
            // Large distance as hero
            LargeMetric(
                label: "DISTANCE",
                value: workout.distanceText,
                unit: "KM",
                color: PaserStyle.cream
            )
            .metricAccessibility(label: "Distance", value: workout.distanceText, unit: "kilometers")
            
            // Secondary metrics row
            HStack(spacing: 12) {
                CompactMetric(
                    label: "TIME",
                    value: workout.elapsedText,
                    color: PaserStyle.teal
                )
                .metricAccessibility(label: "Time", value: workout.elapsedText)
                
                CompactMetric(
                    label: "PACE",
                    value: workout.pace + "/KM",
                    color: PaserStyle.yellow
                )
                .metricAccessibility(label: "Pace", value: workout.pace, unit: "per kilometer")
            }
            
            // Small avatar in corner
            HStack {
                PaserAvatarHead(size: 32)
                Spacer()
            }
            
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

// MARK: - Stats Page (Secondary Metrics)

struct StatsPage: View {
    @EnvironmentObject private var workout: WorkoutManager
    
    var body: some View {
        VStack(spacing: 12) {
            StatusHeader(showGPS: false, gpsState: .ready)
            
            Text("RUN STATS")
                .font(.system(size: 14, weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
                .padding(.top, 8)
            
            VStack(spacing: 10) {
                StatCard(label: "AVG PACE", value: workout.pace + "/KM")
                
                if workout.heartRate > 0 {
                    StatCard(label: "HEART RATE", value: workout.heartRateText + " BPM")
                }
            }
            
            Spacer()
            
            Text("Swipe for controls")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
                .padding(.bottom, 8)
        }
        .padding(.horizontal, 14)
    }
}

// MARK: - Controls Page (Dedicated Controls)

struct ControlsPage: View {
    @EnvironmentObject private var workout: WorkoutManager
    
    var body: some View {
        VStack(spacing: 20) {
            StatusHeader(showGPS: false, gpsState: .ready)
            
            Spacer()
            
            Text("CONTROLS")
                .font(.system(size: 16, weight: .black, design: .rounded))
                .tracking(1.5)
                .foregroundColor(PaserStyle.muted)
            
            // Large pause/resume button
            Button(action: {
                WKInterfaceDevice.current().play(.click)
                if workout.phase == .paused {
                    workout.resume()
                } else {
                    workout.pause()
                }
            }) {
                HStack(spacing: 8) {
                    Image(systemName: workout.phase == .paused ? "play.fill" : "pause.fill")
                        .font(.system(size: 20, weight: .black))
                    Text(workout.phase == .paused ? "RESUME" : "PAUSE")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                }
                .foregroundColor(PaserStyle.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(workout.phase == .paused ? PaserStyle.teal : PaserStyle.yellow)
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(PaserStyle.cream, lineWidth: 3))
                )
            }
            .buttonStyle(.plain)
            
            // Hold to finish button
            HoldToFinishButton(action: workout.finish)
            
            Spacer()
        }
        .padding(.horizontal, 14)
    }
}

// MARK: - Hold to Finish Button

struct HoldToFinishButton: View {
    let action: () -> Void
    @State private var holding = false
    @State private var progress: Double = 0
    
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                // Background ring
                Circle()
                    .fill(PaserStyle.card)
                    .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                    .frame(width: 60, height: 60)
                
                // Progress ring
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(PaserStyle.pink, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 60, height: 60)
                
                // Stop icon
                Image(systemName: "stop.fill")
                    .font(.system(size: 24, weight: .black))
                    .foregroundColor(PaserStyle.cream)
            }
            
            Text("PRESS & HOLD TO END")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.muted)
        }
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1.5, pressing: { pressing in
            if pressing {
                withAnimation(.linear(duration: 1.5)) {
                    progress = 1.0
                }
            } else {
                withAnimation(.easeOut(duration: 0.2)) {
                    progress = 0
                }
            }
        }) {
            // Completion
            if progress >= 0.95 {
                WKInterfaceDevice.current().play(.success)
                action()
            }
        }
    }
}

// MARK: - Redesigned Paused State

struct PausedView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    
    var body: some View {
        VStack(spacing: 16) {
            StatusHeader(showGPS: false, gpsState: .ready)
            
            Spacer()
            
            // Paused indicator
            Circle()
                .fill(PaserStyle.yellow)
                .frame(width: 12, height: 12)
            
            Text("PAUSED")
                .font(.system(size: 28, weight: .black, design: .rounded))
                .tracking(1.5)
                .foregroundColor(PaserStyle.yellow)
            
            // Elapsed time
            Text(workout.elapsedText)
                .font(.system(size: 42, weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.cream)
                .monospacedDigit()
            
            // Small avatar
            PaserAvatarHead(size: 50)
                .opacity(0.7)
            
            // Resume button
            Button(action: {
                WKInterfaceDevice.current().play(.start)
                workout.resume()
            }) {
                Text("RESUME RUN")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .tracking(1.2)
                    .foregroundColor(PaserStyle.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(PaserStyle.teal)
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(PaserStyle.cream, lineWidth: 3))
                    )
            }
            .buttonStyle(.plain)
            
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(PaserStyle.background.opacity(0.8))
    }
}

// MARK: - Redesigned Saving View

struct SavingView: View {
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @State private var progress = 0.0
    
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            
            // PASER avatar with saving ring
            ZStack {
                PaserAvatarHead(size: 80)
                
                AnimatedRing(size: 140, lineWidth: 6)
            }
            
            Text("SAVING RUN…")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.cream)
            
            Spacer()
        }
        .padding(.horizontal, 14)
    }
}

// MARK: - Redesigned Post-Run Pager

struct PostRunPager: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @State private var currentPage = 0
    
    var body: some View {
        TabView(selection: $currentPage) {
            CelebrationPage()
                .tag(0)
            
            ResultsPage()
                .tag(1)
            
            ClaimHandoffPage()
                .tag(2)
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
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @State private var celebrate = false
    
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            
            // Large PASER avatar
            PaserAvatarHead(size: 100)
                .scaleEffect(celebrate ? 1.1 : 0.8)
                .animation(PaserMotion.spring, value: celebrate)
            
            // Success checkmark
            ZStack {
                Circle()
                    .fill(PaserStyle.teal)
                    .frame(width: 50, height: 50)
                    .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                
                Image(systemName: "checkmark")
                    .font(.system(size: 28, weight: .black))
                    .foregroundColor(PaserStyle.ink)
            }
            .scaleEffect(celebrate ? 1.0 : 0.5)
            .animation(PaserMotion.spring.delay(0.2), value: celebrate)
            
            Text("RUN SAVED")
                .font(.system(size: 20, weight: .black, design: .rounded))
                .tracking(1.5)
                .foregroundColor(PaserStyle.cream)
                .opacity(celebrate ? 1.0 : 0.0)
                .animation(PaserMotion.fade.delay(0.3), value: celebrate)
            
            // Distance
            Text(workout.distanceText + " KM")
                .font(.system(size: 36, weight: .black, design: .rounded))
                .foregroundColor(PaserStyle.pink)
                .monospacedDigit()
                .opacity(celebrate ? 1.0 : 0.0)
                .animation(PaserMotion.fade.delay(0.4), value: celebrate)
            
            Spacer()
        }
        .padding(.horizontal, 14)
        .onAppear {
            celebrate = true
            WKInterfaceDevice.current().play(.success)
        }
    }
}

// MARK: - Results Page

struct ResultsPage: View {
    @EnvironmentObject private var workout: WorkoutManager
    
    var body: some View {
        VStack(spacing: 16) {
            StatusHeader(showGPS: false, gpsState: .ready)
            
            Text("YOUR RUN")
                .font(.system(size: 16, weight: .black, design: .rounded))
                .tracking(1.2)
                .foregroundColor(PaserStyle.muted)
                .padding(.top, 8)
            
            VStack(spacing: 12) {
                StatCard(label: "TIME", value: workout.elapsedText)
                StatCard(label: "AVG PACE", value: workout.pace + "/KM")
            }
            
            Spacer()
        }
        .padding(.horizontal, 14)
    }
}

// MARK: - Claim Handoff Page

struct ClaimHandoffPage: View {
    @EnvironmentObject private var workout: WorkoutManager
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    
    var body: some View {
        VStack(spacing: 16) {
            StatusHeader(showGPS: false, gpsState: .ready)
            
            Spacer()
            
            // PASER avatar
            PaserAvatarHead(size: 80)
            
            // Success badge
            HStack(spacing: 6) {
                Circle()
                    .fill(PaserStyle.green)
                    .frame(width: 8, height: 8)
                Text("RUN SYNCED")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .foregroundColor(PaserStyle.green)
            }
            
            Text("READY TO CLAIM")
                .font(.system(size: 16, weight: .black, design: .rounded))
                .tracking(1.0)
                .foregroundColor(PaserStyle.cream)
            
            // Territory animation placeholder
            RoundedRectangle(cornerRadius: 8)
                .stroke(PaserStyle.teal, lineWidth: 2)
                .frame(width: 60, height: 60)
                .overlay(
                    Image(systemName: "location.fill")
                        .font(.system(size: 24))
                        .foregroundColor(PaserStyle.teal)
                )
            
            Text("OPEN PASER ON IPHONE")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(PaserStyle.teal)
            
            Text("PLAN YOUR ATTACK")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(PaserStyle.muted)
            
            // Done button
            Button("DONE", action: workout.reset)
                .font(.system(size: 13, weight: .black, design: .rounded))
                .buttonStyle(PaserCapsuleStyle(color: PaserStyle.cream))
            
            Spacer()
        }
        .padding(.horizontal, 14)
    }
}
