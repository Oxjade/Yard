import Foundation

// Studio in the app: the shapes from docs/APP.md › "Studio in the app" (server
// src/lib/api/contracts/studio-app.ts, orders.ts, src/server/catalog/dto.ts). Decoded leniently:
// one odd field never fails a screen. Money is integer minor units with an ISO currency code.

// MARK: - Session switch

/// POST /api/studio/session/switch body.
struct StudioSwitchBody: Encodable, Sendable {
    let brandId: String
}

/// `BrandProfile` (GET /api/session `brand`, and the switch answer `profile`).
struct StudioBrandProfile: Decodable, Hashable, Sendable {
    struct Brand: Decodable, Hashable, Sendable {
        let id: String
        let handle: String
        let name: String
        /// pending_review | verified | restricted | suspended.
        let reviewStatus: String
        let logoSrc: String?

        enum CodingKeys: String, CodingKey { case id, handle, name, reviewStatus, logoSrc }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            handle = c.lenient(.handle, "")
            name = c.lenient(.name, "")
            reviewStatus = c.lenient(.reviewStatus, "verified")
            logoSrc = c.lenientOptional(.logoSrc)
        }

        init(id: String, handle: String, name: String, reviewStatus: String, logoSrc: String?) {
            self.id = id
            self.handle = handle
            self.name = name
            self.reviewStatus = reviewStatus
            self.logoSrc = logoSrc
        }
    }

    let userId: String
    let name: String
    let brand: Brand
    let role: String
    let permissions: [String]

    init(userId: String, name: String, brand: Brand, role: String, permissions: [String]) {
        self.userId = userId
        self.name = name
        self.brand = brand
        self.role = role
        self.permissions = permissions
    }

    enum CodingKeys: String, CodingKey { case userId, name, brand, role, permissions }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = c.lenient(.userId, "")
        name = c.lenient(.name, "")
        brand = try c.decode(Brand.self, forKey: .brand)
        role = c.lenient(.role, "viewer")
        permissions = c.lenient(.permissions, [String]())
    }

    func can(_ permission: String) -> Bool { permissions.contains(permission) }
}

/// The switch answer: `{ actor: "brand", profile }`.
struct StudioSwitchResult: Decodable, Sendable {
    let actor: String
    let profile: StudioBrandProfile?

    init(actor: String = "brand", profile: StudioBrandProfile?) {
        self.actor = actor
        self.profile = profile
    }

    enum CodingKeys: String, CodingKey { case actor, profile }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actor = c.lenient(.actor, "brand")
        profile = c.lenientOptional(.profile)
    }
}

/// Permission names the app branches on.
enum StudioPermission {
    static let ordersFulfil = "orders.fulfil"
    static let contentPublish = "content.publish"
    static let inboxRead = "inbox.read"
    static let inboxReply = "inbox.reply"
}

// MARK: - Short application

struct StudioApplication: Decodable, Hashable, Sendable {
    struct Brand: Decodable, Hashable, Sendable {
        let id: String
        let handle: String
        let name: String
    }

    let id: String
    /// draft | submitted | approved | rejected.
    let status: String
    /// "app" (short application) | "studio" (the website's full one).
    let source: String
    let brand: Brand?
    let submittedAt: String?
    let reviewedAt: String?
    let reviewNote: String?

    var isWaiting: Bool { status == "submitted" }
    var isRejected: Bool { status == "rejected" }
    var isDraft: Bool { status == "draft" }

    enum CodingKeys: String, CodingKey { case id, status, source, brand, submittedAt, reviewedAt, reviewNote }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, "")
        status = c.lenient(.status, "submitted")
        source = c.lenient(.source, "app")
        brand = c.lenientOptional(.brand)
        submittedAt = c.lenientOptional(.submittedAt)
        reviewedAt = c.lenientOptional(.reviewedAt)
        reviewNote = c.lenientOptional(.reviewNote)
    }
}

/// GET /api/studio/apply → `{ application }`.
struct StudioApplicationEnvelope: Decodable, Sendable {
    let application: StudioApplication?

    enum CodingKeys: String, CodingKey { case application }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        application = c.lenientOptional(.application)
    }
}

/// POST /api/studio/apply body (strict on the server: nil fields are left out).
struct StudioApplyBody: Encodable, Equatable, Sendable {
    let brandName: String
    let instagram: String?
    let website: String?
    let category: String
    let city: String
    let country: String
    let about: String?
}

/// POST /api/studio/apply answer.
struct StudioApplyResult: Decodable, Sendable {
    struct WebsiteScan: Decodable, Sendable {
        let status: String
        let importId: String?
        let reason: String?
    }
    let application: StudioApplication
    let websiteScan: WebsiteScan?

    enum CodingKeys: String, CodingKey { case application, websiteScan }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        application = try c.decode(StudioApplication.self, forKey: .application)
        websiteScan = c.lenientOptional(.websiteScan)
    }
}

// MARK: - Dashboard

struct StudioSalesWindow: Decodable, Hashable, Sendable {
    let orders: Int
    let grossMinor: Int
    let refundedMinor: Int
    let netMinor: Int

    static let zero = StudioSalesWindow(orders: 0, grossMinor: 0, refundedMinor: 0, netMinor: 0)

    init(orders: Int, grossMinor: Int, refundedMinor: Int, netMinor: Int) {
        self.orders = orders
        self.grossMinor = grossMinor
        self.refundedMinor = refundedMinor
        self.netMinor = netMinor
    }

    enum CodingKeys: String, CodingKey { case orders, grossMinor, refundedMinor, netMinor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orders = c.lenient(.orders, 0)
        grossMinor = c.lenient(.grossMinor, 0)
        refundedMinor = c.lenient(.refundedMinor, 0)
        netMinor = c.lenient(.netMinor, 0)
    }
}

struct StudioSeriesPoint: Decodable, Hashable, Sendable, Identifiable {
    let date: String
    let orders: Int
    let grossMinor: Int
    let netMinor: Int

    var id: String { date }
    var day: Date? { YardDate.parse(date) }

    init(date: String, orders: Int, grossMinor: Int, netMinor: Int) {
        self.date = date
        self.orders = orders
        self.grossMinor = grossMinor
        self.netMinor = netMinor
    }

    enum CodingKeys: String, CodingKey { case date, orders, grossMinor, netMinor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.lenient(.date, "")
        orders = c.lenient(.orders, 0)
        grossMinor = c.lenient(.grossMinor, 0)
        netMinor = c.lenient(.netMinor, 0)
    }
}

struct StudioTopProduct: Decodable, Hashable, Sendable, Identifiable {
    let productId: String
    let title: String
    let currency: String
    let units: Int
    let revenueMinor: Int
    let imageSrc: String?

    var id: String { productId }

    private struct Image: Decodable { let src: String? }
    enum CodingKeys: String, CodingKey { case productId, title, currency, units, revenueMinor, image }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        productId = try c.decode(String.self, forKey: .productId)
        title = c.lenient(.title, "")
        currency = c.lenient(.currency, "")
        units = c.lenient(.units, 0)
        revenueMinor = c.lenient(.revenueMinor, 0)
        let image: Image? = c.lenientOptional(.image)
        imageSrc = image?.src
    }
}

/// GET /api/studio/dashboard?days=7|30.
struct StudioDashboard: Decodable, Sendable {
    struct Brand: Decodable, Sendable {
        let id: String
        let handle: String
        let name: String
        let currency: String
        let timeZone: String
    }
    struct Sales: Decodable, Sendable {
        let today: StudioSalesWindow
        let week: StudioSalesWindow
        let month: StudioSalesWindow

        enum CodingKeys: String, CodingKey { case today, week, month }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            today = c.lenient(.today, StudioSalesWindow.zero)
            week = c.lenient(.week, StudioSalesWindow.zero)
            month = c.lenient(.month, StudioSalesWindow.zero)
        }
    }
    struct Series: Decodable, Sendable {
        let days: Int
        let points: [StudioSeriesPoint]

        enum CodingKeys: String, CodingKey { case days, points }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            days = c.lenient(.days, 7)
            points = c.lenient(.points, LenientArray<StudioSeriesPoint>()).items
        }
    }
    struct ToShip: Decodable, Sendable {
        let total: Int
        let paid: Int
        let processing: Int
    }
    struct LowStock: Decodable, Sendable {
        let variants: Int
        let products: Int
        let threshold: Int
    }
    struct Views: Decodable, Sendable {
        let today: Int
        let week: Int
        let month: Int
    }

    let brand: Brand
    let sales: Sales
    let series: Series
    let toShip: ToShip
    let lowStock: LowStock
    /// Nil when the role can't read the inbox.
    let unreadMessages: Int?
    let websitePieces: Int
    let topProducts: [StudioTopProduct]
    let storeViews: Views

    enum CodingKeys: String, CodingKey { case brand, sales, series, toShip, lowStock, unreadMessages, websitePieces, topProducts, storeViews }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brand = try c.decode(Brand.self, forKey: .brand)
        sales = try c.decode(Sales.self, forKey: .sales)
        series = try c.decode(Series.self, forKey: .series)
        toShip = c.lenient(.toShip, ToShip(total: 0, paid: 0, processing: 0))
        lowStock = c.lenient(.lowStock, LowStock(variants: 0, products: 0, threshold: 0))
        unreadMessages = c.lenientOptional(.unreadMessages)
        websitePieces = c.lenient(.websitePieces, 0)
        topProducts = c.lenient(.topProducts, LenientArray<StudioTopProduct>()).items
        storeViews = c.lenient(.storeViews, Views(today: 0, week: 0, month: 0))
    }
}

// MARK: - Orders

struct StudioOrderPreviewItem: Decodable, Hashable, Sendable {
    let productId: String
    let variantId: String
    let name: String
    let qty: Int
    let unitMinor: Int
}

struct StudioOrderSummary: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let reference: String
    let customerName: String
    let shipCity: String?
    let shipCountry: String
    let placedAt: String
    let currency: String
    let subtotalMinor: Int
    let shippingMinor: Int
    let totalMinor: Int
    let refundedMinor: Int
    let itemCount: Int
    let previewItems: [StudioOrderPreviewItem]
    /// pending_payment | paid | processing | shipped | delivered | cancelled | refund_requested | refunded.
    let merchantState: String
    let paymentState: String
    let fulfilmentState: String
    let returnState: String

    var placedDate: Date? { YardDate.parse(placedAt) }
    var total: String { Formatters.price(minor: totalMinor, currency: currency) }

    private struct ShipToPreview: Decodable { let city: String?; let country: String? }
    private struct States: Decodable {
        let merchant: String?
        let payment: String?
        let fulfilment: String?
        let returnState: String?

        enum CodingKeys: String, CodingKey {
            case merchant, payment, fulfilment
            case returnState = "return"
        }
    }

    enum CodingKeys: String, CodingKey { case id, reference, customerName, shipToPreview, placedAt, currency, subtotalMinor, shippingMinor, totalMinor, refundedMinor, itemCount, previewItems, states }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        reference = c.lenient(.reference, "")
        customerName = c.lenient(.customerName, "")
        let ship: ShipToPreview? = c.lenientOptional(.shipToPreview)
        shipCity = ship?.city
        shipCountry = ship?.country ?? ""
        placedAt = c.lenient(.placedAt, "")
        currency = c.lenient(.currency, "")
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        shippingMinor = c.lenient(.shippingMinor, 0)
        totalMinor = c.lenient(.totalMinor, 0)
        refundedMinor = c.lenient(.refundedMinor, 0)
        itemCount = c.lenient(.itemCount, 0)
        previewItems = c.lenient(.previewItems, LenientArray<StudioOrderPreviewItem>()).items
        let states: States? = c.lenientOptional(.states)
        merchantState = states?.merchant ?? "paid"
        paymentState = states?.payment ?? ""
        fulfilmentState = states?.fulfilment ?? ""
        returnState = states?.returnState ?? ""
    }
}

struct StudioOrdersPage: Decodable, Sendable {
    let items: [StudioOrderSummary]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey { case items, nextCursor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lenient(.items, LenientArray<StudioOrderSummary>()).items
        nextCursor = c.lenientOptional(.nextCursor)
    }
}

struct StudioOrderLine: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let productId: String
    let title: String
    let qty: Int
    let unitMinor: Int
    /// The variant's option values ("M / Black"), or empty for a product without options.
    let variantLabel: String
    let imageSrc: String?

    private struct Image: Decodable { let src: String? }
    enum CodingKeys: String, CodingKey { case id, productId, title, qty, unitMinor, variantLabel, image }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        productId = c.lenient(.productId, "")
        title = c.lenient(.title, "")
        qty = c.lenient(.qty, 1)
        unitMinor = c.lenient(.unitMinor, 0)
        variantLabel = c.lenient(.variantLabel, "")
        let image: Image? = c.lenientOptional(.image)
        imageSrc = image?.src
    }
}

/// The delivery address (`shipTo`, a free-form object on the wire).
struct StudioAddress: Decodable, Hashable, Sendable {
    let name: String?
    let line1: String?
    let line2: String?
    let city: String?
    let region: String?
    let postcode: String?
    let country: String?
    let phone: String?

    /// Address lines without empties, for display.
    var lines: [String] {
        let cityLine = [city, region, postcode].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        return [line1, line2, cityLine, country].compactMap { $0 }.filter { !$0.isEmpty }
    }

    enum CodingKeys: String, CodingKey { case name, line1, line2, city, region, postcode, country, phone }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenientOptional(.name)
        line1 = c.lenientOptional(.line1)
        line2 = c.lenientOptional(.line2)
        city = c.lenientOptional(.city)
        region = c.lenientOptional(.region)
        postcode = c.lenientOptional(.postcode)
        country = c.lenientOptional(.country)
        phone = c.lenientOptional(.phone)
    }
}

struct StudioRefund: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let status: String
    let amountMinor: Int
    let currency: String
    let reason: String
    let createdAt: String
}

struct StudioTimelineEvent: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let kind: String
    let at: String
}

struct StudioOrderDetail: Decodable, Sendable {
    let summary: StudioOrderSummary
    let lines: [StudioOrderLine]
    let shipTo: StudioAddress?
    let paidAt: String?
    let cancelledAt: String?
    let cancelReason: String?
    let deliveredAt: String?
    let refundableMinor: Int
    let refunds: [StudioRefund]
    let timeline: [StudioTimelineEvent]
    let canCancel: Bool

    private struct Actions: Decodable { let canCancel: Bool? }
    enum CodingKeys: String, CodingKey { case lines, shipTo, paidAt, cancelledAt, cancelReason, deliveredAt, refundableMinor, refunds, timeline, actions }
    init(from decoder: Decoder) throws {
        summary = try StudioOrderSummary(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lines = c.lenient(.lines, LenientArray<StudioOrderLine>()).items
        shipTo = c.lenientOptional(.shipTo)
        paidAt = c.lenientOptional(.paidAt)
        cancelledAt = c.lenientOptional(.cancelledAt)
        cancelReason = c.lenientOptional(.cancelReason)
        deliveredAt = c.lenientOptional(.deliveredAt)
        refundableMinor = c.lenient(.refundableMinor, 0)
        refunds = c.lenient(.refunds, LenientArray<StudioRefund>()).items
        timeline = c.lenient(.timeline, LenientArray<StudioTimelineEvent>()).items
        let actions: Actions? = c.lenientOptional(.actions)
        canCancel = actions?.canCancel ?? false
    }
}

struct StudioOrderEnvelope: Decodable, Sendable {
    let order: StudioOrderDetail
}

/// POST …/shipment body.
struct StudioShipmentBody: Encodable, Sendable {
    let status: String
    let carrier: String?
    let trackingNumber: String?
}

/// POST …/cancel body.
struct StudioCancelBody: Encodable, Sendable {
    let reason: String
    let restock: Bool
    let idempotencyKey: String
}

/// POST …/refunds body.
struct StudioRefundBody: Encodable, Sendable {
    let amountMinor: Int
    let reason: String
    let idempotencyKey: String
}

// MARK: - Products

struct StudioImage: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let src: String
    let alt: String

    var url: URL? { Config.url(for: src) }

    enum CodingKeys: String, CodingKey { case id, src, alt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = c.lenient(.src, "")
        id = c.lenient(.id, src)
        alt = c.lenient(.alt, "")
    }
}

struct StudioVariant: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let sku: String
    /// The option values ("Size M, Black"); empty for a product without options.
    let label: String
    let available: Int
    let onHand: Int
    let held: Int
    let status: String

    init(id: String, sku: String, label: String, available: Int, onHand: Int, held: Int, status: String = "active") {
        self.id = id
        self.sku = sku
        self.label = label
        self.available = available
        self.onHand = onHand
        self.held = held
        self.status = status
    }

    enum CodingKeys: String, CodingKey { case id, sku, label, available, onHand, held, status }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sku = c.lenient(.sku, "")
        label = c.lenient(.label, "")
        onHand = c.lenient(.onHand, 0)
        held = c.lenient(.held, 0)
        available = c.lenient(.available, max(0, onHand - held))
        status = c.lenient(.status, "active")
    }

    func with(onHand: Int, held: Int, available: Int) -> StudioVariant {
        StudioVariant(id: id, sku: sku, label: label, available: available, onHand: onHand, held: held, status: status)
    }
}

struct StudioProduct: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let slug: String
    let title: String
    let priceMinor: Int
    let currency: String
    let images: [StudioImage]
    let variants: [StudioVariant]
    let available: Int
    /// draft | scheduled | published | archived.
    let status: String
    let moderationStatus: String?
    let moderationReason: String?
    let version: Int

    var isLive: Bool { status == "published" }
    var isDraft: Bool { status == "draft" }
    var price: String { Formatters.price(minor: priceMinor, currency: currency) }
    var imageURL: URL? { images.first?.url }

    init(id: String, slug: String, title: String, priceMinor: Int, currency: String, images: [StudioImage] = [], variants: [StudioVariant], available: Int, status: String, moderationStatus: String? = nil, moderationReason: String? = nil, version: Int) {
        self.id = id
        self.slug = slug
        self.title = title
        self.priceMinor = priceMinor
        self.currency = currency
        self.images = images
        self.variants = variants
        self.available = available
        self.status = status
        self.moderationStatus = moderationStatus
        self.moderationReason = moderationReason
        self.version = version
    }

    enum CodingKeys: String, CodingKey { case id, slug, title, priceMinor, currency, images, variants, available, status, moderationStatus, moderationReason, version }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = c.lenient(.slug, "")
        title = c.lenient(.title, "")
        priceMinor = c.lenient(.priceMinor, 0)
        currency = c.lenient(.currency, "")
        images = c.lenient(.images, LenientArray<StudioImage>()).items
        variants = c.lenient(.variants, LenientArray<StudioVariant>()).items
        available = c.lenient(.available, 0)
        status = c.lenient(.status, "draft")
        moderationStatus = c.lenientOptional(.moderationStatus)
        moderationReason = c.lenientOptional(.moderationReason)
        version = c.lenient(.version, 0)
    }

    /// The same product with one variant's stock replaced (after a +/- answer).
    func replacing(_ variant: StudioVariant) -> StudioProduct {
        let next = variants.map { $0.id == variant.id ? variant : $0 }
        let total = next.reduce(0) { $0 + max(0, $1.available) }
        return StudioProduct(id: id, slug: slug, title: title, priceMinor: priceMinor, currency: currency, images: images, variants: next, available: total, status: status, moderationStatus: moderationStatus, moderationReason: moderationReason, version: version)
    }
}

struct StudioProductsPage: Decodable, Sendable {
    let products: [StudioProduct]
    let total: Int
    let nextOffset: Int?

    enum CodingKeys: String, CodingKey { case products, total, nextOffset }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        products = c.lenient(.products, LenientArray<StudioProduct>()).items
        total = c.lenient(.total, products.count)
        nextOffset = c.lenientOptional(.nextOffset)
    }
}

struct StudioProductEnvelope: Decodable, Sendable {
    let product: StudioProduct
}

/// POST /api/studio/catalog/variants/{id}/stock answer.
struct StudioStockResult: Decodable, Sendable {
    let variantId: String
    let onHand: Int
    let held: Int
    let available: Int
}

struct StudioStockBody: Encodable, Sendable {
    let mode: String
    let qty: Int
    let reason: String?
}

struct StudioStatusBody: Encodable, Sendable {
    let action: String
    let expectedVersion: Int
}

/// POST /api/studio/catalog/products (Quick add).
struct StudioProductCreateBody: Encodable, Equatable, Sendable {
    struct OptionValue: Encodable, Equatable, Sendable { let value: String }
    struct Option: Encodable, Equatable, Sendable {
        let name: String
        let values: [OptionValue]
    }
    struct Variant: Encodable, Equatable, Sendable {
        let sku: String
        let options: [String: String]
        let initialStock: Int
    }
    struct Image: Encodable, Equatable, Sendable {
        let mediaId: String
        let alt: String
    }

    let title: String
    let description: String
    let categorySlug: String
    let priceMinor: Int
    let options: [Option]
    let variants: [Variant]
    let images: [Image]
    let badges: [String]
}

/// POST /api/uploads answer.
struct StudioUploadResult: Decodable, Sendable {
    struct Media: Decodable, Sendable {
        let id: String
        let src: String?
    }
    let media: Media
}

// MARK: - Website pieces

struct StudioSitePiece: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let sourceUrl: String?
    let images: [String]
    let priceMinor: Int?
    let currency: String
    let yardPriceMinor: Int?
    /// The option values the site lists (may be empty).
    let sizes: [String]
    let availability: String?
    let status: String
    let taken: Bool
    let error: String?

    var imageURL: URL? { images.first.flatMap { URL(string: $0) } }

    enum CodingKeys: String, CodingKey { case id, title, sourceUrl, images, priceMinor, currency, yardPriceMinor, sizes, availability, status, taken, error }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.lenient(.title, "")
        sourceUrl = c.lenientOptional(.sourceUrl)
        images = c.lenient(.images, [String]())
        priceMinor = c.lenientOptional(.priceMinor)
        currency = c.lenient(.currency, "")
        yardPriceMinor = c.lenientOptional(.yardPriceMinor)
        sizes = c.lenient(.sizes, [String]())
        availability = c.lenientOptional(.availability)
        status = c.lenient(.status, "")
        taken = c.lenient(.taken, false)
        error = c.lenientOptional(.error)
    }
}

struct StudioSitePieces: Decodable, Sendable {
    let items: [StudioSitePiece]
    let count: Int
    let mayAdd: Bool
    let site: String?
    let currency: String

    enum CodingKeys: String, CodingKey { case items, count, mayAdd, site, currency }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lenient(.items, LenientArray<StudioSitePiece>()).items
        count = c.lenient(.count, items.count)
        mayAdd = c.lenient(.mayAdd, false)
        site = c.lenientOptional(.site)
        currency = c.lenient(.currency, "")
    }
}

struct StudioSitePieceAction: Encodable, Sendable {
    let action: String
}

// MARK: - Payouts

struct StudioBalance: Decodable, Hashable, Sendable {
    let currency: String
    let pendingMinor: Int
    let availableMinor: Int
    let reserveMinor: Int
    let inPayoutMinor: Int

    enum CodingKeys: String, CodingKey { case currency, pendingMinor, availableMinor, reserveMinor, inPayoutMinor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        currency = c.lenient(.currency, "")
        pendingMinor = c.lenient(.pendingMinor, 0)
        availableMinor = c.lenient(.availableMinor, 0)
        reserveMinor = c.lenient(.reserveMinor, 0)
        inPayoutMinor = c.lenient(.inPayoutMinor, 0)
    }
}

struct StudioPayoutAccount: Decodable, Hashable, Sendable {
    let country: String?
    let currency: String?
    let bankName: String?
    let accountName: String?
    let accountLast4: String?
    let verified: Bool
    let cooldownUntil: String?

    enum CodingKeys: String, CodingKey { case country, currency, bankName, accountName, accountLast4, verified, cooldownUntil }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        country = c.lenientOptional(.country)
        currency = c.lenientOptional(.currency)
        bankName = c.lenientOptional(.bankName)
        accountName = c.lenientOptional(.accountName)
        accountLast4 = c.lenientOptional(.accountLast4)
        verified = c.lenient(.verified, false)
        cooldownUntil = c.lenientOptional(.cooldownUntil)
    }
}

struct StudioPayout: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let currency: String
    let amountMinor: Int
    let status: String
    let requestedAt: String?
    let paidAt: String?
    let lastError: String?
    let rejectReason: String?

    var amount: String { Formatters.price(minor: amountMinor, currency: currency) }

    enum CodingKeys: String, CodingKey { case id, currency, amountMinor, status, requestedAt, paidAt, lastError, rejectReason }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        currency = c.lenient(.currency, "")
        amountMinor = c.lenient(.amountMinor, 0)
        status = c.lenient(.status, "")
        requestedAt = c.lenientOptional(.requestedAt)
        paidAt = c.lenientOptional(.paidAt)
        lastError = c.lenientOptional(.lastError)
        rejectReason = c.lenientOptional(.rejectReason)
    }
}

struct StudioPayouts: Decodable, Sendable {
    struct Rules: Decodable, Sendable {
        let onHold: Bool
        let holdReason: String?
        let cooldownUntil: String?
        let minPayoutMinor: Int?

        enum CodingKeys: String, CodingKey { case onHold, holdReason, cooldownUntil, minPayoutMinor }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            onHold = c.lenient(.onHold, false)
            holdReason = c.lenientOptional(.holdReason)
            cooldownUntil = c.lenientOptional(.cooldownUntil)
            minPayoutMinor = c.lenientOptional(.minPayoutMinor)
        }
    }

    let currency: String
    let balances: [StudioBalance]
    let account: StudioPayoutAccount?
    let payouts: [StudioPayout]
    let rules: Rules?

    /// The balance in the brand's own currency (the first one otherwise).
    var balance: StudioBalance? { balances.first { $0.currency == currency } ?? balances.first }

    enum CodingKeys: String, CodingKey { case currency, balances, account, payouts, rules }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        currency = c.lenient(.currency, "")
        balances = c.lenient(.balances, LenientArray<StudioBalance>()).items
        account = c.lenientOptional(.account)
        payouts = c.lenient(.payouts, LenientArray<StudioPayout>()).items
        rules = c.lenientOptional(.rules)
    }
}

// MARK: - Inbox

/// A Studio conversation (`ConversationSummary` seen from the brand).
struct StudioConversation: Decodable, Hashable, Sendable, Identifiable {
    struct Customer: Decodable, Hashable, Sendable {
        let id: String?
        let name: String
        let photoSrc: String?
    }

    let id: String
    let kind: String
    let customer: Customer?
    let status: String
    let lastMessage: InboxLastMessage?
    let unread: Int
    let canSend: Bool
    let createdAt: String

    var title: String {
        if kind == "support" { return "Yard Support" }
        return customer?.name.isEmpty == false ? (customer?.name ?? "Customer") : "Customer"
    }

    enum CodingKeys: String, CodingKey { case id, kind, customer, status, lastMessage, unread, interaction, createdAt }
    private struct Interaction: Decodable { let canSend: Bool? }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = c.lenient(.kind, "brand")
        customer = c.lenientOptional(.customer)
        status = c.lenient(.status, "open")
        lastMessage = c.lenientOptional(.lastMessage)
        unread = c.lenient(.unread, 0)
        let interaction: Interaction? = c.lenientOptional(.interaction)
        canSend = interaction?.canSend ?? true
        createdAt = c.lenient(.createdAt, "")
    }
}

struct StudioConversationsPage: Decodable, Sendable {
    let items: [StudioConversation]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey { case items, nextCursor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lenient(.items, LenientArray<StudioConversation>()).items
        nextCursor = c.lenientOptional(.nextCursor)
    }
}

struct StudioThread: Decodable, Sendable {
    let conversation: StudioConversation?
    let messages: [InboxMessage]
    let hasMore: Bool

    enum CodingKeys: String, CodingKey { case conversation, messages, hasMore }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversation = c.lenientOptional(.conversation)
        messages = c.lenient(.messages, LenientArray<InboxMessage>()).items
        hasMore = c.lenient(.hasMore, false)
    }
}

struct StudioSendResult: Decodable, Sendable {
    let message: InboxMessage?

    enum CodingKeys: String, CodingKey { case message }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        message = c.lenientOptional(.message)
    }
}

/// POST /api/studio/inbox/messages body (text replies).
struct StudioReplyBody: Encodable, Sendable {
    let conversationId: String
    let clientId: String
    let kind: String
    let body: String
}

/// POST /api/studio/support/messages body.
struct StudioSupportBody: Encodable, Sendable {
    let clientId: String
    let kind: String
    let body: String
}

struct StudioReadBody: Encodable, Sendable {
    let upToSeq: Int
}

// MARK: - Notification settings

struct StudioPushPrefs: Codable, Equatable, Sendable {
    var orders: Bool
    var messages: Bool
    var lowStock: Bool
    var payouts: Bool

    static let allOn = StudioPushPrefs(orders: true, messages: true, lowStock: true, payouts: true)

    init(orders: Bool, messages: Bool, lowStock: Bool, payouts: Bool) {
        self.orders = orders
        self.messages = messages
        self.lowStock = lowStock
        self.payouts = payouts
    }

    enum CodingKeys: String, CodingKey { case orders, messages, lowStock, payouts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orders = c.lenient(.orders, true)
        messages = c.lenient(.messages, true)
        lowStock = c.lenient(.lowStock, true)
        payouts = c.lenient(.payouts, true)
    }
}

struct StudioPushPrefsEnvelope: Codable, Sendable {
    let push: StudioPushPrefs
}

struct StudioPushTestResult: Decodable, Sendable {
    let devices: Int
    let delivered: Bool

    enum CodingKeys: String, CodingKey { case devices, delivered }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        devices = c.lenient(.devices, 0)
        delivered = c.lenient(.delivered, false)
    }
}
