import ExpoModulesCore
import UIKit

/// JavaScript's handle on PhoneWatchSession. See src/watch/watchLink.js.
public class PaserWatchModule: Module {
  private var observing = false
  private var saveTask: UIBackgroundTaskIdentifier = .invalid

  // Main queue only. iOS can expire this grant; unfinished runs remain retryable.
  private func endSaveTask() {
    guard saveTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(saveTask)
    saveTask = .invalid
  }

  public func definition() -> ModuleDefinition {
    Name("PaserWatch")

    Events("onCommand")

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
    }

    OnDestroy {
      PhoneWatchSession.shared.onCommand = nil
      DispatchQueue.main.async { self.endSaveTask() }
    }

    OnStartObserving("onCommand") {
      self.observing = true
    }

    OnStopObserving("onCommand") {
      self.observing = false
    }

    Function("getStatus") { () -> [String: Bool] in
      return PhoneWatchSession.shared.status()
    }

    Function("updateState") { (state: [String: Any]) in
      PhoneWatchSession.shared.update(state)
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
