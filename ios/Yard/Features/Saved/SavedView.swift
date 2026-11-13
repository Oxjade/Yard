import SwiftUI
import Observation

// Wishlist ("Saved"), mirroring the website's /wishlist (src/components/market/account/wishlist-view.tsx).
//
//   GET    /api/wishlist                         (SavedStore.load)
//   GET    /api/catalog/products?ids=…&limit=60  (the saved pieces as full products, for tiles)
//   DELETE /api/wishlist/{productId}             (heart / remove, via SavedStore)
//   POST   /api/cart/lines                       (Move to bag, via CartStore), then unsave

enum SavedSort: String, CaseIterable, Identifiable, Hashable {
    case recent
    case priceAsc
    case priceDesc
    case brand
    case inStock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recent: return "Recently saved"
        case .priceAsc: return "Price, low to high"
        case .priceDesc: return "Price, high to low"
        case .brand: return "Brand, A to Z"
        case .inStock: return "In stock first"
        }
    }
}

@Observable
@MainActor
final class SavedViewModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    /// Products by id, fetched for the saved ids.
    private(set) var productsById: [String: Product] = [:]
    /// Ids the catalogue didn't return (unpublished or hidden since saving).
    private(set) var missingIds: Set<String> = []
    /// Product ids currently moving to the bag.
    var busyIds: Set<String> = []
    var sort: SavedSort = .recent

    func load(saved: SavedStore) async {
        if productsById.isEmpty { phase = .loading }
        await saved.load()
        if let error = saved.lastError, saved.items.isEmpty {
            phase = .failed(error.message)
            return
        }
        let ids = saved.items.map(\.productId)
        guard !ids.isEmpty else {
            productsById = [:]
            missingIds = []
            phase = .loaded
            return
        }
        do {
            var found: [String: Product] = [:]
            var start = 0
            while start < ids.count {
                let end = min(start + 60, ids.count)
                let chunk = Array(ids[start..<end])
                var query: [URLQueryItem] = chunk.map { URLQueryItem(name: "ids", value: $0) }
                query.append(URLQueryItem(name: "limit", value: String(chunk.count)))
                let page: ProductsPage = try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
                for product in page.products { found[product.id] = product }
                start = end
            }
            productsById = found
            missingIds = Set(ids.filter { found[$0] == nil })
            phase = .loaded
        } catch {
            if let apiError = error as? APIError, apiError.isCancelled { return }
            if productsById.isEmpty {
                phase = .failed(APIError.message(for: error))
            }
        }
    }

    /// Saved products still in the wishlist, in the chosen order.
    func visibleProducts(saved: SavedStore) -> [Product] {
        let items = saved.items
            .filter { saved.isSaved($0.productId) }
            .sorted { $0.savedAt > $1.savedAt }
        let list: [Product] = items.compactMap { productsById[$0.productId] }
        switch sort {
        case .recent:
            return list
        case .priceAsc:
            return list.sorted { major($0) < major($1) }
        case .priceDesc:
            return list.sorted { major($0) > major($1) }
        case .brand:
            return list.sorted {
                ($0.brand?.name ?? "").localizedCaseInsensitiveCompare($1.brand?.name ?? "") == .orderedAscending
            }
        case .inStock:
            let inStock = list.filter { !$0.isSoldOut }
            let soldOut = list.filter { $0.isSoldOut }
            return inStock + soldOut
        }
    }

    /// Saved items whose product is no longer listed.
    func unlistedItems(saved: SavedStore) -> [WishlistItem] {
        saved.items.filter { saved.isSaved($0.productId) && (missingIds.contains($0.productId) || (!$0.listed && productsById[$0.productId] == nil)) }
    }

    private func major(_ product: Product) -> Double {
        MoneyFormatter.toMajor(product.priceMinor, currency: product.currency)
    }
}

@MainActor
struct SavedView: View {
    init() {}

    @Environment(SessionStore.self) private var session
    @Environment(SavedStore.self) private var saved
    @Environment(CartStore.self) private var cart
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var model = SavedViewModel()
    @State private var sizeSheetProduct: Product? = nil
    @State private var movedCount: Int = 0

    private static let moveButtonHeight: CGFloat = 44

    var body: some View {
        Group {
            if !session.isSignedIn {
                SavedSignInInvite(
                    title: "Wishlist",
                    message: "Sign in to save pieces from any brand and keep them in one place until you're ready.",
                    systemImage: "heart"
                ) { router.present(.signIn) }
            } else {
                content
            }
        }
        .yardScreenBackground()
        .navigationTitle("Wishlist")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.shopper?.id) {
            guard session.isSignedIn else { return }
            await model.load(saved: saved)
        }
        .sheet(item: $sizeSheetProduct) { product in
            SavedVariantSheet(product: product) { variant in
                move(product, variant: variant)
            }
        }
        .sensoryFeedback(.success, trigger: movedCount)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle, .loading:
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    SavedScreenHeader(title: "Wishlist", subtitle: "Pieces you save from any brand wait here until you're ready.")
                    MasonrySkeleton(count: 6)
                        .padding(.horizontal, Spacing.gridGap)
                }
                .padding(.top, Spacing.l)
            }
            .scrollDisabled(true)
        case .failed(let message):
            EmptyState.error(message: message) { await model.load(saved: saved) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            loaded
        }
    }

    private var loaded: some View {
        let products = model.visibleProducts(saved: saved)
        let unlisted = model.unlistedItems(saved: saved)
        let brandCount = Set(products.map(\.brandId)).count
        let soldOut = products.filter { $0.isSoldOut }.count
        let isEmpty = products.isEmpty && unlisted.isEmpty

        return ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                SavedScreenHeader(title: "Wishlist", subtitle: subtitle(count: products.count, brands: brandCount))

                if isEmpty {
                    EmptyState(
                        title: "Nothing saved yet",
                        message: "Tap the heart on any piece to keep it here until you're ready.",
                        systemImage: "heart",
                        actionTitle: "Browse new arrivals",
                        action: { router.push(.shop) }
                    )
                    .frame(minHeight: 320)
                } else {
                    if !products.isEmpty {
                        toolbarRow(count: products.count, soldOut: soldOut)
                        MasonryGrid(products, extraHeight: ProductTile.captionHeight + SavedView.moveButtonHeight + Spacing.s) { product in
                            tile(product)
                        }
                        .padding(.horizontal, Spacing.gridGap)
                        .animation(Motion.spring, value: products.map(\.id))
                    }
                    if !unlisted.isEmpty {
                        unlistedSection(unlisted)
                    }
                    Text("Prices show in the brand's currency. The final price is confirmed at checkout.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .padding(.horizontal, Spacing.gutter)
                }
            }
            .padding(.top, Spacing.l)
            .padding(.bottom, Spacing.xxl)
        }
        .refreshable { await model.load(saved: saved) }
    }

    private func subtitle(count: Int, brands: Int) -> String {
        guard count > 0 else { return "Pieces you save from any brand wait here until you're ready." }
        let pieces = count == 1 ? "piece" : "pieces"
        let brandWord = brands == 1 ? "brand" : "brands"
        return "\(count) saved \(pieces) from \(brands) \(brandWord). Add one to your bag and it moves out of your wishlist."
    }

    private func toolbarRow(count: Int, soldOut: Int) -> some View {
        HStack {
            Text("\(count) \(count == 1 ? "piece" : "pieces")\(soldOut > 0 ? ", \(soldOut) sold out" : "")")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            Spacer()
            Menu {
                Picker("Sort", selection: $model.sort) {
                    ForEach(SavedSort.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
            } label: {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "arrow.up.arrow.down")
                    Text(model.sort.title)
                }
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink)
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.s)
                .background(Color.yard.surface2, in: Capsule())
            }
            .accessibilityLabel(Text("Sort wishlist"))
        }
        .padding(.horizontal, Spacing.gutter)
    }

    private func tile(_ product: Product) -> some View {
        VStack(spacing: Spacing.s) {
            NavigationLink(value: Route.product(slug: product.slug)) {
                ProductTile(product: product)
            }
            .buttonStyle(PressableButtonStyle())
            moveButton(product)
        }
        .transition(.scale(scale: 0.94).combined(with: .opacity))
    }

    @ViewBuilder
    private func moveButton(_ product: Product) -> some View {
        if product.isNotForSale {
            YardButton("Opening soon", style: .secondary, size: .small) {}
                .disabled(true)
                .frame(height: SavedView.moveButtonHeight)
        } else if product.isSoldOut {
            YardButton("Sold out", style: .secondary, size: .small) {}
                .disabled(true)
                .opacity(0.6)
                .frame(height: SavedView.moveButtonHeight)
        } else {
            YardButton("Move to bag", systemImage: "bag", style: .secondary, size: .small, isLoading: model.busyIds.contains(product.id)) {
                startMove(product)
            }
            .frame(height: SavedView.moveButtonHeight)
        }
    }

    private func unlistedSection(_ items: [WishlistItem]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            SectionHeader("No longer available", subtitle: "These pieces were taken down by their brand.")
            Card(padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 {
                            Divider().overlay(Color.yard.line)
                        }
                        HStack(spacing: Spacing.m) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title ?? "Saved piece")
                                    .font(.yardBodyEmphasis)
                                    .foregroundStyle(Color.yard.ink)
                                    .lineLimit(1)
                                if let brandName = item.brandName {
                                    Text(brandName)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink2)
                                }
                            }
                            Spacer()
                            Button {
                                remove(item.productId)
                            } label: {
                                Image(systemName: "heart.slash")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.yard.ink)
                                    .frame(width: 36, height: 36)
                                    .background(Color.yard.surface2, in: Circle())
                            }
                            .buttonStyle(PressableButtonStyle())
                            .accessibilityLabel(Text("Remove from wishlist"))
                        }
                        .padding(Spacing.m)
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    // MARK: Actions

    private func startMove(_ product: Product) {
        let inStock = product.variants.filter { $0.inStock && $0.available > 0 }
        if product.variants.count == 1, let only = inStock.first {
            move(product, variant: only)
        } else if inStock.isEmpty {
            toast.show("This piece is sold out.", style: .info)
        } else {
            sizeSheetProduct = product
        }
    }

    private func move(_ product: Product, variant: ProductVariant) {
        let productId = product.id
        let variantId = variant.id
        model.busyIds.insert(productId)
        Task { @MainActor in
            defer { model.busyIds.remove(productId) }
            do {
                try await cart.add(variantId: variantId, qty: 1)
            } catch {
                toast.show(error)
                return
            }
            do {
                try await saved.setSaved(false, productId: productId)
            } catch {
                // The piece is in the bag; it just stayed saved.
            }
            movedCount += 1
            toast.show("Moved to your bag", style: .success, systemImage: "bag.fill")
        }
    }

    private func remove(_ productId: String) {
        Task { @MainActor in
            do {
                try await saved.setSaved(false, productId: productId)
            } catch {
                toast.show(error)
            }
        }
    }
}

#Preview("SavedView — dark") {
    NavigationStack { SavedView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SavedView — light") {
    NavigationStack { SavedView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("SavedView — signed out") {
    NavigationStack { SavedView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}
