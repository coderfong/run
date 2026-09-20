import SwiftUI

@main
struct PaserWatchApp: App {
    @StateObject private var workout = WorkoutManager()
    @StateObject private var phoneLink = PhoneLink.shared
    @StateObject private var avatarStore = WatchAvatarStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RunScreen()
                .environmentObject(workout)
                .environmentObject(phoneLink)
                .environmentObject(avatarStore)
                // The single argument overload on purpose: the two argument
                // one is watchOS 10, and this app stays installable on 9.
                .onChange(of: scenePhase) { phase in
                    // Coming back to the app is the moment to find out whether
                    // the runner has been to the studio since. Costs one
                    // message, and the phone only answers when the portrait on
                    // this wrist is out of date.
                    guard phase == .active else { return }
                    phoneLink.refresh()
                }
        }
    }
}
