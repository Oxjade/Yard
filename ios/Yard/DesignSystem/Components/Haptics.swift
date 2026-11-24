import UIKit

/// One place for imperative haptics (inside action closures, gestures and async results).
/// For state changes in views, `.sensoryFeedback` is fine too.
///
///   Haptics.selection()            // a chip, a tab, a picker step
///   Haptics.impact()               // a button press that does something
///   Haptics.tick(progress)         // rising ticks while sliding (lighter → stronger)
///   Haptics.success() / .error()   // the end of an action
@MainActor
enum Haptics {
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    /// A light tick whose strength rises with `progress` (0…1).
    static func tick(_ progress: CGFloat) {
        let intensity = min(1, max(0.25, 0.25 + 0.75 * progress))
        UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: intensity)
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
