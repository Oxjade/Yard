import Foundation

// The server cart (src/server/cart/index.ts CartView, src/server/cart/pricing.ts).
//
//   GET    /api/cart?currency=USD&to=NG&city=Lagos → Cart   (anonymous carts use the yard_cart cookie)
//   POST   /api/cart/lines { variantId, qty }      → 201 { ok }   (409 "Only 2 left." etc.)
//   PATCH  /api/cart/lines/{variantId} { qty }     → { ok }       (qty 0 removes)
//   DELETE /api/cart/lines/{variantId}             → 204
//   DELETE /api/cart                               → 204 (empties)
//
// Use `CartStore` rather than calling these directly.

struct Cart: Decodable, Sendable {
    let id: String?
    /// Display currency every `*Minor` amount here is in.
    let currency: String
    /// Units across available lines (the Bag badge).
    let itemCount: Int
    let subtotalMinor: Int
    let lines: [CartLine]
    /// Lines grouped per brand (each brand ships its own part), with shipping when `to` was given.
    let groups: [CartGroup]
    /// Plain sentences about lines needing attention ("Only 1 of Tee (Size M) left.").
    let issues: [String]
    let removedSample: Int
    let destination: Destination?

    struct Destination: Decodable, Hashable, Sendable {
        let country: String
        let city: String?
    }

    static func empty(currency: String) -> Cart {
        Cart(id: nil, currency: currency, itemCount: 0, subtotalMinor: 0, lines: [], groups: [], issues: [], removedSample: 0, destination: nil)
    }

    var subtotal: Money { Money(amount: subtotalMinor, currency: currency) }
    var isEmpty: Bool { lines.isEmpty }
    /// Lines of one brand group, in group order.
    func lines(in group: CartGroup) -> [CartLine] {
        group.variantIds.compactMap { id in lines.first { $0.variantId == id } }
    }

    init(id: String?, currency: String, itemCount: Int, subtotalMinor: Int, lines: [CartLine], groups: [CartGroup], issues: [String], removedSample: Int, destination: Destination?) {
        self.id = id
        self.currency = currency
        self.itemCount = itemCount
        self.subtotalMinor = subtotalMinor
        self.lines = lines
        self.groups = groups
        self.issues = issues
        self.removedSample = removedSample
        self.destination = destination
    }

    enum CodingKeys: String, CodingKey { case id, currency, itemCount, subtotalMinor, lines, groups, issues, removedSample, destination }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenientOptional(.id)
        currency = c.lenient(.currency, "USD")
        itemCount = c.lenient(.itemCount, 0)
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        lines = c.lenient(.lines, [])
        groups = c.lenient(.groups, [])
        issues = c.lenient(.issues, [])
        removedSample = c.lenient(.removedSample, 0)
        destination = c.lenientOptional(.destination)
    }
}

/// One cart line (one variant).
struct CartLine: Decodable, Hashable, Sendable, Identifiable {
    let variantId: String
    let productId: String?
    let brandId: String?
    let title: String?
    /// "Size M, Black".
    let variantLabel: String?
    /// Relative image path; use `imageURL`.
    let imagePath: String?
    let qty: Int
    let available: Int
    /// Catalogue price in the brand's currency.
    let unitPrice: Money?
    /// Unit price in the cart's display currency.
    let unitMinor: Int
    /// `unitMinor * qty`.
    let lineMinor: Int
    /// "ok" | "short" | "unavailable".
    let status: String
    /// "gone" | "sold_out" | "not_for_sale".
    let unavailableReason: String?
    let brandName: String?

    var id: String { variantId }
    var imageURL: URL? { Config.url(for: imagePath) }
    var isUnavailable: Bool { status == "unavailable" }
    var isShort: Bool { status == "short" }

    enum CodingKeys: String, CodingKey { case variantId, productId, brandId, title, variantLabel, imagePath, qty, available, unitPrice, unitMinor, lineMinor, status, unavailableReason, brandName }

    /// `unitPrice` arrives as `{ amountMinor, currency }`.
    private struct UnitPrice: Decodable {
        let amountMinor: Int
        let currency: String
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        variantId = try c.decode(String.self, forKey: .variantId)
        productId = c.lenientOptional(.productId)
        brandId = c.lenientOptional(.brandId)
        title = c.lenientOptional(.title)
        variantLabel = c.lenientOptional(.variantLabel)
        imagePath = c.lenientOptional(.imagePath)
        qty = c.lenient(.qty, 1)
        available = c.lenient(.available, 0)
        if let up = c.lenientOptional(.unitPrice, as: UnitPrice.self) {
            unitPrice = Money(amount: up.amountMinor, currency: up.currency)
        } else {
            unitPrice = nil
        }
        unitMinor = c.lenient(.unitMinor, 0)
        lineMinor = c.lenient(.lineMinor, 0)
        status = c.lenient(.status, "ok")
        unavailableReason = c.lenientOptional(.unavailableReason)
        brandName = c.lenientOptional(.brandName)
    }

    init(variantId: String, productId: String? = nil, brandId: String? = nil, title: String?, variantLabel: String? = nil, imagePath: String? = nil, qty: Int, available: Int, unitPrice: Money? = nil, unitMinor: Int, lineMinor: Int, status: String = "ok", unavailableReason: String? = nil, brandName: String? = nil) {
        self.variantId = variantId
        self.productId = productId
        self.brandId = brandId
        self.title = title
        self.variantLabel = variantLabel
        self.imagePath = imagePath
        self.qty = qty
        self.available = available
        self.unitPrice = unitPrice
        self.unitMinor = unitMinor
        self.lineMinor = lineMinor
        self.status = status
        self.unavailableReason = unavailableReason
        self.brandName = brandName
    }
}

/// A brand's part of the cart.
struct CartGroup: Decodable, Hashable, Sendable, Identifiable {
    let brandId: String
    let variantIds: [String]
    let subtotalMinor: Int
    /// Delivery options (only when the cart was read with `to=`).
    let shipping: ShippingQuote?

    var id: String { brandId }

    enum CodingKeys: String, CodingKey { case brandId, variantIds, subtotalMinor, shipping }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brandId = c.lenient(.brandId, "")
        variantIds = c.lenient(.variantIds, [])
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        shipping = c.lenientOptional(.shipping)
    }
}

/// Shipping quote for one brand group.
struct ShippingQuote: Decodable, Hashable, Sendable {
    let brandId: String
    let brandName: String
    let unavailable: Bool
    let reason: String?
    let options: [ShippingOption]
}

struct ShippingOption: Decodable, Hashable, Sendable, Identifiable {
    /// "standard" | "express" | "pickup".
    let service: String
    let label: String
    let available: Bool
    let reason: String?
    let priceMinor: Int
    let currency: String
    let free: Bool

    var id: String { service }
    var price: Money { Money(amount: priceMinor, currency: currency) }
}

/// POST /api/cart/lines body.
struct AddCartLineBody: Encodable, Sendable {
    let variantId: String
    let qty: Int
}

/// PATCH /api/cart/lines/{variantId} body.
struct SetCartLineBody: Encodable, Sendable {
    let qty: Int
}
