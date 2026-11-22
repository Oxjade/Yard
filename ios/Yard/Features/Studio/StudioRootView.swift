import SwiftUI

/// Studio mode: Home · Orders · Products · Me, one NavigationStack per tab, under a floating bar.
/// Quick add opens full screen from Home's "Add product" tile and the Products header.
@MainActor
struct StudioRootView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var visited: Set<StudioTab> = [.home]

    var body: some View {
        @Bindable var studio = studio
        ZStack(alignment: .bottom) {
            ForEach([StudioTab.home, .orders, .products, .me]) { tab in
                if visited.contains(tab) {
                    stack(tab)
                        .opacity(studio.selectedTab == tab ? 1 : 0)
                        .allowsHitTesting(studio.selectedTab == tab)
                        .accessibilityHidden(studio.selectedTab != tab)
                }
            }
            if studio.depth == 0 {
                StudioTabPill()
                    .padding(.bottom, Spacing.s)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: studio.depth == 0)
        .background(Color.yard.bg.ignoresSafeArea())
        .onChange(of: studio.selectedTab, initial: true) { _, tab in
            visited.insert(tab)
        }
        .fullScreenCover(isPresented: $studio.isQuickAddPresented) {
            StudioQuickAddView()
        }
        .task(id: studio.activeBrandId) {
            await studio.warmUp()
        }
    }

    @ViewBuilder
    private func stack(_ tab: StudioTab) -> some View {
        @Bindable var studio = studio
        switch tab {
        case .home:
            NavigationStack(path: $studio.homePath) {
                StudioHomeView()
                    .studioDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .orders:
            NavigationStack(path: $studio.ordersPath) {
                StudioOrdersView()
                    .studioDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .products:
            NavigationStack(path: $studio.productsPath) {
                StudioProductsView()
                    .studioDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .me:
            NavigationStack(path: $studio.mePath) {
                StudioMeView()
                    .studioDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .add:
            EmptyView()
        }
    }
}

extension View {
    /// Registers Studio routes on a Studio tab's root.
    @MainActor
    func studioDestinations() -> some View {
        navigationDestination(for: StudioRoute.self) { route in
            switch route {
            case .order(let id): StudioOrderDetailView(orderId: id)
            case .product(let id): StudioProductDetailView(productId: id)
            case .payouts: StudioPayoutsView()
            case .inbox: StudioInboxView()
            case .thread(let source): StudioThreadView(source: source)
            case .websitePieces: StudioWebsitePiecesView()
            case .suggestions(let focus): StudioSuggestionsView(focusAcceptAll: focus)
            case .notificationSettings: StudioNotificationSettingsView()
            }
        }
    }
}

/// The Studio tab bar (wallet look): a near-black floating bar with four plain icons; the selected
/// tab sits in an acid pill that slides between them. Add is not in the bar: Home's "Add product"
/// tile and the Products header open Quick add, as before.
@MainActor
struct StudioTabPill: View {
    @Environment(StudioStore.self) private var studio

    var body: some View {
        StudioTabBar(
            selected: studio.selectedTab,
            badge: { tab in tab == .orders ? studio.toShipCount : (tab == .me ? studio.unreadCount : 0) },
            onSelect: { studio.select($0) }
        )
    }
}

/// The Studio bar: the shopper app's own `YardTabBar` (same capsule, icons and active pill with
/// its label). Studio only changes the tabs (Home · Orders · Products · Me, no centre button) and
/// the pill colour (acid). Without the store, so the snapshots draw it too.
struct StudioTabBar: View {
    let selected: StudioTab
    var badge: (StudioTab) -> Int = { _ in 0 }
    var onSelect: (StudioTab) -> Void = { _ in }

    static let tabs: [StudioTab] = [.home, .orders, .products, .me]

    init(selected: StudioTab, badge: @escaping (StudioTab) -> Int = { _ in 0 }, onSelect: @escaping (StudioTab) -> Void = { _ in }) {
        self.selected = selected
        self.badge = badge
        self.onSelect = onSelect
    }

    var body: some View {
        YardTabBar(
            items: Self.tabs.map(item(for:)),
            selected: selected.rawValue,
            activeFill: Color.yard.acid,
            activeInk: Color.yard.onAcid,
            onSelect: { item in if let tab = StudioTab(rawValue: item.id) { onSelect(tab) } }
        )
    }

    private func item(for tab: StudioTab) -> YardTabBarItem {
        let count = badge(tab)
        var label: String? = nil
        var dot: AnyView? = nil
        if count > 0 {
            label = "\(tab.title), \(count)"
            // Something waiting there: a small acid dot (the pill itself is acid when selected).
            if tab != selected {
                dot = AnyView(Circle().fill(Color.yard.acid).frame(width: 8, height: 8).offset(x: -10, y: 8))
            }
        }
        return YardTabBarItem(
            id: tab.rawValue,
            title: tab.title,
            systemImage: tab.systemImage,
            selectedSystemImage: tab.selectedSystemImage,
            accessibilityLabel: label,
            badge: dot
        )
    }
}
