import SwiftUI

/// Spacing scale (points). Screen gutter is `Spacing.gutter`; masonry gap is `Spacing.gridGap`.
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48

    /// Horizontal screen padding.
    static let gutter: CGFloat = 16
    /// Gap between masonry tiles (Home, grids): 6pt, edge to edge.
    static let gridGap: CGFloat = 6
    /// Height reserved at the bottom of tab-root screens for the floating tab pill.
    static let tabPillClearance: CGFloat = 84
}

/// Corner radii. Always use `.continuous` rounded rectangles (`RoundedRectangle(cornerRadius:style: .continuous)`).
enum Radius {
    /// Cards (20pt).
    static let card: CGFloat = 20
    /// Images and tiles (16pt).
    static let image: CGFloat = 16
    /// Small elements: thumbnails, inputs (12pt).
    static let small: CGFloat = 12
    /// Sheets (28pt).
    static let sheet: CGFloat = 28
}

/// Motion tokens. Define every animation here and reuse it; never hand-roll a spring in a view.
/// Under Reduce Motion, use `Motion.resolved(_:reduceMotion:)` (or the press styles, which do it
/// for you): movement becomes a short cross-fade or nothing.
enum Motion {
    /// The app's standard spring (navigation-adjacent movement, sheets, tab selection).
    static let spring: Animation = .spring(response: 0.35, dampingFraction: 0.82)
    /// A quicker spring for small state flips (chips, toggles, badges).
    static let snappy: Animation = .spring(response: 0.25, dampingFraction: 0.9)
    /// Button and card compression: fast in, settles without overshoot.
    static let press: Animation = .spring(response: 0.22, dampingFraction: 0.78)
    /// A soft spring for things that arrive (toasts, notification rows, counts).
    static let arrive: Animation = .spring(response: 0.42, dampingFraction: 0.86)
    /// Image fade-in.
    static let fade: Animation = .easeOut(duration: 0.25)
    /// Skeleton to content, image to image.
    static let crossfade: Animation = .easeInOut(duration: 0.3)
    /// The reduced-motion stand-in: a short fade, no travel.
    static let reduced: Animation = .easeInOut(duration: 0.15)

    /// Scale for a pressed tile or small button.
    static let pressScale: CGFloat = 0.96
    /// Scale for a pressed large card (drop cards, product tiles): bigger surfaces move less.
    static let cardPressScale: CGFloat = 0.98

    /// `animation`, or the reduced stand-in when the person has Reduce Motion on.
    static func resolved(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? reduced : animation
    }
}

extension Shape where Self == RoundedRectangle {
    /// Continuous rounded rectangle with the card radius.
    static var yardCard: RoundedRectangle { RoundedRectangle(cornerRadius: Radius.card, style: .continuous) }
    /// Continuous rounded rectangle with the image radius.
    static var yardImage: RoundedRectangle { RoundedRectangle(cornerRadius: Radius.image, style: .continuous) }
}
