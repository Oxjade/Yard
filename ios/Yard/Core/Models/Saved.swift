import Foundation

// Follows and the wishlist (src/server/follows/index.ts). All need a signed-in shopper except counts.
//
//   GET    /api/follows                        → { items: [FollowedBrand] }
//   POST   /api/follows { brandId }            → FollowResult
//   DELETE /api/follows/{brandId}              → FollowResult
//   GET    /api/follows/counts?brandIds=a&brandIds=b → { counts: { brandId: Int } }   (public)
//   GET    /api/wishlist                       → { items: [WishlistItem] }
//   POST   /api/wishlist { productId }         → SaveResult
//   DELETE /api/wishlist/{productId}           → SaveResult
//
// Use `FollowStore` / `SavedStore`.

/// A brand the shopper follows.
struct FollowedBrand: Decodable, Hashable, Sendable, Identifiable {
    let brandId: String
    let followedAt: String
    let handle: String
    let name: String
    let city: String?
    let country: String?
    let verified: Bool
    /// Public follower count (baseline + real follows).
    let followers: Int

    var id: String { brandId }

    enum CodingKeys: String, CodingKey { case brandId, followedAt, handle, name, city, country, verified, followers }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brandId = try c.decode(String.self, forKey: .brandId)
        followedAt = c.lenient(.followedAt, "")
        handle = c.lenient(.handle, brandId)
        name = c.lenient(.name, "")
        city = c.lenientOptional(.city)
        country = c.lenientOptional(.country)
        verified = c.lenient(.verified, false)
        followers = c.lenient(.followers, 0)
    }
}

/// POST/DELETE /api/follows result.
struct FollowResult: Decodable, Hashable, Sendable {
    let brandId: String
    let following: Bool
    /// The brand's follower count after the change.
    let followers: Int
}

struct FollowsResponse: Decodable, Sendable {
    let items: [FollowedBrand]
}

struct FollowCountsResponse: Decodable, Sendable {
    let counts: [String: Int]
}

/// A saved (wishlisted) piece. No image comes with it: load the product by `slug` for one.
struct WishlistItem: Decodable, Hashable, Sendable, Identifiable {
    let productId: String
    let brandId: String
    let savedAt: String
    let title: String?
    let slug: String?
    let brandName: String?
    /// Units available, or nil when unknown.
    let available: Int?
    /// Lowest current price (`{ amount, currency }`).
    let price: Money?
    /// False when the product was unpublished or hidden since it was saved.
    let listed: Bool
    /// Variants with a pending back-in-stock watch.
    let backInStockVariantIds: [String]

    var id: String { productId }

    enum CodingKeys: String, CodingKey { case productId, brandId, savedAt, title, slug, brandName, available, price, listed, backInStockVariantIds }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        productId = try c.decode(String.self, forKey: .productId)
        brandId = c.lenient(.brandId, "")
        savedAt = c.lenient(.savedAt, "")
        title = c.lenientOptional(.title)
        slug = c.lenientOptional(.slug)
        brandName = c.lenientOptional(.brandName)
        available = c.lenientOptional(.available)
        price = c.lenientOptional(.price)
        listed = c.lenient(.listed, true)
        backInStockVariantIds = c.lenient(.backInStockVariantIds, [])
    }
}

struct WishlistResponse: Decodable, Sendable {
    let items: [WishlistItem]
}

/// POST/DELETE /api/wishlist result.
struct SaveResult: Decodable, Hashable, Sendable {
    let productId: String
    let saved: Bool
}

/// POST /api/follows body.
struct FollowBody: Encodable, Sendable {
    let brandId: String
}

/// POST /api/wishlist body.
struct WishlistBody: Encodable, Sendable {
    let productId: String
}
