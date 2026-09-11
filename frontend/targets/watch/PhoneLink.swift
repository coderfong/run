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
}
