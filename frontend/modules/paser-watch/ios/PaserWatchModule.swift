import ExpoModulesCore
import UIKit

/// JavaScript's handle on PhoneWatchSession. See src/watch/watchLink.js.
public class PaserWatchModule: Module {
  private var observing = false
  private var observingRunState = false
  private var saveTask: UIBackgroundTaskIdentifier = .invalid

  // Main queue only. iOS can expire this grant; unfinished runs remain retryable.
  private func endSaveTask() {
    guard saveTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(saveTask)
    saveTask = .invalid
  }

  public func definition() -> ModuleDefinition {
    Name("PaserWatch")

    Events("onCommand", "onWatchRunState")

    OnCreate {
      let session = PhoneWatchSession.shared
      session.activate()
      session.onCommand = { [weak self] command, at in
        // With nothing listening (the Run screen is not open) a command is
        // dropped, never queued: a Finish replayed later would end a run
        // nobody asked to end.
        guard let self = self, self.observing else { return }
        self.sendEvent("onCommand", ["cmd": command, "at": at])
      }
      session.onWatchRunState = { [weak self] state in
        // Unlike a command, this is never lost by being dropped here: live
        // metrics are superseded by the next one a second later, and
        // "route_ready" is also captured by getPendingWatchRuns() on the
        // JS side's own launch/foreground check, so a state that arrives
        // with nobody observing is not evidence lost, only a frame skipped.
        guard let self = self, self.observingRunState else { return }
        self.sendEvent("onWatchRunState", state)
      }
    }

    OnDestroy {
      PhoneWatchSession.shared.onCommand = nil
      PhoneWatchSession.shared.onWatchRunState = nil
      DispatchQueue.main.async { self.endSaveTask() }
    }

    OnStartObserving("onCommand") {
      self.observing = true
    }

    OnStopObserving("onCommand") {
      self.observing = false
    }

    OnStartObserving("onWatchRunState") {
      self.observingRunState = true
    }

    OnStopObserving("onWatchRunState") {
      self.observingRunState = false
    }

    Function("getStatus") { () -> [String: Bool] in
      return PhoneWatchSession.shared.status()
    }

    // The watch's standalone workout, if it has reported one: { phase, at, runId }.
    Function("getWatchWorkout") { () -> [String: Any] in
      return PhoneWatchSession.shared.watchWorkoutState()
    }

    // Every completed watch run still waiting to be submitted to PASER —
    // see run/watchRunImport.js, which is the only caller. Checked on launch
    // and on foreground, not just via the live "route_ready" event, because
    // the file transfer can complete while this app is not running at all.
    // Async like updateAvatar below: this reads a directory and every file in
    // it, which is real disk I/O and has no business blocking the JS thread.
    AsyncFunction("getPendingWatchRuns") { () -> [[String: Any]] in
      return PhoneWatchSession.shared.pendingWatchRuns()
    }

    // Discards a pending run once PASER has submitted it (or the runner
    // discarded it). Never call this speculatively — it is the one way this
    // data can be lost, and it must only follow a confirmed server response.
    AsyncFunction("consumePendingWatchRun") { (runId: String) -> Bool in
      return PhoneWatchSession.shared.consumePendingWatchRun(runId: runId)
    }

    Function("updateState") { (state: [String: Any]) in
      PhoneWatchSession.shared.update(state)
    }

    // The runner's portrait as base64 PNG bytes, named by the look it draws
    // (see src/watch/watchAvatar.js). True once the transfer has been queued
    // with the system, which is as far as the phone can see: delivery happens
    // in the background, possibly long after this app is gone.
    AsyncFunction("updateAvatar") { (base64: String, key: String) -> Bool in
      return PhoneWatchSession.shared.sendAvatar(base64: base64, key: key)
    }

    AsyncFunction("beginRunSave") { () -> Bool in
      self.endSaveTask()
      self.saveTask = UIApplication.shared.beginBackgroundTask(withName: "Save PASER run") { [weak self] in
        self?.endSaveTask()
      }
      return self.saveTask != .invalid
    }.runOnQueue(.main)

    AsyncFunction("endRunSave") {
      self.endSaveTask()
    }.runOnQueue(.main)
  }
}
