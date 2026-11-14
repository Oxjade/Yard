import Foundation
import Observation

/// The board the shopper is looking at (the website keeps the same fields in the URL).
struct ChartsQuery: Equatable, Hashable, Sendable {
    var chart: ChartSlug = .top
    var period: ChartPeriod = .weekly
    var category: String? = nil
    var country: String? = nil
    var city: String? = nil

    /// Query items in the website's fixed order (`boardPath` in src/lib/api/charts.ts).
    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "chart", value: chart.rawValue),
            URLQueryItem(name: "period", value: period.rawValue),
        ]
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if let city {
            items.append(URLQueryItem(name: "city", value: city))
        } else if let country {
            items.append(URLQueryItem(name: "country", value: country))
        }
        return items
    }

    /// Number of filters set (City charts' city is part of the board, not a filter).
    var filterCount: Int {
        (category != nil ? 1 : 0) + ((city != nil || country != nil) && chart != .city ? 1 : 0)
    }
}

/// Loads the live board and the scopes; keeps the board fresh while the screen is visible.
@Observable
@MainActor
final class ChartsViewModel {
    var query: ChartsQuery
    /// The board for `query` (never another board's answer under the new name).
    private(set) var board: ChartBoard?
    private(set) var scopes: ChartScopes?
    private(set) var isLoading: Bool = false
    /// A load of a board we don't have yet failed.
    private(set) var error: Error?
    /// A refresh of the board on screen failed; the board stays with a quiet note.
    private(set) var refreshFailed: Bool = false
    /// City charts with no city chosen: the shopper's default city (applied to the request only).
    private(set) var defaultCity: String?

    private var loadedFor: ChartsQuery?
    private var generation: Int = 0

    init(query: ChartsQuery = ChartsQuery()) {
        self.query = query
    }

    /// The query actually sent (City charts with no city use the shopper's default city).
    var effectiveQuery: ChartsQuery {
        var q = query
        if q.chart == .city, q.city == nil, let defaultCity {
            q.city = defaultCity
            q.country = nil
        }
        return q
    }

    /// The board on screen, only while it is the board the query asks for.
    var currentBoard: ChartBoard? {
        loadedFor == effectiveQuery ? board : nil
    }

    var minCohort: Int { scopes?.minCohort ?? 3 }

    // MARK: Loading

    func loadScopes() async {
        if scopes != nil { return }
        do {
            scopes = try await APIClient.shared.get("/api/charts/scopes", as: ChartScopes.self)
        } catch {
            // Filters stay limited to "Everywhere"; the board still loads.
        }
    }

    /// Loads the board for the current query. Reloading the board already on screen (pull to
    /// refresh, the refresh loop) keeps it there: no skeleton, and a failure only sets `refreshFailed`.
    func load() async {
        let q = effectiveQuery
        generation += 1
        let gen = generation
        let sameBoard = loadedFor == q && board != nil
        if !sameBoard {
            isLoading = true
            error = nil
        }
        do {
            let b = try await APIClient.shared.get("/api/charts", query: q.queryItems, as: ChartBoard.self)
            guard gen == generation else { return }
            board = b
            loadedFor = q
            error = nil
            refreshFailed = false
        } catch {
            guard gen == generation else { return }
            if let api = error as? APIError, api.isCancelled { isLoading = false; return }
            if error is CancellationError { isLoading = false; return }
            if sameBoard {
                refreshFailed = true
            } else {
                self.error = error
            }
        }
        isLoading = false
    }

    /// Applies a new board/period/filter choice. The view's `.task(id: effectiveQuery)` loads it.
    func apply(_ next: ChartsQuery) {
        var n = next
        // City charts take a city, never a country.
        if n.chart == .city { n.country = nil }
        guard n != query else { return }
        query = n
    }

    /// Picks the shopper's default city for City charts: the ship-to city when it has a chart,
    /// else the largest charted city in the ship-to country. Nil lets the server choose (largest cohort).
    func resolveDefaultCity(shipToCity: String?, shipToCountry: String?) {
        guard let scopes else { defaultCity = nil; return }
        let charted = scopes.cities.filter { $0.eligible >= scopes.minCohort }
        if let name = shipToCity?.trimmingCharacters(in: .whitespaces), !name.isEmpty,
           let match = charted.first(where: { $0.name.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) {
            defaultCity = match.slug
            return
        }
        if let country = shipToCountry?.uppercased(),
           let best = charted.filter({ $0.country.uppercased() == country }).max(by: { $0.eligible < $1.eligible }) {
            defaultCity = best.slug
            return
        }
        defaultCity = nil
    }

    // MARK: Words

    /// "Everywhere", "Lagos", "Streetwear in Nigeria", "Streetwear, everywhere".
    func whereWords() -> String? {
        let place: String?
        let category: String?
        if let b = currentBoard {
            place = b.scope.city?.name ?? b.scope.country?.name
            category = b.scope.category?.label
        } else {
            let q = effectiveQuery
            if let city = q.city {
                place = scopes?.cities.first(where: { $0.slug == city })?.name
            } else if let country = q.country {
                place = scopes?.countries.first(where: { $0.code == country })?.name
            } else {
                place = nil
            }
            category = q.category.flatMap { slug in scopes?.categories.first(where: { $0.slug == slug })?.label }
        }
        if let category, let place { return "\(category) in \(place)" }
        if let category { return "\(category), everywhere" }
        if let place { return place }
        return query.chart == .city ? nil : "Everywhere"
    }

    /// The location pill's title.
    var locationTitle: String {
        let q = effectiveQuery
        if let city = q.city {
            return currentBoard?.scope.city?.name ?? scopes?.cities.first(where: { $0.slug == city })?.name ?? "City"
        }
        if let country = q.country {
            return scopes?.countries.first(where: { $0.code == country })?.name ?? country
        }
        if q.chart == .city {
            return currentBoard?.scope.city?.name ?? "Choose a city"
        }
        return "Everywhere"
    }
}
