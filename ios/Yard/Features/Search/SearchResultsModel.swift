import Foundation
import Observation

/// "See all results for …": the full search listing, like the website's shop listing with `q=`.
/// It pages /api/search (24 at a time), then loads the full products by id from
/// /api/catalog/products?ids=… so the grid can use `ProductTile` (the same two steps the
/// website's `CatalogListing` takes).
@Observable
@MainActor
final class SearchResultsModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    let query: String

    // Filters and sort (changing any reloads from the first page).
    var category: String? = nil
    var inStockOnly: Bool = false
    var sort: SearchSort = .relevance

    private(set) var phase: Phase = .loading
    private(set) var products: [Product] = []
    private(set) var brands: [SearchBrandHit] = []
    private(set) var categoryFacets: [SearchCategoryFacet] = []
    private(set) var inStockCount: Int? = nil
    private(set) var total: Int = 0
    private(set) var nextCursor: String? = nil
    private(set) var capped: Bool = false
    private(set) var isLoadingMore: Bool = false
    private(set) var loadMoreError: String? = nil

    /// Previews only: never touch the network.
    var skipsNetwork = false

    /// Bumped on every fresh load so a slow older response can't overwrite a newer one.
    private var generation = 0

    static let pageSize = 24

    init(query: String) {
        self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var hasFilters: Bool { category != nil || inStockOnly }

    /// Changes whenever a reload is needed; drive `.task(id:)` with it.
    func reloadKey(currency: String) -> String {
        "\(category ?? "-")|\(inStockOnly)|\(sort.rawValue)|\(currency)"
    }

    func clearFilters() {
        category = nil
        inStockOnly = false
    }

    /// Loads the first page with the current filters. `refreshing` (pull to refresh) keeps the
    /// loaded results on screen instead of swapping them for the skeleton, and keeps them if it fails.
    func load(currency: String, refreshing: Bool = false) async {
        guard !skipsNetwork else { return }
        generation += 1
        let current = generation
        let keepsContent: Bool = refreshing && phase == .loaded
        if !keepsContent { phase = .loading }
        loadMoreError = nil
        isLoadingMore = false
        do {
            let response = try await fetchPage(cursor: nil, currency: currency)
            let pageProducts = try await fetchProducts(ids: response.items.map { $0.productId })
            guard current == generation, !Task.isCancelled else { return }
            products = pageProducts
            brands = response.brands
            categoryFacets = response.facets?.categories ?? []
            inStockCount = response.facets?.inStockCount
            total = response.total
            nextCursor = response.nextCursor
            capped = response.capped
            phase = .loaded
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            if let apiError = error as? APIError, apiError.isCancelled { return }
            if keepsContent { return }
            phase = .failed(SearchLiveModel.message(for: error))
        }
    }

    /// Appends the next page, if there is one.
    func loadMore(currency: String) async {
        guard !skipsNetwork, phase == .loaded, !isLoadingMore, let cursor = nextCursor else { return }
        let current = generation
        isLoadingMore = true
        loadMoreError = nil
        defer { if current == generation { isLoadingMore = false } }
        do {
            let response = try await fetchPage(cursor: cursor, currency: currency)
            let pageProducts = try await fetchProducts(ids: response.items.map { $0.productId })
            guard current == generation else { return }
            let known = Set(products.map { $0.id })
            products.append(contentsOf: pageProducts.filter { !known.contains($0.id) })
            total = response.total
            nextCursor = response.nextCursor
            capped = response.capped
        } catch {
            guard current == generation else { return }
            if let apiError = error as? APIError, apiError.isCancelled { return }
            loadMoreError = SearchLiveModel.message(for: error)
        }
    }

    // MARK: - Requests

    private func fetchPage(cursor: String?, currency: String) async throws -> SearchResponse {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "currency", value: currency),
            URLQueryItem(name: "limit", value: String(Self.pageSize)),
            URLQueryItem(name: "sort", value: sort.apiValue),
        ]
        if !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if inStockOnly { items.append(URLQueryItem(name: "inStock", value: "1")) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await APIClient.shared.get("/api/search", query: items, as: SearchResponse.self)
    }

    /// Full products for the ids, in the search's order (pieces no longer public drop out).
    private func fetchProducts(ids: [String]) async throws -> [Product] {
        guard !ids.isEmpty else { return [] }
        var items: [URLQueryItem] = ids.map { URLQueryItem(name: "ids", value: $0) }
        items.append(URLQueryItem(name: "limit", value: String(min(max(ids.count, 1), 60))))
        let page = try await APIClient.shared.get("/api/catalog/products", query: items, as: ProductsPage.self)
        var byId: [String: Product] = [:]
        for product in page.products { byId[product.id] = product }
        return ids.compactMap { byId[$0] }
    }

    // MARK: - Previews

    static func preview(query: String, products: [Product], brands: [SearchBrandHit] = [], facets: [SearchCategoryFacet] = []) -> SearchResultsModel {
        let model = SearchResultsModel(query: query)
        model.skipsNetwork = true
        model.products = products
        model.brands = brands
        model.categoryFacets = facets
        model.inStockCount = products.count
        model.total = products.count
        model.phase = .loaded
        return model
    }
}
