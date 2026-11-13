import SwiftUI
import Observation

// The brands directory (website: /brands, LiveBrandDirectory).
//
//   GET /api/catalog/brands?q=&category=&founding=1&sort=name|new&limit=24&offset=
//       → BrandsPage { brands, total, nextOffset }
//
// Search (name, handle or city), sort chips (A–Z / New on Yard), a Founding chip and category
// chips (only categories the listed brands actually sell in), infinite scroll, Follow per card.

// MARK: - Model

@Observable
@MainActor
final class BrandsDirectoryModel {
    enum Sort: String, CaseIterable, Hashable, Sendable {
        case name
        case new

        var title: String {
            switch self {
            case .name: return "A–Z"
            case .new: return "New on Yard"
            }
        }
    }

    static let pageSize = 24

    var query: String = ""
    var category: String? = nil
    var foundingOnly: Bool = false
    var sort: Sort = .name

    private(set) var brands: [BrandCard] = []
    private(set) var total: Int = 0
    private(set) var nextOffset: Int? = nil
    private(set) var isLoading: Bool = false
    private(set) var isLoadingMore: Bool = false
    private(set) var loadError: Error? = nil
    private(set) var loadMoreFailed: Bool = false
    private(set) var hasLoaded: Bool = false
    /// Total of the unfiltered first page (nil until known). 0 → "Brands are joining Yard".
    private(set) var unfilteredTotal: Int? = nil
    /// Category slugs present among listed brands (from the first unfiltered page).
    private(set) var categoryOptions: [String] = []
    /// Whether any listed brand is a founding brand (else the Founding chip is hidden).
    private(set) var hasFoundingBrands: Bool = false

    private var ticket: Int = 0

    init() {}

    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isNarrowing: Bool { !trimmedQuery.isEmpty || category != nil || foundingOnly }
    /// Changes whenever the request changes (drives `.task(id:)`).
    var requestKey: String { "\(trimmedQuery)|\(category ?? "")|\(foundingOnly)|\(sort.rawValue)" }

    func clearFilters() {
        query = ""
        category = nil
        foundingOnly = false
    }

    private func queryItems(offset: Int) -> [URLQueryItem] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "sort", value: sort.rawValue),
            URLQueryItem(name: "limit", value: String(Self.pageSize)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        let q = trimmedQuery
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: String(q.prefix(60)))) }
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if foundingOnly { items.append(URLQueryItem(name: "founding", value: "1")) }
        return items
    }

    /// Loads the first page for the current filters. Older in-flight loads are ignored.
    func reload() async {
        ticket += 1
        let mine = ticket
        let narrowing = isNarrowing
        isLoading = true
        loadError = nil
        loadMoreFailed = false
        do {
            let page = try await APIClient.shared.get("/api/catalog/brands", query: queryItems(offset: 0), as: BrandsPage.self)
            guard mine == ticket else { return }
            brands = page.brands
            total = page.total
            nextOffset = page.nextOffset
            if !narrowing && unfilteredTotal == nil {
                unfilteredTotal = page.total
                let present = Set(page.brands.flatMap { $0.categories })
                categoryOptions = BrandsCategory.order.filter { present.contains($0) }
                hasFoundingBrands = page.brands.contains { $0.founding || $0.foundingBadge }
            }
            isLoading = false
            hasLoaded = true
        } catch {
            guard mine == ticket else { return }
            if let apiError = error as? APIError, apiError.isCancelled { return }
            if error is CancellationError { return }
            loadError = error
            isLoading = false
            hasLoaded = true
        }
    }

    /// Appends the next page (infinite scroll).
    func loadMore() async {
        guard let offset = nextOffset, !isLoadingMore, !isLoading else { return }
        let mine = ticket
        isLoadingMore = true
        loadMoreFailed = false
        do {
            let page = try await APIClient.shared.get("/api/catalog/brands", query: queryItems(offset: offset), as: BrandsPage.self)
            guard mine == ticket else {
                isLoadingMore = false
                return
            }
            let known = Set(brands.map(\.id))
            brands.append(contentsOf: page.brands.filter { !known.contains($0.id) })
            total = page.total
            nextOffset = page.nextOffset
        } catch {
            if mine == ticket { loadMoreFailed = true }
        }
        isLoadingMore = false
    }
}

// MARK: - View

@MainActor
struct BrandsDirectoryView: View {
    @Environment(Router.self) private var router
    @State private var model = BrandsDirectoryModel()
    @State private var didFirstLoad = false

    init() {}

    private let columns: [GridItem] = [
        GridItem(.flexible(), spacing: Spacing.m, alignment: .top),
        GridItem(.flexible(), spacing: Spacing.m, alignment: .top),
    ]

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("Brands")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search brands or cities")
            .task(id: model.requestKey) {
                if didFirstLoad && !model.trimmedQuery.isEmpty {
                    // Debounce typing like the website (250 ms).
                    do { try await Task.sleep(nanoseconds: 250_000_000) } catch { return }
                }
                didFirstLoad = true
                await model.reload()
            }
            .refreshable { await model.reload() }
    }

    @ViewBuilder
    private var content: some View {
        if !model.hasLoaded && model.brands.isEmpty {
            ScrollView { loadingGrid }
                .scrollDisabled(true)
        } else if model.unfilteredTotal == 0 && !model.isNarrowing {
            joiningState
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    filters
                    countLine
                    results
                }
                .padding(.top, Spacing.s)
                .padding(.bottom, Spacing.xxl)
            }
            .scrollDismissesKeyboard(.immediately)
        }
    }

    // MARK: Filters

    @ViewBuilder
    private var filters: some View {
        if (model.unfilteredTotal ?? 0) > 1 || model.isNarrowing {
            VStack(alignment: .leading, spacing: Spacing.s) {
                ChipRow {
                    ForEach(BrandsDirectoryModel.Sort.allCases, id: \.self) { sort in
                        Chip(sort.title, isSelected: model.sort == sort) {
                            withAnimation(Motion.snappy) { model.sort = sort }
                        }
                    }
                    if model.hasFoundingBrands || model.foundingOnly {
                        Chip("Founding", systemImage: "sparkle", isSelected: model.foundingOnly) {
                            withAnimation(Motion.snappy) { model.foundingOnly.toggle() }
                        }
                    }
                }
                if model.categoryOptions.count > 1 {
                    ChipRow {
                        Chip("All", isSelected: model.category == nil) {
                            withAnimation(Motion.snappy) { model.category = nil }
                        }
                        ForEach(model.categoryOptions, id: \.self) { slug in
                            Chip(BrandsCategory.name(for: slug) ?? slug.capitalized, isSelected: model.category == slug) {
                                withAnimation(Motion.snappy) { model.category = (model.category == slug) ? nil : slug }
                            }
                        }
                    }
                }
            }
        }
    }

    private var countLine: some View {
        HStack(spacing: Spacing.s) {
            if model.isLoading {
                Text("Loading brands…")
            } else {
                Text("\(model.total) \(model.total == 1 ? "brand" : "brands")\(model.sort == .new ? ", newest first" : "")")
            }
            Spacer(minLength: 0)
            if model.isLoading {
                ProgressView().controlSize(.small)
            }
        }
        .font(.yardCaption)
        .foregroundStyle(Color.yard.ink2)
        .padding(.horizontal, Spacing.gutter)
        .accessibilityElement(children: .combine)
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let error = model.loadError, model.brands.isEmpty || !model.isLoading {
            EmptyState(
                title: "Brands couldn't be loaded",
                message: APIError.message(for: error),
                systemImage: "wifi.exclamationmark",
                actionTitle: "Retry"
            ) {
                Task { @MainActor in await model.reload() }
            }
            .padding(.top, Spacing.xl)
        } else if model.brands.isEmpty && model.isLoading {
            loadingGrid
        } else if model.brands.isEmpty {
            EmptyState(
                title: "No brands match",
                message: "Try another word or category.",
                systemImage: "magnifyingglass",
                actionTitle: "Clear search"
            ) {
                withAnimation(Motion.snappy) { model.clearFilters() }
            }
            .padding(.top, Spacing.xl)
        } else {
            LazyVGrid(columns: columns, spacing: Spacing.l) {
                ForEach(model.brands) { brand in
                    BrandDirectoryCard(brand: brand)
                        .onAppear {
                            if brand.id == model.brands.last?.id {
                                Task { @MainActor in await model.loadMore() }
                            }
                        }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .opacity(model.isLoading ? 0.55 : 1)
            .animation(Motion.fade, value: model.isLoading)

            footer
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isLoadingMore {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.l)
        } else if model.loadMoreFailed {
            YardButton("Load more brands", style: .secondary, size: .medium, fullWidth: false) {
                Task { @MainActor in await model.loadMore() }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.l)
        }
    }

    private var loadingGrid: some View {
        LazyVGrid(columns: columns, spacing: Spacing.l) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Skeleton(cornerRadius: Radius.image)
                        .aspectRatio(0.8, contentMode: .fit)
                    Skeleton(cornerRadius: 6).frame(width: 110, height: 14)
                    Skeleton(cornerRadius: 6).frame(width: 80, height: 12)
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.l)
        .accessibilityLabel("Loading brands")
    }

    /// The website's BrandsJoining state: no brands listed yet, never sample brands.
    private var joiningState: some View {
        EmptyState(
            title: "Brands are joining Yard — follow along",
            message: "Independent studios are setting up their storefronts now. Their pieces, drops and stories appear here the day they open.",
            systemImage: "storefront",
            actionTitle: "See upcoming drops"
        ) {
            router.push(.drops)
        }
    }
}

// MARK: - Card

/// One brand in the directory grid: cover with logo and "Opening soon", name, place · category,
/// founding badge and a Follow pill.
@MainActor
struct BrandDirectoryCard: View {
    let brand: BrandCard

    @Environment(SessionStore.self) private var session
    @Environment(FollowStore.self) private var follows
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @State private var isBusy = false

    private var isFollowing: Bool { follows.isFollowing(brand.id) }

    private var placeLine: String {
        let place = BrandsPlace.text(city: brand.city, country: brand.country)
        if let category = BrandsCategory.firstName(in: brand.categories) {
            return place.isEmpty ? category : "\(place) · \(category)"
        }
        return place
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            NavigationLink(value: Route.brand(handle: brand.handle)) {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    cover
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(brand.name)
                                .font(.yardBodyEmphasis)
                                .foregroundStyle(Color.yard.ink)
                                .lineLimit(1)
                            if brand.verified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color.yard.violet)
                                    .accessibilityLabel("Verified brand")
                            }
                        }
                        if !placeLine.isEmpty {
                            Text(placeLine)
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink2)
                                .lineLimit(1)
                        }
                    }
                    if brand.foundingBadge {
                        BrandsFoundingBadge()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())

            YardButton(
                isFollowing ? "Following" : "Follow",
                systemImage: isFollowing ? "checkmark" : nil,
                style: isFollowing ? .secondary : .primary,
                size: .small,
                isLoading: isBusy
            ) {
                guard !isBusy else { return }
                isBusy = true
                Task { @MainActor in
                    await BrandsFollow.toggle(brandId: brand.id, brandName: brand.name, session: session, follows: follows, router: router, toast: toast)
                    isBusy = false
                }
            }
            .sensoryFeedback(.selection, trigger: isFollowing)
            .accessibilityLabel(isFollowing ? "Following \(brand.name)" : "Follow \(brand.name)")
        }
    }

    private var cover: some View {
        Color.yard.surface2
            .aspectRatio(0.8, contentMode: .fit)
            .overlay {
                if brand.coverURL != nil {
                    RemoteImage(url: brand.coverURL, maxPixelSize: 700)
                }
            }
            .overlay {
                LinearGradient(colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.45)], startPoint: .center, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                logo.padding(Spacing.s)
            }
            .overlay(alignment: .topLeading) {
                if !brand.forSale {
                    Tag("Opening soon", style: .onPhoto)
                        .padding(Spacing.s)
                }
            }
            .clipShape(.yardImage)
            .overlay(RoundedRectangle(cornerRadius: Radius.image, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
    }

    private var logo: some View {
        BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 44)
            .overlay(Circle().strokeBorder(Color.yard.onPhoto.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Previews

#Preview("BrandsDirectoryView — dark") {
    NavigationStack { BrandsDirectoryView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BrandsDirectoryView — light") {
    NavigationStack { BrandsDirectoryView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Brand card — light & dark") {
    HStack(alignment: .top, spacing: Spacing.m) {
        BrandDirectoryCard(brand: PreviewFixtures.brandCard)
        BrandDirectoryCard(brand: BrandCard(id: "b2", handle: "soon", name: "Night Shift", city: "Accra", country: "GH", categories: ["streetwear"], forSale: false))
            .environment(\.colorScheme, .dark)
    }
    .padding()
    .yardPreviewEnvironment()
}
