import Foundation
import CoreLocation
import MapKit
import Observation

/// Loads every public place once (`scope=world`, the server's coarse-by-design read; the
/// response is CDN-cached), then filters to the visible map region and sorts by distance on the
/// device. The phone's location never leaves it.
@Observable
@MainActor
final class AroundViewModel {
    enum Phase {
        case idle
        case loading
        case loaded
        case failed(Error)
    }

    private(set) var places: [AroundPlace] = []
    private(set) var phase: Phase = .idle
    /// Brand logos by brand id, from the public brand directory (best effort; monograms otherwise).
    private(set) var logos: [String: URL] = [:]

    @ObservationIgnored private var logosLoaded = false
    /// A world-list fetch is running (independent of `phase`, which stays .loaded on refreshes).
    @ObservationIgnored private var inFlight = false

    init() {}

    /// Preview / fixture initialiser.
    init(places: [AroundPlace]) {
        self.places = places
        self.phase = .loaded
    }

    var isLoading: Bool {
        if case .loading = phase { return true }
        return false
    }

    var error: Error? {
        if case .failed(let e) = phase { return e }
        return nil
    }

    var hasLoaded: Bool {
        if case .loaded = phase { return true }
        return false
    }

    func place(_ id: String) -> AroundPlace? { places.first { $0.id == id } }

    func logoURL(for place: AroundPlace) -> URL? { logos[place.brand.id] }

    // MARK: Loading

    func load() async {
        if inFlight || isLoading { return }
        inFlight = true
        defer { inFlight = false }
        if places.isEmpty { phase = .loading }
        do {
            let res = try await APIClient.shared.get(
                "/api/around/places",
                query: [URLQueryItem(name: "scope", value: "world")],
                as: AroundPlacesResponse.self
            )
            places = res.places
            phase = .loaded
            await loadLogos()
        } catch {
            if places.isEmpty {
                phase = .failed(error)
            } else {
                // Keep what's on the map; a refresh failure isn't worth blanking it.
                phase = .loaded
            }
        }
    }

    /// Logos for the brands on the map: the public directory, up to three pages of 60.
    private func loadLogos() async {
        guard !logosLoaded, !places.isEmpty else { return }
        logosLoaded = true
        let wanted = Set(places.map { $0.brand.id })
        var found: [String: URL] = [:]
        var offset: Int? = 0
        var pages = 0
        while let current = offset, pages < 3, found.count < wanted.count {
            pages += 1
            guard let page = try? await APIClient.shared.get(
                "/api/catalog/brands",
                query: [
                    URLQueryItem(name: "limit", value: "60"),
                    URLQueryItem(name: "offset", value: String(current)),
                ],
                as: BrandsPage.self
            ) else { break }
            for b in page.brands where wanted.contains(b.id) {
                if let url = b.logoURL { found[b.id] = url }
            }
            offset = page.nextOffset
        }
        if !found.isEmpty { logos = found }
    }

    // MARK: Filtering and sorting

    /// Places inside `region` (all of them when the region is unknown), nearest first from
    /// `origin` (the shopper, else the map centre).
    func visiblePlaces(in region: MKCoordinateRegion?, from origin: CLLocation?) -> [AroundPlace] {
        var list = places
        if let region {
            list = list.filter { AroundViewModel.contains(region, $0.coordinate) }
        }
        let ref: CLLocation? = origin ?? region.map { CLLocation(latitude: $0.center.latitude, longitude: $0.center.longitude) }
        guard let ref else { return list.sorted { $0.brand.name.localizedCaseInsensitiveCompare($1.brand.name) == .orderedAscending } }
        return list.sorted { $0.location.distance(from: ref) < $1.location.distance(from: ref) }
    }

    static func contains(_ region: MKCoordinateRegion, _ c: CLLocationCoordinate2D) -> Bool {
        let halfLat = region.span.latitudeDelta / 2
        let halfLng = region.span.longitudeDelta / 2
        let dLat = abs(c.latitude - region.center.latitude)
        var dLng = abs(c.longitude - region.center.longitude)
        if dLng > 180 { dLng = 360 - dLng }
        return dLat <= halfLat && dLng <= halfLng
    }

    // MARK: Search

    /// Places whose city, neighbourhood, country or brand matches the text (accents ignored).
    func matches(_ query: String) -> [AroundPlace] {
        let q = AroundViewModel.fold(query)
        guard !q.isEmpty else { return [] }
        let byArea = places.filter { p in
            AroundViewModel.fold(p.city).contains(q)
                || AroundViewModel.fold(p.citySlug.replacingOccurrences(of: "-", with: " ")).contains(q)
                || AroundViewModel.fold(p.neighbourhood ?? "").contains(q)
                || AroundViewModel.fold(AroundCountry.name(p.country)) == q
        }
        if !byArea.isEmpty { return byArea }
        return places.filter { AroundViewModel.fold($0.brand.name).contains(q) || AroundViewModel.fold($0.name).contains(q) }
    }

    /// Where to fly for a search: matching places first, else Apple's geocoder for any city.
    func region(forSearch query: String) async -> MKCoordinateRegion? {
        let hits = matches(query)
        if !hits.isEmpty { return AroundViewModel.region(fitting: hits.map { $0.coordinate }) }
        let geocoder = CLGeocoder()
        guard let marks = try? await geocoder.geocodeAddressString(query), let mark = marks.first, let loc = mark.location else {
            return nil
        }
        var radius: Double = 15_000
        if let circle = mark.region as? CLCircularRegion {
            radius = min(max(circle.radius, 2_000), 400_000)
        }
        return MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: radius * 2, longitudinalMeters: radius * 2)
    }

    static func region(fitting coords: [CLLocationCoordinate2D]) -> MKCoordinateRegion? {
        guard let first = coords.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude
        var minLng = first.longitude, maxLng = first.longitude
        for c in coords {
            minLat = min(minLat, c.latitude)
            maxLat = max(maxLat, c.latitude)
            minLng = min(minLng, c.longitude)
            maxLng = max(maxLng, c.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: min(170, max(0.04, (maxLat - minLat) * 1.6)),
            longitudeDelta: min(350, max(0.04, (maxLng - minLng) * 1.6))
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
