import Foundation

// Product-feature-only DTOs (not shared models).
//
//   GET    /api/shipping/estimate?product=&to=&city=&qty=&cur=   → ProductEstimate (public)
//   GET    /api/wishlist/back-in-stock/{variantId}               → ProductBackInStockWatch (shopper)
//   POST   /api/wishlist/back-in-stock  { variantId }            → start watching a variant
//   DELETE /api/wishlist/back-in-stock/{variantId}               → stop watching
//
// Shapes from src/lib/api/contracts/shipping.ts (`estimateResponse`, `quoteOptionDto`,
// `estimateDto`, `shippingBrandDto`) and src/components/market/back-in-stock-button.tsx.

/// GET /api/shipping/estimate: how this piece ships to the shopper's country.
struct ProductEstimate: Decodable, Sendable {
    struct Brand: Decodable, Sendable {
        let name: String
        let originCity: String
        let originCountry: String
        let cutoffLocal: String?

        enum CodingKeys: String, CodingKey { case name, originCity, originCountry, cutoffLocal }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = c.lenient(.name, "")
            originCity = c.lenient(.originCity, "")
            originCountry = c.lenient(.originCountry, "")
            cutoffLocal = c.lenientOptional(.cutoffLocal)
        }
    }

    struct Dates: Decodable, Sendable {
        let arrivalFrom: String?
        let arrivalTo: String?

        enum CodingKeys: String, CodingKey { case arrivalFrom, arrivalTo }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            arrivalFrom = c.lenientOptional(.arrivalFrom)
            arrivalTo = c.lenientOptional(.arrivalTo)
        }
    }

    struct Option: Decodable, Sendable {
        let service: String
        let label: String
        let available: Bool
        let free: Bool
        let price: Money?
        /// Business days in transit, [min, max].
        let transit: [Int]
        let estimate: Dates?

        enum CodingKeys: String, CodingKey { case service, label, available, free, price, transit, estimate }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            service = c.lenient(.service, "standard")
            label = c.lenient(.label, "")
            available = c.lenient(.available, false)
            free = c.lenient(.free, false)
            price = c.lenientOptional(.price)
            transit = c.lenient(.transit, [])
            estimate = c.lenientOptional(.estimate)
        }
    }

    let brand: Brand?
    /// Business days to pack and hand over, [min, max].
    let handling: [Int]
    let options: [Option]
    let unavailable: Bool
    let reason: String?
    let cutoffAt: String?

    enum CodingKeys: String, CodingKey { case brand, handling, options, unavailable, reason, cutoffAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brand = c.lenientOptional(.brand)
        handling = c.lenient(.handling, [])
        options = c.lenient(.options, [])
        unavailable = c.lenient(.unavailable, false)
        reason = c.lenientOptional(.reason)
        cutoffAt = c.lenientOptional(.cutoffAt)
    }

    /// Parcel options that can be chosen (pickup left out), as the website's `parcel()`.
    var parcelOptions: [Option] { options.filter { $0.available && $0.service != "pickup" } }
    /// Standard, else the first parcel option.
    var standard: Option? { parcelOptions.first { $0.service == "standard" } ?? parcelOptions.first }
    var express: Option? { parcelOptions.first { $0.service == "express" } }
}

/// GET /api/wishlist/back-in-stock/{variantId}.
struct ProductBackInStockWatch: Decodable, Sendable {
    let variantId: String
    let watching: Bool

    enum CodingKeys: String, CodingKey { case variantId, watching }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        variantId = c.lenient(.variantId, "")
        watching = c.lenient(.watching, false)
    }
}

/// POST /api/wishlist/back-in-stock body.
struct ProductBackInStockBody: Encodable, Sendable {
    let variantId: String
}

/// Formatting helpers that port src/lib/shipping/format.ts.
enum ProductShippingFormat {
    /// "1–3 business days", "1 business day", "the same business day".
    static func businessDays(_ range: [Int]) -> String? {
        guard range.count == 2 else { return nil }
        let a = range[0]
        let b = range[1]
        if b <= 0 { return "the same business day" }
        if a == b { return "\(a) business \(a == 1 ? "day" : "days")" }
        return "\(a)–\(b) business days"
    }

    private static let dayMonth: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEE d MMM"
        return f
    }()

    private static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEE d"
        return f
    }()

    private static let monthOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM"
        return f
    }()

    private static func parseDay(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(s.prefix(10)))
    }

    /// "Tue 18 – Fri 21 Nov" (same month) or "Fri 28 Nov – Tue 2 Dec".
    static func range(from: String, to: String) -> String? {
        guard let a = parseDay(from), let b = parseDay(to) else { return nil }
        if from.prefix(10) == to.prefix(10) { return dayMonth.string(from: a) }
        if from.prefix(7) == to.prefix(7) {
            return "\(dayOnly.string(from: a)) – \(dayOnly.string(from: b)) \(monthOnly.string(from: b))"
        }
        return "\(dayMonth.string(from: a)) – \(dayMonth.string(from: b))"
    }
}
