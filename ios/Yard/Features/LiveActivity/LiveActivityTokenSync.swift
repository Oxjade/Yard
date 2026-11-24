import Foundation

// MARK: - Live Activity push tokens → Yard's server
//
// docs/APP.md › Live Activity push (website repo):
//   POST   /api/orders/{id}/live-activity        { token, timeZone, appVersion }  → 204
//   DELETE /api/orders/{id}/live-activity        { token }                        → 204
//   POST   /api/live-activity/push-to-start      { token, timeZone, appVersion }  → 204 (iOS 17.2+)
//   DELETE /api/live-activity/push-to-start      { token }                        → 204
// All need the shopper session. The server then sends APNs `liveactivity` pushes to the token when
// the order's delivery changes, so the activity updates while the app is closed.
//
// `LiveActivityTokenSync` keeps what has been uploaded (and what still has to be, after a failure
// such as no network or no session yet) and is retried by `LiveActivityManager.resume()`. The network
// sits behind `LiveActivityTokenUploading`, so YardTests drives it with a fake.

/// The four calls, behind a protocol for tests.
protocol LiveActivityTokenUploading: Sendable {
    func register(orderId: String, token: String, timeZone: String, appVersion: String?) async throws
    func unregister(orderId: String, token: String) async throws
    func registerStart(token: String, timeZone: String, appVersion: String?) async throws
    func unregisterStart(token: String) async throws
}

/// Where the sync state survives relaunches.
protocol LiveActivityTokenStoring: Sendable {
    func load() -> LiveActivityTokenSync.Snapshot
    func save(_ snapshot: LiveActivityTokenSync.Snapshot)
}

/// The real endpoints, through `APIClient.shared`.
struct LiveActivityTokenAPI: LiveActivityTokenUploading {
    private struct RegisterBody: Encodable, Sendable {
        let token: String
        let timeZone: String
        let appVersion: String?
    }

    private struct TokenBody: Encodable, Sendable {
        let token: String
    }

    private static func orderPath(_ orderId: String) -> String {
        let encoded: String = orderId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? orderId
        return "/api/orders/\(encoded)/live-activity"
    }

    func register(orderId: String, token: String, timeZone: String, appVersion: String?) async throws {
        try await APIClient.shared.send(.post, Self.orderPath(orderId), body: RegisterBody(token: token, timeZone: timeZone, appVersion: appVersion))
    }

    func unregister(orderId: String, token: String) async throws {
        try await APIClient.shared.send(.delete, Self.orderPath(orderId), body: TokenBody(token: token))
    }

    func registerStart(token: String, timeZone: String, appVersion: String?) async throws {
        try await APIClient.shared.send(.post, "/api/live-activity/push-to-start", body: RegisterBody(token: token, timeZone: timeZone, appVersion: appVersion))
    }

    func unregisterStart(token: String) async throws {
        try await APIClient.shared.send(.delete, "/api/live-activity/push-to-start", body: TokenBody(token: token))
    }
}

/// UserDefaults (JSON under one key).
struct LiveActivityTokenDefaultsStore: LiveActivityTokenStoring {
    static let key = "yard.liveActivity.tokenSync"

    func load() -> LiveActivityTokenSync.Snapshot {
        guard let data = UserDefaults.standard.data(forKey: Self.key),
              let snapshot = try? JSONDecoder().decode(LiveActivityTokenSync.Snapshot.self, from: data) else {
            return LiveActivityTokenSync.Snapshot()
        }
        return snapshot
    }

    func save(_ snapshot: LiveActivityTokenSync.Snapshot) {
        if let data = try? JSONEncoder().encode(snapshot) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}

@MainActor
final class LiveActivityTokenSync {
    struct Entry: Codable, Equatable, Sendable {
        var token: String
        /// True once the server answered 204 for this token.
        var uploaded: Bool
    }

    struct Snapshot: Codable, Equatable, Sendable {
        /// Activity push tokens by order id.
        var orders: [String: Entry] = [:]
        /// The phone's push-to-start token (iOS 17.2+).
        var start: Entry?
        /// Tokens to DELETE on the server that failed to go (offline): order id → token; "" = push-to-start.
        var stale: [StaleToken] = []
    }

    struct StaleToken: Codable, Equatable, Sendable {
        var orderId: String
        var token: String
    }

    private let uploader: any LiveActivityTokenUploading
    private let store: any LiveActivityTokenStoring
    private let timeZone: () -> String
    private let appVersion: String?
    private(set) var snapshot: Snapshot

    init(uploader: any LiveActivityTokenUploading,
         store: any LiveActivityTokenStoring,
         timeZone: @escaping () -> String = { TimeZone.current.identifier },
         appVersion: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.uploader = uploader
        self.store = store
        self.timeZone = timeZone
        self.appVersion = appVersion
        self.snapshot = store.load()
    }

    static func live() -> LiveActivityTokenSync {
        LiveActivityTokenSync(uploader: LiveActivityTokenAPI(), store: LiveActivityTokenDefaultsStore())
    }

    /// The activity of `orderId` has a (new) push token. A rotated token replaces the old one on the server.
    func tokenChanged(orderId: String, token: String) async {
        let previous: Entry? = snapshot.orders[orderId]
        if let previous, previous.token == token, previous.uploaded { return }
        if let previous, previous.token != token, previous.uploaded {
            snapshot.stale.append(StaleToken(orderId: orderId, token: previous.token))
        }
        snapshot.orders[orderId] = Entry(token: token, uploaded: false)
        persist()
        await upload(orderId: orderId)
        await flushStale()
    }

    /// The activity of `orderId` ended on the phone: the server forgets its token.
    func activityEnded(orderId: String) async {
        guard let entry = snapshot.orders.removeValue(forKey: orderId) else { return }
        if entry.uploaded {
            snapshot.stale.append(StaleToken(orderId: orderId, token: entry.token))
        }
        persist()
        await flushStale()
    }

    /// The phone's push-to-start token (iOS 17.2+), new or rotated.
    func startTokenChanged(_ token: String) async {
        if let current = snapshot.start, current.token == token, current.uploaded { return }
        if let current = snapshot.start, current.token != token, current.uploaded {
            snapshot.stale.append(StaleToken(orderId: "", token: current.token))
        }
        snapshot.start = Entry(token: token, uploaded: false)
        persist()
        await uploadStart()
        await flushStale()
    }

    /// Retries everything that hasn't reached the server (launch, foreground, after sign-in).
    func retryPending() async {
        let pending: [String] = snapshot.orders.filter { !$0.value.uploaded }.map { $0.key }.sorted()
        for orderId in pending {
            await upload(orderId: orderId)
        }
        if let start = snapshot.start, !start.uploaded {
            await uploadStart()
        }
        await flushStale()
    }

    /// Before signing out (needs the session): removes every token of this phone from the server.
    func signOut() async {
        for (orderId, entry) in snapshot.orders where entry.uploaded {
            snapshot.stale.append(StaleToken(orderId: orderId, token: entry.token))
        }
        if let start = snapshot.start, start.uploaded {
            snapshot.stale.append(StaleToken(orderId: "", token: start.token))
        }
        snapshot.orders = [:]
        snapshot.start = nil
        persist()
        await flushStale()
        // Whatever couldn't be deleted now belongs to the old session: the server drops it on its own
        // (APNs reports the token gone once the activity ends).
        snapshot.stale = []
        persist()
    }

    // MARK: Private

    private func upload(orderId: String) async {
        guard let entry = snapshot.orders[orderId], !entry.uploaded else { return }
        do {
            try await uploader.register(orderId: orderId, token: entry.token, timeZone: timeZone(), appVersion: appVersion)
            // Still the same token (a rotation may have landed while this was in flight)?
            if snapshot.orders[orderId]?.token == entry.token {
                snapshot.orders[orderId]?.uploaded = true
                persist()
            }
        } catch {
            if let apiError = error as? APIError, apiError.isNotFound {
                // Not this shopper's order (any more): stop trying.
                snapshot.orders[orderId] = nil
                persist()
            }
            print("[LiveActivity] token upload for order \(orderId) failed: \(error.localizedDescription)")
        }
    }

    private func uploadStart() async {
        guard let entry = snapshot.start, !entry.uploaded else { return }
        do {
            try await uploader.registerStart(token: entry.token, timeZone: timeZone(), appVersion: appVersion)
            if snapshot.start?.token == entry.token {
                snapshot.start?.uploaded = true
                persist()
            }
        } catch {
            print("[LiveActivity] push-to-start token upload failed: \(error.localizedDescription)")
        }
    }

    private func flushStale() async {
        guard !snapshot.stale.isEmpty else { return }
        var left: [StaleToken] = []
        for item in snapshot.stale {
            do {
                if item.orderId.isEmpty {
                    try await uploader.unregisterStart(token: item.token)
                } else {
                    try await uploader.unregister(orderId: item.orderId, token: item.token)
                }
            } catch {
                if let apiError = error as? APIError, apiError.isNotFound { continue }
                left.append(item)
            }
        }
        snapshot.stale = left
        persist()
    }

    private func persist() {
        store.save(snapshot)
    }
}
