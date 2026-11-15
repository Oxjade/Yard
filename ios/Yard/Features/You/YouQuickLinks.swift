import SwiftUI
import Observation

/// Live state for the You quick links, read from endpoints the app already uses:
/// - Orders: orders still moving (the Orders screen's "In progress" filter) from GET /api/orders.
/// - Inbox: GET /api/inbox/unread (`conversations`), the same call as Home's inbox badge.
/// - Updates: unread items from GET /api/notifications?as=shopper, the same call as Home's bell.
/// - Drop reminders: reminders from GET /api/drops/me, the same call as "Your drops".
/// Each value stays nil until its call succeeds, so a failed call hides its badge, never shows 0.
@Observable
@MainActor
final class YouBadgesModel {
    var ordersInProgress: Int?
    var inboxUnread: Int?
    var updatesUnread: Int?
    var dropReminders: Int?

    @ObservationIgnored private var lastLoad: Date?

    init() {}

    /// Previews only.
    init(preview orders: Int?, inbox: Int?, updates: Int?, reminders: Int?) {
        ordersInProgress = orders
        inboxUnread = inbox
        updatesUnread = updates
        dropReminders = reminders
    }

    func reset() {
        ordersInProgress = nil
        inboxUnread = nil
        updatesUnread = nil
        dropReminders = nil
        lastLoad = nil
    }

    /// Reloads all four. Without `force` it only refreshes a load that is over 20 s old (coming
    /// back to the tab); the first load and pull to refresh pass `force`.
    func load(force: Bool = false) async {
        if !force {
            guard let lastLoad, Date().timeIntervalSince(lastLoad) >= 20 else { return }
        }
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
        withAnimation(Motion.snappy) {
            if let o {
                ordersInProgress = OrderCheckoutGroup.groups(from: o.items).filter { $0.isOpen }.count
            }
            if let i { inboxUnread = i.conversations }
            if let n { updatesUnread = n.items.filter { $0.read == false }.count }
            if let d { dropReminders = d.reminders.filter { $0.drop != nil }.count }
        }
    }
}

/// One quick link in the You panel.
struct YouQuickLink: Identifiable {
    enum Badge: Equatable {
        case none
        /// A number ("3").
        case count(Int)
        /// A dot (unread), with the number for VoiceOver.
        case dot(Int)
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
/// label, 78pt tall) split by hairlines. Each cell compresses with a highlight and a light tap.
struct YouQuickLinksPanel: View {
    let links: [YouQuickLink]
    @Environment(\.displayScale) private var displayScale

    static let cellHeight: CGFloat = 78

    var body: some View {
        let rows = stride(from: 0, to: links.count, by: 3).map { Array(links[$0..<min($0 + 3, links.count)]) }
        let hairline = 1 / max(displayScale, 1)
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 {
                    Rectangle().fill(Color.yard.line).frame(height: hairline)
                }
                HStack(spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.element.id) { column, link in
                        if column > 0 {
                            Rectangle().fill(Color.yard.line).frame(width: hairline)
                                .padding(.vertical, Spacing.m)
                        }
                        YouQuickLinkCell(link: link)
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

    var body: some View {
        NavigationLink(value: link.route) {
            VStack(spacing: 7) {
                Image(systemName: link.systemImage)
                    .font(.system(size: 19, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(Color.yard.ink)
                    .frame(width: 28, height: 24)
                    .overlay(alignment: .topTrailing) { badge }
                Text(link.title)
                    .font(.yardMicro)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .frame(height: YouQuickLinksPanel.cellHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(YardTilePressStyle())
        .accessibilityLabel(Text(link.title))
        .accessibilityValue(Text(link.accessibilityValue ?? ""))
    }

    @ViewBuilder
    private var badge: some View {
        switch link.badge {
        case .none:
            EmptyView()
        case .count(let n):
            Text(n > 99 ? "99+" : "\(n)")
                .font(.system(size: 10, weight: .bold).monospacedDigit())
                .foregroundStyle(Color.yard.bg)
                .padding(.horizontal, 4)
                .frame(minWidth: 16, minHeight: 16)
                .background(Color.yard.ink, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.yard.surface, lineWidth: 1.5))
                .contentTransition(.numericText())
                .fixedSize()
                .offset(x: 11, y: -6)
                .transition(.scale(scale: 0.6).combined(with: .opacity))
        case .dot:
            Circle()
                .fill(Color.yard.violet)
                .frame(width: 9, height: 9)
                .overlay(Circle().strokeBorder(Color.yard.surface, lineWidth: 1.5))
                .offset(x: 3, y: -2)
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        }
    }
}

#Preview("Quick links — dark") {
    YouQuickLinksPanel(links: [
        YouQuickLink(title: "Orders", systemImage: "shippingbox", route: .orders, badge: .count(2), accessibilityValue: "2 in progress"),
        YouQuickLink(title: "Saved", systemImage: "heart", route: .saved, badge: .count(14), accessibilityValue: "14"),
        YouQuickLink(title: "Following", systemImage: "person.2", route: .following, badge: .none, accessibilityValue: nil),
        YouQuickLink(title: "Inbox", systemImage: "bubble.left.and.bubble.right", route: .inbox, badge: .dot(3), accessibilityValue: "3 unread"),
        YouQuickLink(title: "Drop reminders", systemImage: "bell.badge", route: .myDrops, badge: .count(1), accessibilityValue: "1"),
        YouQuickLink(title: "Updates", systemImage: "bell", route: .notifications, badge: .none, accessibilityValue: nil),
    ])
    .padding()
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}
