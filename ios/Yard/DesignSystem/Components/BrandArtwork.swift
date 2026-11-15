import SwiftUI

/// The designed stand-in for a missing photo: a deep gradient tinted from the brand (a stable
/// hue derived from its id or name, so a brand always gets the same colour), a soft light
/// bloom, and the brand's wordmark (or initials, when the name is long) set very large and faint.
/// Never a grey box with a photo glyph.
///
///   RemoteImage(url: drop.imageURL) { BrandArtwork(name: drop.brandName, seed: drop.brand.id) }
///   BrandArtwork(name: "Acme Studio", style: .initials)
struct BrandArtwork: View {
    enum Style: Sendable {
        /// Wordmark for short names, initials otherwise.
        case automatic
        /// Always initials (small thumbnails).
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
        let tint = BrandTint(seed: seed ?? name)
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let mark = markText
            ZStack {
                LinearGradient(colors: [tint.top, tint.bottom], startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(
                    colors: [tint.glow.opacity(0.55), tint.glow.opacity(0)],
                    center: UnitPoint(x: 0.22, y: 0.18),
                    startRadius: 0,
                    endRadius: max(geo.size.width, geo.size.height) * 0.75
                )
                Text(mark)
                    .font(.yardDisplay(mark.count <= 3 ? side * 0.62 : side * 0.36))
                    .textCase(.uppercase)
                    .tracking(-1)
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.13))
                    .lineLimit(1)
                    .minimumScaleFactor(0.3)
                    .padding(.horizontal, side * 0.06)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
        }
        .accessibilityHidden(true)
    }

    private var markText: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Y" }
        if style == .automatic, trimmed.count <= 9 { return trimmed }
        let words = trimmed.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" })
        let letters = words.prefix(2).compactMap { $0.first }.map { String($0) }.joined()
        return letters.isEmpty ? String(trimmed.prefix(1)) : letters
    }
}

/// A stable, brand-specific colour set. Deterministic (FNV-1a over the seed), never random,
/// so a brand looks the same on every screen and every launch.
struct BrandTint: Sendable {
    let top: Color
    let bottom: Color
    let glow: Color

    init(seed: String) {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in seed.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        let hue = Double(hash % 360) / 360
        let drift = Double((hash >> 12) % 40) / 360
        top = Color(hue: hue, saturation: 0.55, brightness: 0.36)
        bottom = Color(hue: (hue + drift).truncatingRemainder(dividingBy: 1), saturation: 0.6, brightness: 0.1)
        glow = Color(hue: hue, saturation: 0.35, brightness: 0.85)
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
