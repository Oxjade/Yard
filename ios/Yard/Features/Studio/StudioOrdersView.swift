import SwiftUI
import Observation

/// The Orders status tabs and the queries behind them (docs/APP.md › Orders).
enum StudioOrdersTab: String, CaseIterable, Hashable, Sendable {
    case toShip
    case shipped
    case delivered
    case cancelled
    case returns

    var title: String {
        switch self {
        case .toShip: return "To ship"
        case .shipped: return "Shipped"
        case .delivered: return "Delivered"
        case .cancelled: return "Cancelled"
        case .returns: return "Returns"
        }
    }

    /// One request per query; "To ship" merges unfulfilled (includes Paid) and processing.
    var queries: [[URLQueryItem]] {
        switch self {
        case .toShip:
            return [[URLQueryItem(name: "fulfilment", value: "unfulfilled")], [URLQueryItem(name: "fulfilment", value: "processing")]]
        case .shipped: return [[URLQueryItem(name: "fulfilment", value: "shipped")]]
        case .delivered: return [[URLQueryItem(name: "fulfilment", value: "delivered")]]
        case .cancelled: return [[URLQueryItem(name: "fulfilment", value: "cancelled")]]
        case .returns: return [[URLQueryItem(name: "returns", value: "open")]]
        }
    }

    var emptyTitle: String {
        switch self {
        case .toShip: return "Nothing to ship"
        case .shipped: return "No shipped orders"
        case .delivered: return "No delivered orders yet"
        case .cancelled: return "No cancelled orders"
        case .returns: return "No open returns"
        }
    }
}

@Observable
@MainActor
final class StudioOrdersModel {
    private(set) var items: [StudioOrderSummary] = []
    private(set) var loading: Bool = false
    private(set) var loadingMore: Bool = false
    private(set) var error: String?
    private(set) var loadedKey: String?
    /// The next cursor per query (nil when that query has no more).
    private var cursors: [Int: String] = [:]

    var hasMore: Bool { !cursors.isEmpty }

    func load(studio: StudioStore, tab: StudioOrdersTab, search: String, force: Bool) async {
        let key = "\(tab.rawValue)|\(search)"
        if !force, loadedKey == key { return }
        loading = true
        defer { loading = false }
        do {
            var merged: [StudioOrderSummary] = []
            var nextCursors: [Int: String] = [:]
            for (index, query) in tab.queries.enumerated() {
                let page = try await studio.call { try await StudioAPI.orders(Self.with(query, search: search), before: nil) }
                merged.append(contentsOf: page.items)
                if let c = page.nextCursor { nextCursors[index] = c }
            }
            items = Self.sorted(merged)
            cursors = nextCursors
            loadedKey = key
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }

    func loadMore(studio: StudioStore, tab: StudioOrdersTab, search: String) async {
        guard !loadingMore, !cursors.isEmpty else { return }
        loadingMore = true
        defer { loadingMore = false }
        var merged = items
        var nextCursors: [Int: String] = [:]
        do {
            for (index, cursor) in cursors {
                guard index < tab.queries.count else { continue }
                let query = tab.queries[index]
                let page = try await studio.call { try await StudioAPI.orders(Self.with(query, search: search), before: cursor) }
                let known = Set(merged.map(\.id))
                merged.append(contentsOf: page.items.filter { !known.contains($0.id) })
                if let c = page.nextCursor { nextCursors[index] = c }
            }
            items = Self.sorted(merged)
            cursors = nextCursors
        } catch {
            // Keep what's shown; the footer offers another try.
        }
    }

    private static func with(_ query: [URLQueryItem], search: String) -> [URLQueryItem] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? query : query + [URLQueryItem(name: "q", value: q)]
    }

    /// Newest first.
    static func sorted(_ items: [StudioOrderSummary]) -> [StudioOrderSummary] {
        items.sorted { ($0.placedDate ?? .distantPast) > ($1.placedDate ?? .distantPast) }
    }
}

/// Studio › Orders: status tabs with badges, search, rows, pagination.
@MainActor
struct StudioOrdersView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = StudioOrdersModel()
    @State private var tab: StudioOrdersTab = .toShip
    @State private var search: String = ""
    @State private var searchCommitted: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Text("Orders")
                    .yardDisplay(40)
                    .foregroundStyle(Color.yard.ink)
                tabs
                searchField
                content
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await model.load(studio: studio, tab: tab, search: searchCommitted, force: true)
        }
        .task(id: "\(studio.activeBrandId ?? "")|\(tab.rawValue)|\(searchCommitted)|\(studio.dataVersion)") {
            await model.load(studio: studio, tab: tab, search: searchCommitted, force: model.loadedKey != nil)
        }
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.s) {
                ForEach(StudioOrdersTab.allCases, id: \.self) { t in
                    Chip(t.title, isSelected: tab == t, count: (t == .toShip && studio.toShipCount > 0) ? studio.toShipCount : nil) {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { tab = t }
                    }
                }
            }
        }
        .scrollClipDisabled()
    }

    private var searchField: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "magnifyingglass").foregroundStyle(Color.yard.ink3)
            TextField("Search by order reference", text: $search)
                .font(.yardBody)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { searchCommitted = search }
            if !search.isEmpty {
                Button {
                    search = ""
                    searchCommitted = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.yard.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear search"))
            }
        }
        .padding(.horizontal, Spacing.m)
        .frame(height: 44)
        .background(Color.yard.surface2, in: Capsule())
    }

    @ViewBuilder
    private var content: some View {
        if model.loading && model.items.isEmpty {
            StudioRowsSkeleton()
        } else if let error = model.error, model.items.isEmpty {
            EmptyState.error(message: error) { await model.load(studio: studio, tab: tab, search: searchCommitted, force: true) }
        } else if model.items.isEmpty {
            EmptyState(title: tab.emptyTitle, message: tab == .toShip ? "New paid orders land here. We'll notify you." : nil, systemImage: "shippingbox")
        } else {
            LazyVStack(spacing: Spacing.s) {
                ForEach(model.items) { order in
                    Button {
                        Haptics.selection()
                        studio.push(.order(id: order.id))
                    } label: {
                        StudioOrderRow(order: order)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
                if model.hasMore {
                    YardButton("Load more", style: .secondary, size: .medium, isLoading: model.loadingMore) {
                        Task { @MainActor in await model.loadMore(studio: studio, tab: tab, search: searchCommitted) }
                    }
                    .padding(.top, Spacing.s)
                }
            }
        }
    }
}

/// One order row: reference, customer and place, items, total and status.
struct StudioOrderRow: View {
    let order: StudioOrderSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(order.reference)
                    .font(.yardHeadline.monospaced())
                    .foregroundStyle(Color.yard.ink)
                Spacer()
                Tag(StudioOrderState.label(order.merchantState), style: StudioOrderState.style(order.merchantState))
            }
            Text(itemsLine)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .lineLimit(1)
            HStack {
                Label(customerLine, systemImage: "person")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .lineLimit(1)
                Spacer()
                Text(order.total)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
            }
            if let date = order.placedDate {
                Text(Formatters.relative(date))
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .yardCard()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var itemsLine: String {
        guard let first = order.previewItems.first else { return "\(order.itemCount) item\(order.itemCount == 1 ? "" : "s")" }
        let qty = first.qty > 1 ? " ×\(first.qty)" : ""
        let more = order.itemCount - first.qty
        return more > 0 ? "\(first.name)\(qty) and \(more) more" : "\(first.name)\(qty)"
    }

    private var customerLine: String {
        let place = [order.shipCity, order.shipCountry].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        return place.isEmpty ? order.customerName : "\(order.customerName) · \(place)"
    }
}

#Preview("Studio orders — dark") {
    NavigationStack { StudioOrdersView() }
        .yardPreviewEnvironment()
        .environment(StudioStore.preview())
        .preferredColorScheme(.dark)
}

#Preview("Studio orders — light") {
    NavigationStack { StudioOrdersView() }
        .yardPreviewEnvironment()
        .environment(StudioStore.preview())
        .preferredColorScheme(.light)
}
