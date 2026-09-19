import SwiftUI
import WatchKit

/// Watch-specific avatar rendering and caching system.
/// Handles synchronization of the user's PASER character from iPhone.
final class WatchAvatarStore: ObservableObject {
    static let shared = WatchAvatarStore()
    
    @Published private(set) var avatarImage: Image?
    @Published private(set) var hasAvatar = false
    
    private let userDefaults = UserDefaults.standard
    private let avatarKey = "cachedPaserAvatar"
    private let avatarTimestampKey = "cachedAvatarTimestamp"
    
    private init() {
        loadCachedAvatar()
    }
    
    /// Update avatar from iPhone sync data
    func updateAvatar(from data: Data?) {
        guard let data = data else { return }
        
        // Cache the new avatar
        userDefaults.set(data, forKey: avatarKey)
        userDefaults.set(Date().timeIntervalSince1970, forKey: avatarTimestampKey)
        
        // Create SwiftUI Image from data
        if let uiImage = UIImage(data: data) {
            DispatchQueue.main.async {
                self.avatarImage = Image(uiImage: uiImage)
                self.hasAvatar = true
            }
        }
    }
    
    /// Load cached avatar from UserDefaults
    private func loadCachedAvatar() {
        guard let data = userDefaults.data(forKey: avatarKey),
              let uiImage = UIImage(data: data) else {
            hasAvatar = false
            return
        }
        
        DispatchQueue.main.async {
            self.avatarImage = Image(uiImage: uiImage)
            self.hasAvatar = true
        }
    }
    
    /// Clear cached avatar (for testing or reset)
    func clearCache() {
        userDefaults.removeObject(forKey: avatarKey)
        userDefaults.removeObject(forKey: avatarTimestampKey)
        DispatchQueue.main.async {
            self.avatarImage = nil
            self.hasAvatar = false
        }
    }
}

/// PASER character head view for Watch.
/// Renders the synced avatar with fallback to default representation.
struct PaserAvatarHead: View {
    let size: CGFloat
    @EnvironmentObject private var avatarStore: WatchAvatarStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false
    @State private var blink = false
    
    var body: some View {
        Group {
            if avatarStore.hasAvatar, let avatar = avatarStore.avatarImage {
                // Use synced avatar from iPhone
                avatar
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(PaserStyle.cream, lineWidth: 2))
                    .shadow(color: PaserStyle.pink.opacity(0.3), radius: 8)
                    .scaleEffect(breathe ? 1.02 : 1.0)
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 2.0).repeatForever(autoreverses: true),
                        value: breathe
                    )
            } else {
                // Fallback to stylized default representation
                defaultAvatar
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                breathe = true
            }
        }
    }
    
    private var defaultAvatar: some View {
        ZStack {
            // Background glow
            Circle()
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [PaserStyle.pink.opacity(0.3), PaserStyle.teal.opacity(0.2)]),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: size * 1.1, height: size * 1.1)
                .blur(radius: 8)
            
            // Head base
            Circle()
                .fill(PaserStyle.cream)
                .frame(width: size, height: size)
                .overlay(Circle().stroke(PaserStyle.ink, lineWidth: 3))
            
            // Default face features (stylized PASER look)
            VStack(spacing: size * 0.08) {
                // Eyes
                HStack(spacing: size * 0.15) {
                    Circle()
                        .fill(PaserStyle.ink)
                        .frame(width: size * 0.12, height: blink ? 2 : size * 0.12)
                    Circle()
                        .fill(PaserStyle.ink)
                        .frame(width: size * 0.12, height: blink ? 2 : size * 0.12)
                }
                
                // Smile
                Capsule()
                    .fill(PaserStyle.ink)
                    .frame(width: size * 0.3, height: size * 0.05)
            }
            .offset(y: -size * 0.05)
        }
        .scaleEffect(breathe ? 1.02 : 1.0)
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 2.0).repeatForever(autoreverses: true),
            value: breathe
        )
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                breathe = true
            }
            withAnimation(.easeInOut(duration: 0.15).repeatForever(autoreverses: true).delay(2.0)) {
                blink = true
            }
        }
    }
}
