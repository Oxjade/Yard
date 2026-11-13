import Foundation

// A brand's public storefront: GET /api/catalog/storefronts/{handle or brand id}
// (src/lib/api/storefront.ts `PublicStorefrontDto`). 404 "That brand isn't on Yard." when unlisted.
// Collection page: GET /api/catalog/storefronts/{handle}/collections/{collection}.
// Products of the brand: GET /api/catalog/products?brand={handle}.
// Follower count: `FollowStore.followerCounts(for:)` (GET /api/follows/counts) — never invent it.

/// GET /api/catalog/storefronts/{handle}.
struct PublicStorefront: Decodable, Sendable {
    let brand: StorefrontBrand
    /// The live storefront version, or nil when the brand hasn't published one.
    let storefront: StorefrontVersion?
    let collections: [StorefrontCollection]

    enum CodingKeys: String, CodingKey { case brand, storefront, collections }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brand = try c.decode(StorefrontBrand.self, forKey: .brand)
        storefront = c.lenientOptional(.storefront)
        collections = c.lenient(.collections, [])
    }

    init(brand: StorefrontBrand, storefront: StorefrontVersion?, collections: [StorefrontCollection]) {
        self.brand = brand
        self.storefront = storefront
        self.collections = collections
    }
}

struct StorefrontBrand: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let handle: String
    let name: String
    let city: String
    let citySlug: String
    let country: String
    let currency: String
    let categories: [String]
    let verified: Bool
    /// "pending_review" | "verified" | "restricted" | "suspended".
    let reviewStatus: String
    let joinedAt: String?
    /// The baseline added to real follows (the counts endpoint already includes it).
    let followersBase: Int
    let timeZone: String
    let foundingBadge: Bool
    let forSale: Bool
    let logoSrc: String?

    var logoURL: URL? { Config.url(for: logoSrc) }
    var locationText: String { [city, country].filter { !$0.isEmpty }.joined(separator: ", ") }
    var monogram: String { BrandCard.monogram(for: name) }

    init(id: String, handle: String, name: String, city: String = "", citySlug: String = "", country: String = "", currency: String = "USD", categories: [String] = [], verified: Bool = false, reviewStatus: String = "verified", joinedAt: String? = nil, followersBase: Int = 0, timeZone: String = "UTC", foundingBadge: Bool = false, forSale: Bool = true, logoSrc: String? = nil) {
        self.id = id
        self.handle = handle
        self.name = name
        self.city = city
        self.citySlug = citySlug
        self.country = country
        self.currency = currency
        self.categories = categories
        self.verified = verified
        self.reviewStatus = reviewStatus
        self.joinedAt = joinedAt
        self.followersBase = followersBase
        self.timeZone = timeZone
        self.foundingBadge = foundingBadge
        self.forSale = forSale
        self.logoSrc = logoSrc
    }
}

extension StorefrontBrand {
    enum CodingKeys: String, CodingKey { case id, handle, name, city, citySlug, country, currency, categories, verified, reviewStatus, joinedAt, followersBase, timeZone, foundingBadge, forSale, logoSrc }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, id)
        name = c.lenient(.name, "")
        city = c.lenient(.city, "")
        citySlug = c.lenient(.citySlug, "")
        country = c.lenient(.country, "")
        currency = c.lenient(.currency, "USD")
        categories = c.lenient(.categories, [])
        verified = c.lenient(.verified, false)
        reviewStatus = c.lenient(.reviewStatus, "verified")
        joinedAt = c.lenientOptional(.joinedAt)
        followersBase = c.lenient(.followersBase, 0)
        timeZone = c.lenient(.timeZone, "UTC")
        foundingBadge = c.lenient(.foundingBadge, false)
        forSale = c.lenient(.forSale, true)
        logoSrc = c.lenientOptional(.logoSrc)
    }
}

struct StorefrontVersion: Decodable, Hashable, Sendable {
    let version: Int
    let publishedAt: String
    let config: StorefrontConfig
}

/// The brand's storefront design. Enum-like fields are kept as strings so new values never fail decoding.
struct StorefrontConfig: Decodable, Hashable, Sendable {
    /// "editorial" | "minimal" | "street" | "studio".
    let template: String
    /// "violet" | "acid" | "ink" | "ember" | "aqua" | "rose".
    let accent: String
    /// "condensed" | "grotesk" | "expanded".
    let typePreset: String
    /// The intro/bio text.
    let intro: String
    let announcement: Announcement?
    let sections: [StorefrontSection]
    let coverMediaId: String?
    let coverAlt: String?
    let coverPath: String?
    let mark: BrandMark?
    let social: BrandSocial?

    struct Announcement: Decodable, Hashable, Sendable {
        let text: String
        /// A site path ("/drops/…"); map with `Route(url:)`.
        let href: String?
    }

    /// The hero/cover image: the uploaded cover media, else the cover path.
    var coverURL: URL? {
        if let id = coverMediaId, !id.isEmpty { return Config.url(for: Config.mediaPath(id: id)) }
        return Config.url(for: coverPath)
    }

    enum CodingKeys: String, CodingKey { case template, accent, typePreset, intro, announcement, sections, coverMediaId, coverAlt, coverPath, mark, social }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        template = c.lenient(.template, "editorial")
        accent = c.lenient(.accent, "ink")
        typePreset = c.lenient(.typePreset, "grotesk")
        intro = c.lenient(.intro, "")
        announcement = c.lenientOptional(.announcement)
        sections = c.lenient(.sections, [])
        coverMediaId = c.lenientOptional(.coverMediaId)
        coverAlt = c.lenientOptional(.coverAlt)
        coverPath = c.lenientOptional(.coverPath)
        mark = c.lenientOptional(.mark)
        social = c.lenientOptional(.social)
    }

    init(template: String = "editorial", accent: String = "ink", typePreset: String = "grotesk", intro: String = "", announcement: Announcement? = nil, sections: [StorefrontSection] = [], coverMediaId: String? = nil, coverAlt: String? = nil, coverPath: String? = nil, mark: BrandMark? = nil, social: BrandSocial? = nil) {
        self.template = template
        self.accent = accent
        self.typePreset = typePreset
        self.intro = intro
        self.announcement = announcement
        self.sections = sections
        self.coverMediaId = coverMediaId
        self.coverAlt = coverAlt
        self.coverPath = coverPath
        self.mark = mark
        self.social = social
    }
}

/// One storefront section. `type`: "hero" | "featured-products" | "collections" | "drops" |
/// "story" | "lookbook" | "all-products" | "social-feed".
struct StorefrontSection: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let type: String
    let enabled: Bool
    let title: String?
    let productIds: [String]?
    let collectionIds: [String]?
    let postIds: [String]?

    enum CodingKeys: String, CodingKey { case id, type, enabled, title, productIds, collectionIds, postIds }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        type = c.lenient(.type, "")
        enabled = c.lenient(.enabled, true)
        title = c.lenientOptional(.title)
        productIds = c.lenientOptional(.productIds)
        collectionIds = c.lenientOptional(.collectionIds)
        postIds = c.lenientOptional(.postIds)
    }
}

/// The brand's text mark (1–3 characters) when it has no logo image.
struct BrandMark: Decodable, Hashable, Sendable {
    let text: String
    /// "condensed" | "expanded" | "grotesk".
    let style: String?
}

/// Social handles/links.
struct BrandSocial: Decodable, Hashable, Sendable {
    let instagram: String?
    let tiktok: String?
    let x: String?
    let website: String?
}

/// A published collection of the brand.
struct StorefrontCollection: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let handle: String
    let name: String
    let description: String
    let imageSrc: String?
    let imageMediaId: String?
    let productIds: [String]

    var imageURL: URL? {
        if let src = imageSrc, !src.isEmpty { return Config.url(for: src) }
        if let id = imageMediaId, !id.isEmpty { return Config.url(for: Config.mediaPath(id: id)) }
        return nil
    }

    init(id: String, handle: String, name: String, description: String = "", imageSrc: String? = nil, imageMediaId: String? = nil, productIds: [String] = []) {
        self.id = id
        self.handle = handle
        self.name = name
        self.description = description
        self.imageSrc = imageSrc
        self.imageMediaId = imageMediaId
        self.productIds = productIds
    }
}

extension StorefrontCollection {
    enum CodingKeys: String, CodingKey { case id, handle, name, description, imageSrc, imageMediaId, productIds }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, id)
        name = c.lenient(.name, "")
        description = c.lenient(.description, "")
        imageSrc = c.lenientOptional(.imageSrc)
        imageMediaId = c.lenientOptional(.imageMediaId)
        productIds = c.lenient(.productIds, [])
    }
}
