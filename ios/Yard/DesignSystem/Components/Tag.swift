import SwiftUI

/// A small non-interactive label: "New arrival", "Sold out", "Draw", "Founding brand".
///
///   Tag("New arrival")                     // neutral
///   Tag("Live", style: .acid)
///   Tag("Sold out", style: .danger)
///   Tag("Founding", style: .violet, systemImage: "seal.fill")
///   Tag("-20%", style: .onPhoto)            // over images
struct Tag: View {
    enum Style: Sendable {
        case neutral
        case acid
        case violet
        case danger
        case success
        case onPhoto
    }

    let text: String
    var style: Style = .neutral
    var systemImage: String? = nil

    init(_ text: String, style: Style = .neutral, systemImage: String? = nil) {
        self.text = text
        self.style = style
        self.systemImage = systemImage
    }

    private var foreground: Color {
        switch style {
        case .neutral: return Color.yard.ink
        case .acid: return Color.yard.onAcid
        case .violet: return Color.yard.violet
        case .danger: return Color.yard.danger
        case .success: return Color.yard.success
        case .onPhoto: return Color.yard.onPhotoInk
        }
    }

    private var background: Color {
        switch style {
        case .neutral: return Color.yard.surface2
        case .acid: return Color.yard.acid
        case .violet: return Color.yard.violet.opacity(0.14)
        case .danger: return Color.yard.danger.opacity(0.14)
        case .success: return Color.yard.success.opacity(0.14)
        case .onPhoto: return Color.yard.onPhoto.opacity(0.92)
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(text)
                .lineLimit(1)
        }
        .font(.yardCaptionEmphasis)
        .foregroundStyle(foreground)
        .padding(.horizontal, Spacing.s)
        .padding(.vertical, 4)
        .background(background, in: Capsule())
    }
}

#Preview("Tags — dark") {
    TagsPreview().preferredColorScheme(.dark)
}

#Preview("Tags — light") {
    TagsPreview().preferredColorScheme(.light)
}

private struct TagsPreview: View {
    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Tag("New arrival")
                Tag("Live", style: .acid)
                Tag("Founding", style: .violet, systemImage: "seal.fill")
            }
            HStack {
                Tag("Sold out", style: .danger)
                Tag("Delivered", style: .success)
                Tag("-20%", style: .onPhoto)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
