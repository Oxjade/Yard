import Foundation
import Observation

/// What the main button can do right now (port of the website's `Action` in product-view.tsx;
/// drop phases are left to the drop screen).
enum ProductBuyAction: Equatable, Sendable {
    /// The brand isn't selling yet: "Notify me".
    case opening
    /// Nothing left (for the chosen variant or the whole piece).
    case soldOut
    /// A size (or another option) still has to be chosen.
    case chooseSize
    /// Everything that can be bought is already in the bag.
    case limit
    /// Add to bag.
    case ready

    var label: String {
        switch self {
        case .opening: return "Notify me"
        case .soldOut: return "Sold out"
        case .chooseSize: return "Select a size"
        case .limit: return "View bag"
        case .ready: return "Add to bag"
        }
    }
}

/// Loads one product (GET /api/catalog/products/{slug}) plus its rails and delivery estimate, and
/// holds the option selection. Selection rules follow src/components/market/product/use-product-selection.ts:
/// a colour-like option starts on its first value in stock; "Size" starts unchosen.
@Observable
@MainActor
final class ProductDetailModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case notFound
        case failed(String)
    }

    /// Website constants: `MAX_QTY_PER_LINE` (src/lib/stores/cart.ts) and `LOW_STOCK`.
    static let maxPerLine = 10
    static let lowStock = 3
    /// The website's markets (src/config/markets.ts); estimates are only quoted to these.
    static let markets: Set<String> = ["NG", "GH", "KE", "ZA", "GB", "FR", "DE", "US", "MX", "JP", "KR"]

    let slug: String
    private(set) var phase: Phase = .loading
    private(set) var product: Product?

    /// Option name → chosen value.
    var selection: [String: String] = [:]
    var quantity: Int = 1

    private(set) var moreFromBrand: [Product] = []
    private(set) var similar: [Product] = []
    private(set) var railsLoaded: Bool = false

    private(set) var estimate: ProductEstimate?
    private(set) var estimateLoading: Bool = false
    private(set) var estimateFailed: Bool = false
    private(set) var estimateCountry: String = "NG"

    /// Back-in-stock watch state for a variant id.
    private(set) var watching: [String: Bool] = [:]
    private(set) var watchBusy: Bool = false

    private let api: APIClient

    init(slug: String, api: APIClient = .shared) {
        self.slug = slug
        self.api = api
    }

    /// Preview-only: a model that already holds a product.
    init(preview product: Product) {
        self.slug = product.slug
        self.api = .shared
        self.product = product
        self.phase = .loaded
        self.selection = Self.initialSelection(for: product)
    }

    // MARK: Loading

    /// Loads (or refreshes) the product. Returns the error message when a refresh failed while
    /// the product is already on screen (it is kept), so the view can toast it; nil otherwise.
    @discardableResult
    func load(destinationCountry: String?, currency: String) async -> String? {
        if product == nil { phase = .loading }
        do {
            let escaped = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug
            let response: ProductResponse = try await api.get("/api/catalog/products/\(escaped)")
            let isNew = product?.id != response.product.id
            product = response.product
            if isNew {
                selection = Self.initialSelection(for: response.product)
                quantity = 1
            }
            phase = .loaded
        } catch let error as APIError {
            if error.isCancelled { return nil }
            if product == nil {
                phase = error.isNotFound ? .notFound : .failed(error.message)
                return nil
            }
            return error.message
        } catch {
            if product == nil {
                phase = .failed(APIError.message(for: error))
                return nil
            }
            return APIError.message(for: error)
        }
        guard let loaded = product else { return nil }
        async let rails: Void = loadRails(for: loaded)
        async let ship: Void = loadEstimate(for: loaded, destinationCountry: destinationCountry, currency: currency)
        _ = await (rails, ship)
        return nil
    }

    private func loadRails(for p: Product) async {
        let brandQuery: [URLQueryItem] = [
            URLQueryItem(name: "brand", value: p.brandId),
            URLQueryItem(name: "sort", value: "new"),
            URLQueryItem(name: "limit", value: "9"),
        ]
        let categoryQuery: [URLQueryItem] = [
            URLQueryItem(name: "category", value: p.category),
            URLQueryItem(name: "sort", value: "new"),
            URLQueryItem(name: "limit", value: "24"),
        ]
        async let brandPage: ProductsPage? = fetchPage(brandQuery, skip: p.brandId.isEmpty)
        async let categoryPage: ProductsPage? = fetchPage(categoryQuery, skip: p.category.isEmpty)
        let b: ProductsPage? = await brandPage
        let c: ProductsPage? = await categoryPage
        moreFromBrand = Array((b?.products ?? []).filter { $0.id != p.id }.prefix(8))
        similar = Array((c?.products ?? []).filter { $0.id != p.id && $0.brandId != p.brandId }.prefix(8))
        railsLoaded = true
    }

    private func fetchPage(_ query: [URLQueryItem], skip: Bool) async -> ProductsPage? {
        if skip { return nil }
        do {
            let page: ProductsPage = try await api.get("/api/catalog/products", query: query)
            return page
        } catch {
            return nil
        }
    }

    func loadEstimate(for p: Product, destinationCountry: String?, currency: String) async {
        let device = Locale.current.region?.identifier.uppercased()
        let candidate: String = (destinationCountry?.uppercased()).flatMap { Self.markets.contains($0) ? $0 : nil }
            ?? device.flatMap { Self.markets.contains($0) ? $0 : nil }
            ?? "NG"
        estimateCountry = candidate
        estimateLoading = true
        estimateFailed = false
        defer { estimateLoading = false }
        do {
            let e: ProductEstimate = try await api.get("/api/shipping/estimate", query: [
                URLQueryItem(name: "product", value: p.id),
                URLQueryItem(name: "to", value: candidate),
                URLQueryItem(name: "cur", value: currency),
            ])
            estimate = e
        } catch {
            if (error as? APIError)?.isCancelled == true { return }
            estimate = nil
            estimateFailed = true
        }
    }

    // MARK: Options

    /// The option axis named "Size" (case-insensitive), if any.
    var sizeOption: ProductOption? {
        product?.options.first { Self.isSizeName($0.name) }
    }

    /// Options other than size (colour and anything else), shown as chips/swatches above size.
    var otherOptions: [ProductOption] {
        product?.options.filter { !Self.isSizeName($0.name) } ?? []
    }

    nonisolated static func isSizeName(_ name: String) -> Bool {
        name.lowercased() == "size"
    }

    /// The brand isn't selling yet: every size reads as open, the action is Notify me.
    var isOpening: Bool { product?.isNotForSale ?? false }

    /// Variants matching every chosen value except `excluding`'s axis.
    private func variants(matchingSelectionExcept excluding: String?) -> [ProductVariant] {
        guard let p = product else { return [] }
        return p.variants.filter { v in
            for (name, value) in selection where name != excluding {
                if let vv = v.options[name], vv != value { return false }
            }
            return true
        }
    }

    /// Units available for `value` on `option`, given the other chosen values.
    func stock(for value: String, in option: ProductOption) -> Int {
        variants(matchingSelectionExcept: option.name)
            .filter { $0.options[option.name] == value }
            .reduce(0) { $0 + max(0, $1.available) }
    }

    /// The value exists in some variant for the current other choices.
    func exists(_ value: String, in option: ProductOption) -> Bool {
        variants(matchingSelectionExcept: option.name).contains { $0.options[option.name] == value }
    }

    func choose(_ value: String, for option: ProductOption) {
        selection[option.name] = value
        // Keep the size only if it is still in stock with the new choice (website rule).
        if !Self.isSizeName(option.name), let size = sizeOption, let chosen = selection[size.name] {
            if stock(for: chosen, in: size) == 0 { selection[size.name] = nil }
        }
        quantity = 1
    }

    /// Every axis has a value (or the product has no options).
    var needsSelection: Bool {
        guard let p = product else { return false }
        return p.options.contains { selection[$0.name] == nil }
    }

    /// The variant for the full selection; with no options, the first variant.
    var variant: ProductVariant? {
        guard let p = product else { return nil }
        if p.options.isEmpty { return p.variants.first }
        if needsSelection { return nil }
        return p.variants.first { v in
            p.options.allSatisfy { opt in v.options[opt.name] == selection[opt.name] }
        }
    }

    /// The chosen variant's stock, or nil when none is chosen.
    var variantStock: Int? { variant.map { max(0, $0.available) } }

    /// Sizes in stock for the current other choices.
    var sizesInStock: Int {
        guard let size = sizeOption else { return 0 }
        return size.values.filter { stock(for: $0.value, in: size) > 0 }.count
    }

    /// Stock across the variants that match the non-size choices.
    var stockForOtherChoices: Int {
        variants(matchingSelectionExcept: sizeOption?.name).reduce(0) { $0 + max(0, $1.available) }
    }

    /// The price to show: the chosen variant's, else the product's base price.
    var priceMinor: Int { variant?.priceMinor ?? product?.priceMinor ?? 0 }

    func inBag(_ cart: CartStore) -> Int {
        guard let v = variant else { return 0 }
        return cart.line(for: v.id)?.qty ?? 0
    }

    /// The most that can still go in the bag (stock, 10-per-line cap, what's already there).
    func maxQuantity(cart: CartStore) -> Int {
        let cap: Int
        if let s = variantStock { cap = min(Self.maxPerLine, s) } else { cap = Self.maxPerLine }
        return max(0, cap - inBag(cart))
    }

    func action(cart: CartStore) -> ProductBuyAction {
        guard let p = product else { return .soldOut }
        if isOpening { return .opening }
        let soldOut = p.isSoldOut || (variant != nil && variantStock == 0) || (needsSelection && sizeOption != nil && stockForOtherChoices == 0)
        if soldOut { return .soldOut }
        if needsSelection { return .chooseSize }
        if variant == nil { return .soldOut }
        if maxQuantity(cart: cart) == 0 { return .limit }
        return .ready
    }

    /// "Only 2 left", "In stock", "3 of 6 sizes in stock"… (website `StockLine`).
    func stockLine() -> (text: String, tone: StockTone) {
        if isOpening { return ("Opening soon", .muted) }
        if let s = variantStock, variant != nil {
            if s == 0 { return ("Sold out", .out) }
            if s <= Self.lowStock { return ("Only \(s) left", .low) }
            return ("In stock", .ok)
        }
        if let size = sizeOption {
            if stockForOtherChoices == 0 {
                let colour = otherOptions.first.flatMap { selection[$0.name] }
                return (colour.map { "Sold out in \($0.lowercased())" } ?? "Sold out", .out)
            }
            return ("\(sizesInStock) of \(size.values.count) sizes in stock", .muted)
        }
        if product?.isSoldOut == true { return ("Sold out", .out) }
        return ("Choose your options", .muted)
    }

    enum StockTone { case ok, low, out, muted }

    nonisolated static func initialSelection(for product: Product) -> [String: String] {
        var out: [String: String] = [:]
        for option in product.options where !isSizeName(option.name) {
            let inStock = option.values.first { value in
                product.variants.contains { $0.options[option.name] == value.value && $0.available > 0 }
            }
            if let pick = inStock ?? option.values.first {
                out[option.name] = pick.value
            }
        }
        // A size axis with a single value needs no choice.
        if let size = product.options.first(where: { isSizeName($0.name) }), size.values.count == 1, let only = size.values.first {
            out[size.name] = only.value
        }
        return out
    }

    // MARK: Back in stock

    func isWatching(_ variantId: String) -> Bool { watching[variantId] ?? false }

    func loadWatch(variantId: String) async {
        guard watching[variantId] == nil else { return }
        let escaped = variantId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? variantId
        if let w: ProductBackInStockWatch = try? await api.get("/api/wishlist/back-in-stock/\(escaped)") {
            watching[variantId] = w.watching
        }
    }

    /// Toggles the back-in-stock watch. Returns the new state.
    @discardableResult
    func toggleWatch(variantId: String) async throws -> Bool {
        watchBusy = true
        defer { watchBusy = false }
        let active = isWatching(variantId)
        let escaped = variantId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? variantId
        if active {
            try await api.send(.delete, "/api/wishlist/back-in-stock/\(escaped)")
        } else {
            try await api.send(.post, "/api/wishlist/back-in-stock", body: ProductBackInStockBody(variantId: variantId))
        }
        watching[variantId] = !active
        return !active
    }
}
