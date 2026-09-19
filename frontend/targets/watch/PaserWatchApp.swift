import SwiftUI

@main
struct PaserWatchApp: App {
    @StateObject private var workout = WorkoutManager()
    @StateObject private var phoneLink = PhoneLink.shared
    @StateObject private var avatarStore = WatchAvatarStore.shared

    var body: some Scene {
        WindowGroup {
            RunScreen()
                .environmentObject(workout)
                .environmentObject(phoneLink)
                .environmentObject(avatarStore)
        }
    }
}
