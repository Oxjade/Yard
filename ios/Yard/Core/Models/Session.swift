import Foundation

// GET /api/session (src/lib/api/contracts/session.ts SessionDto). Who this device is signed in as.
// The app only acts as a shopper; `brand`/`admin` are decoded leniently for completeness.
// Sign out: POST /api/auth/sign-out?actor=shopper (SessionStore.signOut()).

struct Session: Decodable, Sendable {
    let shopper: Shopper?
    let brand: BrandMember?
    let sampleData: Bool

    static let signedOut = Session(shopper: nil, brand: nil, sampleData: false)

    init(shopper: Shopper?, brand: BrandMember?, sampleData: Bool) {
        self.shopper = shopper
        self.brand = brand
        self.sampleData = sampleData
    }

    enum CodingKeys: String, CodingKey { case shopper, brand, sampleData }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shopper = c.lenientOptional(.shopper)
        brand = c.lenientOptional(.brand)
        sampleData = c.lenient(.sampleData, false)
    }
}

/// The signed-in shopper.
struct Shopper: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let email: String
    /// "active" | "restricted" | "suspended".
    let status: String
    let demo: Bool
    /// The profile photo (`/api/media/…?as=shopper`, cookie-scoped), or nil for initials.
    /// A replaced photo gets a new media id, so a new URL: caches never show the old one.
    let photoSrc: String?
    /// Brands this account is an active member of (GET /api/session `shopper.brands`, oldest
    /// first; `[]` when none). Drives Studio mode (docs/APP.md › Studio in the app).
    let brands: [ShopperBrand]

    /// First name for greetings ("Hi, Ada").
    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
    /// Initials for an avatar.
    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map { String($0) }.joined()
        return letters.isEmpty ? "Y" : letters.uppercased()
    }

    init(id: String, name: String, email: String, status: String = "active", demo: Bool = false, photoSrc: String? = nil, brands: [ShopperBrand] = []) {
        self.id = id
        self.name = name
        self.email = email
        self.status = status
        self.demo = demo
        self.photoSrc = photoSrc
        self.brands = brands
    }

    /// Brands whose Studio can be opened (`canOpenStudio`), in the server's order.
    var studioBrands: [ShopperBrand] { brands.filter { $0.canOpenStudio } }
}

extension Shopper {
    enum CodingKeys: String, CodingKey { case id, name, email, status, demo, photoSrc, brands }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.lenient(.name, "")
        email = c.lenient(.email, "")
        status = c.lenient(.status, "active")
        demo = c.lenient(.demo, false)
        let photo: String? = c.lenientOptional(.photoSrc)
        photoSrc = (photo?.isEmpty ?? true) ? nil : photo
        brands = c.lenient(.brands, LenientArray<ShopperBrand>()).items
    }
}

/// One brand membership in `shopper.brands` (src/lib/api/contracts/studio-app.ts BrandMembershipDto).
struct ShopperBrand: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let handle: String
    let name: String
    /// A public logo (`/api/media/…`) or a private one (`…?as=brand`, loads once the brand
    /// session is open), or nil: draw `initials`.
    let logoSrc: String?
    let initials: String
    /// owner | admin | designer | fulfilment | finance | viewer.
    let role: String
    /// pending_review | approved | claimed | restricted | suspended.
    let status: String
    /// False for a suspended brand (the switch refuses it).
    let canOpenStudio: Bool

    init(id: String, handle: String, name: String, logoSrc: String? = nil, initials: String = "", role: String = "owner", status: String = "approved", canOpenStudio: Bool = true) {
        self.id = id
        self.handle = handle
        self.name = name
        self.logoSrc = logoSrc
        self.initials = initials.isEmpty ? YardArtwork.initials(name) : initials
        self.role = role
        self.status = status
        self.canOpenStudio = canOpenStudio
    }

    enum CodingKeys: String, CodingKey { case id, handle, name, logoSrc, initials, role, status, canOpenStudio }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, "")
        name = c.lenient(.name, "")
        let logo: String? = c.lenientOptional(.logoSrc)
        logoSrc = (logo?.isEmpty ?? true) ? nil : logo
        let ini: String = c.lenient(.initials, "")
        initials = ini.isEmpty ? YardArtwork.initials(name) : ini
        role = c.lenient(.role, "viewer")
        status = c.lenient(.status, "approved")
        let fallbackOpen = status != "suspended"
        canOpenStudio = c.lenient(.canOpenStudio, fallbackOpen)
    }

    /// The logo URL. A private (`as=brand`) logo only loads once the brand session is open.
    var logoURL: URL? { Config.url(for: logoSrc) }
    var isPrivateLogo: Bool { logoSrc?.contains("as=brand") ?? false }
    var isPending: Bool { status == "pending_review" }
    /// `claimed` is treated as approved.
    var isApproved: Bool { status == "approved" || status == "claimed" }
    var isRestricted: Bool { status == "restricted" }
    /// Payouts are visible to these roles only.
    var canSeePayouts: Bool { role == "owner" || role == "admin" || role == "finance" }

    /// Words for the status chip.
    var statusLabel: String {
        switch status {
        case "pending_review": return "In review"
        case "approved", "claimed": return "Live"
        case "restricted": return "Paused by Yard"
        case "suspended": return "Suspended"
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// Decodes an array, skipping elements that fail (one odd row never fails a whole list).
struct LenientArray<Element: Decodable>: Decodable {
    let items: [Element]

    init(_ items: [Element] = []) {
        self.items = items
    }

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !container.isAtEnd {
            if let value = try? container.decode(Element.self) {
                out.append(value)
            } else {
                _ = try? container.decode(Skip.self)
            }
        }
        items = out
    }
}

/// A brand membership on this device (the web Studio; the app just knows it exists).
struct BrandMember: Decodable, Hashable, Sendable {
    struct Brand: Decodable, Hashable, Sendable {
        let id: String
        let handle: String
        let name: String
    }
    let userId: String
    let name: String
    let brand: Brand
    let role: String
}
