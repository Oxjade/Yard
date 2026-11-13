import Foundation

// MARK: - What the Live Activity needs from an order, read from the live API
//
//   GET /api/orders/{id}           → { order: OrderDetailDto }   (brand id/name/handle, ship-to, states.fulfilment)
//   GET /api/orders/{id}/delivery  → DeliveryDto (unwrapped)     (estimate, shipment events, shippedOn)
//   GET /api/catalog/storefronts/{handle} → brand.city           (where it ships from; best effort)
//
// Only the fields the activity shows are modelled, every one optional (never fail on an odd field).

/// A snapshot of one order for the Live Activity: the static attributes plus the current state.
struct LiveActivityOrder: Sendable, Hashable {
    let orderId: String
    let brandName: String
    let brandCity: String
    let deliveryCity: String
    /// The state to show, or nil when the order shouldn't be tracked (not shipped yet).
    let state: YardOrderActivityAttributes.ContentState?
    /// True when the order is over without a delivery (cancelled, returned to the brand): end the activity.
    let isClosed: Bool

    var attributes: YardOrderActivityAttributes {
        YardOrderActivityAttributes(orderId: orderId, brandName: brandName, brandCity: brandCity, deliveryCity: deliveryCity)
    }
}

// MARK: - DTOs (private to the Live Activity feature)

struct LiveActivityOrderEnvelope: Decodable, Sendable {
    let order: LiveActivityOrderDTO?
}

struct LiveActivityOrderDTO: Decodable, Sendable {
    struct BrandRef: Decodable, Sendable {
        let id: String?
        let name: String?
        let handle: String?
    }
    struct ShipToPreview: Decodable, Sendable {
        let city: String?
        let country: String?
    }
    struct States: Decodable, Sendable {
        let fulfilment: String?
    }

    let id: String?
    let reference: String?
    let brand: BrandRef?
    let shipToPreview: ShipToPreview?
    let states: States?
    let deliveredAt: String?
}

struct LiveActivityDeliveryDTO: Decodable, Sendable {
    struct Estimate: Decodable, Sendable {
        let basis: String?
        let arrivalFrom: String?
        let arrivalTo: String?
        let deliveredOn: String?
        let late: Bool?
    }
    struct Event: Decodable, Sendable {
        let status: String?
        let occurredAt: String?
        let locationText: String?
    }
    struct ShipTo: Decodable, Sendable {
        let country: String?
        let city: String?
    }

    let estimate: Estimate?
    let shippedOn: String?
    let shipTo: ShipTo?
    let events: [Event]?
}

struct LiveActivityStorefrontDTO: Decodable, Sendable {
    struct Brand: Decodable, Sendable {
        let city: String?
    }
    let brand: Brand?
}

// MARK: - Loading

extension LiveActivityOrder {
    typealias State = YardOrderActivityAttributes.ContentState

    /// Reads the order, its delivery and the brand's city, and works out the activity state.
    /// `brandCity`: pass a known value to skip the storefront request (e.g. on refresh).
    static func load(orderId: String, brandCity knownBrandCity: String? = nil, now: Date = Date()) async throws -> LiveActivityOrder {
        let encoded = orderId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? orderId
        let envelope: LiveActivityOrderEnvelope = try await APIClient.shared.get("/api/orders/\(encoded)", as: LiveActivityOrderEnvelope.self)
        // The delivery panel can fail on its own (e.g. a legacy order); the order alone still gives a state.
        let delivery: LiveActivityDeliveryDTO? = try? await APIClient.shared.get("/api/orders/\(encoded)/delivery", as: LiveActivityDeliveryDTO.self)

        var brandCity: String = knownBrandCity ?? ""
        if knownBrandCity == nil, let handle = envelope.order?.brand?.handle, !handle.isEmpty {
            let h = handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle
            if let storefront = try? await APIClient.shared.get("/api/catalog/storefronts/\(h)", as: LiveActivityStorefrontDTO.self) {
                brandCity = storefront.brand?.city ?? ""
            }
        }
        return make(orderId: orderId, order: envelope.order, delivery: delivery, brandCity: brandCity, now: now)
    }

    /// Pure mapping from the API's order + delivery to the activity (no I/O; easy to reason about).
    static func make(orderId: String, order: LiveActivityOrderDTO?, delivery: LiveActivityDeliveryDTO?, brandCity: String, now: Date) -> LiveActivityOrder {
        let brandName: String = order?.brand?.name ?? "The brand"
        let deliveryCity: String = delivery?.shipTo?.city ?? order?.shipToPreview?.city ?? ""
        let fulfilment: String = order?.states?.fulfilment ?? ""

        func result(_ state: YardOrderActivityAttributes.ContentState?, closed: Bool = false) -> LiveActivityOrder {
            LiveActivityOrder(orderId: orderId, brandName: brandName, brandCity: brandCity, deliveryCity: deliveryCity, state: state, isClosed: closed)
        }

        if fulfilment == "cancelled" || fulfilment == "returned_to_sender" {
            return result(nil, closed: true)
        }

        let events: [LiveActivityDeliveryDTO.Event] = (delivery?.events ?? []).sorted { a, b in
            (YardDate.parse(a.occurredAt) ?? .distantPast) < (YardDate.parse(b.occurredAt) ?? .distantPast)
        }
        let statuses: [String] = events.compactMap { $0.status }
        if statuses.contains("returned") {
            return result(nil, closed: true)
        }

        let estimate = delivery?.estimate
        let isDelivered: Bool = fulfilment == "delivered"
            || statuses.contains("delivered")
            || (estimate?.deliveredOn?.isEmpty == false)
            || (order?.deliveredAt?.isEmpty == false)
        if isDelivered {
            return result(State(step: .delivered, etaDate: nil, progress: 1, statusLine: "Delivered"))
        }

        // The ETA: the end of the estimated arrival window, at 8 pm local time (the API sends calendar dates).
        let eta: Date? = LiveActivityDates.endOfArrivalDay(estimate?.arrivalTo ?? estimate?.arrivalFrom)
        let arrivalStart: Date? = LiveActivityDates.startOfDay(estimate?.arrivalFrom ?? estimate?.arrivalTo)
        let isLate: Bool = (estimate?.late ?? false) || estimate?.basis == "late"
        let latestShipment: String? = statuses.last { $0 != "exception" }
        let lastIsException: Bool = statuses.last == "exception"
        let shippedStatuses: Set<String> = ["shipped", "in_transit", "out_for_delivery"]
        let hasShipped: Bool = fulfilment == "shipped" || statuses.contains { shippedStatuses.contains($0) }

        if latestShipment == "out_for_delivery" {
            let line = deliveryCity.isEmpty ? "Out for delivery" : "Out for delivery in \(deliveryCity)"
            return result(State(step: .outForDelivery, etaDate: eta, progress: YardOrderActivityAttributes.Step.outForDelivery.baseProgress + 0.04, statusLine: line))
        }

        if hasShipped {
            // Time-based progress between the shipping moment and the ETA.
            let shippedEvent = events.first { shippedStatuses.contains($0.status ?? "") }
            let shippedAt: Date? = YardDate.parse(shippedEvent?.occurredAt) ?? LiveActivityDates.startOfDay(delivery?.shippedOn)
            var progress: Double = YardOrderActivityAttributes.Step.shipped.baseProgress
            if let start = shippedAt, let end = eta, end > start {
                let fraction = now.timeIntervalSince(start) / end.timeIntervalSince(start)
                progress = 0.25 + 0.53 * min(max(fraction, 0), 1)
            }
            let arrivingSoon: Bool = {
                guard let from = arrivalStart else { return false }
                return now >= from
            }()
            if arrivingSoon {
                let line = deliveryCity.isEmpty ? "Arriving soon" : "Arriving soon in \(deliveryCity)"
                return result(State(step: .arrivingSoon, etaDate: eta, progress: max(progress, YardOrderActivityAttributes.Step.arrivingSoon.baseProgress), statusLine: isLate ? "Running late — \(line.lowercasedFirst)" : line))
            }
            let line: String
            if lastIsException {
                line = "Delayed — \(brandName) reported a delay"
            } else if isLate {
                line = "Running late — new estimate"
            } else if !brandCity.isEmpty {
                line = "On its way from \(brandCity)"
            } else {
                line = "On its way"
            }
            return result(State(step: .shipped, etaDate: eta, progress: progress, statusLine: line))
        }

        if fulfilment == "processing" || statuses.contains("label_created") {
            // Packed but not shipped: shown if an activity is already running; never auto-started.
            return result(State(step: .packed, etaDate: eta, progress: YardOrderActivityAttributes.Step.packed.baseProgress, statusLine: "Packed by \(brandName)"))
        }
        return result(nil)
    }
}

// MARK: - Calendar dates ("2026-11-16") → local Dates

enum LiveActivityDates {
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Local midnight of a yyyy-MM-dd date (accepts a full ISO timestamp too).
    static func startOfDay(_ string: String?) -> Date? {
        guard let s = string, s.count >= 10 else { return nil }
        let day = String(s.prefix(10))
        guard let d = dayFormatter.date(from: day) else { return nil }
        return Calendar.current.startOfDay(for: d)
    }

    /// 8 pm local on a yyyy-MM-dd date: "arrives by the end of that day".
    static func endOfArrivalDay(_ string: String?) -> Date? {
        guard let start = startOfDay(string) else { return nil }
        return Calendar.current.date(byAdding: .hour, value: 20, to: start)
    }
}

private extension String {
    var lowercasedFirst: String {
        guard let first = first else { return self }
        return first.lowercased() + dropFirst()
    }
}
