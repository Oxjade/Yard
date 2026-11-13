import Foundation
import Observation

// Shop feature models and the small shared category cache. Shop-private (prefixed `Shop…`).

// MARK: - Categories

/// One marketplace category from GET /api/catalog/categories
/// (`src/server/catalog/public.ts` › `publicCategories`).
struct ShopCategory: Decodable, Hashable, Sendable, Identifiable {
    let slug: String
    let name: String
    let description: String
    /// Library photo path ("/media/…") or nil.
    let imagePath: String?
    let subcategories: [String]
    /// Public products in the category.
    let productCount: Int
    /// Distinct brands with public products in the category.
    let brandCount: Int

    var id: String { slug }
    var imageURL: URL? { Config.url(for: imagePath) }

    /// "12 pieces from 3 brands", or "Coming soon" for an empty shelf (the website never prints "0 pieces").
    var countText: String {
        if productCount == 0 { return "Coming soon" }
        let pieces = "\(Formatters.grouped(productCount)) \(productCount == 1 ? "piece" : "pieces")"
        guard brandCount > 0 else { return pieces }
        return "\(pieces) from \(Formatters.grouped(brandCount)) \(brandCount == 1 ? "brand" : "brands")"
    }

    init(slug: String, name: String, description: String = "", imagePath: String? = nil, subcategories: [String] = [], productCount: Int = 0, brandCount: Int = 0) {
        self.slug = slug
        self.name = name
        self.description = description
        self.imagePath = imagePath
        self.subcategories = subcategories
        self.productCount = productCount
        self.brandCount = brandCount
    }

    enum CodingKeys: String, CodingKey { case slug, name, description, imagePath, subcategories, productCount, brandCount }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = c.lenient(.name, slug.capitalized)
        description = c.lenient(.description, "")
        imagePath = c.lenientOptional(.imagePath)
        subcategories = c.lenient(.subcategories, [String]())
        productCount = c.lenient(.productCount, 0)
        brandCount = c.lenient(.brandCount, 0)
    }
}

struct ShopCategoriesResponse: Decodable, Sendable {
    let categories: [ShopCategory]

    enum CodingKeys: String, CodingKey { case categories }

    init(categories: [ShopCategory]) { self.categories = categories }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        categories = c.lenient(.categories, [ShopCategory]())
    }
}

/// Categories are read by both CategoriesView and ShopView (chips, banner). One short-lived
/// in-memory copy keeps the two screens from fetching the same list back to back
/// (the server caches it for 5 minutes too).
@MainActor
final class ShopCategoryCache {
    static let shared = ShopCategoryCache()

    private var cached: [ShopCategory]? = nil
    private var fetchedAt: Date? = nil
    private let ttl: TimeInterval = 300

    private init() {}

    /// The categories, from memory when fresh; `force` refetches.
    func categories(force: Bool = false) async throws -> [ShopCategory] {
        if !force, let cached, let fetchedAt, Date().timeIntervalSince(fetchedAt) < ttl {
            return cached
        }
        let response = try await APIClient.shared.get("/api/catalog/categories", as: ShopCategoriesResponse.self)
        cached = response.categories
        fetchedAt = Date()
        return response.categories
    }

    /// Whatever is in memory (no network), for an instant first paint.
    var current: [ShopCategory]? { cached }
}

// MARK: - Sort

/// Server-side sort for GET /api/catalog/products (`publicProductsQuery.sort`).
enum ShopSort: String, CaseIterable, Identifiable, Hashable, Sendable {
    case new
    case priceAsc = "price_asc"
    case priceDesc = "price_desc"

    var id: String { rawValue }

    /// Website wording (`catalog-state.ts` › `sortOptions`).
    var title: String {
        switch self {
        case .new: return "Newest"
        case .priceAsc: return "Price low–high"
        case .priceDesc: return "Price high–low"
        }
    }

    var systemImage: String {
        switch self {
        case .new: return "sparkles"
        case .priceAsc: return "arrow.up"
        case .priceDesc: return "arrow.down"
        }
    }
}

/// Client-side sort of a collection's pieces (`collection-view.tsx` › `sorts`).
enum ShopCollectionSort: String, CaseIterable, Identifiable, Hashable, Sendable {
    case featured
    case newest
    case priceAsc
    case priceDesc

    var id: String { rawValue }

    var title: String {
        switch self {
        case .featured: return "Featured"
        case .newest: return "Newest"
        case .priceAsc: return "Price, low to high"
        case .priceDesc: return "Price, high to low"
        }
    }

    /// `products` must be in the collection's own order (featured).
    func apply(to products: [Product]) -> [Product] {
        switch self {
        case .featured:
            return products
        case .newest:
            return products.sorted { (a: Product, b: Product) -> Bool in
                (a.publishedAt ?? a.createdAt) > (b.publishedAt ?? b.createdAt)
            }
        case .priceAsc:
            return products.sorted { (a: Product, b: Product) -> Bool in a.priceMinor < b.priceMinor }
        case .priceDesc:
            return products.sorted { (a: Product, b: Product) -> Bool in a.priceMinor > b.priceMinor }
        }
    }
}

// MARK: - Collection

/// GET /api/catalog/storefronts/{handle}/collections/{collection}
/// → `{ collection: {id, handle, name, description, imageSrc, imageMediaId, productIds}, brand: {id, handle, name} }`.
struct ShopCollectionResponse: Decodable, Sendable {
    struct Brand: Decodable, Hashable, Sendable {
        let id: String
        let handle: String
        let name: String

        enum CodingKeys: String, CodingKey { case id, handle, name }

        init(id: String, handle: String, name: String) {
            self.id = id
            self.handle = handle
            self.name = name
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            handle = c.lenient(.handle, id)
            name = c.lenient(.name, "")
        }
    }

    let collection: StorefrontCollection
    let brand: Brand
}

/// Shared piece-count wording ("1 piece", "12 pieces").
enum ShopText {
    static func pieces(_ n: Int) -> String {
        "\(Formatters.grouped(n)) \(n == 1 ? "piece" : "pieces")"
    }
}
