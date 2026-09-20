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
    /// open. The phone uses this durable payload to raise the attack prompt.
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
