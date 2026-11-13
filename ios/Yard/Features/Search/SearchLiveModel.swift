import Foundation
import Observation

/// Type-ahead state for the Search tab: the live brand/product matches for what is typed (like the
/// website's search overlay: /api/search with limit 6 after a short debounce, 2+ characters), and
/// the marketplace categories (for "Try" chips and on-device category matches).
@Observable
@MainActor
final class SearchLiveModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    /// The term the current results (or error) belong to.
    private(set) var term: String = ""
    private(set) var phase: Phase = .idle
    private(set) var products: [SearchItem] = []
    private(set) var brands: [SearchBrandHit] = []
    private(set) var total: Int = 0

    /// Live categories (with public product counts). Empty until loaded or if it fails.
    private(set) var categories: [SearchCategory] = []
    private var categoriesLoaded = false

    /// Previews only: never touch the network.
    var skipsNetwork = false

    init() {}

    /// Minimum characters before searching the marketplace (matches the website).
    static let minimumLength = 2

    /// "Try" chips: the categories that hold public pieces, most first, so each one finds something.
    var tries: [SearchCategory] {
        categories
            .filter { ($0.productCount ?? 0) > 0 }
            .sorted { ($0.productCount ?? 0) > ($1.productCount ?? 0) }
            .prefix(6)
            .map { $0 }
    }

    /// Categories whose name contains the term (on device).
    func matchingCategories(_ term: String) -> [SearchCategory] {
        let needle = term.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        return categories
            .filter { $0.name.lowercased().contains(needle) }
            .prefix(3)
            .map { $0 }
    }

    func loadCategories() async {
        guard !categoriesLoaded, !skipsNetwork else { return }
        do {
            let response = try await APIClient.shared.get("/api/catalog/categories", as: SearchCategoriesResponse.self)
            categories = response.categories
            categoriesLoaded = true
        } catch {
            // Categories only add chips; Search works without them.
        }
    }

    /// Clears results (field emptied or below the minimum length).
    func reset() {
        term = ""
        phase = .idle
        products = []
        brands = []
        total = 0
    }

    /// Searches `rawTerm`. Call from `.task(id:)` after the debounce so typing cancels stale calls.
    func search(_ rawTerm: String, currency: String) async {
        let trimmed = rawTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= Self.minimumLength else {
            reset()
            return
        }
        guard !skipsNetwork else { return }
        if term != trimmed {
            term = trimmed
            products = []
            brands = []
            total = 0
        }
        phase = .loading
        do {
            let response = try await APIClient.shared.get(
                "/api/search",
                query: [
                    URLQueryItem(name: "q", value: trimmed),
                    URLQueryItem(name: "currency", value: currency),
                    URLQueryItem(name: "limit", value: "6"),
                ],
                as: SearchResponse.self
            )
            guard !Task.isCancelled, term == trimmed else { return }
            products = response.items
            brands = response.brands
            total = response.total
            phase = .loaded
        } catch {
            if Task.isCancelled || term != trimmed { return }
            if let apiError = error as? APIError, apiError.isCancelled { return }
            phase = .failed(SearchLiveModel.message(for: error))
        }
    }

    static func message(for error: Error) -> String {
        let message = APIError.message(for: error)
        return message.isEmpty ? "Search couldn't be loaded." : message
    }

    /// Previews only.
    static func preview(term: String, products: [SearchItem], brands: [SearchBrandHit], categories: [SearchCategory]) -> SearchLiveModel {
        let model = SearchLiveModel()
        model.skipsNetwork = true
        model.term = term
        model.products = products
        model.brands = brands
        model.total = products.count
        model.categories = categories
        model.categoriesLoaded = true
        model.phase = term.isEmpty ? .idle : .loaded
        return model
    }
}
