import Foundation

// Models for the Search feature, mirroring the website's endpoints:
//   GET /api/search            (src/app/api/search/route.ts → src/server/search/index.ts `searchCatalog`)
//   GET /api/catalog/categories (src/app/api/catalog/categories/route.ts → `publicCategories`)
// Only the fields Search uses are modelled; anything the server may omit is optional.

/// GET /api/search?q=&category=&inStock=&sort=&currency=&limit=&cursor=
struct SearchResponse: Decodable, Sendable {
    let items: [SearchItem]
    let total: Int
    let nextCursor: String?
    let capped: Bool
    /// Brand matches for the words (first page only).
    let brands: [SearchBrandHit]
    let facets: SearchFacets?

    enum CodingKeys: String, CodingKey {
        case items, total, nextCursor, capped, brands, facets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decode([SearchItem].self, forKey: .items)) ?? []
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
        capped = (try? c.decode(Bool.self, forKey: .capped)) ?? false
        brands = (try? c.decode([SearchBrandHit].self, forKey: .brands)) ?? []
        facets = try? c.decodeIfPresent(SearchFacets.self, forKey: .facets)
    }
}

/// One product row of the search index (not a full `Product`: no variants or image sizes).
struct SearchItem: Decodable, Sendable, Identifiable, Hashable {
    let productId: String
    let brandId: String?
    let brandName: String?
    let slug: String?
    let title: String
    let image: String?
    let available: Int?
    /// The price in the shopper's currency (display only).
    let display: Money?
    /// The brand's own price.
    let price: Money?

    var id: String { productId }

    /// The display price if present, else the brand's price.
    var shownPrice: Money? { display ?? price }
}

/// A brand that matches the words.
struct SearchBrandHit: Decodable, Sendable, Identifiable, Hashable {
    let brandId: String
    let handle: String
    let name: String
    let city: String?
    let country: String?

    var id: String { brandId }

    var locationText: String? {
        let parts: [String] = [city, country].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

struct SearchFacets: Decodable, Sendable {
    let categories: [SearchCategoryFacet]
    let inStockCount: Int?

    enum CodingKeys: String, CodingKey {
        case categories, inStockCount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        categories = (try? c.decode([SearchCategoryFacet].self, forKey: .categories)) ?? []
        inStockCount = try? c.decodeIfPresent(Int.self, forKey: .inStockCount)
    }
}

/// A category the results fall into, with how many pieces.
struct SearchCategoryFacet: Decodable, Sendable, Identifiable, Hashable {
    let value: String
    let label: String
    let count: Int

    var id: String { value }
}

/// GET /api/catalog/categories → `{ categories: [...] }`.
struct SearchCategoriesResponse: Decodable, Sendable {
    let categories: [SearchCategory]
}

struct SearchCategory: Decodable, Sendable, Identifiable, Hashable {
    let slug: String
    let name: String
    let productCount: Int?

    var id: String { slug }
}

/// Sort options for the results page. The website's listing offers Trending / Newest / Price;
/// Relevance is the API default when there are words.
enum SearchSort: String, CaseIterable, Identifiable, Hashable, Sendable {
    case relevance
    case trending
    case newest
    case priceAsc
    case priceDesc

    var id: String { rawValue }

    var title: String {
        switch self {
        case .relevance: return "Best match"
        case .trending: return "Trending"
        case .newest: return "Newest"
        case .priceAsc: return "Price low–high"
        case .priceDesc: return "Price high–low"
        }
    }

    var systemImage: String {
        switch self {
        case .relevance: return "sparkle.magnifyingglass"
        case .trending: return "flame"
        case .newest: return "clock"
        case .priceAsc: return "arrow.up"
        case .priceDesc: return "arrow.down"
        }
    }

    /// The `sort` query value of /api/search.
    var apiValue: String {
        switch self {
        case .relevance: return "relevance"
        case .trending: return "trending"
        case .newest: return "newest"
        case .priceAsc: return "price_asc"
        case .priceDesc: return "price_desc"
        }
    }
}

/// Recent searches, kept on the device only (UserDefaults).
enum SearchRecents {
    static let storageKey = "yard.search.recents"
    static let limit = 8

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: storageKey) ?? []
    }

    /// Moves `term` to the front (case-insensitive dedupe) and returns the new list.
    @discardableResult
    static func record(_ term: String) -> [String] {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return load() }
        var list = load().filter { $0.lowercased() != trimmed.lowercased() }
        list.insert(trimmed, at: 0)
        if list.count > limit { list = Array(list.prefix(limit)) }
        UserDefaults.standard.set(list, forKey: storageKey)
        return list
    }

    @discardableResult
    static func remove(_ term: String) -> [String] {
        let list = load().filter { $0 != term }
        UserDefaults.standard.set(list, forKey: storageKey)
        return list
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}
