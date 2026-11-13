import Foundation
import Observation

// Data for BrandProfileView.
//
//   GET /api/catalog/storefronts/{handle}                    → PublicStorefront (+ brand.story)
//   GET /api/catalog/products?brand={brandId}&sort=new&limit=24&offset=  → ProductsPage
//   GET /api/drops?phase=all&brandId={brandId}&limit=50      → DropsPage
//   GET /api/follows/counts?brandIds={brandId}               → real follower count (via FollowStore)

enum BrandProfileTab: String, CaseIterable, Hashable, Sendable {
    case products
    case collections
    case drops

    var title: String {
        switch self {
        case .products: return "Products"
        case .collections: return "Collections"
        case .drops: return "Drops"
        }
    }
}

@Observable
@MainActor
final class BrandProfileModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case notFound(String)
        case failed(String)
    }

    static let productPageSize = 24
    static let dropsLimit = 50

    let handle: String

    private(set) var phase: Phase = .loading
    private(set) var storefront: PublicStorefront?
    /// The brand's story (brands.story), else the storefront intro.
    private(set) var story: String?

    private(set) var products: [Product] = []
    private(set) var productsTotal: Int?
    private(set) var productsNextOffset: Int?
    private(set) var productsLoading: Bool = false
    private(set) var productsLoadingMore: Bool = false
    private(set) var productsError: String?

    private(set) var drops: [Drop] = []
    private(set) var dropsHasMore: Bool = false
    private(set) var dropsLoading: Bool = false
    private(set) var dropsError: String?

    /// Real follower count from the API; nil until known (then the stat is omitted).
    private(set) var followers: Int?

    init(handle: String) {
        self.handle = handle
    }

    /// Preview-only initializer with already-loaded values.
    init(previewStorefront: PublicStorefront, story: String?, products: [Product], followers: Int?, drops: [Drop] = []) {
        self.handle = previewStorefront.brand.handle
        self.storefront = previewStorefront
        self.story = story
        self.products = products
        self.productsTotal = products.count
        self.followers = followers
        self.drops = drops
        self.phase = .loaded
    }

    var brand: StorefrontBrand? { storefront?.brand }
    var collections: [StorefrontCollection] { storefront?.collections ?? [] }

    /// The hero: the storefront cover, else the first product photo.
    var heroURL: URL? {
        if let url = storefront?.storefront?.config.coverURL { return url }
        for product in products {
            if let url = product.coverURL { return url }
        }
        return nil
    }

    /// Drops worth showing (drafts and cancelled ones are left out).
    var visibleDrops: [Drop] {
        drops.filter { $0.phase != "draft" && $0.phase != "cancelled" }
    }

    /// The drops count only when the list is complete (never a guess).
    var dropsCount: Int? {
        guard storefront != nil, !dropsLoading, dropsError == nil, !dropsHasMore else { return nil }
        return visibleDrops.count
    }

    // MARK: Loading

    func load(follows: FollowStore) async {
        if storefront == nil { phase = .loading }
        let escaped = handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle
        do {
            let data = try await APIClient.shared.data(.get, "/api/catalog/storefronts/\(escaped)")
            let decoder = JSONDecoder()
            let decoded: PublicStorefront
            do {
                decoded = try decoder.decode(PublicStorefront.self, from: data)
            } catch {
                throw APIError.decoding(error)
            }
            let extras = try? decoder.decode(BrandsStorefrontExtras.self, from: data)
            storefront = decoded
            let rawStory = extras?.brand?.story?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let intro = decoded.storefront?.config.intro.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            story = !rawStory.isEmpty ? rawStory : (!intro.isEmpty ? intro : nil)
            phase = .loaded
        } catch {
            if let apiError = error as? APIError {
                if apiError.isCancelled { return }
                if apiError.isNotFound {
                    phase = .notFound(apiError.message)
                    return
                }
            }
            if storefront == nil { phase = .failed(APIError.message(for: error)) }
            return
        }

        guard let brandId = storefront?.brand.id else { return }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadProducts(brandId: brandId) }
            group.addTask { await self.loadDrops(brandId: brandId) }
            group.addTask { await self.loadFollowers(brandId: brandId, follows: follows) }
        }
    }

    func loadProducts(brandId: String) async {
        productsLoading = true
        productsError = nil
        do {
            let page = try await APIClient.shared.get("/api/catalog/products", query: productQuery(brandId: brandId, offset: 0), as: ProductsPage.self)
            products = page.products
            productsTotal = page.total
            productsNextOffset = page.nextOffset
        } catch {
            if let apiError = error as? APIError, apiError.isCancelled {
                productsLoading = false
                return
            }
            productsError = APIError.message(for: error)
        }
        productsLoading = false
    }

    func loadMoreProducts() async {
        guard let brandId = brand?.id, let offset = productsNextOffset, !productsLoadingMore, !productsLoading else { return }
        productsLoadingMore = true
        do {
            let page = try await APIClient.shared.get("/api/catalog/products", query: productQuery(brandId: brandId, offset: offset), as: ProductsPage.self)
            let known = Set(products.map(\.id))
            products.append(contentsOf: page.products.filter { !known.contains($0.id) })
            productsTotal = page.total
            productsNextOffset = page.nextOffset
        } catch {
            // Keep what is shown; scrolling to the end again retries.
        }
        productsLoadingMore = false
    }

    func loadDrops(brandId: String) async {
        dropsLoading = true
        dropsError = nil
        do {
            let query: [URLQueryItem] = [
                URLQueryItem(name: "phase", value: "all"),
                URLQueryItem(name: "brandId", value: brandId),
                URLQueryItem(name: "limit", value: String(Self.dropsLimit)),
            ]
            let page = try await APIClient.shared.get("/api/drops", query: query, as: DropsPage.self)
            drops = page.items.filter { $0.brand.id.isEmpty || $0.brand.id == brandId }
            dropsHasMore = page.nextCursor != nil
        } catch {
            if let apiError = error as? APIError, apiError.isCancelled {
                dropsLoading = false
                return
            }
            dropsError = APIError.message(for: error)
        }
        dropsLoading = false
    }

    func loadFollowers(brandId: String, follows: FollowStore) async {
        if let cached = follows.followerCountCache[brandId] { followers = cached }
        if let counts = try? await follows.followerCounts(for: [brandId]), let n = counts[brandId] {
            followers = n
        }
    }

    /// After a follow/unfollow the server returns the new count.
    func apply(_ result: FollowResult) {
        followers = result.followers
    }

    private func productQuery(brandId: String, offset: Int) -> [URLQueryItem] {
        [
            URLQueryItem(name: "brand", value: brandId),
            URLQueryItem(name: "sort", value: "new"),
            URLQueryItem(name: "limit", value: String(Self.productPageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
    }
}
