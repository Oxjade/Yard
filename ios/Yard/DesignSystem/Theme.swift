import SwiftUI
import UIKit

// MARK: - Colour tokens
//
// Every colour in the app comes from here. Each token resolves per appearance (light / dark)
// through a dynamic UIColor, so `.preferredColorScheme` at the root switches them all.
//
// Use:  `.foregroundStyle(Color.yard.ink)`, `.background(Color.yard.surface)`.
// Never write `Color.black`, `Color.white`, `Color(red:…)` or a hex literal in a feature view.

extension Color {
    /// Yard's colour tokens (see `YardPalette`).
    static let yard = YardPalette()
}

/// The Yard palette, mirroring the website's tokens. Values are exact: dark / light.
struct YardPalette: Sendable {
    /// App background. Dark #080808 / light #F6F5F1.
    let bg = Color(light: UIColor(yardHex: 0xF6F5F1), dark: UIColor(yardHex: 0x080808))
    /// Cards and raised surfaces. Dark #121212 / light #FFFFFF.
    let surface = Color(light: UIColor(yardHex: 0xFFFFFF), dark: UIColor(yardHex: 0x121212))
    /// Secondary surfaces: secondary buttons, chips, inputs. Dark #1A1A1A / light #EFEDE7.
    let surface2 = Color(light: UIColor(yardHex: 0xEFEDE7), dark: UIColor(yardHex: 0x1A1A1A))
    /// Hairlines and card borders. White 8% / black 8%.
    let line = Color(light: UIColor(white: 0, alpha: 0.08), dark: UIColor(white: 1, alpha: 0.08))
    /// Primary text. Dark #F5F5F0 / light #0B0B0B.
    let ink = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0xF5F5F0))
    /// Secondary text. Dark #A3A39C / light #5B5B55.
    let ink2 = Color(light: UIColor(yardHex: 0x5B5B55), dark: UIColor(yardHex: 0xA3A39C))
    /// Tertiary text, placeholders. Dark #6E6E68 / light #8A8A83.
    let ink3 = Color(light: UIColor(yardHex: 0x8A8A83), dark: UIColor(yardHex: 0x6E6E68))
    /// THE accent, #F5FF00 in both modes. Put `onAcid` text on it.
    let acid = Color(light: UIColor(yardHex: 0xF5FF00), dark: UIColor(yardHex: 0xF5FF00))
    /// Text/icons on an acid fill: always #0B0B0B.
    let onAcid = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0x0B0B0B))
    /// Brand purple #6D28D9 in both modes.
    let purple = Color(light: UIColor(yardHex: 0x6D28D9), dark: UIColor(yardHex: 0x6D28D9))
    /// Violet: #A78BFA dark / #6D28D9 light (readable purple text on either background).
    let violet = Color(light: UIColor(yardHex: 0x6D28D9), dark: UIColor(yardHex: 0xA78BFA))
    /// Errors and destructive actions. Dark #FF4D4D / light #D92D20.
    let danger = Color(light: UIColor(yardHex: 0xD92D20), dark: UIColor(yardHex: 0xFF4D4D))
    /// Success. Dark #22C55E / light #16A34A.
    let success = Color(light: UIColor(yardHex: 0x16A34A), dark: UIColor(yardHex: 0x22C55E))

    /// Pills and text placed ON A PHOTO (brand profile Follow, glass overlays): white in both modes.
    let onPhoto = Color(light: UIColor(yardHex: 0xFFFFFF), dark: UIColor(yardHex: 0xFFFFFF))
    /// Text on an `onPhoto` (white) pill: #0B0B0B in both modes.
    let onPhotoInk = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0x0B0B0B))
    /// Scrim for gradients over photos (black, fixed). Use with `.opacity(…)`.
    let scrim = Color(light: UIColor(yardHex: 0x000000), dark: UIColor(yardHex: 0x000000))
}

extension Color {
    /// A colour that resolves to `light` or `dark` with the current trait collection.
    init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

extension UIColor {
    /// `UIColor(yardHex: 0xF5FF00)`: an opaque sRGB colour from a 24-bit hex value.
    convenience init(yardHex hex: UInt32, alpha: CGFloat = 1) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255
        let g = CGFloat((hex >> 8) & 0xFF) / 255
        let b = CGFloat(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: alpha)
    }
}

// MARK: - Appearance

/// The user's appearance choice, stored with `@AppStorage("appearance")` as its raw value.
enum AppearancePreference: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: String { rawValue }

    /// The key used with `@AppStorage`.
    static let storageKey = "appearance"

    var title: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var systemImage: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }

    /// Pass to `.preferredColorScheme(_:)`. `nil` follows the system.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
