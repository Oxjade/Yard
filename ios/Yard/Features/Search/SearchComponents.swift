import SwiftUI

// Small building blocks private to the Search feature (prefixed `Search…`).

/// Wraps its children onto as many rows as needed (Browse and Try chips).
struct SearchFlowLayout: Layout {
    var spacing: CGFloat = Spacing.s
    var lineSpacing: CGFloat = Spacing.s

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth: CGFloat = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += rowHeight + lineSpacing
                x = 0
                rowHeight = 0
            }
            x += size.width
            widest = max(widest, x)
            x += spacing
            rowHeight = max(rowHeight, size.height)
        }
        let width: CGFloat = proposal.width ?? widest
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + lineSpacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// A small caption-style section label ("Recent", "Browse", "Brands"), with an optional action.
struct SearchSectionLabel: View {
    let title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    init(_ title: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        HStack {
            Text(title)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink3)
                .textCase(.uppercase)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.s)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }
}

/// A product match in the type-ahead list: thumbnail, title, brand, price.
struct SearchProductRow: View {
    let item: SearchItem

    var body: some View {
        HStack(spacing: Spacing.m) {
            RemoteImage(path: item.image, maxPixelSize: 200)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                if let brandName = item.brandName, !brandName.isEmpty {
                    Text(brandName)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.s)
            if let price = item.shownPrice {
                Text(Formatters.price(minor: price.amount, currency: price.currency))
                    .font(.yardCallout.weight(.semibold))
                    .foregroundStyle(Color.yard.ink)
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// A brand match in the type-ahead list: monogram, name, city.
struct SearchBrandRow: View {
    let brand: SearchBrandHit

    var body: some View {
        HStack(spacing: Spacing.m) {
            BrandAvatar(name: brand.name, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(brand.name)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                if let location = brand.locationText {
                    Text(location)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.s)
            Image(systemName: "chevron.right")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink3)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.xs)
        .contentShape(Rectangle())
    }
}

/// Loading rows while the marketplace is searched.
struct SearchRowsSkeleton: View {
    var count: Int = 4

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            ForEach(0..<count, id: \.self) { index in
                HStack(spacing: Spacing.m) {
                    Skeleton(cornerRadius: Radius.small)
                        .frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 6) {
                        Skeleton(cornerRadius: 4)
                            .frame(width: index % 2 == 0 ? 170 : 130, height: 12)
                        Skeleton(cornerRadius: 4)
                            .frame(width: 90, height: 10)
                    }
                    Spacer()
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Searching the marketplace")
    }
}
