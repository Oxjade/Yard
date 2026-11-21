import SwiftUI
import Charts
import Observation

/// Which sales window the Home card shows.
enum StudioSalesRange: String, CaseIterable, Hashable, Sendable {
    case today
    case week
    case month

    var title: String {
        switch self {
        case .today: return "Today"
        case .week: return "7 days"
        case .month: return "30 days"
        }
    }

    /// The dashboard `days` that feeds the chart for this window.
    var seriesDays: Int { self == .month ? 30 : 7 }
}

@Observable
@MainActor
final class StudioHomeModel {
    private(set) var dashboard: StudioDashboard?
    private(set) var loading: Bool = false
    private(set) var error: String?
    private var loadedDays: Int = 0

    func load(studio: StudioStore, days: Int, force: Bool = false) async {
        if !force, dashboard != nil, loadedDays == days { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await studio.call { try await StudioAPI.dashboard(days: days) }
            dashboard = next
            loadedDays = days
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
    }
}

/// Studio Home: "Hello {brand}", the sales card with an animated chart, quick actions, to do,
/// top products and store views.
@MainActor
struct StudioHomeView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = StudioHomeModel()
    @State private var range: StudioSalesRange = .week
    @State private var chartProgress: Double = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                header
                if let brand = studio.activeBrand, brand.isPending || brand.isRestricted {
                    statusBanner(brand)
                }
                if let dashboard = model.dashboard {
                    salesCard(dashboard)
                    quickActions(dashboard)
                    todo(dashboard)
                    topProducts(dashboard)
                    views(dashboard)
                } else if let error = model.error {
                    EmptyState.error(message: error) { await reload(force: true) }
                } else {
                    skeleton
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await reload(force: true)
            Haptics.success()
        }
        .task(id: "\(studio.activeBrandId ?? "")-\(range.seriesDays)-\(studio.dataVersion)") {
            await reload(force: studio.dataVersion > 0)
        }
        .onChange(of: model.dashboard?.series.points.count) { _, _ in
            animateChart()
        }
    }

    private func reload(force: Bool) async {
        await model.load(studio: studio, days: range.seriesDays, force: force)
    }

    private func animateChart() {
        chartProgress = 0
        withAnimation(Motion.resolved(.spring(response: 0.9, dampingFraction: 0.85), reduceMotion: reduceMotion)) {
            chartProgress = 1
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Hello")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                Text(studio.activeBrand?.name ?? "Studio")
                    .yardDisplay(40)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
            Spacer()
            if let brand = studio.activeBrand {
                Button {
                    Haptics.selection()
                    studio.select(.me)
                } label: {
                    StudioBrandMark(brand: brand, size: 48, sessionOpen: studio.profile != nil)
                }
                .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
                .accessibilityLabel(Text("\(brand.name), open Me"))
            }
        }
    }

    private func statusBanner(_ brand: ShopperBrand) -> some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            Image(systemName: brand.isPending ? "hourglass" : "pause.circle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.yard.studio)
            VStack(alignment: .leading, spacing: 4) {
                Text(brand.isPending ? "Yard is reviewing \(brand.name)" : "Publishing is paused")
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                Text(brand.isPending
                     ? "Add your products now. They go live once Yard approves your shop."
                     : "Yard paused publishing and replies for this shop. Message Yard Support to sort it out.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.studio.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    // MARK: Sales

    private func window(_ d: StudioDashboard) -> StudioSalesWindow {
        switch range {
        case .today: return d.sales.today
        case .week: return d.sales.week
        case .month: return d.sales.month
        }
    }

    private func salesCard(_ d: StudioDashboard) -> some View {
        let w = window(d)
        return StudioInkCard {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack {
                    Text("Sales")
                        .font(.yardCallout.weight(.semibold))
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.7))
                    Spacer()
                    rangePicker
                }
                Text(Formatters.price(minor: w.netMinor, currency: d.brand.currency))
                    .font(.system(size: 44, weight: .black).width(.compressed))
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.onPhoto)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .accessibilityLabel(Text("Net sales \(range.title): \(Formatters.price(minor: w.netMinor, currency: d.brand.currency))"))
                HStack(spacing: Spacing.m) {
                    Label("\(w.orders) order\(w.orders == 1 ? "" : "s")", systemImage: "shippingbox")
                    if w.refundedMinor > 0 {
                        Label("\(Formatters.price(minor: w.refundedMinor, currency: d.brand.currency)) refunded", systemImage: "arrow.uturn.backward")
                    }
                }
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.acid)
                chart(d)
            }
        }
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: range)
    }

    private var rangePicker: some View {
        HStack(spacing: 2) {
            ForEach(StudioSalesRange.allCases, id: \.self) { r in
                Button {
                    Haptics.selection()
                    range = r
                } label: {
                    Text(r.title)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(range == r ? Color.yard.onAcid : Color.yard.onPhoto.opacity(0.75))
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(range == r ? Color.yard.acid : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(range == r ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Color.yard.onPhoto.opacity(0.1), in: Capsule())
    }

    @ViewBuilder
    private func chart(_ d: StudioDashboard) -> some View {
        let points = d.series.points
        if points.isEmpty {
            EmptyView()
        } else {
            Chart(points) { p in
                let value = Double(p.netMinor) * chartProgress
                AreaMark(
                    x: .value("Day", p.day ?? Date()),
                    y: .value("Net", value)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(
                    LinearGradient(colors: [Color.yard.acid.opacity(0.35), Color.yard.acid.opacity(0)], startPoint: .top, endPoint: .bottom)
                )
                LineMark(
                    x: .value("Day", p.day ?? Date()),
                    y: .value("Net", value)
                )
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .foregroundStyle(Color.yard.acid)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: 0...max(1, Double(points.map(\.netMinor).max() ?? 1)))
            .frame(height: 96)
            .accessibilityLabel(Text("Net sales over the last \(d.series.days) days"))
            .onAppear { if chartProgress == 0 { animateChart() } }
        }
    }

    // MARK: Quick actions

    private func quickActions(_ d: StudioDashboard) -> some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            Button { studio.isQuickAddPresented = true; Haptics.impact(.light) } label: {
                StudioQuickActionLabel(title: "Add product", systemImage: "plus")
            }
            .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
            Button { studio.select(.orders); Haptics.impact(.light) } label: {
                StudioQuickActionLabel(title: "Orders", systemImage: "shippingbox", badge: d.toShip.total)
            }
            .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
            if studio.activeBrand?.canSeePayouts ?? false {
                Button { studio.show(.payouts, in: .me); Haptics.impact(.light) } label: {
                    StudioQuickActionLabel(title: "Payouts", systemImage: "banknote")
                }
                .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
            }
            ShareLink(item: Config.webURL("/brands/\(d.brand.handle)")) {
                StudioQuickActionLabel(title: "Share shop", systemImage: "square.and.arrow.up")
            }
            .simultaneousGesture(TapGesture().onEnded { Haptics.impact(.light) })
        }
    }

    // MARK: To do

    private struct TodoItem: Identifiable {
        let id: String
        let icon: String
        let title: String
        let action: () -> Void
    }

    private func todoItems(_ d: StudioDashboard) -> [TodoItem] {
        var items: [TodoItem] = []
        if d.toShip.total > 0 {
            items.append(TodoItem(id: "ship", icon: "shippingbox.fill", title: "\(d.toShip.total) order\(d.toShip.total == 1 ? "" : "s") to ship") {
                studio.select(.orders)
            })
        }
        if let unread = d.unreadMessages, unread > 0 {
            items.append(TodoItem(id: "inbox", icon: "bubble.left.fill", title: "\(unread) unread message\(unread == 1 ? "" : "s")") {
                studio.show(.inbox, in: .me)
            })
        }
        if d.lowStock.variants > 0 {
            items.append(TodoItem(id: "stock", icon: "exclamationmark.triangle.fill", title: "\(d.lowStock.products) product\(d.lowStock.products == 1 ? "" : "s") low on stock") {
                studio.lowStockFilterRequested = true
                studio.select(.products)
            })
        }
        if d.websitePieces > 0 {
            items.append(TodoItem(id: "site", icon: "globe", title: "\(d.websitePieces) new from your website") {
                studio.show(.websitePieces, in: .products)
            })
        }
        return items
    }

    private func todo(_ d: StudioDashboard) -> some View {
        let items = todoItems(d)
        return StudioGroup("To do") {
            if items.isEmpty {
                HStack(spacing: Spacing.m) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Color.yard.success)
                    Text("All caught up.")
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink2)
                    Spacer()
                }
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: 52)
            } else {
                ForEach(items) { item in
                    Button {
                        Haptics.selection()
                        item.action()
                    } label: {
                        SettingsRow(item.title, systemImage: item.icon)
                    }
                    .buttonStyle(.plain)
                    if item.id != items.last?.id {
                        Divider().overlay(Color.yard.line).padding(.leading, 60)
                    }
                }
            }
        }
    }

    // MARK: Top products

    @ViewBuilder
    private func topProducts(_ d: StudioDashboard) -> some View {
        StudioGroup("Top products") {
            if d.topProducts.isEmpty {
                Text("Your best sellers show here after your first sales.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .padding(Spacing.m)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(d.topProducts.enumerated()), id: \.element.id) { index, p in
                    Button {
                        Haptics.selection()
                        studio.show(.product(id: p.productId), in: .products)
                    } label: {
                        HStack(spacing: Spacing.m) {
                            Text("\(index + 1)")
                                .font(.yardNumber(15))
                                .foregroundStyle(Color.yard.ink3)
                                .frame(width: 18)
                            RemoteImage(path: p.imageSrc, contentMode: .fill, maxPixelSize: 150)
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.title)
                                    .font(.yardBodyEmphasis)
                                    .foregroundStyle(Color.yard.ink)
                                    .lineLimit(1)
                                Text("\(p.units) sold")
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink2)
                            }
                            Spacer()
                            Text(Formatters.price(minor: p.revenueMinor, currency: p.currency))
                                .font(.yardCallout.weight(.semibold))
                                .foregroundStyle(Color.yard.ink)
                        }
                        .padding(.horizontal, Spacing.m)
                        .frame(minHeight: 60)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Views

    private func views(_ d: StudioDashboard) -> some View {
        StudioGroup("Shop views") {
            HStack(spacing: 0) {
                stat("Today", d.storeViews.today)
                Divider().overlay(Color.yard.line).frame(height: 36)
                stat("7 days", d.storeViews.week)
                Divider().overlay(Color.yard.line).frame(height: 36)
                stat("30 days", d.storeViews.month)
            }
            .padding(.vertical, Spacing.m)
        }
    }

    private func stat(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 2) {
            Text(Formatters.count(value))
                .font(.yardNumber(22))
                .foregroundStyle(Color.yard.ink)
                .contentTransition(.numericText())
            Text(title)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Loading

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            Skeleton(cornerRadius: 24).frame(height: 230)
            HStack(spacing: Spacing.s) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(spacing: Spacing.s) {
                        Skeleton(shape: .circle).frame(width: 60, height: 60)
                        Skeleton(cornerRadius: 4).frame(width: 50, height: 10)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            StudioRowsSkeleton(count: 3)
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
