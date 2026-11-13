import SwiftUI
import Observation

// The category index (website: /categories). Big photo cards, one per category, with live
// piece/brand counts from GET /api/catalog/categories, then a "Shop everything" call to action.

@Observable
@MainActor
final class CategoriesModel {
    enum Phase {
        case loading
        case loaded
        case failed(Error)
    }

    var categories: [ShopCategory] = []
    var phase: Phase = .loading
    /// False for previews (fixed data, no network).
    private let fetches: Bool

    init(categories: [ShopCategory]? = nil) {
        if let categories {
            self.categories = categories
            self.phase = .loaded
            self.fetches = false
        } else {
            self.fetches = true
        }
    }

    func load(force: Bool = false) async {
        guard fetches else { return }
        if categories.isEmpty, let cached = ShopCategoryCache.shared.current, !force {
            categories = cached
            phase = .loaded
        }
        if categories.isEmpty { phase = .loading }
        do {
            let fresh = try await ShopCategoryCache.shared.categories(force: force)
            categories = fresh
            phase = .loaded
        } catch {
            if error is CancellationError || (error as? APIError)?.isCancelled == true { return }
            if categories.isEmpty { phase = .failed(error) }
        }
    }
}

@MainActor
struct CategoriesView: View {
    @State private var model: CategoriesModel
    @Environment(Router.self) private var router

    init() {
        _model = State(initialValue: CategoriesModel())
    }

    /// Previews only: start with fixed categories (no network).
    init(previewCategories: [ShopCategory]) {
        _model = State(initialValue: CategoriesModel(categories: previewCategories))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                header
                content
            }
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .yardScreenBackground()
        .navigationTitle("Categories")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load(force: true) }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Categories")
                .yardDisplay(52)
                .foregroundStyle(Color.yard.ink)
            Text(subtitle)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    private var subtitle: String {
        let lead = model.categories.isEmpty ? "" : "\(model.categories.count) ways into the catalogue. "
        return lead + "Every category is made up of small, independent studios, never resellers."
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            CategoriesSkeleton()
        case .failed(let error):
            EmptyState.error(error) { await model.load(force: true) }
                .frame(minHeight: 360)
        case .loaded:
            if model.categories.isEmpty {
                EmptyState(
                    title: "No categories yet",
                    message: "Brands are joining Yard. Browse everything at once in the shop.",
                    systemImage: "square.grid.2x2",
                    actionTitle: "Shop everything",
                    action: { router.push(.shop) }
                )
                .frame(minHeight: 360)
            } else {
                mosaic
                shopEverything
            }
        }
    }

    /// Rows of one wide card then two half cards, repeating, so the composition holds as
    /// categories are added (the website's phone mosaic).
    private var mosaic: some View {
        let rows = CategoriesView.rows(for: model.categories)
        return VStack(spacing: Spacing.s) {
            ForEach(rows) { row in
                switch row.kind {
                case .wide(let index):
                    card(index: index, height: 260, wide: true)
                case .pair(let left, let right):
                    HStack(spacing: Spacing.s) {
                        card(index: left, height: 230, wide: false)
                        if let right {
                            card(index: right, height: 230, wide: false)
                        } else {
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    private func card(index: Int, height: CGFloat, wide: Bool) -> some View {
        let category = model.categories[index]
        return NavigationLink(value: Route.category(slug: category.slug)) {
            CategoryCard(category: category, index: index, wide: wide)
                .frame(height: height)
        }
        .buttonStyle(PressableButtonStyle())
    }

    private var shopEverything: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Rectangle()
                .fill(Color.yard.line)
                .frame(height: 1)
                .padding(.bottom, Spacing.s)
            Text("Not sure where to start?")
                .font(.yardTitle)
                .foregroundStyle(Color.yard.ink)
            Text("Browse everything at once, then narrow by category, stock or price.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
            YardButton("Shop everything", systemImage: "arrow.right") {
                router.push(.shop)
            }
            .padding(.top, Spacing.xs)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.l)
    }

    // MARK: Layout

    struct MosaicRow: Identifiable {
        enum Kind {
            case wide(Int)
            case pair(Int, Int?)
        }

        let id: Int
        let kind: Kind
    }

    static func rows(for categories: [ShopCategory]) -> [MosaicRow] {
        var rows: [MosaicRow] = []
        var i = 0
        var wideNext = true
        while i < categories.count {
            if wideNext {
                rows.append(MosaicRow(id: i, kind: .wide(i)))
                i += 1
            } else {
                let right: Int? = i + 1 < categories.count ? i + 1 : nil
                rows.append(MosaicRow(id: i, kind: .pair(i, right)))
                i += 2
            }
            wideNext.toggle()
        }
        return rows
    }
}

// MARK: - Category card

/// A photo card: the category image, a bottom scrim, "01", the name in display type and the live count.
struct CategoryCard: View {
    let category: ShopCategory
    let index: Int
    var wide: Bool = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.yard.surface2
            RemoteImage(url: category.imageURL, maxPixelSize: wide ? 1200 : 700)
            LinearGradient(
                colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.15), Color.yard.scrim.opacity(0.72)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(String(format: "%02d", index + 1))
                    .font(.yardDisplay(15))
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.onPhoto)
                Text(category.name)
                    .yardDisplay(wide ? 44 : 32)
                    .foregroundStyle(Color.yard.onPhoto)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if wide, !category.description.isEmpty {
                    Text(category.description)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                        .lineLimit(2)
                }
                Text(category.countText)
                    .font(.yardCaptionEmphasis)
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                    .lineLimit(1)
            }
            .padding(Spacing.l)
        }
        .overlay(alignment: .topTrailing) {
            Image(systemName: "arrow.up.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 36, height: 36)
                .background(.ultraThinMaterial, in: Circle())
                .padding(Spacing.m)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
        .clipShape(.yardCard)
        .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(category.name), \(category.countText)"))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Skeleton

private struct CategoriesSkeleton: View {
    var body: some View {
        VStack(spacing: Spacing.s) {
            Skeleton(cornerRadius: Radius.card).frame(height: 260)
            HStack(spacing: Spacing.s) {
                Skeleton(cornerRadius: Radius.card).frame(height: 230)
                Skeleton(cornerRadius: Radius.card).frame(height: 230)
            }
            Skeleton(cornerRadius: Radius.card).frame(height: 260)
        }
        .padding(.horizontal, Spacing.gutter)
    }
}

// MARK: - Previews

private let categoriesPreviewFixtures: [ShopCategory] = [
    ShopCategory(slug: "fashion", name: "Fashion", description: "Tailoring, dresses and knitwear from independent designers.", subcategories: ["Outerwear", "Shirts"], productCount: 42, brandCount: 9),
    ShopCategory(slug: "streetwear", name: "Streetwear", description: "Heavyweight basics, graphics and outerwear.", subcategories: ["Hoodies"], productCount: 18, brandCount: 4),
    ShopCategory(slug: "sneakers", name: "Sneakers", productCount: 0, brandCount: 0),
    ShopCategory(slug: "accessories", name: "Accessories", description: "Bags, headwear, eyewear.", productCount: 1, brandCount: 1),
    ShopCategory(slug: "jewelry", name: "Jewelry", productCount: 7, brandCount: 2),
]

#Preview("CategoriesView — dark") {
    NavigationStack { CategoriesView(previewCategories: categoriesPreviewFixtures) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CategoriesView — light") {
    NavigationStack { CategoriesView(previewCategories: categoriesPreviewFixtures) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
