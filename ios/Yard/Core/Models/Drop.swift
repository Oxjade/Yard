import Foundation

// Drops (src/server/drops/service.ts toDropDto / dropDetail).
//
//   GET    /api/drops?phase=upcoming|live|ended|all&brandId=&limit=&cursor=  → DropsPage { items, nextCursor }
//   GET    /api/drops/{id or slug}           → DropDetailResponse { drop, me }   (me only when signed in)
//   POST   /api/drops/{id}/reminder          → remind me (shopper)
//   DELETE /api/drops/{id}/reminder
//   POST   /api/drops/{id}/entry             → enter a draw (see src/app/api/drops/[id]/entry)
//   GET    /api/drops/me                     → the shopper's entries and reminders

struct Drop: Decodable, Hashable, Sendable, Identifiable {
    struct BrandRef: Decodable, Hashable, Sendable {
        let id: String
        let handle: String?
        let name: String?
    }

    let id: String
    let slug: String
    let brand: BrandRef
    let name: String
    let description: String
    /// A media id or a "/media/…" path; use `imageURL`.
    let image: String?
    /// "first_come" | "draw" | "early_access".
    let access: String
    let status: String
    /// "draft" | "scheduled" | "early_access" | "entries_open" | "live" | "ended" | "cancelled" | …
    let phase: String
    let startsAt: String
    let endsAt: String
    let earlyAccessAt: String?
    let entryOpensAt: String?
    let entryClosesAt: String?
    let drawnAt: String?
    let purchaseWindowMinutes: Int?
    /// Number of draw winners (draws only).
    let winners: Int?
    let limitPerCustomer: Int
    let totalUnits: Int
    let productIds: [String]
    /// Draw entries so far (draws only).
    let entries: Int?
    let sponsored: Bool
    /// Detail only.
    let variantIds: [String]?
    /// Detail only: live units left across the drop's variants (nil when unknown).
    let unitsAvailable: Int?

    var startDate: Date? { YardDate.parse(startsAt) }
    var endDate: Date? { YardDate.parse(endsAt) }
    var isLive: Bool { phase == "live" }
    var isEnded: Bool { phase == "ended" || phase == "cancelled" }
    var isUpcoming: Bool { !isLive && !isEnded }
    var isDraw: Bool { access == "draw" }

    /// Same rule as the website: "/media/…" paths stay, anything else is a media id.
    var imageURL: URL? {
        guard let image, !image.isEmpty else { return nil }
        if image.hasPrefix("/") || image.hasPrefix("http") { return Config.url(for: image) }
        return Config.url(for: Config.mediaPath(id: image))
    }

    /// "Draw" / "Early access" / "First come".
    var accessLabel: String {
        switch access {
        case "draw": return "Draw"
        case "early_access": return "Early access"
        default: return "First come"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, slug, brand, name, description, image, access, status, phase, startsAt, endsAt, earlyAccessAt, entryOpensAt, entryClosesAt, drawnAt, purchaseWindowMinutes, winners, limitPerCustomer, totalUnits, productIds, entries, sponsored, variantIds, unitsAvailable
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = c.lenient(.slug, id)
        brand = c.lenient(.brand, BrandRef(id: "", handle: nil, name: nil))
        name = c.lenient(.name, "")
        description = c.lenient(.description, "")
        image = c.lenientOptional(.image)
        access = c.lenient(.access, "first_come")
        status = c.lenient(.status, "scheduled")
        phase = c.lenient(.phase, "scheduled")
        startsAt = c.lenient(.startsAt, "")
        endsAt = c.lenient(.endsAt, "")
        earlyAccessAt = c.lenientOptional(.earlyAccessAt)
        entryOpensAt = c.lenientOptional(.entryOpensAt)
        entryClosesAt = c.lenientOptional(.entryClosesAt)
        drawnAt = c.lenientOptional(.drawnAt)
        purchaseWindowMinutes = c.lenientOptional(.purchaseWindowMinutes)
        winners = c.lenientOptional(.winners)
        limitPerCustomer = c.lenient(.limitPerCustomer, 1)
        totalUnits = c.lenient(.totalUnits, 0)
        productIds = c.lenient(.productIds, [])
        entries = c.lenientOptional(.entries)
        sponsored = c.lenient(.sponsored, false)
        variantIds = c.lenientOptional(.variantIds)
        unitsAvailable = c.lenientOptional(.unitsAvailable)
    }

    init(id: String, slug: String, brand: BrandRef, name: String, description: String = "", image: String? = nil, access: String = "first_come", status: String = "scheduled", phase: String = "scheduled", startsAt: String, endsAt: String, earlyAccessAt: String? = nil, entryOpensAt: String? = nil, entryClosesAt: String? = nil, drawnAt: String? = nil, purchaseWindowMinutes: Int? = nil, winners: Int? = nil, limitPerCustomer: Int = 1, totalUnits: Int = 0, productIds: [String] = [], entries: Int? = nil, sponsored: Bool = false, variantIds: [String]? = nil, unitsAvailable: Int? = nil) {
        self.id = id
        self.slug = slug
        self.brand = brand
        self.name = name
        self.description = description
        self.image = image
        self.access = access
        self.status = status
        self.phase = phase
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.earlyAccessAt = earlyAccessAt
        self.entryOpensAt = entryOpensAt
        self.entryClosesAt = entryClosesAt
        self.drawnAt = drawnAt
        self.purchaseWindowMinutes = purchaseWindowMinutes
        self.winners = winners
        self.limitPerCustomer = limitPerCustomer
        self.totalUnits = totalUnits
        self.productIds = productIds
        self.entries = entries
        self.sponsored = sponsored
        self.variantIds = variantIds
        self.unitsAvailable = unitsAvailable
    }
}

/// GET /api/drops.
struct DropsPage: Decodable, Sendable {
    let items: [Drop]
    /// Pass as `cursor` for the next page.
    let nextCursor: String?
}

/// GET /api/drops/{id}.
struct DropDetailResponse: Decodable, Sendable {
    let drop: Drop
    /// The signed-in shopper's state; nil when signed out.
    let me: DropViewerState?
}

/// The viewer's own state on a drop.
struct DropViewerState: Decodable, Hashable, Sendable {
    let reminder: Bool
    let following: Bool
    let earlyAccess: Bool
    let entry: DropEntry?
    let canBuy: Bool
    /// Why they can't buy (a sentence), or nil.
    let reason: String?
    let claimed: Int
    let remainingAllowance: Int

    enum CodingKeys: String, CodingKey { case reminder, following, earlyAccess, entry, canBuy, reason, claimed, remainingAllowance }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reminder = c.lenient(.reminder, false)
        following = c.lenient(.following, false)
        earlyAccess = c.lenient(.earlyAccess, false)
        entry = c.lenientOptional(.entry)
        canBuy = c.lenient(.canBuy, false)
        reason = c.lenientOptional(.reason)
        claimed = c.lenient(.claimed, 0)
        remainingAllowance = c.lenient(.remainingAllowance, 0)
    }
}

/// A draw entry.
struct DropEntry: Decodable, Hashable, Sendable {
    /// "entered" | "won" | "waitlisted" | "lost" | "purchased" | "expired" | "withdrawn" …
    let status: String
    let rank: Int?
    let windowOpensAt: String?
    let windowEndsAt: String?
    let enteredAt: String?
}
