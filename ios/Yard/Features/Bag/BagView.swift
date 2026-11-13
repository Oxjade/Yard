import SwiftUI

/// The bag (website: /bag, src/components/market/checkout/bag-view.tsx + bag-contents.tsx).
///
/// Lines grouped by brand — each brand packs and ships its own parcel — with a per-brand subtotal,
/// shipping price and arrival estimate from the server's quote for the shopper's delivery country,
/// a stepper per line, swipe to remove, and a bottom bar with the total and Checkout.
@MainActor
struct BagView: View {
    @Environment(CartStore.self) private var cart
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var quotes: BagQuoteLoader
    @State private var shipTo: String = BagMarkets.shipTo
    @State private var checkoutTaps: Int = 0
    @State private var removedTaps: Int = 0

    init() {
        _quotes = State(initialValue: BagQuoteLoader())
    }

    /// Previews: inject quotes so the delivery rows render without the network.
    init(previewQuotes: BagQuoteLoader) {
        _quotes = State(initialValue: previewQuotes)
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .task { await cart.load() }
            .task(id: quoteKey) { await loadQuotes() }
            .onChange(of: shipTo) { _, newValue in
                BagMarkets.shipTo = newValue
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: checkoutTaps)
            .sensoryFeedback(.success, trigger: removedTaps)
    }

    @ViewBuilder
    private var content: some View {
        if let c = cart.cart {
            if c.lines.isEmpty {
                emptyState
            } else {
                bagList(c)
            }
        } else if let error = cart.lastError {
            EmptyState.error(error) { await cart.load() }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            BagSkeleton()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 0) {
            header(itemCount: 0, brandCount: 0)
                .padding(.horizontal, Spacing.gutter)
            Spacer(minLength: 0)
            EmptyState(
                title: "Your bag is empty",
                message: "Add pieces from any brand and they check out together, one order per brand.",
                systemImage: "bag",
                actionTitle: "Discover brands",
                action: { router.push(.brandsDirectory) }
            )
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: List

    private func bagList(_ c: Cart) -> some View {
        let grouped = Set(c.groups.flatMap { $0.variantIds })
        let loose = c.lines.filter { !grouped.contains($0.variantId) }
        return List {
            Section {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    header(itemCount: c.itemCount, brandCount: c.groups.count)
                    BagNotice(systemImage: "shippingbox", text: "One checkout creates one order per brand. Each brand packs and ships its own parcel, with its own tracking.")
                    shipToMenu
                    if !c.issues.isEmpty {
                        BagNotice(systemImage: "exclamationmark.circle", text: c.issues.joined(separator: "\n"), tint: Color.yard.danger)
                    }
                }
                .listRowInsets(EdgeInsets(top: 0, leading: Spacing.gutter, bottom: Spacing.s, trailing: Spacing.gutter))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            ForEach(c.groups) { group in
                let lines = c.lines(in: group)
                let quote = quotes.quote(for: group.brandId)
                Section {
                    ForEach(lines) { line in
                        lineRow(line, currency: c.currency)
                    }
                    BagGroupFooter(
                        subtotalMinor: group.subtotalMinor,
                        currency: c.currency,
                        quote: quote,
                        isLoading: quotes.isLoading,
                        countryName: BagMarkets.country(shipTo).name
                    )
                    .listRowBackground(Color.yard.surface)
                    .listRowSeparatorTint(Color.yard.line)
                } header: {
                    BagGroupHeader(name: brandName(lines: lines, quote: quote), pieces: lines.reduce(0) { $0 + $1.qty })
                }
            }

            if !loose.isEmpty {
                Section {
                    ForEach(loose) { line in
                        lineRow(line, currency: c.currency)
                    }
                } header: {
                    BagGroupHeader(name: "No longer available", pieces: nil)
                }
            }

            Section {
                Text("Taxes aren't calculated in this build. Import duties, if any, are collected by the courier on delivery. Delivery dates are estimates, not guarantees.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: Spacing.gutter, bottom: 0, trailing: Spacing.gutter))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .refreshable {
            await cart.load()
            await loadQuotes()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomBar(c)
        }
        .animation(Motion.spring, value: c.lines.map { $0.variantId })
    }

    private func lineRow(_ line: CartLine, currency: String) -> some View {
        BagLineRow(
            line: line,
            currency: currency,
            isBusy: cart.busyVariantIds.contains(line.variantId),
            onOpen: {
                if let id = line.productId { router.push(.product(slug: id)) }
            },
            onQuantity: { qty in setQuantity(line, qty) }
        )
        .listRowBackground(Color.yard.surface)
        .listRowSeparatorTint(Color.yard.line)
        .listRowInsets(EdgeInsets(top: Spacing.m, leading: Spacing.m, bottom: Spacing.m, trailing: Spacing.m))
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                remove(line)
            } label: {
                Label("Remove", systemImage: "trash")
            }
            .tint(Color.yard.danger)
        }
    }

    private func header(itemCount: Int, brandCount: Int) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Bag")
                .yardDisplay(44)
                .foregroundStyle(Color.yard.ink)
            if itemCount > 0 {
                Text("\(plural(itemCount, "item")) from \(plural(brandCount, "brand"))")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, Spacing.s)
    }

    private var shipToMenu: some View {
        Menu {
            Picker("Deliver to", selection: $shipTo) {
                ForEach(BagMarkets.countries) { country in
                    Text(country.name).tag(country.code)
                }
            }
        } label: {
            HStack(spacing: Spacing.s) {
                Image(systemName: "location")
                    .font(.system(size: 13, weight: .semibold))
                Text("Delivering to \(BagMarkets.country(shipTo).name)")
                    .font(.yardCaptionEmphasis)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(Color.yard.ink)
            .padding(.horizontal, Spacing.m)
            .frame(height: 32)
            .background(Color.yard.surface2, in: Capsule())
        }
        .accessibilityLabel(Text("Delivery country, \(BagMarkets.country(shipTo).name)"))
    }

    // MARK: Bottom bar

    private func bottomBar(_ c: Cart) -> some View {
        let shipping = shippingTotal(c)
        let blocked = c.lines.contains { $0.isUnavailable }
        return VStack(spacing: Spacing.s) {
            if blocked {
                Text("Remove the pieces that aren't available to check out.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(shipping == nil ? "Subtotal" : "Total"), \(plural(c.itemCount, "item"))")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                    PriceText(minor: c.subtotalMinor + (shipping ?? 0), currency: c.currency, font: .yardNumber(22))
                        .contentTransition(.numericText())
                }
                Spacer(minLength: Spacing.s)
                YardButton("Checkout", systemImage: "lock", fullWidth: false) {
                    goToCheckout()
                }
                .disabled(blocked || c.itemCount == 0)
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.m)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.yard.line).frame(height: 1)
        }
    }

    // MARK: Actions

    private func goToCheckout() {
        checkoutTaps += 1
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        router.push(.checkout)
    }

    private func setQuantity(_ line: CartLine, _ qty: Int) {
        Task { @MainActor in
            do {
                try await cart.setQuantity(variantId: line.variantId, qty: qty)
                if qty <= 0 { removedTaps += 1 }
            } catch {
                toast.show(error)
            }
        }
    }

    private func remove(_ line: CartLine) {
        Task { @MainActor in
            do {
                try await cart.remove(variantId: line.variantId)
                removedTaps += 1
                toast.show("Removed from your bag", style: .info, systemImage: "trash")
            } catch {
                toast.show(error)
            }
        }
    }

    // MARK: Quotes

    /// Changes whenever the lines, currency or destination change, re-running the quote.
    private var quoteKey: String {
        let lines = (cart.cart?.lines ?? []).map { "\($0.variantId):\($0.qty)" }.joined(separator: ",")
        return "\(cart.currency)|\(shipTo)|\(lines)"
    }

    private func loadQuotes() async {
        guard let c = cart.cart, !c.lines.isEmpty else { return }
        let city: String? = BagMarkets.shipToCity
        await quotes.load(currency: c.currency, to: shipTo, city: city)
    }

    /// Shipping across brands, or nil until every brand has a deliverable option.
    private func shippingTotal(_ c: Cart) -> Int? {
        guard !c.groups.isEmpty else { return nil }
        var sum = 0
        for g in c.groups {
            guard let q = quotes.quote(for: g.brandId), !q.unavailable, let o = q.option(for: nil) else { return nil }
            sum += o.free ? 0 : o.priceMinor
        }
        return sum
    }

    private func brandName(lines: [CartLine], quote: BagGroupQuote?) -> String {
        if let n = lines.first(where: { ($0.brandName ?? "").isEmpty == false })?.brandName { return n }
        if let q = quote, !q.brandName.isEmpty { return q.brandName }
        return "Brand"
    }

    private func plural(_ n: Int, _ one: String) -> String {
        "\(n) \(n == 1 ? one : one + "s")"
    }
}

// MARK: - Pieces

/// One bag line: photo, title, variant, line price, stepper.
struct BagLineRow: View {
    let line: CartLine
    let currency: String
    let isBusy: Bool
    let onOpen: () -> Void
    let onQuantity: (Int) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            Button(action: onOpen) {
                RemoteImage(url: line.imageURL, maxPixelSize: 300)
                    .frame(width: 76, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                    .saturation(line.isUnavailable ? 0 : 1)
                    .opacity(line.isUnavailable ? 0.6 : 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(line.title ?? "Piece"))

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Button(action: onOpen) {
                    Text(line.title ?? "A piece from your bag")
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                if let label = line.variantLabel, !label.isEmpty {
                    Text(label)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
                if let note = statusNote {
                    Text(note)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.danger)
                }
                Spacer(minLength: Spacing.xs)
                HStack(alignment: .center, spacing: Spacing.s) {
                    VStack(alignment: .leading, spacing: 0) {
                        PriceText(minor: line.lineMinor, currency: currency, font: .yardBodyEmphasis)
                        if line.qty > 1 {
                            Text("\(Formatters.price(minor: line.unitMinor, currency: currency)) each")
                                .font(.yardMicro)
                                .foregroundStyle(Color.yard.ink3)
                        }
                    }
                    Spacer(minLength: Spacing.s)
                    QuantityStepper(value: line.qty, range: 0...upperBound, isBusy: isBusy, onChange: onQuantity)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        }
    }

    /// The most the stepper allows: what's left (the server caps a line at 20).
    private var upperBound: Int {
        max(0, min(20, line.available))
    }

    private var statusNote: String? {
        if line.isUnavailable {
            switch line.unavailableReason ?? "" {
            case "sold_out": return "Sold out"
            case "not_for_sale": return "Not selling yet"
            default: return "No longer available"
            }
        }
        if line.isShort { return "Only \(line.available) left" }
        return nil
    }
}

/// Brand section header: name + piece count.
struct BagGroupHeader: View {
    let name: String
    let pieces: Int?

    var body: some View {
        HStack(spacing: Spacing.s) {
            BrandAvatar(name: name, size: 24)
            Text(name)
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1)
            Spacer(minLength: Spacing.s)
            if let pieces {
                Text(pieces == 1 ? "1 piece" : "\(pieces) pieces")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
        .textCase(nil)
        .padding(.bottom, Spacing.xs)
    }
}

/// A brand group's subtotal, shipping and arrival estimate (from the server quote only: a
/// skeleton while it loads, "calculated at checkout" when it couldn't).
struct BagGroupFooter: View {
    let subtotalMinor: Int
    let currency: String
    let quote: BagGroupQuote?
    let isLoading: Bool
    let countryName: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Text("Subtotal")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                Spacer()
                PriceText(minor: subtotalMinor, currency: currency, font: .yardBodyEmphasis)
            }
            shipping
        }
        .padding(.vertical, Spacing.xs)
    }

    @ViewBuilder
    private var shipping: some View {
        if let quote {
            if quote.unavailable || quote.option(for: nil) == nil {
                Text("\(quote.reason ?? "Doesn't ship to \(countryName)"). Remove its pieces or change the delivery country at checkout.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            } else if let option = quote.option(for: nil) {
                HStack {
                    Text("Shipping, \(option.label.lowercased())")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                    Spacer()
                    if option.free {
                        Text("Free")
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.success)
                    } else {
                        PriceText(minor: option.priceMinor, currency: option.currency, font: .yardBodyEmphasis)
                    }
                }
                if let arrival = option.arrivalText {
                    Tag(arrival, style: .neutral, systemImage: "truck.box")
                }
            }
        } else if isLoading {
            HStack {
                Skeleton(shape: .capsule).frame(width: 110, height: 12)
                Spacer()
                Skeleton(shape: .capsule).frame(width: 48, height: 12)
            }
            Skeleton(shape: .capsule).frame(width: 150, height: 22)
        } else {
            Text("Shipping is calculated at checkout")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
        }
    }
}

/// A quiet bordered notice with an icon (the website's Notice).
struct BagNotice: View {
    let systemImage: String
    let text: String
    var tint: Color = Color.yard.ink2

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .padding(.top, 1)
            Text(text)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .yardCard(background: Color.yard.surface, radius: Radius.small)
    }
}

/// Loading placeholder shaped like the bag.
struct BagSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Skeleton(cornerRadius: 8).frame(width: 120, height: 40)
                Skeleton(cornerRadius: Radius.small).frame(height: 56)
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: Spacing.m) {
                        Skeleton(shape: .capsule).frame(width: 140, height: 16)
                        ForEach(0..<2, id: \.self) { _ in
                            HStack(spacing: Spacing.m) {
                                Skeleton(cornerRadius: Radius.small).frame(width: 76, height: 96)
                                VStack(alignment: .leading, spacing: Spacing.s) {
                                    Skeleton(shape: .capsule).frame(height: 14)
                                    Skeleton(shape: .capsule).frame(width: 80, height: 12)
                                    Spacer()
                                    Skeleton(shape: .capsule).frame(width: 60, height: 16)
                                }
                            }
                            .frame(height: 96)
                        }
                    }
                    .padding(Spacing.m)
                    .yardCard()
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
        .scrollDisabled(true)
        .accessibilityLabel(Text("Loading your bag"))
    }
}

// MARK: - Previews

@MainActor
private enum BagPreviewData {
    static let cart: Cart = Cart(
        id: "cart_preview",
        currency: "USD",
        itemCount: 3,
        subtotalMinor: 21900,
        lines: [
            CartLine(variantId: "v1", productId: "p1", brandId: "b1", title: "Boxy heavyweight tee", variantLabel: "Size M, Black", qty: 2, available: 5, unitMinor: 4500, lineMinor: 9000, brandName: "Acme Studio"),
            CartLine(variantId: "v2", productId: "p2", brandId: "b2", title: "Cargo pant", variantLabel: "Size 32", qty: 1, available: 1, unitMinor: 12900, lineMinor: 12900, brandName: "Lagos Uniform"),
        ],
        groups: [],
        issues: [],
        removedSample: 0,
        destination: nil
    )

    static let quotes: [BagGroupQuote] = [
        BagGroupQuote(brandId: "b1", brandName: "Acme Studio", options: [
            BagQuoteOption(service: "standard", label: "Standard", priceMinor: 600, currency: "USD", estimate: BagEstimate(arrivalFrom: "2026-11-18", arrivalTo: "2026-11-21")),
        ]),
        BagGroupQuote(brandId: "b2", brandName: "Lagos Uniform", unavailable: true, reason: "Doesn't ship to Japan", options: []),
    ]
}

#Preview("BagView — dark") {
    NavigationStack { BagView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BagView — light") {
    NavigationStack { BagView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Bag rows — dark") {
    List {
        Section {
            ForEach(BagPreviewData.cart.lines) { line in
                BagLineRow(line: line, currency: "USD", isBusy: false, onOpen: {}, onQuantity: { _ in })
                    .listRowBackground(Color.yard.surface)
            }
            BagGroupFooter(subtotalMinor: 9000, currency: "USD", quote: BagPreviewData.quotes[0], isLoading: false, countryName: "Nigeria")
                .listRowBackground(Color.yard.surface)
        } header: {
            BagGroupHeader(name: "Acme Studio", pieces: 3)
        }
    }
    .listStyle(.insetGrouped)
    .scrollContentBackground(.hidden)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Bag rows — light") {
    List {
        Section {
            ForEach(BagPreviewData.cart.lines) { line in
                BagLineRow(line: line, currency: "USD", isBusy: line.variantId == "v2", onOpen: {}, onQuantity: { _ in })
                    .listRowBackground(Color.yard.surface)
            }
            BagGroupFooter(subtotalMinor: 12900, currency: "USD", quote: BagPreviewData.quotes[1], isLoading: false, countryName: "Japan")
                .listRowBackground(Color.yard.surface)
        } header: {
            BagGroupHeader(name: "Lagos Uniform", pieces: 1)
        }
    }
    .listStyle(.insetGrouped)
    .scrollContentBackground(.hidden)
    .background(Color.yard.bg)
    .preferredColorScheme(.light)
}
