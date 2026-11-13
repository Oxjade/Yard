import SwiftUI

/// A rounded (20pt, continuous) `surface` card with a hairline border.
///
///   Card { VStack { … } }
///   Card(padding: 0) { settingsRows }          // rows that draw their own padding
///   anyView.yardCard()                          // the same look as a modifier
struct Card<Content: View>: View {
    var padding: CGFloat = Spacing.l
    var background: Color = Color.yard.surface
    @ViewBuilder let content: () -> Content

    init(padding: CGFloat = Spacing.l, background: Color = Color.yard.surface, @ViewBuilder content: @escaping () -> Content) {
        self.padding = padding
        self.background = background
        self.content = content
    }

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .yardCard(background: background)
    }
}

extension View {
    /// Card chrome: `surface` fill, 20pt continuous corners, hairline border.
    func yardCard(background: Color = Color.yard.surface, radius: CGFloat = Radius.card) -> some View {
        self
            .background(background, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.yard.line, lineWidth: 1)
            )
    }

    /// The app background, full-bleed (use on every screen's root).
    func yardScreenBackground() -> some View {
        background(Color.yard.bg.ignoresSafeArea())
    }
}

/// A settings-style row: icon tile, title, optional value, chevron (reference 08-settings).
///
///   Card(padding: 0) {
///       VStack(spacing: 0) {
///           SettingsRow("Appearance", systemImage: "circle.lefthalf.filled", value: "System")
///           Divider().overlay(Color.yard.line)
///           SettingsRow("Notifications", systemImage: "bell") { Toggle("", isOn: $on).labelsHidden() }
///       }
///   }
/// Wrap in `NavigationLink(value:)` or `Button` for navigation; the row shows a chevron unless an
/// accessory is given.
struct SettingsRow<Accessory: View>: View {
    let title: String
    let systemImage: String
    var value: String? = nil
    var tint: Color = Color.yard.ink
    var showsChevron: Bool = true
    @ViewBuilder let accessory: () -> Accessory

    init(_ title: String, systemImage: String, value: String? = nil, tint: Color = Color.yard.ink, showsChevron: Bool = true, @ViewBuilder accessory: @escaping () -> Accessory) {
        self.title = title
        self.systemImage = systemImage
        self.value = value
        self.tint = tint
        self.showsChevron = showsChevron
        self.accessory = accessory
    }

    var body: some View {
        HStack(spacing: Spacing.m) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(title)
                .font(.yardBody)
                .foregroundStyle(tint)
            Spacer(minLength: Spacing.s)
            if let value {
                Text(value)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
            }
            accessory()
            if showsChevron && Accessory.self == EmptyView.self {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

extension SettingsRow where Accessory == EmptyView {
    init(_ title: String, systemImage: String, value: String? = nil, tint: Color = Color.yard.ink, showsChevron: Bool = true) {
        self.init(title, systemImage: systemImage, value: value, tint: tint, showsChevron: showsChevron) { EmptyView() }
    }
}

#Preview("Card — dark") {
    CardPreview().preferredColorScheme(.dark)
}

#Preview("Card — light") {
    CardPreview().preferredColorScheme(.light)
}

private struct CardPreview: View {
    @State private var on = true
    var body: some View {
        VStack(spacing: 16) {
            Card {
                Text("Designers focused on impactful, considered streetwear.")
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
            }
            Card(padding: 0) {
                VStack(spacing: 0) {
                    SettingsRow("Appearance", systemImage: "circle.lefthalf.filled", value: "System")
                    Divider().overlay(Color.yard.line)
                    SettingsRow("Drop alerts", systemImage: "bell") {
                        Toggle("", isOn: $on).labelsHidden().tint(Color.yard.acid)
                    }
                    Divider().overlay(Color.yard.line)
                    SettingsRow("Sign out", systemImage: "rectangle.portrait.and.arrow.right", tint: Color.yard.danger, showsChevron: false)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
