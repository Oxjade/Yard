import Foundation

/// Every orders endpoint this feature calls (src/app/api/orders/**, src/app/api/checkout/[id]/**).
/// All are shopper-only: a signed-out call is a 401 (`APIError.isUnauthorized`).
enum OrdersAPI {
    /// GET /api/orders?limit=&before= — the shopper's orders, newest first.
    static func list(before: String? = nil, limit: Int = 50) async throws -> OrdersPage {
        var query: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await APIClient.shared.get("/api/orders", query: query, as: OrdersPage.self)
    }

    /// GET /api/orders/{id} — one order with lines, timeline, delivery and allowed actions.
    static func detail(id: String) async throws -> OrderDetail {
        let response = try await APIClient.shared.get("/api/orders/\(encoded(id))", as: OrderDetailResponse.self)
        return response.order
    }

    /// GET /api/checkout/{id} — the checkout's status, totals and payment.
    static func checkout(id: String) async throws -> OrderCheckout {
        try await APIClient.shared.get("/api/checkout/\(encoded(id))", as: OrderCheckout.self)
    }

    /// POST /api/checkout/{id}/verify — asks the payment provider directly (used while pending).
    static func verifyCheckout(id: String) async throws -> OrderCheckout {
        try await APIClient.shared.post("/api/checkout/\(encoded(id))/verify", as: OrderCheckout.self)
    }

    /// GET /api/orders/checkouts/{checkoutId} — the brand orders one checkout created.
    static func checkoutOrders(checkoutId: String) async throws -> [OrderSummary] {
        let page = try await APIClient.shared.get("/api/orders/checkouts/\(encoded(checkoutId))", as: OrdersPage.self)
        return page.items
    }

    /// POST /api/orders/{id}/cancel — before dispatch only. Returns the updated order.
    static func cancel(id: String) async throws -> OrderDetail {
        let body = OrderCancelBody(reason: "Cancelled by the shopper", idempotencyKey: OrderText.idempotencyKey("cancel"))
        let response = try await APIClient.shared.post("/api/orders/\(encoded(id))/cancel", body: body, as: OrderDetailResponse.self)
        return response.order
    }

    /// POST /api/orders/{id}/returns — delivered orders inside the return window. Returns the updated order.
    static func requestReturn(id: String, lines: [OrderReturnLineBody], reason: OrderReturnReason, note: String) async throws -> OrderDetail {
        let body = OrderReturnBody(lines: lines, reason: reason.rawValue, note: note, idempotencyKey: OrderText.idempotencyKey("return"))
        let response = try await APIClient.shared.post("/api/orders/\(encoded(id))/returns", body: body, as: OrderDetailResponse.self)
        return response.order
    }

    /// The brand's city for the tracking route line (public storefront). Nil when unavailable.
    static func brandCity(handle: String) async -> String? {
        guard !handle.isEmpty else { return nil }
        let storefront = try? await APIClient.shared.get("/api/catalog/storefronts/\(encoded(handle))", as: PublicStorefront.self)
        return OrderText.nonEmpty(storefront?.brand.city)
    }

    private static func encoded(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }
}
