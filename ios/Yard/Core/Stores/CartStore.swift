import Foundation
import Observation

/// The server cart. Injected at the root: `@Environment(CartStore.self) private var cart`.
///
/// Mutations throw `APIError` (show `error.message`, e.g. "Only 2 left.") and reload the cart
/// on success. `count` drives the Bag badge.
@Observable
@MainActor
final class CartStore {
    /// The last cart read; nil before the first load.
    private(set) var cart: Cart?
    private(set) var isLoading: Bool = false
    /// Last load error (mutations throw instead).
    private(set) var lastError: APIError?
    /// Variant ids with a mutation in flight (disable their steppers).
    private(set) var busyVariantIds: Set<String> = []

    /// Display currency for GET /api/cart (ISO code). Persisted; change with `setCurrency(_:)`.
    private(set) var currency: String
    /// Optional destination for shipping quotes (`to=` country code, `city=`). Set by checkout.
    var destinationCountry: String?
    var destinationCity: String?

    static let currencyKey = "yard.currency"
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
        self.currency = UserDefaults.standard.string(forKey: CartStore.currencyKey) ?? "USD"
    }

    /// Changes the display currency, persists it and reloads the cart.
    func setCurrency(_ code: String) async {
        currency = code.uppercased()
        UserDefaults.standard.set(currency, forKey: CartStore.currencyKey)
        await load()
    }

    /// Units in the bag (badge).
    var count: Int { cart?.itemCount ?? 0 }
    var isEmpty: Bool { cart?.lines.isEmpty ?? true }

    /// The line for a variant, if it is in the bag.
    func line(for variantId: String) -> CartLine? {
        cart?.lines.first { $0.variantId == variantId }
    }

    /// GET /api/cart.
    func load() async {
        isLoading = true
        defer { isLoading = false }
        var query = [URLQueryItem(name: "currency", value: currency)]
        if let to = destinationCountry, !to.isEmpty {
            query.append(URLQueryItem(name: "to", value: to))
            if let city = destinationCity, !city.isEmpty { query.append(URLQueryItem(name: "city", value: city)) }
        }
        do {
            cart = try await api.get("/api/cart", query: query, as: Cart.self)
            lastError = nil
        } catch let error as APIError {
            if !error.isCancelled { lastError = error }
        } catch {
            lastError = APIError.network(error)
        }
    }

    /// POST /api/cart/lines. Adds `qty` to the line (creates it). Throws e.g. 409 "Only 1 left.".
    func add(variantId: String, qty: Int = 1) async throws {
        busyVariantIds.insert(variantId)
        defer { busyVariantIds.remove(variantId) }
        try await api.send(.post, "/api/cart/lines", body: AddCartLineBody(variantId: variantId, qty: qty))
        await load()
    }

    /// PATCH /api/cart/lines/{variantId}. 0 removes the line.
    func setQuantity(variantId: String, qty: Int) async throws {
        busyVariantIds.insert(variantId)
        defer { busyVariantIds.remove(variantId) }
        try await api.send(.patch, "/api/cart/lines/\(Self.escape(variantId))", body: SetCartLineBody(qty: max(0, qty)))
        await load()
    }

    /// DELETE /api/cart/lines/{variantId}.
    func remove(variantId: String) async throws {
        busyVariantIds.insert(variantId)
        defer { busyVariantIds.remove(variantId) }
        try await api.send(.delete, "/api/cart/lines/\(Self.escape(variantId))")
        await load()
    }

    /// DELETE /api/cart (empties the bag).
    func clear() async throws {
        try await api.send(.delete, "/api/cart")
        await load()
    }

    /// Forget the local copy (e.g. after an order is placed, before reloading).
    func reset() {
        cart = nil
        lastError = nil
    }

    private static func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }

    /// Previews only.
    static func preview(cart: Cart? = nil) -> CartStore {
        let store = CartStore()
        store.cart = cart
        return store
    }
}
