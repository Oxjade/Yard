import Foundation

// Public catalogue product, exactly as GET /api/catalog/products and
// GET /api/catalog/products/{slug} send it (src/server/catalog/dto.ts `toPublicProduct` plus the
// `brand` summary from src/server/catalog/public.ts `brandSummary`).
//
//   GET /api/catalog/products?brand=&category=&subcategory=&collection=&tag=&drop=&ids=&ids=&inStock=1
//                            &sort=new|price_asc|price_desc|title&limit=1…60&offset=
//       → ProductsPage { products, total, nextOffset }
//   GET /api/catalog/products/{slug or id} → ProductResponse { product }

/// One product image. `src` is relative (`/api/media/…`); use `url`.
struct ProductImage: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let src: String
    let alt: String
    let width: Int?
    let height: Int?
    let mediaId: String?

    /// Absolute URL for `src`.
    var url: URL? { Config.url(for: src) }

    /// width / height, or nil when unknown.
    var aspectRatio: Double? {
        guard let w = width, let h = height, w > 0, h > 0 else { return nil }
        return Double(w) / Double(h)
    }

    init(id: String, src: String, alt: String = "", width: Int? = nil, height: Int? = nil, mediaId: String? = nil) {
        self.id = id
        self.src = src
        self.alt = alt
        self.width = width
        self.height = height
        self.mediaId = mediaId
    }
}

extension ProductImage {
    enum CodingKeys: String, CodingKey { case id, src, alt, width, height, mediaId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = c.lenient(.src, "")
        id = c.lenient(.id, src)
        alt = c.lenient(.alt, "")
        width = c.lenientOptional(.width)
        height = c.lenientOptional(.height)
        mediaId = c.lenientOptional(.mediaId)
    }
}

/// An option axis, e.g. name "Size", values S/M/L; or "Colour" with hex swatches.
struct ProductOption: Codable, Hashable, Sendable {
    struct Value: Codable, Hashable, Sendable {
        let value: String
        let hex: String?
    }
    let name: String
    let values: [Value]
}

/// A purchasable variant. Add to bag with `variantId`.
struct ProductVariant: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let sku: String
    /// Option name → value, e.g. ["Size": "M", "Colour": "Black"].
    let options: [String: String]
    /// "Size M, Black".
    let label: String
    let priceMinor: Int
    let available: Int
    let inStock: Bool

    init(id: String, sku: String = "", options: [String: String] = [:], label: String = "", priceMinor: Int, available: Int, inStock: Bool) {
        self.id = id
        self.sku = sku
        self.options = options
        self.label = label
        self.priceMinor = priceMinor
        self.available = available
        self.inStock = inStock
    }
}

extension ProductVariant {
    enum CodingKeys: String, CodingKey { case id, sku, options, label, priceMinor, available, inStock }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sku = c.lenient(.sku, "")
        options = c.lenient(.options, [:])
        label = c.lenient(.label, "")
        priceMinor = c.lenient(.priceMinor, 0)
        available = c.lenient(.available, 0)
        inStock = c.lenient(.inStock, available > 0)
    }
}

/// The brand summary joined onto every public product.
struct BrandSummary: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let handle: String
    let name: String
    let verified: Bool
    let city: String?
    let country: String?
    let currency: String?
    /// The "Founding brand" badge.
    let foundingBadge: Bool
    /// False while a founding brand isn't selling yet: show "Notify me" instead of Add to bag.
    let forSale: Bool
    /// The brand has a published storefront (its name can link to the brand profile).
    let hasStorefront: Bool

    init(id: String, handle: String, name: String, verified: Bool = false, city: String? = nil, country: String? = nil, currency: String? = nil, foundingBadge: Bool = false, forSale: Bool = true, hasStorefront: Bool = true) {
        self.id = id
        self.handle = handle
        self.name = name
        self.verified = verified
        self.city = city
        self.country = country
        self.currency = currency
        self.foundingBadge = foundingBadge
        self.forSale = forSale
        self.hasStorefront = hasStorefront
    }
}

extension BrandSummary {
    enum CodingKeys: String, CodingKey { case id, handle, name, verified, city, country, currency, foundingBadge, forSale, hasStorefront }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, id)
        name = c.lenient(.name, "")
        verified = c.lenient(.verified, false)
        city = c.lenientOptional(.city)
        country = c.lenientOptional(.country)
        currency = c.lenientOptional(.currency)
        foundingBadge = c.lenient(.foundingBadge, false)
        forSale = c.lenient(.forSale, true)
        hasStorefront = c.lenient(.hasStorefront, true)
    }
}

/// A public product (PublicProductDto + brand).
struct Product: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let slug: String
    let brandId: String
    let title: String
    let description: String
    /// Bullet points ("100% cotton", …).
    let details: [String]
    /// Category slug, e.g. "tops".
    let category: String
    let subcategory: String?
    let tags: [String]
    /// Merchandising badges, e.g. "new", "limited".
    let badges: [String]
    /// Base price in minor units of `currency` (a variant may differ: use `variant.priceMinor`).
    let priceMinor: Int
    /// The "was" price, when on sale.
    let compareAtMinor: Int?
    let currency: String
    let images: [ProductImage]
    let options: [ProductOption]
    let variants: [ProductVariant]
    /// Units available across variants.
    let available: Int
    /// [min, max] processing days before dispatch, or nil.
    let processingDays: [Int]?
    let dropId: String?
    let collectionIds: [String]
    let publishedAt: String?
    let createdAt: String
    /// The brand summary (present on list and detail responses).
    let brand: BrandSummary?

    init(id: String, slug: String, brandId: String, title: String, description: String = "", details: [String] = [], category: String = "", subcategory: String? = nil, tags: [String] = [], badges: [String] = [], priceMinor: Int, compareAtMinor: Int? = nil, currency: String, images: [ProductImage] = [], options: [ProductOption] = [], variants: [ProductVariant] = [], available: Int = 0, processingDays: [Int]? = nil, dropId: String? = nil, collectionIds: [String] = [], publishedAt: String? = nil, createdAt: String = "", brand: BrandSummary? = nil) {
        self.id = id
        self.slug = slug
        self.brandId = brandId
        self.title = title
        self.description = description
        self.details = details
        self.category = category
        self.subcategory = subcategory
        self.tags = tags
        self.badges = badges
        self.priceMinor = priceMinor
        self.compareAtMinor = compareAtMinor
        self.currency = currency
        self.images = images
        self.options = options
        self.variants = variants
        self.available = available
        self.processingDays = processingDays
        self.dropId = dropId
        self.collectionIds = collectionIds
        self.publishedAt = publishedAt
        self.createdAt = createdAt
        self.brand = brand
    }

    // MARK: Conveniences

    /// The base price as `Money`.
    var price: Money { Money(amount: priceMinor, currency: currency) }
    /// The compare-at price as `Money`, only when it is above the price.
    var compareAt: Money? {
        guard let c = compareAtMinor, c > priceMinor else { return nil }
        return Money(amount: c, currency: currency)
    }
    /// The first image, if any.
    var coverImage: ProductImage? { images.first }
    /// Absolute URL of the first image.
    var coverURL: URL? { images.first?.url }
    /// Image aspect (w/h) for masonry tiles; 4:5 when the image size is unknown.
    var tileAspectRatio: Double { images.first?.aspectRatio ?? 0.8 }
    /// Nothing left to buy.
    var isSoldOut: Bool { available <= 0 }
    /// The brand isn't selling yet (founding brand before launch).
    var isNotForSale: Bool { brand?.forSale == false }
    /// Lowest and highest variant prices (minor units); nil when there are no variants.
    var variantPriceRange: ClosedRange<Int>? {
        let prices = variants.map(\.priceMinor)
        guard let lo = prices.min(), let hi = prices.max() else { return nil }
        return lo...hi
    }
    /// "Ships in 2–4 days" style text, or nil.
    var processingText: String? {
        guard let p = processingDays, p.count == 2 else { return nil }
        return p[0] == p[1] ? "Ships in \(p[0]) days" : "Ships in \(p[0])–\(p[1]) days"
    }
    /// Has the "new" badge (case-insensitive).
    var isNew: Bool { badges.contains { $0.lowercased() == "new" } }
}

extension Product {
    enum CodingKeys: String, CodingKey {
        case id, slug, brandId, title, description, details, category, subcategory, tags, badges, priceMinor, compareAtMinor, currency, images, options, variants, available, processingDays, dropId, collectionIds, publishedAt, createdAt, brand
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = c.lenient(.slug, id)
        brandId = c.lenient(.brandId, "")
        title = c.lenient(.title, "")
        description = c.lenient(.description, "")
        details = c.lenient(.details, [])
        category = c.lenient(.category, "")
        subcategory = c.lenientOptional(.subcategory)
        tags = c.lenient(.tags, [])
        badges = c.lenient(.badges, [])
        priceMinor = c.lenient(.priceMinor, 0)
        compareAtMinor = c.lenientOptional(.compareAtMinor)
        currency = c.lenient(.currency, "USD")
        images = c.lenient(.images, [])
        options = c.lenient(.options, [])
        variants = c.lenient(.variants, [])
        available = c.lenient(.available, 0)
        processingDays = c.lenientOptional(.processingDays)
        dropId = c.lenientOptional(.dropId)
        collectionIds = c.lenient(.collectionIds, [])
        publishedAt = c.lenientOptional(.publishedAt)
        createdAt = c.lenient(.createdAt, "")
        brand = c.lenientOptional(.brand)
    }
}

/// GET /api/catalog/products.
struct ProductsPage: Decodable, Sendable {
    let products: [Product]
    let total: Int
    /// Pass as `offset` for the next page; nil at the end.
    let nextOffset: Int?
}

/// GET /api/catalog/products/{slug}.
struct ProductResponse: Decodable, Sendable {
    let product: Product
}
