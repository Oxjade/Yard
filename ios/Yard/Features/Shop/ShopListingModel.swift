import Foundation
import Observation

/// The shop listing (website: /shop and /categories/{slug}): GET /api/catalog/products with
/// category / subcategory / inStock / sort, paged with limit + offset (`publicProductsQuery`).
@Observable
@MainActor
final class ShopListingModel {
    enum Phase {
        case loading
        case loaded
        case failed(Error)
    }

    static let pageSize = 24

    /// The category the screen was opened on (`nil` = the whole shop). Its chip row is hidden.
    let fixedCategory: String?

    // Filters
    private(set) var category: String?
    private(set) var subcategory: String?
    private(set) var inStock: Bool = false
    private(set) var sort: ShopSort = .new

    // Data
    private(set) var categories: [ShopCategory] = []
    private(set) var products: [Product] = []
    private(set) var total: Int = 0
    private(set) var nextOffset: Int?
    private(set) var phase: Phase = .loading
    /// A filter change is loading while the previous results stay on screen (dimmed).
    private(set) var isRefreshing: Bool = false
    private(set) var isLoadingMore: Bool = false
    private(set) var loadMoreError: String?

    private var generation: Int = 0
    private var hasStarted: Bool = false
    private let fetches: Bool

    init(category: String?) {
        self.fixedCategory = category
        self.category = category
        self.fetches = true
        if let cached = ShopCategoryCache.shared.current { self.categories = cached }
    }

    /// Previews only: fixed products, no network.
    init(previewCategory: String?, categories: [ShopCategory], products: [Product]) {
        self.fixedCategory = previewCategory
        self.category = previewCategory
        self.categories = categories
        self.products = products
        self.total = products.count
        self.nextOffset = nil
        self.phase = .loaded
        self.fetches = false
        self.hasStarted = true
    }

    // MARK: Derived

    var isLoaded: Bool {
        if case .loaded = phase { return true }
        return false
    }

    var hasMore: Bool { nextOffset != nil }

    var selectedCategory: ShopCategory? {
        guard let category else { return nil }
        return categories.first { $0.slug == category }
    }

    /// Subcategories of the selected category (empty when none is selected).
    var subcategories: [String] { selectedCategory?.subcategories ?? [] }

    /// Name for titles: the category's name, or a readable slug until the list arrives.
    var categoryName: String? {
        guard let category else { return nil }
        return selectedCategory?.name ?? category.replacingOccurrences(of: "-", with: " ").capitalized
    }

    /// Filters a shopper set from the panel (website `panelCount`): only the stock toggle here.
    var panelFilterCount: Int { inStock ? 1 : 0 }

    // MARK: Loading

    /// First appearance: categories (for chips and the banner) and the first page.
    func start() async {
        guard fetches else { return }
        // A cancelled first load (screen left early) leaves `.loading`: start again on return.
        if hasStarted, isLoaded || isRefreshing { return }
        hasStarted = true
        async let cats: Void = loadCategories(force: false)
        async let page: Void = reload()
        _ = await (cats, page)
    }

    func refresh() async {
        guard fetches else { return }
        async let cats: Void = loadCategories(force: true)
        async let page: Void = reload()
        _ = await (cats, page)
    }

    private func loadCategories(force: Bool) async {
        // Non-fatal: without categories the listing still works, only the chips are missing.
        if let fresh = try? await ShopCategoryCache.shared.categories(force: force) {
            categories = fresh
        }
    }

    /// Reloads page one for the current filters. Results of an older request are dropped.
    func reload() async {
        guard fetches else { return }
        generation += 1
        let gen = generation
        loadMoreError = nil
        isLoadingMore = false
        if products.isEmpty {
            phase = .loading
        } else {
            isRefreshing = true
        }
        do {
            let page = try await fetch(offset: 0)
            guard gen == generation else { return }
            products = ShopListingModel.unique(page.products)
            total = page.total
            nextOffset = page.nextOffset
            phase = .loaded
            isRefreshing = false
        } catch {
            guard gen == generation else { return }
            isRefreshing = false
            if ShopListingModel.isCancellation(error) { return }
            products = []
            total = 0
            nextOffset = nil
            phase = .failed(error)
        }
    }

    /// Next page (infinite scroll). Safe to call repeatedly.
    func loadMore() async {
        guard fetches, isLoaded, !isRefreshing, !isLoadingMore, let offset = nextOffset else { return }
        let gen = generation
        isLoadingMore = true
        loadMoreError = nil
        do {
            let page = try await fetch(offset: offset)
            guard gen == generation else { return }
            let known = Set(products.map { $0.id })
            products.append(contentsOf: ShopListingModel.unique(page.products).filter { !known.contains($0.id) })
            total = page.total
            nextOffset = page.nextOffset
            isLoadingMore = false
        } catch {
            guard gen == generation else { return }
            isLoadingMore = false
            if ShopListingModel.isCancellation(error) { return }
            loadMoreError = APIError.message(for: error)
        }
    }

    private func fetch(offset: Int) async throws -> ProductsPage {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "sort", value: sort.rawValue),
            URLQueryItem(name: "limit", value: String(ShopListingModel.pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let category { query.append(URLQueryItem(name: "category", value: category)) }
        if let subcategory { query.append(URLQueryItem(name: "subcategory", value: subcategory)) }
        if inStock { query.append(URLQueryItem(name: "inStock", value: "1")) }
        return try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
    }

    // MARK: Filters (each reloads page one)

    func selectCategory(_ slug: String?) async {
        guard fixedCategory == nil, slug != category else { return }
        category = slug
        subcategory = nil
        await reload()
    }

    func selectSubcategory(_ sub: String?) async {
        guard sub != subcategory else { return }
        subcategory = sub
        await reload()
    }

    func setInStock(_ on: Bool) async {
        guard on != inStock else { return }
        inStock = on
        await reload()
    }

    func setSort(_ newSort: ShopSort) async {
        guard newSort != sort else { return }
        sort = newSort
        await reload()
    }

    /// "Clear filters": the stock toggle and the subcategory; the category and sort stay.
    func clearFilters() async {
        inStock = false
        subcategory = nil
        await reload()
    }

    // MARK: Helpers

    private static func unique(_ list: [Product]) -> [Product] {
        var seen = Set<String>()
        var out: [Product] = []
        out.reserveCapacity(list.count)
        for p in list where !seen.contains(p.id) {
            seen.insert(p.id)
            out.append(p)
        }
        return out
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let api = error as? APIError, api.isCancelled { return true }
        if let url = error as? URLError, url.code == .cancelled { return true }
        return false
    }
}
