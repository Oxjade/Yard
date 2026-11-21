import Foundation

/// The Studio endpoints (docs/APP.md › Studio in the app). Every `/api/studio/…` call reads the
/// brand session cookie (`yard_b`), so call them through `StudioStore.call { … }`, which opens
/// (switches) the brand session first and re-switches once on a 401.
enum StudioAPI {
    private static var api: APIClient { APIClient.shared }

    // MARK: Session

    /// POST /api/studio/session/switch { brandId } with the shopper session: sets `yard_b`.
    static func switchBrand(_ brandId: String) async throws -> StudioSwitchResult {
        try await api.post("/api/studio/session/switch", body: StudioSwitchBody(brandId: brandId), as: StudioSwitchResult.self)
    }

    /// POST /api/auth/brand/switch { brandId } with an open brand session (keeps its
    /// re-confirmation time; used after a provider re-confirmation).
    static func switchOpenBrandSession(_ brandId: String) async throws {
        try await api.send(.post, "/api/auth/brand/switch", body: StudioSwitchBody(brandId: brandId))
    }

    /// Leaving Studio keeps the shopper signed in: POST /api/auth/sign-out?actor=brand.
    static func signOutBrand() async {
        try? await api.send(.post, "/api/auth/sign-out", query: [URLQueryItem(name: "actor", value: "brand")])
    }

    // MARK: Apply (shopper session)

    static func application() async throws -> StudioApplication? {
        try await api.get("/api/studio/apply", as: StudioApplicationEnvelope.self).application
    }

    static func apply(_ body: StudioApplyBody) async throws -> StudioApplyResult {
        try await api.post("/api/studio/apply", body: body, as: StudioApplyResult.self)
    }

    /// GET /api/catalog/categories (public). Never hard-coded in the app.
    static func categories() async throws -> [WelcomeCategory] {
        try await api.get("/api/catalog/categories", as: WelcomeCategoriesResponse.self).categories
    }

    // MARK: Home

    static func dashboard(days: Int) async throws -> StudioDashboard {
        try await api.get("/api/studio/dashboard", query: [URLQueryItem(name: "days", value: String(days))], as: StudioDashboard.self)
    }

    // MARK: Orders

    static func orders(_ query: [URLQueryItem], before: String?) async throws -> StudioOrdersPage {
        var items = query
        if let before { items.append(URLQueryItem(name: "before", value: before)) }
        items.append(URLQueryItem(name: "limit", value: "30"))
        return try await api.get("/api/studio/orders", query: items, as: StudioOrdersPage.self)
    }

    static func order(_ id: String) async throws -> StudioOrderDetail {
        try await api.get("/api/studio/orders/\(escaped(id))", as: StudioOrderEnvelope.self).order
    }

    static func markProcessing(_ id: String) async throws {
        try await api.send(.post, "/api/studio/orders/\(escaped(id))/processing")
    }

    static func ship(_ id: String, carrier: String?, tracking: String?) async throws {
        try await api.send(.post, "/api/studio/orders/\(escaped(id))/shipment", body: StudioShipmentBody(status: "shipped", carrier: carrier, trackingNumber: tracking))
    }

    static func cancel(_ id: String, reason: String, restock: Bool, key: String) async throws {
        try await api.send(.post, "/api/studio/orders/\(escaped(id))/cancel", body: StudioCancelBody(reason: reason, restock: restock, idempotencyKey: key))
    }

    static func refund(_ id: String, amountMinor: Int, reason: String, key: String) async throws {
        try await api.send(.post, "/api/studio/orders/\(escaped(id))/refunds", body: StudioRefundBody(amountMinor: amountMinor, reason: reason, idempotencyKey: key))
    }

    // MARK: Products

    static func products(status: String, q: String, lowStock: Bool, offset: Int) async throws -> StudioProductsPage {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "status", value: status),
            URLQueryItem(name: "limit", value: "30"),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { query.append(URLQueryItem(name: "q", value: trimmed)) }
        if lowStock { query.append(URLQueryItem(name: "lowStock", value: "1")) }
        return try await api.get("/api/studio/catalog/products", query: query, as: StudioProductsPage.self)
    }

    static func product(_ id: String) async throws -> StudioProduct {
        try await api.get("/api/studio/catalog/products/\(escaped(id))", as: StudioProductEnvelope.self).product
    }

    static func adjustStock(variantId: String, by delta: Int) async throws -> StudioStockResult {
        let body = StudioStockBody(mode: "adjust", qty: delta, reason: delta > 0 ? "restock" : "adjustment")
        return try await api.post("/api/studio/catalog/variants/\(escaped(variantId))/stock", body: body, as: StudioStockResult.self)
    }

    /// publish | unpublish (also schedule/archive/restore on the server).
    static func setStatus(productId: String, action: String, version: Int) async throws -> StudioProduct {
        try await api.post("/api/studio/catalog/products/\(escaped(productId))/status", body: StudioStatusBody(action: action, expectedVersion: version), as: StudioProductEnvelope.self).product
    }

    static func createProduct(_ body: StudioProductCreateBody) async throws -> StudioProduct {
        try await api.post("/api/studio/catalog/products", body: body, as: StudioProductEnvelope.self).product
    }

    /// POST /api/uploads?purpose=social_post&as=brand (multipart, one `file`, Content-Length set).
    static func uploadPhoto(jpeg: Data) async throws -> String {
        let boundary = "YardBoundary-\(UUID().uuidString)"
        var request = try api.makeRequest(.post, "/api/uploads", query: [
            URLQueryItem(name: "purpose", value: "social_post"),
            URLQueryItem(name: "as", value: "brand"),
        ], body: nil)
        let body = ProfilePhotoAPI.multipartBody(jpeg: jpeg, boundary: boundary)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.timeoutInterval = 90
        let result: (Data, URLResponse)
        do {
            result = try await api.session.upload(for: request, from: body)
        } catch {
            throw APIError.network(error)
        }
        guard let http = result.1 as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "We couldn't reach Yard. Try again.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIClient.error(status: http.statusCode, data: result.0)
        }
        do {
            return try api.decoder.decode(StudioUploadResult.self, from: result.0).media.id
        } catch {
            throw APIError.decoding(error)
        }
    }

    // MARK: Website pieces

    static func websitePieces() async throws -> StudioSitePieces {
        try await api.get("/api/studio/catalog/website-pieces", as: StudioSitePieces.self)
    }

    static func websitePiece(_ id: String, action: String) async throws -> StudioSitePieces {
        try await api.post("/api/studio/catalog/website-pieces/\(escaped(id))", body: StudioSitePieceAction(action: action), as: StudioSitePieces.self)
    }

    // MARK: Payouts

    static func payouts() async throws -> StudioPayouts {
        try await api.get("/api/studio/payouts", as: StudioPayouts.self)
    }

    // MARK: Inbox

    static func conversations(filter: String) async throws -> StudioConversationsPage {
        try await api.get("/api/studio/inbox/conversations", query: [URLQueryItem(name: "filter", value: filter)], as: StudioConversationsPage.self)
    }

    static func thread(_ source: StudioThreadSource) async throws -> StudioThread {
        switch source {
        case .conversation(let id):
            return try await api.get("/api/studio/inbox/conversations/\(escaped(id))/messages", query: [URLQueryItem(name: "limit", value: "50")], as: StudioThread.self)
        case .support:
            return try await api.get("/api/studio/support/conversation/messages", query: [URLQueryItem(name: "limit", value: "50")], as: StudioThread.self)
        }
    }

    static func reply(_ source: StudioThreadSource, text: String, clientId: String) async throws -> InboxMessage? {
        switch source {
        case .conversation(let id):
            let body = StudioReplyBody(conversationId: id, clientId: clientId, kind: "text", body: text)
            return try await api.post("/api/studio/inbox/messages", body: body, as: StudioSendResult.self).message
        case .support:
            let body = StudioSupportBody(clientId: clientId, kind: "text", body: text)
            return try await api.post("/api/studio/support/messages", body: body, as: StudioSendResult.self).message
        }
    }

    static func markRead(_ source: StudioThreadSource, upToSeq: Int) async {
        switch source {
        case .conversation(let id):
            try? await api.send(.post, "/api/studio/inbox/conversations/\(escaped(id))/read", body: StudioReadBody(upToSeq: upToSeq))
        case .support:
            try? await api.send(.post, "/api/studio/support/conversation/read", body: StudioReadBody(upToSeq: upToSeq))
        }
    }

    // MARK: Settings

    static func pushPrefs() async throws -> StudioPushPrefs {
        try await api.get("/api/studio/settings/notifications", as: StudioPushPrefsEnvelope.self).push
    }

    static func savePushPrefs(_ prefs: StudioPushPrefs) async throws -> StudioPushPrefs {
        try await api.put("/api/studio/settings/notifications", body: StudioPushPrefsEnvelope(push: prefs), as: StudioPushPrefsEnvelope.self).push
    }

    static func testPush() async throws -> StudioPushTestResult {
        try await api.post("/api/studio/push/test", as: StudioPushTestResult.self)
    }

    // MARK: Re-confirmation (money actions)

    /// POST /api/auth/reauth?as=brand { password }.
    static func reauth(password: String) async throws {
        try await api.send(.post, "/api/auth/reauth", body: ["password": password], query: [URLQueryItem(name: "as", value: "brand")])
    }

    private static func escaped(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }
}

/// Which thread a Studio chat screen shows.
enum StudioThreadSource: Hashable, Sendable {
    case conversation(String)
    case support
}

// MARK: - Brand session gate

/// Opens the brand session before Studio calls and re-opens it once on a 401 (docs/APP.md §1:
/// "When any /api/studio/… call answers 401, call the switch again (silently), then retry once;
/// if the switch itself is 401, the shopper session is gone: sign in again").
@MainActor
final class StudioSessionGate {
    typealias Switcher = (String) async throws -> StudioSwitchResult

    /// The brand whose session this app run opened (nil until the first switch).
    private(set) var openedBrandId: String?
    /// The last switch answer (permissions, review status).
    private(set) var profile: StudioBrandProfile?
    private let switcher: Switcher

    /// Thrown when the switch itself answers 401: the shopper session is gone.
    static let signedOut = APIError(status: 401, code: "signed_out", message: "Your session ended. Sign in again to open Studio.")

    init(switcher: @escaping Switcher = { id in try await StudioAPI.switchBrand(id) }) {
        self.switcher = switcher
    }

    /// Opens (switches to) `brandId` unless it's already open in this run.
    func ensure(_ brandId: String) async throws {
        if openedBrandId != brandId {
            try await open(brandId)
        }
    }

    /// Always calls the switch.
    func open(_ brandId: String) async throws {
        do {
            let result = try await switcher(brandId)
            openedBrandId = brandId
            if let p = result.profile { profile = p }
        } catch let error as APIError where error.status == 401 {
            openedBrandId = nil
            throw Self.signedOut
        } catch {
            openedBrandId = nil
            throw error
        }
    }

    /// Runs `operation` with the brand session open; on a 401 re-switches once and retries.
    func run<T>(_ brandId: String, _ operation: () async throws -> T) async throws -> T {
        try await ensure(brandId)
        do {
            return try await operation()
        } catch let error as APIError where error.status == 401 {
            openedBrandId = nil
            try await open(brandId)
            return try await operation()
        }
    }

    /// Marks the session closed (sign-out, leaving Studio).
    func reset() {
        openedBrandId = nil
        profile = nil
    }

    /// The brand session now belongs to `brandId` (e.g. after a provider re-confirmation).
    func markOpened(_ brandId: String) {
        openedBrandId = brandId
    }
}

// MARK: - Re-confirmation

/// A 403 asking for a recent re-confirmation (`fields.reauth = "required"`).
struct StudioReauthRequest: Equatable, Sendable {
    /// "password", or providers like "google", "apple,google", "auth0:google-oauth2".
    let methods: [String]

    init?(_ error: Error) {
        guard let api = error as? APIError, api.status == 403, api.fields["reauth"] == "required" else { return nil }
        let raw = api.fields["reauthWith"] ?? "password"
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        methods = parts.isEmpty ? ["password"] : parts
    }

    init(methods: [String]) {
        self.methods = methods
    }

    var usesPassword: Bool { methods.contains("password") }

    /// The first provider method, as (provider, auth0 connection).
    var provider: (name: String, connection: String?)? {
        guard let first = methods.first(where: { $0 != "password" }) else { return nil }
        if first.hasPrefix("auth0:") {
            return ("auth0", String(first.dropFirst("auth0:".count)))
        }
        return (first, nil)
    }

    var providerLabel: String {
        guard let p = provider else { return "your sign-in" }
        if let connection = p.connection, connection.contains("google") { return "Google" }
        switch p.name {
        case "google": return "Google"
        case "apple": return "Apple"
        default: return "your sign-in"
        }
    }
}
