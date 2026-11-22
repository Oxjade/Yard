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
    /// Studio violet #9452FF in both modes: the seller side ("Sell on Yard", Studio accents).
    /// Put `onPhoto` (white) text on it.
    let studio = Color(light: UIColor(yardHex: 0x9452FF), dark: UIColor(yardHex: 0x9452FF))
    /// Errors and destructive actions. Dark #FF4D4D / light #D92D20.
    let danger = Color(light: UIColor(yardHex: 0xD92D20), dark: UIColor(yardHex: 0xFF4D4D))
    /// Success. Dark #22C55E / light #16A34A.
    let success = Color(light: UIColor(yardHex: 0x16A34A), dark: UIColor(yardHex: 0x22C55E))

    /// Pills and text placed ON A PHOTO (brand profile Follow, glass overlays): white in both modes.
    let onPhoto = Color(light: UIColor(yardHex: 0xFFFFFF), dark: UIColor(yardHex: 0xFFFFFF))
    /// Text on an `onPhoto` (white) pill: #0B0B0B in both modes.
    let onPhotoInk = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0x0B0B0B))
    /// The lit top edge of glass surfaces (tab pill, floating buttons, overlay pills).
    let glassEdge = Color(light: UIColor(white: 1, alpha: 0.85), dark: UIColor(white: 1, alpha: 0.18))
    /// A faint wash laid over glass so it reads as a surface, not a hole. Use as-is.
    let glassTint = Color(light: UIColor(white: 1, alpha: 0.35), dark: UIColor(white: 1, alpha: 0.04))
    /// Scrim for gradients over photos (black, fixed). Use with `.opacity(…)`.
    let scrim = Color(light: UIColor(yardHex: 0x000000), dark: UIColor(yardHex: 0x000000))

    // MARK: Studio Home ("wallet" look). Same values as Android's `Color.yard.studio*`.

    /// The soft violet hero, #8B68FF in both modes. White on it is 3.8:1, so text on it is large or
    /// semibold; small copy sits on `studioAccentDeep`. Put `onStudioAccent` on it.
    let studioAccent = Color(light: UIColor(yardHex: 0x8B68FF), dark: UIColor(yardHex: 0x8B68FF))
    /// The inset card inside the violet hero: #7350EE (white on it is 5.1:1).
    let studioAccentDeep = Color(light: UIColor(yardHex: 0x7350EE), dark: UIColor(yardHex: 0x7350EE))
    /// Text/icons on the Studio violet: white in both modes.
    let onStudioAccent = Color(light: UIColor(yardHex: 0xFFFFFF), dark: UIColor(yardHex: 0xFFFFFF))
    /// Studio Home's canvas. Dark pure black #000000 / light #F5F5F7.
    let studioCanvas = Color(light: UIColor(yardHex: 0xF5F5F7), dark: UIColor(yardHex: 0x000000))
    /// Studio Home's tiles and rows. Dark #1A1A1A / light #E9E9EE.
    let studioTile = Color(light: UIColor(yardHex: 0xE9E9EE), dark: UIColor(yardHex: 0x1A1A1A))
    /// A disc or chip on a `studioTile`. Dark #2A2A2A / light #DADAE1.
    let studioTile2 = Color(light: UIColor(yardHex: 0xDADAE1), dark: UIColor(yardHex: 0x2A2A2A))
    /// The one contrast tile. Dark #FFFFFF / light #0B0B0B. Put `onStudioContrast` on it.
    let studioContrast = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0xFFFFFF))
    /// Text on `studioContrast`. Dark #0B0B0B / light #FFFFFF.
    let onStudioContrast = Color(light: UIColor(yardHex: 0xFFFFFF), dark: UIColor(yardHex: 0x0B0B0B))
    /// Violet-tinted icon disc on a tile. Dark #2C2545 / light #E2DBFF.
    let studioAccentTint = Color(light: UIColor(yardHex: 0xE2DBFF), dark: UIColor(yardHex: 0x2C2545))
    /// A violet icon on `studioAccentTint`. Dark #B3A1FF / light #5B3BE0.
    let studioAccentInk = Color(light: UIColor(yardHex: 0x5B3BE0), dark: UIColor(yardHex: 0xB3A1FF))
    /// The Studio tab bar: near-black in both modes (#161616 / #0B0B0B).
    let studioBar = Color(light: UIColor(yardHex: 0x0B0B0B), dark: UIColor(yardHex: 0x161616))
    /// Unselected tab icons on `studioBar`: #8E8E93.
    let studioBarIcon = Color(light: UIColor(yardHex: 0x8E8E93), dark: UIColor(yardHex: 0x8E8E93))
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
