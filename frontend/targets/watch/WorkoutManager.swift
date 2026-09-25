import Combine
import CoreLocation
import Foundation
import HealthKit
import WatchKit

enum WatchRunPhase { case ready, countdown, running, paused, saving, summary, error }

/// A complete run recorder that lives on the watch. The phone link is useful
/// for syncing PASER, but it is never required to start, pause, or save a run.
final class WorkoutManager: NSObject, ObservableObject {
    @Published private(set) var phase: WatchRunPhase = .ready
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var distance: CLLocationDistance = 0
    @Published private(set) var heartRate: Double = 0
    @Published private(set) var activeCalories: Double = 0
    @Published private(set) var elevationGain: Double = 0
    @Published private(set) var currentSpeed: Double = 0
    @Published private(set) var gpsReady = false
    @Published private(set) var countdown = 3
    @Published private(set) var errorMessage = ""

    private let healthStore = HKHealthStore()
    private let locationManager = CLLocationManager()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private var lastLocation: CLLocation?
    private var startedAt: Date?
    private var pausedAt: Date?
    private var pausedDuration: TimeInterval = 0
    private var clock: Timer?
    /// This workout's id, reported to the phone with its phase.
    private var runId = UUID().uuidString
    private var lastReportAt = Date.distantPast
    private var countdownTimer: Timer?
    private let maximumRunningSpeed: CLLocationSpeed = 8.5
    /// Every accepted fix, in the shape PASER's own API points take — the
    /// same filtering that feeds `routeBuilder` (HealthKit's copy of the
    /// route), kept a second time because HealthKit's route is not something
    /// this process can read back to send to the phone. See `sendRouteToPhone`.
    private var recordedPoints: [[String: Any]] = []
    /// Monotonic counter for the live state stream to the phone, so a message
    /// delayed by a WatchConnectivity retry can never overwrite a newer one.
    private var liveSeq: Double = 0

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.activityType = .fitness
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 3
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()
    }

    /// Raw seconds-per-km, for the phone to format itself (it already has its
    /// own pace formatter, applied the same way to every other run) — never
    /// sent as this watch's own formatted string, so the two devices cannot
    /// end up rounding the same pace two different ways.
    var paceSecondsPerKm: Double? {
        guard distance >= 20, elapsed > 0 else { return nil }
        let secondsPerKm = elapsed / (distance / 1000)
        guard secondsPerKm.isFinite, secondsPerKm < 3600 else { return nil }
        return secondsPerKm
    }
    var pace: String {
        guard let s = paceSecondsPerKm else { return RunState.empty }
        return String(format: "%d:%02d", Int(s) / 60, Int(s) % 60)
    }
    /// Steps a second, for the portrait's stride (PortraitMotion.run). Real
    /// cadence needs the accelerometer; this is the run's own average speed
    /// mapped onto the range a person actually turns their legs over, which is
    /// all the picture needs to plod on a walk and drive on a sprint. Falls
    /// back to an easy jog until there is enough run to divide.
    var cadenceHz: Double {
        guard elapsed > 5, distance > 10 else { return 2.4 }
        let speed = distance / elapsed
        return min(3.2, max(1.6, 1.6 + speed * 0.35))
    }
    var distanceText: String { String(format: "%.2f", distance / 1000) }
    var elapsedText: String { RunFormat.clock(elapsed) }
    var heartRateText: String { heartRate > 0 ? String(Int(heartRate.rounded())) : RunState.empty }
    var caloriesText: String { activeCalories > 0 ? String(Int(activeCalories.rounded())) : "0" }
    var elevationText: String { "\(Int(elevationGain.rounded())) M" }
    var speedText: String { String(format: "%.1f", max(0, currentSpeed) * 3.6) }

    func start() {
        guard phase == .ready || phase == .error else { return }
        // One PASER run per person. The Ready screen already swaps to the
        // phone's run when there is one (RunScreen), so this only catches a
        // phone run that began while the Start button was on screen.
        guard !PhoneLink.shared.phoneRunActive else {
            fail("Your iPhone is already recording a run.")
            return
        }
        guard HKHealthStore.isHealthDataAvailable() else { fail("Workouts are not available on this watch."); return }
        let workout = HKObjectType.workoutType()
        let route = HKSeriesType.workoutRoute()
        let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        healthStore.requestAuthorization(toShare: [workout, route], read: [heartRate, energy]) { [weak self] allowed, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard allowed, error == nil else { self.fail("Allow Workout and Health access to record your run."); return }
                self.beginCountdown()
            }
        }
    }

    private func beginCountdown() {
        phase = .countdown
        countdown = 3
        WKInterfaceDevice.current().play(.click)
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if self.countdown > 1 {
                self.countdown -= 1
                WKInterfaceDevice.current().play(.click)
            } else {
                timer.invalidate()
                self.beginWorkout()
            }
        }
    }

    private func beginWorkout() {
        do {
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .running
            configuration.locationType = .outdoor
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            workoutSession = session
            workoutBuilder = builder
            routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
            let now = Date()
            startedAt = now
            runId = UUID().uuidString
            pausedDuration = 0
            elapsed = 0
            distance = 0
            heartRate = 0
            activeCalories = 0
            elevationGain = 0
            currentSpeed = 0
            lastLocation = nil
            recordedPoints = []
            liveSeq = 0
            session.startActivity(with: now)
            builder.beginCollection(withStart: now) { _, _ in }
            locationManager.startUpdatingLocation()
            phase = .running
            startClock()
            report("running")
            WKInterfaceDevice.current().play(.start)
        } catch { fail("PASER could not start the workout.") }
    }

    func pause() {
        guard phase == .running else { return }
        workoutSession?.pause()
        pausedAt = Date()
        phase = .paused
        report("paused")
        lastLocation = nil
        WKInterfaceDevice.current().play(.stop)
    }

    func resume() {
        guard phase == .paused else { return }
        if let pausedAt = pausedAt { pausedDuration += Date().timeIntervalSince(pausedAt) }
        self.pausedAt = nil
        workoutSession?.resume()
        phase = .running
        report("running")
        WKInterfaceDevice.current().play(.start)
    }

    func finish() {
        guard phase == .running || phase == .paused else { return }
        if let pausedAt = pausedAt { pausedDuration += Date().timeIntervalSince(pausedAt) }
        self.pausedAt = nil
        phase = .saving
        stopClock()
        report("ended")
        locationManager.stopUpdatingLocation()
        workoutSession?.end()
        let end = Date()
        workoutBuilder?.endCollection(withEnd: end) { [weak self] _, error in
            guard let self = self else { return }
            if error != nil { DispatchQueue.main.async { self.fail("Your run could not be saved.") }; return }
            self.workoutBuilder?.finishWorkout { workout, error in
                guard let workout = workout, error == nil else { DispatchQueue.main.async { self.fail("Your run could not be saved.") }; return }
                guard let routeBuilder = self.routeBuilder else { DispatchQueue.main.async { self.showSummary() }; return }
                routeBuilder.finishRoute(with: workout, metadata: nil) { _, _ in DispatchQueue.main.async { self.showSummary() } }
            }
        }
    }

    func reset() {
        workoutSession = nil; workoutBuilder = nil; routeBuilder = nil
        startedAt = nil; pausedAt = nil; pausedDuration = 0; lastLocation = nil
        elapsed = 0; distance = 0; heartRate = 0; activeCalories = 0
        elevationGain = 0; currentSpeed = 0; errorMessage = ""
        recordedPoints = []; liveSeq = 0
        phase = .ready
        locationManager.startUpdatingLocation()
    }

    /// Keeps the phone told, including a heartbeat every 30 s while the
    /// workout is live: a report that stops arriving stops blocking the phone.
    private func report(_ phase: String) {
        lastReportAt = Date()
        PhoneLink.shared.reportWorkout(phase, runId: runId)
    }

    /// Distance, elapsed time and pace, roughly once a second while the
    /// workout is running or paused — see PhoneLink.reportLiveState for why
    /// this is a best-effort message rather than the durable application
    /// context `report(_:)` above uses. The phone mirrors these numbers
    /// exactly rather than computing its own (RunningScreen's `tutorialSim` /
    /// watch-owned branch), so the two devices can never disagree.
    private func reportLiveState() {
        guard let start = startedAt else { return }
        liveSeq += 1
        var state: [String: Any] = [
            "runId": runId,
            "seq": liveSeq,
            "state": phase == .paused ? "paused" : "running",
            "startedAt": start.timeIntervalSince1970 * 1000,
            "elapsedS": elapsed,
            "distanceM": distance,
        ]
        if let pace = paceSecondsPerKm { state["paceSPerKm"] = pace }
        if let last = lastLocation {
            state["lat"] = last.coordinate.latitude
            state["lon"] = last.coordinate.longitude
        }
        PhoneLink.shared.reportLiveState(state)
    }

    private func startClock() {
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, let start = self.startedAt else { return }
            if Date().timeIntervalSince(self.lastReportAt) >= 30 {
                self.report(self.phase == .paused ? "paused" : "running")
            }
            let activePause = self.pausedAt.map { Date().timeIntervalSince($0) } ?? 0
            self.elapsed = max(0, Date().timeIntervalSince(start) - self.pausedDuration - activePause)
            self.reportLiveState()
        }
    }
    private func stopClock() { clock?.invalidate(); clock = nil }
    private func showSummary() {
        phase = .summary
        PhoneLink.shared.reportFinished(distanceKM: distanceText, time: elapsedText, pace: pace)
        PhoneLink.shared.reportLiveState([
            "runId": runId,
            "seq": liveSeq + 1,
            "state": "finished",
            "startedAt": (startedAt?.timeIntervalSince1970 ?? 0) * 1000,
            "elapsedS": elapsed,
            "distanceM": distance,
        ])
        sendRouteToPhone()
        WKInterfaceDevice.current().play(.success)
    }

    /// The completed route, handed to the phone as a file transfer — see
    /// PhoneLink.sendRoute and PhoneWatchSession's receive side. Queued by
    /// the system, so this is safe to fire even if the phone is unreachable
    /// right now; it arrives whenever it can.
    private func sendRouteToPhone() {
        guard let start = startedAt else { return }
        let end = Date()
        let payload: [String: Any] = [
            "schemaVersion": 1,
            "runId": runId,
            "source": "watch",
            "startedAt": start.timeIntervalSince1970 * 1000,
            "endedAt": end.timeIntervalSince1970 * 1000,
            "totalDistanceMeters": distance,
            "elapsedSeconds": elapsed,
            "points": recordedPoints,
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload)
        else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("paserWatchRun-\(runId).json")
        do {
            try data.write(to: url, options: .atomic)
        } catch { return }
        PhoneLink.shared.sendRoute(fileURL: url, runId: runId)
    }
    private func fail(_ message: String) {
        let wasLive = phase == .running || phase == .paused
        stopClock(); errorMessage = message; phase = .error
        if wasLive { report("ended") }
        WKInterfaceDevice.current().play(.failure)
    }
}

extension WorkoutManager: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let newest = locations.last else { return }
        gpsReady = newest.horizontalAccuracy > 0 && newest.horizontalAccuracy <= 35
        guard phase == .running else { return }
        let accurate = locations.filter {
            $0.horizontalAccuracy > 0 && $0.horizontalAccuracy <= 25 &&
            abs($0.timestamp.timeIntervalSinceNow) < 10
        }
        var accepted: [CLLocation] = []
        for location in accurate {
            if let previous = lastLocation {
                let delta = location.distance(from: previous)
                let seconds = location.timestamp.timeIntervalSince(previous.timestamp)
                guard seconds > 0 else { continue }
                let measuredSpeed = delta / seconds
                let reportedSpeed = location.speed
                let runningSpeed = reportedSpeed >= 0 ? max(measuredSpeed, reportedSpeed) : measuredSpeed

                // Reject GPS teleports and motorised travel. Keep lastLocation
                // unchanged so one bad bus sample cannot drag the route away.
                guard runningSpeed <= maximumRunningSpeed, delta <= 60 else { continue }
                currentSpeed = runningSpeed
                if delta >= 1 {
                    distance += delta
                    if location.verticalAccuracy > 0, location.verticalAccuracy <= 20,
                       previous.verticalAccuracy > 0, previous.verticalAccuracy <= 20 {
                        let climb = location.altitude - previous.altitude
                        if climb > 0, climb < 10 { elevationGain += climb }
                    }
                }
            }
            lastLocation = location
            accepted.append(location)
            // PASER's own canonical point shape (see run/watchRunImport.js
            // and toApiPoints in RunningScreen.js) — the same fields a phone
            // recording sends, so /end-run's anti-cheat runs unmodified.
            recordedPoints.append([
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
                "altitude": location.verticalAccuracy > 0 ? location.altitude : NSNull(),
                "accuracyM": location.horizontalAccuracy,
                "speedMps": location.speed >= 0 ? location.speed : NSNull(),
                "mocked": false,
            ])
        }
        if !accepted.isEmpty { routeBuilder?.insertRouteData(accepted) { _, _ in } }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { gpsReady = false }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) { DispatchQueue.main.async { self.fail("The workout ended unexpectedly.") } }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        if let type = HKQuantityType.quantityType(forIdentifier: .heartRate), collectedTypes.contains(type),
           let quantity = workoutBuilder.statistics(for: type)?.mostRecentQuantity() {
            let unit = HKUnit.count().unitDivided(by: .minute())
            DispatchQueue.main.async { self.heartRate = quantity.doubleValue(for: unit) }
        }
        if let type = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned), collectedTypes.contains(type),
           let quantity = workoutBuilder.statistics(for: type)?.sumQuantity() {
            DispatchQueue.main.async { self.activeCalories = quantity.doubleValue(for: .kilocalorie()) }
        }
    }
}
