import SwiftUI
import Observation

/// One checkout: the brand orders it created (grouped the way the website does: checkout id,
/// else the group's reference).
struct OrderCheckoutGroup: Identifiable, Hashable, Sendable {
    let id: String
    let reference: String
    let placedAt: String
    let currency: String
    var totalMinor: Int
    var orders: [OrderSummary]

    var placedDate: Date? { YardDate.parse(placedAt) }
    var isOpen: Bool { orders.contains { $0.status.isOpen } }

    static func groups(from items: [OrderSummary]) -> [OrderCheckoutGroup] {
        var order: [String] = []
        var byId: [String: OrderCheckoutGroup] = [:]
        for summary in items {
            let key = summary.groupKey
            if var group = byId[key] {
                group.orders.append(summary)
                group.totalMinor += summary.totalMinor
                byId[key] = group
            } else {
                order.append(key)
                byId[key] = OrderCheckoutGroup(id: key, reference: summary.groupReference, placedAt: summary.placedAt, currency: summary.currency, totalMinor: summary.totalMinor, orders: [summary])
            }
        }
        return order.compactMap { byId[$0] }.sorted { $0.placedAt > $1.placedAt }
    }
}

@Observable
@MainActor
final class OrdersListModel {
    var items: [OrderSummary] = []
    var nextCursor: String?
    var isLoading: Bool = false
    var isLoadingMore: Bool = false
    var hasLoaded: Bool = false
    var error: Error?

    init() {}

    init(previewItems: [OrderSummary]) {
        items = previewItems
        hasLoaded = true
    }

    var groups: [OrderCheckoutGroup] { OrderCheckoutGroup.groups(from: items) }

    func load() async {
        isLoading = true
        do {
            let page = try await OrdersAPI.list()
            items = page.items
            nextCursor = page.nextCursor
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled == true || error is CancellationError {
                // The view went away; keep what's shown and try again next time.
                isLoading = false
                return
            } else {
                self.error = error
            }
        }
        isLoading = false
        hasLoaded = true
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        do {
            let page = try await OrdersAPI.list(before: cursor)
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.items.filter { !known.contains($0.id) })
            nextCursor = page.nextCursor
        } catch {
            // Keep what's shown; the "Load older orders" button stays to try again.
        }
        isLoadingMore = false
    }

    func reset() {
        items = []
        nextCursor = nil
        hasLoaded = false
        error = nil
    }
}

/// The shopper's orders, one card per checkout, one row per brand order with its status chip.
struct OrdersListView: View {
    private enum Filter: String, Hashable, CaseIterable {
        case all
        case open
        case closed

        var title: String {
            switch self {
            case .all: return "All"
            case .open: return "In progress"
            case .closed: return "Completed"
            }
        }
    }

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var model: OrdersListModel
    @State private var filter: Filter = .all
    private let isPreview: Bool

    init() {
        self._model = State(initialValue: OrdersListModel())
        self.isPreview = false
    }

    /// Preview-only: fixture orders, no network.
    init(previewItems: [OrderSummary]) {
        self._model = State(initialValue: OrdersListModel(previewItems: previewItems))
        self.isPreview = true
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("Orders")
            .navigationBarTitleDisplayMode(.large)
            .task(id: session.shopper?.id ?? "") {
                guard !isPreview else { return }
                guard session.isSignedIn else {
                    model.reset()
                    return
                }
                await model.load()
            }
    }

    @ViewBuilder
    private var content: some View {
        if !isPreview && !session.isSignedIn {
            if session.hasLoaded {
                EmptyState.signedOut(title: "Orders", message: "Sign in to see every order you've placed. Each brand's part of a checkout has its own status, tracking and returns.") {
                    router.present(.signIn)
                }
            } else {
                OrdersListSkeleton()
            }
        } else if !model.hasLoaded || (model.isLoading && model.items.isEmpty && model.error == nil) {
            OrdersListSkeleton()
        } else if let error = model.error, model.items.isEmpty {
            EmptyState.error(error) { await model.load() }
        } else if model.items.isEmpty {
            ScrollView {
                EmptyState(title: "No orders yet", message: "When you check out, every brand order and its tracking appears here.", systemImage: "shippingbox", actionTitle: "Start shopping") {
                    router.select(.home)
                }
                .padding(.top, Spacing.xxxl)
            }
            .refreshable { await model.load() }
        } else {
            list
        }
    }

    private var list: some View {
        let groups = model.groups
        let openCount = groups.filter { $0.isOpen }.count
        let visible: [OrderCheckoutGroup] = groups.filter { group in
            switch filter {
            case .all: return true
            case .open: return group.isOpen
            case .closed: return !group.isOpen
            }
        }
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.l) {
                Text("Orders from every brand you’ve checked out with. Each brand ships its own order, with its own tracking and returns.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.gutter)

                ChipRow {
                    Chip(Filter.all.title, isSelected: filter == .all, count: groups.count) { select(.all) }
                    Chip(Filter.open.title, isSelected: filter == .open, count: openCount) { select(.open) }
                    Chip(Filter.closed.title, isSelected: filter == .closed, count: groups.count - openCount) { select(.closed) }
                }

                if visible.isEmpty {
                    EmptyState(
                        title: filter == .open ? "Nothing in progress" : "No completed orders yet",
                        message: filter == .open ? "Every order you've placed has arrived or been closed." : "Orders move here once they're delivered, refunded or cancelled.",
                        systemImage: "line.3.horizontal.decrease.circle",
                        actionTitle: "Show all orders"
                    ) { select(.all) }
                    .padding(.top, Spacing.xl)
                } else {
                    ForEach(visible) { group in
                        OrderCheckoutGroupCard(group: group)
                            .padding(.horizontal, Spacing.gutter)
                    }
                }

                if model.nextCursor != nil {
                    YardButton("Load older orders", style: .secondary, isLoading: model.isLoadingMore) {
                        Task { @MainActor in await model.loadMore() }
                    }
                    .padding(.horizontal, Spacing.gutter)
                    .onAppear {
                        Task { @MainActor in await model.loadMore() }
                    }
                }

                Text("Checkout totals are in the currency you checked out in. Returns are handled by each brand, within its own return window.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.top, Spacing.s)
            }
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xxxl)
        }
        .refreshable { await model.load() }
    }

    private func select(_ next: Filter) {
        withAnimation(Motion.snappy) { filter = next }
    }
}

/// One checkout card: reference, date, brand count, payment line, total; one row per brand order.
struct OrderCheckoutGroupCard: View {
    let group: OrderCheckoutGroup

    init(group: OrderCheckoutGroup) {
        self.group = group
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom, spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text("Checkout \(group.reference)")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer(minLength: Spacing.s)
                VStack(alignment: .trailing, spacing: Spacing.xxs) {
                    Text(OrderStatusText.groupPayment(group.orders))
                        .font(.yardMicro)
                        .foregroundStyle(Color.yard.ink3)
                    Text(Formatters.price(minor: group.totalMinor, currency: group.currency))
                        .font(.yardBodyEmphasis.monospacedDigit())
                        .foregroundStyle(Color.yard.ink)
                }
            }
            .padding(Spacing.l)

            ForEach(group.orders) { order in
                Divider().overlay(Color.yard.line)
                NavigationLink(value: Route.order(id: order.id)) {
                    OrderSummaryRow(order: order)
                }
                .buttonStyle(PressableButtonStyle())
            }
        }
        .yardCard()
    }

    private var subtitle: String {
        let placed = group.placedDate.map { "Placed \(OrderText.longDate($0))" } ?? "Placed"
        let brands = group.orders.count == 1 ? "1 brand" : "\(group.orders.count) brands shipping separately"
        return "\(placed), \(brands)"
    }
}

/// One brand's part of a checkout.
struct OrderSummaryRow: View {
    let order: OrderSummary

    init(order: OrderSummary) {
        self.order = order
    }

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            BrandAvatar(name: order.brand.name, size: 44)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(order.brand.name)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
                Text(order.itemsTitle)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Text("Order \(order.reference), \(order.itemsCountText), \(Formatters.price(minor: order.totalMinor, currency: order.currency))")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .lineLimit(1)
                HStack(spacing: Spacing.s) {
                    OrderStatusChip(status: order.status)
                    if order.status == .paid || order.status == .processing {
                        Text("Tracking appears when it ships")
                            .font(.yardMicro)
                            .foregroundStyle(Color.yard.ink3)
                            .lineLimit(1)
                    }
                }
                .padding(.top, Spacing.xxs)
            }
            Spacer(minLength: Spacing.s)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.yard.ink3)
        }
        .padding(.horizontal, Spacing.l)
        .padding(.vertical, Spacing.m)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct OrdersListSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Skeleton(cornerRadius: 6).frame(height: 14).padding(.trailing, 60)
                HStack(spacing: Spacing.s) {
                    ForEach(0..<3, id: \.self) { _ in
                        Skeleton(shape: .capsule).frame(width: 90, height: 34)
                    }
                }
                ForEach(0..<3, id: \.self) { _ in
                    Skeleton(cornerRadius: Radius.card).frame(height: 190)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
        }
        .scrollDisabled(true)
    }
}

#Preview("OrdersListView — dark") {
    NavigationStack { OrdersListView(previewItems: OrderPreviewData.summaries) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrdersListView — light") {
    NavigationStack { OrdersListView(previewItems: OrderPreviewData.summaries) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
