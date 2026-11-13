import Foundation

// Public brand cards: GET /api/catalog/brands (src/lib/api/public-brands.ts).
//
//   GET /api/catalog/brands?q=&category=&country=&founding=1|0&exclude=&sort=name|new&limit=&offset=
//       → BrandsPage { brands, total, nextOffset }

/// A listed brand, as the directory / "brands like this" / welcome flow show it.
struct BrandCard: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let handle: String
    let name: String
    let city: String
    let country: String
    /// Category slugs.
    let categories: [String]
    /// About 160 characters of the brand story, or nil.
    let story: String?
    let logoSrc: String?
    let coverSrc: String?
    let verified: Bool
    let founding: Bool
    let foundingBadge: Bool
    /// False while a founding brand isn't selling yet ("Opening soon").
    let forSale: Bool
    /// When the brand went public.
    let listedAt: String?

    var logoURL: URL? { Config.url(for: logoSrc) }
    var coverURL: URL? { Config.url(for: coverSrc) }
    /// "Lagos, NG".
    var locationText: String { [city, country].filter { !$0.isEmpty }.joined(separator: ", ") }
    /// Two letters for a brand without a logo.
    var monogram: String { BrandCard.monogram(for: name) }

    /// Same rule as the website's `brandMonogram`: first two letters/digits, uppercased, else "Y".
    static func monogram(for name: String) -> String {
        var two = ""
        for scalar in name.unicodeScalars where CharacterSet.alphanumerics.contains(scalar) {
            two.unicodeScalars.append(scalar)
            if two.unicodeScalars.count == 2 { break }
        }
        return two.isEmpty ? "Y" : two.uppercased()
    }

    init(id: String, handle: String, name: String, city: String = "", country: String = "", categories: [String] = [], story: String? = nil, logoSrc: String? = nil, coverSrc: String? = nil, verified: Bool = false, founding: Bool = false, foundingBadge: Bool = false, forSale: Bool = true, listedAt: String? = nil) {
        self.id = id
        self.handle = handle
        self.name = name
        self.city = city
        self.country = country
        self.categories = categories
        self.story = story
        self.logoSrc = logoSrc
        self.coverSrc = coverSrc
        self.verified = verified
        self.founding = founding
        self.foundingBadge = foundingBadge
        self.forSale = forSale
        self.listedAt = listedAt
    }
}

extension BrandCard {
    enum CodingKeys: String, CodingKey { case id, handle, name, city, country, categories, story, logoSrc, coverSrc, verified, founding, foundingBadge, forSale, listedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, id)
        name = c.lenient(.name, "")
        city = c.lenient(.city, "")
        country = c.lenient(.country, "")
        categories = c.lenient(.categories, [])
        story = c.lenientOptional(.story)
        logoSrc = c.lenientOptional(.logoSrc)
        coverSrc = c.lenientOptional(.coverSrc)
        verified = c.lenient(.verified, false)
        founding = c.lenient(.founding, false)
        foundingBadge = c.lenient(.foundingBadge, false)
        forSale = c.lenient(.forSale, true)
        listedAt = c.lenientOptional(.listedAt)
    }
}

/// GET /api/catalog/brands.
struct BrandsPage: Decodable, Sendable {
    let brands: [BrandCard]
    let total: Int
    let nextOffset: Int?
}
