import SwiftUI

/// Home: Pinterest-style discovery. Yard logo + notifications/inbox at the top, tabs
/// ("For you", "Following" when signed in, then every category with pieces), and an infinite
/// two-column masonry of products mixed with brand and drop tiles.
///
/// Endpoints: GET /api/catalog/categories, /api/catalog/products, /api/catalog/brands
/// (sort=new; founding=1), /api/drops?phase=live|upcoming, /api/follows (via FollowStore),
/// /api/notifications?as=shopper and /api/inbox/unread (badges, signed in only).
@MainActor
struct HomeView: View {
    init() {}

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    @State private var selectedTabId: String = HomeTab.forYou.id
    @State private var categories: [HomeCategory] = []
    @State private var cache = HomeFeedCache()
    @State private var unreadNotifications: Int = 0
    @State private var unreadConversations: Int = 0

    private var tabs: [HomeTab] {
        var list: [HomeTab] = [.forYou]
        if session.isSignedIn { list.append(.following) }
        list.append(contentsOf: categories.filter { $0.productCount > 0 }.map { HomeTab.category($0) })
        return list
    }

    private var selectedTab: HomeTab {
        tabs.first { $0.id == selectedTabId } ?? .forYou
    }

    var body: some View {
        let tab = selectedTab
        HomeFeedView(model: cache.model(for: tab))
            .id(tab.id)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .background(Color.yard.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .task { await loadCategories() }
            .task(id: session.shopper?.id ?? "signed-out") { await loadBadges() }
            .onChange(of: session.isSignedIn) { _, signedIn in
                if !signedIn, selectedTabId == HomeTab.following.id {
                    selectedTabId = HomeTab.forYou.id
                }
                cache.drop(HomeTab.following.id)
            }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.m) {
                YardLogo(color: Color.yard.ink)
                    .frame(height: 26)
                Spacer(minLength: 0)
                headerButton(systemImage: "bell", label: "Notifications", badge: unreadNotifications) {
                    router.push(.notifications)
                }
                headerButton(systemImage: "bubble.left.and.bubble.right", label: "Inbox", badge: unreadConversations) {
                    router.push(.inbox)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.xs)
            .padding(.bottom, Spacing.s)

            HomeTabStrip(tabs: tabs, selectedId: $selectedTabId)
        }
        .background(Color.yard.bg)
    }

    private func headerButton(systemImage: String, label: String, badge: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 40, height: 40)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Circle()
                            .fill(Color.yard.danger)
                            .frame(width: 9, height: 9)
                            .overlay(Circle().strokeBorder(Color.yard.bg, lineWidth: 1.5))
                            .offset(x: -7, y: 7)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(badge > 0 ? "\(label), \(badge) unread" : label))
    }

    // MARK: - Loading

    private func loadCategories() async {
        guard categories.isEmpty else { return }
        do {
            let response = try await APIClient.shared.get("/api/catalog/categories", as: HomeCategoriesResponse.self)
            categories = response.categories
        } catch {
            // The category tabs are optional; For you still works without them.
        }
    }

    private func loadBadges() async {
        guard session.isSignedIn else {
            unreadNotifications = 0
            unreadConversations = 0
            return
        }
        async let notes: HomeNotificationsResponse? = try? await APIClient.shared.get(
            "/api/notifications",
            query: [URLQueryItem(name: "as", value: "shopper")],
            as: HomeNotificationsResponse.self
        )
        async let inbox: HomeInboxUnread? = try? await APIClient.shared.get("/api/inbox/unread", as: HomeInboxUnread.self)
        let n = await notes
        let i = await inbox
        unreadNotifications = n?.items.filter { $0.read == false }.count ?? 0
        unreadConversations = i?.conversations ?? 0
    }
}

/// Keeps one feed model per visited tab, so switching tabs doesn't refetch. Not observed:
/// creating a model while `body` runs triggers no update.
@MainActor
final class HomeFeedCache {
    private var models: [String: HomeFeedModel] = [:]

    func model(for tab: HomeTab) -> HomeFeedModel {
        if let existing = models[tab.id] { return existing }
        let created = HomeFeedModel(tab: tab)
        models[tab.id] = created
        return created
    }

    func drop(_ id: String) {
        models[id] = nil
    }
}

// MARK: - Tab strip

/// "For you · Following · Tops · …": text tabs with a sliding underline.
struct HomeTabStrip: View {
    let tabs: [HomeTab]
    @Binding var selectedId: String
    @Namespace private var underline

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.xl) {
                    ForEach(tabs) { tab in
                        let isSelected = tab.id == selectedId
                        Button {
                            withAnimation(Motion.spring) { selectedId = tab.id }
                        } label: {
                            Text(tab.title)
                                .font(.yardHeadline)
                                .foregroundStyle(isSelected ? Color.yard.ink : Color.yard.ink2)
                                .lineLimit(1)
                                .padding(.bottom, 9)
                                .overlay(alignment: .bottom) {
                                    if isSelected {
                                        Capsule()
                                            .fill(Color.yard.ink)
                                            .frame(height: 3)
                                            .matchedGeometryEffect(id: "home-tab-underline", in: underline)
                                    }
                                }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(tab.id)
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .sensoryFeedback(.selection, trigger: selectedId)
            .onChange(of: selectedId) { _, id in
                withAnimation(Motion.spring) { proxy.scrollTo(id, anchor: .center) }
            }
        }
        .padding(.bottom, Spacing.s)
    }
}

// MARK: - Feed

/// One tab's feed: skeleton, error, empty, or the masonry with infinite scroll.
@MainActor
struct HomeFeedView: View {
    let model: HomeFeedModel

    @Environment(FollowStore.self) private var follows
    @Environment(Router.self) private var router

    private var followIds: [String] { follows.items.map(\.brandId) }
    private var isFollowing: Bool {
        if case .following = model.tab { return true }
        return false
    }

    var body: some View {
        ScrollView {
            TabPillScrollSensor()
            VStack(spacing: Spacing.l) {
                content
            }
            .padding(.top, Spacing.xs)
        }
        .scrollIndicators(.hidden)
        .refreshable {
            await model.refresh(followIds: followIds)
        }
        .task(id: followKey) {
            if isFollowing {
                guard follows.hasLoaded else { return }
                if model.phase == .idle || model.builtForFollowIds != Set(followIds) {
                    await model.refresh(followIds: followIds)
                }
            } else {
                await model.loadIfNeeded(followIds: followIds)
            }
        }
    }

    /// Only the Following tab reloads when follows change.
    private var followKey: String {
        guard isFollowing else { return "static" }
        return (follows.hasLoaded ? "loaded:" : "loading:") + followIds.sorted().joined(separator: ",")
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle, .loading:
            MasonrySkeleton(count: 10)
                .padding(.horizontal, Spacing.gridGap)
        case .failed(let message):
            EmptyState.error(message: message) {
                await model.refresh(followIds: followIds)
            }
            .padding(.top, Spacing.xxl)
        case .loaded:
            if model.items.isEmpty && model.founding.isEmpty {
                emptyState.padding(.top, Spacing.xxl)
            } else {
                if case .forYou = model.tab, !model.founding.isEmpty {
                    HomeFoundingRow(brands: model.founding)
                        .padding(.bottom, Spacing.s)
                }
                if !model.items.isEmpty {
                    grid
                }
                footer
            }
        }
    }

    private var grid: some View {
        let items = model.items
        let lastId = items.last?.id
        return MasonryGrid(items, spacing: Spacing.gridGap, extraHeight: 0, heightRatio: { $0.heightRatio }) { item in
            tile(item)
                .onAppear {
                    if item.id == lastId {
                        Task { @MainActor in await model.loadMore() }
                    }
                }
        }
        .padding(.horizontal, Spacing.gridGap)
    }

    @ViewBuilder
    private func tile(_ item: HomeFeedItem) -> some View {
        switch item {
        case .product(let product):
            HomeProductTile(product: product)
        case .brand(let brand):
            HomeBrandTile(brand: brand)
        case .drop(let drop):
            HomeDropTile(drop: drop)
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isLoadingMore {
            ProgressView()
                .tint(Color.yard.ink2)
                .padding(.vertical, Spacing.l)
        } else if model.loadMoreFailed {
            YardButton("Couldn't load more. Try again", systemImage: "arrow.clockwise", style: .secondary, size: .small, fullWidth: false) {
                Task { @MainActor in await model.loadMore() }
            }
            .padding(.vertical, Spacing.l)
        } else if !model.hasMore && !model.items.isEmpty {
            Text("You're all caught up")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .padding(.vertical, Spacing.l)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        switch model.tab {
        case .following:
            if followIds.isEmpty {
                EmptyState(
                    title: "Follow brands you like",
                    message: "New pieces from the brands you follow arrive here, newest first.",
                    systemImage: "heart.text.square",
                    actionTitle: "Browse brands"
                ) {
                    router.push(.brandsDirectory)
                }
            } else {
                EmptyState(
                    title: "Nothing new yet",
                    message: "The brands you follow haven't published pieces yet. They'll show up here as soon as they do.",
                    systemImage: "clock",
                    actionTitle: "Find more brands"
                ) {
                    router.push(.brandsDirectory)
                }
            }
        case .forYou:
            EmptyState(
                title: "Nothing here yet",
                message: "Pieces from independent brands show up here as soon as they're published.",
                systemImage: "square.grid.2x2"
            )
        case .category(let category):
            EmptyState(
                title: "No \(category.name.lowercased()) yet",
                message: "Nothing has been published in this category yet.",
                systemImage: "square.grid.2x2",
                actionTitle: "Shop everything"
            ) {
                router.push(.shop)
            }
        }
    }
}

#Preview("HomeView — dark") {
    NavigationStack { HomeView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("HomeView — light") {
    NavigationStack { HomeView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
