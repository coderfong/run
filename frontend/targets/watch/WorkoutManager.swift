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
    private var countdownTimer: Timer?
    private let maximumRunningSpeed: CLLocationSpeed = 8.5

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.activityType = .fitness
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 3
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()
    }

    var pace: String {
        guard distance >= 20, elapsed > 0 else { return RunState.empty }
        let secondsPerKm = elapsed / (distance / 1000)
        guard secondsPerKm.isFinite, secondsPerKm < 3600 else { return RunState.empty }
        return String(format: "%d:%02d", Int(secondsPerKm) / 60, Int(secondsPerKm) % 60)
    }
    var distanceText: String { String(format: "%.2f", distance / 1000) }
    var elapsedText: String { RunFormat.clock(elapsed) }
    var heartRateText: String { heartRate > 0 ? String(Int(heartRate.rounded())) : RunState.empty }

    func start() {
        guard phase == .ready || phase == .error else { return }
        guard HKHealthStore.isHealthDataAvailable() else { fail("Workouts are not available on this watch."); return }
        let workout = HKObjectType.workoutType()
        let route = HKSeriesType.workoutRoute()
        let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        healthStore.requestAuthorization(toShare: [workout, route], read: [heartRate]) { [weak self] allowed, error in
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
            pausedDuration = 0
            elapsed = 0
            distance = 0
            heartRate = 0
            lastLocation = nil
            session.startActivity(with: now)
            builder.beginCollection(withStart: now) { _, _ in }
            locationManager.startUpdatingLocation()
            phase = .running
            startClock()
            WKInterfaceDevice.current().play(.start)
        } catch { fail("PASER could not start the workout.") }
    }

    func pause() {
        guard phase == .running else { return }
        workoutSession?.pause()
        pausedAt = Date()
        phase = .paused
        lastLocation = nil
        WKInterfaceDevice.current().play(.stop)
    }

    func resume() {
        guard phase == .paused else { return }
        if let pausedAt = pausedAt { pausedDuration += Date().timeIntervalSince(pausedAt) }
        self.pausedAt = nil
        workoutSession?.resume()
        phase = .running
        WKInterfaceDevice.current().play(.start)
    }

    func finish() {
        guard phase == .running || phase == .paused else { return }
        if let pausedAt = pausedAt { pausedDuration += Date().timeIntervalSince(pausedAt) }
        self.pausedAt = nil
        phase = .saving
        stopClock()
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
        elapsed = 0; distance = 0; heartRate = 0; errorMessage = ""
        phase = .ready
        locationManager.startUpdatingLocation()
    }

    private func startClock() {
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, let start = self.startedAt else { return }
            let activePause = self.pausedAt.map { Date().timeIntervalSince($0) } ?? 0
            self.elapsed = max(0, Date().timeIntervalSince(start) - self.pausedDuration - activePause)
        }
    }
    private func stopClock() { clock?.invalidate(); clock = nil }
    private func showSummary() {
        phase = .summary
        PhoneLink.shared.reportFinished(distanceKM: distanceText, time: elapsedText, pace: pace)
        WKInterfaceDevice.current().play(.success)
    }
    private func fail(_ message: String) { stopClock(); errorMessage = message; phase = .error; WKInterfaceDevice.current().play(.failure) }
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
                if delta >= 1 { distance += delta }
            }
            lastLocation = location
            accepted.append(location)
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
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate), collectedTypes.contains(type),
              let quantity = workoutBuilder.statistics(for: type)?.mostRecentQuantity() else { return }
        let unit = HKUnit.count().unitDivided(by: .minute())
        DispatchQueue.main.async { self.heartRate = quantity.doubleValue(for: unit) }
    }
}
