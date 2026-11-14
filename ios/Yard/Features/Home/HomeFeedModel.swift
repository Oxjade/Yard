import Foundation
import Observation

/// Loads and pages one Home tab's feed.
///
/// - For you: GET /api/catalog/products?sort=new&limit=24&offset= (paged by `nextOffset`), mixed
///   with brand tiles (GET /api/catalog/brands?sort=new&limit=24) and drop tiles
///   (GET /api/drops?phase=live&limit=8 and ?phase=upcoming&limit=8, as the site's Discover band),
///   plus the founding-brands row (GET /api/catalog/brands?founding=1&limit=8).
/// - Following: like the site's LiveFollowingFeed: the newest 6 pieces of each followed brand
///   (first 24 follows), newest first.
/// - Category: GET /api/catalog/products?category=<slug>&sort=new (paged).
@Observable
@MainActor
final class HomeFeedModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    let tab: HomeTab
    private(set) var phase: Phase = .idle
    private(set) var items: [HomeFeedItem] = []
    private(set) var founding: [BrandCard] = []
    private(set) var isLoadingMore: Bool = false
    private(set) var loadMoreFailed: Bool = false

    private var products: [Product] = []
    private var brands: [BrandCard] = []
    private var drops: [Drop] = []
    private var nextOffset: Int?
    /// Following tab: every piece, revealed a page at a time.
    private var followingPool: [Product] = []
    private var followingShown: Int = 0
    /// Follow ids the Following feed was built from (rebuild when they change).
    private(set) var builtForFollowIds: Set<String> = []

    /// Bumped by every refresh, so a next page fetched for the old feed is dropped.
    @ObservationIgnored private var generation: Int = 0

    private static let pageSize: Int = 24
    private static let perBrand: Int = 6
    private static let maxBrands: Int = 24

    init(tab: HomeTab) {
        self.tab = tab
    }

    var hasMore: Bool {
        switch tab {
        case .following: return followingShown < followingPool.count
        case .forYou, .category: return nextOffset != nil
        }
    }

    /// First load (no-op when already loaded).
    func loadIfNeeded(followIds: [String]) async {
        guard phase == .idle else { return }
        await refresh(followIds: followIds)
    }

    /// Reloads from scratch (pull to refresh, retry).
    func refresh(followIds: [String]) async {
        // Fence any in-flight loadMore(): its page belongs to the feed being replaced.
        generation += 1
        isLoadingMore = false
        if items.isEmpty { phase = .loading }
        loadMoreFailed = false
        do {
            switch tab {
            case .forYou:
                try await loadForYou()
            case .following:
                try await loadFollowing(followIds: followIds)
            case .category(let category):
                let page = try await fetchProducts(extra: [URLQueryItem(name: "category", value: category.slug)], offset: 0)
                products = page.products.map(HomeShape.shaped)
                nextOffset = page.nextOffset
            }
            rebuild()
            phase = .loaded
        } catch {
            if HomeFeedModel.isCancellation(error) {
                // Leave it loadable again (the view's task was cancelled, e.g. a tab switch).
                phase = items.isEmpty ? .idle : .loaded
                return
            }
            if items.isEmpty {
                phase = .failed(APIError.message(for: error))
            } else {
                phase = .loaded
            }
        }
    }

    /// Next page, triggered when the last tile appears.
    func loadMore() async {
        guard phase == .loaded, !isLoadingMore, hasMore else { return }
        if case .following = tab {
            followingShown = min(followingPool.count, followingShown + HomeFeedModel.pageSize)
            products = Array(followingPool.prefix(followingShown))
            rebuild()
            return
        }
        guard let offset = nextOffset else { return }
        let gen = generation
        isLoadingMore = true
        loadMoreFailed = false
        defer { if gen == generation { isLoadingMore = false } }
        var extra: [URLQueryItem] = []
        if case .category(let category) = tab {
            extra.append(URLQueryItem(name: "category", value: category.slug))
        }
        do {
            let page = try await fetchProducts(extra: extra, offset: offset)
            // A refresh started meanwhile rebuilt the feed: this page is stale.
            guard gen == generation else { return }
            let known = Set(products.map(\.id))
            products.append(contentsOf: page.products.filter { !known.contains($0.id) }.map(HomeShape.shaped))
            nextOffset = page.nextOffset
            rebuild()
        } catch {
            if HomeFeedModel.isCancellation(error) { return }
            guard gen == generation else { return }
            loadMoreFailed = true
        }
    }

    // MARK: - Loading

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let apiError = error as? APIError, apiError.isCancelled { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        return false
    }

    private func fetchProducts(extra: [URLQueryItem], offset: Int) async throws -> ProductsPage {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "sort", value: "new"),
            URLQueryItem(name: "limit", value: String(HomeFeedModel.pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        query.append(contentsOf: extra)
        return try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
    }

    private func loadForYou() async throws {
        async let productsTask: ProductsPage = APIClient.shared.get(
            "/api/catalog/products",
            query: [
                URLQueryItem(name: "sort", value: "new"),
                URLQueryItem(name: "limit", value: String(HomeFeedModel.pageSize)),
                URLQueryItem(name: "offset", value: "0"),
            ],
            as: ProductsPage.self
        )
        // The side modules never fail the feed: without them it is just products.
        async let brandsTask: BrandsPage? = try? await APIClient.shared.get(
            "/api/catalog/brands",
            query: [URLQueryItem(name: "sort", value: "new"), URLQueryItem(name: "limit", value: "24")],
            as: BrandsPage.self
        )
        async let foundingTask: BrandsPage? = try? await APIClient.shared.get(
            "/api/catalog/brands",
            query: [URLQueryItem(name: "founding", value: "1"), URLQueryItem(name: "limit", value: "8")],
            as: BrandsPage.self
        )
        async let liveTask: DropsPage? = try? await APIClient.shared.get(
            "/api/drops",
            query: [URLQueryItem(name: "phase", value: "live"), URLQueryItem(name: "limit", value: "8")],
            as: DropsPage.self
        )
        async let upcomingTask: DropsPage? = try? await APIClient.shared.get(
            "/api/drops",
            query: [URLQueryItem(name: "phase", value: "upcoming"), URLQueryItem(name: "limit", value: "8")],
            as: DropsPage.self
        )

        let page = try await productsTask
        let brandsPage = await brandsTask
        let foundingPage = await foundingTask
        let livePage = await liveTask
        let upcomingPage = await upcomingTask

        products = page.products.map(HomeShape.shaped)
        nextOffset = page.nextOffset
        founding = foundingPage?.brands ?? []
        // Founding brands already have their own row; don't repeat them as tiles.
        let foundingIds = Set(founding.map(\.id))
        brands = (brandsPage?.brands ?? []).filter { !foundingIds.contains($0.id) && $0.coverSrc != nil }
        var seen = Set<String>()
        drops = ((livePage?.items ?? []) + (upcomingPage?.items ?? [])).filter { drop in
            guard !drop.isEnded, !seen.contains(drop.id) else { return false }
            seen.insert(drop.id)
            return true
        }
    }

    private func loadFollowing(followIds: [String]) async throws {
        builtForFollowIds = Set(followIds)
        let ids = Array(followIds.prefix(HomeFeedModel.maxBrands))
        let limit: String = String(HomeFeedModel.perBrand)
        let pages: [[Product]] = await withTaskGroup(of: [Product].self) { group in
            for id in ids {
                group.addTask {
                    let query: [URLQueryItem] = [
                        URLQueryItem(name: "brand", value: id),
                        URLQueryItem(name: "sort", value: "new"),
                        URLQueryItem(name: "limit", value: limit),
                    ]
                    let page: ProductsPage? = try? await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
                    return page?.products ?? []
                }
            }
            var all: [[Product]] = []
            for await list in group { all.append(list) }
            return all
        }
        let merged = pages.flatMap { $0 }.sorted { a, b in
            (a.publishedAt ?? a.createdAt) > (b.publishedAt ?? b.createdAt)
        }
        followingPool = merged.map(HomeShape.shaped)
        followingShown = min(followingPool.count, HomeFeedModel.pageSize)
        products = Array(followingPool.prefix(followingShown))
        nextOffset = nil
        brands = []
        drops = []
    }

    // MARK: - Mixing

    /// Products in order, with a drop or brand tile after every 5th product (drops first,
    /// alternating). Prefix-stable, so appending a page never reshuffles the columns above.
    private func rebuild() {
        var out: [HomeFeedItem] = []
        out.reserveCapacity(products.count + brands.count + drops.count)
        var brandIndex = 0
        var dropIndex = 0
        var slot = 0
        for (i, product) in products.enumerated() {
            out.append(.product(product))
            guard (i + 1) % 5 == 0 else { continue }
            let preferDrop = slot % 2 == 0
            slot += 1
            if preferDrop, dropIndex < drops.count {
                out.append(.drop(drops[dropIndex]))
                dropIndex += 1
            } else if brandIndex < brands.count {
                out.append(.brand(brands[brandIndex]))
                brandIndex += 1
            } else if dropIndex < drops.count {
                out.append(.drop(drops[dropIndex]))
                dropIndex += 1
            }
        }
        // A short catalogue still shows its live drops.
        if products.count < 5, dropIndex < drops.count {
            for drop in drops[dropIndex...].prefix(2) { out.append(.drop(drop)) }
        }
        items = out
    }
}
