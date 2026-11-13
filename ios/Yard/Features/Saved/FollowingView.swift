import SwiftUI
import Observation

// Following feed, mirroring the website's production /following
// (src/components/market/account/live-following-feed.tsx).
//
//   GET    /api/follows                                         (FollowStore.load)
//   GET    /api/catalog/products?brand={brandId}&sort=new&limit=6   per followed brand (max 24 brands)
//   GET    /api/drops?phase=live&source=brands&limit=50         } filtered to followed brands
//   GET    /api/drops?phase=upcoming&source=brands&limit=50     }
//   GET    /api/catalog/brands?sort=new&limit=8                 suggestions
//   POST/DELETE /api/follows                                    (FollowStore.setFollowing)

@Observable
@MainActor
final class FollowingViewModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    nonisolated static let perBrand: Int = 6
    nonisolated static let page: Int = 12
    nonisolated static let maxBrands: Int = 24

    private(set) var phase: Phase = .idle
    /// "You follow" rows, kept stable for the visit: unfollowing flips the button instead of
    /// pulling the row away (same rule as the website).
    private(set) var rows: [FollowedBrand] = []
    /// Newest pieces from followed brands; nil while loading.
    private(set) var pieces: [Product]? = nil
    private(set) var drops: [Drop] = []
    private(set) var suggested: [BrandCard]? = nil
    var limit: Int = FollowingViewModel.page

    /// - Parameter keepRows: keep this visit's "You follow" rows (unfollowed ones stay, showing
    ///   Follow) and append new follows; false on first load and pull to refresh.
    func load(follows: FollowStore, keepRows: Bool = false) async {
        if rows.isEmpty { phase = .loading }
        await follows.load()
        if let error = follows.lastError, follows.items.isEmpty {
            phase = .failed(error.message)
            return
        }
        let items = follows.items
        if keepRows {
            var merged = rows
            for item in items where !merged.contains(where: { $0.brandId == item.brandId }) {
                merged.append(item)
            }
            rows = merged
        } else {
            rows = items
        }
        phase = .loaded

        async let suggestionsTask: [BrandCard] = FollowingViewModel.fetchSuggestions()
        let brandIds: [String] = Array(items.prefix(FollowingViewModel.maxBrands).map(\.brandId))
        async let piecesTask: [Product] = FollowingViewModel.fetchPieces(brandIds: brandIds)
        async let dropsTask: [Drop] = FollowingViewModel.fetchDrops(brandIds: Set(items.map(\.brandId)))

        let newPieces = await piecesTask
        let newDrops = await dropsTask
        let newSuggestions = await suggestionsTask
        pieces = newPieces
        drops = newDrops
        suggested = newSuggestions
        limit = FollowingViewModel.page
    }

    func suggestions(excluding follows: FollowStore) -> [BrandCard] {
        let rowIds = Set(rows.map(\.brandId))
        return (suggested ?? []).filter { !rowIds.contains($0.id) && !follows.isFollowing($0.id) }.prefix(4).map { $0 }
    }

    func brandName(for drop: Drop) -> String {
        if let name = drop.brand.name, !name.isEmpty { return name }
        return rows.first { $0.brandId == drop.brand.id }?.name ?? ""
    }

    // MARK: Fetching (nonisolated, so per-brand requests run in parallel)

    nonisolated static func fetchPieces(brandIds: [String]) async -> [Product] {
        guard !brandIds.isEmpty else { return [] }
        let all: [Product] = await withTaskGroup(of: [Product].self) { group in
            for brandId in brandIds {
                group.addTask {
                    let query: [URLQueryItem] = [
                        URLQueryItem(name: "brand", value: brandId),
                        URLQueryItem(name: "sort", value: "new"),
                        URLQueryItem(name: "limit", value: String(FollowingViewModel.perBrand)),
                    ]
                    do {
                        let page: ProductsPage = try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
                        return page.products
                    } catch {
                        return []
                    }
                }
            }
            var collected: [Product] = []
            for await products in group { collected.append(contentsOf: products) }
            return collected
        }
        return all.sorted { ($0.publishedAt ?? $0.createdAt) > ($1.publishedAt ?? $1.createdAt) }
    }

    nonisolated static func fetchDrops(brandIds: Set<String>) async -> [Drop] {
        guard !brandIds.isEmpty else { return [] }
        var result: [Drop] = []
        for phase in ["live", "upcoming"] {
            let query: [URLQueryItem] = [
                URLQueryItem(name: "phase", value: phase),
                URLQueryItem(name: "source", value: "brands"),
                URLQueryItem(name: "limit", value: "50"),
            ]
            if let page = try? await APIClient.shared.get("/api/drops", query: query, as: DropsPage.self) {
                result.append(contentsOf: page.items.filter { brandIds.contains($0.brand.id) })
            }
        }
        var seen: Set<String> = []
        return result.filter { seen.insert($0.id).inserted }
    }

    nonisolated static func fetchSuggestions() async -> [BrandCard] {
        let query: [URLQueryItem] = [
            URLQueryItem(name: "sort", value: "new"),
            URLQueryItem(name: "limit", value: "8"),
        ]
        let page = try? await APIClient.shared.get("/api/catalog/brands", query: query, as: BrandsPage.self)
        return page?.brands ?? []
    }
}

@MainActor
struct FollowingView: View {
    init() {}

    @Environment(SessionStore.self) private var session
    @Environment(FollowStore.self) private var follows
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var model = FollowingViewModel()
    @State private var busyBrandIds: Set<String> = []
    @State private var followTick: Int = 0

    var body: some View {
        Group {
            if !session.isSignedIn {
                SavedSignInInvite(
                    title: "Following",
                    message: "Follow brands and their new pieces, collections, drop announcements and stories arrive here, in the order they happen. Sign in to start.",
                    systemImage: "dot.radiowaves.up.forward"
                ) { router.present(.signIn) }
            } else {
                content
            }
        }
        .yardScreenBackground()
        .navigationTitle("Following")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.shopper?.id) {
            guard session.isSignedIn else { return }
            await model.load(follows: follows)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: followTick)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle, .loading:
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    header
                    FollowingAvatarSkeleton()
                    MasonrySkeleton(count: 4)
                        .padding(.horizontal, Spacing.gridGap)
                }
                .padding(.top, Spacing.l)
            }
            .scrollDisabled(true)
        case .failed(let message):
            EmptyState(
                title: "Your feed couldn't be loaded",
                message: message,
                systemImage: "wifi.exclamationmark",
                actionTitle: "Retry",
                action: { Task { @MainActor in await model.load(follows: follows) } }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            loaded
        }
    }

    private var header: some View {
        let n = model.rows.count
        let subtitle: String = n > 0
            ? "New pieces and drops from the \(n == 1 ? "brand" : "\(n) brands") you follow, newest first."
            : "Updates from the brands you follow, in the order they happen."
        return SavedScreenHeader(title: "Following", subtitle: subtitle)
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                header
                if model.rows.isEmpty {
                    EmptyState(
                        title: "You're not following any brands yet",
                        message: "Follow a few and their new pieces land here, newest first.",
                        systemImage: "dot.radiowaves.up.forward",
                        actionTitle: "Browse brands",
                        action: { router.push(.brandsDirectory) }
                    )
                    .frame(minHeight: 300)
                } else {
                    followRow
                    dropsRail
                    piecesSection
                }
                suggestionsSection
            }
            .padding(.top, Spacing.l)
            .padding(.bottom, Spacing.xxl)
        }
        .refreshable { await model.load(follows: follows) }
    }

    // MARK: You follow (avatars)

    private var followRow: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            SectionHeader("You follow", subtitle: "\(follows.followedIds.count) \(follows.followedIds.count == 1 ? "brand" : "brands")")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: Spacing.l) {
                    ForEach(model.rows) { brand in
                        followedBrandCell(brand)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
    }

    private func followedBrandCell(_ brand: FollowedBrand) -> some View {
        let isFollowing = follows.isFollowing(brand.brandId)
        let isBusy = busyBrandIds.contains(brand.brandId)
        return VStack(spacing: Spacing.s) {
            NavigationLink(value: Route.brand(handle: brand.handle)) {
                VStack(spacing: Spacing.xs) {
                    BrandAvatar(name: brand.name, size: 64, verified: brand.verified)
                        .opacity(isFollowing ? 1 : 0.5)
                    Text(brand.name)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                }
            }
            .buttonStyle(PressableButtonStyle())
            Button {
                setFollowing(!isFollowing, brandId: brand.brandId, name: brand.name)
            } label: {
                Group {
                    if isBusy {
                        ProgressView().controlSize(.mini)
                    } else {
                        Text(isFollowing ? "Following" : "Follow")
                    }
                }
                .font(.yardMicro)
                .foregroundStyle(isFollowing ? Color.yard.ink : Color.yard.onAcid)
                .frame(width: 72, height: 26)
                .background(isFollowing ? Color.yard.surface2 : Color.yard.acid, in: Capsule())
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(isBusy)
            .accessibilityLabel(Text(isFollowing ? "Unfollow \(brand.name)" : "Follow \(brand.name)"))
        }
        .frame(width: 76)
        .contextMenu {
            Button {
                router.push(.brand(handle: brand.handle))
            } label: {
                Label("View brand", systemImage: "storefront")
            }
            if isFollowing {
                Button(role: .destructive) {
                    setFollowing(false, brandId: brand.brandId, name: brand.name)
                } label: {
                    Label("Unfollow", systemImage: "person.badge.minus")
                }
            }
        }
    }

    // MARK: Drops

    @ViewBuilder
    private var dropsRail: some View {
        let followedDrops = model.drops.filter { follows.isFollowing($0.brand.id) }
        if !followedDrops.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                SectionHeader("Drops", subtitle: "Live and coming up from brands you follow")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Spacing.m) {
                        ForEach(followedDrops) { drop in
                            NavigationLink(value: Route.drop(id: drop.slug.isEmpty ? drop.id : drop.slug)) {
                                FollowingDropCard(drop: drop, brandName: model.brandName(for: drop))
                            }
                            .buttonStyle(PressableButtonStyle())
                        }
                    }
                    .padding(.horizontal, Spacing.gutter)
                }
            }
        }
    }

    // MARK: New pieces

    @ViewBuilder
    private var piecesSection: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            SectionHeader("New pieces")
            if let pieces = model.pieces {
                if pieces.isEmpty {
                    EmptyState(
                        title: "Brands you follow will post here",
                        message: "Their new pieces appear here the day they're published.",
                        systemImage: "sparkles"
                    )
                    .frame(minHeight: 240)
                } else {
                    let shown = Array(pieces.prefix(model.limit))
                    MasonryGrid(shown) { product in
                        NavigationLink(value: Route.product(slug: product.slug)) {
                            ProductTile(product: product)
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                    .padding(.horizontal, Spacing.gridGap)
                    if pieces.count > model.limit {
                        YardButton("Show more", style: .secondary, size: .medium, fullWidth: false) {
                            withAnimation(Motion.spring) { model.limit += FollowingViewModel.page }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, Spacing.s)
                    }
                }
            } else {
                MasonrySkeleton(count: 4)
                    .padding(.horizontal, Spacing.gridGap)
            }
        }
    }

    // MARK: Suggestions

    @ViewBuilder
    private var suggestionsSection: some View {
        let list = model.suggestions(excluding: follows)
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                SectionHeader(
                    model.rows.isEmpty ? "Brands to start with" : "More brands on Yard",
                    subtitle: "Independent studios with their own storefront on Yard.",
                    actionTitle: "All brands",
                    action: { router.push(.brandsDirectory) }
                )
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(list.enumerated()), id: \.element.id) { index, brand in
                            if index > 0 { Divider().overlay(Color.yard.line) }
                            suggestionRow(brand)
                        }
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
    }

    private func suggestionRow(_ brand: BrandCard) -> some View {
        let isBusy = busyBrandIds.contains(brand.id)
        return HStack(spacing: Spacing.m) {
            NavigationLink(value: Route.brand(handle: brand.handle)) {
                HStack(spacing: Spacing.m) {
                    BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 44, verified: brand.verified)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(brand.name)
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.ink)
                            .lineLimit(1)
                        if !brand.locationText.isEmpty {
                            Text(brand.locationText)
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink2)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())
            YardButton("Follow", style: .primary, size: .small, isLoading: isBusy, fullWidth: false) {
                setFollowing(true, brandId: brand.id, name: brand.name)
            }
        }
        .padding(Spacing.m)
    }

    // MARK: Actions

    private func setFollowing(_ follow: Bool, brandId: String, name: String) {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        busyBrandIds.insert(brandId)
        Task { @MainActor in
            defer { busyBrandIds.remove(brandId) }
            do {
                try await follows.setFollowing(follow, brandId: brandId)
                followTick += 1
                toast.show(follow ? "Following \(name)" : "Unfollowed \(name)", style: .success)
                if follow {
                    // Pull the new brand into the feed.
                    await model.load(follows: follows, keepRows: true)
                }
            } catch {
                toast.show(error)
            }
        }
    }
}

#Preview("FollowingView — dark") {
    NavigationStack { FollowingView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("FollowingView — light") {
    NavigationStack { FollowingView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("FollowingView — signed out") {
    NavigationStack { FollowingView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
