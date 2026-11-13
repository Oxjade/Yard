import SwiftUI

/// A selectable pill: filters, categories, size chips, the Home top tabs.
///
///   Chip("For you", isSelected: tab == .forYou) { tab = .forYou }
///   Chip("M", isSelected: size == "M", isEnabled: inStock) { size = "M" }       // size chip
///   Chip("Filters", systemImage: "slider.horizontal.3", isSelected: false) { … }
///
/// Selected = `ink` fill with `bg` text; unselected = `surface2` with `ink`. A disabled chip
/// (sold-out size) is struck through and not tappable.
struct Chip: View {
    let title: String
    var systemImage: String? = nil
    var isSelected: Bool = false
    var isEnabled: Bool = true
    /// Optional trailing count ("Bags 12").
    var count: Int? = nil
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, isSelected: Bool = false, isEnabled: Bool = true, count: Int? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.isEnabled = isEnabled
        self.count = count
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.yardCaptionEmphasis)
                }
                Text(title)
                    .font(.yardCallout.weight(.semibold))
                    .strikethrough(!isEnabled, color: Color.yard.ink3)
                    .lineLimit(1)
                if let count {
                    Text(Formatters.count(count))
                        .font(.yardMicro)
                        .foregroundStyle(isSelected ? Color.yard.bg.opacity(0.7) : Color.yard.ink3)
                }
            }
            .foregroundStyle(isSelected ? Color.yard.bg : (isEnabled ? Color.yard.ink : Color.yard.ink3))
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: 36)
            .background(isSelected ? Color.yard.ink : Color.yard.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: isSelected ? 0 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(!isEnabled)
        .animation(Motion.snappy, value: isSelected)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A horizontally scrolling row of chips with screen gutters.
///
///   ChipRow { Chip(…); Chip(…) }
struct ChipRow<Content: View>: View {
    var spacing: CGFloat = Spacing.s
    @ViewBuilder let content: () -> Content

    init(spacing: CGFloat = Spacing.s, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: spacing) {
                content()
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }
}

#Preview("Chips — dark") {
    ChipsPreview().preferredColorScheme(.dark)
}

#Preview("Chips — light") {
    ChipsPreview().preferredColorScheme(.light)
}

private struct ChipsPreview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ChipRow {
                Chip("For you", isSelected: true) {}
                Chip("Following") {}
                Chip("Tops") {}
                Chip("Filters", systemImage: "slider.horizontal.3", count: 3) {}
            }
            HStack {
                Chip("S") {}
                Chip("M", isSelected: true) {}
                Chip("L", isEnabled: false) {}
            }
            .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
