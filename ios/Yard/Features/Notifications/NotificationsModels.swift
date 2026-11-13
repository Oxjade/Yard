import Foundation

// Models for the shopper's in-app notifications.
// Source of truth: src/lib/api/contracts/notifications.ts (notificationDto) and
// src/server/notify.ts (toNotificationDto), templates in src/server/notify-templates.ts and
// src/server/email/inapp.ts.

/// One server notification (GET /api/notifications?as=shopper → `{ items: [...] }`).
struct ShopperNotification: Identifiable, Hashable, Sendable, Decodable {
    let id: String
    /// The server event key ("msg:cv_…", "shipped:ord_…"). Mark-read calls send these keys.
    let key: String
    let category: String
    let title: String
    let body: String
    /// A same-origin path ("/you/orders/ord_1", "/drops/slug", "/inbox?thread=cv_1") or nil.
    let href: String?
    /// ISO timestamp.
    let at: String
    var read: Bool

    enum CodingKeys: String, CodingKey {
        case id, key, category, title, body, href, at, read
    }

    init(id: String, key: String, category: String, title: String, body: String, href: String?, at: String, read: Bool) {
        self.id = id
        self.key = key
        self.category = category
        self.title = title
        self.body = body
        self.href = href
        self.at = at
        self.read = read
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        key = c.lenient(.key, id)
        category = c.lenient(.category, "")
        title = c.lenient(.title, "")
        body = c.lenient(.body, "")
        href = c.lenientOptional(.href, as: String.self)
        at = c.lenient(.at, "")
        read = c.lenient(.read, false)
    }

    var date: Date? { YardDate.parse(at) }
    var kind: ShopperNotificationKind { ShopperNotificationKind(category: category) }
    /// The in-app destination of `href`, if the app has that page.
    var route: Route? { NotificationsRouting.route(for: href) }
}

struct NotificationsListResponse: Decodable, Sendable {
    let items: [ShopperNotification]

    enum CodingKeys: String, CodingKey { case items }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // One malformed row never hides the rest.
        items = c.lenient(.items, [LossyNotification]()).compactMap { $0.value }
    }
}

private struct LossyNotification: Decodable {
    let value: ShopperNotification?

    init(from decoder: Decoder) throws {
        value = try? ShopperNotification(from: decoder)
    }
}

/// POST /api/notifications/read?as=shopper — `{ keys?, all?, read? }` (strict: no other fields).
struct NotificationsReadBody: Encodable, Sendable {
    var keys: [String]?
    var all: Bool?
    var read: Bool?
}

/// `{ updated, keys, read }`.
struct NotificationsReadResult: Decodable, Sendable {
    let updated: Int?
    let keys: [String]?
    let read: Bool?
}

/// Visual family of a notification, from its server `category`.
enum ShopperNotificationKind: Sendable {
    case drop
    case order
    case message
    case follow
    case wishlist
    case account
    case other

    init(category: String) {
        switch category {
        case "drop_update", "drops", "drop_live", "drop_performance":
            self = .drop
        case "delivery_update", "delivery_complaint", "orders", "order_confirmed", "order_shipped",
             "order_delivered", "refund", "shipping_issue":
            self = .order
        case "new_message":
            self = .message
        case "followed_activity", "new_follower", "brand_announcement", "chart_movement":
            self = .follow
        case "price_drop", "price_drops", "back_in_stock", "wishlist_update":
            self = .wishlist
        case "account_status", "account", "report_update", "content_moderation":
            self = .account
        default:
            self = .other
        }
    }

    var systemImage: String {
        switch self {
        case .drop: return "flame"
        case .order: return "shippingbox"
        case .message: return "bubble.left.and.bubble.right"
        case .follow: return "person.badge.plus"
        case .wishlist: return "tag"
        case .account: return "person.crop.circle.badge.exclamationmark"
        case .other: return "bell"
        }
    }

    /// Short label (matches the website's category labels).
    var label: String {
        switch self {
        case .drop: return "Drop"
        case .order: return "Delivery"
        case .message: return "Inbox"
        case .follow: return "Following"
        case .wishlist: return "Wishlist"
        case .account: return "Account"
        case .other: return "Yard"
        }
    }
}

/// Maps a notification `href` (always a same-origin path) to an app route.
enum NotificationsRouting {
    static func route(for href: String?) -> Route? {
        guard let href, href.hasPrefix("/"), !href.hasPrefix("//") else { return nil }
        // The website never sends Studio/admin paths to shoppers, but be safe.
        if href.hasPrefix("/studio") || href.hasPrefix("/admin") { return nil }
        guard let url = Config.url(for: href) else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let parts = url.pathComponents.filter { $0 != "/" }
        // Inbox links are "/inbox?thread=cv_…" (src/server/inbox/service.ts threadHref).
        if parts.first == "inbox" {
            if let thread = components?.queryItems?.first(where: { $0.name == "thread" })?.value, !thread.isEmpty {
                return .conversation(id: thread)
            }
        }
        return Route(url: url)
    }
}
