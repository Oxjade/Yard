import SwiftUI

/// A formatted price, with the compare-at ("was") price struck through when it is higher.
///
///   PriceText(minor: product.priceMinor, currency: product.currency, compareAtMinor: product.compareAtMinor)
///   PriceText(money: line.unitPrice!, font: .yardTitle)
///   PriceText(product: product)                     // uses the product's price/compareAt
struct PriceText: View {
    let minor: Int
    let currency: String
    var compareAtMinor: Int? = nil
    var font: Font = .yardBodyEmphasis
    var color: Color = Color.yard.ink

    init(minor: Int, currency: String, compareAtMinor: Int? = nil, font: Font = .yardBodyEmphasis, color: Color = Color.yard.ink) {
        self.minor = minor
        self.currency = currency
        self.compareAtMinor = compareAtMinor
        self.font = font
        self.color = color
    }

    init(money: Money, compareAtMinor: Int? = nil, font: Font = .yardBodyEmphasis, color: Color = Color.yard.ink) {
        self.init(minor: money.amount, currency: money.currency, compareAtMinor: compareAtMinor, font: font, color: color)
    }

    init(product: Product, font: Font = .yardBodyEmphasis, color: Color = Color.yard.ink) {
        self.init(minor: product.priceMinor, currency: product.currency, compareAtMinor: product.compareAtMinor, font: font, color: color)
    }

    private var showsCompare: Bool {
        guard let c = compareAtMinor else { return false }
        return c > minor
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
            Text(Formatters.price(minor: minor, currency: currency))
                .font(font)
                .foregroundStyle(color)
                .monospacedDigit()
            if showsCompare, let c = compareAtMinor {
                Text(Formatters.price(minor: c, currency: currency))
                    .font(.yardCaption)
                    .strikethrough(true, color: Color.yard.ink3)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    private var accessibilityText: String {
        let now = Formatters.price(minor: minor, currency: currency)
        if showsCompare, let c = compareAtMinor {
            return "\(now), was \(Formatters.price(minor: c, currency: currency))"
        }
        return now
    }
}

#Preview("Price — dark") {
    VStack(spacing: 12) {
        PriceText(minor: 4500, currency: "USD")
        PriceText(minor: 3200, currency: "USD", compareAtMinor: 4000)
        PriceText(minor: 1_250_000, currency: "NGN", font: .yardTitle)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Price — light") {
    PriceText(minor: 6400, currency: "MXN", compareAtMinor: 8000)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
