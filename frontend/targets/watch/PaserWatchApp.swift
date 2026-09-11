import SwiftUI

// PASER on the wrist. The iPhone records the run (GPS, the filters, the
// server round trips); this app shows what the phone is measuring and sends
// back the four things a runner wants from a watch mid run: start, pause,
// resume and finish. Everything it shows arrives from the phone, see
// PhoneLink.swift, and the protocol is src/watch/watchState.js.
@main
struct PaserWatchApp: App {
    @StateObject private var link = PhoneLink()

    var body: some Scene {
        WindowGroup {
            RunScreen()
                .environmentObject(link)
        }
    }
}
