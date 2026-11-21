import SwiftUI

// Small pieces shared by the Studio screens.

/// The ink card (inspo: the black balance / tracking card): fixed near-black in both modes with a
/// lit hairline, white text, acid accents.
struct StudioInkCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .padding(Spacing.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.yard.scrim, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Color.yard.glassEdge, lineWidth: 0.75)
            )
    }
}

/// A round quick action with a label under it (inspo: Send / Receive circles). Wrap it in a
/// `Button` or a `ShareLink`.
struct StudioQuickActionLabel: View {
    let title: String
    let systemImage: String
    var badge: Int = 0

    var body: some View {
        VStack(spacing: Spacing.s) {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 60, height: 60)
                .background(Color.yard.surface, in: Circle())
                .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        StudioBadge(count: badge)
                            .offset(x: 4, y: -2)
                    }
                }
            Text(title)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(badge > 0 ? "\(title), \(badge)" : title))
    }
}

/// A small count bubble.
struct StudioBadge: View {
    let count: Int

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.yardMicro)
            .monospacedDigit()
            .foregroundStyle(Color.yard.onAcid)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(Color.yard.acid, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.bg, lineWidth: 1.5))
            .contentTransition(.numericText())
    }
}

/// The status words and tag style for an order's `states.merchant`.
enum StudioOrderState {
    static func label(_ state: String) -> String {
        switch state {
        case "pending_payment": return "Awaiting payment"
        case "paid": return "To ship"
        case "processing": return "Processing"
        case "shipped": return "Shipped"
        case "delivered": return "Delivered"
        case "cancelled": return "Cancelled"
        case "refund_requested": return "Refund requested"
        case "refunded": return "Refunded"
        default: return state.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    static func style(_ state: String) -> Tag.Style {
        switch state {
        case "paid", "processing": return .acid
        case "shipped": return .violet
        case "delivered": return .success
        case "cancelled", "refunded", "refund_requested": return .danger
        default: return .neutral
        }
    }

    /// Steps of the progress line and how far the order is (0…3), nil when it left the line.
    static let steps: [String] = ["Paid", "Processing", "Shipped", "Delivered"]

    static func progressIndex(_ state: String) -> Int? {
        switch state {
        case "paid": return 0
        case "processing": return 1
        case "shipped": return 2
        case "delivered": return 3
        default: return nil
        }
    }
}

/// The product status words.
enum StudioProductState {
    static func label(_ status: String) -> String {
        switch status {
        case "published": return "Live"
        case "draft": return "Draft"
        case "scheduled": return "Scheduled"
        case "archived": return "Archived"
        default: return status.capitalized
        }
    }

    static func style(_ status: String) -> Tag.Style {
        switch status {
        case "published": return .success
        case "scheduled": return .violet
        case "archived": return .danger
        default: return .neutral
        }
    }
}

/// A grouped list card of rows (inspo: dark grouped rows).
struct StudioGroup<Content: View>: View {
    let title: String?
    @ViewBuilder let content: () -> Content

    init(_ title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let title {
                Text(title)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                    .padding(.horizontal, Spacing.xs)
                    .accessibilityAddTraits(.isHeader)
            }
            VStack(spacing: 0) {
                content()
            }
            .padding(.vertical, Spacing.xs)
            .yardCard()
        }
    }
}

/// A brand avatar that loads a private (`?as=brand`) logo only once the brand session is open.
struct StudioBrandMark: View {
    let brand: ShopperBrand
    var size: CGFloat = 44
    var sessionOpen: Bool = true

    var body: some View {
        let url: URL? = (brand.isPrivateLogo && !sessionOpen) ? nil : brand.logoURL
        ZStack {
            Circle().fill(Color.yard.studio)
            if let url {
                RemoteImage(url: url, contentMode: .fill, maxPixelSize: size * 3) { initials }
                    .clipShape(Circle())
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var initials: some View {
        Text(brand.initials)
            .font(.system(size: size * 0.36, weight: .black).width(.compressed))
            .foregroundStyle(Color.yard.onPhoto)
    }
}

/// A loading list of row skeletons.
struct StudioRowsSkeleton: View {
    var count: Int = 5

    var body: some View {
        VStack(spacing: Spacing.s) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(spacing: Spacing.m) {
                    Skeleton(cornerRadius: Radius.small).frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 6) {
                        Skeleton(cornerRadius: 4).frame(width: 160, height: 14)
                        Skeleton(cornerRadius: 4).frame(width: 100, height: 12)
                    }
                    Spacer()
                }
                .padding(Spacing.m)
                .yardCard()
            }
        }
        .accessibilityLabel(Text("Loading"))
    }
}

/// Minor units for a typed price: "45,000" → 4500000 in NGN; "12.5" → 1250 in USD; JPY/KRW have
/// no decimals.
enum StudioMoney {
    static func fractionDigits(_ currency: String) -> Int {
        switch currency.uppercased() {
        case "JPY", "KRW": return 0
        default: return 2
        }
    }

    static func minor(from text: String, currency: String) -> Int? {
        let cleaned = text.filter { $0.isNumber || $0 == "." || $0 == "," }
        guard !cleaned.isEmpty else { return nil }
        // Treat the last separator as decimal when it has 1–2 digits after it; others group thousands.
        var normalized = cleaned
        if let last = cleaned.lastIndex(where: { $0 == "." || $0 == "," }) {
            let after = cleaned.distance(from: last, to: cleaned.endIndex) - 1
            let head = cleaned[..<last].filter { $0.isNumber }
            let tail = cleaned[cleaned.index(after: last)...].filter { $0.isNumber }
            normalized = (after >= 1 && after <= 2) ? head + "." + tail : head + tail
        }
        guard let value = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")) else { return nil }
        let digits = fractionDigits(currency)
        var scaled = value
        for _ in 0..<digits { scaled *= 10 }
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        let number = NSDecimalNumber(decimal: rounded)
        guard number.doubleValue >= 0, number.doubleValue < 1e13 else { return nil }
        return number.intValue
    }
}

/// SKUs the way the website builds them: HANDLE-TITLE-OPTIONS, uppercase, ≤ 64, unique.
enum StudioSKU {
    static func part(_ s: String) -> String {
        var out = ""
        var dash = false
        for ch in s.uppercased() {
            if (ch.isLetter || ch.isNumber) && ch.isASCII {
                out.append(ch)
                dash = false
            } else if !out.isEmpty && !dash {
                out.append("-")
                dash = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out
    }

    static func make(handle: String, title: String, values: [String], taken: Set<String>) -> String {
        let pieces = [part(handle), String(part(title).prefix(24))] + values.map { String(part($0).prefix(12)) }
        var base = pieces.filter { !$0.isEmpty }.joined(separator: "-")
        if base.isEmpty { base = "ITEM" }
        base = String(base.prefix(60))
        var sku = base
        var n = 2
        while taken.contains(sku) {
            sku = String(base.prefix(60 - String(n).count - 1)) + "-\(n)"
            n += 1
        }
        return sku
    }
}
