import SwiftUI

/// The pure maths of the slider (unit-tested).
enum SlideToConfirmMath {
    /// How far (0…1) the knob must travel before letting go confirms.
    static let completionThreshold: CGFloat = 0.85
    /// Haptic ticks along the track.
    static let tickCount: Int = 10

    /// Distance the knob can travel inside a track of `trackWidth` (inner padding included).
    static func travel(trackWidth: CGFloat, knob: CGFloat, padding: CGFloat) -> CGFloat {
        max(0, trackWidth - knob - padding * 2)
    }

    /// 0…1 for an offset along `travel`.
    static func progress(offset: CGFloat, travel: CGFloat) -> CGFloat {
        guard travel > 0, offset.isFinite else { return 0 }
        return min(1, max(0, offset / travel))
    }

    static func isComplete(_ progress: CGFloat) -> Bool {
        progress >= completionThreshold
    }

    /// The tick index for `progress` (0…tickCount).
    static func tick(_ progress: CGFloat) -> Int {
        Int((min(1, max(0, progress)) * CGFloat(tickCount)).rounded(.down))
    }
}

/// Slide to complete a key action (submit, mark shipped, publish): a black pill with an acid knob.
/// Rising haptic ticks while sliding, success when it completes. VoiceOver and Switch Control get
/// a plain button action ("Double-tap to …") instead of the drag.
///
///   SlideToConfirm("Slide to publish", isLoading: publishing) { publish() }
///
/// While `isLoading` the knob waits at the end with a spinner; it springs back when loading ends
/// (a failure) or 0.8 s after a synchronous action.
struct SlideToConfirm: View {
    let title: String
    var systemImage: String = "arrow.right"
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: CGFloat = 0
    @State private var lastTick: Int = 0
    @State private var completed: Bool = false

    private let height: CGFloat = 64
    private let knob: CGFloat = 56
    private let padding: CGFloat = 4

    init(_ title: String, systemImage: String = "arrow.right", isLoading: Bool = false, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isLoading = isLoading
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        GeometryReader { geo in
            let travel = SlideToConfirmMath.travel(trackWidth: geo.size.width, knob: knob, padding: padding)
            let shown: CGFloat = (completed || isLoading) ? travel : offset
            let progress = SlideToConfirmMath.progress(offset: shown, travel: travel)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.yard.ink)
                Capsule()
                    .fill(Color.yard.acid.opacity(0.22))
                    .frame(width: shown + knob + padding * 2)
                Text(title)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.bg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.leading, knob + padding * 2)
                    .padding(.trailing, Spacing.l)
                    .frame(maxWidth: .infinity)
                    .opacity(Double(max(0, 1 - progress * 1.6)))
                    .shimmering(isEnabled && !isLoading && progress == 0 && !reduceMotion)
                knobView
                    .offset(x: padding + shown)
                    .gesture(drag(travel: travel))
            }
        }
        .frame(height: height)
        .opacity(isEnabled ? 1 : 0.4)
        .allowsHitTesting(isEnabled && !isLoading)
        .onChange(of: isLoading) { wasLoading, loading in
            if wasLoading && !loading { reset() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(isLoading ? "Working" : ""))
        .accessibilityHint(Text("Double-tap to confirm."))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            guard isEnabled, !isLoading else { return }
            complete()
        }
    }

    private var knobView: some View {
        ZStack {
            Circle().fill(Color.yard.acid)
            if isLoading {
                ProgressView().tint(Color.yard.onAcid)
            } else {
                Image(systemName: completed ? "checkmark" : systemImage)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color.yard.onAcid)
                    .contentTransition(.symbolEffect(.replace))
            }
        }
        .frame(width: knob, height: knob)
        .shadow(color: Color.yard.scrim.opacity(0.25), radius: 6, y: 2)
    }

    private func drag(travel: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                guard !completed, !isLoading else { return }
                let next = min(travel, max(0, value.translation.width))
                offset = next
                let tick = SlideToConfirmMath.tick(SlideToConfirmMath.progress(offset: next, travel: travel))
                if tick > lastTick {
                    Haptics.tick(SlideToConfirmMath.progress(offset: next, travel: travel))
                }
                lastTick = tick
            }
            .onEnded { _ in
                guard !completed, !isLoading else { return }
                if SlideToConfirmMath.isComplete(SlideToConfirmMath.progress(offset: offset, travel: travel)) {
                    complete()
                } else {
                    withAnimation(Motion.resolved(.spring(response: 0.4, dampingFraction: 0.62), reduceMotion: reduceMotion)) {
                        offset = 0
                    }
                    lastTick = 0
                }
            }
    }

    private func complete() {
        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
            completed = true
        }
        Haptics.success()
        action()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            if !isLoading { reset() }
        }
    }

    private func reset() {
        withAnimation(Motion.resolved(.spring(response: 0.45, dampingFraction: 0.7), reduceMotion: reduceMotion)) {
            completed = false
            offset = 0
        }
        lastTick = 0
    }
}

#Preview("Slide — dark") {
    VStack(spacing: 20) {
        SlideToConfirm("Slide to publish") {}
        SlideToConfirm("Slide to mark shipped", systemImage: "shippingbox", isLoading: true) {}
    }
    .padding()
    .frame(maxHeight: .infinity)
    .yardScreenBackground()
    .preferredColorScheme(.dark)
}

#Preview("Slide — light") {
    SlideToConfirm("Slide to submit") {}
        .padding()
        .frame(maxHeight: .infinity)
        .yardScreenBackground()
        .preferredColorScheme(.light)
}
