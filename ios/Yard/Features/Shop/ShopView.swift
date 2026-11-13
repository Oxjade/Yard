import SwiftUI

// The shop listing (website: /shop, and /categories/{slug} when `category` is set).
// A product masonry under a sticky filter bar: category chips (whole shop only), subcategory
// chips, an "In stock" toggle and a sort menu (Newest / Price low–high / Price high–low).
// Infinite paging through GET /api/catalog/products (limit 24 + offset).

@MainActor
struct ShopView: View {
    let category: String?

    @State private var model: ShopListingModel
    @Environment(Router.self) private var router

    init(category: String?) {
        self.category = category
        _model = State(initialValue: ShopListingModel(category: category))
    }

    /// Previews only: fixed products, no network.
    init(previewCategory: String?, categories: [ShopCategory], products: [Product]) {
        self.category = previewCategory
        _model = State(initialValue: ShopListingModel(previewCategory: previewCategory, categories: categories, products: products))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                header
                    .padding(.bottom, Spacing.l)
                Section {
                    results
                        .padding(.top, Spacing.m)
                } header: {
                    ShopFilterBar(model: model)
                }
            }
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .yardScreenBackground()
        .navigationTitle(model.categoryName ?? "Shop")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.start() }
        .refreshable { await model.refresh() }
    }

    // MARK: Header

    @ViewBuilder
    private var header: some View {
        if model.fixedCategory != nil {
            categoryBanner
        } else {
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("Shop")
                    .yardDisplay(52)
                    .foregroundStyle(Color.yard.ink)
                Text("Explore published pieces from independent brands across Yard.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
        }
    }

    /// The category photograph with its name and description over it (website category banner).
    private var categoryBanner: some View {
        let cat = model.selectedCategory
        return ZStack(alignment: .bottomLeading) {
            Color.yard.surface2
            if let url = cat?.imageURL {
                RemoteImage(url: url, maxPixelSize: 1200)
            }
            LinearGradient(
                colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.2), Color.yard.scrim.opacity(0.75)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: Spacing.s) {
                Button {
                    router.push(.categories)
                } label: {
                    Label("All categories", systemImage: "chevron.left")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                }
                .buttonStyle(.plain)
                Text(model.categoryName ?? "")
                    .yardDisplay(48)
                    .foregroundStyle(Color.yard.onPhoto)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let description = cat?.description, !description.isEmpty {
                    Text(description)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.l)
        }
        .frame(height: 280)
        .frame(maxWidth: .infinity)
        .clipShape(.yardCard)
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        switch model.phase {
        case .loading:
            MasonrySkeleton(count: 8)
                .padding(.horizontal, Spacing.gridGap)
        case .failed(let error):
            EmptyState.error(error) { await model.reload() }
                .frame(minHeight: 360)
        case .loaded:
            if model.products.isEmpty {
                emptyState
                    .frame(minHeight: 360)
            } else {
                grid
            }
        }
    }

    private var grid: some View {
        let products = model.products
        let tailIds = Set(products.suffix(6).map { $0.id })
        return VStack(spacing: Spacing.xl) {
            MasonryGrid(products) { product in
                NavigationLink(value: Route.product(slug: product.slug)) {
                    ProductTile(product: product)
                }
                .buttonStyle(PressableButtonStyle())
                .onAppear {
                    if tailIds.contains(product.id) {
                        Task { @MainActor in await model.loadMore() }
                    }
                }
            }
            .padding(.horizontal, Spacing.gridGap)
            .opacity(model.isRefreshing ? 0.45 : 1)
            .animation(Motion.fade, value: model.isRefreshing)

            footer
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let message = model.loadMoreError {
            VStack(spacing: Spacing.s) {
                Text(message)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .multilineTextAlignment(.center)
                YardButton("Try again", style: .secondary, size: .small, fullWidth: false) {
                    Task { @MainActor in await model.loadMore() }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.gutter)
        } else if model.hasMore {
            ProgressView()
                .tint(Color.yard.ink2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.m)
                .onAppear { Task { @MainActor in await model.loadMore() } }
        } else {
            Text(endOfListText)
                .font(.yardCaption)
                .monospacedDigit()
                .foregroundStyle(Color.yard.ink3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.m)
        }
    }

    private var endOfListText: String {
        model.total > 1 ? "That's all \(Formatters.grouped(model.total)) pieces" : "That's the only piece"
    }

    /// Website `emptyAdvice`: an empty shelf (nothing filtered) vs. filters that hide everything.
    @ViewBuilder
    private var emptyState: some View {
        if model.panelFilterCount > 0 {
            EmptyState(
                title: "Nothing matches those filters",
                message: "Try removing one filter.",
                systemImage: "line.3.horizontal.decrease.circle",
                actionTitle: "Clear filters",
                action: { Task { @MainActor in await model.clearFilters() } }
            )
        } else {
            let shelf: String? = model.subcategory ?? model.categoryName
            VStack(spacing: Spacing.s) {
                EmptyState(
                    title: shelf.map { "No \($0.lowercased()) pieces yet" } ?? "No pieces yet",
                    message: "Brands are joining Yard. Their pieces appear here the day they open; follow along with upcoming drops.",
                    systemImage: "storefront",
                    actionTitle: "See upcoming drops",
                    action: { router.push(.drops) }
                )
                YardButton("Browse brands", style: .ghost, size: .small, fullWidth: false) {
                    router.push(.brandsDirectory)
                }
            }
        }
    }
}

// MARK: - Sticky filter bar

/// Pinned under the navigation bar: category chips (whole shop), subcategory chips,
/// then the piece count, the "In stock" toggle and the sort menu.
@MainActor
struct ShopFilterBar: View {
    let model: ShopListingModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if model.fixedCategory == nil, !model.categories.isEmpty {
                ChipRow {
                    Chip("All", isSelected: model.category == nil) {
                        Task { @MainActor in await model.selectCategory(nil) }
                    }
                    ForEach(model.categories) { cat in
                        Chip(cat.name, isSelected: model.category == cat.slug) {
                            Task { @MainActor in await model.selectCategory(cat.slug) }
                        }
                    }
                }
            }
            if !model.subcategories.isEmpty {
                ChipRow {
                    Chip(model.fixedCategory == nil ? "All" : "All \((model.categoryName ?? "").lowercased())", isSelected: model.subcategory == nil) {
                        Task { @MainActor in await model.selectSubcategory(nil) }
                    }
                    ForEach(model.subcategories, id: \.self) { sub in
                        Chip(sub, isSelected: model.subcategory == sub) {
                            Task { @MainActor in await model.selectSubcategory(sub) }
                        }
                    }
                }
            }
            HStack(spacing: Spacing.s) {
                countLabel
                Spacer(minLength: Spacing.s)
                Chip("In stock", systemImage: model.inStock ? "checkmark" : nil, isSelected: model.inStock) {
                    let next = !model.inStock
                    Task { @MainActor in await model.setInStock(next) }
                }
                sortMenu
            }
            .padding(.horizontal, Spacing.gutter)
        }
        .padding(.vertical, Spacing.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.bg)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.yard.line).frame(height: 1)
        }
        .animation(Motion.snappy, value: model.subcategories)
        .sensoryFeedback(.selection, trigger: model.sort)
        .sensoryFeedback(.selection, trigger: model.inStock)
    }

    @ViewBuilder
    private var countLabel: some View {
        if model.isLoaded {
            Text(ShopText.pieces(model.total))
                .font(.yardCallout.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1)
                .contentTransition(.numericText())
        } else {
            Text("Loading…")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink3)
                .lineLimit(1)
        }
    }

    private var sortMenu: some View {
        Menu {
            ForEach(ShopSort.allCases) { option in
                Button {
                    Task { @MainActor in await model.setSort(option) }
                } label: {
                    if option == model.sort {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.yardCaptionEmphasis)
                Text(model.sort.title)
                    .font(.yardCallout.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(Color.yard.ink)
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: 36)
            .background(Color.yard.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .accessibilityLabel(Text("Sort, \(model.sort.title)"))
    }
}

// MARK: - Previews

private let shopPreviewCategories: [ShopCategory] = [
    ShopCategory(slug: "fashion", name: "Fashion", description: "Tailoring, dresses and knitwear from independent designers.", subcategories: ["Outerwear", "Shirts", "Knitwear"], productCount: 42, brandCount: 9),
    ShopCategory(slug: "streetwear", name: "Streetwear", subcategories: ["Hoodies", "T-shirts"], productCount: 18, brandCount: 4),
    ShopCategory(slug: "sneakers", name: "Sneakers", productCount: 0, brandCount: 0),
]

#Preview("ShopView — dark") {
    NavigationStack { ShopView(previewCategory: nil, categories: shopPreviewCategories, products: PreviewFixtures.products) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ShopView — light") {
    NavigationStack { ShopView(previewCategory: nil, categories: shopPreviewCategories, products: PreviewFixtures.products) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("ShopView category — dark") {
    NavigationStack { ShopView(previewCategory: "fashion", categories: shopPreviewCategories, products: PreviewFixtures.products) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}
