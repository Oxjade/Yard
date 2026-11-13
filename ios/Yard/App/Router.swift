import SwiftUI
import Observation

// MARK: - Tabs

/// The four tabs of the floating tab pill.
enum AppTab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case home
    case search
    case bag
    case you

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .search: return "Search"
        case .bag: return "Bag"
        case .you: return "You"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .search: return "magnifyingglass"
        case .bag: return "bag"
        case .you: return "person"
        }
    }

    var selectedSystemImage: String {
        switch self {
        case .home: return "house.fill"
        case .search: return "magnifyingglass"
        case .bag: return "bag.fill"
        case .you: return "person.fill"
        }
    }
}

// MARK: - Routes

/// Legal pages (You › Legal). `path` is the website page.
enum LegalPage: String, Hashable, CaseIterable, Identifiable, Sendable {
    case terms
    case privacy
    case refunds
    case dataDeletion

    var id: String { rawValue }

    var title: String {
        switch self {
        case .terms: return "Terms"
        case .privacy: return "Privacy"
        case .refunds: return "Refunds"
        case .dataDeletion: return "Data deletion"
        }
    }

    var path: String {
        switch self {
        case .terms: return "/legal/terms"
        case .privacy: return "/legal/privacy"
        case .refunds: return "/legal/refunds"
        case .dataDeletion: return "/legal/data-deletion"
        }
    }
}

/// Every destination in the app. Push with `router.push(.product(slug: p.slug))` or
/// `NavigationLink(value: Route.product(slug: p.slug)) { … }`. `RouteView` maps each case to
/// its feature view.
enum Route: Hashable, Sendable {
    // Brands
    case brandsDirectory
    case brand(handle: String)
    case collection(brand: String, handle: String)
    // Product & shop
    case product(slug: String)
    case categories
    case category(slug: String)
    case shop
    case search(query: String)
    // Bag & checkout
    case bag
    case checkout
    case orderConfirmation(checkoutId: String)
    // Orders
    case orders
    case order(id: String)
    // Drops
    case drops
    case drop(id: String)
    case myDrops
    // Auth
    case signIn
    case welcome
    // You
    case you
    case settings
    case appearance
    case notificationSettings
    case addresses
    case legal(LegalPage)
    // Inbox
    case inbox
    case conversation(id: String)
    case messageBrand(brandId: String)
    // Saved
    case saved
    case following
    // Discovery
    case charts
    case around
    case notifications
}

extension Route: Identifiable {
    var id: Route { self }
}

extension Route {
    /// Maps a Yard web URL or site path (`https://yardstore.space/products/x`, `/brands/acme`,
    /// `yard://drops/abc`) to a route. Nil for pages the app doesn't have.
    init?(url: URL) {
        var parts = url.pathComponents.filter { $0 != "/" }
        // yard://brands/acme → host "brands" is the first segment.
        if url.scheme == "yard", let host = url.host, !host.isEmpty {
            parts.insert(host, at: 0)
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func q(_ name: String) -> String? { query.first { $0.name == name }?.value }

        guard let first = parts.first else { return nil }
        let second: String? = parts.count > 1 ? parts[1] : nil
        switch first {
        case "brands":
            if let handle = second {
                if parts.count > 3, parts[2] == "collections" {
                    self = .collection(brand: handle, handle: parts[3])
                } else {
                    self = .brand(handle: handle)
                }
            } else {
                self = .brandsDirectory
            }
        case "products":
            guard let slug = second else { return nil }
            self = .product(slug: slug)
        case "categories":
            if let slug = second { self = .category(slug: slug) } else { self = .categories }
        case "shop":
            if let c = q("category") { self = .category(slug: c) } else { self = .shop }
        case "search":
            self = .search(query: q("q") ?? "")
        case "bag":
            self = .bag
        case "checkout":
            if second == "confirmation", let id = q("checkout") ?? q("id") {
                self = .orderConfirmation(checkoutId: id)
            } else {
                self = .checkout
            }
        case "drops":
            if let id = second { self = .drop(id: id) } else { self = .drops }
        case "you":
            switch second ?? "" {
            case "orders":
                if parts.count > 2 { self = .order(id: parts[2]) } else { self = .orders }
            case "drops":
                self = .myDrops
            case "settings":
                self = .settings
            default:
                self = .you
            }
        case "inbox":
            if let id = q("c") ?? q("conversation") ?? second { self = .conversation(id: id) } else { self = .inbox }
        case "wishlist":
            self = .saved
        case "following":
            self = .following
        case "charts":
            self = .charts
        case "around":
            self = .around
        case "notifications":
            self = .notifications
        case "sign-in":
            self = .signIn
        case "welcome":
            self = .welcome
        case "legal":
            switch second ?? "" {
            case "terms": self = .legal(.terms)
            case "privacy": self = .legal(.privacy)
            case "refunds": self = .legal(.refunds)
            case "data-deletion": self = .legal(.dataDeletion)
            default: return nil
            }
        default:
            return nil
        }
    }

    /// Maps a site path like "/drops/abc" (e.g. an announcement `href`).
    init?(path: String) {
        guard let url = Config.url(for: path) else { return nil }
        self.init(url: url)
    }
}

// MARK: - Router

/// Navigation state: the selected tab, one `NavigationPath` per tab, and a modal sheet.
/// Injected at the root: `@Environment(Router.self) private var router`.
///
///   router.push(.brand(handle: "acme"))       // onto the current tab's stack
///   router.present(.signIn)                    // as a sheet (wrapped in its own NavigationStack)
///   router.dismissSheet()
///   router.select(.bag)                        // switch tab (re-selecting pops to root)
///   router.open(url)                           // deep link / universal link
@Observable
@MainActor
final class Router {
    var selectedTab: AppTab = .home
    var homePath = NavigationPath()
    var searchPath = NavigationPath()
    var bagPath = NavigationPath()
    var youPath = NavigationPath()
    /// The route shown as a sheet, if any.
    var sheet: Route?
    /// Set by `TabPillScrollSensor` while the user scrolls down; the pill collapses.
    var isTabPillCollapsed: Bool = false
    /// Force-hide the floating pill (e.g. a full-screen composer). Reset it on disappear.
    var isTabPillSuppressed: Bool = false

    init() {}

    /// Pushes onto the selected tab's stack.
    func push(_ route: Route) {
        switch selectedTab {
        case .home: homePath.append(route)
        case .search: searchPath.append(route)
        case .bag: bagPath.append(route)
        case .you: youPath.append(route)
        }
    }

    /// Pops one screen off the selected tab's stack.
    func pop() {
        switch selectedTab {
        case .home: if !homePath.isEmpty { homePath.removeLast() }
        case .search: if !searchPath.isEmpty { searchPath.removeLast() }
        case .bag: if !bagPath.isEmpty { bagPath.removeLast() }
        case .you: if !youPath.isEmpty { youPath.removeLast() }
        }
    }

    /// Pops a tab to its root.
    func popToRoot(_ tab: AppTab? = nil) {
        switch tab ?? selectedTab {
        case .home: homePath = NavigationPath()
        case .search: searchPath = NavigationPath()
        case .bag: bagPath = NavigationPath()
        case .you: youPath = NavigationPath()
        }
    }

    /// Selects a tab; selecting the current tab pops it to root.
    func select(_ tab: AppTab) {
        if tab == selectedTab {
            popToRoot(tab)
        } else {
            selectedTab = tab
        }
        isTabPillCollapsed = false
    }

    /// Switches to `tab` and pushes `route` there (e.g. "View order" from a notification).
    func show(_ route: Route, in tab: AppTab) {
        selectedTab = tab
        popToRoot(tab)
        push(route)
    }

    /// Presents a route modally (sign in, size guide…).
    func present(_ route: Route) {
        sheet = route
    }

    func dismissSheet() {
        sheet = nil
    }

    /// Number of screens pushed on the selected tab.
    var depth: Int {
        switch selectedTab {
        case .home: return homePath.count
        case .search: return searchPath.count
        case .bag: return bagPath.count
        case .you: return youPath.count
        }
    }

    /// Whether the floating pill is visible: only on tab roots, and not while suppressed.
    var isTabPillVisible: Bool { depth == 0 && !isTabPillSuppressed && sheet == nil }

    /// Opens a deep link. Tab roots switch tabs; other routes push on the current tab.
    /// Returns false when the URL isn't an app destination (open it in Safari instead).
    @discardableResult
    func open(_ url: URL) -> Bool {
        guard let route = Route(url: url) else { return false }
        switch route {
        case .bag: select(.bag); popToRoot(.bag)
        case .you: select(.you); popToRoot(.you)
        case .signIn: present(.signIn)
        case .search(let query) where query.isEmpty: select(.search)
        default: push(route)
        }
        return true
    }
}

// MARK: - RouteView

/// Maps a `Route` to its feature view. Feature agents implement the named views; never change a
/// type name or initializer used here.
struct RouteView: View {
    let route: Route

    var body: some View {
        content
    }

    @ViewBuilder
    private var content: some View {
        switch route {
        case .brandsDirectory: BrandsDirectoryView()
        case .brand(let handle): BrandProfileView(handle: handle)
        case .collection(let brand, let handle): CollectionView(brand: brand, handle: handle)
        case .product(let slug): ProductDetailView(slug: slug)
        case .categories: CategoriesView()
        case .category(let slug): ShopView(category: slug)
        case .shop: ShopView(category: nil)
        case .search(let query): SearchView(query: query)
        case .bag: BagView()
        case .checkout: CheckoutView()
        case .orderConfirmation(let checkoutId): OrderConfirmationView(checkoutId: checkoutId)
        case .orders: OrdersListView()
        case .order(let id): OrderDetailView(id: id)
        case .drops: DropsView()
        case .drop(let id): DropDetailView(id: id)
        case .myDrops: MyDropsView()
        case .signIn: SignInView()
        case .welcome: WelcomeView()
        case .you: YouView()
        case .settings: SettingsView()
        case .appearance: AppearanceView()
        case .notificationSettings: NotificationSettingsView()
        case .addresses: AddressesView()
        case .legal(let page): LegalView(page: page)
        case .inbox: InboxView()
        case .conversation(let id): ConversationView(id: id)
        case .messageBrand(let brandId): BrandConversationView(brandId: brandId)
        case .saved: SavedView()
        case .following: FollowingView()
        case .charts: ChartsView()
        case .around: AroundView()
        case .notifications: NotificationsView()
        }
    }
}

extension View {
    /// Registers `Route` destinations on a NavigationStack's root content.
    func yardRouteDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            RouteView(route: route)
        }
    }
}
