import SwiftUI

// MARK: - Glass
//
// Glass is for FLOATING layers only: the tab pill, buttons that hover over photos or headers,
// status capsules on photos, overlay bars, menus and sheets. Never on ordinary cards or rows.
//
//   content.yardGlass(Capsule())                       // adapts to light / dark
//   pill.yardGlass(Capsule(), onPhoto: true)           // always dark glass, for white text on photos
//   bar.yardGlass(RoundedRectangle(cornerRadius: 24, style: .continuous), elevation: .floating)
//
// The build SDK (Xcode 16.4 / iOS 18.5) has no Liquid Glass API, so this is the system
// material plus a lit top edge, a hairline and a soft shadow, which reads as a physical layer.

enum YardGlassElevation: Sendable {
    /// Sits on a photo or a header: hairline and edge light only.
    case inset
    /// Hovers over scrolling content (tab pill, floating bars): adds a soft drop shadow.
    case floating
}

private struct YardGlassModifier<S: InsettableShape>: ViewModifier {
    let shape: S
    let onPhoto: Bool
    let elevation: YardGlassElevation
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    shape.fill(onPhoto ? AnyShapeStyle(.thinMaterial) : AnyShapeStyle(.ultraThinMaterial))
                    shape.fill(onPhoto ? Color.yard.scrim.opacity(0.18) : Color.yard.glassTint)
                }
                .environment(\.colorScheme, onPhoto ? .dark : scheme)
            }
            .overlay {
                shape.strokeBorder(
                    LinearGradient(
                        colors: [
                            onPhoto ? Color.yard.onPhoto.opacity(0.32) : Color.yard.glassEdge,
                            onPhoto ? Color.yard.onPhoto.opacity(0.06) : Color.yard.line,
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 0.75
                )
            }
            .shadow(
                color: Color.yard.scrim.opacity(elevation == .floating ? (scheme == .dark ? 0.45 : 0.14) : 0),
                radius: elevation == .floating ? 20 : 0,
                y: elevation == .floating ? 10 : 0
            )
    }
}

extension View {
    /// Frosted glass in `shape`. `onPhoto` forces dark glass so white text stays readable on any image.
    func yardGlass<S: InsettableShape>(_ shape: S, onPhoto: Bool = false, elevation: YardGlassElevation = .inset) -> some View {
        modifier(YardGlassModifier(shape: shape, onPhoto: onPhoto, elevation: elevation))
    }
}

// MARK: - Photo scrim

/// The soft bottom gradient under text laid on a photo. Starts clear at `start` (0…1 from top)
/// and eases to `strength` black at the bottom.
struct PhotoScrim: View {
    var start: CGFloat = 0.35
    var strength: Double = 0.78

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color.yard.scrim.opacity(0), location: 0),
                .init(color: Color.yard.scrim.opacity(0), location: start),
                .init(color: Color.yard.scrim.opacity(strength * 0.45), location: start + (1 - start) * 0.5),
                .init(color: Color.yard.scrim.opacity(strength), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

#Preview("Glass surfaces") {
    ZStack {
        LinearGradient(colors: [Color.yard.purple, Color.yard.acid], startPoint: .topLeading, endPoint: .bottomTrailing)
        VStack(spacing: 20) {
            Text("LIVE NOW")
                .font(.yardMicro)
                .foregroundStyle(Color.yard.onPhoto)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .yardGlass(Capsule(), onPhoto: true)
            Text("Floating bar")
                .font(.yardBodyEmphasis)
                .foregroundStyle(Color.yard.ink)
                .padding()
                .yardGlass(Capsule(), elevation: .floating)
        }
    }
    .ignoresSafeArea()
}
