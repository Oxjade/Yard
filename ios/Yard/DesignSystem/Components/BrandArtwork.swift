import SwiftUI

/// The designed stand-in for a missing photo: the brand's tone as a lit gradient with its
/// initials set large in the display face. Never a grey box with a photo glyph. Decorative.
/// Mirrors Android's `BrandArtwork.kt`: the same tone table and hash (`YardArtwork.tone`), the
/// same initials, so a brand gets the same colour and mark in both apps.
/// - Cards and heroes (140pt wide or more): oversized initials bleeding off the top right, faint (13%).
/// - Thumbnails (narrower, or `style: .initials`): the initials centred at 72%.
///
///   RemoteImage(url: drop.imageURL) { BrandArtwork(name: drop.brandName, seed: drop.brand.id) }
///   BrandArtwork(name: "Acme Studio", style: .initials)
struct BrandArtwork: View {
    enum Style: Sendable {
        /// Oversized initials on cards and heroes; centred initials when narrower than 140pt.
        case automatic
        /// Always the centred thumbnail initials.
        case initials
    }

    let name: String
    var seed: String? = nil
    var style: Style = .automatic

    init(name: String, seed: String? = nil, style: Style = .automatic) {
        self.name = name
        self.seed = seed
        self.style = style
    }

    var body: some View {
        let tone = YardArtwork.tone(seed ?? name)
        let initials = YardArtwork.initials(name)
        GeometryReader { geo in
            let width = geo.size.width
            let compact = style == .initials || width < 140
            ZStack {
                LinearGradient(colors: [tone.light, tone.dark], startPoint: .topLeading, endPoint: .bottomTrailing)
                // A soft light source at the top left, as if the fabric were lit from a window.
                RadialGradient(
                    colors: [Color.yard.onPhoto.opacity(0.16), Color.yard.onPhoto.opacity(0)],
                    center: .topLeading,
                    startRadius: 0,
                    endRadius: max(width, 1) * 1.1
                )
                if compact {
                    Text(initials)
                        .font(.yardDisplay(max(width * 0.42, 1)))
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.72))
                        .lineLimit(1)
                        .fixedSize()
                        .frame(width: geo.size.width, height: geo.size.height)
                } else {
                    Text(initials)
                        .font(.yardDisplay(width * 0.78))
                        .tracking(-0.04 * width * 0.78)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.13))
                        .lineLimit(1)
                        .fixedSize()
                        .offset(x: width * 0.06, y: -(width * 0.08))
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .topTrailing)
                }
            }
            .clipped()
        }
        .accessibilityHidden(true)
    }
}

/// Brand placeholder tones, identical to Android's `YardArtwork` (Theme.kt).
enum YardArtwork {
    struct Tone: Sendable {
        let light: Color
        let dark: Color
    }

    static let tones: [(UInt32, UInt32)] = [
        (0x5B4FB0, 0x1E1840), // violet ink
        (0x8C3B2E, 0x2A100C), // oxblood
        (0x3F6B5A, 0x0F2119), // bottle green
        (0x2F5B8A, 0x0C1A2C), // workwear blue
        (0x8A6A2F, 0x2A1F0C), // tobacco
        (0x7A3E68, 0x240E1E), // aubergine
        (0x4E5A63, 0x15191C), // slate
        (0x9A5A2A, 0x2C1608), // rust
    ]

    /// The tone for `key` (a brand id, handle or name): Java/Kotlin `String.hashCode()` over
    /// UTF-16, masked positive, modulo the table, exactly as Android picks it.
    static func tone(_ key: String) -> Tone {
        let pair = tones[Int(javaHash(key) & Int32.max) % tones.count]
        return Tone(light: Color(uiColor: UIColor(yardHex: pair.0)), dark: Color(uiColor: UIColor(yardHex: pair.1)))
    }

    static func javaHash(_ s: String) -> Int32 {
        var h: Int32 = 0
        for unit in s.utf16 { h = h &* 31 &+ Int32(unit) }
        return h
    }

    /// "Acme Studio" → "AS", "kumasi" → "K" (Android's `brandInitials`).
    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        guard let first = words.first?.first else { return "Y" }
        if words.count == 1 { return String(first).uppercased() }
        return (String(first) + String(words[1].first!)).uppercased()
    }
}

#Preview("BrandArtwork") {
    VStack(spacing: 12) {
        BrandArtwork(name: "Acme")
            .aspectRatio(4.0 / 5.0, contentMode: .fit)
            .clipShape(.yardCard)
        HStack(spacing: 12) {
            BrandArtwork(name: "Blue Hour Studio", style: .initials)
                .frame(width: 60, height: 76)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            BrandArtwork(name: "Night Shift Collective")
                .frame(height: 120)
                .clipShape(.yardImage)
        }
    }
    .padding()
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}
