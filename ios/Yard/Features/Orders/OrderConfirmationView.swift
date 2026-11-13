import SwiftUI
import Observation
import UIKit

/// Loads one checkout and its brand orders; while the payment is pending it re-reads every
/// 2.5 s for a minute, asking the provider directly every 4th read (the website's
/// confirmation-view.tsx behaviour).
@Observable
@MainActor
final class OrderConfirmationModel {
    enum Confirming: Equatable {
        case idle
        case polling
        case timedOut
    }

    var checkout: OrderCheckout?
    var orders: [OrderSummary] = []
    var isLoading: Bool = true
    var error: Error?
    var confirming: Confirming = .idle

    private static let pollEvery: Duration = .milliseconds(2_500)
    private static let pollFor: TimeInterval = 60
    private static let verifyEvery: Int = 4

    init() {}

    init(previewCheckout: OrderCheckout, orders: [OrderSummary]) {
        self.checkout = previewCheckout
        self.orders = orders
        self.isLoading = false
    }

    func load(checkoutId: String) async {
        if checkout == nil { isLoading = true }
        do {
            async let c = OrdersAPI.checkout(id: checkoutId)
            async let o = OrdersAPI.checkoutOrders(checkoutId: checkoutId)
            let (checkoutResult, ordersResult) = try await (c, o)
            checkout = checkoutResult
            orders = ordersResult
            error = nil
        } catch {
            // Keep what's shown on a failed refresh; only an empty screen shows the error.
            if checkout == nil { self.error = error }
        }
        isLoading = false
    }

    /// Loads, then polls while the payment is pending. Ends when the task is cancelled.
    func start(checkoutId: String) async {
        await load(checkoutId: checkoutId)
        await poll(checkoutId: checkoutId)
    }

    func poll(checkoutId: String) async {
        guard let current = checkout, current.isPending, !current.isAbandoned else {
            confirming = .idle
            return
        }
        confirming = .polling
        let started = Date()
        var reads = 0
        while Date().timeIntervalSince(started) < Self.pollFor {
            do {
                try await Task.sleep(for: Self.pollEvery)
            } catch {
                return
            }
            reads += 1
            do {
                let next: OrderCheckout
                if reads % Self.verifyEvery == 0 {
                    next = try await OrdersAPI.verifyCheckout(id: checkoutId)
                } else {
                    next = try await OrdersAPI.checkout(id: checkoutId)
                }
                checkout = next
                if !next.isPending || next.isAbandoned {
                    if let fresh = try? await OrdersAPI.checkoutOrders(checkoutId: checkoutId) { orders = fresh }
                    confirming = .idle
                    return
                }
            } catch {
                if Task.isCancelled { return }
            }
        }
        confirming = .timedOut
    }

    var itemCount: Int { orders.reduce(0) { $0 + $1.itemCount } }
}

/// Reference 06: glowing success badge, "Order placed", the checkout as a ticket with a perforated
/// tear line, a details grid, one ticket section per brand, then Track order / Keep shopping.
@MainActor
struct OrderConfirmationView: View {
    let checkoutId: String

    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(CartStore.self) private var cart
    @Environment(ToastCenter.self) private var toast
    @Environment(\.openURL) private var openURL
    @State private var model: OrderConfirmationModel
    private let isPreview: Bool

    init(checkoutId: String) {
        self.checkoutId = checkoutId
        self._model = State(initialValue: OrderConfirmationModel())
        self.isPreview = false
    }

    /// Preview-only: renders fixture values without the network.
    init(previewModel: OrderConfirmationModel) {
        self.checkoutId = "preview"
        self._model = State(initialValue: previewModel)
        self.isPreview = true
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        router.popToRoot()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.yard.ink)
                            .frame(width: 36, height: 36)
                            .background(Color.yard.surface2, in: Circle())
                    }
                    .accessibilityLabel("Close")
                }
            }
            .task(id: "\(checkoutId)|\(session.isSignedIn)") {
                guard !isPreview, session.isSignedIn else { return }
                await model.start(checkoutId: checkoutId)
            }
            .onChange(of: model.checkout?.isPaid ?? false) { _, paid in
                // The cart was emptied server-side when the checkout was placed; resync the badge.
                if paid { Task { @MainActor in await cart.load() } }
            }
            .sensoryFeedback(.success, trigger: model.checkout?.isPaid ?? false)
    }

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn && session.hasLoaded && !isPreview {
            EmptyState.signedOut(message: "Sign in to see this order.") { router.present(.signIn) }
        } else if model.isLoading && model.checkout == nil {
            OrderConfirmationSkeleton()
        } else if let error = model.error, model.checkout == nil {
            EmptyState.error(error) { await model.start(checkoutId: checkoutId) }
        } else if let checkout = model.checkout {
            loaded(checkout)
        } else {
            EmptyState(title: "Order unavailable", message: "We couldn’t find this checkout.", systemImage: "shippingbox", actionTitle: "See your orders") {
                router.push(.orders)
            }
        }
    }

    // MARK: Loaded

    private enum Outcome {
        case confirmed
        case placed
        case notPaid
        case failed
    }

    private func outcomeFor(_ checkout: OrderCheckout) -> Outcome {
        if checkout.isFailed || model.orders.contains(where: { $0.states.payment == "failed" }) { return .failed }
        if checkout.isAbandoned { return .notPaid }
        if checkout.isPending || model.orders.contains(where: { $0.status == .pendingPayment }) { return .placed }
        return .confirmed
    }

    private func loaded(_ checkout: OrderCheckout) -> some View {
        let outcome = outcomeFor(checkout)
        return ScrollView {
            VStack(spacing: Spacing.xl) {
                header(checkout, outcome: outcome)
                if outcome == .placed {
                    confirmingRow
                }
                ticket(checkout, outcome: outcome)
                actions(checkout, outcome: outcome)
                Text("Quote the order ID if you contact us or a brand.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.xxxl)
        }
        .refreshable { await model.load(checkoutId: checkoutId) }
    }

    private func header(_ checkout: OrderCheckout, outcome: Outcome) -> some View {
        let single = model.orders.count == 1
        let brandName = model.orders.first?.brand.name
        let withBrand: String = brandName.map { (name: String) -> String in " with \(name)" } ?? ""
        let brandCount: Int = model.orders.count
        let title: String
        let subtitle: String
        let tone: OrderSuccessBadge.Tone
        switch outcome {
        case .confirmed:
            title = "Order confirmed"
            tone = .success
            subtitle = single
                ? "Your payment went through and \(brandName ?? "the brand") is preparing your order."
                : "Your payment went through and \(brandCount) brands are preparing their orders, each one shipping separately."
        case .placed:
            title = "Order placed"
            tone = .success
            subtitle = single
                ? "Your order\(withBrand) is in. Payment confirmation is pending: the brand starts preparing your order once the payment provider confirms it."
                : "Your checkout created \(brandCount) orders, one per brand. Payment confirmation is pending: each brand starts preparing its order once the payment provider confirms it."
        case .notPaid:
            title = "Payment wasn’t completed"
            tone = .pending
            subtitle = "The payment provider didn’t receive a payment: it was cancelled or the page was closed, so nothing was charged."
        case .failed:
            title = "Payment wasn’t completed"
            tone = .failed
            subtitle = "The payment provider couldn’t complete this payment. No payment was taken, and the order won’t be prepared. You can try placing it again."
        }
        return VStack(spacing: Spacing.s) {
            OrderSuccessBadge(tone: tone)
                .padding(.bottom, -Spacing.xl)
            Text(title)
                .yardDisplay(40)
                .foregroundStyle(Color.yard.ink)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var confirmingRow: some View {
        switch model.confirming {
        case .polling:
            HStack(spacing: Spacing.m) {
                ProgressView().tint(Color.yard.violet)
                Text("Checking your payment…")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                Spacer(minLength: 0)
            }
            .padding(Spacing.l)
            .yardCard()
        case .timedOut:
            HStack(spacing: Spacing.m) {
                Text("Still confirming your payment — we’ll email you when it’s confirmed.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Spacing.s)
                YardButton("Retry", style: .secondary, size: .small, fullWidth: false) {
                    Task { @MainActor in await model.start(checkoutId: checkoutId) }
                }
            }
            .padding(Spacing.l)
            .yardCard()
        case .idle:
            EmptyView()
        }
    }

    // MARK: Ticket

    private func ticket(_ checkout: OrderCheckout, outcome: Outcome) -> some View {
        let reference = checkout.reference ?? model.orders.first?.groupReference ?? checkout.id
        let created = YardDate.parse(checkout.createdAt)
        let first = model.orders.first
        let deliveryTo = OrderText.place(city: first?.shipToPreview.city, country: first?.shipToPreview.country)
        var items: [OrderDetailsGrid.Item] = [
            .init(label: "Order number", value: reference),
            .init(label: "Date", value: created.map { Formatters.dateTime($0) } ?? "—"),
            .init(label: "Items", value: "\(model.itemCount)"),
            .init(label: outcome == .confirmed ? "Total charged" : "Total", value: Formatters.price(minor: checkout.totalMinor, currency: checkout.currency)),
        ]
        if let deliveryTo { items.append(.init(label: "Delivery to", value: deliveryTo)) }
        if let method = checkout.payment?.methodLabel, outcome == .confirmed { items.append(.init(label: "Payment", value: method)) }

        let gridItems = items
        return OrderTicket {
            HStack(alignment: .top, spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("Checkout")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                    Text(reference)
                        .font(.yardTitle)
                        .foregroundStyle(Color.yard.ink)
                        .textSelection(.enabled)
                    Text(model.orders.count <= 1 ? (first?.brand.name ?? "1 brand") : "\(model.orders.count) brands shipping separately")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer(minLength: Spacing.s)
                Button {
                    UIPasteboard.general.string = reference
                    toast.show("Order ID copied", style: .success, systemImage: "doc.on.doc")
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.yard.ink)
                        .frame(width: 36, height: 36)
                        .background(Color.yard.surface2, in: Circle())
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityLabel("Copy order ID")
            }
            .padding([.horizontal, .top], Spacing.l)
            .padding(.bottom, Spacing.xs)
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                OrderDetailsGrid(items: gridItems)
                    .padding(.horizontal, Spacing.l)
                    .padding(.bottom, Spacing.l)
                ForEach(model.orders) { order in
                    OrderPerforation()
                        .padding(.horizontal, Spacing.l)
                    brandSection(order)
                }
            }
        }
    }

    private func brandSection(_ order: OrderSummary) -> some View {
        Button {
            router.push(.order(id: order.id))
        } label: {
            HStack(alignment: .center, spacing: Spacing.m) {
                BrandAvatar(name: order.brand.name, size: 40)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(order.brand.name)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Text(order.itemsTitle)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                    Text("Order \(order.reference) · \(Formatters.price(minor: order.totalMinor, currency: order.currency))")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .lineLimit(1)
                    OrderStatusChip(status: order.status)
                        .padding(.top, Spacing.xxs)
                }
                Spacer(minLength: Spacing.s)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(Spacing.l)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityHint("Opens this brand's order")
    }

    // MARK: Actions

    @ViewBuilder
    private func actions(_ checkout: OrderCheckout, outcome: Outcome) -> some View {
        VStack(spacing: Spacing.s) {
            switch outcome {
            case .confirmed, .placed:
                YardButton("Track order", systemImage: "shippingbox") { trackOrder() }
                YardButton("Keep shopping", style: .secondary) { keepShopping() }
            case .notPaid:
                if let link = checkout.payment?.authorizationUrl, let url = URL(string: link) {
                    YardButton("Pay now") { openURL(url) }
                    YardButton("Check again", style: .secondary) {
                        Task { @MainActor in await model.start(checkoutId: checkoutId) }
                    }
                } else {
                    YardButton("Return to bag") { returnToBag() }
                    YardButton("Check again", style: .secondary) {
                        Task { @MainActor in await model.start(checkoutId: checkoutId) }
                    }
                }
            case .failed:
                YardButton("Return to bag") { returnToBag() }
                YardButton("See your orders", style: .secondary) { router.push(.orders) }
            }
        }
    }

    private func trackOrder() {
        if model.orders.count == 1, let only = model.orders.first {
            router.push(.order(id: only.id))
        } else {
            router.push(.orders)
        }
    }

    private func keepShopping() {
        router.popToRoot()
        router.select(.home)
    }

    private func returnToBag() {
        router.popToRoot(.bag)
        router.select(.bag)
    }
}

private struct OrderConfirmationSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                Skeleton(shape: .circle).frame(width: 92, height: 92).padding(.top, Spacing.xxxl)
                Skeleton(cornerRadius: 8).frame(width: 220, height: 34)
                Skeleton(cornerRadius: 6).frame(width: 280, height: 14)
                Skeleton(cornerRadius: Radius.card).frame(height: 320).padding(.top, Spacing.l)
                Skeleton(shape: .capsule).frame(height: 52)
            }
            .padding(.horizontal, Spacing.gutter)
        }
        .scrollDisabled(true)
    }
}

// MARK: - Previews

enum OrderPreviewData {
    static let summaries: [OrderSummary] = [
        OrderSummary(id: "or_1", reference: "YRD-48213-1", groupReference: "YRD-48213", checkoutId: "co_1", brand: OrderBrandRef(id: "brd_1", name: "Acme Studio", handle: "acme"), shipToPreview: OrderShipToPreview(city: "London", country: "GB"), placedAt: "2026-11-13T09:12:00.000Z", currency: "USD", subtotalMinor: 12000, shippingMinor: 1500, totalMinor: 13500, itemCount: 2, previewItems: [OrderPreviewItem(productId: "p1", variantId: "v1", name: "Boxy tee", qty: 1, unitMinor: 4500)], states: OrderStates(merchant: "shipped", payment: "paid", fulfilment: "shipped")),
        OrderSummary(id: "or_2", reference: "YRD-48213-2", groupReference: "YRD-48213", checkoutId: "co_1", brand: OrderBrandRef(id: "brd_2", name: "Northside", handle: "northside"), shipToPreview: OrderShipToPreview(city: "London", country: "GB"), placedAt: "2026-11-13T09:12:00.000Z", currency: "USD", subtotalMinor: 3000, shippingMinor: 0, totalMinor: 3000, itemCount: 1, previewItems: [OrderPreviewItem(productId: "p2", variantId: "v2", name: "Bucket hat", qty: 1, unitMinor: 3000)], states: OrderStates(merchant: "paid", payment: "paid", fulfilment: "unfulfilled")),
    ]

    static let checkout = OrderCheckout(id: "co_1", status: "paid", reference: "YRD-48213", currency: "USD", subtotalMinor: 15000, shippingMinor: 1500, totalMinor: 16500, orderIds: ["or_1", "or_2"], createdAt: "2026-11-13T09:12:00.000Z", paidAt: "2026-11-13T09:13:00.000Z", payment: OrderCheckoutPayment(provider: "paystack", status: "succeeded", channel: "card"))
}

#Preview("OrderConfirmationView — dark") {
    NavigationStack { OrderConfirmationView(previewModel: OrderConfirmationModel(previewCheckout: OrderPreviewData.checkout, orders: OrderPreviewData.summaries)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrderConfirmationView — light") {
    NavigationStack { OrderConfirmationView(previewModel: OrderConfirmationModel(previewCheckout: OrderPreviewData.checkout, orders: OrderPreviewData.summaries)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
