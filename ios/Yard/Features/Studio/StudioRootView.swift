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

/// The Studio tab bar: the shopper app's own floating pill (`TabPill` in App/RootView.swift) — the
/// same glass capsule, 5pt inset, 58×48 buttons with 6pt gaps, 19pt icons, no labels, the acid
/// selection that slides between tabs and the same count badge. Only the tabs differ: Home,
/// Orders, Products, Me. Add is not in the bar: Home's "Add product" tile and the Products header
/// open Quick add, as before.
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

/// The bar itself, without the store (the Home snapshot draws it too).
struct StudioTabBar: View {
    let selected: StudioTab
    var badge: (StudioTab) -> Int = { _ in 0 }
    var onSelect: (StudioTab) -> Void = { _ in }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var namespace

    static let tabs: [StudioTab] = [.home, .orders, .products, .me]

    init(selected: StudioTab, badge: @escaping (StudioTab) -> Int = { _ in 0 }, onSelect: @escaping (StudioTab) -> Void = { _ in }) {
        self.selected = selected
        self.badge = badge
        self.onSelect = onSelect
    }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Self.tabs) { tab in
                tabButton(tab)
            }
        }
        .padding(5)
        .yardGlass(Capsule(), elevation: .floating)
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: selected)
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func tabButton(_ tab: StudioTab) -> some View {
        let isSelected = selected == tab
        let count = badge(tab)
        return Button {
            onSelect(tab)
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: isSelected ? tab.selectedSystemImage : tab.systemImage)
                    .font(.system(size: 19, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.yard.onAcid : Color.yard.ink)
                    .frame(width: 58, height: 48)
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(Color.yard.acid)
                                .matchedGeometryEffect(id: "studio-tab", in: namespace)
                        }
                    }
                if count > 0 {
                    // The shopper pill's Bag count badge.
                    Text(count > 99 ? "99+" : "\(count)")
                        .font(.yardMicro)
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.bg)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Color.yard.ink, in: Capsule())
                        .offset(x: -6, y: 4)
                        .contentTransition(.numericText())
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(count > 0 ? "\(tab.title), \(count)" : tab.title))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
