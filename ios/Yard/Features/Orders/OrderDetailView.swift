import SwiftUI
import Observation
import UIKit

@Observable
@MainActor
final class OrderDetailModel {
    var order: OrderDetail?
    var isLoading: Bool = true
    var error: Error?
    var brandCity: String?
    var isCancelling: Bool = false

    init() {}

    init(previewOrder: OrderDetail, brandCity: String? = nil) {
        order = previewOrder
        self.brandCity = brandCity
        isLoading = false
    }

    func load(id: String) async {
        if order == nil { isLoading = true }
        do {
            let fresh = try await OrdersAPI.detail(id: id)
            order = fresh
            error = nil
            if brandCity == nil {
                brandCity = await OrdersAPI.brandCity(handle: fresh.summary.brand.handle)
            }
        } catch {
            let cancelled = (error as? APIError)?.isCancelled == true || error is CancellationError
            if !cancelled && order == nil { self.error = error }
        }
        isLoading = false
    }

    func cancel(id: String) async throws {
        isCancelling = true
        defer { isCancelling = false }
        order = try await OrdersAPI.cancel(id: id)
    }
}

/// Reference 07: big status heading + subtitle, the tracking card once shipped, then a card with
/// Status / Details. Status is the vertical timeline; Details has items, address, payment,
/// tracking (copy), help (message the brand), returns and cancel.
@MainActor
struct OrderDetailView: View {
    let id: String

    fileprivate enum Tab: String, Hashable, CaseIterable {
        case status
        case details

        var title: String {
            switch self {
            case .status: return "Status"
            case .details: return "Details"
            }
        }
    }

    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast
    @Environment(\.openURL) private var openURL
    @State private var model: OrderDetailModel
    @State private var tab: Tab = .status
    @State private var showsCancelConfirm = false
    @State private var showsReturnSheet = false
    @State private var cancelledTrigger = 0
    private let isPreview: Bool

    init(id: String) {
        self.id = id
        self._model = State(initialValue: OrderDetailModel())
        self.isPreview = false
    }

    /// Preview-only: renders a fixture order without the network.
    init(previewModel: OrderDetailModel) {
        self.id = previewModel.order?.id ?? "preview"
        self._model = State(initialValue: previewModel)
        self.isPreview = true
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("Your order")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(id)|\(session.isSignedIn)") {
                guard !isPreview, session.isSignedIn else { return }
                await reload()
            }
            .sheet(isPresented: $showsReturnSheet) {
                if let order = model.order {
                    OrderReturnSheet(order: order) { updated in
                        model.order = updated
                        showsReturnSheet = false
                        toast.show("Return requested. The brand will review it.", style: .success)
                    }
                    .yardToastHost(toast)
                }
            }
            .confirmationDialog("Cancel this order?", isPresented: $showsCancelConfirm, titleVisibility: .visible) {
                Button("Cancel order", role: .destructive) { cancelOrder() }
                Button("Keep order", role: .cancel) {}
            } message: {
                Text("This can’t be undone. A paid order is refunded in full.")
            }
            .sensoryFeedback(.success, trigger: cancelledTrigger)
    }

    @ViewBuilder
    private var content: some View {
        if !isPreview && !session.isSignedIn {
            if session.hasLoaded {
                EmptyState.signedOut(message: "Sign in to see your orders.") { router.present(.signIn) }
            } else {
                OrderDetailSkeleton()
            }
        } else if model.isLoading && model.order == nil {
            OrderDetailSkeleton()
        } else if let order = model.order {
            loaded(order)
        } else if let error = model.error {
            if let api = error as? APIError, api.isNotFound {
                EmptyState(title: "Order unavailable", message: "We couldn’t find this order.", systemImage: "shippingbox", actionTitle: "Back to orders") {
                    router.pop()
                }
            } else {
                EmptyState.error(error) { await reload() }
            }
        } else {
            OrderDetailSkeleton()
        }
    }

    // MARK: Loaded

    private func loaded(_ order: OrderDetail) -> some View {
        let snapshot = OrderTrackingSnapshot.from(order: order, brandCity: model.brandCity)
        return ScrollView {
            VStack(spacing: Spacing.xl) {
                header(order)
                if let snapshot {
                    TrackingCard(
                        snapshot: snapshot,
                        onDetails: { withAnimation(Motion.spring) { tab = .details } },
                        onTrack: { if let url = snapshot.trackingURL { openURL(url) } }
                    )
                    if order.status == .shipped {
                        LiveActivityTrackButton(orderId: order.id)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    SegmentedPill(selection: $tab, options: Tab.allCases) { $0.title }
                    switch tab {
                    case .status:
                        statusTab(order)
                    case .details:
                        detailsTab(order)
                    }
                }
                .padding(Spacing.l)
                .yardCard()

                Text("Each brand ships its own order, with its own tracking and returns.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.l)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xxxl)
        }
        .refreshable { await reload() }
    }

    /// Loads the order, then keeps the Live Activity in step with it (starts once shipped, ends
    /// when delivered or cancelled). Skipped for orders that never shipped and aren't tracked.
    private func reload() async {
        await model.load(id: id)
        guard let order = model.order else { return }
        let relevant = order.status == .shipped || order.status == .delivered || order.status == .cancelled
        if relevant || LiveActivityManager.shared.isTracking(orderId: id) {
            await LiveActivityManager.shared.sync(orderId: id)
        }
    }

    private func header(_ order: OrderDetail) -> some View {
        let status = order.status
        return VStack(spacing: Spacing.s) {
            Image(systemName: status.systemImage)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.yard.bg)
                .frame(width: 76, height: 76)
                .background(status == .cancelled ? Color.yard.danger : Color.yard.ink, in: Circle())
                .padding(.bottom, Spacing.s)
                .accessibilityHidden(true)
            Text(status.label)
                .yardDisplay(40)
                .foregroundStyle(Color.yard.ink)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(OrderStatusText.note(status: status, payment: order.summary.states.payment))
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                if !order.summary.brand.handle.isEmpty {
                    router.push(.brand(handle: order.summary.brand.handle))
                }
            } label: {
                HStack(spacing: Spacing.xs) {
                    Text(order.summary.brand.name)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Text("· Order \(order.summary.reference)")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.xs)
                .background(Color.yard.surface2, in: Capsule())
            }
            .buttonStyle(PressableButtonStyle())
            .padding(.top, Spacing.xs)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Spacing.l)
    }

    // MARK: Status tab

    private func statusTab(_ order: OrderDetail) -> some View {
        let steps = OrderTimelineBuilder.steps(for: order)
        let events = Array((order.delivery?.events ?? []).reversed())
        let history = order.timeline.filter { $0.label != nil }
        return VStack(alignment: .leading, spacing: Spacing.xl) {
            OrderTimelineView(steps: steps)

            if let estimate = order.delivery?.estimate, order.status.isOpen, order.status != .pendingPayment,
               let range = OrderText.range(estimate.arrivalFrom, estimate.arrivalTo), order.summary.states.fulfilment != "delivered" {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "calendar")
                        .foregroundStyle(Color.yard.ink2)
                    Text(estimate.late ? "Running late, est. \(range)" : "Estimated arrival \(range)")
                        .font(.yardCallout)
                        .foregroundStyle(estimate.late ? Color.yard.violet : Color.yard.ink)
                }
                .padding(Spacing.m)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            }

            if !events.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    Text("Carrier updates")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                    ForEach(events) { event in
                        HStack(alignment: .top, spacing: Spacing.m) {
                            Circle()
                                .fill(event.status == "exception" ? Color.yard.danger : Color.yard.ink3)
                                .frame(width: 6, height: 6)
                                .padding(.top, 7)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.label)
                                    .font(.yardBody)
                                    .foregroundStyle(Color.yard.ink)
                                let meta: [String] = [event.date.map { OrderText.stamp($0) }, OrderText.nonEmpty(event.locationText)].compactMap { $0 }
                                if !meta.isEmpty {
                                    Text(meta.joined(separator: " · "))
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink3)
                                }
                                if let note = OrderText.nonEmpty(event.note), event.status == "exception" {
                                    Text(note)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink2)
                                }
                            }
                        }
                    }
                }
            }

            if history.count > 0 {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: Spacing.m) {
                        ForEach(history) { event in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.label ?? "")
                                    .font(.yardCallout)
                                    .foregroundStyle(Color.yard.ink)
                                if let date = event.date {
                                    Text(OrderText.stamp(date))
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink3)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.top, Spacing.m)
                } label: {
                    Text("Order history")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                }
                .tint(Color.yard.ink2)
            }
        }
    }

    // MARK: Details tab

    private func detailsTab(_ order: OrderDetail) -> some View {
        let currency = order.summary.currency
        return VStack(alignment: .leading, spacing: Spacing.xl) {
            // Items
            section("Items (\(order.summary.itemCount))") {
                VStack(spacing: Spacing.m) {
                    ForEach(order.lines) { line in
                        HStack(alignment: .top, spacing: Spacing.m) {
                            RemoteImage(url: line.imageURL, maxPixelSize: 300)
                                .frame(width: 64, height: 80)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                                .accessibilityLabel(Text(line.image?.alt ?? line.title))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(line.title)
                                    .font(.yardBodyEmphasis)
                                    .foregroundStyle(Color.yard.ink)
                                    .lineLimit(2)
                                if !line.variantLabel.isEmpty {
                                    Text(line.variantLabel)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink2)
                                }
                                Text("Qty \(line.qty)\(line.returnedQty > 0 ? ", \(line.returnedQty) returned" : "")")
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink3)
                            }
                            Spacer(minLength: Spacing.s)
                            PriceText(minor: line.unitMinor * line.qty, currency: currency, font: .yardCallout.weight(.semibold))
                        }
                    }
                }
            }

            // Summary + payment
            section("Summary") {
                VStack(spacing: Spacing.s) {
                    summaryRow("Subtotal", Formatters.price(minor: order.summary.subtotalMinor, currency: currency))
                    summaryRow("Shipping", order.summary.shippingMinor > 0 ? Formatters.price(minor: order.summary.shippingMinor, currency: currency) : "Free")
                    if order.summary.refundedMinor > 0 {
                        summaryRow("Refunded", "−" + Formatters.price(minor: order.summary.refundedMinor, currency: currency))
                    }
                    Divider().overlay(Color.yard.line)
                    HStack {
                        Text("Total").font(.yardBodyEmphasis).foregroundStyle(Color.yard.ink)
                        Spacer()
                        PriceText(minor: order.summary.totalMinor, currency: currency)
                    }
                    Text(OrderStatusText.payment(order.summary.states.payment))
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            // Ship to
            section("Ship to") {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(order.shipTo?.formatted.isEmpty == false ? (order.shipTo?.formatted ?? "") : "Address unavailable")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    Text("Shipping service: \(OrderText.serviceLabel(order.summary.service))")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
            }

            // Tracking
            section("Tracking") {
                if let tracking = order.tracking {
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        HStack(spacing: Spacing.m) {
                            VStack(alignment: .leading, spacing: 2) {
                                if let carrier = tracking.carrier {
                                    Text(carrier)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink3)
                                }
                                Text(tracking.number)
                                    .font(.system(.body, design: .monospaced).weight(.semibold))
                                    .foregroundStyle(Color.yard.ink)
                                    .textSelection(.enabled)
                            }
                            Spacer(minLength: Spacing.s)
                            Button {
                                UIPasteboard.general.string = tracking.number
                                toast.show("Tracking number copied", style: .success, systemImage: "doc.on.doc")
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                                    .font(.yardCaptionEmphasis)
                                    .foregroundStyle(Color.yard.ink)
                                    .padding(.horizontal, Spacing.m)
                                    .frame(height: 34)
                                    .background(Color.yard.surface2, in: Capsule())
                            }
                            .buttonStyle(PressableButtonStyle())
                            .accessibilityLabel("Copy tracking number")
                        }
                        if let url = OrderText.trackingURL(number: tracking.number, carrier: tracking.carrier) {
                            Button {
                                openURL(url)
                            } label: {
                                HStack(spacing: Spacing.xs) {
                                    Text("Track with \(tracking.carrier ?? "the carrier")")
                                    Image(systemName: "arrow.up.right")
                                }
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(Color.yard.violet)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else {
                    Text(order.status.isOpen ? "Tracking appears when it ships." : "No tracking for this order.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                }
            }

            // Returns
            section("Returns") {
                returnsContent(order)
            }

            // Help
            section("Help") {
                VStack(spacing: 0) {
                    // Yard Support with this order attached (web: "Get help from Yard" on the order page).
                    Button {
                        router.push(.support(orderId: order.id, orderReference: order.summary.reference))
                    } label: {
                        SettingsRow("Get help from Yard", systemImage: "questionmark.bubble")
                    }
                    .buttonStyle(.plain)
                    .disabled(order.id.isEmpty)
                    Divider().overlay(Color.yard.line)
                    Button {
                        router.push(.messageBrand(brandId: order.summary.brand.id))
                    } label: {
                        SettingsRow("Message \(order.summary.brand.name) about this order", systemImage: "bubble.left.and.bubble.right")
                    }
                    .buttonStyle(.plain)
                    .disabled(order.summary.brand.id.isEmpty)
                    Divider().overlay(Color.yard.line)
                    Button {
                        router.push(.legal(.refunds))
                    } label: {
                        SettingsRow("Refunds and returns policy", systemImage: "doc.text")
                    }
                    .buttonStyle(.plain)
                }
                .background(Color.yard.surface2.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            }

            if order.actions.canCancel {
                YardButton("Cancel order", style: .destructive, size: .medium, isLoading: model.isCancelling) {
                    showsCancelConfirm = true
                }
            }

            if let placed = order.summary.placedDate {
                Text("Placed \(OrderText.longDate(placed))")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
    }

    @ViewBuilder
    private func returnsContent(_ order: OrderDetail) -> some View {
        if let open = order.openReturn {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Tag(open.status == "approved" ? "Return approved" : "Return requested", style: .violet, systemImage: "arrow.uturn.backward")
                Text("\(open.reasonLabel). \(open.itemCount) \(open.itemCount == 1 ? "item" : "items") requested.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
        } else if order.actions.canRequestReturn {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Text(returnWindowText(order))
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                YardButton("Request a return", systemImage: "arrow.uturn.backward", style: .secondary, size: .medium) {
                    showsReturnSheet = true
                }
            }
        } else if let last = order.returns.last {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(returnOutcome(last))
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            Text("Returns are available after delivery while the return window is open.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
        }
    }

    private func returnWindowText(_ order: OrderDetail) -> String {
        if let ends = YardDate.parse(order.actions.returnWindowEndsAt) {
            return "This order is within its return window, until \(OrderText.longDate(ends))."
        }
        return "This order is within its return window."
    }

    private func returnOutcome(_ r: OrderReturn) -> String {
        switch r.status {
        case "rejected": return r.decisionReason.map { "Your return was declined: \($0)." } ?? "Your return was declined."
        case "received": return "The brand received your return."
        case "cancelled": return "You withdrew your return request."
        case "expired": return "Your return request expired."
        default: return "Return \(r.status): \(r.reasonLabel)."
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(title)
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.yardCallout).foregroundStyle(Color.yard.ink2)
            Spacer()
            Text(value).font(.yardCallout.monospacedDigit()).foregroundStyle(Color.yard.ink)
        }
    }

    private func cancelOrder() {
        Task { @MainActor in
            do {
                try await model.cancel(id: id)
                cancelledTrigger += 1
                toast.show("Order cancelled", style: .success)
            } catch {
                toast.show(error)
            }
        }
    }
}

// MARK: - Return request sheet

/// Request a return: which pieces (up to what's not yet returned), a reason, an optional note.
@MainActor
struct OrderReturnSheet: View {
    let order: OrderDetail
    let onDone: (OrderDetail) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var quantities: [String: Int] = [:]
    @State private var reason: OrderReturnReason = .unwanted
    @State private var note: String = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    init(order: OrderDetail, onDone: @escaping (OrderDetail) -> Void) {
        self.order = order
        self.onDone = onDone
    }

    private var returnable: [OrderLine] { order.lines.filter { $0.returnableQty > 0 } }

    var body: some View {
        VStack(spacing: 0) {
            YardSheetHeader("Request a return", subtitle: "\(order.summary.brand.name) · Order \(order.summary.reference)") { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    VStack(alignment: .leading, spacing: Spacing.m) {
                        Text("Items to return")
                            .font(.yardHeadline)
                            .foregroundStyle(Color.yard.ink)
                        ForEach(returnable) { line in
                            HStack(spacing: Spacing.m) {
                                RemoteImage(url: line.imageURL, maxPixelSize: 200)
                                    .frame(width: 44, height: 56)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.title)
                                        .font(.yardCallout.weight(.semibold))
                                        .foregroundStyle(Color.yard.ink)
                                        .lineLimit(1)
                                    Text("\(line.variantLabel.isEmpty ? "" : line.variantLabel + ", ")up to \(line.returnableQty)")
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink3)
                                }
                                Spacer(minLength: Spacing.s)
                                QuantityStepper(value: quantities[line.variantId] ?? 0, range: 0...line.returnableQty) { newValue in
                                    quantities[line.variantId] = newValue
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: Spacing.m) {
                        Text("Reason")
                            .font(.yardHeadline)
                            .foregroundStyle(Color.yard.ink)
                        VStack(spacing: Spacing.s) {
                            ForEach(OrderReturnReason.allCases) { option in
                                Button {
                                    withAnimation(Motion.snappy) { reason = option }
                                } label: {
                                    HStack {
                                        Text(option.label)
                                            .font(.yardCallout)
                                            .foregroundStyle(Color.yard.ink)
                                        Spacer()
                                        Image(systemName: reason == option ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(reason == option ? Color.yard.ink : Color.yard.ink3)
                                    }
                                    .padding(.horizontal, Spacing.m)
                                    .frame(height: 44)
                                    .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(reason == option ? .isSelected : [])
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: Spacing.s) {
                        Text("Note (optional)")
                            .font(.yardHeadline)
                            .foregroundStyle(Color.yard.ink)
                        TextField("Anything the brand should know", text: $note, axis: .vertical)
                            .lineLimit(3...6)
                            .font(.yardBody)
                            .foregroundStyle(Color.yard.ink)
                            .padding(Spacing.m)
                            .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                            .onChange(of: note) { _, value in
                                if value.count > 1000 { note = String(value.prefix(1000)) }
                            }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.danger)
                    }

                    YardButton("Send request", isLoading: isSending) { send() }
                    Text("Returns are handled by \(order.summary.brand.name), within its own return window.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
                .padding(Spacing.gutter)
            }
        }
        .background(Color.yard.bg.ignoresSafeArea())
        .yardSheet(detents: [.large])
    }

    private func send() {
        let lines: [OrderReturnLineBody] = returnable.compactMap { (line: OrderLine) -> OrderReturnLineBody? in
            let qty = quantities[line.variantId] ?? 0
            return qty > 0 ? OrderReturnLineBody(variantId: line.variantId, qty: qty) : nil
        }
        guard !lines.isEmpty else {
            errorMessage = "Choose at least one item to return."
            return
        }
        isSending = true
        errorMessage = nil
        Task { @MainActor in
            do {
                let updated = try await OrdersAPI.requestReturn(id: order.id, lines: lines, reason: reason, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
                isSending = false
                onDone(updated)
            } catch {
                isSending = false
                errorMessage = APIError.message(for: error)
            }
        }
    }
}

// MARK: - Skeleton

private struct OrderDetailSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                Skeleton(shape: .circle).frame(width: 76, height: 76).padding(.top, Spacing.xl)
                Skeleton(cornerRadius: 8).frame(width: 200, height: 34)
                Skeleton(cornerRadius: 6).frame(width: 260, height: 14)
                Skeleton(cornerRadius: Radius.card).frame(height: 230).padding(.top, Spacing.m)
                Skeleton(cornerRadius: Radius.card).frame(height: 320)
            }
            .padding(.horizontal, Spacing.gutter)
        }
        .scrollDisabled(true)
    }
}

// MARK: - Previews

extension OrderPreviewData {
    static let detail = OrderDetail(
        summary: summaries[0],
        lines: [
            OrderLine(id: "l1", variantId: "v1", productId: "p1", title: "Boxy tee", qty: 1, unitMinor: 4500, variantLabel: "Size M", image: nil),
            OrderLine(id: "l2", variantId: "v3", productId: "p3", title: "Cargo pant", qty: 1, unitMinor: 7500, variantLabel: "Size 32", image: nil),
        ],
        shipTo: OrderShipTo(name: "Ada Obi", line1: "12 Example Road", city: "London", postcode: "E1 6AN", country: "GB"),
        paidAt: "2026-11-11T09:13:00.000Z",
        timeline: [
            OrderEvent(id: "e1", kind: "order.placed", at: "2026-11-11T09:12:00.000Z"),
            OrderEvent(id: "e2", kind: "payment.captured", at: "2026-11-11T09:13:00.000Z"),
            OrderEvent(id: "e3", kind: "fulfilment.processing", at: "2026-11-12T10:00:00.000Z"),
            OrderEvent(id: "e4", kind: "fulfilment.shipped", at: "2026-11-13T08:30:00.000Z"),
        ],
        actions: OrderActions(),
        delivery: OrderDelivery(
            service: "standard",
            shipTo: OrderDeliveryShipTo(country: "GB", city: "London"),
            estimate: OrderEstimate(arrivalFrom: "2026-11-16", arrivalTo: "2026-11-19"),
            shippedOn: "2026-11-13",
            events: [ShipmentEvent(id: "s1", status: "shipped", occurredAt: "2026-11-13T08:30:00.000Z", carrier: "DHL", trackingNumber: "JD014600006281234567", locationText: "Lagos")]
        )
    )
}

#Preview("OrderDetailView — dark") {
    NavigationStack { OrderDetailView(previewModel: OrderDetailModel(previewOrder: OrderPreviewData.detail, brandCity: "Lagos")) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrderDetailView — light") {
    NavigationStack { OrderDetailView(previewModel: OrderDetailModel(previewOrder: OrderPreviewData.detail, brandCity: "Lagos")) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
