import SwiftUI

/// A round frosted-glass icon button for use over photos and headers (close ×, "…", share, heart).
///
///   GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close") { dismiss() }
///   GlassIconButton(systemImage: saved ? "heart.fill" : "heart", accessibilityLabel: "Save",
///                   tint: saved ? Color.yard.danger : nil) { … }
struct GlassIconButton: View {
    let systemImage: String
    let accessibilityLabel: String
    var size: CGFloat = 40
    /// Icon colour; defaults to `ink` (readable on the material in both modes).
    var tint: Color? = nil
    let action: () -> Void

    init(systemImage: String, accessibilityLabel: String, size: CGFloat = 40, tint: Color? = nil, action: @escaping () -> Void) {
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
        self.size = size
        self.tint = tint
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(tint ?? Color.yard.ink)
                .frame(width: size, height: size)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

#Preview("Glass — dark") {
    HStack(spacing: 16) {
        GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close") {}
        GlassIconButton(systemImage: "ellipsis", accessibilityLabel: "More") {}
        GlassIconButton(systemImage: "heart.fill", accessibilityLabel: "Saved", tint: Color.yard.danger) {}
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(LinearGradient(colors: [Color.yard.purple, Color.yard.bg], startPoint: .top, endPoint: .bottom))
    .preferredColorScheme(.dark)
}

#Preview("Glass — light") {
    HStack(spacing: 16) {
        GlassIconButton(systemImage: "chevron.left", accessibilityLabel: "Back") {}
        GlassIconButton(systemImage: "square.and.arrow.up", accessibilityLabel: "Share") {}
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.surface2)
    .preferredColorScheme(.light)
}
