import Foundation

// Orders feature models. Shapes come from the website:
//   src/server/orders/contracts.ts (OrderSummaryDto, OrderDetailDto, OrdersPageDto)
//   src/lib/api/contracts/shipping.ts (DeliveryDto)
//   src/lib/api/contracts/checkout.ts (CheckoutStartResponse)
// Everything decodes leniently: one odd field never fails a whole screen.

// MARK: - Summary (GET /api/orders, GET /api/orders/checkouts/{id})

struct OrderBrandRef: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let handle: String

    init(id: String, name: String, handle: String) {
        self.id = id
        self.name = name
        self.handle = handle
    }

    enum CodingKeys: String, CodingKey { case id, name, handle }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, "")
        name = c.lenient(.name, "The brand")
        handle = c.lenient(.handle, "")
    }
}

struct OrderStates: Decodable, Hashable, Sendable {
    /// pending_payment, paid, processing, shipped, delivered, cancelled, refund_requested, refunded
    let merchant: String
    /// pending, paid, failed, partially_refunded, refunded
    let payment: String
    /// unfulfilled, processing, shipped, delivered, returned_to_sender, cancelled
    let fulfilment: String
    /// none, requested, approved, received, rejected, cancelled, expired
    let returnState: String
    let dispute: String

    init(merchant: String, payment: String, fulfilment: String, returnState: String = "none", dispute: String = "none") {
        self.merchant = merchant
        self.payment = payment
        self.fulfilment = fulfilment
        self.returnState = returnState
        self.dispute = dispute
    }

    enum CodingKeys: String, CodingKey {
        case merchant, payment, fulfilment, dispute
        case returnState = "return"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        merchant = c.lenient(.merchant, "pending_payment")
        payment = c.lenient(.payment, "pending")
        fulfilment = c.lenient(.fulfilment, "unfulfilled")
        returnState = c.lenient(.returnState, "none")
        dispute = c.lenient(.dispute, "none")
    }

    var status: OrderStatus { OrderStatus(raw: merchant) }
}

struct OrderPreviewItem: Decodable, Hashable, Sendable {
    let productId: String
    let variantId: String
    let name: String
    let qty: Int
    let unitMinor: Int

    init(productId: String, variantId: String, name: String, qty: Int, unitMinor: Int) {
        self.productId = productId
        self.variantId = variantId
        self.name = name
        self.qty = qty
        self.unitMinor = unitMinor
    }

    enum CodingKeys: String, CodingKey { case productId, variantId, name, qty, unitMinor }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        productId = c.lenient(.productId, "")
        variantId = c.lenient(.variantId, "")
        name = c.lenient(.name, "")
        qty = c.lenient(.qty, 1)
        unitMinor = c.lenient(.unitMinor, 0)
    }
}

struct OrderShipToPreview: Decodable, Hashable, Sendable {
    let city: String?
    let country: String

    init(city: String?, country: String) {
        self.city = city
        self.country = country
    }

    enum CodingKeys: String, CodingKey { case city, country }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        city = c.lenientOptional(.city, as: String.self)
        country = c.lenient(.country, "")
    }
}

/// One brand's order (one part of a checkout).
struct OrderSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let reference: String
    let groupReference: String
    let checkoutId: String?
    let brand: OrderBrandRef
    let shipToPreview: OrderShipToPreview
    let placedAt: String
    let currency: String
    let subtotalMinor: Int
    let shippingMinor: Int
    let totalMinor: Int
    let refundedMinor: Int
    let itemCount: Int
    let previewItems: [OrderPreviewItem]
    let states: OrderStates
    let service: String

    init(id: String, reference: String, groupReference: String, checkoutId: String?, brand: OrderBrandRef, shipToPreview: OrderShipToPreview, placedAt: String, currency: String, subtotalMinor: Int, shippingMinor: Int, totalMinor: Int, refundedMinor: Int = 0, itemCount: Int, previewItems: [OrderPreviewItem], states: OrderStates, service: String = "standard") {
        self.id = id
        self.reference = reference
        self.groupReference = groupReference
        self.checkoutId = checkoutId
        self.brand = brand
        self.shipToPreview = shipToPreview
        self.placedAt = placedAt
        self.currency = currency
        self.subtotalMinor = subtotalMinor
        self.shippingMinor = shippingMinor
        self.totalMinor = totalMinor
        self.refundedMinor = refundedMinor
        self.itemCount = itemCount
        self.previewItems = previewItems
        self.states = states
        self.service = service
    }

    enum CodingKeys: String, CodingKey {
        case id, reference, groupReference, checkoutId, brand, shipToPreview, placedAt, currency
        case subtotalMinor, shippingMinor, totalMinor, refundedMinor, itemCount, previewItems, states, service
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        reference = c.lenient(.reference, "")
        groupReference = c.lenient(.groupReference, "")
        checkoutId = c.lenientOptional(.checkoutId, as: String.self)
        brand = c.lenient(.brand, OrderBrandRef(id: "", name: "The brand", handle: ""))
        shipToPreview = c.lenient(.shipToPreview, OrderShipToPreview(city: nil, country: ""))
        placedAt = c.lenient(.placedAt, "")
        currency = c.lenient(.currency, "USD")
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        shippingMinor = c.lenient(.shippingMinor, 0)
        totalMinor = c.lenient(.totalMinor, 0)
        refundedMinor = c.lenient(.refundedMinor, 0)
        itemCount = c.lenient(.itemCount, 0)
        previewItems = c.lenient(.previewItems, [])
        states = c.lenient(.states, OrderStates(merchant: "pending_payment", payment: "pending", fulfilment: "unfulfilled"))
        service = c.lenient(.service, "standard")
    }

    var status: OrderStatus { states.status }
    var placedDate: Date? { YardDate.parse(placedAt) }
    var groupKey: String { checkoutId ?? groupReference }

    /// "Boxy tee and 2 more" (the website's wording), else "3 items".
    var itemsTitle: String {
        guard let first = previewItems.first else {
            return "\(itemCount) \(itemCount == 1 ? "item" : "items")"
        }
        let more = itemCount - first.qty
        return more > 0 ? "\(first.name) and \(more) more" : first.name
    }

    var itemsCountText: String { "\(itemCount) \(itemCount == 1 ? "item" : "items")" }
}

struct OrdersPage: Decodable, Sendable {
    let items: [OrderSummary]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey { case items, nextCursor }

    init(items: [OrderSummary], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Decode item by item so one bad row is skipped, not the page.
        let raw: [OrderLenientItem<OrderSummary>] = c.lenient(.items, [])
        items = raw.compactMap { $0.value }
        nextCursor = c.lenientOptional(.nextCursor, as: String.self)
    }
}

/// Wraps an element so a single malformed row decodes as nil instead of throwing.
struct OrderLenientItem<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

// MARK: - Detail (GET /api/orders/{id})

struct OrderLineImage: Decodable, Hashable, Sendable {
    let src: String
    let alt: String

    init(src: String, alt: String) {
        self.src = src
        self.alt = alt
    }

    enum CodingKeys: String, CodingKey { case src, alt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = c.lenient(.src, "")
        alt = c.lenient(.alt, "")
    }
}

struct OrderLine: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let variantId: String
    let productId: String
    let title: String
    let qty: Int
    let unitMinor: Int
    let returnedQty: Int
    let variantLabel: String
    let image: OrderLineImage?

    init(id: String, variantId: String, productId: String, title: String, qty: Int, unitMinor: Int, returnedQty: Int = 0, variantLabel: String, image: OrderLineImage?) {
        self.id = id
        self.variantId = variantId
        self.productId = productId
        self.title = title
        self.qty = qty
        self.unitMinor = unitMinor
        self.returnedQty = returnedQty
        self.variantLabel = variantLabel
        self.image = image
    }

    enum CodingKeys: String, CodingKey { case id, variantId, productId, title, qty, unitMinor, returnedQty, variantLabel, image }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        variantId = c.lenient(.variantId, "")
        productId = c.lenient(.productId, "")
        title = c.lenient(.title, "")
        qty = c.lenient(.qty, 1)
        unitMinor = c.lenient(.unitMinor, 0)
        returnedQty = c.lenient(.returnedQty, 0)
        variantLabel = c.lenient(.variantLabel, "")
        image = c.lenientOptional(.image, as: OrderLineImage.self)
    }

    var imageURL: URL? { Config.url(for: image?.src) }
    var returnableQty: Int { max(0, qty - returnedQty) }
}

/// The full delivery address (`shipTo` is a free-form object on the server).
struct OrderShipTo: Decodable, Hashable, Sendable {
    let name: String?
    let line1: String?
    let line2: String?
    let city: String?
    let region: String?
    let postcode: String?
    let country: String?
    let phone: String?

    init(name: String? = nil, line1: String? = nil, line2: String? = nil, city: String? = nil, region: String? = nil, postcode: String? = nil, country: String? = nil, phone: String? = nil) {
        self.name = name
        self.line1 = line1
        self.line2 = line2
        self.city = city
        self.region = region
        self.postcode = postcode
        self.country = country
        self.phone = phone
    }

    enum CodingKeys: String, CodingKey { case name, line1, line2, city, region, postcode, postalCode, country, phone }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenientOptional(.name, as: String.self)
        line1 = c.lenientOptional(.line1, as: String.self)
        line2 = c.lenientOptional(.line2, as: String.self)
        city = c.lenientOptional(.city, as: String.self)
        region = c.lenientOptional(.region, as: String.self)
        postcode = c.lenientOptional(.postalCode, as: String.self) ?? c.lenientOptional(.postcode, as: String.self)
        country = c.lenientOptional(.country, as: String.self)
        phone = c.lenientOptional(.phone, as: String.self)
    }

    /// Multi-line address as the website prints it.
    var formatted: String {
        let cityLine = [city, region, postcode].compactMap { OrderText.nonEmpty($0) }.joined(separator: ", ")
        let parts: [String?] = [name, line1, line2, cityLine, OrderText.countryName(country), phone]
        return parts.compactMap { OrderText.nonEmpty($0) }.joined(separator: "\n")
    }
}

struct OrderEventData: Decodable, Hashable, Sendable {
    let by: String?
    enum CodingKeys: String, CodingKey { case by }
    init(by: String? = nil) { self.by = by }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        by = c.lenientOptional(.by, as: String.self)
    }
}

struct OrderEvent: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: String
    let at: String
    let data: OrderEventData

    init(id: String, kind: String, at: String, data: OrderEventData = OrderEventData()) {
        self.id = id
        self.kind = kind
        self.at = at
        self.data = data
    }

    enum CodingKeys: String, CodingKey { case id, kind, at, data }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        kind = c.lenient(.kind, "")
        at = c.lenient(.at, "")
        data = c.lenient(.data, OrderEventData())
    }

    var date: Date? { YardDate.parse(at) }

    /// Shopper copy for the event (src/components/market/account/server-order-detail.tsx); nil = internal.
    var label: String? {
        switch kind {
        case "order.placed": return "Order placed"
        case "payment.captured": return "Payment confirmed"
        case "payment.failed": return "Payment didn’t go through"
        case "fulfilment.processing": return "Order being prepared"
        case "fulfilment.shipped": return "Order shipped"
        case "fulfilment.delivered": return "Order delivered"
        case "fulfilment.returned_to_sender": return "Returned to the brand"
        case "order.cancelled": return data.by == "shopper" ? "You cancelled this order" : "Order cancelled"
        case "return.requested": return "Return requested"
        case "return.cancelled": return "Return request withdrawn"
        case "return.approved": return "Return approved"
        case "return.rejected": return "Return declined"
        case "return.received": return "Return received by the brand"
        case "return.expired": return "Return request expired"
        case "refund.requested": return "Refund started"
        case "refund.succeeded": return "Refund issued"
        default: return nil
        }
    }
}

struct OrderReturnLine: Decodable, Hashable, Sendable {
    let variantId: String
    let title: String
    let qty: Int
    enum CodingKeys: String, CodingKey { case variantId, title, qty }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        variantId = c.lenient(.variantId, "")
        title = c.lenient(.title, "")
        qty = c.lenient(.qty, 0)
    }
}

struct OrderReturn: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    /// requested, approved, rejected, received, cancelled, expired
    let status: String
    let reasonLabel: String
    let lines: [OrderReturnLine]
    let requestedAt: String
    let decisionReason: String?

    enum CodingKeys: String, CodingKey { case id, status, reasonLabel, lines, requestedAt, decisionReason }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        status = c.lenient(.status, "requested")
        reasonLabel = c.lenient(.reasonLabel, "")
        lines = c.lenient(.lines, [])
        requestedAt = c.lenient(.requestedAt, "")
        decisionReason = c.lenientOptional(.decisionReason, as: String.self)
    }

    var isOpen: Bool { status == "requested" || status == "approved" }
    var itemCount: Int { lines.reduce(0) { $0 + $1.qty } }
}

struct OrderRefund: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let status: String
    let amountMinor: Int
    let currency: String
    let createdAt: String

    enum CodingKeys: String, CodingKey { case id, status, amountMinor, currency, createdAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        status = c.lenient(.status, "pending")
        amountMinor = c.lenient(.amountMinor, 0)
        currency = c.lenient(.currency, "USD")
        createdAt = c.lenient(.createdAt, "")
    }
}

struct OrderActions: Decodable, Hashable, Sendable {
    let canCancel: Bool
    let canRequestReturn: Bool
    let returnWindowEndsAt: String?

    init(canCancel: Bool = false, canRequestReturn: Bool = false, returnWindowEndsAt: String? = nil) {
        self.canCancel = canCancel
        self.canRequestReturn = canRequestReturn
        self.returnWindowEndsAt = returnWindowEndsAt
    }

    enum CodingKeys: String, CodingKey { case canCancel, canRequestReturn, returnWindowEndsAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canCancel = c.lenient(.canCancel, false)
        canRequestReturn = c.lenient(.canRequestReturn, false)
        returnWindowEndsAt = c.lenientOptional(.returnWindowEndsAt, as: String.self)
    }
}

struct OrderDetail: Decodable, Identifiable, Hashable, Sendable {
    let summary: OrderSummary
    let lines: [OrderLine]
    let shipTo: OrderShipTo?
    let paidAt: String?
    let cancelledAt: String?
    let cancelReason: String?
    let deliveredAt: String?
    let returns: [OrderReturn]
    let refunds: [OrderRefund]
    let timeline: [OrderEvent]
    let actions: OrderActions
    let delivery: OrderDelivery?

    var id: String { summary.id }

    init(summary: OrderSummary, lines: [OrderLine], shipTo: OrderShipTo?, paidAt: String?, cancelledAt: String? = nil, cancelReason: String? = nil, deliveredAt: String? = nil, returns: [OrderReturn] = [], refunds: [OrderRefund] = [], timeline: [OrderEvent], actions: OrderActions, delivery: OrderDelivery?) {
        self.summary = summary
        self.lines = lines
        self.shipTo = shipTo
        self.paidAt = paidAt
        self.cancelledAt = cancelledAt
        self.cancelReason = cancelReason
        self.deliveredAt = deliveredAt
        self.returns = returns
        self.refunds = refunds
        self.timeline = timeline
        self.actions = actions
        self.delivery = delivery
    }

    enum CodingKeys: String, CodingKey { case lines, shipTo, paidAt, cancelledAt, cancelReason, deliveredAt, returns, refunds, timeline, actions, delivery }

    init(from decoder: Decoder) throws {
        summary = try OrderSummary(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawLines: [OrderLenientItem<OrderLine>] = c.lenient(.lines, [])
        lines = rawLines.compactMap { $0.value }
        shipTo = c.lenientOptional(.shipTo, as: OrderShipTo.self)
        paidAt = c.lenientOptional(.paidAt, as: String.self)
        cancelledAt = c.lenientOptional(.cancelledAt, as: String.self)
        cancelReason = c.lenientOptional(.cancelReason, as: String.self)
        deliveredAt = c.lenientOptional(.deliveredAt, as: String.self)
        let rawReturns: [OrderLenientItem<OrderReturn>] = c.lenient(.returns, [])
        returns = rawReturns.compactMap { $0.value }
        let rawRefunds: [OrderLenientItem<OrderRefund>] = c.lenient(.refunds, [])
        refunds = rawRefunds.compactMap { $0.value }
        let rawTimeline: [OrderLenientItem<OrderEvent>] = c.lenient(.timeline, [])
        timeline = rawTimeline.compactMap { $0.value }
        actions = c.lenient(.actions, OrderActions())
        delivery = c.lenientOptional(.delivery, as: OrderDelivery.self)
    }

    var status: OrderStatus { summary.status }
    var openReturn: OrderReturn? { returns.first { $0.isOpen } }

    /// The first time an event of `kind` happened.
    func eventDate(_ kind: String) -> Date? {
        timeline.first { $0.kind == kind }?.date
    }

    /// The latest shipment event that carries a tracking number.
    var tracking: (number: String, carrier: String?)? {
        guard let events = delivery?.events else { return nil }
        for event in events.reversed() {
            if let number = OrderText.nonEmpty(event.trackingNumber) {
                return (number, OrderText.nonEmpty(event.carrier))
            }
        }
        return nil
    }
}

struct OrderDetailResponse: Decodable, Sendable {
    let order: OrderDetail
}

// MARK: - Delivery (DeliveryDto)

struct OrderEstimate: Decodable, Hashable, Sendable {
    let arrivalFrom: String?
    let arrivalTo: String?
    let deliveredOn: String?
    let shipBy: String?
    let late: Bool

    init(arrivalFrom: String? = nil, arrivalTo: String? = nil, deliveredOn: String? = nil, shipBy: String? = nil, late: Bool = false) {
        self.arrivalFrom = arrivalFrom
        self.arrivalTo = arrivalTo
        self.deliveredOn = deliveredOn
        self.shipBy = shipBy
        self.late = late
    }

    enum CodingKeys: String, CodingKey { case arrivalFrom, arrivalTo, deliveredOn, shipBy, late }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        arrivalFrom = c.lenientOptional(.arrivalFrom, as: String.self)
        arrivalTo = c.lenientOptional(.arrivalTo, as: String.self)
        deliveredOn = c.lenientOptional(.deliveredOn, as: String.self)
        shipBy = c.lenientOptional(.shipBy, as: String.self)
        late = c.lenient(.late, false)
    }
}

struct ShipmentEvent: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    /// label_created, shipped, in_transit, out_for_delivery, delivered, exception, returned
    let status: String
    let occurredAt: String
    let carrier: String?
    let trackingNumber: String?
    let locationText: String?
    let note: String?

    init(id: String, status: String, occurredAt: String, carrier: String? = nil, trackingNumber: String? = nil, locationText: String? = nil, note: String? = nil) {
        self.id = id
        self.status = status
        self.occurredAt = occurredAt
        self.carrier = carrier
        self.trackingNumber = trackingNumber
        self.locationText = locationText
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case id, status, occurredAt, carrier, trackingNumber, locationText, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, UUID().uuidString)
        status = c.lenient(.status, "")
        occurredAt = c.lenient(.occurredAt, "")
        carrier = c.lenientOptional(.carrier, as: String.self)
        trackingNumber = c.lenientOptional(.trackingNumber, as: String.self)
        locationText = c.lenientOptional(.locationText, as: String.self)
        note = c.lenientOptional(.note, as: String.self)
    }

    var date: Date? { YardDate.parse(occurredAt) }

    /// The website's words (src/components/market/delivery/order-delivery.tsx).
    var label: String {
        switch status {
        case "label_created": return "Label created"
        case "shipped": return "Shipped"
        case "in_transit": return "In transit"
        case "out_for_delivery": return "Out for delivery"
        case "delivered": return "Delivered"
        case "exception": return "Delayed"
        case "returned": return "Returned to the brand"
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct OrderDeliveryShipTo: Decodable, Hashable, Sendable {
    let country: String
    let city: String?

    init(country: String, city: String?) {
        self.country = country
        self.city = city
    }

    enum CodingKeys: String, CodingKey { case country, city }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        country = c.lenient(.country, "")
        city = c.lenientOptional(.city, as: String.self)
    }
}

struct OrderDelivery: Decodable, Hashable, Sendable {
    let service: String
    let shipTo: OrderDeliveryShipTo?
    let estimate: OrderEstimate?
    let shippedOn: String?
    let events: [ShipmentEvent]

    init(service: String = "standard", shipTo: OrderDeliveryShipTo?, estimate: OrderEstimate?, shippedOn: String?, events: [ShipmentEvent]) {
        self.service = service
        self.shipTo = shipTo
        self.estimate = estimate
        self.shippedOn = shippedOn
        self.events = events
    }

    enum CodingKeys: String, CodingKey { case service, shipTo, estimate, shippedOn, events }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        service = c.lenient(.service, "standard")
        shipTo = c.lenientOptional(.shipTo, as: OrderDeliveryShipTo.self)
        estimate = c.lenientOptional(.estimate, as: OrderEstimate.self)
        shippedOn = c.lenientOptional(.shippedOn, as: String.self)
        let raw: [OrderLenientItem<ShipmentEvent>] = c.lenient(.events, [])
        events = raw.compactMap { $0.value }
    }

    func lastEvent(_ status: String) -> ShipmentEvent? {
        events.last { $0.status == status }
    }

    func firstEvent(_ statuses: Set<String>) -> ShipmentEvent? {
        events.first { statuses.contains($0.status) }
    }
}

// MARK: - Checkout (GET /api/checkout/{id})

struct OrderCheckoutPayment: Decodable, Hashable, Sendable {
    let provider: String
    let status: String
    let authorizationUrl: String?
    let message: String?
    let channel: String?
    let providerStatus: String?

    enum CodingKeys: String, CodingKey { case provider, status, authorizationUrl, message, channel, providerStatus }

    init(provider: String = "stub", status: String = "pending", authorizationUrl: String? = nil, message: String? = nil, channel: String? = nil, providerStatus: String? = nil) {
        self.provider = provider
        self.status = status
        self.authorizationUrl = authorizationUrl
        self.message = message
        self.channel = channel
        self.providerStatus = providerStatus
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        provider = c.lenient(.provider, "")
        status = c.lenient(.status, "")
        authorizationUrl = c.lenientOptional(.authorizationUrl, as: String.self)
        message = c.lenientOptional(.message, as: String.self)
        channel = c.lenientOptional(.channel, as: String.self)
        providerStatus = c.lenientOptional(.providerStatus, as: String.self)
    }

    /// "Card", "Bank transfer", "USSD"… from the provider's channel.
    var methodLabel: String? {
        guard let channel = OrderText.nonEmpty(channel) else { return nil }
        switch channel {
        case "card": return "Card"
        case "bank_transfer", "bank": return "Bank transfer"
        case "ussd": return "USSD"
        case "mobile_money": return "Mobile money"
        case "apple_pay": return "Apple Pay"
        case "eft": return "Instant EFT"
        default: return channel.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct OrderCheckout: Decodable, Hashable, Sendable {
    let id: String
    /// pending_payment, paid, failed, expired, review
    let status: String
    let reference: String?
    let currency: String
    let subtotalMinor: Int
    let shippingMinor: Int
    let totalMinor: Int
    let orderIds: [String]
    let createdAt: String
    let paidAt: String?
    let failureReason: String?
    let payment: OrderCheckoutPayment?

    init(id: String, status: String, reference: String?, currency: String, subtotalMinor: Int, shippingMinor: Int, totalMinor: Int, orderIds: [String], createdAt: String, paidAt: String?, failureReason: String? = nil, payment: OrderCheckoutPayment?) {
        self.id = id
        self.status = status
        self.reference = reference
        self.currency = currency
        self.subtotalMinor = subtotalMinor
        self.shippingMinor = shippingMinor
        self.totalMinor = totalMinor
        self.orderIds = orderIds
        self.createdAt = createdAt
        self.paidAt = paidAt
        self.failureReason = failureReason
        self.payment = payment
    }

    enum CodingKeys: String, CodingKey { case id, status, reference, currency, subtotalMinor, shippingMinor, totalMinor, orderIds, createdAt, paidAt, failureReason, payment }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, "")
        status = c.lenient(.status, "pending_payment")
        reference = c.lenientOptional(.reference, as: String.self)
        currency = c.lenient(.currency, "USD")
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        shippingMinor = c.lenient(.shippingMinor, 0)
        totalMinor = c.lenient(.totalMinor, 0)
        orderIds = c.lenient(.orderIds, [])
        createdAt = c.lenient(.createdAt, "")
        paidAt = c.lenientOptional(.paidAt, as: String.self)
        failureReason = c.lenientOptional(.failureReason, as: String.self)
        payment = c.lenientOptional(.payment, as: OrderCheckoutPayment.self)
    }

    var isPending: Bool { status == "pending_payment" }
    var isPaid: Bool { status == "paid" }
    var isFailed: Bool { status == "failed" || status == "expired" || payment?.status == "failed" }
    var isAbandoned: Bool { isPending && payment?.providerStatus == "abandoned" }
}

// MARK: - Request bodies

struct OrderCancelBody: Encodable, Sendable {
    let reason: String
    let idempotencyKey: String
}

struct OrderReturnLineBody: Encodable, Sendable {
    let variantId: String
    let qty: Int
}

struct OrderReturnBody: Encodable, Sendable {
    let lines: [OrderReturnLineBody]
    let reason: String
    let note: String
    let idempotencyKey: String
}

/// Return reasons and their labels (src/server/orders/contracts.ts returnReasonLabels).
enum OrderReturnReason: String, CaseIterable, Identifiable, Sendable {
    case tooSmall = "too_small"
    case tooLarge = "too_large"
    case notAsDescribed = "not_as_described"
    case damaged = "damaged"
    case wrongItem = "wrong_item"
    case unwanted = "unwanted"
    case other = "other"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .tooSmall: return "Too small"
        case .tooLarge: return "Too large"
        case .notAsDescribed: return "Not as described"
        case .damaged: return "Arrived damaged or faulty"
        case .wrongItem: return "Wrong item sent"
        case .unwanted: return "Changed my mind"
        case .other: return "Something else"
        }
    }
}

// MARK: - Text helpers

enum OrderText {
    static func nonEmpty(_ s: String?) -> String? {
        guard let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }

    /// "NG" → "Nigeria" (falls back to the code).
    static func countryName(_ code: String?) -> String? {
        guard let code = nonEmpty(code) else { return nil }
        return Locale.current.localizedString(forRegionCode: code) ?? code
    }

    /// "Lagos, Nigeria" / "Nigeria" / nil.
    static func place(city: String?, country: String?) -> String? {
        let parts = [nonEmpty(city), countryName(country)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private static let utcDay: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("d MMM")
        return f
    }()

    private static let utcWeekdayDay: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return f
    }()

    /// A calendar day ("2026-11-16") as "16 Nov".
    static func day(_ ymd: String?) -> String? {
        guard let date = YardDate.parse(ymd) else { return nil }
        return utcDay.string(from: date)
    }

    /// A calendar day as "Mon 16 Nov".
    static func weekdayDay(_ ymd: String?) -> String? {
        guard let date = YardDate.parse(ymd) else { return nil }
        return utcWeekdayDay.string(from: date)
    }

    /// "11–16 Nov" / "30 Nov – 2 Dec" / "16 Nov".
    static func range(_ from: String?, _ to: String?) -> String? {
        guard let a = day(from) else { return day(to) }
        guard let b = day(to), from != to else { return a }
        if let f = from, let t = to, f.count >= 7, t.count >= 7, f.prefix(7) == t.prefix(7) {
            let fromDay = String(Int(f.suffix(2)) ?? 0)
            return "\(fromDay)–\(b)"
        }
        return "\(a) – \(b)"
    }

    /// "Placed 12 Nov 2026".
    static func longDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return f.string(from: date)
    }

    /// "Today at 21:44" / "Yesterday at 09:10" / "12 Nov at 18:00" (reference 07).
    static func stamp(_ date: Date) -> String {
        let cal = Calendar.current
        let time = Formatters.time(date)
        if cal.isDateInToday(date) { return "Today at \(time)" }
        if cal.isDateInYesterday(date) { return "Yesterday at \(time)" }
        return "\(Formatters.shortDate(date)) at \(time)"
    }

    static func serviceLabel(_ service: String) -> String {
        switch service {
        case "express": return "Express"
        case "pickup": return "Pickup"
        default: return "Standard"
        }
    }

    /// Carrier tracking page (src/components/market/account/order-status.tsx trackingUrl).
    static func trackingURL(number: String, carrier: String?) -> URL? {
        let n = number.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? number
        let c = (carrier ?? "").lowercased()
        if c.contains("dhl") { return URL(string: "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=\(n)") }
        if c.contains("ups") { return URL(string: "https://www.ups.com/track?tracknum=\(n)") }
        if c.contains("royal mail") { return URL(string: "https://www.royalmail.com/track-your-item#/tracking-results/\(n)") }
        return URL(string: "https://parcelsapp.com/en/tracking/\(n)")
    }

    static func idempotencyKey(_ prefix: String) -> String {
        "\(prefix)_\(UUID().uuidString)"
    }
}
