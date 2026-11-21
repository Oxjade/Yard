import SwiftUI
import Observation

@Observable
@MainActor
final class StudioOrderDetailModel {
    let orderId: String
    private(set) var order: StudioOrderDetail?
    private(set) var loading: Bool = false
    private(set) var error: String?
    private(set) var busy: Busy?
    /// A money action waiting for re-confirmation, and the action to retry after it.
    private(set) var reauth: StudioReauthRequest?
    private var pendingRetry: Pending?
    var actionError: String?

    enum Busy: Equatable { case processing, ship, cancel, refund }
    private enum Pending { case cancel(reason: String, restock: Bool, key: String), refund(amount: Int, reason: String, key: String) }

    init(orderId: String) {
        self.orderId = orderId
    }

    func load(studio: StudioStore) async {
        loading = true
        defer { loading = false }
        do {
            let id = orderId
            order = try await studio.call { try await StudioAPI.order(id) }
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }

    func markProcessing(studio: StudioStore) async -> Bool {
        await run(.processing, studio: studio) { id in try await StudioAPI.markProcessing(id) }
    }

    func ship(studio: StudioStore, carrier: String, tracking: String) async -> Bool {
        let c = carrier.trimmingCharacters(in: .whitespacesAndNewlines)
        let t = tracking.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty && c.isEmpty {
            actionError = "Add the carrier for this tracking number."
            return false
        }
        return await run(.ship, studio: studio) { id in
            try await StudioAPI.ship(id, carrier: c.isEmpty ? nil : c, tracking: t.isEmpty ? nil : t)
        }
    }

    func cancel(studio: StudioStore, reason: String, restock: Bool) async -> Bool {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (3...200).contains(r.count) else {
            actionError = "Say why in a few words (3 to 200 characters)."
            return false
        }
        let key = UUID().uuidString
        pendingRetry = .cancel(reason: r, restock: restock, key: key)
        return await run(.cancel, studio: studio) { id in try await StudioAPI.cancel(id, reason: r, restock: restock, key: key) }
    }

    func refund(studio: StudioStore, amountText: String, reason: String) async -> Bool {
        guard let order else { return false }
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let amount = StudioMoney.minor(from: amountText, currency: order.summary.currency), amount > 0 else {
            actionError = "Enter the amount to refund."
            return false
        }
        guard amount <= order.refundableMinor else {
            actionError = "You can refund up to \(Formatters.price(minor: order.refundableMinor, currency: order.summary.currency))."
            return false
        }
        guard (3...200).contains(r.count) else {
            actionError = "Say why in a few words (3 to 200 characters)."
            return false
        }
        let key = UUID().uuidString
        pendingRetry = .refund(amount: amount, reason: r, key: key)
        return await run(.refund, studio: studio) { id in try await StudioAPI.refund(id, amountMinor: amount, reason: r, key: key) }
    }

    /// After the person re-confirmed: retry the waiting money action with the same key.
    func retryAfterReauth(studio: StudioStore) async -> Bool {
        reauth = nil
        guard let pending = pendingRetry else { return false }
        switch pending {
        case .cancel(let reason, let restock, let key):
            return await run(.cancel, studio: studio) { id in try await StudioAPI.cancel(id, reason: reason, restock: restock, key: key) }
        case .refund(let amount, let reason, let key):
            return await run(.refund, studio: studio) { id in try await StudioAPI.refund(id, amountMinor: amount, reason: reason, key: key) }
        }
    }

    func dismissReauth() {
        reauth = nil
        pendingRetry = nil
    }

    private func run(_ kind: Busy, studio: StudioStore, _ action: (String) async throws -> Void) async -> Bool {
        busy = kind
        actionError = nil
        defer { busy = nil }
        do {
            let id = orderId
            try await studio.call { try await action(id) }
            pendingRetry = nil
            await load(studio: studio)
            studio.bumpData()
            return true
        } catch {
            if let request = StudioReauthRequest(error) {
                reauth = request
            } else {
                actionError = APIError.message(for: error)
            }
            return false
        }
    }
}

/// Studio › Order: a progress line, items with option values, customer and address, then slide
/// to mark shipped (carrier + tracking), cancel and refund (with re-confirmation when asked).
@MainActor
struct StudioOrderDetailView: View {
    let orderId: String

    @Environment(StudioStore.self) private var studio
    @Environment(ToastCenter.self) private var toast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model: StudioOrderDetailModel
    @State private var carrier: String = ""
    @State private var tracking: String = ""
    @State private var composer: Composer? = nil
    @State private var reason: String = ""
    @State private var restock: Bool = true
    @State private var refundAmount: String = ""

    private enum Composer: Equatable { case cancel, refund }

    init(orderId: String) {
        self.orderId = orderId
        _model = State(initialValue: StudioOrderDetailModel(orderId: orderId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if let order = model.order {
                    header(order)
                    progress(order)
                    items(order)
                    customer(order)
                    totals(order)
                    actions(order)
                } else if let error = model.error {
                    EmptyState.error(message: error) { await model.load(studio: studio) }
                } else {
                    Skeleton(cornerRadius: Radius.card).frame(height: 120)
                    StudioRowsSkeleton(count: 3)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .scrollDismissesKeyboard(.interactively)
        .yardScreenBackground()
        .navigationTitle(model.order?.summary.reference ?? "Order")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load(studio: studio) }
        .task { await model.load(studio: studio) }
        .sensoryFeedback(.error, trigger: model.actionError) { _, new in new != nil }
    }

    // MARK: Sections

    private func header(_ order: StudioOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Tag(StudioOrderState.label(order.summary.merchantState), style: StudioOrderState.style(order.summary.merchantState))
                Spacer()
                if let date = order.summary.placedDate {
                    Text(Formatters.dateTime(date))
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
            }
            Text(order.summary.reference)
                .yardDisplay(36)
                .foregroundStyle(Color.yard.ink)
                .textSelection(.enabled)
        }
    }

    /// Paid → Processing → Shipped → Delivered (inspo: the tracking progress line).
    private func progress(_ order: StudioOrderDetail) -> some View {
        let current = StudioOrderState.progressIndex(order.summary.merchantState)
        return StudioInkCard {
            if let current {
                VStack(spacing: Spacing.s) {
                    GeometryReader { geo in
                        let count = StudioOrderState.steps.count
                        let stepWidth = geo.size.width / CGFloat(count - 1)
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.yard.onPhoto.opacity(0.18)).frame(height: 4)
                            Capsule().fill(Color.yard.acid)
                                .frame(width: stepWidth * CGFloat(current), height: 4)
                            ForEach(0..<count, id: \.self) { i in
                                ZStack {
                                    Circle().fill(i <= current ? Color.yard.acid : Color.yard.scrim)
                                    Circle().strokeBorder(i <= current ? Color.yard.acid : Color.yard.onPhoto.opacity(0.3), lineWidth: 2)
                                    if i <= current {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 10, weight: .black))
                                            .foregroundStyle(Color.yard.onAcid)
                                    }
                                }
                                .frame(width: 22, height: 22)
                                .position(x: min(max(11, stepWidth * CGFloat(i)), geo.size.width - 11), y: 11)
                            }
                        }
                        .frame(height: 22)
                    }
                    .frame(height: 22)
                    HStack {
                        ForEach(Array(StudioOrderState.steps.enumerated()), id: \.offset) { i, step in
                            Text(step)
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(i <= current ? Color.yard.onPhoto : Color.yard.onPhoto.opacity(0.5))
                                .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : (i == StudioOrderState.steps.count - 1 ? .trailing : .center))
                        }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Status: \(StudioOrderState.steps[current])"))
            } else {
                HStack(spacing: Spacing.m) {
                    Image(systemName: "xmark.octagon.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Color.yard.danger)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(StudioOrderState.label(order.summary.merchantState))
                            .font(.yardHeadline)
                            .foregroundStyle(Color.yard.onPhoto)
                        if let reason = order.cancelReason, !reason.isEmpty {
                            Text(reason)
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.onPhoto.opacity(0.7))
                        }
                    }
                }
            }
        }
    }

    private func items(_ order: StudioOrderDetail) -> some View {
        StudioGroup("Items") {
            ForEach(order.lines) { line in
                HStack(spacing: Spacing.m) {
                    RemoteImage(path: line.imageSrc, contentMode: .fill, maxPixelSize: 180)
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
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
                        Text("\(line.qty) × \(Formatters.price(minor: line.unitMinor, currency: order.summary.currency))")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                    }
                    Spacer()
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.s)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func customer(_ order: StudioOrderDetail) -> some View {
        StudioGroup("Customer") {
            VStack(alignment: .leading, spacing: 4) {
                Text(order.shipTo?.name ?? order.summary.customerName)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                ForEach(order.shipTo?.lines ?? [order.summary.shipCountry], id: \.self) { line in
                    Text(line)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                }
                if let phone = order.shipTo?.phone, !phone.isEmpty, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Link(destination: url) {
                        Label(phone, systemImage: "phone.fill")
                            .font(.yardCallout.weight(.semibold))
                    }
                    .tint(Color.yard.ink)
                    .padding(.top, 4)
                }
            }
            .textSelection(.enabled)
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func totals(_ order: StudioOrderDetail) -> some View {
        let s = order.summary
        return StudioGroup("Total") {
            VStack(spacing: Spacing.s) {
                totalRow("Items", Formatters.price(minor: s.subtotalMinor, currency: s.currency))
                totalRow("Shipping", Formatters.price(minor: s.shippingMinor, currency: s.currency))
                if s.refundedMinor > 0 {
                    totalRow("Refunded", "−" + Formatters.price(minor: s.refundedMinor, currency: s.currency))
                }
                Divider().overlay(Color.yard.line)
                totalRow("Total", s.total, bold: true)
            }
            .padding(Spacing.m)
        }
    }

    private func totalRow(_ title: String, _ value: String, bold: Bool = false) -> some View {
        HStack {
            Text(title).font(bold ? .yardBodyEmphasis : .yardCallout).foregroundStyle(bold ? Color.yard.ink : Color.yard.ink2)
            Spacer()
            Text(value).font(bold ? .yardBodyEmphasis : .yardCallout).foregroundStyle(Color.yard.ink)
        }
    }

    // MARK: Actions

    @ViewBuilder
    private func actions(_ order: StudioOrderDetail) -> some View {
        let state = order.summary.merchantState
        let canFulfil = studio.can(StudioPermission.ordersFulfil)
        let canRefund = canFulfil && (studio.activeBrand?.role == "owner" || studio.activeBrand?.role == "admin")
        if let reauth = model.reauth {
            StudioReauthPanel(request: reauth) {
                Task { @MainActor in
                    if await model.retryAfterReauth(studio: studio) {
                        Haptics.success()
                        toast.show("Done", style: .success)
                        composer = nil
                    }
                }
            } onCancel: {
                model.dismissReauth()
            }
        }
        if let error = model.actionError {
            Label(error, systemImage: "exclamationmark.circle.fill")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
        if canFulfil && (state == "paid" || state == "processing") {
            shipComposer(state: state)
        }
        if canFulfil && (order.canCancel || (canRefund && order.refundableMinor > 0)) {
            HStack(spacing: Spacing.s) {
                if order.canCancel {
                    YardButton("Cancel order", style: composer == .cancel ? .inverted : .secondary, size: .medium) {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { composer = composer == .cancel ? nil : .cancel }
                    }
                }
                if canRefund && order.refundableMinor > 0 && state != "pending_payment" {
                    YardButton("Refund", style: composer == .refund ? .inverted : .secondary, size: .medium) {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { composer = composer == .refund ? nil : .refund }
                    }
                }
            }
            if composer == .cancel { cancelComposer(order) }
            if composer == .refund { refundComposer(order) }
        }
    }

    private func shipComposer(state: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Ship it")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            if state == "paid" {
                YardButton("Mark as processing", systemImage: "clock", style: .secondary, size: .medium, isLoading: model.busy == .processing) {
                    Haptics.impact(.light)
                    Task { @MainActor in
                        if await model.markProcessing(studio: studio) {
                            Haptics.success()
                            toast.show("Marked as processing", style: .success)
                        } else if model.reauth == nil {
                            Haptics.error()
                        }
                    }
                }
            }
            inputField("Carrier (optional)", text: $carrier, icon: "truck.box")
            inputField("Tracking number (optional)", text: $tracking, icon: "number")
                .textInputAutocapitalization(.characters)
            SlideToConfirm("Slide to mark shipped", systemImage: "shippingbox.fill", isLoading: model.busy == .ship) {
                Task { @MainActor in
                    if await model.ship(studio: studio, carrier: carrier, tracking: tracking) {
                        toast.show("Marked as shipped. The customer is notified.", style: .success)
                    } else {
                        Haptics.error()
                    }
                }
            }
        }
        .padding(Spacing.l)
        .yardCard()
    }

    private func cancelComposer(_ order: StudioOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(order.summary.paymentState == "paid" ? "The customer is refunded in full." : "The order is cancelled before it ships.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            inputField("Reason (the customer sees it)", text: $reason, icon: "text.bubble")
            Toggle(isOn: $restock) {
                Text("Put the items back in stock").font(.yardBody).foregroundStyle(Color.yard.ink)
            }
            .tint(Color.yard.acid)
            .onChange(of: restock) { _, _ in Haptics.selection() }
            YardButton("Cancel order", style: .destructive, isLoading: model.busy == .cancel) {
                Haptics.impact(.medium)
                Task { @MainActor in
                    if await model.cancel(studio: studio, reason: reason, restock: restock) {
                        Haptics.success()
                        toast.show("Order cancelled", style: .success)
                        composer = nil
                    } else if model.reauth == nil {
                        Haptics.error()
                    }
                }
            }
        }
        .padding(Spacing.l)
        .yardCard()
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func refundComposer(_ order: StudioOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Up to \(Formatters.price(minor: order.refundableMinor, currency: order.summary.currency)) can be refunded.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            inputField("Amount", text: $refundAmount, icon: "banknote")
                .keyboardType(.decimalPad)
            inputField("Reason", text: $reason, icon: "text.bubble")
            YardButton("Refund", style: .destructive, isLoading: model.busy == .refund) {
                Haptics.impact(.medium)
                Task { @MainActor in
                    if await model.refund(studio: studio, amountText: refundAmount, reason: reason) {
                        Haptics.success()
                        toast.show("Refund sent", style: .success)
                        composer = nil
                    } else if model.reauth == nil {
                        Haptics.error()
                    }
                }
            }
        }
        .padding(Spacing.l)
        .yardCard()
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func inputField(_ placeholder: String, text: Binding<String>, icon: String) -> some View {
        HStack(spacing: Spacing.m) {
            Image(systemName: icon)
                .foregroundStyle(Color.yard.ink3)
                .frame(width: 22)
            TextField(placeholder, text: text)
                .font(.yardBody)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, Spacing.m)
        .frame(height: 48)
        .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
    }
}

/// Inline re-confirmation for money actions (403 `fields.reauth = "required"`): the password, or
/// the sign-in provider in a secure web sheet. `onConfirmed` retries the action.
@MainActor
struct StudioReauthPanel: View {
    let request: StudioReauthRequest
    let onConfirmed: () -> Void
    let onCancel: () -> Void

    @Environment(StudioStore.self) private var studio
    @State private var password: String = ""
    @State private var busy: Bool = false
    @State private var error: String?
    @State private var provider = StudioProviderReauth()

    init(request: StudioReauthRequest, onConfirmed: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.request = request
        self.onConfirmed = onConfirmed
        self.onCancel = onCancel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack {
                Label("Confirm it's you", systemImage: "lock.shield.fill")
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                Spacer()
                Button("Not now") { onCancel() }
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
            Text("Money actions need a fresh confirmation.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            if request.usesPassword {
                SecureField("Your password", text: $password)
                    .textContentType(.password)
                    .font(.yardBody)
                    .padding(.horizontal, Spacing.m)
                    .frame(height: 48)
                    .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                YardButton("Confirm", isLoading: busy) { confirmPassword() }
                    .disabled(password.isEmpty)
            }
            if request.provider != nil {
                YardButton("Continue with \(request.providerLabel)", systemImage: "person.badge.key", style: request.usesPassword ? .secondary : .primary, isLoading: busy) {
                    confirmProvider()
                }
            }
            if let error {
                Text(error)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.danger)
            }
        }
        .padding(Spacing.l)
        .yardCard()
    }

    private func confirmPassword() {
        busy = true
        error = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                try await StudioAPI.reauth(password: password)
                password = ""
                Haptics.success()
                onConfirmed()
            } catch {
                Haptics.error()
                self.error = APIError.message(for: error)
            }
        }
    }

    private func confirmProvider() {
        guard let p = request.provider else { return }
        busy = true
        error = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                let brandId = try await provider.run(provider: p.name, connection: p.connection)
                await studio.adoptReconfirmedSession(brandId: brandId)
                Haptics.success()
                onConfirmed()
            } catch {
                if (error as? APIError)?.isCancelled != true {
                    Haptics.error()
                    self.error = APIError.message(for: error)
                }
            }
        }
    }
}
