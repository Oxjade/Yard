import Foundation
import Observation

// Bag + checkout endpoints (website: src/app/api/cart, src/app/api/checkout, src/server/payments/checkout.ts).
//
//   GET  /api/cart?currency=&to=&city=     → the cart, with per-brand shipping quotes (+ arrival estimates)
//   GET  /api/checkout/options             → { mode: off|stub|test|live, provider, currencies }
//   POST /api/checkout                     → BagCheckout (201 new / 200 same idempotency key)
//   GET  /api/checkout/{id}                → BagCheckout
//   POST /api/checkout/{id}/verify         → BagCheckout (asks the provider; payment.providerStatus while pending)

// MARK: - Shipping quotes with estimates

/// The shared `ShippingOption` has no arrival estimate; these mirror the server's GroupQuote with it.
struct BagEstimate: Decodable, Hashable, Sendable {
    let arrivalFrom: String?
    let arrivalTo: String?

    var rangeText: String? { BagMarkets.arrivalRange(from: arrivalFrom, to: arrivalTo) }
}

struct BagQuoteOption: Decodable, Hashable, Sendable, Identifiable {
    /// "standard" | "express" | "pickup".
    let service: String
    let label: String
    let available: Bool
    let reason: String?
    let priceMinor: Int
    let currency: String
    let free: Bool
    let estimate: BagEstimate?

    var id: String { service }

    enum CodingKeys: String, CodingKey { case service, label, available, reason, priceMinor, currency, free, estimate }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        service = c.lenient(.service, "standard")
        label = c.lenient(.label, "Standard")
        available = c.lenient(.available, false)
        reason = c.lenientOptional(.reason)
        priceMinor = c.lenient(.priceMinor, 0)
        currency = c.lenient(.currency, "USD")
        free = c.lenient(.free, false)
        estimate = c.lenientOptional(.estimate)
    }

    init(service: String, label: String, available: Bool = true, reason: String? = nil, priceMinor: Int, currency: String, free: Bool = false, estimate: BagEstimate? = nil) {
        self.service = service
        self.label = label
        self.available = available
        self.reason = reason
        self.priceMinor = priceMinor
        self.currency = currency
        self.free = free
        self.estimate = estimate
    }

    /// "Est. arrival 11–16 Nov", "Est. ready 11 Nov" (pickup) or nil.
    var arrivalText: String? {
        if service == "pickup" {
            if let from = estimate?.arrivalFrom, let day = BagMarkets.arrivalRange(from: from, to: from) { return "Est. ready \(day)" }
            return "Ready once packed"
        }
        guard let range = estimate?.rangeText else { return nil }
        return "Est. arrival \(range)"
    }
}

struct BagGroupQuote: Decodable, Hashable, Sendable {
    let brandId: String
    let brandName: String
    let unavailable: Bool
    let reason: String?
    let options: [BagQuoteOption]

    enum CodingKeys: String, CodingKey { case brandId, brandName, unavailable, reason, options }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brandId = c.lenient(.brandId, "")
        brandName = c.lenient(.brandName, "")
        unavailable = c.lenient(.unavailable, false)
        reason = c.lenientOptional(.reason)
        options = c.lenient(.options, [])
    }

    init(brandId: String, brandName: String, unavailable: Bool = false, reason: String? = nil, options: [BagQuoteOption]) {
        self.brandId = brandId
        self.brandName = brandName
        self.unavailable = unavailable
        self.reason = reason
        self.options = options
    }

    /// The option for a chosen service when offered, else standard, else the first non-pickup one
    /// (the website's optionFor).
    func option(for service: String?) -> BagQuoteOption? {
        let available = options.filter { $0.available }
        if let service, let hit = available.first(where: { $0.service == service }) { return hit }
        return available.first { $0.service == "standard" } ?? available.first { $0.service != "pickup" }
    }
}

/// Only the per-brand quotes of GET /api/cart (decoded from the same body as `Cart`).
private struct BagQuoteEnvelope: Decodable {
    struct Group: Decodable {
        let brandId: String
        let shipping: BagGroupQuote?

        enum CodingKeys: String, CodingKey { case brandId, shipping }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            brandId = c.lenient(.brandId, "")
            shipping = c.lenientOptional(.shipping)
        }
    }
    let groups: [Group]

    enum CodingKeys: String, CodingKey { case groups }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groups = c.lenient(.groups, [])
    }
}

/// Reads the cart priced for a destination (and currency) with per-brand delivery quotes.
/// The bag uses it next to `CartStore` for estimates; the checkout uses it for everything it shows
/// (lines, subtotal and options in the currency it will charge).
@Observable
@MainActor
final class BagQuoteLoader {
    private(set) var cart: Cart?
    /// brandId → quote.
    private(set) var quotes: [String: BagGroupQuote] = [:]
    private(set) var isLoading: Bool = false
    private(set) var error: APIError?
    /// The query the current `cart`/`quotes` answer.
    private(set) var loadedKey: String?

    init() {}

    func quote(for brandId: String) -> BagGroupQuote? { quotes[brandId] }

    func load(currency: String, to country: String, city: String?) async {
        let key = "\(currency)|\(country)|\(city ?? "")"
        isLoading = true
        defer { isLoading = false }
        var query: [URLQueryItem] = [
            URLQueryItem(name: "currency", value: currency),
            URLQueryItem(name: "to", value: country),
        ]
        if let city, !city.isEmpty { query.append(URLQueryItem(name: "city", value: String(city.prefix(60)))) }
        do {
            let data = try await APIClient.shared.data(.get, "/api/cart", query: query)
            let payload = data.isEmpty ? Data("{}".utf8) : data
            let decoder = JSONDecoder()
            let decodedCart: Cart
            let envelope: BagQuoteEnvelope
            do {
                decodedCart = try decoder.decode(Cart.self, from: payload)
                envelope = try decoder.decode(BagQuoteEnvelope.self, from: payload)
            } catch {
                throw APIError.decoding(error)
            }
            var map: [String: BagGroupQuote] = [:]
            for g in envelope.groups {
                if let q = g.shipping { map[g.brandId] = q }
            }
            cart = decodedCart
            quotes = map
            loadedKey = key
            self.error = nil
        } catch let e as APIError {
            if !e.isCancelled { self.error = e }
        } catch {
            if !(error is CancellationError) { self.error = APIError.network(error) }
        }
    }

    /// Previews only.
    static func preview(cart: Cart?, quotes: [BagGroupQuote]) -> BagQuoteLoader {
        let l = BagQuoteLoader()
        l.cart = cart
        var map: [String: BagGroupQuote] = [:]
        for q in quotes { map[q.brandId] = q }
        l.quotes = map
        l.loadedKey = "preview"
        return l
    }
}

// MARK: - Checkout

/// GET /api/checkout/options.
struct BagCheckoutOptions: Decodable, Sendable {
    /// "off" | "stub" | "test" | "live".
    let mode: String
    /// "paystack" | "bachs" | "stub" | "off".
    let provider: String
    let currencies: [String]

    enum CodingKeys: String, CodingKey { case mode, provider, currencies }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = c.lenient(.mode, "live")
        provider = c.lenient(.provider, "paystack")
        currencies = c.lenient(.currencies, ["NGN"])
    }

    init(mode: String, provider: String, currencies: [String]) {
        self.mode = mode
        self.provider = provider
        self.currencies = currencies
    }

    /// The server's PAYMENTS_OFF_MESSAGE (src/server/payments/config.ts); POST /api/checkout answers
    /// 503 with the same words while payments are off.
    static let offMessage = "Payments open soon. Your cart is saved — you can place your order once payments open."
}

/// The server's CheckoutView (named apart from the `CheckoutView` screen).
struct BagCheckout: Decodable, Sendable {
    struct Payment: Decodable, Sendable {
        let id: String
        /// "paystack" | "bachs" | "stub".
        let provider: String
        let status: String
        let authorizationUrl: String?
        /// True for the stub: nothing is charged and the app must say so.
        let stub: Bool
        let message: String?
        /// Only on a verify answer while pending: "abandoned" = left the provider's page without paying.
        let providerStatus: String?

        enum CodingKeys: String, CodingKey { case id, provider, status, authorizationUrl, stub, message, providerStatus }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = c.lenient(.id, "")
            provider = c.lenient(.provider, "paystack")
            status = c.lenient(.status, "initialized")
            authorizationUrl = c.lenientOptional(.authorizationUrl)
            stub = c.lenient(.stub, false)
            message = c.lenientOptional(.message)
            providerStatus = c.lenientOptional(.providerStatus)
        }
    }

    let id: String
    /// "pending_payment" | "paid" | "failed" | "expired" | "review".
    let status: String
    let currency: String
    let subtotalMinor: Int
    let shippingMinor: Int
    let totalMinor: Int
    let orderIds: [String]
    let failureReason: String?
    let payment: Payment?

    enum CodingKeys: String, CodingKey { case id, status, currency, subtotalMinor, shippingMinor, totalMinor, orderIds, failureReason, payment }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = c.lenient(.status, "pending_payment")
        currency = c.lenient(.currency, "USD")
        subtotalMinor = c.lenient(.subtotalMinor, 0)
        shippingMinor = c.lenient(.shippingMinor, 0)
        totalMinor = c.lenient(.totalMinor, 0)
        orderIds = c.lenient(.orderIds, [])
        failureReason = c.lenientOptional(.failureReason)
        payment = c.lenientOptional(.payment)
    }

    var isPending: Bool { status == "pending_payment" }
    /// Paid, or paid and held for review: either way the orders exist and the confirmation explains.
    var isSettled: Bool { status == "paid" || status == "review" }
    var paymentURL: URL? {
        guard let raw = payment?.authorizationUrl, !raw.isEmpty else { return nil }
        return URL(string: raw)
    }
}

/// POST /api/checkout body (startCheckoutBody, strict: nil optionals are left out).
struct BagStartCheckoutBody: Encodable, Sendable {
    struct ShipTo: Encodable, Sendable {
        let name: String
        let line1: String
        let city: String
        let postalCode: String?
        let country: String
        let phone: String?
    }

    struct Choice: Encodable, Sendable {
        let brandId: String
        let service: String
    }

    var idempotencyKey: String
    let currency: String
    let shipTo: ShipTo
    let shipping: [Choice]
    var expectedTotalMinor: Int?
    var paymentMethod: String?
}
