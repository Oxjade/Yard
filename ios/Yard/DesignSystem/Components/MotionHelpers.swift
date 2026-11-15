import SwiftUI

// Shared motion helpers built on the `Motion` tokens (Metrics.swift). Every one of them falls
// back to `Motion.reduced` (a short fade, no travel) when Reduce Motion is on.

private struct YardCrossfadeModifier<V: Equatable>: ViewModifier {
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(Motion.resolved(Motion.crossfade, reduceMotion: reduceMotion), value: value)
    }
}

private struct YardNumericTransitionModifier: ViewModifier {
    let value: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .opacity : .numericText(value: value))
            .animation(Motion.resolved(Motion.arrive, reduceMotion: reduceMotion), value: value)
    }
}

private struct YardResolvedAnimationModifier<V: Equatable>: ViewModifier {
    let animation: Animation
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(Motion.resolved(animation, reduceMotion: reduceMotion), value: value)
    }
}

extension View {
    /// Skeleton → content (and content → empty / error) as one short cross-fade. Key it on the
    /// screen's phase so it runs when the phase changes, not on every data change:
    ///
    ///   content.yardCrossfade(model.phase)
    func yardCrossfade<V: Equatable>(_ value: V) -> some View {
        modifier(YardCrossfadeModifier(value: value))
    }

    /// Digits roll to the new value (prices, counts, scores); a plain fade under Reduce Motion.
    func yardNumericTransition(_ value: Double) -> some View {
        modifier(YardNumericTransitionModifier(value: value))
    }

    /// `.animation(animation, value:)` resolved for Reduce Motion.
    func yardAnimation<V: Equatable>(_ animation: Animation, value: V) -> some View {
        modifier(YardResolvedAnimationModifier(animation: animation, value: value))
    }
}

/// UIScrollView-style resistance past a limit: free inside ±`limit`, then each extra point moves
/// less, never more than `dimension` past the edge. Used by drag and pinch overshoot (photo
/// viewer, profile-photo crop) before they settle back with `Motion.spring`.
enum RubberBand {
    static func value(_ value: CGFloat, limit: CGFloat, dimension: CGFloat) -> CGFloat {
        guard value.isFinite else { return 0 }
        let limit = max(0, limit)
        let magnitude = abs(value)
        guard magnitude > limit, dimension > 0 else { return value }
        let over = magnitude - limit
        let resisted = (1 - 1 / (over * 0.55 / dimension + 1)) * dimension
        return (value < 0 ? -1 : 1) * (limit + resisted)
    }
}
