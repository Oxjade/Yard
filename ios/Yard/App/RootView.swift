import SwiftUI

/// The app shell: one NavigationStack per tab (paths live in `Router`), the floating tab pill,
/// the modal sheet and the toast host. Tabs are built lazily on first visit and kept alive.
@MainActor
struct RootView: View {
    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(CartStore.self) private var cart
    @Environment(FollowStore.self) private var follows
    @Environment(SavedStore.self) private var saved
    @Environment(ToastCenter.self) private var toast

    @State private var visitedTabs: Set<AppTab> = [.home]

    var body: some View {
        @Bindable var router = router
        ZStack(alignment: .bottom) {
            ForEach(AppTab.allCases) { tab in
                if visitedTabs.contains(tab) {
                    tabStack(tab)
                        .opacity(router.selectedTab == tab ? 1 : 0)
                        .allowsHitTesting(router.selectedTab == tab)
                        .accessibilityHidden(router.selectedTab != tab)
                }
            }

            if router.isTabPillVisible {
                TabPill()
                    .padding(.bottom, Spacing.s)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Motion.spring, value: router.isTabPillVisible)
        .background(Color.yard.bg.ignoresSafeArea())
        .onChange(of: router.selectedTab) { _, tab in
            visitedTabs.insert(tab)
        }
        .sheet(item: $router.sheet) { route in
            NavigationStack {
                RouteView(route: route)
                    .yardRouteDestinations()
            }
            .yardToastHost(toast)
        }
        .yardToastHost(toast)
        .task {
            await session.refresh()
        }
        // Reload the shopper's data whenever who is signed in changes (launch, sign in, sign out).
        .task(id: session.shopper?.id ?? "signed-out") {
            await cart.load()
            if session.isSignedIn {
                await follows.load()
                await saved.load()
            } else {
                follows.reset()
                saved.reset()
            }
        }
    }

    @ViewBuilder
    private func tabStack(_ tab: AppTab) -> some View {
        @Bindable var router = router
        switch tab {
        case .home:
            NavigationStack(path: $router.homePath) {
                HomeView()
                    .yardRouteDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .search:
            NavigationStack(path: $router.searchPath) {
                SearchView(query: "")
                    .yardRouteDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .bag:
            NavigationStack(path: $router.bagPath) {
                BagView()
                    .yardRouteDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .you:
            NavigationStack(path: $router.youPath) {
                YouView()
                    .yardRouteDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        }
    }
}

// MARK: - Floating tab pill

/// Home · Search · Bag (count badge) · You, in an `.ultraThinMaterial` capsule hovering over
/// content. Collapses to a smaller pill while the user scrolls down (`TabPillScrollSensor`).
@MainActor
struct TabPill: View {
    @Environment(Router.self) private var router
    @Environment(CartStore.self) private var cart
    @Namespace private var namespace

    var body: some View {
        let collapsed = router.isTabPillCollapsed
        HStack(spacing: collapsed ? 2 : 6) {
            ForEach(AppTab.allCases) { tab in
                tabButton(tab, collapsed: collapsed)
            }
        }
        .padding(5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
        .shadow(color: Color.yard.scrim.opacity(0.22), radius: 18, y: 8)
        .scaleEffect(collapsed ? 0.86 : 1, anchor: .bottom)
        .animation(Motion.spring, value: collapsed)
        .animation(Motion.spring, value: router.selectedTab)
        .sensoryFeedback(.selection, trigger: router.selectedTab)
    }

    private func tabButton(_ tab: AppTab, collapsed: Bool) -> some View {
        let isSelected = router.selectedTab == tab
        return Button {
            router.select(tab)
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: isSelected ? tab.selectedSystemImage : tab.systemImage)
                    .font(.system(size: 19, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.yard.onAcid : Color.yard.ink)
                    .frame(width: collapsed ? 48 : 58, height: 48)
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(Color.yard.acid)
                                .matchedGeometryEffect(id: "tab-selection", in: namespace)
                        }
                    }
                if tab == .bag && cart.count > 0 {
                    Text(cart.count > 99 ? "99+" : "\(cart.count)")
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
        .accessibilityLabel(Text(accessibilityLabel(for: tab)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func accessibilityLabel(for tab: AppTab) -> String {
        if tab == .bag && cart.count > 0 {
            return "Bag, \(cart.count) item\(cart.count == 1 ? "" : "s")"
        }
        return tab.title
    }
}

// MARK: - Scroll sensor

/// Collapses the tab pill while scrolling down and restores it when scrolling up. Put it as the
/// FIRST child inside a tab-root ScrollView's content:
///
///   ScrollView {
///       TabPillScrollSensor()
///       LazyVStack { … }
///   }
@MainActor
struct TabPillScrollSensor: View {
    @Environment(Router.self) private var router
    @State private var lastOffset: CGFloat = 0

    var body: some View {
        // `.onChange` (main actor) rather than `.onPreferenceChange`, whose action is `@Sendable`
        // in newer SDKs and can't touch the main-actor Router.
        GeometryReader { geo in
            let offset = geo.frame(in: .global).minY
            Color.clear
                .onChange(of: offset) { _, newOffset in
                    update(newOffset)
                }
        }
        .frame(height: 0)
    }

    private func update(_ offset: CGFloat) {
        let delta = offset - lastOffset
        if offset > -40 {
            if router.isTabPillCollapsed { router.isTabPillCollapsed = false }
        } else if delta < -14 {
            if !router.isTabPillCollapsed { router.isTabPillCollapsed = true }
        } else if delta > 14 {
            if router.isTabPillCollapsed { router.isTabPillCollapsed = false }
        }
        if abs(delta) > 14 || offset > -40 { lastOffset = offset }
    }
}

#Preview("Root — dark") {
    RootView()
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Root — light") {
    RootView()
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
