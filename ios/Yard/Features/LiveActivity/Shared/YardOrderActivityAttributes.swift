import ActivityKit
import Foundation

// MARK: - Order-tracking Live Activity: the data shared by the app and the widget extension
//
// This file is compiled into BOTH targets (the `Yard` app picks it up from `Yard/`, the
// `YardLiveActivity` extension lists `Yard/Features/LiveActivity/Shared` in project.yml).
// Keep it free of app-only types (stores, APIClient, Theme): only Foundation + ActivityKit.
//
// The ContentState is also the JSON an APNs Live Activity push must carry in `content-state`
// (keys: step, etaDate, progress, statusLine). ActivityKit decodes pushes with the default Date
// strategy, so `etaDate` is a number of seconds since 2001-01-01 (Unix seconds − 978307200).
// See ios/Docs/live-activity.md for the exact payload.

/// One brand's part of an order, tracked on the Lock Screen and in the Dynamic Island.
struct YardOrderActivityAttributes: ActivityAttributes {
    /// Where the parcel is in its journey. Raw values are the push payload values.
    enum Step: String, Codable, Hashable, CaseIterable, Sendable {
        case packed
        case shipped
        case outForDelivery
        case arrivingSoon
        case delivered

        /// Short label shown under the route line and in the island.
        var title: String {
            switch self {
            case .packed: return "Packed"
            case .shipped: return "Shipped"
            case .outForDelivery: return "Out for delivery"
            case .arrivingSoon: return "Arriving soon"
            case .delivered: return "Delivered"
            }
        }

        /// SF Symbol for the step (compact trailing, step label).
        var systemImage: String {
            switch self {
            case .packed: return "shippingbox"
            case .shipped: return "airplane"
            case .outForDelivery: return "box.truck"
            case .arrivingSoon: return "mappin.and.ellipse"
            case .delivered: return "checkmark.seal.fill"
            }
        }

        /// Where the marker sits at least, so the line never looks empty.
        var baseProgress: Double {
            switch self {
            case .packed: return 0.08
            case .shipped: return 0.25
            case .outForDelivery: return 0.82
            case .arrivingSoon: return 0.7
            case .delivered: return 1.0
            }
        }
    }

    struct ContentState: Codable, Hashable {
        var step: Step
        /// Estimated arrival (end of the estimated arrival window), nil when unknown.
        var etaDate: Date?
        /// 0…1 along the brand → you line.
        var progress: Double
        /// One human line: "On its way from Lagos", "Out for delivery", "Delivered".
        var statusLine: String

        init(step: Step, etaDate: Date?, progress: Double, statusLine: String) {
            self.step = step
            self.etaDate = etaDate
            self.progress = min(max(progress, 0), 1)
            self.statusLine = statusLine
        }

        /// Progress clamped to 0…1 (a push may send anything).
        var clampedProgress: Double { min(max(progress, 0), 1) }

        /// True while there is a future ETA to count down to.
        func hasUpcomingETA(now: Date = Date()) -> Bool {
            guard step != .delivered, let eta = etaDate else { return false }
            return eta > now
        }
    }

    /// The order (one brand's part of a checkout): `/api/orders/{id}`.
    var orderId: String
    /// The brand shipping it.
    var brandName: String
    /// Where it ships from; may be empty when unknown.
    var brandCity: String
    /// Where it's going (the shopper's city); may be empty when unknown.
    var deliveryCity: String
}

// MARK: - Deep links

/// URLs the Live Activity opens. They use paths `Route(url:)` already understands
/// (`yard://you/orders/<id>` → `.order(id:)`), so YardApp's existing `.onOpenURL` handles them.
enum YardOrderActivityLink {
    /// Order detail.
    static func details(orderId: String) -> URL {
        url(orderId: orderId, query: nil)
    }

    /// Order detail, asking for the delivery/tracking section (the router ignores the query today,
    /// so it lands on the same screen; the Orders screen may read `view=track` to scroll there).
    static func track(orderId: String) -> URL {
        url(orderId: orderId, query: "view=track")
    }

    private static func url(orderId: String, query: String?) -> URL {
        var c = URLComponents()
        c.scheme = "yard"
        c.host = "you"
        c.path = "/orders/" + orderId
        if let query { c.query = query }
        // Falls back to the orders list if the id can't form a URL (it always can: ids are [\w-]).
        return c.url ?? URL(string: "yard://you/orders")!
    }
}

// MARK: - Preview / fixture values (Xcode previews only, never shown in the app)

extension YardOrderActivityAttributes {
    static let previewAttributes = YardOrderActivityAttributes(
        orderId: "ord_preview",
        brandName: "Ojuelegba Supply",
        brandCity: "Lagos",
        deliveryCity: "London"
    )
}

extension YardOrderActivityAttributes.ContentState {
    static let previewPacked = YardOrderActivityAttributes.ContentState(
        step: .packed,
        etaDate: Date().addingTimeInterval(4 * 86_400 + 3_600 * 5),
        progress: 0.08,
        statusLine: "Packed by Ojuelegba Supply"
    )
    static let previewShipped = YardOrderActivityAttributes.ContentState(
        step: .shipped,
        etaDate: Date().addingTimeInterval(2 * 86_400 + 3_600 * 3),
        progress: 0.45,
        statusLine: "On its way from Lagos"
    )
    static let previewOutForDelivery = YardOrderActivityAttributes.ContentState(
        step: .outForDelivery,
        etaDate: Date().addingTimeInterval(3_600 * 5 + 660),
        progress: 0.86,
        statusLine: "Out for delivery in London"
    )
    static let previewDelivered = YardOrderActivityAttributes.ContentState(
        step: .delivered,
        etaDate: nil,
        progress: 1,
        statusLine: "Delivered"
    )
}
