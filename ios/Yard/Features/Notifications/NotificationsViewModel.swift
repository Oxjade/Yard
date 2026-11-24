import Foundation
import Observation

/// Loads and marks the shopper's in-app notifications.
///
/// - GET  /api/notifications?as=shopper              → `{ items }` (newest first, max 100)
/// - POST /api/notifications/read?as=shopper         `{ keys: [key] }` or `{ all: true }`, optional `read: false`
@Observable
@MainActor
final class NotificationsViewModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum Filter: String, Hashable, CaseIterable {
        case all
        case unread
    }

    private(set) var items: [ShopperNotification] = []
    private(set) var phase: Phase = .idle
    private(set) var isMarkingAll: Bool = false
    var filter: Filter = .all

    private let api: APIClient
    private static let asShopper = URLQueryItem(name: "as", value: "shopper")

    init(api: APIClient = .shared, items: [ShopperNotification]? = nil) {
        self.api = api
        if let items {
            self.items = items
            self.phase = .loaded
        }
    }

    var unreadCount: Int { items.filter { !$0.read }.count }

    var visible: [ShopperNotification] {
        switch filter {
        case .all: return items
        case .unread: return items.filter { !$0.read }
        }
    }

    /// Today / Earlier, keeping the server's newest-first order.
    var sections: [NotificationsSection] {
        let calendar = Calendar.current
        var today: [ShopperNotification] = []
        var earlier: [ShopperNotification] = []
        for n in visible {
            if let d = n.date, calendar.isDateInToday(d) {
                today.append(n)
            } else {
                earlier.append(n)
            }
        }
        var out: [NotificationsSection] = []
        if !today.isEmpty { out.append(NotificationsSection(title: "Today", items: today)) }
        if !earlier.isEmpty { out.append(NotificationsSection(title: "Earlier", items: earlier)) }
        return out
    }

    /// Loads the list. Returns the error message when a refresh failed with items still on screen
    /// (they are kept), so the caller can toast it; nil otherwise.
    @discardableResult
    func load() async -> String? {
        if items.isEmpty { phase = .loading }
        do {
            let response: NotificationsListResponse = try await api.get(
                "/api/notifications",
                query: [Self.asShopper],
                as: NotificationsListResponse.self
            )
            items = response.items
            phase = .loaded
            return nil
        } catch {
            if let apiError = error as? APIError, apiError.isCancelled { return nil }
            if items.isEmpty {
                phase = .failed(APIError.message(for: error))
                return nil
            }
            // With items on screen a failed refresh keeps them; the caller toasts the message.
            return APIError.message(for: error)
        }
    }

    /// Clears everything (sign out).
    func reset() {
        items = []
        phase = .idle
        filter = .all
    }

    /// Marks one notification read (or unread). Optimistic; rolls back on failure.
    func setRead(_ read: Bool, for notification: ShopperNotification) async throws {
        guard let index = items.firstIndex(where: { $0.id == notification.id }) else { return }
        let previous = items[index].read
        if previous == read { return }
        items[index].read = read
        do {
            let body = NotificationsReadBody(keys: [notification.key], all: nil, read: read)
            _ = try await api.post("/api/notifications/read", body: body, query: [Self.asShopper], as: NotificationsReadResult.self)
        } catch {
            if let i = items.firstIndex(where: { $0.id == notification.id }) {
                items[i].read = previous
            }
            throw error
        }
    }

    /// Marks every notification read. Optimistic; rolls back on failure.
    func markAllRead() async throws {
        guard unreadCount > 0 else { return }
        let snapshot = items
        isMarkingAll = true
        defer { isMarkingAll = false }
        for i in items.indices { items[i].read = true }
        do {
            let body = NotificationsReadBody(keys: nil, all: true, read: nil)
            _ = try await api.post("/api/notifications/read", body: body, query: [Self.asShopper], as: NotificationsReadResult.self)
        } catch {
            items = snapshot
            throw error
        }
    }
}

/// A "Today" / "Earlier" group of the list.
struct NotificationsSection: Identifiable {
    let title: String
    let items: [ShopperNotification]
    var id: String { title }
}
