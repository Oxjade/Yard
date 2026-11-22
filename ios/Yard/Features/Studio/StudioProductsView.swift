import SwiftUI
import Observation

/// The Live / Draft pills (`status` query values).
enum StudioProductFilter: String, CaseIterable, Hashable, Sendable {
    case all
    case published
    case draft

    var title: String {
        switch self {
        case .all: return "All"
        case .published: return "Live"
        case .draft: return "Drafts"
        }
    }
}

@Observable
@MainActor
final class StudioProductsModel {
    private(set) var products: [StudioProduct] = []
    private(set) var total: Int = 0
    private(set) var nextOffset: Int?
    private(set) var loading: Bool = false
    private(set) var loadingMore: Bool = false
    private(set) var error: String?
    private(set) var loadedKey: String?
    private(set) var pieces: Int = 0
    private(set) var suggestions: [StudioProposal] = []

    func load(studio: StudioStore, filter: StudioProductFilter, q: String, lowStock: Bool, force: Bool) async {
        let key = "\(filter.rawValue)|\(q)|\(lowStock)"
        if !force, loadedKey == key { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await studio.call { try await StudioAPI.products(status: filter.rawValue, q: q, lowStock: lowStock, offset: 0) }
            products = page.products
            total = page.total
            nextOffset = page.nextOffset
            loadedKey = key
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
        if let site = try? await studio.call({ try await StudioAPI.websitePieces() }) {
            pieces = site.count
            studio.websitePieces = site.count
        }
        if let list = try? await studio.call({ try await StudioAPI.suggestions(status: "pending") }) {
            suggestions = list.pending
            studio.suggestionsPending = list.pending.count
        }
    }

    func loadMore(studio: StudioStore, filter: StudioProductFilter, q: String, lowStock: Bool) async {
        guard let offset = nextOffset, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let page = try? await studio.call({ try await StudioAPI.products(status: filter.rawValue, q: q, lowStock: lowStock, offset: offset) }) {
            let known = Set(products.map(\.id))
            products.append(contentsOf: page.products.filter { !known.contains($0.id) })
            nextOffset = page.nextOffset
        }
    }

    func replace(_ product: StudioProduct) {
        products = products.map { $0.id == product.id ? product : $0 }
    }
}

/// Studio › Products: Live/Draft pills, search, low stock, rows with stock and status; the
/// website pieces banner.
@MainActor
struct StudioProductsView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = StudioProductsModel()
    @State private var filter: StudioProductFilter = .all
    @State private var search: String = ""
    @State private var query: String = ""
    @State private var lowStock: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                HStack {
                    Text("Products")
                        .yardDisplay(40)
                        .foregroundStyle(Color.yard.ink)
                    Spacer()
                    GlassIconButton(systemImage: "plus", accessibilityLabel: "Add a product") {
                        Haptics.impact(.light)
                        studio.isQuickAddPresented = true
                    }
                }
                filters
                searchField
                if !model.suggestions.isEmpty {
                    suggestionsBanner
                }
                if model.pieces > 0 {
                    piecesBanner
                }
                content
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await model.load(studio: studio, filter: filter, q: query, lowStock: lowStock, force: true)
        }
        .task(id: "\(studio.activeBrandId ?? "")|\(filter.rawValue)|\(query)|\(lowStock)|\(studio.dataVersion)") {
            await model.load(studio: studio, filter: filter, q: query, lowStock: lowStock, force: model.loadedKey != nil)
        }
        .onChange(of: studio.lowStockFilterRequested, initial: true) { _, requested in
            guard requested else { return }
            studio.lowStockFilterRequested = false
            lowStock = true
            filter = .all
        }
        .onChange(of: search) { _, value in
            // A light debounce: search once typing pauses.
            let snapshot = value
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 350_000_000)
                if snapshot == search { query = snapshot.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
        }
    }

    private var filters: some View {
        HStack(spacing: Spacing.s) {
            ForEach(StudioProductFilter.allCases, id: \.self) { f in
                Chip(f.title, isSelected: filter == f) {
                    Haptics.selection()
                    withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { filter = f }
                }
            }
            Chip("Low stock", systemImage: "exclamationmark.triangle", isSelected: lowStock) {
                Haptics.selection()
                lowStock.toggle()
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "magnifyingglass").foregroundStyle(Color.yard.ink3)
            TextField("Search your products", text: $search)
                .font(.yardBody)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { query = search.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
        .padding(.horizontal, Spacing.m)
        .frame(height: 44)
        .background(Color.yard.surface2, in: Capsule())
    }

    private var suggestionsBanner: some View {
        let n = model.suggestions.count
        let allNew = model.suggestions.allSatisfy { $0.isNew }
        return Button {
            Haptics.selection()
            studio.push(.suggestions(focusAcceptAll: false))
        } label: {
            HStack(spacing: Spacing.m) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.yard.onAcid)
                    .frame(width: 40, height: 40)
                    .background(Color.yard.acid, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Suggestions from Yard")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                    Text(StudioBatchCopy.preparedLine(n, allNew: allNew))
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Color.yard.ink3)
            }
            .padding(Spacing.m)
            .yardCard()
        }
        .buttonStyle(PressableButtonStyle())
    }

    private var piecesBanner: some View {
        Button {
            Haptics.selection()
            studio.push(.websitePieces)
        } label: {
            HStack(spacing: Spacing.m) {
                Image(systemName: "globe")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.yard.onPhoto)
                    .frame(width: 40, height: 40)
                    .background(Color.yard.studio, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.pieces) new from your website")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                    Text("Add them to Yard or skip them.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Color.yard.ink3)
            }
            .padding(Spacing.m)
            .yardCard()
        }
        .buttonStyle(PressableButtonStyle())
    }

    @ViewBuilder
    private var content: some View {
        if model.loading && model.products.isEmpty {
            StudioRowsSkeleton()
        } else if let error = model.error, model.products.isEmpty {
            EmptyState.error(message: error) { await model.load(studio: studio, filter: filter, q: query, lowStock: lowStock, force: true) }
        } else if model.products.isEmpty {
            if query.isEmpty {
                EmptyState(
                    title: "No products here yet",
                    message: "Add your first product with a photo, a name and a price.",
                    systemImage: "square.grid.2x2",
                    actionTitle: "Add a product"
                ) {
                    studio.isQuickAddPresented = true
                }
            } else {
                EmptyState(title: "Nothing matches “\(query)”", systemImage: "magnifyingglass")
            }
        } else {
            LazyVStack(spacing: Spacing.s) {
                ForEach(model.products) { product in
                    Button {
                        Haptics.selection()
                        studio.push(.product(id: product.id))
                    } label: {
                        StudioProductRow(product: product)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
                if model.nextOffset != nil {
                    YardButton("Load more", style: .secondary, size: .medium, isLoading: model.loadingMore) {
                        Task { @MainActor in await model.loadMore(studio: studio, filter: filter, q: query, lowStock: lowStock) }
                    }
                }
            }
        }
    }
}

struct StudioProductRow: View {
    let product: StudioProduct

    var body: some View {
        HStack(spacing: Spacing.m) {
            RemoteImage(url: product.imageURL, contentMode: .fill, maxPixelSize: 200) {
                BrandArtwork(name: product.title, style: .initials)
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(product.title)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Text(product.price)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                Text(product.available > 0 ? "\(product.available) in stock" : "Out of stock")
                    .font(.yardCaption)
                    .foregroundStyle(product.available > 0 ? Color.yard.ink3 : Color.yard.danger)
            }
            Spacer()
            Tag(StudioProductState.label(product.status), style: StudioProductState.style(product.status))
        }
        .padding(Spacing.m)
        .yardCard()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Product detail

@Observable
@MainActor
final class StudioProductDetailModel {
    let productId: String
    private(set) var product: StudioProduct?
    private(set) var error: String?
    private(set) var publishing: Bool = false
    /// Variants with a stock change on the way.
    private(set) var adjusting: Set<String> = []
    var actionError: String?

    init(productId: String) {
        self.productId = productId
    }

    func load(studio: StudioStore) async {
        do {
            let id = productId
            product = try await studio.call { try await StudioAPI.product(id) }
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }

    /// +1 / −1 on a variant (optimistic; reverted on failure).
    func adjust(_ variant: StudioVariant, by delta: Int, studio: StudioStore) async -> Bool {
        guard let product, !adjusting.contains(variant.id) else { return false }
        let optimistic = variant.with(onHand: max(0, variant.onHand + delta), held: variant.held, available: max(0, variant.available + delta))
        self.product = product.replacing(optimistic)
        adjusting.insert(variant.id)
        defer { adjusting.remove(variant.id) }
        do {
            let id = variant.id
            let result = try await studio.call { try await StudioAPI.adjustStock(variantId: id, by: delta) }
            if let current = self.product {
                self.product = current.replacing(variant.with(onHand: result.onHand, held: result.held, available: result.available))
            }
            return true
        } catch {
            if let current = self.product { self.product = current.replacing(variant) }
            actionError = APIError.message(for: error)
            return false
        }
    }

    func setStatus(_ action: String, studio: StudioStore) async -> Bool {
        guard let product else { return false }
        publishing = true
        actionError = nil
        defer { publishing = false }
        do {
            let id = product.id
            let version = product.version
            self.product = try await studio.call { try await StudioAPI.setStatus(productId: id, action: action, version: version) }
            studio.bumpData()
            return true
        } catch let api as APIError where api.isConflict {
            // Changed elsewhere: reload so the next try has the new version.
            await load(studio: studio)
            actionError = "This product changed somewhere else. It's up to date now; try again."
            return false
        } catch {
            actionError = APIError.message(for: error)
            return false
        }
    }
}

/// Studio › Product: photos, price, status, stock per variant with +/− (haptics), slide to
/// publish or unpublish, share.
@MainActor
struct StudioProductDetailView: View {
    let productId: String

    @Environment(StudioStore.self) private var studio
    @Environment(ToastCenter.self) private var toast

    @State private var model: StudioProductDetailModel

    init(productId: String) {
        self.productId = productId
        _model = State(initialValue: StudioProductDetailModel(productId: productId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if let product = model.product {
                    photos(product)
                    summary(product)
                    stock(product)
                    publish(product)
                } else if let error = model.error {
                    EmptyState.error(message: error) { await model.load(studio: studio) }
                } else {
                    Skeleton(cornerRadius: Radius.card).frame(height: 280)
                    StudioRowsSkeleton(count: 2)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .yardScreenBackground()
        .navigationTitle(model.product?.title ?? "Product")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let product = model.product, product.isLive {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: Config.webURL("/products/\(product.slug)")) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel(Text("Share"))
                }
            }
        }
        .refreshable { await model.load(studio: studio) }
        .task { await model.load(studio: studio) }
    }

    private func photos(_ product: StudioProduct) -> some View {
        TabView {
            if product.images.isEmpty {
                BrandArtwork(name: product.title)
            } else {
                ForEach(product.images) { image in
                    RemoteImage(url: image.url, contentMode: .fill, maxPixelSize: 1200) {
                        BrandArtwork(name: product.title)
                    }
                    .accessibilityLabel(Text(image.alt.isEmpty ? product.title : image.alt))
                }
            }
        }
        .tabViewStyle(.page(indexDisplayMode: product.images.count > 1 ? .automatic : .never))
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private func summary(_ product: StudioProduct) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Tag(StudioProductState.label(product.status), style: StudioProductState.style(product.status))
                if let moderation = product.moderationStatus, moderation != "approved", moderation != "none", !moderation.isEmpty {
                    Tag(moderation.replacingOccurrences(of: "_", with: " ").capitalized, style: .violet)
                }
                Spacer()
            }
            Text(product.title)
                .yardDisplay(34)
                .foregroundStyle(Color.yard.ink)
            Text(product.price)
                .font(.yardTitle)
                .foregroundStyle(Color.yard.ink)
            if let reason = product.moderationReason, !reason.isEmpty {
                Text(reason)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
    }

    private func stock(_ product: StudioProduct) -> some View {
        let canAdjust = studio.can(StudioPermission.ordersFulfil)
        return StudioGroup("Stock") {
            ForEach(product.variants) { variant in
                HStack(spacing: Spacing.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(variant.label.isEmpty ? "Stock" : variant.label)
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.ink)
                        Text(variant.held > 0 ? "\(variant.onHand) on hand · \(variant.held) held" : "\(variant.onHand) on hand")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                    }
                    Spacer()
                    if canAdjust {
                        StudioStockStepper(
                            value: variant.available,
                            busy: model.adjusting.contains(variant.id)
                        ) { delta in
                            Task { @MainActor in
                                if !(await model.adjust(variant, by: delta, studio: studio)) {
                                    Haptics.error()
                                    if let message = model.actionError { toast.show(message, style: .error) }
                                }
                            }
                        }
                    } else {
                        Text("\(variant.available)")
                            .font(.yardNumber(18))
                            .foregroundStyle(Color.yard.ink)
                    }
                }
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: 60)
            }
        }
    }

    @ViewBuilder
    private func publish(_ product: StudioProduct) -> some View {
        if studio.can(StudioPermission.contentPublish) {
            VStack(alignment: .leading, spacing: Spacing.m) {
                if let error = model.actionError {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if product.isLive {
                    YardButton("Unpublish", systemImage: "eye.slash", style: .secondary, isLoading: model.publishing) {
                        Haptics.impact(.medium)
                        Task { @MainActor in
                            if await model.setStatus("unpublish", studio: studio) {
                                Haptics.success()
                                toast.show("Unpublished. It's a draft now.", style: .success)
                            } else {
                                Haptics.error()
                            }
                        }
                    }
                } else if product.status == "draft" || product.status == "scheduled" {
                    if studio.activeBrand?.isPending ?? false {
                        Text("You can publish once Yard approves your shop.")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                    } else {
                        SlideToConfirm("Slide to publish", systemImage: "sparkles", isLoading: model.publishing) {
                            Task { @MainActor in
                                if await model.setStatus("publish", studio: studio) {
                                    toast.show("Live on Yard", style: .success)
                                } else {
                                    Haptics.error()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// − count + for stock, with a haptic on every step.
struct StudioStockStepper: View {
    let value: Int
    var busy: Bool = false
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            button("minus", delta: -1, label: "Remove one")
                .disabled(value <= 0)
            Text("\(value)")
                .font(.yardNumber(17))
                .foregroundStyle(Color.yard.ink)
                .frame(minWidth: 36)
                .contentTransition(.numericText(value: Double(value)))
                .animation(Motion.snappy, value: value)
            button("plus", delta: 1, label: "Add one")
        }
        .padding(3)
        .background(Color.yard.surface2, in: Capsule())
        .opacity(busy ? 0.6 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text("\(value) available"))
    }

    private func button(_ icon: String, delta: Int, label: String) -> some View {
        Button {
            if delta > 0 { Haptics.impact(.light) } else { Haptics.selection() }
            onChange(delta)
        } label: {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 36, height: 36)
                .background(Color.yard.surface, in: Circle())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.9))
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Website pieces

@Observable
@MainActor
final class StudioWebsitePiecesModel {
    private(set) var data: StudioSitePieces?
    private(set) var error: String?
    private(set) var working: Set<String> = []
    private(set) var addingAll: Bool = false
    /// Why a piece was skipped by the last Add all (else the piece's own `error`).
    private(set) var reasons: [String: String] = [:]
    var selected: Set<String> = []
    private var keys = StudioBatchKeys()

    func reason(for piece: StudioSitePiece) -> String? {
        reasons[piece.id] ?? piece.error
    }

    /// Add `ids` (the selected pieces) or every waiting piece (nil). A retry after a dropped
    /// answer reuses the key, so nothing is added twice.
    func addAll(ids: [String]?, studio: StudioStore) async -> Result<StudioBatchResult, APIError> {
        guard !addingAll else { return .failure(APIError(status: 0, code: "busy", message: "One moment, the last batch is still running.")) }
        let chosen: [String]? = ids.map { Array($0.prefix(100)) }
        let key = keys.key(for: StudioBatchKeys.signature(action: "add", ids: chosen))
        let body = StudioBatchBody(ids: chosen, idempotencyKey: key)
        addingAll = true
        defer { addingAll = false }
        do {
            let result = try await studio.call { try await StudioAPI.addAllWebsitePieces(body) }
            keys.settle(nil)
            data = result.pieces
            studio.websitePieces = result.pieces.count
            var next = reasons
            for id in result.batch.accepted { next[id] = nil }
            for skip in result.batch.skipped { next[skip.id] = skip.reason }
            reasons = next
            let open = Set(result.pieces.items.filter { !$0.taken }.map(\.id))
            selected = selected.intersection(open)
            studio.bumpData()
            return .success(result.batch)
        } catch {
            keys.settle(error)
            return .failure((error as? APIError) ?? APIError(status: 0, code: "network", message: APIError.message(for: error)))
        }
    }

    func load(studio: StudioStore) async {
        do {
            data = try await studio.call { try await StudioAPI.websitePieces() }
            studio.websitePieces = data?.count ?? 0
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }

    func act(_ piece: StudioSitePiece, action: String, studio: StudioStore) async -> String? {
        working.insert(piece.id)
        defer { working.remove(piece.id) }
        do {
            let id = piece.id
            data = try await studio.call { try await StudioAPI.websitePiece(id, action: action) }
            studio.websitePieces = data?.count ?? 0
            studio.bumpData()
            return nil
        } catch {
            await load(studio: studio)
            return APIError.message(for: error)
        }
    }
}

/// Studio › New from your website: Add all (N), select mode with Add selected, and Add / Skip
/// each piece the importer found. A piece the batch couldn't add shows its reason.
@MainActor
struct StudioWebsitePiecesView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(ToastCenter.self) private var toast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = StudioWebsitePiecesModel()
    @State private var selecting: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.m) {
                if let data = model.data {
                    if let site = data.site {
                        Text("From \(site)")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                    }
                    let open = data.items.filter { !$0.taken }
                    if open.isEmpty {
                        EmptyState(title: "You're up to date", message: "New products from your website show here.", systemImage: "globe")
                    } else {
                        if data.mayAdd {
                            batchActions(open)
                        }
                        ForEach(open) { piece in
                            pieceRow(piece, mayAdd: data.mayAdd)
                        }
                    }
                } else if let error = model.error {
                    EmptyState.error(message: error) { await model.load(studio: studio) }
                } else {
                    StudioRowsSkeleton(count: 4)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .yardScreenBackground()
        .navigationTitle("New from your website")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let data = model.data, data.mayAdd, data.items.contains(where: { !$0.taken }) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selecting ? "Done" : "Select") {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
                            selecting.toggle()
                            if !selecting { model.selected = [] }
                        }
                    }
                }
            }
        }
        .refreshable { await model.load(studio: studio) }
        .task { await model.load(studio: studio) }
    }

    @ViewBuilder
    private func batchActions(_ open: [StudioSitePiece]) -> some View {
        let picked = open.filter { model.selected.contains($0.id) }.map(\.id)
        VStack(alignment: .leading, spacing: Spacing.s) {
            if selecting {
                YardButton("Add selected (\(picked.count))", systemImage: "plus", style: .primary, size: .medium, isLoading: model.addingAll) {
                    Haptics.impact(.medium)
                    addAll(picked)
                }
                .disabled(picked.isEmpty || model.addingAll)
                .opacity(picked.isEmpty ? 0.6 : 1)
                Button(picked.count == open.count ? "Clear selection" : "Select all \(open.count)") {
                    Haptics.selection()
                    model.selected = picked.count == open.count ? [] : Set(open.map(\.id))
                }
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.violet)
            } else {
                YardButton(StudioBatchCopy.addAll(open.count), systemImage: "plus.square.on.square", style: .primary, isLoading: model.addingAll) {
                    Haptics.impact(.medium)
                    addAll(nil)
                }
                .disabled(model.addingAll)
                Text("Each piece is added on its own, with its photos. Skip the ones you don't want first.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
    }

    private func addAll(_ ids: [String]?) {
        Task { @MainActor in
            switch await model.addAll(ids: ids, studio: studio) {
            case .success(let result):
                if !result.accepted.isEmpty {
                    Haptics.success()
                    toast.show(StudioBatchCopy.result("Added", result), style: .success, systemImage: "checkmark")
                } else {
                    Haptics.warning()
                    toast.show(StudioBatchCopy.result("Added", result), style: .info)
                }
                if model.data?.items.contains(where: { !$0.taken }) != true { selecting = false }
            case .failure(let error):
                Haptics.error()
                toast.show(error.message, style: .error)
            }
        }
    }

    private func pieceRow(_ piece: StudioSitePiece, mayAdd: Bool) -> some View {
        let isSelected = model.selected.contains(piece.id)
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(spacing: Spacing.m) {
                if selecting {
                    Button {
                        Haptics.selection()
                        if isSelected { model.selected.remove(piece.id) } else { model.selected.insert(piece.id) }
                    } label: {
                        StudioSelectMark(isSelected: isSelected)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(isSelected ? "Deselect \(piece.title)" : "Select \(piece.title)"))
                }
                RemoteImage(url: piece.imageURL, contentMode: .fill, maxPixelSize: 240) {
                    BrandArtwork(name: piece.title, style: .initials)
                }
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(piece.title)
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(2)
                    if let price = piece.yardPriceMinor ?? piece.priceMinor {
                        Text(Formatters.price(minor: price, currency: piece.currency))
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                    }
                    if !piece.sizes.isEmpty {
                        Text(piece.sizes.joined(separator: " · "))
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            if let reason = model.reason(for: piece), !reason.isEmpty {
                Label(reason, systemImage: "exclamationmark.circle.fill")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if mayAdd && !selecting {
                HStack(spacing: Spacing.s) {
                    YardButton("Skip", style: .secondary, size: .small, isLoading: false) {
                        Haptics.selection()
                        act(piece, "skip")
                    }
                    YardButton("Add", systemImage: "plus", style: .primary, size: .small, isLoading: model.working.contains(piece.id)) {
                        Haptics.impact(.medium)
                        act(piece, "add")
                    }
                }
            }
        }
        .padding(Spacing.m)
        .yardCard()
    }

    private func act(_ piece: StudioSitePiece, _ action: String) {
        Task { @MainActor in
            if let error = await model.act(piece, action: action, studio: studio) {
                Haptics.error()
                toast.show(error, style: .error)
            } else if action == "add" {
                Haptics.success()
                toast.show("Added to your products", style: .success)
            }
        }
    }
}
