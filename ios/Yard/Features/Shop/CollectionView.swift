import SwiftUI
import Observation

// A brand collection (website: /brands/{handle}/collections/{collection}).
//   GET /api/catalog/storefronts/{brand}/collections/{handle}  → collection + brand
//   GET /api/catalog/products?ids=…&limit=60                    → its public pieces (chunks of 60, kept in collection order)
//   GET /api/catalog/storefronts/{brand}                         → the brand's other collections ("More from …"), optional

@Observable
@MainActor
final class CollectionModel {
    enum Phase {
        case loading
        case loaded
        case notFound(String)
        case failed(Error)
    }

    let brandHandle: String
    let collectionHandle: String

    private(set) var phase: Phase = .loading
    private(set) var collection: StorefrontCollection?
    private(set) var brand: ShopCollectionResponse.Brand?
    private(set) var brandLogoURL: URL?
    /// In the collection's own order.
    private(set) var products: [Product] = []
    private(set) var others: [StorefrontCollection] = []
    var sort: ShopCollectionSort = .featured

    private let fetches: Bool

    init(brand: String, handle: String) {
        self.brandHandle = brand
        self.collectionHandle = handle
        self.fetches = true
    }

    /// Previews only: fixed data, no network.
    init(previewCollection: StorefrontCollection, brand: ShopCollectionResponse.Brand, products: [Product], others: [StorefrontCollection]) {
        self.brandHandle = brand.handle
        self.collectionHandle = previewCollection.handle
        // `let`s first: assigning an @Observable property uses its setter, which needs every
        // stored property initialized.
        self.fetches = false
        self.collection = previewCollection
        self.brand = brand
        self.products = products
        self.others = others
        self.phase = .loaded
    }

    var isLoaded: Bool {
        if case .loaded = phase { return true }
        return false
    }

    var sortedProducts: [Product] { sort.apply(to: products) }

    var brandName: String { brand?.name ?? brandHandle }

    /// The collection photo, else its first piece's photo (as the website does).
    var coverURL: URL? { collection?.imageURL ?? products.first?.coverURL }

    var shareURL: URL {
        Config.webURL("/brands/\(brand?.handle ?? brandHandle)/collections/\(collection?.handle ?? collectionHandle)")
    }

    func load(force: Bool = false) async {
        guard fetches else { return }
        if isLoaded, !force { return }
        if !isLoaded { phase = .loading }
        do {
            let brandPath = CollectionModel.pathSegment(brandHandle)
            let collectionPath = CollectionModel.pathSegment(collectionHandle)
            async let storefrontTask: PublicStorefront? = CollectionModel.storefront(path: brandPath)
            let response = try await APIClient.shared.get("/api/catalog/storefronts/\(brandPath)/collections/\(collectionPath)", as: ShopCollectionResponse.self)
            let pieces = try await CollectionModel.products(ids: response.collection.productIds)
            let storefront = await storefrontTask

            collection = response.collection
            brand = response.brand
            products = pieces
            brandLogoURL = storefront?.brand.logoURL
            others = (storefront?.collections ?? []).filter { $0.id != response.collection.id }
            phase = .loaded
        } catch {
            if ShopListingModel.isCancellation(error) { return }
            if isLoaded { return } // keep what is on screen after a failed pull-to-refresh
            if let api = error as? APIError, api.isNotFound {
                phase = .notFound(api.message)
            } else {
                phase = .failed(error)
            }
        }
    }

    /// The brand's storefront (for its logo and other collections); nil on any failure.
    private static func storefront(path: String) async -> PublicStorefront? {
        do {
            return try await APIClient.shared.get("/api/catalog/storefronts/\(path)", as: PublicStorefront.self)
        } catch {
            return nil
        }
    }

    /// Public pieces for `ids`, in the same order; ids that aren't public any more drop out.
    private static func products(ids: [String]) async throws -> [Product] {
        guard !ids.isEmpty else { return [] }
        var byId: [String: Product] = [:]
        var start = 0
        while start < ids.count {
            let end = min(start + 60, ids.count)
            var query: [URLQueryItem] = ids[start..<end].map { URLQueryItem(name: "ids", value: $0) }
            query.append(URLQueryItem(name: "limit", value: "60"))
            query.append(URLQueryItem(name: "offset", value: "0"))
            query.append(URLQueryItem(name: "sort", value: ShopSort.new.rawValue))
            let page = try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
            for p in page.products { byId[p.id] = p }
            start = end
        }
        var seen = Set<String>()
        var out: [Product] = []
        for id in ids {
            if let p = byId[id], !seen.contains(id) {
                seen.insert(id)
                out.append(p)
            }
        }
        return out
    }

    private static func pathSegment(_ raw: String) -> String {
        raw.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? raw
    }
}

@MainActor
struct CollectionView: View {
    let brand: String
    let handle: String

    @State private var model: CollectionModel
    @Environment(Router.self) private var router

    init(brand: String, handle: String) {
        self.brand = brand
        self.handle = handle
        _model = State(initialValue: CollectionModel(brand: brand, handle: handle))
    }

    /// Previews only.
    init(previewModel: CollectionModel) {
        self.brand = previewModel.brandHandle
        self.handle = previewModel.collectionHandle
        _model = State(initialValue: previewModel)
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle(model.collection?.name ?? "Collection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if model.isLoaded {
                        ShareLink(item: model.shareURL) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel(Text("Share collection"))
                    }
                }
            }
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ScrollView { CollectionSkeleton() }
                .scrollDisabled(true)
        case .notFound(let message):
            EmptyState(
                title: "Collection not found",
                message: message.isEmpty ? "That collection isn't available." : message,
                systemImage: "square.stack.3d.up.slash",
                actionTitle: "Visit the brand",
                action: { router.push(.brand(handle: brand)) }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let error):
            EmptyState.error(error) { await model.load(force: true) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            loaded
        }
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                piecesBar
                    .padding(.top, Spacing.xl)
                    .padding(.bottom, Spacing.m)
                pieces
                if !model.others.isEmpty {
                    moreFromBrand
                        .padding(.top, Spacing.xxl)
                }
            }
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.load(force: true) }
    }

    // MARK: Hero

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            Color.yard.surface2
            RemoteImage(url: model.coverURL, maxPixelSize: 1400)
            LinearGradient(
                colors: [Color.yard.scrim.opacity(0.25), Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.78)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("A collection by \(model.brandName)")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                Text(model.collection?.name ?? "")
                    .yardDisplay(46)
                    .foregroundStyle(Color.yard.onPhoto)
                    .lineLimit(3)
                    .minimumScaleFactor(0.6)
                if let description = model.collection?.description, !description.isEmpty {
                    Text(description)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.l)
        }
        .frame(height: 440)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topLeading) { brandChip.padding(Spacing.m) }
        .clipShape(.yardCard)
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    /// Brand breadcrumb over the photo: avatar + name, opens the brand profile.
    private var brandChip: some View {
        Button {
            router.push(.brand(handle: model.brand?.handle ?? brand))
        } label: {
            HStack(spacing: Spacing.s) {
                BrandAvatar(name: model.brandName, logoURL: model.brandLogoURL, size: 26)
                Text(model.brandName)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.yard.ink2)
            }
            .padding(.leading, Spacing.xs)
            .padding(.trailing, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .background(.ultraThinMaterial, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text("Open \(model.brandName)"))
    }

    // MARK: Pieces

    private var piecesBar: some View {
        HStack(spacing: Spacing.s) {
            Text(ShopText.pieces(model.products.count))
                .font(.yardHeadline)
                .monospacedDigit()
                .foregroundStyle(Color.yard.ink)
            Spacer(minLength: Spacing.s)
            if model.products.count > 1 {
                sortMenu
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    private var sortMenu: some View {
        Menu {
            ForEach(ShopCollectionSort.allCases) { option in
                Button {
                    withAnimation(Motion.spring) { model.sort = option }
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
        .sensoryFeedback(.selection, trigger: model.sort)
        .accessibilityLabel(Text("Sort pieces, \(model.sort.title)"))
    }

    @ViewBuilder
    private var pieces: some View {
        if model.products.isEmpty {
            EmptyState(
                title: "Nothing in this collection right now",
                message: "Its pieces have sold out or been taken down; the rest of \(model.brandName) is still open.",
                systemImage: "shippingbox",
                actionTitle: "Visit \(model.brandName)",
                action: { router.push(.brand(handle: model.brand?.handle ?? brand)) }
            )
            .frame(minHeight: 320)
        } else {
            MasonryGrid(model.sortedProducts) { product in
                NavigationLink(value: Route.product(slug: product.slug)) {
                    ProductTile(product: product, showsBrand: false)
                }
                .buttonStyle(PressableButtonStyle())
            }
            .padding(.horizontal, Spacing.gridGap)
        }
    }

    // MARK: More from the brand

    private var moreFromBrand: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader(
                "More from \(model.brandName)",
                actionTitle: "Visit the storefront",
                action: { router.push(.brand(handle: model.brand?.handle ?? brand)) }
            )
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: Spacing.s) {
                    ForEach(model.others) { other in
                        NavigationLink(value: Route.collection(brand: model.brand?.handle ?? brand, handle: other.handle)) {
                            CollectionCard(collection: other)
                                .frame(width: 280, height: 210)
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
    }
}

// MARK: - Collection card

/// A 4:3 photo card for a collection: name, description and piece count over a bottom scrim.
@MainActor
struct CollectionCard: View {
    let collection: StorefrontCollection

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.yard.surface2
            RemoteImage(url: collection.imageURL, maxPixelSize: 900)
            LinearGradient(
                colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.75)],
                startPoint: .center,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(collection.name)
                    .yardDisplay(26)
                    .foregroundStyle(Color.yard.onPhoto)
                    .lineLimit(2)
                if !collection.description.isEmpty {
                    Text(collection.description)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                        .lineLimit(1)
                }
                Text(ShopText.pieces(collection.productIds.count))
                    .font(.yardMicro)
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.7))
            }
            .padding(Spacing.l)
        }
        .clipShape(.yardCard)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Skeleton

@MainActor
private struct CollectionSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Skeleton(cornerRadius: Radius.card)
                .frame(height: 440)
                .padding(.horizontal, Spacing.gutter)
                .padding(.top, Spacing.s)
            Skeleton(cornerRadius: 4)
                .frame(width: 90, height: 14)
                .padding(.horizontal, Spacing.gutter)
            MasonrySkeleton(count: 4)
                .padding(.horizontal, Spacing.gridGap)
        }
    }
}

// MARK: - Previews

@MainActor
private func collectionPreviewModel() -> CollectionModel {
    let products = PreviewFixtures.products
    let collection = StorefrontCollection(
        id: "col_preview",
        handle: "winter-uniform",
        name: "Winter uniform",
        description: "Heavyweight fleece and wool, cut in Lagos.",
        productIds: products.map { $0.id }
    )
    let others = [
        StorefrontCollection(id: "col_2", handle: "basics", name: "Basics", description: "Everyday pieces.", productIds: ["a", "b"]),
        StorefrontCollection(id: "col_3", handle: "archive", name: "Archive", description: "", productIds: ["c"]),
    ]
    return CollectionModel(
        previewCollection: collection,
        brand: ShopCollectionResponse.Brand(id: "brd_preview", handle: "acme", name: "Acme Studio"),
        products: products,
        others: others
    )
}

#Preview("CollectionView — dark") {
    NavigationStack { CollectionView(previewModel: collectionPreviewModel()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CollectionView — light") {
    NavigationStack { CollectionView(previewModel: collectionPreviewModel()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
