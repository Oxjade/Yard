import Foundation
import CoreLocation

// YARD Around models (website: src/lib/api/contracts/around.ts, src/server/around/dto.ts).
//
//   GET /api/around/places?scope=world            → AroundPlacesResponse { places, scope }
//   GET /api/around/places/{id}                   → AroundPlaceDetailResponse { place }
//
// Everything is decoded leniently so one odd field never blanks the map.

/// The four kinds of place (`LOCATION_KINDS`).
enum AroundPlaceKind: String, Sendable, Hashable, CaseIterable {
    case store, showroom, popup, exhibition

    var label: String {
        switch self {
        case .store: return "Store"
        case .showroom: return "Showroom"
        case .popup: return "Pop-up"
        case .exhibition: return "Exhibition"
        }
    }

    var plural: String {
        switch self {
        case .store: return "Stores"
        case .showroom: return "Showrooms"
        case .popup: return "Pop-ups"
        case .exhibition: return "Exhibitions"
        }
    }

    /// Pop-ups and exhibitions run between dates; stores and showrooms have opening hours.
    var isDated: Bool { self == .popup || self == .exhibition }

    var systemImage: String {
        switch self {
        case .store: return "storefront"
        case .showroom: return "hanger"
        case .popup: return "sparkles"
        case .exhibition: return "photo.on.rectangle"
        }
    }
}

/// Event kinds (`LOCATION_EVENT_KINDS`).
enum AroundEventKind: String, Sendable, Hashable {
    case dropLaunch = "drop_launch"
    case promotion
    case exhibition
    case talk
    case sale
    case popupDay = "popup_day"
    case other

    var label: String {
        switch self {
        case .dropLaunch: return "Drop launch"
        case .promotion: return "Promotion"
        case .exhibition: return "Exhibition"
        case .talk: return "Talk"
        case .sale: return "Sale"
        case .popupDay: return "Pop-up day"
        case .other: return "Event"
        }
    }
}

struct AroundBrand: Decodable, Hashable, Sendable {
    let id: String
    let handle: String
    let name: String
    let verified: Bool

    init(id: String, handle: String, name: String, verified: Bool = false) {
        self.id = id
        self.handle = handle
        self.name = name
        self.verified = verified
    }

    enum CodingKeys: String, CodingKey { case id, handle, name, verified }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, id)
        name = c.lenient(.name, "A Yard brand")
        verified = c.lenient(.verified, false)
    }
}

struct AroundImage: Decodable, Hashable, Sendable {
    let src: String
    let alt: String
    let width: Double?
    let height: Double?

    var url: URL? { Config.url(for: src) }

    init(src: String, alt: String = "", width: Double? = nil, height: Double? = nil) {
        self.src = src
        self.alt = alt
        self.width = width
        self.height = height
    }

    enum CodingKeys: String, CodingKey { case src, alt, width, height }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = c.lenient(.src, "")
        alt = c.lenient(.alt, "")
        width = c.lenientOptional(.width)
        height = c.lenientOptional(.height)
    }
}

/// Weekly opening hours: day key ("mon"…"sun") → ranges of ["10:00", "19:00"]. A missing or
/// null day is closed.
struct AroundHours: Decodable, Hashable, Sendable {
    static let dayKeys: [String] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    static let dayLabels: [String: String] = ["mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"]
    static let dayShort: [String: String] = ["mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"]

    let days: [String: [[String]]]

    init(days: [String: [[String]]]) {
        self.days = days
    }

    struct DayKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: DayKey.self)
        var out: [String: [[String]]] = [:]
        for key in AroundHours.dayKeys {
            guard let k = DayKey(stringValue: key) else { continue }
            let ranges: [[String]]? = c.lenientOptional(k, as: [[String]].self)
            if let ranges {
                out[key] = ranges.filter { $0.count == 2 }
            }
        }
        days = out
    }

    func ranges(_ day: String) -> [[String]] { days[day] ?? [] }

    var hasAny: Bool { AroundHours.dayKeys.contains { !ranges($0).isEmpty } }

    /// "10:00–19:00", "10:00–14:00, 15:00–19:00" or "Closed".
    func label(_ day: String) -> String {
        let r = ranges(day)
        if r.isEmpty { return "Closed" }
        return r.map { "\($0[0])–\($0[1])" }.joined(separator: ", ")
    }
}

struct AroundNextEvent: Decodable, Hashable, Sendable {
    let id: String
    let title: String
    let startsAt: String
    let endsAt: String

    enum CodingKeys: String, CodingKey { case id, title, startsAt, endsAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(.id, "")
        title = c.lenient(.title, "")
        startsAt = c.lenient(.startsAt, "")
        endsAt = c.lenient(.endsAt, "")
    }

    init(id: String, title: String, startsAt: String, endsAt: String) {
        self.id = id
        self.title = title
        self.startsAt = startsAt
        self.endsAt = endsAt
    }
}

/// A place on the map and in the list (`PlaceSummaryDto`).
struct AroundPlace: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let brand: AroundBrand
    let brandCategory: String
    let kind: AroundPlaceKind
    let name: String
    let neighbourhood: String?
    let city: String
    let citySlug: String
    let country: String
    let lat: Double
    let lng: Double
    /// "street" (exact pin) or "area".
    let pinPrecision: String
    let timeZone: String
    let hours: AroundHours?
    let byAppointment: Bool
    let startsAt: String?
    let endsAt: String?
    let image: AroundImage?
    let nextEvent: AroundNextEvent?
    let offer: Bool
    let sample: Bool

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
    var location: CLLocation { CLLocation(latitude: lat, longitude: lng) }

    /// "Ikoyi, Lagos" or "Lagos".
    var whereText: String {
        if let n = neighbourhood, !n.isEmpty { return "\(n), \(city)" }
        return city
    }

    /// "Streetwear · Store".
    var categoryKindText: String { "\(brandCategory) · \(kind.label)" }

    init(id: String, brand: AroundBrand, brandCategory: String = "Independent brand", kind: AroundPlaceKind, name: String, neighbourhood: String? = nil, city: String, citySlug: String = "", country: String = "", lat: Double, lng: Double, pinPrecision: String = "area", timeZone: String = "UTC", hours: AroundHours? = nil, byAppointment: Bool = false, startsAt: String? = nil, endsAt: String? = nil, image: AroundImage? = nil, nextEvent: AroundNextEvent? = nil, offer: Bool = false, sample: Bool = false) {
        self.id = id
        self.brand = brand
        self.brandCategory = brandCategory
        self.kind = kind
        self.name = name
        self.neighbourhood = neighbourhood
        self.city = city
        self.citySlug = citySlug
        self.country = country
        self.lat = lat
        self.lng = lng
        self.pinPrecision = pinPrecision
        self.timeZone = timeZone
        self.hours = hours
        self.byAppointment = byAppointment
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.image = image
        self.nextEvent = nextEvent
        self.offer = offer
        self.sample = sample
    }

    enum CodingKeys: String, CodingKey {
        case id, brand, brandCategory, kind, name, neighbourhood, city, citySlug, country, lat, lng, pinPrecision, timeZone, hours, byAppointment, startsAt, endsAt, image, nextEvent, offer, sample
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        brand = try c.decode(AroundBrand.self, forKey: .brand)
        brandCategory = c.lenient(.brandCategory, "Independent brand")
        let rawKind: String = c.lenient(.kind, "store")
        kind = AroundPlaceKind(rawValue: rawKind) ?? .store
        name = c.lenient(.name, "")
        neighbourhood = c.lenientOptional(.neighbourhood)
        city = c.lenient(.city, "")
        citySlug = c.lenient(.citySlug, "")
        country = c.lenient(.country, "")
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        pinPrecision = c.lenient(.pinPrecision, "area")
        timeZone = c.lenient(.timeZone, "UTC")
        hours = c.lenientOptional(.hours)
        byAppointment = c.lenient(.byAppointment, false)
        startsAt = c.lenientOptional(.startsAt)
        endsAt = c.lenientOptional(.endsAt)
        image = c.lenientOptional(.image)
        nextEvent = c.lenientOptional(.nextEvent)
        offer = c.lenient(.offer, false)
        sample = c.lenient(.sample, false)
    }
}

struct AroundPlacesResponse: Decodable, Sendable {
    let places: [AroundPlace]

    enum CodingKeys: String, CodingKey { case places }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Decode place by place so one malformed row is dropped, not the whole map.
        var list = try c.nestedUnkeyedContainer(forKey: .places)
        var out: [AroundPlace] = []
        while !list.isAtEnd {
            if let p = try? list.decode(AroundPlace.self) {
                out.append(p)
            } else if (try? list.decode(AroundSkip.self)) == nil {
                // Not an object either: stop rather than loop on an element we can't step past.
                break
            }
        }
        places = out
    }
}

/// Swallows one element of an unkeyed container.
private struct AroundSkip: Decodable {}

struct AroundDropRef: Decodable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
}

struct AroundEvent: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let kind: AroundEventKind
    let title: String
    let description: String?
    let startsAt: String
    let endsAt: String
    let drop: AroundDropRef?
    let promoText: String?
    let sample: Bool

    enum CodingKeys: String, CodingKey { case id, kind, title, description, startsAt, endsAt, drop, promoText, sample }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        let rawKind: String = c.lenient(.kind, "")
        kind = AroundEventKind(rawValue: rawKind) ?? .other
        title = c.lenient(.title, "")
        description = c.lenientOptional(.description)
        startsAt = c.lenient(.startsAt, "")
        endsAt = c.lenient(.endsAt, "")
        drop = c.lenientOptional(.drop)
        promoText = c.lenientOptional(.promoText)
        sample = c.lenient(.sample, false)
    }

    init(id: String, kind: AroundEventKind, title: String, description: String? = nil, startsAt: String, endsAt: String, drop: AroundDropRef? = nil, promoText: String? = nil, sample: Bool = false) {
        self.id = id
        self.kind = kind
        self.title = title
        self.description = description
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.drop = drop
        self.promoText = promoText
        self.sample = sample
    }
}

struct AroundFeaturedPrice: Decodable, Hashable, Sendable {
    let amount: Int
    let currency: String
}

struct AroundFeaturedProduct: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let price: AroundFeaturedPrice?
    let image: String?

    var imageURL: URL? { Config.url(for: image) }

    enum CodingKeys: String, CodingKey { case id, slug, name, price, image }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = c.lenient(.slug, id)
        name = c.lenient(.name, "")
        price = c.lenientOptional(.price)
        image = c.lenientOptional(.image)
    }
}

/// `PlaceDetailDto`: the summary plus address, description, photos, events and featured pieces.
struct AroundPlaceDetail: Decodable, Sendable {
    let summary: AroundPlace
    let addressLine: String
    let hoursNote: String?
    let description: String?
    let images: [AroundImage]
    let events: [AroundEvent]
    let featured: [AroundFeaturedProduct]

    enum CodingKeys: String, CodingKey { case addressLine, hoursNote, description, images, events, featured }

    init(from decoder: Decoder) throws {
        summary = try AroundPlace(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        addressLine = c.lenient(.addressLine, "")
        hoursNote = c.lenientOptional(.hoursNote)
        description = c.lenientOptional(.description)
        images = c.lenient(.images, [AroundImage]()).filter { !$0.src.isEmpty }
        events = c.lenient(.events, [AroundEvent]())
        featured = c.lenient(.featured, [AroundFeaturedProduct]())
    }

    init(summary: AroundPlace, addressLine: String, hoursNote: String? = nil, description: String? = nil, images: [AroundImage] = [], events: [AroundEvent] = [], featured: [AroundFeaturedProduct] = []) {
        self.summary = summary
        self.addressLine = addressLine
        self.hoursNote = hoursNote
        self.description = description
        self.images = images
        self.events = events
        self.featured = featured
    }
}

struct AroundPlaceDetailResponse: Decodable, Sendable {
    let place: AroundPlaceDetail
}

/// Country names the website shows (`countryNames` in place-detail.tsx).
enum AroundCountry {
    static let names: [String: String] = ["NG": "Nigeria", "GH": "Ghana", "KE": "Kenya", "ZA": "South Africa", "GB": "United Kingdom", "FR": "France", "DE": "Germany", "US": "United States", "MX": "Mexico", "JP": "Japan", "KR": "South Korea"]
    static func name(_ code: String) -> String { names[code] ?? code }
}
