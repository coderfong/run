import SwiftUI
import WatchKit

/// The runner's portrait on the wrist.
///
/// The watch does not draw the character. The rig is a stack of a dozen PNGs
/// chosen from a catalogue of nearly three hundred, so the phone rasterises
/// the portrait it already knows how to draw and sends the picture over as a
/// file (src/watch/watchAvatar.js). This keeps the last one that arrived.
///
/// It is kept as a FILE rather than in UserDefaults, which is for small
/// values and is read whole into memory at launch, and the key that names the
/// look sits beside it: on launch the watch tells the phone which portrait it
/// is wearing, and the phone sends a new one only if that is out of date.
final class WatchAvatarStore: ObservableObject {
    static let shared = WatchAvatarStore()

    /// The portrait, or nil for a watch that has never been handed one.
    @Published private(set) var portrait: Image?
    /// Which look `portrait` draws. Empty when there is none.
    @Published private(set) var key = ""

    var hasPortrait: Bool { portrait != nil }

    private let keyDefault = "paserAvatarKey"

    private var file: URL? {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let folder = folder else { return nil }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("avatar.png")
    }

    private init() {
        key = UserDefaults.standard.string(forKey: keyDefault) ?? ""
        guard let file = file, let data = try? Data(contentsOf: file), let image = UIImage(data: data) else {
            key = ""
            return
        }
        portrait = Image(uiImage: image)
    }

    /// A portrait has arrived from the phone. `incoming` is the system's copy,
    /// which is deleted the moment the delegate returns, so it is moved into
    /// place before anything else happens.
    func receive(from incoming: URL, key newKey: String) {
        guard let file = file else { return }
        // The stored key is dropped FIRST and only written back on success.
        // Half a move leaves this watch with no portrait on disk, and a watch
        // that still claims a key would never ask for one again.
        UserDefaults.standard.removeObject(forKey: keyDefault)
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
            try FileManager.default.copyItem(at: incoming, to: file)
        } catch {
            forget()
            return
        }
        guard let data = try? Data(contentsOf: file), let image = UIImage(data: data) else {
            forget()
            return
        }
        UserDefaults.standard.set(newKey, forKey: keyDefault)
        DispatchQueue.main.async {
            self.portrait = Image(uiImage: image)
            self.key = newKey
        }
    }

    /// Ask for the portrait again next time. Whatever is already on screen
    /// stays there: a runner who has been wearing their own face for a month
    /// should not lose it to one failed transfer.
    private func forget() {
        DispatchQueue.main.async { self.key = "" }
    }
}

// MARK: - Motion

/// What the runner is doing. The portrait is one still picture, so the life
/// in it comes from here: a bounce with a footfall in it reads as running in
/// a way that a picture cross fading between two poses never would, and it
/// costs one transform instead of a second sheet of art.
enum PortraitMotion: Equatable {
    /// Standing by. Breathing, with a slow sway.
    case idle
    /// About to go. Jogging on the spot.
    case brace
    /// Running, at this many steps a second.
    case run(Double)
    /// Stopped mid run. Catching their breath, head dipped.
    case rest
    /// Celebrating a saved run.
    case cheer

    /// Redraws a second. A bounce needs more than a breath does, and every
    /// frame here is a commit of the view tree on a watch.
    var frameRate: Double {
        switch self {
        case .idle, .rest: return 12
        case .brace, .run, .cheer: return 24
        }
    }
}

/// Where the portrait is at one instant: everything the motions can move.
private struct Pose {
    var lift: CGFloat = 0      // points, up is positive
    var squash: CGFloat = 0    // 0 = round, 1 = flattened by the full amount
    var tilt: Double = 0       // degrees
    var swell: CGFloat = 1     // breathing scale

    /// `t` is seconds. Running on the wall clock rather than on an animation
    /// that has to be started means a portrait that comes back on screen is
    /// already mid stride instead of restarting its cycle.
    static func at(_ t: Double, motion: PortraitMotion, size: CGFloat) -> Pose {
        switch motion {
        case .idle:
            let breath = sin(2 * .pi * t * 0.42)
            return Pose(
                lift: CGFloat(breath) * size * 0.012,
                squash: 0,
                tilt: sin(2 * .pi * t * 0.19) * 2.0,
                swell: 1 + CGFloat(breath) * 0.018
            )
        case .brace:
            return footfall(t, cadence: 2.0, size: size, height: 0.035, lean: 1.6)
        case .run(let cadence):
            return footfall(t, cadence: cadence, size: size, height: 0.06, lean: 3.0)
        case .rest:
            let breath = sin(2 * .pi * t * 0.28)
            return Pose(
                lift: CGFloat(breath) * size * 0.008,
                squash: 0.10,
                tilt: 5.0,
                swell: 1 + CGFloat(breath) * 0.022
            )
        case .cheer:
            // A hop with a hang at the top, and a wiggle on the way up.
            let hop = abs(sin(.pi * t * 1.15))
            let hang = pow(hop, 0.6)
            return Pose(
                lift: CGFloat(hang) * size * 0.11,
                squash: CGFloat(pow(1 - hop, 4)) * 1.2,
                tilt: sin(2 * .pi * t * 1.15) * 7.0,
                swell: 1 + CGFloat(hang) * 0.03
            )
        }
    }

    /// One footfall per step, with the squash landing on it. The lean runs at
    /// half that rate, because a gait cycle is two steps: left foot and right
    /// foot are not the same moment to lean into.
    private static func footfall(
        _ t: Double,
        cadence: Double,
        size: CGFloat,
        height: CGFloat,
        lean: Double
    ) -> Pose {
        let step = t * cadence
        let bounce = abs(sin(.pi * step))
        return Pose(
            lift: CGFloat(bounce) * size * height,
            // Concentrated at the bottom: a squash spread over the whole hop
            // reads as a wobble rather than as weight landing.
            squash: CGFloat(pow(1 - bounce, 3)),
            // Not `abs`, unlike the bounce: the sign flips every step on its
            // own, which is the lean going left foot, right foot, left foot.
            tilt: sin(.pi * step) * lean,
            swell: 1
        )
    }
}

// MARK: - The portrait

/// The runner's head and shoulders, alive. Draws a placeholder for a watch
/// that has not been handed a portrait yet, in the same frame and at the same
/// size, so nothing on the screen moves when the real one lands.
struct PaserPortrait: View {
    let size: CGFloat
    var motion: PortraitMotion = .idle
    var ring: Bool = true

    @EnvironmentObject private var store: WatchAvatarStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // Always On. The screen redraws about once a minute up there, so a bounce
    // would be a still of a runner stuck mid air.
    @Environment(\.isLuminanceReduced) private var dimmed

    private var still: Bool { reduceMotion || dimmed }

    /// The ring's stroke, and how far outside the picture it sits.
    private var ringLine: CGFloat { max(3, size * 0.045) }
    private var ringDiameter: CGFloat { size * 1.14 }

    /// What the portrait occupies on the screen, ring and stroke included, so
    /// that what is laid out around it is what is actually drawn.
    var outerSize: CGFloat { ring ? ringDiameter + ringLine : size }

    var body: some View {
        ZStack {
            // The ring does not bounce with the runner. It is the frame they
            // are moving inside, and a frame that moves with its subject
            // cancels the movement out.
            if ring { ringShape }
            TimelineView(.animation(minimumInterval: 1 / motion.frameRate, paused: still)) { context in
                let pose = still
                    ? Pose()
                    : Pose.at(context.date.timeIntervalSinceReferenceDate, motion: motion, size: size)
                face
                    .scaleEffect(
                        x: pose.swell + pose.squash * 0.07,
                        y: pose.swell - pose.squash * 0.07,
                        anchor: .bottom
                    )
                    .rotationEffect(.degrees(pose.tilt))
                    .offset(y: -pose.lift)
            }
        }
        .frame(width: outerSize, height: outerSize)
    }

    @ViewBuilder private var face: some View {
        if let portrait = store.portrait {
            portrait
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            placeholder
        }
    }

    /// No portrait yet. A runner in the accent, not a face: a drawn face here
    /// reads as the character being wrong rather than as the picture being on
    /// its way.
    private var placeholder: some View {
        ZStack {
            Circle()
                .fill(PaserStyle.card)
                .frame(width: size, height: size)
            Image(systemName: "figure.run")
                .font(.system(size: size * 0.42, weight: .black))
                .foregroundColor(PaserStyle.pink)
        }
    }

    private var ringShape: some View {
        Circle()
            .stroke(
                LinearGradient(
                    gradient: Gradient(colors: [PaserStyle.pink, PaserStyle.teal.opacity(0.7)]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: ringLine
            )
            .frame(width: ringDiameter, height: ringDiameter)
    }
}
