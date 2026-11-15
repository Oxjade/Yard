import SwiftUI
import Observation

/// Live state for the You quick links, read from endpoints the app already uses:
/// - Orders: checkouts still moving (the Orders screen's "In progress" filter) from GET /api/orders.
/// - Inbox: GET /api/inbox/unread (`conversations`), the same call as Home's inbox badge.
/// - Updates: unread items from GET /api/notifications?as=shopper, the same call as Home's bell.
/// - Drop reminders: reminders for drops that haven't ended, from GET /api/drops/me (as Android).
/// Each value stays nil until its call succeeds, so a failed call hides its badge, never shows 0.
/// Results are tagged with the account they were loaded for: a load that was cancelled, or that
/// finishes after the account changed or `reset()`, writes nothing.
@Observable
@MainActor
final class YouBadgesModel {
    var ordersInProgress: Int?
    var inboxUnread: Int?
    var updatesUnread: Int?
    var dropReminders: Int?

    /// Minimum gap between unforced reloads (Android's YouBadgesModel uses the same 1.5 s).
    static let minInterval: TimeInterval = 1.5

    @ObservationIgnored private var lastLoad: Date?
    @ObservationIgnored private var accountId: String?
    @ObservationIgnored private var generation = 0

    init() {}

    /// Previews only.
    init(preview orders: Int?, inbox: Int?, updates: Int?, reminders: Int?) {
        ordersInProgress = orders
        inboxUnread = inbox
        updatesUnread = updates
        dropReminders = reminders
    }

    func reset() {
        generation += 1
        accountId = nil
        ordersInProgress = nil
        inboxUnread = nil
        updatesUnread = nil
        dropReminders = nil
        lastLoad = nil
    }

    /// Reloads all four for `accountId`. Without `force` it skips a reload within 1.5 s of the
    /// last one (tab switches, popping back); the first load and pull to refresh pass `force`.
    /// The view animates the change (so it can honour Reduce Motion); the model only sets values.
    func load(accountId: String, force: Bool = false) async {
        if accountId != self.accountId {
            // A different shopper: never show the previous account's counts, even briefly.
            reset()
            self.accountId = accountId
        } else if !force, let lastLoad, Date().timeIntervalSince(lastLoad) < Self.minInterval {
            return
        }
        generation += 1
        let token = generation
        lastLoad = Date()
        async let orders: OrdersPage? = try? await OrdersAPI.list(limit: 50)
        async let inbox: HomeInboxUnread? = try? await APIClient.shared.get("/api/inbox/unread", as: HomeInboxUnread.self)
        async let notes: HomeNotificationsResponse? = try? await APIClient.shared.get(
            "/api/notifications",
            query: [URLQueryItem(name: "as", value: "shopper")],
            as: HomeNotificationsResponse.self
        )
        async let drops: MyDropsResponse? = try? await APIClient.shared.get("/api/drops/me", as: MyDropsResponse.self)
        let (o, i, n, d) = await (orders, inbox, notes, drops)
        // Cancelled (account change), superseded by a newer load, or for another account: drop it.
        guard !Task.isCancelled, token == generation, accountId == self.accountId else { return }
        if let o {
            ordersInProgress = OrderCheckoutGroup.groups(from: o.items).filter { $0.isOpen }.count
        }
        if let i { inboxUnread = i.conversations }
        if let n { updatesUnread = n.items.filter { $0.read == false }.count }
        if let d {
            let now = Date()
            dropReminders = d.reminders.filter { r in
                guard let drop = r.drop else { return false }
                return drop.livePhase(at: now) != .ended
            }.count
        }
    }
}

/// One quick link in the You panel.
struct YouQuickLink: Identifiable {
    /// How a link's live state reads (the same split as Android's `YouLinkBadge`).
    enum Badge: Equatable {
        case none
        /// Something needs a look (orders in progress, unread updates): an acid count on the icon.
        case attention(Int)
        /// Unread, no number shown: Home's danger dot on the icon, with the number for VoiceOver.
        case dot(Int)
        /// A quiet total beside the label (saved pieces, brands followed, reminders set).
        case total(Int)

        var isOnIcon: Bool {
            switch self {
            case .attention, .dot: return true
            case .none, .total: return false
            }
        }
    }

    let title: String
    let systemImage: String
    let route: Route
    let badge: Badge
    /// What VoiceOver adds after the title ("2 in progress").
    let accessibilityValue: String?

    var id: String { title }
}

/// The You quick links: ONE rounded surface holding a 3 × 2 grid of compact cells (icon above
/// label, at least 78pt tall) split by hairlines. At accessibility text sizes the grid drops to
/// 2 columns and the cells grow with their text. Each cell compresses with a highlight and a tap.
struct YouQuickLinksPanel: View {
    let links: [YouQuickLink]
    @Environment(\.displayScale) private var displayScale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    static let cellHeight: CGFloat = 78

    var body: some View {
        let columns = dynamicTypeSize.isAccessibilitySize ? 2 : 3
        let rows = stride(from: 0, to: links.count, by: columns).map { Array(links[$0..<min($0 + columns, links.count)]) }
        let hairline = 1 / max(displayScale, 1)
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 {
                    Rectangle().fill(Color.yard.line).frame(height: hairline)
                }
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.element.id) { column, link in
                        YouQuickLinkCell(link: link)
                            // The separator follows the cell's height, which grows with Dynamic Type.
                            .overlay(alignment: .leading) {
                                if column > 0 {
                                    Rectangle().fill(Color.yard.line).frame(width: hairline)
                                        .padding(.vertical, Spacing.m)
                                }
                            }
                    }
                }
            }
        }
        .background(Color.yard.surface, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Color.yard.line, lineWidth: 1)
        )
    }
}

private struct YouQuickLinkCell: View {
    let link: YouQuickLink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let large = dynamicTypeSize.isAccessibilitySize
        NavigationLink(value: link.route) {
            VStack(spacing: 7) {
                Image(systemName: link.systemImage)
                    .font(.system(size: 19, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(Color.yard.ink)
                    .frame(width: 28, height: 24)
                    .overlay(alignment: .topTrailing) { iconBadge }
                label(large: large)
            }
            .padding(.vertical, Spacing.s)
            .padding(.horizontal, Spacing.xs)
            .frame(maxWidth: .infinity, minHeight: YouQuickLinksPanel.cellHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(YardTilePressStyle())
        .accessibilityLabel(Text(link.title))
        .accessibilityValue(Text(link.accessibilityValue ?? ""))
    }

    @ViewBuilder
    private func label(large: Bool) -> some View {
        let layout = large
            ? AnyLayout(VStackLayout(spacing: 2))
            : AnyLayout(HStackLayout(spacing: 4))
        layout {
            Text(link.title)
                .font(.yardMicro)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .lineLimit(large ? 2 : 1)
                .minimumScaleFactor(large ? 1 : 0.8)
                .fixedSize(horizontal: false, vertical: large)
            if case .total(let n) = link.badge {
                Text(Formatters.count(n))
                    .font(.yardMicro.monospacedDigit())
                    .foregroundStyle(Color.yard.ink3)
                    .lineLimit(1)
                    .fixedSize()
                    .contentTransition(reduceMotion ? ContentTransition.identity : ContentTransition.numericText())
                    .transition(.opacity)
            }
        }
    }

    @ViewBuilder
    private var iconBadge: some View {
        switch link.badge {
        case .none, .total:
            EmptyView()
        case .attention(let n):
            Text(n > 99 ? "99+" : "\(n)")
                .font(.system(size: 10, weight: .bold).monospacedDigit())
                .foregroundStyle(Color.yard.onAcid)
                .padding(.horizontal, 4)
                .frame(minWidth: 16, minHeight: 16)
                .background(Color.yard.acid, in: Capsule())
                // Light mode: a hairline so acid holds its edge on a white panel.
                .overlay(Capsule().strokeBorder(colorScheme == .dark ? Color.clear : Color.yard.ink.opacity(0.18), lineWidth: 0.5))
                .padding(1.5)
                .background(Color.yard.surface, in: Capsule())
                .contentTransition(reduceMotion ? ContentTransition.identity : ContentTransition.numericText())
                .fixedSize()
                .offset(x: 11, y: -6)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.scale(scale: 0.6).combined(with: .opacity))
        case .dot:
            // The same unread dot as Home's header: danger, ringed in the panel colour.
            Circle()
                .fill(Color.yard.danger)
                .frame(width: 9, height: 9)
                .overlay(Circle().strokeBorder(Color.yard.surface, lineWidth: 1.5))
                .offset(x: 3, y: -2)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.scale(scale: 0.4).combined(with: .opacity))
        }
    }
}

#Preview("Quick links — dark") {
    YouQuickLinksPanel(links: [
        YouQuickLink(title: "Orders", systemImage: "shippingbox", route: .orders, badge: .attention(2), accessibilityValue: "2 in progress"),
        YouQuickLink(title: "Saved", systemImage: "heart", route: .saved, badge: .total(14), accessibilityValue: "14 saved"),
        YouQuickLink(title: "Following", systemImage: "person.2", route: .following, badge: .none, accessibilityValue: nil),
        YouQuickLink(title: "Inbox", systemImage: "bubble.left.and.bubble.right", route: .inbox, badge: .dot(3), accessibilityValue: "3 unread"),
        YouQuickLink(title: "Drop reminders", systemImage: "bell.badge", route: .myDrops, badge: .total(1), accessibilityValue: "1 set"),
        YouQuickLink(title: "Updates", systemImage: "bell", route: .notifications, badge: .none, accessibilityValue: nil),
    ])
    .padding()
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}
