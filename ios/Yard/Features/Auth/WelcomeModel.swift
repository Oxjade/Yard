import Foundation
import Observation
import SwiftUI

/// A marketplace category for the Welcome picks (GET /api/catalog/categories →
/// `{ categories: [{ slug, name, description, imagePath, subcategories, productCount, brandCount }] }`).
struct WelcomeCategory: Decodable, Identifiable, Hashable, Sendable {
    let slug: String
    let name: String
    let imagePath: String?

    var id: String { slug }
    var imageURL: URL? { Config.url(for: imagePath) }

    init(slug: String, name: String, imagePath: String? = nil) {
        self.slug = slug
        self.name = name
        self.imagePath = imagePath
    }

    enum CodingKeys: String, CodingKey { case slug, name, imagePath }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = c.lenient(.name, slug)
        imagePath = c.lenientOptional(.imagePath)
    }
}

struct WelcomeCategoriesResponse: Decodable, Sendable {
    let categories: [WelcomeCategory]

    enum CodingKeys: String, CodingKey { case categories }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        categories = c.lenient(.categories, [WelcomeCategory]())
    }
}

/// The looks (src/lib/data/index.ts `aestheticLabels`): fixed on the website too.
struct WelcomeLook: Identifiable, Hashable, Sendable {
    let slug: String
    let label: String
    var id: String { slug }

    static let all: [WelcomeLook] = [
        WelcomeLook(slug: "minimalist", label: "Minimalist"),
        WelcomeLook(slug: "vintage", label: "Vintage"),
        WelcomeLook(slug: "avant-garde", label: "Avant-garde"),
        WelcomeLook(slug: "streetwear", label: "Streetwear"),
        WelcomeLook(slug: "contemporary", label: "Contemporary"),
        WelcomeLook(slug: "luxury", label: "Luxury"),
        WelcomeLook(slug: "experimental", label: "Experimental"),
    ]
}

/// Data for WelcomeView: categories (step 1) and brand suggestions (step 3).
@Observable
@MainActor
final class WelcomeModel {
    private(set) var categories: [WelcomeCategory] = []
    private(set) var categoriesLoading: Bool = false
    private(set) var categoriesLoaded: Bool = false
    private(set) var categoriesError: APIError?

    /// nil while loading (or before step 3 opens); fixed once loaded so following doesn't reshuffle.
    private(set) var suggestions: [BrandCard]?

    init() {}

    init(previewCategories: [WelcomeCategory], suggestions: [BrandCard]?) {
        categories = previewCategories
        categoriesLoaded = true
        self.suggestions = suggestions
    }

    func loadCategories() async {
        guard !categoriesLoading else { return }
        categoriesLoading = true
        defer { categoriesLoading = false }
        do {
            let response = try await APIClient.shared.get("/api/catalog/categories", as: WelcomeCategoriesResponse.self)
            categories = response.categories
            categoriesError = nil
            categoriesLoaded = true
        } catch let error as APIError {
            if !error.isCancelled { categoriesError = error }
        } catch {
            categoriesError = APIError.network(error)
        }
    }

    /// Up to six listed brands, newest first, those in the picked categories first (the website's
    /// `useLiveSuggestions`): GET /api/catalog/brands?category=&sort=new&limit=6 for up to three
    /// categories, then GET /api/catalog/brands?sort=new&limit=12 to fill.
    func loadSuggestions(categories picked: [String]) async {
        guard suggestions == nil else { return }
        var out: [BrandCard] = []
        do {
            for category in picked.prefix(3) {
                let page = try await APIClient.shared.get(
                    "/api/catalog/brands",
                    query: [
                        URLQueryItem(name: "category", value: category),
                        URLQueryItem(name: "sort", value: "new"),
                        URLQueryItem(name: "limit", value: "6"),
                    ],
                    as: BrandsPage.self
                )
                for brand in page.brands where out.count < 6 && !out.contains(where: { $0.id == brand.id }) {
                    out.append(brand)
                }
            }
            if out.count < 6 {
                let page = try await APIClient.shared.get(
                    "/api/catalog/brands",
                    query: [
                        URLQueryItem(name: "sort", value: "new"),
                        URLQueryItem(name: "limit", value: "12"),
                    ],
                    as: BrandsPage.self
                )
                for brand in page.brands where out.count < 6 && !out.contains(where: { $0.id == brand.id }) {
                    out.append(brand)
                }
            }
            suggestions = out
        } catch {
            // Like the website: no suggestions rather than an error on an optional step.
            suggestions = out
        }
    }
}

/// A simple wrapping row layout for pick chips.
struct WelcomeFlowLayout: Layout {
    var spacing: CGFloat = Spacing.s

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let width = min(size.width, maxWidth)
            if x > 0 && x + width > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        let finalWidth: CGFloat = proposal.width ?? widest
        return CGSize(width: finalWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let width = min(size.width, bounds.width)
            if x > bounds.minX && x + width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: width, height: size.height))
            x += width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
