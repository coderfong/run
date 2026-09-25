import Foundation
import Combine
import WatchConnectivity

/// The watch end of the link to PASER on the iPhone.
///
/// State only ever flows one way: the phone sends a snapshot of its run screen
/// (as an application context, which the system keeps for the next launch, and
/// as a live message while this app is on screen), and this publishes it. The
/// watch never keeps a run of its own. If the phone has not said so, it has
/// not happened.
///
/// Commands flow the other way as messages. Each one blocks the next until the
/// phase it was meant to cause arrives (or four seconds pass), so a double tap
/// cannot pause and resume in one go.
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneLink()
    @Published private(set) var state = RunState()
    /// When `state` arrived, on this watch's clock. The run clock counts on
    /// from here between updates.
    @Published private(set) var receivedAt = Date()
    @Published private(set) var reachable = false
    @Published private(set) var pending: RunCommand?

    private let session: WCSession? = WCSession.isSupported() ? WCSession.default : nil
    private var pendingTimer: Timer?
    private var hasState = false

    override init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    /// Asks the phone for its current state. This is also what wakes the
    /// iPhone app when it is asleep in a pocket.
    func refresh() {
        transmit(["cmd": "sync"])
        requestPortrait()
    }

    /// Asks for the runner's portrait, naming the one already on this watch so
    /// a wrist that is up to date costs nothing. The phone answers with a file
    /// transfer, which the system delivers in its own time: there is no reply
    /// to wait for and nothing on screen waits for it.
    func requestPortrait() {
        transmit(["cmd": "avatar", "have": WatchAvatarStore.shared.key])
    }

    /// A run the phone is recording right now, heard from recently. While
    /// this is true the watch mirrors and controls that run instead of
    /// starting its own: one PASER run per person. The phone re-sends its
    /// state every ten seconds while running or paused, so a minute of
    /// silence means the phone run is gone (the app was closed or died).
    var phoneRunActive: Bool {
        let live: Set<RunPhase> = [.countdown, .running, .paused, .saving]
        return live.contains(state.phase) && Date().timeIntervalSince(receivedAt) < 60
    }

    /// Tells the phone what this watch's own standalone workout is doing, so
    /// the phone refuses to start a second run beside it. Sent as the
    /// application context (the system keeps the latest for a phone app that
    /// is not running) and live when the phone is reachable.
    func reportWorkout(_ phase: String, runId: String) {
        guard let session = session, session.activationState == .activated else { return }
        let report: [String: Any] = [
            "watchWorkout": phase,
            "watchRunId": runId,
            "at": Date().timeIntervalSince1970 * 1000,
        ]
        try? session.updateApplicationContext(report)
        if session.isReachable {
            session.sendMessage(report, replyHandler: nil, errorHandler: nil)
        }
    }

    func send(_ command: RunCommand) {
        guard pending == nil, reachable else { return }
        pending = command
        pendingTimer?.invalidate()
        pendingTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            self?.pending = nil
        }
        transmit(["cmd": command.rawValue, "at": Date().timeIntervalSince1970 * 1000])
    }

    /// Delivers a standalone watch run to the phone even when PASER is not
    /// open. Durable (queued by the system), but summary numbers ONLY — the
    /// phone must not tell the runner their run is ready to claim from this
    /// alone, only that one finished and its route is on its way. The route
    /// itself is `sendRoute`, below.
    func reportFinished(distanceKM: String, time: String, pace: String) {
        guard let session = session, session.activationState == .activated else { return }
        session.transferUserInfo([
            "event": "watchRunFinished",
            "distance": distanceKM,
            "time": time,
            "pace": pace,
            "finishedAt": Date().timeIntervalSince1970,
        ])
    }

    /// Roughly once a second while a standalone workout runs or is paused:
    /// distance, elapsed time and pace, for the phone to mirror rather than
    /// compute its own. Best-effort — `sendMessage`, not
    /// `updateApplicationContext` — so a stream of these can never throttle
    /// or wake a phone that is not reachable right now; the phone simply
    /// keeps whatever it last heard until the next one lands. `state` also
    /// carries "finished" once, the moment the workout ends.
    func reportLiveState(_ state: [String: Any]) {
        guard let session = session, session.activationState == .activated, session.isReachable else { return }
        var message = state
        message["kind"] = "watchRunState"
        message["sentAt"] = Date().timeIntervalSince1970 * 1000
        session.sendMessage(message, replyHandler: nil, errorHandler: nil)
    }

    /// The finished workout's own recorded GPS points, as a file transfer —
    /// the mechanism WatchConnectivity actually means for a payload this
    /// size (a run's worth of fixes is far past what `sendMessage` or
    /// `transferUserInfo` are for). Queued by the system like `reportFinished`
    /// above: this call returning is not delivery, and it can complete long
    /// after the workout ended, including after this app process is gone.
    func sendRoute(fileURL: URL, runId: String) {
        guard let session = session, session.activationState == .activated else { return }
        session.transferFile(fileURL, metadata: ["kind": "watchRunRoute", "runId": runId])
    }

    private func transmit(_ message: [String: Any]) {
        guard let session = session, session.activationState == .activated, session.isReachable else {
            return
        }
        session.sendMessage(message, replyHandler: { [weak self] reply in
            DispatchQueue.main.async { self?.apply(reply) }
        }, errorHandler: { [weak self] _ in
            DispatchQueue.main.async { self?.clearPending() }
        })
    }

    private func clearPending() {
        pending = nil
        pendingTimer?.invalidate()
        pendingTimer = nil
    }

    /// Main queue only.
    private func apply(_ dict: [String: Any]) {
        guard let next = RunState(dict), next.seq >= state.seq else { return }
        let previous = state
        state = next
        receivedAt = Date()
        if next.phase != previous.phase { clearPending() }
        // The first state after launch is catching up, not news: no buzz for
        // a run that started before the app was opened.
        if hasState { Haptics.play(from: previous, to: next) }
        hasState = true
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let context = session.receivedApplicationContext
        let reachable = session.isReachable
        DispatchQueue.main.async {
            self.reachable = reachable
            if !context.isEmpty { self.apply(context) }
            self.refresh()
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        DispatchQueue.main.async {
            self.reachable = reachable
            if reachable {
                self.refresh()
            } else {
                self.clearPending()
            }
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async { self.apply(applicationContext) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async { self.apply(message) }
    }

    /// The runner's portrait. File transfers are queued by the system and
    /// arrive whenever they arrive, including while this app is not running,
    /// so this is the only place a new face can land. `file.fileURL` is the
    /// system's copy and is deleted as soon as this returns, which is why the
    /// store moves it before doing anything else.
    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["kind"] as? String == "avatar" else { return }
        let key = file.metadata?["key"] as? String ?? ""
        WatchAvatarStore.shared.receive(from: file.fileURL, key: key)
    }
}
