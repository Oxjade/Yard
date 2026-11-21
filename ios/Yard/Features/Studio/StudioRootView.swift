import SwiftUI

/// Studio mode: Home · Orders · Add (centre) · Products · Me, one NavigationStack per tab, under a
/// floating glass pill. Add opens Quick add full screen.
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
            case .notificationSettings: StudioNotificationSettingsView()
            }
        }
    }
}

/// The Studio floating pill: four tabs and a raised acid Add in the centre.
@MainActor
struct StudioTabPill: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(StudioTab.allCases) { tab in
                if tab == .add {
                    addButton
                } else {
                    tabButton(tab)
                }
            }
        }
        .padding(5)
        .yardGlass(Capsule(), elevation: .floating)
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: studio.selectedTab)
        .sensoryFeedback(.selection, trigger: studio.selectedTab)
    }

    private func tabButton(_ tab: StudioTab) -> some View {
        let isSelected = studio.selectedTab == tab
        let badge = tab == .orders ? studio.toShipCount : (tab == .me ? studio.unreadCount : 0)
        return Button {
            studio.select(tab)
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: isSelected ? tab.selectedSystemImage : tab.systemImage)
                    .font(.system(size: 18, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.yard.bg : Color.yard.ink)
                    .frame(width: 54, height: 48)
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(Color.yard.ink)
                                .matchedGeometryEffect(id: "studio-tab", in: namespace)
                        }
                    }
                if badge > 0 {
                    StudioBadge(count: badge)
                        .offset(x: -4, y: 3)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(badge > 0 ? "\(tab.title), \(badge)" : tab.title))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var addButton: some View {
        Button {
            Haptics.impact(.medium)
            studio.select(.add)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.yard.onAcid)
                .frame(width: 56, height: 56)
                .background(Color.yard.acid, in: Circle())
                .shadow(color: Color.yard.acid.opacity(0.35), radius: 10, y: 3)
                .padding(.vertical, -4)
        }
        .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
        .accessibilityLabel(Text("Add a product"))
    }
}
