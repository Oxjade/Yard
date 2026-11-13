import SwiftUI

/// A shimmering placeholder block for loading states.
///
///   Skeleton().frame(height: 220)                      // image-radius block
///   Skeleton(cornerRadius: 6).frame(width: 120, height: 14)   // a text line
///   Skeleton(shape: .circle).frame(width: 40, height: 40)
///   anyView.shimmering()                                // shimmer any placeholder shape
struct Skeleton: View {
    enum ShapeKind: Sendable {
        case rounded
        case circle
        case capsule
    }

    var cornerRadius: CGFloat = Radius.image
    var shape: ShapeKind = .rounded

    init(cornerRadius: CGFloat = Radius.image, shape: ShapeKind = .rounded) {
        self.cornerRadius = cornerRadius
        self.shape = shape
    }

    var body: some View {
        Group {
            switch shape {
            case .rounded:
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(Color.yard.surface2)
            case .circle:
                Circle().fill(Color.yard.surface2)
            case .capsule:
                Capsule().fill(Color.yard.surface2)
            }
        }
        .shimmering()
        .accessibilityHidden(true)
    }
}

/// Sweeps a soft highlight across the view, masked to its shape.
private struct ShimmerModifier: ViewModifier {
    var active: Bool
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder
    func body(content: Content) -> some View {
        if !active || reduceMotion {
            content
        } else {
            content
                .overlay(
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [Color.yard.ink.opacity(0), Color.yard.ink.opacity(0.07), Color.yard.ink.opacity(0)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width * 1.6)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                )
                .onAppear {
                    phase = -1
                    withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) {
                        phase = 1
                    }
                }
        }
    }
}

extension View {
    /// A repeating shimmer (off when Reduce Motion is on).
    func shimmering(_ active: Bool = true) -> some View {
        modifier(ShimmerModifier(active: active))
    }
}

/// A loading placeholder shaped like `MasonryGrid` of product tiles.
///
///   if isLoading { MasonrySkeleton(count: 8) }
struct MasonrySkeleton: View {
    var count: Int = 8
    var spacing: CGFloat = Spacing.gridGap
    var showsCaption: Bool = true

    init(count: Int = 8, spacing: CGFloat = Spacing.gridGap, showsCaption: Bool = true) {
        self.count = count
        self.spacing = spacing
        self.showsCaption = showsCaption
    }

    /// Repeating tile aspects (w/h) so the placeholder looks like a real masonry.
    private static let aspects: [CGFloat] = [0.75, 0.62, 0.8, 0.7, 0.66, 0.85, 0.72, 0.6]

    var body: some View {
        HStack(alignment: .top, spacing: spacing) {
            column(offset: 0)
            column(offset: 1)
        }
    }

    private func column(offset: Int) -> some View {
        VStack(spacing: spacing + (showsCaption ? 4 : 0)) {
            ForEach(Array(stride(from: offset, to: count, by: 2)), id: \.self) { i in
                VStack(alignment: .leading, spacing: 6) {
                    Skeleton()
                        .aspectRatio(MasonrySkeleton.aspects[i % MasonrySkeleton.aspects.count], contentMode: .fit)
                    if showsCaption {
                        Skeleton(cornerRadius: 4).frame(height: 10).padding(.trailing, 40)
                        Skeleton(cornerRadius: 4).frame(width: 50, height: 10)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

#Preview("Skeleton — dark") {
    ScrollView { MasonrySkeleton() }
        .background(Color.yard.bg)
        .preferredColorScheme(.dark)
}

#Preview("Skeleton — light") {
    VStack(alignment: .leading, spacing: 12) {
        HStack {
            Skeleton(shape: .circle).frame(width: 44, height: 44)
            VStack(alignment: .leading) {
                Skeleton(cornerRadius: 4).frame(width: 140, height: 12)
                Skeleton(cornerRadius: 4).frame(width: 90, height: 10)
            }
        }
        Skeleton().frame(height: 200)
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.light)
}
