import SwiftUI
import Observation

/// Which sales window the Home hero shows.
enum StudioSalesRange: String, CaseIterable, Hashable, Sendable {
    case today
    case week
    case month

    var title: String {
        switch self {
        case .today: return "Today"
        case .week: return "Week"
        case .month: return "Month"
        }
    }

    /// The Orders tile's caption.
    var caption: String {
        switch self {
        case .today: return "Today"
        case .week: return "Past 7 days"
        case .month: return "Past 30 days"
        }
    }
}

@Observable
@MainActor
final class StudioHomeModel {
    private(set) var dashboard: StudioDashboard?
    private(set) var loading: Bool = false
    private(set) var error: String?
    /// Suggestions from Yard waiting (the "Yard prepared N products for you" card).
    private(set) var suggestions: [StudioProposal] = []

    /// The 7-day dashboard: its `sales` carries today / week / month, its series the Weekly activity bars.
    func load(studio: StudioStore, force: Bool = false) async {
        if !force, dashboard != nil { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await studio.call { try await StudioAPI.dashboard(days: 7) }
            dashboard = next
            error = nil
            studio.brandCurrency = next.brand.currency
            studio.toShipCount = next.toShip.total
            studio.unreadCount = next.unreadMessages ?? 0
            studio.websitePieces = next.websitePieces
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
        if let list = try? await studio.call({ try await StudioAPI.suggestions(status: "pending") }) {
            suggestions = list.pending
            studio.suggestionsPending = list.pending.count
        }
    }
}

/// Studio Home, a wallet: the violet hero, action tiles, the Orders and Weekly activity tiles, then
/// the to-do rows and the shop's numbers. Data and navigation live here; the look is `StudioHomeContent`.
@MainActor
struct StudioHomeView: View {
    @Environment(StudioStore.self) private var studio

    @State private var model = StudioHomeModel()
    @State private var range: StudioSalesRange = .month
    @State private var dismissedCard: String = ""

    var body: some View {
        let brand = studio.activeBrand
        let name = model.dashboard?.brand.name ?? brand?.name ?? "your shop"
        let handle = model.dashboard?.brand.handle ?? brand?.handle ?? ""
        ScrollView {
            StudioHomeContent(
                brandName: name,
                initials: brand?.initials ?? String(name.prefix(1)).uppercased(),
                logoURL: brand.flatMap { ($0.isPrivateLogo && studio.profile == nil) ? nil : $0.logoURL },
                status: brand?.isRestricted == true ? .restricted : (brand?.isPending == true ? .inReview : .live),
                dashboard: model.dashboard,
                error: model.error,
                suggestions: model.suggestions.count,
                suggestionsAllNew: model.suggestions.allSatisfy { $0.isNew },
                showsPayouts: brand?.canSeePayouts ?? false,
                shareURL: handle.isEmpty ? nil : Config.webURL("/brands/\(handle)"),
                range: $range,
                dismissedCard: $dismissedCard,
                onAction: perform,
                onRetry: { await model.load(studio: studio, force: true) }
            )
        }
        .scrollIndicators(.hidden)
        .background(Color.yard.studioCanvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await model.load(studio: studio, force: true)
            Haptics.success()
        }
        .task(id: "\(studio.activeBrandId ?? "")-\(studio.dataVersion)") {
            await model.load(studio: studio, force: studio.dataVersion > 0)
        }
    }

    private func perform(_ action: StudioHomeAction) {
        switch action {
        case .avatar: studio.select(.me)
        case .inbox, .messages: studio.show(.inbox, in: .me)
        case .add: studio.isQuickAddPresented = true
        case .orders, .ship: studio.select(.orders)
        case .payouts: studio.show(.payouts, in: .me)
        case .suggestions: studio.show(.suggestions(focusAcceptAll: true), in: .products)
        case .support: studio.show(.thread(.support), in: .me)
        case .lowStock:
            studio.lowStockFilterRequested = true
            studio.select(.products)
        case .website: studio.show(.websitePieces, in: .products)
        case .product(let id): studio.show(.product(id: id), in: .products)
        }
    }
}

enum StudioHomeAction: Hashable {
    case avatar, inbox, add, orders, payouts, suggestions, support, ship, lowStock, messages, website
    case product(String)
}

/// The brand's state as Home shows it.
enum StudioHomeBrandStatus: Sendable { case live, inReview, restricted }

/// The hero's inset card: one thing worth doing now ("Get set up" in the wallet reference).
struct StudioHomeCard: Equatable {
    enum Action: Equatable { case suggestions, add, share, support }
    let id: String
    let lead: String
    let text: String
    let cta: String
    let action: Action

    static func pick(status: StudioHomeBrandStatus, dashboard: StudioDashboard?, suggestions: Int, allNew: Bool, brandName: String) -> StudioHomeCard? {
        if status == .restricted {
            return StudioHomeCard(id: "restricted", lead: "Publishing is paused", text: "Yard paused publishing and replies for \(brandName). Ask Yard Support what to change.", cta: "Message Yard Support", action: .support)
        }
        if suggestions > 0 {
            return StudioHomeCard(id: "suggestions", lead: StudioBatchCopy.preparedTitle(suggestions, allNew: allNew), text: "Nothing goes live until you accept.", cta: suggestions == 1 ? "Accept it" : "Accept all", action: .suggestions)
        }
        if status == .inReview {
            return StudioHomeCard(id: "review", lead: "Your shop is in review", text: "Add products now. They go live once Yard approves \(brandName).", cta: "Add a product", action: .add)
        }
        if let d = dashboard, d.sales.month.orders == 0 {
            return StudioHomeCard(id: "first-order", lead: "Get your first order", text: "Share your shop link so people can find you on Yard.", cta: "Share shop", action: .share)
        }
        return nil
    }
}

/// The pill beside the amount: what the latest days added ("+₦300,000 past week").
func studioHeroDelta(_ d: StudioDashboard, range: StudioSalesRange) -> String {
    let currency = d.brand.currency
    func signed(_ minor: Int) -> String { (minor < 0 ? "−" : "+") + Formatters.price(minor: abs(minor), currency: currency) }
    switch range {
    case .month: return d.sales.week.orders == 0 ? "No orders past week" : "\(signed(d.sales.week.netMinor)) past week"
    case .week: return d.sales.today.orders == 0 ? "No orders today" : "\(signed(d.sales.today.netMinor)) today"
    case .today:
        let n = d.sales.today.orders
        return n == 0 ? "No orders yet" : "\(n) \(n == 1 ? "order" : "orders")"
    }
}

/// Studio Home's radii (cards 24, tiles 20, small tiles 16) and the hero's bottom corners.
private enum HomeRadius {
    static let hero: CGFloat = 32
    static let tile: CGFloat = 20
    static let small: CGFloat = 16
}

/// Studio Home's look, with no store: the snapshot tests render it from fixtures.
struct StudioHomeContent: View {
    let brandName: String
    let initials: String
    let logoURL: URL?
    let status: StudioHomeBrandStatus
    let dashboard: StudioDashboard?
    let error: String?
    let suggestions: Int
    let suggestionsAllNew: Bool
    let showsPayouts: Bool
    let shareURL: URL?
    @Binding var range: StudioSalesRange
    @Binding var dismissedCard: String
    var onAction: (StudioHomeAction) -> Void
    var onRetry: () async -> Void
    /// Snapshot tests pass false: no entrance animation, bars at full height.
    var animated: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        brandName: String, initials: String, logoURL: URL?, status: StudioHomeBrandStatus,
        dashboard: StudioDashboard?, error: String?, suggestions: Int, suggestionsAllNew: Bool,
        showsPayouts: Bool, shareURL: URL?,
        range: Binding<StudioSalesRange>, dismissedCard: Binding<String>,
        onAction: @escaping (StudioHomeAction) -> Void, onRetry: @escaping () async -> Void, animated: Bool = true
    ) {
        self.brandName = brandName
        self.initials = initials
        self.logoURL = logoURL
        self.status = status
        self.dashboard = dashboard
        self.error = error
        self.suggestions = suggestions
        self.suggestionsAllNew = suggestionsAllNew
        self.showsPayouts = showsPayouts
        self.shareURL = shareURL
        self._range = range
        self._dismissedCard = dismissedCard
        self.onAction = onAction
        self.onRetry = onRetry
        self.animated = animated
    }

    private var card: StudioHomeCard? {
        let c = StudioHomeCard.pick(status: status, dashboard: dashboard, suggestions: suggestions, allNew: suggestionsAllNew, brandName: brandName)
        return c?.id == dismissedCard ? nil : c
    }

    var body: some View {
        VStack(spacing: 0) {
            hero
            VStack(spacing: Spacing.s) {
                quickActions
                if let d = dashboard {
                    HStack(alignment: .top, spacing: Spacing.s) {
                        ordersTile(d)
                        weeklyTile(d)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    todoRows(d)
                    yourShop(d)
                } else if let error {
                    EmptyState.error(message: error) { await onRetry() }
                        .padding(.top, Spacing.xl)
                } else {
                    skeleton
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.l)
            .padding(.bottom, Spacing.l)
        }
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: range)
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: dismissedCard)
    }

    // MARK: Hero

    private var hero: some View {
        let on = Color.yard.onStudioAccent
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Spacing.m) {
                Button { Haptics.selection(); onAction(.avatar) } label: { avatar }
                    .buttonStyle(PressableButtonStyle(scale: 0.94))
                    .accessibilityLabel(Text("\(brandName), open Me"))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Hello \u{1F44B}")
                        .font(.footnote)
                        .foregroundStyle(on.opacity(0.8))
                    Text(brandName)
                        .font(.headline)
                        .foregroundStyle(on)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.s)
                Button { Haptics.selection(); onAction(.inbox) } label: {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(on)
                        .frame(width: 44, height: 44)
                        .background(on.opacity(0.18), in: Circle())
                        .overlay(alignment: .topTrailing) {
                            if (dashboard?.unreadMessages ?? 0) > 0 {
                                Circle().fill(on).frame(width: 8, height: 8).offset(x: -11, y: 11)
                            }
                        }
                }
                .buttonStyle(PressableButtonStyle(scale: 0.92))
                .accessibilityLabel(Text((dashboard?.unreadMessages ?? 0) > 0 ? "Inbox, \(dashboard?.unreadMessages ?? 0) unread" : "Inbox"))
            }

            HStack {
                Text("Your sales")
                    .font(.footnote)
                    .foregroundStyle(on.opacity(0.8))
                Spacer()
                rangePicker
            }
            .padding(.top, Spacing.xl)

            Group {
                if let d = dashboard {
                    let amount = Formatters.price(minor: window(d).netMinor, currency: d.brand.currency)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { amountText(amount); deltaPill(d) }
                        VStack(alignment: .leading, spacing: 6) { amountText(amount); deltaPill(d) }
                    }
                } else {
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on.opacity(0.18)).frame(width: 170, height: 38)
                        Capsule().fill(on.opacity(0.14)).frame(width: 96, height: 26)
                    }
                    .padding(.vertical, 6)
                    .accessibilityLabel(Text("Loading sales"))
                }
            }
            .padding(.top, Spacing.xs)

            if let card {
                insetCard(card)
                    .padding(.top, 20)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, Spacing.m)
        .padding(.bottom, 20)
        .background {
            UnevenRoundedRectangle(bottomLeadingRadius: HomeRadius.hero, bottomTrailingRadius: HomeRadius.hero, style: .continuous)
                .fill(Color.yard.studioAccent)
                .ignoresSafeArea(edges: .top)
        }
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(Color.yard.onStudioAccent.opacity(0.22))
            Text(String(initials.prefix(2)))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.yard.onStudioAccent)
            if let logoURL {
                RemoteImage(url: logoURL, contentMode: .fill, maxPixelSize: 150) { Color.clear }
                    .clipShape(Circle())
            }
        }
        .frame(width: 44, height: 44)
    }

    private func amountText(_ amount: String) -> some View {
        Text(amount)
            .font(.system(.largeTitle, design: .default, weight: .bold))
            .monospacedDigit()
            .tracking(-0.5)
            .foregroundStyle(Color.yard.onStudioAccent)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .contentTransition(.numericText())
            .accessibilityLabel(Text("Net sales, \(range.title.lowercased()): \(amount)"))
    }

    private func deltaPill(_ d: StudioDashboard) -> some View {
        Text(studioHeroDelta(d, range: range))
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(Color.yard.onStudioAccent)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.yard.onStudioAccent.opacity(0.2), in: Capsule())
            .fixedSize()
    }

    private func window(_ d: StudioDashboard) -> StudioSalesWindow {
        switch range {
        case .today: return d.sales.today
        case .week: return d.sales.week
        case .month: return d.sales.month
        }
    }

    private var rangePicker: some View {
        let on = Color.yard.onStudioAccent
        return HStack(spacing: 0) {
            ForEach(StudioSalesRange.allCases, id: \.self) { r in
                Button {
                    if range != r { Haptics.selection() }
                    range = r
                } label: {
                    Text(r.title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(range == r ? Color.yard.studioAccentDeep : on.opacity(0.85))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(range == r ? on : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(range == r ? .isSelected : [])
            }
        }
        .padding(3)
        .background(on.opacity(0.16), in: Capsule())
    }

    private func insetCard(_ c: StudioHomeCard) -> some View {
        let on = Color.yard.onStudioAccent
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.lead)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(on)
                    Text(c.text)
                        .font(.footnote)
                        .foregroundStyle(on.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button {
                    Haptics.selection()
                    dismissedCard = c.id
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.yard.studioAccentDeep)
                        .frame(width: 26, height: 26)
                        .background(on.opacity(0.9), in: Circle())
                        .frame(width: 44, height: 44, alignment: .topTrailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, -2)
                .accessibilityLabel(Text("Close"))
            }
            if c.action == .share, let shareURL {
                ShareLink(item: shareURL) { ctaLabel(c.cta) }
                    .buttonStyle(PressableButtonStyle(scale: Motion.cardPressScale))
                    .simultaneousGesture(TapGesture().onEnded { Haptics.impact(.light) })
            } else {
                Button {
                    Haptics.impact(.light)
                    switch c.action {
                    case .suggestions: onAction(.suggestions)
                    case .add: onAction(.add)
                    case .support: onAction(.support)
                    case .share: break
                    }
                } label: { ctaLabel(c.cta) }
                .buttonStyle(PressableButtonStyle(scale: Motion.cardPressScale))
            }
        }
        .padding(Spacing.l)
        .background(Color.yard.studioAccentDeep, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
    }

    /// The white pill CTA: a black disc with ›, the label, and ».
    private func ctaLabel(_ title: String) -> some View {
        HStack(spacing: 0) {
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.yard.onPhoto)
                .frame(width: 40, height: 40)
                .background(Color.yard.onPhotoInk, in: Circle())
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.yard.onPhotoInk)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Spacing.s)
            Image(systemName: "chevron.right.2")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.yard.onPhotoInk.opacity(0.35))
                .padding(.trailing, 12)
        }
        .padding(6)
        .frame(minHeight: 52)
        .background(Color.yard.onPhoto, in: Capsule())
        .contentShape(Capsule())
    }

    // MARK: Tiles

    private var quickActions: some View {
        HStack(spacing: Spacing.s) {
            Button { Haptics.impact(.light); onAction(.add) } label: {
                quickTile("Add product", systemImage: "plus", accent: true)
            }
            .buttonStyle(PressableButtonStyle(scale: 0.95))
            Button { Haptics.impact(.light); onAction(.orders) } label: {
                quickTile("Orders", systemImage: "shippingbox")
            }
            .buttonStyle(PressableButtonStyle(scale: 0.95))
            if showsPayouts {
                Button { Haptics.impact(.light); onAction(.payouts) } label: {
                    quickTile("Payouts", systemImage: "banknote")
                }
                .buttonStyle(PressableButtonStyle(scale: 0.95))
            }
            if let shareURL {
                ShareLink(item: shareURL) { quickTile("Share shop", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PressableButtonStyle(scale: 0.95))
                    .simultaneousGesture(TapGesture().onEnded { Haptics.impact(.light) })
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func quickTile(_ title: String, systemImage: String, accent: Bool = false) -> some View {
        VStack(spacing: Spacing.s) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(accent ? Color.yard.onStudioAccent : Color.yard.ink)
                .frame(width: 38, height: 38)
                .background(accent ? Color.yard.studioAccent : Color.yard.studioTile2, in: Circle())
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, Spacing.xs)
        .padding(.vertical, Spacing.m)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 88)
        .background(Color.yard.studioTile, in: RoundedRectangle(cornerRadius: HomeRadius.small, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: HomeRadius.small, style: .continuous))
    }

    /// The contrast tile (white in dark, black in light): orders in the picked window.
    private func ordersTile(_ d: StudioDashboard) -> some View {
        let ink = Color.yard.onStudioContrast
        let w = window(d)
        return Button { Haptics.selection(); onAction(.orders) } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "shippingbox.fill")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Orders")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(ink)
                Spacer(minLength: Spacing.l)
                Text(Formatters.count(w.orders))
                    .font(.system(.title, design: .default, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(ink)
                    .contentTransition(.numericText())
                Text(range.caption)
                    .font(.caption)
                    .foregroundStyle(ink.opacity(0.6))
                if w.refundedMinor > 0 {
                    Text("\(Formatters.price(minor: w.refundedMinor, currency: d.brand.currency)) refunded")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(ink.opacity(0.6))
                        .lineLimit(1)
                }
            }
            .padding(Spacing.l)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .frame(minHeight: 156)
            .background(Color.yard.studioContrast, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityElement(children: .combine)
    }

    /// "Weekly activity": seven thin rounded bars on faint tracks, today in violet.
    private func weeklyTile(_ d: StudioDashboard) -> some View {
        let points = Array(d.series.points.suffix(7))
        let orders = d.sales.week.orders
        return VStack(alignment: .leading, spacing: 2) {
            Text("Weekly activity")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1)
            Text(orders == 0 ? "No sales yet this week" : "\(orders) \(orders == 1 ? "order" : "orders") this week")
                .font(.caption)
                .foregroundStyle(Color.yard.ink2)
                .lineLimit(1)
            Spacer(minLength: Spacing.m)
            StudioWeekBars(values: points.map { max(0, $0.netMinor) }, animated: animated && !reduceMotion)
                .frame(height: 64)
                .accessibilityLabel(Text("Net sales each day of the last 7 days, today last"))
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .frame(minHeight: 156)
        .background(Color.yard.studioTile, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
    }

    // MARK: Rows

    private struct Todo: Identifiable {
        let id: String
        let icon: String
        let title: String
        let detail: String
        let count: Int
        let action: StudioHomeAction
    }

    private func todos(_ d: StudioDashboard) -> [Todo] {
        var items: [Todo] = []
        if suggestions > 0, card?.action != .suggestions {
            items.append(Todo(id: "suggestions", icon: "sparkles", title: StudioBatchCopy.preparedTitle(suggestions, allNew: suggestionsAllNew),
                              detail: "Accept \(suggestions == 1 ? "it" : "all") in one tap", count: suggestions, action: .suggestions))
        }
        if d.toShip.total > 0 {
            items.append(Todo(id: "ship", icon: "shippingbox", title: "Orders to ship", detail: "\(d.toShip.paid) new · \(d.toShip.processing) preparing", count: d.toShip.total, action: .ship))
        }
        if d.lowStock.variants > 0 {
            items.append(Todo(id: "stock", icon: "exclamationmark.triangle", title: "Low stock",
                              detail: "\(d.lowStock.products) \(d.lowStock.products == 1 ? "product" : "products") at \(d.lowStock.threshold) or fewer", count: d.lowStock.variants, action: .lowStock))
        }
        if let unread = d.unreadMessages, unread > 0 {
            items.append(Todo(id: "inbox", icon: "bubble.left", title: "Unread messages", detail: "Customers waiting for a reply", count: unread, action: .messages))
        }
        if d.websitePieces > 0 {
            items.append(Todo(id: "site", icon: "globe", title: "New from your website", detail: "Ready to add to Yard", count: d.websitePieces, action: .website))
        }
        return items
    }

    @ViewBuilder
    private func todoRows(_ d: StudioDashboard) -> some View {
        let items = todos(d)
        if items.isEmpty {
            StudioHomeRow(title: "All caught up", detail: "Nothing is waiting on you right now", leading: .icon("checkmark.circle"))
        } else {
            ForEach(items) { item in
                Button { Haptics.selection(); onAction(item.action) } label: {
                    StudioHomeRow(title: item.title, detail: item.detail, leading: .icon(item.icon), value: Formatters.count(item.count), chevron: true)
                }
                .buttonStyle(PressableButtonStyle())
            }
        }
    }

    private func yourShop(_ d: StudioDashboard) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Your shop")
                .font(.headline)
                .foregroundStyle(Color.yard.ink)
                .padding(.top, Spacing.m)
                .padding(.bottom, Spacing.xs)
                .padding(.leading, Spacing.xs)
                .accessibilityAddTraits(.isHeader)
            StudioHomeRow(
                title: "Shop views",
                detail: "\(Formatters.count(d.storeViews.today)) today · \(Formatters.count(d.storeViews.month)) in 30 days",
                leading: .icon("eye"),
                value: Formatters.count(d.storeViews.week),
                valueCaption: "7 days"
            )
            if d.topProducts.isEmpty {
                StudioHomeRow(title: "Best sellers", detail: "Your top products of the last \(d.series.days) days show here after your first sales", leading: .icon("square.grid.2x2"))
            } else {
                ForEach(d.topProducts) { p in
                    Button { Haptics.selection(); onAction(.product(p.productId)) } label: {
                        StudioHomeRow(title: p.title, detail: "\(p.units) sold", leading: .image(p.imageSrc),
                                      value: Formatters.price(minor: p.revenueMinor, currency: p.currency), chevron: true)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
        }
    }

    // MARK: Loading

    private var skeleton: some View {
        VStack(spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 0) {
                        Capsule().fill(Color.yard.studioTile2).frame(width: 84, height: 14)
                        Spacer()
                        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.yard.studioTile2).frame(width: 64, height: 28)
                        Capsule().fill(Color.yard.studioTile2).frame(width: 72, height: 10).padding(.top, Spacing.s)
                    }
                    .padding(Spacing.l)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: 156)
                    .background(Color.yard.studioTile, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
                }
            }
            ForEach(0..<3, id: \.self) { _ in
                HStack(spacing: Spacing.m) {
                    Circle().fill(Color.yard.studioTile2).frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 6) {
                        Capsule().fill(Color.yard.studioTile2).frame(width: 140, height: 13)
                        Capsule().fill(Color.yard.studioTile2).frame(width: 96, height: 10)
                    }
                    Spacer()
                }
                .padding(.horizontal, Spacing.l)
                .frame(height: 72)
                .background(Color.yard.studioTile, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
            }
        }
        .shimmering(animated)
        .accessibilityElement()
        .accessibilityLabel(Text("Loading"))
    }
}

/// A full-width tile row: violet-tinted icon disc (or a product photo), title + detail, value, chevron.
struct StudioHomeRow: View {
    enum Leading { case icon(String), image(String?) }
    let title: String
    let detail: String?
    var leading: Leading
    var value: String? = nil
    var valueCaption: String? = nil
    var chevron: Bool = false

    var body: some View {
        HStack(spacing: Spacing.m) {
            switch leading {
            case .icon(let name):
                Image(systemName: name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.yard.studioAccentInk)
                    .frame(width: 40, height: 40)
                    .background(Color.yard.studioAccentTint, in: Circle())
            case .image(let path):
                RemoteImage(path: path, contentMode: .fill, maxPixelSize: 150)
                    .frame(width: 40, height: 40)
                    .background(Color.yard.studioTile2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(2)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if let value {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(value)
                        .font(.body.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if let valueCaption {
                        Text(valueCaption)
                            .font(.caption)
                            .foregroundStyle(Color.yard.ink2)
                    }
                }
            }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
        }
        .padding(.horizontal, Spacing.l)
        .padding(.vertical, Spacing.m)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(Color.yard.studioTile, in: RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: HomeRadius.tile, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Seven 8pt bars on faint full-height tracks; today (last) is violet. Grows in unless `animated` is false.
struct StudioWeekBars: View {
    let values: [Int]
    var animated: Bool
    @State private var grown: Bool

    init(values: [Int], animated: Bool = true) {
        self.values = values
        self.animated = animated
        _grown = State(initialValue: !animated)
    }

    var body: some View {
        let slots = 7
        let padded = Array(repeating: Int?.none, count: max(0, slots - values.count)) + values.suffix(slots).map { Optional($0) }
        let maxValue = max(1, values.max() ?? 1)
        GeometryReader { geo in
            let w: CGFloat = 8
            let gap = (geo.size.width - w * CGFloat(slots)) / CGFloat(slots - 1)
            ZStack(alignment: .bottomLeading) {
                ForEach(0..<slots, id: \.self) { i in
                    let isToday = i == slots - 1
                    let v = padded[i] ?? 0
                    let h = v > 0 ? w + (geo.size.height - w) * CGFloat(v) / CGFloat(maxValue) * (grown ? 1 : 0) : 0
                    ZStack(alignment: .bottom) {
                        Capsule().fill(isToday ? Color.yard.studioAccent.opacity(0.22) : Color.yard.ink.opacity(0.07))
                        if v > 0 {
                            Capsule().fill(isToday ? Color.yard.studioAccent : Color.yard.ink).frame(height: max(w, h))
                        }
                    }
                    .frame(width: w, height: geo.size.height)
                    .offset(x: CGFloat(i) * (w + gap))
                }
            }
        }
        .onAppear {
            guard !grown else { return }
            withAnimation(.spring(response: 0.7, dampingFraction: 0.85)) { grown = true }
        }
    }
}

#Preview("Studio home — dark") {
    NavigationStack { StudioHomeView() }
        .yardPreviewEnvironment()
        .environment(StudioStore.preview())
        .preferredColorScheme(.dark)
}

#Preview("Studio home — light") {
    NavigationStack { StudioHomeView() }
        .yardPreviewEnvironment()
        .environment(StudioStore.preview())
        .preferredColorScheme(.light)
}
