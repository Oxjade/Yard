import Foundation
import Observation
import SwiftUI

// MARK: - Mode

/// Whether the app shows the shopper app or Studio.
enum AppMode: String, Sendable, Equatable {
    case shopping
    case studio
}

/// What the person told us they came for ("What brings you to Yard?").
enum RoleChoice: String, Sendable, Equatable {
    case shop
    case sell
}

/// The pure decisions behind Studio mode (unit-tested).
enum StudioModeChoice {
    /// The mode after sign-in or launch: Studio when a brand can open it and the person didn't
    /// last leave Studio for shopping; otherwise shopping.
    static func initialMode(brands: [ShopperBrand], remembered: AppMode?) -> AppMode {
        guard brands.contains(where: { $0.canOpenStudio }) else { return .shopping }
        return remembered ?? .studio
    }

    /// The brand to open: the remembered one while it can still open Studio, else the first.
    static func brand(in brands: [ShopperBrand], remembered: String?) -> ShopperBrand? {
        let open = brands.filter { $0.canOpenStudio }
        if let remembered, let match = open.first(where: { $0.id == remembered }) { return match }
        return open.first
    }

    /// The role screen shows for an account with no recorded choice and no brand (a brand
    /// member has obviously chosen). Demo accounts can't apply, so they never see it.
    static func needsRoleChoice(brands: [ShopperBrand], recorded: RoleChoice?, demo: Bool) -> Bool {
        !demo && recorded == nil && brands.isEmpty
    }
}

/// Per-account choices kept on this device.
struct StudioPreferences {
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(_ name: String, _ accountId: String) -> String { "yard.studio.\(name).\(accountId)" }

    func mode(for accountId: String) -> AppMode? {
        defaults.string(forKey: key("mode", accountId)).flatMap(AppMode.init(rawValue:))
    }

    func setMode(_ mode: AppMode, for accountId: String) {
        defaults.set(mode.rawValue, forKey: key("mode", accountId))
    }

    func brandId(for accountId: String) -> String? {
        defaults.string(forKey: key("brand", accountId))
    }

    func setBrandId(_ id: String, for accountId: String) {
        defaults.set(id, forKey: key("brand", accountId))
    }

    func role(for accountId: String) -> RoleChoice? {
        defaults.string(forKey: key("role", accountId)).flatMap(RoleChoice.init(rawValue:))
    }

    func setRole(_ role: RoleChoice, for accountId: String) {
        defaults.set(role.rawValue, forKey: key("role", accountId))
    }
}

// MARK: - Navigation

enum StudioTab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case home
    case orders
    case add
    case products
    case me

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .orders: return "Orders"
        case .add: return "Add"
        case .products: return "Products"
        case .me: return "Me"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .orders: return "shippingbox"
        case .add: return "plus"
        case .products: return "square.grid.2x2"
        case .me: return "person"
        }
    }

    var selectedSystemImage: String {
        switch self {
        case .home: return "house.fill"
        case .orders: return "shippingbox.fill"
        case .add: return "plus"
        case .products: return "square.grid.2x2.fill"
        case .me: return "person.fill"
        }
    }
}

/// Screens pushed inside Studio tabs.
enum StudioRoute: Hashable, Sendable {
    case order(id: String)
    case product(id: String)
    case payouts
    case inbox
    case thread(StudioThreadSource)
    case websitePieces
    /// Suggestions from Yard; `focusAcceptAll` when arriving from the to-do, a push or an email.
    case suggestions(focusAcceptAll: Bool)
    case notificationSettings
}

/// A Studio deep link: `yard://studio/…` (push `data.link`) or the website path `/studio/…`
/// (push `data.url`). docs/APP.md › Push for brands › Deep links.
enum StudioLink: Equatable, Sendable {
    case home
    case orders
    case order(String)
    case inbox
    case conversation(String)
    case support
    case products
    case product(String)
    /// `/studio/products/suggestions?focus=accept-all`.
    case suggestions(focusAcceptAll: Bool)
    case payouts

    init?(url: URL) {
        var parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "yard", let host = url.host, !host.isEmpty {
            parts.insert(host, at: 0)
        }
        guard parts.first == "studio" else { return nil }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let second: String? = parts.count > 1 ? parts[1] : nil
        let third: String? = parts.count > 2 ? parts[2] : nil
        switch second {
        case nil, "":
            self = .home
        case "orders":
            if let id = third, !id.isEmpty { self = .order(id) } else { self = .orders }
        case "inbox":
            if let id = third ?? query.first(where: { $0.name == "thread" })?.value, !id.isEmpty {
                self = .conversation(id)
            } else {
                self = .inbox
            }
        case "support":
            self = .support
        case "products":
            if third == "suggestions" {
                self = .suggestions(focusAcceptAll: query.first(where: { $0.name == "focus" })?.value == "accept-all")
            } else if let id = third, !id.isEmpty {
                self = .product(id)
            } else {
                self = .products
            }
        case "payouts":
            self = .payouts
        default:
            self = .home
        }
    }

    init?(path: String) {
        guard let url = Config.url(for: path) else { return nil }
        self.init(url: url)
    }

    /// The tab the link opens on.
    var tab: StudioTab {
        switch self {
        case .home: return .home
        case .orders, .order: return .orders
        case .products, .product, .suggestions: return .products
        case .inbox, .conversation, .support, .payouts: return .me
        }
    }

    /// The screen pushed on that tab, if any.
    var routes: [StudioRoute] {
        switch self {
        case .home, .orders, .products: return []
        case .order(let id): return [.order(id: id)]
        case .product(let id): return [.product(id: id)]
        case .suggestions(let focus): return [.suggestions(focusAcceptAll: focus)]
        case .inbox: return [.inbox]
        case .conversation(let id): return [.inbox, .thread(.conversation(id))]
        case .support: return [.thread(.support)]
        case .payouts: return [.payouts]
        }
    }
}

// MARK: - Store

/// Studio mode state: which brand, whether Studio is showing, the brand session gate, Studio
/// navigation and the badges on its tab pill. Injected at the root:
/// `@Environment(StudioStore.self) private var studio`.
@Observable
@MainActor
final class StudioStore {
    /// The signed-in account's brands (from `shopper.brands`).
    private(set) var brands: [ShopperBrand] = []
    private(set) var accountId: String?
    private(set) var mode: AppMode = .shopping
    private(set) var activeBrandId: String?
    /// The account's recorded "What brings you to Yard?" answer.
    private(set) var recordedRole: RoleChoice?
    private(set) var isDemo: Bool = false

    /// Permissions of the open brand session (nil until the first switch answers).
    private(set) var profile: StudioBrandProfile?
    /// The brand's currency, learned from the dashboard (Quick add prices).
    var brandCurrency: String?

    // Navigation
    var selectedTab: StudioTab = .home
    var homePath: [StudioRoute] = []
    var ordersPath: [StudioRoute] = []
    var productsPath: [StudioRoute] = []
    var mePath: [StudioRoute] = []
    var isQuickAddPresented: Bool = false
    /// Home's "low on stock" asks Products to open with its low-stock filter on.
    var lowStockFilterRequested: Bool = false
    /// Bumped when data changed elsewhere (order shipped, product added) so lists reload.
    private(set) var dataVersion: Int = 0

    // Badges
    var toShipCount: Int = 0
    var unreadCount: Int = 0
    var websitePieces: Int = 0
    /// Suggestions from Yard waiting for an answer.
    var suggestionsPending: Int = 0

    /// Set when a Studio call finds the shopper session gone; the root presents sign-in.
    var needsSignIn: Bool = false

    let gate: StudioSessionGate
    private let preferences: StudioPreferences

    init(gate: StudioSessionGate? = nil, preferences: StudioPreferences = StudioPreferences()) {
        self.gate = gate ?? StudioSessionGate()
        self.preferences = preferences
    }

    // MARK: Derived

    var studioBrands: [ShopperBrand] { brands.filter { $0.canOpenStudio } }
    var canOpenStudio: Bool { !studioBrands.isEmpty }
    var activeBrand: ShopperBrand? { studioBrands.first { $0.id == activeBrandId } }
    var isInStudio: Bool { mode == .studio && activeBrand != nil }
    var needsRoleChoice: Bool {
        guard accountId != nil else { return false }
        return StudioModeChoice.needsRoleChoice(brands: brands, recorded: recordedRole, demo: isDemo)
    }

    /// True when the open brand session's role may `permission` (unknown → allowed; the
    /// server still refuses with 403).
    func can(_ permission: String) -> Bool {
        guard let profile, profile.brand.id == activeBrandId else { return true }
        return profile.can(permission)
    }

    // MARK: Session sync

    /// Call when who is signed in changes (and after each session refresh): picks the mode and
    /// brand for this account.
    func sync(shopper: Shopper?) {
        guard let shopper else {
            accountId = nil
            brands = []
            mode = .shopping
            activeBrandId = nil
            recordedRole = nil
            profile = nil
            gate.reset()
            resetNavigation()
            YardPushCenter.shared.setStudioCapable(false)
            return
        }
        let accountChanged = accountId != shopper.id
        accountId = shopper.id
        brands = shopper.brands
        isDemo = shopper.demo
        recordedRole = preferences.role(for: shopper.id)
        YardPushCenter.shared.setStudioCapable(canOpenStudio)

        let remembered = preferences.brandId(for: shopper.id)
        let pick = StudioModeChoice.brand(in: brands, remembered: activeBrandId ?? remembered)
        if pick?.id != activeBrandId {
            activeBrandId = pick?.id
            profile = nil
        }
        if accountChanged {
            gate.reset()
            resetNavigation()
            mode = StudioModeChoice.initialMode(brands: brands, remembered: preferences.mode(for: shopper.id))
        } else if !canOpenStudio {
            mode = .shopping
        }
    }

    // MARK: Mode

    /// Opens Studio for `brandId` (or the current/remembered brand).
    func enterStudio(brandId: String? = nil) {
        guard let accountId else { return }
        if let brandId, brandId != activeBrandId, studioBrands.contains(where: { $0.id == brandId }) {
            activeBrandId = brandId
            profile = nil
            resetNavigation()
        }
        if activeBrandId == nil { activeBrandId = studioBrands.first?.id }
        guard let id = activeBrandId else { return }
        preferences.setBrandId(id, for: accountId)
        preferences.setMode(.studio, for: accountId)
        mode = .studio
    }

    /// Back to the shopper app (the brand session stays open for a quick return).
    func enterShopping() {
        if let accountId { preferences.setMode(.shopping, for: accountId) }
        mode = .shopping
    }

    /// Switches the active brand (brand picker).
    func selectBrand(_ brandId: String) {
        guard brandId != activeBrandId else { return }
        enterStudio(brandId: brandId)
    }

    func recordRole(_ role: RoleChoice) {
        guard let accountId else { return }
        preferences.setRole(role, for: accountId)
        recordedRole = role
    }

    /// Remembers the mode without switching (e.g. after applying: stay in shopping).
    func rememberMode(_ mode: AppMode) {
        guard let accountId else { return }
        preferences.setMode(mode, for: accountId)
    }

    // MARK: Calls

    /// Runs a Studio call with the active brand's session open (switch first; re-switch once on 401).
    func call<T>(_ operation: () async throws -> T) async throws -> T {
        guard let brandId = activeBrandId else {
            throw APIError(status: 0, code: "no_brand", message: "Choose a brand to open Studio.")
        }
        do {
            let value = try await gate.run(brandId, operation)
            if let p = gate.profile, p.brand.id == brandId, profile != p { profile = p }
            return value
        } catch let error as APIError where error.code == StudioSessionGate.signedOut.code {
            needsSignIn = true
            throw error
        }
    }

    /// Opens the brand session now (Studio root appears), so permissions are known early.
    func warmUp() async {
        _ = try? await call { () async throws -> Bool in true }
    }

    /// After a provider re-confirmation the new brand session may be another brand's: move it
    /// back to the active brand without losing the re-confirmation.
    func adoptReconfirmedSession(brandId: String?) async {
        guard let active = activeBrandId else { return }
        if let brandId, brandId != active {
            try? await StudioAPI.switchOpenBrandSession(active)
        }
        gate.markOpened(active)
    }

    func bumpData() {
        dataVersion += 1
    }

    // MARK: Deep links

    /// Opens a Studio link (push tap or `yard://studio/…`). `brandId` (push `data.brandId`)
    /// switches brand first. Returns false when this account has no Studio.
    @discardableResult
    func open(_ link: StudioLink, brandId: String? = nil) -> Bool {
        guard canOpenStudio else { return false }
        enterStudio(brandId: brandId)
        guard mode == .studio else { return false }
        selectedTab = link.tab
        let routes = link.routes
        switch link.tab {
        case .home: homePath = routes
        case .orders: ordersPath = routes
        case .products: productsPath = routes
        case .me: mePath = routes
        case .add: break
        }
        return true
    }

    // MARK: Navigation

    func push(_ route: StudioRoute) {
        switch selectedTab {
        case .home: homePath.append(route)
        case .orders: ordersPath.append(route)
        case .products: productsPath.append(route)
        case .me: mePath.append(route)
        case .add: break
        }
    }

    /// Switches tab and shows `route` there.
    func show(_ route: StudioRoute, in tab: StudioTab) {
        selectedTab = tab
        switch tab {
        case .home: homePath = [route]
        case .orders: ordersPath = [route]
        case .products: productsPath = [route]
        case .me: mePath = [route]
        case .add: break
        }
    }

    func select(_ tab: StudioTab) {
        if tab == .add {
            isQuickAddPresented = true
            return
        }
        if tab == selectedTab {
            switch tab {
            case .home: homePath = []
            case .orders: ordersPath = []
            case .products: productsPath = []
            case .me: mePath = []
            case .add: break
            }
        } else {
            selectedTab = tab
        }
    }

    var depth: Int {
        switch selectedTab {
        case .home: return homePath.count
        case .orders: return ordersPath.count
        case .products: return productsPath.count
        case .me: return mePath.count
        case .add: return 0
        }
    }

    private func resetNavigation() {
        selectedTab = .home
        homePath = []
        ordersPath = []
        productsPath = []
        mePath = []
        toShipCount = 0
        unreadCount = 0
        websitePieces = 0
        suggestionsPending = 0
        brandCurrency = nil
    }

    // MARK: Previews

    static func preview(inStudio: Bool = true) -> StudioStore {
        let store = StudioStore(preferences: StudioPreferences(defaults: UserDefaults(suiteName: "yard.preview") ?? .standard))
        let shopper = Shopper(id: "usr_preview", name: "Ada Obi", email: "ada@example.com", brands: [
            ShopperBrand(id: "b_preview", handle: "kachi-studio", name: "Kachi Studio", role: "owner", status: "approved"),
        ])
        store.sync(shopper: shopper)
        if inStudio { store.enterStudio() } else { store.enterShopping() }
        return store
    }
}
