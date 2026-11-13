import SwiftUI

// MARK: - Type scale
//
// SF Pro throughout. Display headlines are the site's heavy condensed capitals:
//   Text("NEW DROPS").yardDisplay(34)          // font + uppercase + tight tracking
// or just the font: `.font(.yardDisplay(34))` (remember `.textCase(.uppercase)`).
// Body styles are built on text styles, so they scale with Dynamic Type.

extension Font {
    /// Heavy condensed display face (black weight, compressed width). Fixed size; use for headlines.
    static func yardDisplay(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black).width(.compressed)
    }

    /// Display face that scales with Dynamic Type relative to `style`.
    static func yardDisplay(_ style: Font.TextStyle) -> Font {
        .system(style, design: .default, weight: .black).width(.compressed)
    }

    /// Large title for screen headers (bold, Dynamic Type).
    static let yardLargeTitle: Font = .system(.largeTitle, design: .default, weight: .bold)
    /// Section / card titles (bold title3, Dynamic Type).
    static let yardTitle: Font = .system(.title3, design: .default, weight: .bold)
    /// Smaller headings, row titles (semibold headline).
    static let yardHeadline: Font = .system(.headline, design: .default, weight: .semibold)
    /// Body text.
    static let yardBody: Font = .system(.body)
    /// Emphasised body text (prices, button labels).
    static let yardBodyEmphasis: Font = .system(.body, design: .default, weight: .semibold)
    /// Secondary body text.
    static let yardCallout: Font = .system(.callout)
    /// Captions, metadata.
    static let yardCaption: Font = .system(.caption)
    /// Emphasised caption (tags, badges).
    static let yardCaptionEmphasis: Font = .system(.caption, design: .default, weight: .semibold)
    /// Tiny labels (tab pill, counters).
    static let yardMicro: Font = .system(.caption2, design: .default, weight: .semibold)
    /// Numbers that tick (countdowns, stats): monospaced digits, bold.
    static func yardNumber(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold).monospacedDigit()
    }
}

extension View {
    /// Applies the display face, uppercases the text and tightens tracking. `size` in points.
    func yardDisplay(_ size: CGFloat) -> some View {
        self
            .font(.yardDisplay(size))
            .textCase(.uppercase)
            .tracking(-0.2)
            .lineSpacing(-2)
    }
}
