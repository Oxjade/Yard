import SwiftUI

/// All results for a search: brand matches, filter chips (in stock, categories with counts),
/// a sort menu, and a two-column masonry of products that pages as you scroll.
/// Shown by `SearchView(query:)` when the query isn't empty (the `.search(query:)` route).
@MainActor
struct SearchResultsView: View {
    @Environment(CartStore.self) private var cart

    @State private var model: SearchResultsModel

    init(query: String) {
        _model = State(initialValue: SearchResultsModel(query: query))
    }

    /// Previews: show a prepared model.
    init(model: SearchResultsModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.l, pinnedViews: []) {
                header
                if !model.brands.isEmpty {
                    brandsRow
                }
                filterChips
                content
            }
            .padding(.bottom, Spacing.xxl)
        }
        .background(Color.yard.bg.ignoresSafeArea())
        .navigationTitle(model.query)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                sortMenu
            }
        }
        .refreshable {
            await model.load(currency: cart.currency)
        }
        .task(id: model.reloadKey(currency: cart.currency)) {
            await model.load(currency: cart.currency)
        }
        .onAppear {
            SearchRecents.record(model.query)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("“\(model.query)”")
                .yardDisplay(36)
                .foregroundStyle(Color.yard.ink)
                .lineLimit(2)
            Text(countText)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .contentTransition(.numericText())
                .animation(Motion.snappy, value: model.total)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
        .accessibilityElement(children: .combine)
    }

    private var countText: String {
        switch model.phase {
        case .loading:
            return "Searching the marketplace…"
        case .failed:
            return "Results couldn't be loaded"
        case .loaded:
            let n = model.total
            return n == 1 ? "1 piece" : "\(Formatters.grouped(n)) pieces"
        }
    }

    // MARK: Brands

    private var brandsRow: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            SearchSectionLabel("Brands")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.s) {
                    ForEach(model.brands) { brand in
                        NavigationLink(value: Route.brand(handle: brand.handle)) {
                            HStack(spacing: Spacing.s) {
                                BrandAvatar(name: brand.name, size: 32)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(brand.name)
                                        .font(.yardCallout.weight(.semibold))
                                        .foregroundStyle(Color.yard.ink)
                                        .lineLimit(1)
                                    if let location = brand.locationText {
                                        Text(location)
                                            .font(.yardMicro)
                                            .foregroundStyle(Color.yard.ink2)
                                            .lineLimit(1)
                                    }
                                }
                            }
                            .padding(.leading, Spacing.xs)
                            .padding(.trailing, Spacing.l)
                            .padding(.vertical, Spacing.xs)
                            .background(Color.yard.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
    }

    // MARK: Filters and sort

    private var filterChips: some View {
        ChipRow {
            Chip(
                "In stock",
                systemImage: "checkmark.circle",
                isSelected: model.inStockOnly,
                count: model.inStockCount
            ) {
                model.inStockOnly.toggle()
            }
            Chip("All", isSelected: model.category == nil) {
                model.category = nil
            }
            ForEach(categoryOptions) { facet in
                Chip(facet.label, isSelected: model.category == facet.value, count: facet.count) {
                    model.category = model.category == facet.value ? nil : facet.value
                }
            }
        }
        .sensoryFeedback(.selection, trigger: model.reloadKey(currency: cart.currency))
    }

    /// The categories the words fall into; keeps a selected one visible even with 0 left.
    private var categoryOptions: [SearchCategoryFacet] {
        var facets = model.categoryFacets
        if let selected = model.category, !facets.contains(where: { $0.value == selected }) {
            facets.insert(SearchCategoryFacet(value: selected, label: selected.capitalized, count: 0), at: 0)
        }
        return facets
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort by", selection: $model.sort) {
                ForEach(SearchSort.allCases) { option in
                    Label(option.title, systemImage: option.systemImage).tag(option)
                }
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "arrow.up.arrow.down")
                Text(model.sort.title)
                    .lineLimit(1)
            }
            .font(.yardCaptionEmphasis)
            .foregroundStyle(Color.yard.ink)
            .padding(.horizontal, Spacing.m)
            .frame(height: 32)
            .background(Color.yard.surface2, in: Capsule())
        }
        .accessibilityLabel("Sort, \(model.sort.title)")
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            MasonrySkeleton(count: 8)
                .padding(.horizontal, Spacing.gridGap)
        case .failed(let message):
            EmptyState.error(message: message) {
                await model.load(currency: cart.currency)
            }
            .padding(.top, Spacing.xxl)
        case .loaded:
            if model.products.isEmpty {
                noResults
            } else {
                grid
            }
        }
    }

    private var grid: some View {
        VStack(spacing: Spacing.l) {
            MasonryGrid(model.products) { product in
                NavigationLink(value: Route.product(slug: product.slug)) {
                    ProductTile(product: product)
                }
                .buttonStyle(PressableButtonStyle())
                .onAppear {
                    if product.id == model.products.last?.id {
                        Task { @MainActor in await model.loadMore(currency: cart.currency) }
                    }
                }
            }
            .padding(.horizontal, Spacing.gridGap)

            footer
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isLoadingMore {
            ProgressView()
                .tint(Color.yard.ink2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.l)
        } else if let error = model.loadMoreError {
            VStack(spacing: Spacing.s) {
                Text(error)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.danger)
                    .multilineTextAlignment(.center)
                YardButton("Try again", style: .secondary, size: .small, fullWidth: false) {
                    Task { @MainActor in await model.loadMore(currency: cart.currency) }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.gutter)
        } else if model.capped {
            Text("That's as far as this search goes. Add a filter or a word to narrow it.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Spacing.gutter)
        } else if model.nextCursor == nil && model.products.count > 6 {
            Text("That's everything for “\(model.query)”.")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var noResults: some View {
        if model.hasFilters {
            EmptyState(
                title: "Nothing with these filters",
                message: "No pieces for “\(model.query)” match your filters.",
                systemImage: "line.3.horizontal.decrease.circle",
                actionTitle: "Clear filters",
                action: { model.clearFilters() }
            )
            .padding(.top, Spacing.xl)
        } else {
            VStack(spacing: Spacing.l) {
                EmptyState(
                    title: "No results",
                    message: "Nothing matches “\(model.query)”. Try a brand name, a city or a material.",
                    systemImage: "magnifyingglass"
                )
                SearchSectionLabel("Keep looking")
                SearchFlowLayout {
                    NavigationLink(value: Route.shop) { suggestionLabel("Shop everything", systemImage: "bag") }
                    NavigationLink(value: Route.brandsDirectory) { suggestionLabel("All brands", systemImage: "storefront") }
                    NavigationLink(value: Route.categories) { suggestionLabel("Categories", systemImage: "square.grid.2x2") }
                    NavigationLink(value: Route.drops) { suggestionLabel("Drops", systemImage: "bolt") }
                }
                .buttonStyle(PressableButtonStyle())
                .padding(.horizontal, Spacing.gutter)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, Spacing.xl)
        }
    }

    private func suggestionLabel(_ title: String, systemImage: String) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: systemImage)
                .font(.yardCaptionEmphasis)
            Text(title)
                .font(.yardCallout.weight(.semibold))
        }
        .foregroundStyle(Color.yard.ink)
        .padding(.horizontal, Spacing.l)
        .frame(minHeight: 36)
        .background(Color.yard.surface2, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
    }
}

// MARK: - Previews

#Preview("Results — dark") {
    NavigationStack {
        SearchResultsView(model: SearchResultsModel.preview(
            query: "hoodie",
            products: PreviewFixtures.products,
            brands: SearchPreviewData.brands,
            facets: [SearchCategoryFacet(value: "tops", label: "Tops", count: 8), SearchCategoryFacet(value: "outerwear", label: "Outerwear", count: 2)]
        ))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Results — light") {
    NavigationStack {
        SearchResultsView(model: SearchResultsModel.preview(
            query: "hoodie",
            products: PreviewFixtures.products,
            brands: SearchPreviewData.brands,
            facets: [SearchCategoryFacet(value: "tops", label: "Tops", count: 8)]
        ))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

#Preview("Results empty — dark") {
    NavigationStack {
        SearchResultsView(model: SearchResultsModel.preview(query: "zzzz", products: []))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}
