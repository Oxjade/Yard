import Foundation
import CoreGraphics

// Home-only models. Everything shared (Product, BrandCard, Drop) comes from Core/Models.

/// One marketplace category: GET /api/catalog/categories → `{ categories: [...] }`
/// (src/server/catalog/public.ts `publicCategories`).
struct HomeCategory: Decodable, Hashable, Sendable, Identifiable {
    let slug: String
    let name: String
    let productCount: Int

    var id: String { slug }

    enum CodingKeys: String, CodingKey { case slug, name, productCount }

    init(slug: String, name: String, productCount: Int = 0) {
        self.slug = slug
        self.name = name
        self.productCount = productCount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = c.lenient(.name, slug)
        productCount = c.lenient(.productCount, 0)
    }
}

struct HomeCategoriesResponse: Decodable, Sendable {
    let categories: [HomeCategory]
}

/// GET /api/inbox/unread → `{ conversations }` (shopper only).
struct HomeInboxUnread: Decodable, Sendable {
    let conversations: Int?
}

/// GET /api/notifications?as=shopper → `{ items: [{ id, read, … }] }`.
struct HomeNotificationsResponse: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        let id: String
        let read: Bool?
    }
    let items: [Item]
}

/// The tabs across the top of Home.
enum HomeTab: Hashable, Sendable, Identifiable {
    case forYou
    case following
    case category(HomeCategory)

    var id: String {
        switch self {
        case .forYou: return "for-you"
        case .following: return "following"
        case .category(let c): return "category-\(c.slug)"
        }
    }

    var title: String {
        switch self {
        case .forYou: return "For you"
        case .following: return "Following"
        case .category(let c): return c.name
        }
    }
}

/// One tile of the masonry feed.
enum HomeFeedItem: Identifiable, Sendable {
    case product(Product)
    case brand(BrandCard)
    case drop(Drop)

    var id: String {
        switch self {
        case .product(let p): return "p-\(p.id)"
        case .brand(let b): return "b-\(b.id)"
        case .drop(let d): return "d-\(d.id)"
        }
    }

    /// Estimated tile height ÷ width, including the caption, for MasonryGrid balancing
    /// (the grid's nominal column width is 180pt).
    var heightRatio: CGFloat {
        switch self {
        case .product(let p):
            return 1 / ProductTile.clampedAspect(p.tileAspectRatio) + ProductTile.captionHeight / 180
        case .brand(let b):
            return HomeShape.brandRatio(for: b.id)
        case .drop:
            return HomeShape.dropRatio + HomeShape.dropCaptionHeight / 180
        }
    }
}

/// Deterministic tile shapes (stable across launches; `hashValue` is not).
enum HomeShape {
    /// Product image aspects (w÷h) used when the API sends no image size: 4:5, 2:3, 3:4, 1:1, 3:4.
    static let productAspects: [Double] = [0.8, 0.6667, 0.75, 1.0, 0.75]
    static let dropRatio: CGFloat = 1.3
    static let dropCaptionHeight: CGFloat = 44

    static func stableHash(_ s: String) -> Int {
        var h: UInt64 = 5381
        for byte in s.utf8 {
            h = (h &* 33) &+ UInt64(byte)
        }
        return Int(h % 1_000_003)
    }

    /// Brand cover tiles: h÷w between 1.1 and 1.5.
    static func brandRatio(for id: String) -> CGFloat {
        let ratios: [CGFloat] = [1.15, 1.35, 1.5, 1.25]
        return ratios[stableHash(id) % ratios.count]
    }

    /// Products whose cover has no width/height get a stable per-id size so the masonry varies.
    /// (ProductTile reads `tileAspectRatio` from the first image, so we give that image a size.)
    static func shaped(_ p: Product) -> Product {
        guard let first = p.images.first, first.aspectRatio == nil else { return p }
        let aspect = productAspects[stableHash(p.id) % productAspects.count]
        let sized = ProductImage(id: first.id, src: first.src, alt: first.alt, width: Int(aspect * 1000), height: 1000, mediaId: first.mediaId)
        var images = p.images
        images[0] = sized
        return Product(
            id: p.id, slug: p.slug, brandId: p.brandId, title: p.title, description: p.description,
            details: p.details, category: p.category, subcategory: p.subcategory, tags: p.tags,
            badges: p.badges, priceMinor: p.priceMinor, compareAtMinor: p.compareAtMinor,
            currency: p.currency, images: images, options: p.options, variants: p.variants,
            available: p.available, processingDays: p.processingDays, dropId: p.dropId,
            collectionIds: p.collectionIds, publishedAt: p.publishedAt, createdAt: p.createdAt,
            brand: p.brand
        )
    }
}
