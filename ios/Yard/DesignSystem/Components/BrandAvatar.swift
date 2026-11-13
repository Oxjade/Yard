import SwiftUI

/// A round brand logo with a monogram fallback and optional verified tick.
///
///   BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 44, verified: brand.verified)
///   BrandAvatar(name: "Acme")                        // monogram "AC"
struct BrandAvatar: View {
    let name: String
    var logoURL: URL? = nil
    var size: CGFloat = 40
    var verified: Bool = false

    init(name: String, logoURL: URL? = nil, size: CGFloat = 40, verified: Bool = false) {
        self.name = name
        self.logoURL = logoURL
        self.size = size
        self.verified = verified
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.yard.surface2)
            if let logoURL {
                RemoteImage(url: logoURL, contentMode: .fill, maxPixelSize: size * 3) {
                    monogram
                }
                .clipShape(Circle())
            } else {
                monogram
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
        .overlay(alignment: .bottomTrailing) {
            if verified {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: max(10, size * 0.3)))
                    .foregroundStyle(Color.yard.violet)
                    .background(Circle().fill(Color.yard.bg).padding(1))
                    .offset(x: size * 0.06, y: size * 0.06)
                    .accessibilityLabel(Text("Verified"))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(name))
    }

    private var monogram: some View {
        Text(BrandCard.monogram(for: name))
            .font(.system(size: size * 0.36, weight: .black).width(.compressed))
            .foregroundStyle(Color.yard.ink)
    }
}

#Preview("Avatar — dark") {
    HStack(spacing: 16) {
        BrandAvatar(name: "Acme Studio", size: 56, verified: true)
        BrandAvatar(name: "Lagos Thread")
        BrandAvatar(name: "Ø", size: 32)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Avatar — light") {
    BrandAvatar(name: "Acme Studio", size: 72, verified: true)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
