import SwiftUI

/// The Search tab (`SearchView(query: "")`) and the `.search(query:)` route.
///
/// With an empty query it is the tab root: a large search field (focused on appear), recent
/// searches kept on the device, Browse chips (Shop, Charts, Around, Drops, Brands, Categories —
/// the website's search overlay), and "Try" chips from live categories. Typing searches the
/// marketplace (/api/search, debounced, 2+ characters) and lists Brands, Categories and Products,
/// then "See all results for …", which pushes `.search(query:)`.
///
/// With a query (a pushed route or a `/search?q=` link) it shows `SearchResultsView`.
@MainActor
struct SearchView: View {
    let query: String

    init(query: String) {
        self.query = query
    }

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            SearchHomeView()
        } else {
            SearchResultsView(query: trimmed)
        }
    }
}

// MARK: - Search home (tab root)

@MainActor
struct SearchHomeView: View {
    @Environment(Router.self) private var router
    @Environment(CartStore.self) private var cart

    @State private var model: SearchLiveModel
    @State private var text: String = ""
    @State private var recents: [String] = []
    @FocusState private var isFieldFocused: Bool

    init(model: SearchLiveModel? = nil, initialText: String = "", recents: [String]? = nil) {
        _model = State(initialValue: model ?? SearchLiveModel())
        _text = State(initialValue: initialText)
        _recents = State(initialValue: recents ?? SearchRecents.load())
    }

    private var term: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isTyping: Bool { term.count >= SearchLiveModel.minimumLength }

    private struct BrowseLink: Identifiable {
        let title: String
        let systemImage: String
        let route: Route
        var id: String { title }
    }

    /// The website's `browseLinks` (minus "Sell on Yard": the app is shopper-only).
    private let browseLinks: [BrowseLink] = [
        BrowseLink(title: "Shop", systemImage: "bag", route: .shop),
        BrowseLink(title: "Charts", systemImage: "chart.bar", route: .charts),
        BrowseLink(title: "Around", systemImage: "mappin.and.ellipse", route: .around),
        BrowseLink(title: "Drops", systemImage: "bolt", route: .drops),
        BrowseLink(title: "Brands", systemImage: "storefront", route: .brandsDirectory),
        BrowseLink(title: "Categories", systemImage: "square.grid.2x2", route: .categories),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                TabPillScrollSensor()
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    if isTyping {
                        liveResults
                    } else {
                        idleContent
                    }
                }
                .padding(.top, Spacing.m)
                .padding(.bottom, Spacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Color.yard.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.loadCategories()
        }
        .task(id: term) {
            let current = term
            guard current.count >= SearchLiveModel.minimumLength else {
                model.reset()
                return
            }
            do {
                try await Task.sleep(nanoseconds: 220_000_000)
            } catch {
                return
            }
            await model.search(current, currency: cart.currency)
        }
        .onAppear {
            recents = SearchRecents.load()
            focusSoon()
        }
        .onChange(of: router.selectedTab) { _, tab in
            if tab == .search && router.depth == 0 {
                recents = SearchRecents.load()
                focusSoon()
            } else {
                isFieldFocused = false
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Search")
                .yardDisplay(44)
                .foregroundStyle(Color.yard.ink)
                .padding(.horizontal, Spacing.gutter)
                .accessibilityAddTraits(.isHeader)
            searchField
                .padding(.horizontal, Spacing.gutter)
        }
        .padding(.top, Spacing.s)
        .padding(.bottom, Spacing.s)
        .background(Color.yard.bg)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "magnifyingglass")
                .font(.yardBodyEmphasis)
                .foregroundStyle(Color.yard.ink2)
            TextField(
                "",
                text: $text,
                prompt: Text("Brands, products, categories").foregroundColor(Color.yard.ink3)
            )
            .font(.yardBody)
            .foregroundStyle(Color.yard.ink)
            .tint(Color.yard.ink)
            .focused($isFieldFocused)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit { submit(term) }
            .accessibilityLabel("Search")
            if !text.isEmpty {
                Button {
                    text = ""
                    isFieldFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.l)
        .frame(height: 54)
        .background(Color.yard.surface2, in: Capsule())
        .overlay(
            Capsule().strokeBorder(isFieldFocused ? Color.yard.ink.opacity(0.35) : Color.yard.line, lineWidth: 1)
        )
        .animation(Motion.snappy, value: isFieldFocused)
        .contentShape(Capsule())
        .onTapGesture { isFieldFocused = true }
    }

    // MARK: Idle: recents, browse, try

    @ViewBuilder
    private var idleContent: some View {
        if !recents.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                SearchSectionLabel("Recent", actionTitle: "Clear") {
                    SearchRecents.clear()
                    withAnimation(Motion.spring) { recents = [] }
                }
                ForEach(recents, id: \.self) { recent in
                    recentRow(recent)
                }
            }
        }

        VStack(alignment: .leading, spacing: Spacing.s) {
            SearchSectionLabel("Browse")
            SearchFlowLayout {
                ForEach(browseLinks) { link in
                    Chip(link.title, systemImage: link.systemImage) {
                        isFieldFocused = false
                        router.push(link.route)
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }

        if !model.tries.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                SearchSectionLabel("Try")
                tryChips
            }
        }
    }

    private func recentRow(_ recent: String) -> some View {
        HStack(spacing: Spacing.m) {
            Button {
                submit(recent)
            } label: {
                HStack(spacing: Spacing.m) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink3)
                        .frame(width: 24)
                    Text(recent)
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.s)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button {
                withAnimation(Motion.spring) { recents = SearchRecents.remove(recent) }
            } label: {
                Image(systemName: "xmark")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink3)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(recent) from recent searches")
        }
        .padding(.leading, Spacing.gutter)
        .padding(.trailing, Spacing.xs)
    }

    private var tryChips: some View {
        SearchFlowLayout {
            ForEach(model.tries) { category in
                Chip(category.name.lowercased()) {
                    text = category.name.lowercased()
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    // MARK: Typing: live results

    @ViewBuilder
    private var liveResults: some View {
        let categories = model.matchingCategories(term)
        let isCurrent = model.term == term
        let isLoading = !isCurrent || model.phase == .loading
        let hasRemote = isCurrent && (!model.brands.isEmpty || !model.products.isEmpty)

        if case .failed(let message) = model.phase, isCurrent {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Image(systemName: "wifi.exclamationmark")
                    .foregroundStyle(Color.yard.danger)
                Text(message)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.danger)
                Spacer(minLength: Spacing.s)
                Button("Retry") {
                    Task { @MainActor in await model.search(term, currency: cart.currency) }
                }
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.ink)
            }
            .padding(.horizontal, Spacing.gutter)
        } else if isLoading && !hasRemote {
            SearchRowsSkeleton()
        }

        if isCurrent && !model.brands.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                SearchSectionLabel("Brands")
                ForEach(model.brands) { brand in
                    NavigationLink(value: Route.brand(handle: brand.handle)) {
                        SearchBrandRow(brand: brand)
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(TapGesture().onEnded { remember(term) })
                }
            }
        }

        if !categories.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                SearchSectionLabel("Categories")
                SearchFlowLayout {
                    ForEach(categories) { category in
                        Chip(category.name, systemImage: "square.grid.2x2") {
                            remember(term)
                            isFieldFocused = false
                            router.push(.category(slug: category.slug))
                        }
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }

        if isCurrent && !model.products.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                SearchSectionLabel("Products")
                ForEach(model.products) { item in
                    NavigationLink(value: productRoute(for: item)) {
                        SearchProductRow(item: item)
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(TapGesture().onEnded { remember(term) })
                }
            }
        }

        if isCurrent && model.phase == .loaded && !hasRemote && categories.isEmpty {
            noMatches
        } else {
            seeAllRow
        }
    }

    private var seeAllRow: some View {
        Button {
            submit(term)
        } label: {
            HStack(spacing: Spacing.s) {
                Image(systemName: "magnifyingglass")
                    .font(.yardCallout.weight(.semibold))
                Text("See all results for “\(term)”")
                    .font(.yardCallout.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: Spacing.s)
                if model.term == term && model.phase == .loaded && model.total > 0 {
                    Text(Formatters.count(model.total))
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink2)
                }
                Image(systemName: "arrow.right")
                    .font(.yardCaptionEmphasis)
            }
            .foregroundStyle(Color.yard.ink)
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: 52)
            .background(Color.yard.surface, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .padding(.horizontal, Spacing.gutter)
    }

    private var noMatches: some View {
        VStack(spacing: Spacing.l) {
            EmptyState(
                title: "No matches",
                message: "Nothing matches “\(term)”. Try a brand name, a city or a material.",
                systemImage: "magnifyingglass"
            )
            if !model.tries.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    SearchSectionLabel("Try")
                    tryChips
                }
            }
        }
    }

    // MARK: Actions

    private func productRoute(for item: SearchItem) -> Route {
        if let slug = item.slug, !slug.isEmpty {
            return .product(slug: slug)
        }
        return .search(query: term)
    }

    private func remember(_ value: String) {
        recents = SearchRecents.record(value)
    }

    private func submit(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        remember(trimmed)
        isFieldFocused = false
        router.push(.search(query: trimmed))
    }

    private func focusSoon() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            if router.selectedTab == .search && router.depth == 0 {
                isFieldFocused = true
            }
        }
    }
}

// MARK: - Previews

#Preview("Search — dark") {
    NavigationStack { SearchView(query: "") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Search — light") {
    NavigationStack { SearchView(query: "") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Search typing — dark") {
    NavigationStack {
        SearchHomeView(
            model: SearchPreviewData.typingModel,
            initialText: "hood",
            recents: []
        )
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Search typing — light") {
    NavigationStack {
        SearchHomeView(
            model: SearchPreviewData.typingModel,
            initialText: "hood",
            recents: []
        )
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

/// Preview-only fixtures for Search.
@MainActor
enum SearchPreviewData {
    static let items: [SearchItem] = [
        SearchItem(productId: "prd_1", brandId: "brd_1", brandName: "Acme Studio", slug: "washed-hoodie", title: "Washed hoodie", image: nil, available: 4, display: Money(amount: 8900, currency: "USD"), price: nil),
        SearchItem(productId: "prd_2", brandId: "brd_1", brandName: "Acme Studio", slug: "zip-hoodie", title: "Zip hoodie", image: nil, available: 2, display: Money(amount: 9500, currency: "USD"), price: nil),
    ]
    static let brands: [SearchBrandHit] = [
        SearchBrandHit(brandId: "brd_2", handle: "hoodrich", name: "Hood Club", city: "Lagos", country: "NG"),
    ]
    static let categories: [SearchCategory] = [
        SearchCategory(slug: "hoodies", name: "Hoodies", productCount: 12),
        SearchCategory(slug: "tops", name: "Tops", productCount: 30),
    ]

    static var typingModel: SearchLiveModel {
        SearchLiveModel.preview(term: "hood", products: items, brands: brands, categories: categories)
    }
}
