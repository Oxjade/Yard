import SwiftUI

/// A section title row with an optional subtitle and trailing action ("See all").
///
///   SectionHeader("New drops", subtitle: "This week", actionTitle: "See all") { router.push(.drops) }
///   SectionHeader("Brands like this", display: true)   // heavy condensed capitals
struct SectionHeader: View {
    let title: String
    var subtitle: String? = nil
    /// Use the display face (uppercase, condensed) instead of the title face.
    var display: Bool = false
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    init(_ title: String, subtitle: String? = nil, display: Bool = false, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.display = display
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            VStack(alignment: .leading, spacing: 2) {
                if display {
                    Text(title)
                        .yardDisplay(26)
                        .foregroundStyle(Color.yard.ink)
                } else {
                    Text(title)
                        .font(.yardTitle)
                        .foregroundStyle(Color.yard.ink)
                }
                if let subtitle {
                    Text(subtitle)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.s)
            if let actionTitle, let action {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text(actionTitle)
                        Image(systemName: "chevron.right").font(.yardMicro)
                    }
                    .font(.yardCallout.weight(.semibold))
                    .foregroundStyle(Color.yard.ink2)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }
}

#Preview("SectionHeader — dark") {
    VStack(spacing: 24) {
        SectionHeader("New drops", subtitle: "This week", actionTitle: "See all") {}
        SectionHeader("Brands like this", display: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("SectionHeader — light") {
    SectionHeader("Following", actionTitle: "Manage") {}
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
