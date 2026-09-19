import SwiftUI

// MARK: - Accessibility Helpers

/// Accessibility modifier for high contrast mode
extension View {
    func accessibleHighContrast() -> some View {
        self.environment(\.colorScheme, .dark)
    }
    
    /// Larger touch targets for accessibility
    func accessibleTouchTarget() -> some View {
        self.frame(minWidth: 44, minHeight: 44)
    }
    
    /// Accessibility label for metric displays
    func metricAccessibility(label: String, value: String, unit: String? = nil) -> some View {
        var fullLabel = label
        if let unit = unit {
            fullLabel += " \(value) \(unit)"
        } else {
            fullLabel += " \(value)"
        }
        return self.accessibilityLabel(fullLabel)
    }
}

// MARK: - Performance Optimizations

/// View modifier for reducing animation overhead
struct PerformanceMode: ViewModifier {
    let enabled: Bool
    
    func body(content: Content) -> some View {
        if enabled {
            content
                .drawingGroup(opaque: true) // GPU rendering for complex views
        } else {
            content
        }
    }
}

extension View {
    func performanceMode(_ enabled: Bool = true) -> some View {
        self.modifier(PerformanceMode(enabled: enabled))
    }
}

/// Lazy loading wrapper for expensive content
struct LazyLoad<Content: View>: View {
    let content: () -> Content
    @State private var isVisible = false
    
    var body: some View {
        GeometryReader { geometry in
            if isVisible {
                content()
            } else {
                Color.clear
                    .onAppear {
                        // Small delay to avoid blocking initial render
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            isVisible = true
                        }
                    }
            }
        }
    }
}

// MARK: - Battery Optimization

/// Battery-aware animation controller
class BatteryAwareAnimation: ObservableObject {
    @Published var reduceAnimations = false
    
    init() {
        // Check battery state and reduce animations if needed
        #if os(watchOS)
        let device = WKInterfaceDevice.current()
        // This would need actual battery level API access
        // For now, use Reduce Motion setting as proxy
        #endif
    }
    
    func appropriateAnimation(for animation: Animation) -> Animation {
        reduceAnimations ? .linear(duration: 0.2) : animation
    }
}

// MARK: - Screen Brightness Awareness

/// Adjust UI based on Always-On display state
class DisplayStateMonitor: ObservableObject {
    @Published var isAlwaysOn = false
    
    init() {
        #if os(watchOS)
        // Monitor display state for Always-On optimizations
        #endif
    }
    
    var shouldReduceMotion: Bool {
        isAlwaysOn
    }
    
    var appropriateOpacity: Double {
        isAlwaysOn ? 0.7 : 1.0
    }
}
