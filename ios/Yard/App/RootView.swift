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

    @Environment(StudioStore.self) private var studio

    @State private var visitedTabs: Set<AppTab> = [.home]

    var body: some View {
        @Bindable var router = router
        ZStack {
            if studio.isInStudio {
                StudioRootView()
                    .transition(.opacity)
            } else {
                shopperShell
                    .transition(.opacity)
            }
        }
        .animation(Motion.crossfade, value: studio.isInStudio)
        .background(Color.yard.bg.ignoresSafeArea())
        .sheet(item: $router.sheet) { route in
            NavigationStack {
                RouteView(route: route)
                    .yardRouteDestinations()
            }
            // Sign in / create account holds typed input: it closes with its X only.
            .interactiveDismissDisabled(route == .signIn)
            .yardToastHost(toast)
        }
        // "What brings you to Yard?" for an account with no recorded choice (after sign-up).
        .fullScreenCover(isPresented: roleChoiceBinding) {
            RoleChoiceView()
                .yardToastHost(toast)
        }
        .yardToastHost(toast)
        .task {
            await session.refresh()
        }
        // Studio mode follows the session (brands, remembered mode) on every refresh.
        .onChange(of: session.shopper, initial: true) { _, shopper in
            studio.sync(shopper: shopper)
        }
        .onChange(of: studio.needsSignIn) { _, needs in
            guard needs else { return }
            studio.needsSignIn = false
            studio.enterShopping()
            router.present(.signIn)
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

    private var roleChoiceBinding: Binding<Bool> {
        Binding<Bool>(
            get: { session.hasLoaded && session.isSignedIn && studio.needsRoleChoice && router.sheet == nil },
            set: { _ in }
        )
    }

    /// The shopper app: one stack per tab and the floating tab pill.
    private var shopperShell: some View {
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
                ShopView(category: nil, asTab: true)
                    .yardRouteDestinations()
                    .safeAreaPadding(.bottom, Spacing.tabPillClearance)
            }
        case .around:
            NavigationStack(path: $router.aroundPath) {
                AroundView()
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

// MARK: - Bottom bar

/// The one bottom-bar family (shopper and Studio): the same capsule, height, margins and smoked
/// glass as the website's phone tab bar (`mobile-tabbar.tsx`). Same values as Android's
/// `YardTabBarDefaults`.
enum YardTabBarMetrics {
    static let height: CGFloat = 60
    static let sideMargin: CGFloat = 12
    static let maxWidth: CGFloat = 400
    static let itemHeight: CGFloat = 44
    static let pinSize: CGFloat = 56
    static let pinRise: CGFloat = 14
    /// The smoked fill (#080808, the website's obsidian) over the blur.
    static let glass = Color(light: UIColor(yardHex: 0x080808, alpha: 0.74), dark: UIColor(yardHex: 0x080808, alpha: 0.74))
    /// Icons and labels on the bar (it is dark in both appearances).
    static let ink = Color.yard.onPhoto
    static let inkMuted = Color.yard.onPhoto.opacity(0.72)
}

extension View {
    /// The bar capsule: margins, max width, height, blur and the smoked fill with a faint rim.
    func yardTabBarSurface() -> some View {
        self
            .frame(height: YardTabBarMetrics.height)
            .frame(maxWidth: YardTabBarMetrics.maxWidth)
            .background {
                Capsule()
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
                    .overlay(Capsule().fill(YardTabBarMetrics.glass))
                    .overlay(Capsule().strokeBorder(Color.yard.onPhoto.opacity(0.12), lineWidth: 1))
                    .shadow(color: Color.yard.scrim.opacity(0.3), radius: 14, y: 6)
            }
            .padding(.horizontal, YardTabBarMetrics.sideMargin)
    }
}

/// The shopper bar: Home · Shop · [Around] · Cart · Me. The active side tab is a purple
/// (`studio` violet #9452FF) pill with the filled icon and its label (icon only below 380pt);
/// inactive tabs are plain icons; Cart carries the acid count. The two halves are equal, so the
/// raised Around pin sits exactly in the middle. Shrinks a little while scrolling down
/// (`TabPillScrollSensor`). Mirrors Android's `TabPill`.
@MainActor
struct TabPill: View {
    @Environment(Router.self) private var router
    @Environment(CartStore.self) private var cart
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var namespace
    @State private var bagBounce = false

    var body: some View {
        let collapsed = router.isTabPillCollapsed
        GeometryReader { geo in
            let narrow = geo.size.width < 380
            ZStack(alignment: .bottom) {
                HStack(spacing: 0) {
                    HStack(spacing: 2) {
                        tabButton(.home, narrow: narrow)
                        tabButton(.search, narrow: narrow)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    Color.clear.frame(width: YardTabBarMetrics.pinSize + 12)
                    HStack(spacing: 2) {
                        tabButton(.bag, narrow: narrow)
                        tabButton(.you, narrow: narrow)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 6)
                .yardTabBarSurface()
                aroundPin
                    .padding(.bottom, (YardTabBarMetrics.height - YardTabBarMetrics.pinSize) / 2 + YardTabBarMetrics.pinRise)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
        .frame(height: YardTabBarMetrics.height + YardTabBarMetrics.pinRise + 12)
        .scaleEffect(collapsed && !reduceMotion ? 0.9 : 1, anchor: .bottom)
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: collapsed)
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: router.selectedTab)
        .sensoryFeedback(.selection, trigger: router.selectedTab)
        // Adding to the cart lands visibly: the bag icon dips and the count rolls.
        .onChange(of: cart.count) { old, new in
            if new > old { bagBounce.toggle() }
        }
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: cart.count)
    }

    private func tabButton(_ tab: AppTab, narrow: Bool) -> some View {
        let isSelected = router.selectedTab == tab
        let showsLabel = isSelected && !narrow
        return Button {
            router.select(tab)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isSelected ? tab.selectedSystemImage : tab.systemImage)
                    .font(.system(size: 19, weight: isSelected ? .semibold : .regular))
                    .symbolEffect(.bounce.down, value: reduceMotion ? false : (tab == .bag ? bagBounce : false))
                if showsLabel {
                    Text(tab.title)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .foregroundStyle(isSelected ? YardTabBarMetrics.ink : YardTabBarMetrics.inkMuted)
            .padding(.horizontal, showsLabel ? 12 : 0)
            .frame(minWidth: YardTabBarMetrics.itemHeight, minHeight: YardTabBarMetrics.itemHeight)
            .background {
                if isSelected {
                    Capsule()
                        .fill(Color.yard.studio)
                        .matchedGeometryEffect(id: "tab-selection", in: namespace)
                }
            }
            .overlay(alignment: .topTrailing) {
                if tab == .bag && cart.count > 0 {
                    Text(cart.count > 99 ? "99+" : "\(cart.count)")
                        .font(.yardMicro)
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.onAcid)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Color.yard.acid, in: Capsule())
                        .offset(x: 2, y: 1)
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

    /// Around: the round pin raised out of the bar's middle (purple while Around is open).
    private var aroundPin: some View {
        let isSelected = router.selectedTab == .around
        return Button {
            router.select(.around)
        } label: {
            Image(systemName: "mappin")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Color.yard.onPhoto)
                .frame(width: YardTabBarMetrics.pinSize, height: YardTabBarMetrics.pinSize)
                .background(isSelected ? Color.yard.studio : Color.yard.onPhotoInk, in: Circle())
                .overlay(Circle().strokeBorder(Color.yard.onPhoto.opacity(0.16), lineWidth: 1))
                // The website's obsidian ring and faint grey band around the disc.
                .background(Circle().fill(Color(light: UIColor(yardHex: 0x080808), dark: UIColor(yardHex: 0x080808))).padding(-4))
                .background(Circle().fill(Color.yard.onPhoto.opacity(0.10)).padding(-13))
                .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle(scale: 0.92))
        .accessibilityLabel(Text("Around, brands near you"))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func accessibilityLabel(for tab: AppTab) -> String {
        if tab == .bag && cart.count > 0 {
            return "Cart, \(cart.count) item\(cart.count == 1 ? "" : "s")"
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
