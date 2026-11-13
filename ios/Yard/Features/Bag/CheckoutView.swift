import SwiftUI

/// Checkout (website: /checkout, src/components/market/checkout/checkout-flow.tsx + steps.tsx +
/// order-summary.tsx). One scrolling page: contact, delivery address, shipping per brand (from the
/// server's quote), payment method, order summary, and a bottom "Pay" pill. Payment happens on the
/// provider's hosted page (Paystack / Bachs) opened in-app; see `CheckoutModel`.
@MainActor
struct CheckoutView: View {
    @Environment(CartStore.self) private var cartStore
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var model: CheckoutModel
    @State private var payTaps: Int = 0
    @FocusState private var focused: Field?

    enum Field: Hashable {
        case name, phone, line1, line2, city, region, postcode
    }

    init() {
        _model = State(initialValue: CheckoutModel())
    }

    /// Previews only.
    init(previewModel: CheckoutModel) {
        _model = State(initialValue: previewModel)
    }

    var body: some View {
        content
            .yardScreenBackground()
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                model.displayCurrency = cartStore.currency
                if model.name.isEmpty, let shopper = session.shopper { model.name = shopper.name }
                await model.loadOptions()
            }
            .task(id: quoteKey) {
                // Debounce typing in the city field; task(id:) cancels the previous run.
                try? await Task.sleep(nanoseconds: 400_000_000)
                if Task.isCancelled { return }
                await model.loadQuotes()
            }
            .onAppear {
                if session.hasLoaded && !session.isSignedIn { router.present(.signIn) }
            }
            .onDisappear { model.cancelPolling() }
            .onChange(of: model.completedCheckoutId) { _, id in
                guard let id else { return }
                if let note = model.notice { toast.show(note, style: .info) }
                CheckoutDraft(name: model.name, phone: model.phone, line1: model.line1, line2: model.line2, city: model.city, region: model.region, postcode: model.postcode, country: model.country).save()
                cartStore.reset()
                Task { @MainActor in await cartStore.load() }
                router.pop()
                router.push(.orderConfirmation(checkoutId: id))
            }
            .onChange(of: model.needsSignIn) { _, needs in
                if needs {
                    model.needsSignIn = false
                    router.present(.signIn)
                }
            }
            .onChange(of: cartStore.currency) { _, newValue in
                model.displayCurrency = newValue
            }
            .fullScreenCover(item: $model.paymentPage) { page in
                BagPaymentSafariView(url: page.url) {
                    model.paymentPageClosed()
                }
                .ignoresSafeArea()
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: payTaps)
            .sensoryFeedback(.success, trigger: model.completedCheckoutId)
    }

    /// Re-quotes when the destination, charge currency or the bag's lines change.
    private var quoteKey: String {
        let lines = (cartStore.cart?.lines ?? []).map { "\($0.variantId):\($0.qty)" }.joined(separator: ",")
        return "\(model.chargeCurrency)|\(model.country)|\(model.quoteCity ?? "")|\(lines)"
    }

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn {
            if !session.hasLoaded {
                CheckoutSkeleton()
            } else {
                EmptyState.signedOut(
                    title: "Sign in to check out",
                    message: "One account keeps the orders from every brand in this bag, and their tracking, in one place. Your bag stays as it is."
                ) { router.present(.signIn) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if let cart = model.cart {
            if cart.lines.isEmpty && model.phase != .done {
                EmptyState(title: "Your bag is empty", message: "Add pieces from any brand and they check out together, one order per brand.", systemImage: "bag", actionTitle: "Back to bag") {
                    router.pop()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                form(cart)
            }
        } else if let error = model.quotes.error {
            EmptyState.error(error) { await model.loadQuotes() }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            CheckoutSkeleton()
        }
    }

    // MARK: Form

    private func form(_ cart: Cart) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Text("Checkout")
                    .yardDisplay(44)
                    .foregroundStyle(Color.yard.ink)
                    .padding(.top, Spacing.s)

                if model.paymentsClosed {
                    BagNotice(systemImage: "clock", text: BagCheckoutOptions.offMessage, tint: Color.yard.violet)
                } else if model.isStub {
                    BagNotice(systemImage: "info.circle", text: "Payments aren't connected in this environment. Nothing will be charged.", tint: Color.yard.violet)
                }
                if let note = model.currencyNotice {
                    BagNotice(systemImage: "dollarsign.circle", text: note)
                }

                contactSection
                addressSection
                shippingSection(cart)
                paymentSection
                summarySection(cart)

                Text("Delivery dates are estimates, not guarantees. They skip weekends and public holidays. Taxes aren't calculated in this build; import duties, if any, are collected by the courier on delivery.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            payBar(cart)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
                    .font(.yardBodyEmphasis)
            }
        }
    }

    private var contactSection: some View {
        CheckoutSection(title: "Contact", subtitle: session.shopper.map { "Order updates go to \($0.email)." }) {
            CheckoutTextField(label: "Full name", text: $model.name, error: model.error(for: "name"), contentType: .name, capitalization: .words)
                .focused($focused, equals: .name)
                .submitLabel(.next)
                .onSubmit { focused = .phone }
            CheckoutTextField(
                label: "Phone",
                text: $model.phone,
                error: model.error(for: "phone"),
                hint: "\(model.countryInfo.dial) · for example \(model.countryInfo.phoneExample)",
                placeholder: model.countryInfo.phoneExample,
                contentType: .telephoneNumber,
                keyboard: .phonePad
            )
            .focused($focused, equals: .phone)
        }
    }

    private var addressSection: some View {
        let rules = model.countryInfo
        return CheckoutSection(title: "Delivery address", subtitle: "Changing the country updates shipping prices and payment options.") {
            CheckoutMenuField(label: "Country", value: rules.name, error: nil) {
                Picker("Country", selection: Binding(get: { model.country }, set: { model.changeCountry($0) })) {
                    ForEach(BagMarkets.countries) { c in
                        Text(c.name).tag(c.code)
                    }
                }
            }
            CheckoutTextField(label: "Street address", text: $model.line1, error: model.error(for: "line1"), contentType: .streetAddressLine1, capitalization: .words)
                .focused($focused, equals: .line1)
                .submitLabel(.next)
                .onSubmit { focused = .line2 }
            CheckoutTextField(label: "Apartment, suite or floor", text: $model.line2, error: nil, optional: true, contentType: .streetAddressLine2, capitalization: .words)
                .focused($focused, equals: .line2)
                .submitLabel(.next)
                .onSubmit { focused = .city }
            CheckoutTextField(label: "City or town", text: $model.city, error: model.error(for: "city"), contentType: .addressCity, capitalization: .words)
                .focused($focused, equals: .city)
                .submitLabel(.next)
                .onSubmit { focused = rules.regionOptions == nil ? Field.region : Field.postcode }
            if let options = rules.regionOptions {
                CheckoutMenuField(
                    label: rules.regionLabel,
                    value: model.region.isEmpty ? "Choose a \(rules.regionLabel.lowercased())" : model.region,
                    isPlaceholder: model.region.isEmpty,
                    optional: !rules.regionRequired,
                    error: model.error(for: "region")
                ) {
                    Picker(rules.regionLabel, selection: $model.region) {
                        Text("Choose a \(rules.regionLabel.lowercased())").tag("")
                        ForEach(options, id: \.self) { r in
                            Text(r).tag(r)
                        }
                    }
                }
            } else {
                CheckoutTextField(label: rules.regionLabel, text: $model.region, error: model.error(for: "region"), optional: !rules.regionRequired, contentType: .addressState, capitalization: .words)
                    .focused($focused, equals: .region)
                    .submitLabel(.next)
                    .onSubmit { focused = .postcode }
            }
            CheckoutTextField(
                label: rules.postcodeLabel,
                text: $model.postcode,
                error: model.error(for: "postcode"),
                hint: "For example \(rules.postcodeExample)",
                optional: !rules.postcodeRequired,
                contentType: .postalCode,
                capitalization: .characters
            )
            .focused($focused, equals: .postcode)
            .submitLabel(.done)
        }
    }

    private func shippingSection(_ cart: Cart) -> some View {
        CheckoutSection(title: "Shipping", subtitle: cart.groups.count > 1 ? "Your order comes from \(cart.groups.count) brands. Each ships separately from its own studio, so parcels can arrive on different days." : nil) {
            if model.quotes.cart == nil && model.quotes.error != nil {
                HStack {
                    Text("Couldn't calculate shipping.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink)
                    Spacer()
                    YardButton("Retry", style: .secondary, size: .small, fullWidth: false) {
                        Task { @MainActor in await model.loadQuotes() }
                    }
                }
            }
            ForEach(cart.groups) { group in
                CheckoutBrandShipping(
                    brandName: model.brandName(for: group),
                    lines: cart.lines(in: group),
                    quote: model.quotes.quote(for: group.brandId),
                    selected: model.option(for: group.brandId)?.service,
                    isLoading: model.quotes.isLoading,
                    countryName: model.countryInfo.name,
                    onSelect: { service in
                        withAnimation(Motion.snappy) { model.choices[group.brandId] = service }
                    },
                    onRemove: { removeBrand(group, in: cart) }
                )
            }
        }
    }

    private var paymentSection: some View {
        let methods = model.methods
        let selected = model.effectiveMethod
        return CheckoutSection(title: "Payment", subtitle: "You pay on \(model.providerName)'s secure page. Card details are typed there, never in Yard.") {
            VStack(spacing: Spacing.s) {
                ForEach(methods) { m in
                    CheckoutOptionRow(
                        title: m.title(country: model.country),
                        detail: m.detail(country: model.country),
                        systemImage: m.systemImage,
                        isSelected: m == selected,
                        trailing: nil
                    ) {
                        withAnimation(Motion.snappy) { model.method = m }
                    }
                }
            }
            Text(selected.next(country: model.country, providerName: model.providerName))
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
        }
    }

    private func summarySection(_ cart: Cart) -> some View {
        CheckoutSection(title: "Order summary", subtitle: nil) {
            VStack(spacing: Spacing.m) {
                ForEach(cart.lines) { line in
                    HStack(spacing: Spacing.m) {
                        RemoteImage(url: line.imageURL, maxPixelSize: 200)
                            .frame(width: 48, height: 60)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.title ?? "A piece from your bag")
                                .font(.yardCallout.weight(.semibold))
                                .foregroundStyle(Color.yard.ink)
                                .lineLimit(1)
                            Text([line.brandName, line.variantLabel].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink2)
                                .lineLimit(1)
                        }
                        Spacer(minLength: Spacing.s)
                        VStack(alignment: .trailing, spacing: 2) {
                            PriceText(minor: line.lineMinor, currency: cart.currency, font: .yardCallout.weight(.semibold))
                            Text("× \(line.qty)")
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink3)
                                .monospacedDigit()
                        }
                    }
                }
            }
            Divider().overlay(Color.yard.line)
            CheckoutSummaryRow(title: "Subtotal") {
                PriceText(minor: cart.subtotalMinor, currency: cart.currency, font: .yardBodyEmphasis)
            }
            CheckoutSummaryRow(title: cart.groups.count == 1 ? "Shipping" : "Shipping, \(cart.groups.count) brands") {
                if let s = model.shippingMinor {
                    if s == 0 {
                        Text("Free").font(.yardBodyEmphasis).foregroundStyle(Color.yard.success)
                    } else {
                        PriceText(minor: s, currency: cart.currency, font: .yardBodyEmphasis)
                    }
                } else if model.quotes.isLoading {
                    Skeleton(shape: .capsule).frame(width: 56, height: 14)
                } else {
                    Text("—").font(.yardBodyEmphasis).foregroundStyle(Color.yard.ink3)
                }
            }
            Divider().overlay(Color.yard.line)
            CheckoutSummaryRow(title: "Total", emphasized: true) {
                PriceText(minor: model.totalMinor ?? cart.subtotalMinor, currency: cart.currency, font: .yardNumber(22))
            }
        }
    }

    // MARK: Pay bar

    private func payBar(_ cart: Cart) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if model.phase == .confirming || model.phase == .paying {
                HStack(spacing: Spacing.s) {
                    ProgressView().controlSize(.small).tint(Color.yard.violet)
                    Text(model.phase == .paying ? "Taking you to secure payment…" : "Confirming your payment…")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            if let error = model.placeError {
                Text(error)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let note = model.notice, model.phase == .idle {
                Text(note)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let pending = model.pendingCheckoutId {
                YardButton("View order status", style: .secondary, size: .small, fullWidth: false) {
                    cartStore.reset()
                    Task { @MainActor in await cartStore.load() }
                    router.pop()
                    router.push(.orderConfirmation(checkoutId: pending))
                }
            }
            HStack(spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.totalMinor == nil ? "Subtotal" : "Total")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                    PriceText(minor: model.totalMinor ?? cart.subtotalMinor, currency: cart.currency, font: .yardNumber(22))
                        .contentTransition(.numericText())
                }
                Spacer(minLength: Spacing.s)
                YardButton(
                    "Pay",
                    systemImage: "lock.fill",
                    isLoading: model.phase == .starting || model.phase == .confirming || model.phase == .paying,
                    fullWidth: false
                ) {
                    payTaps += 1
                    focused = nil
                    Task { @MainActor in await model.pay() }
                }
                .frame(minWidth: 150)
                .disabled(model.paymentsClosed || model.phase == .done || !model.optionsReady)
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.yard.line).frame(height: 1)
        }
        .animation(Motion.spring, value: model.placeError)
        .animation(Motion.spring, value: model.phase)
    }

    // MARK: Actions

    private func removeBrand(_ group: CartGroup, in cart: Cart) {
        let ids = cart.lines(in: group).map { $0.variantId }
        Task { @MainActor in
            do {
                for id in ids {
                    try await cartStore.remove(variantId: id)
                }
                toast.show("Removed \(model.brandName(for: group))'s pieces", style: .info, systemImage: "trash")
            } catch {
                toast.show(error)
            }
        }
    }
}

// MARK: - Pieces

/// A titled card section.
struct CheckoutSection<Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder let content: () -> Content

    init(title: String, subtitle: String?, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title)
                    .font(.yardTitle)
                    .foregroundStyle(Color.yard.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Card {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    content()
                }
            }
        }
    }
}

/// Label + text field + hint/error, on `surface2`.
struct CheckoutTextField: View {
    let label: String
    @Binding var text: String
    let error: String?
    var hint: String? = nil
    var placeholder: String? = nil
    var optional: Bool = false
    var contentType: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences

    init(label: String, text: Binding<String>, error: String?, hint: String? = nil, placeholder: String? = nil, optional: Bool = false, contentType: UITextContentType? = nil, keyboard: UIKeyboardType = .default, capitalization: TextInputAutocapitalization = .sentences) {
        self.label = label
        self._text = text
        self.error = error
        self.hint = hint
        self.placeholder = placeholder
        self.optional = optional
        self.contentType = contentType
        self.keyboard = keyboard
        self.capitalization = capitalization
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            CheckoutFieldLabel(label: label, optional: optional)
            TextField("", text: $text, prompt: Text(placeholder ?? "").foregroundColor(Color.yard.ink3))
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink)
                .textContentType(contentType)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled(true)
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: 48)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                        .strokeBorder(error == nil ? Color.clear : Color.yard.danger, lineWidth: 1)
                )
                .accessibilityLabel(Text(label))
            CheckoutFieldMessage(error: error, hint: hint)
        }
    }
}

/// Label + a menu picker that looks like a field.
struct CheckoutMenuField<Options: View>: View {
    let label: String
    let value: String
    var isPlaceholder: Bool = false
    var optional: Bool = false
    let error: String?
    @ViewBuilder let picker: () -> Options

    init(label: String, value: String, isPlaceholder: Bool = false, optional: Bool = false, error: String?, @ViewBuilder picker: @escaping () -> Options) {
        self.label = label
        self.value = value
        self.isPlaceholder = isPlaceholder
        self.optional = optional
        self.error = error
        self.picker = picker
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            CheckoutFieldLabel(label: label, optional: optional)
            Menu {
                picker()
            } label: {
                HStack {
                    Text(value)
                        .font(.yardBody)
                        .foregroundStyle(isPlaceholder ? Color.yard.ink3 : Color.yard.ink)
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.yard.ink2)
                }
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: 48)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                        .strokeBorder(error == nil ? Color.clear : Color.yard.danger, lineWidth: 1)
                )
                .contentShape(Rectangle())
            }
            .accessibilityLabel(Text("\(label), \(value)"))
            CheckoutFieldMessage(error: error, hint: nil)
        }
    }
}

struct CheckoutFieldLabel: View {
    let label: String
    let optional: Bool

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Text(label)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink2)
            if optional {
                Text("Optional")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
    }
}

struct CheckoutFieldMessage: View {
    let error: String?
    let hint: String?

    var body: some View {
        if let error {
            Label(error, systemImage: "exclamationmark.circle")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.danger)
                .fixedSize(horizontal: false, vertical: true)
        } else if let hint {
            Text(hint)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
        }
    }
}

/// A selectable row (shipping option, payment method): radio, title, detail, trailing value.
struct CheckoutOptionRow: View {
    let title: String
    let detail: String?
    var systemImage: String? = nil
    let isSelected: Bool
    let trailing: AnyView?
    let action: () -> Void

    init(title: String, detail: String?, systemImage: String? = nil, isSelected: Bool, trailing: AnyView?, action: @escaping () -> Void) {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.trailing = trailing
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.m) {
                ZStack {
                    Circle()
                        .strokeBorder(isSelected ? Color.yard.acid : Color.yard.ink3, lineWidth: isSelected ? 0 : 1.5)
                        .background(Circle().fill(isSelected ? Color.yard.acid : Color.clear))
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(Color.yard.onAcid)
                    }
                }
                .frame(width: 22, height: 22)
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.yard.ink)
                        .frame(width: 22)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    if let detail {
                        Text(detail)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: Spacing.s)
                if let trailing { trailing }
            }
            .padding(Spacing.m)
            .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                    .strokeBorder(isSelected ? Color.yard.ink : Color.clear, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// One brand's delivery block in the checkout.
struct CheckoutBrandShipping: View {
    let brandName: String
    let lines: [CartLine]
    let quote: BagGroupQuote?
    let selected: String?
    let isLoading: Bool
    let countryName: String
    let onSelect: (String) -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(spacing: Spacing.s) {
                BrandAvatar(name: brandName, size: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(brandName)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    let pieces = lines.reduce(0) { $0 + $1.qty }
                    Text(pieces == 1 ? "1 piece" : "\(pieces) pieces")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer(minLength: Spacing.s)
                HStack(spacing: -10) {
                    ForEach(Array(lines.prefix(4))) { line in
                        RemoteImage(url: line.imageURL, maxPixelSize: 120)
                            .frame(width: 34, height: 34)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.yard.surface, lineWidth: 2)
                            )
                    }
                }
                .accessibilityHidden(true)
            }

            if let quote {
                if quote.unavailable || quote.option(for: selected) == nil {
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        Text("\(brandName) doesn't ship to \(countryName). Remove its pieces or change the delivery country.")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink)
                        if let reason = quote.reason, !reason.isEmpty {
                            Text(reason)
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink3)
                        }
                        YardButton("Remove \(brandName)'s pieces", style: .secondary, size: .small, fullWidth: false, action: onRemove)
                    }
                    .padding(Spacing.m)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                } else {
                    let current = quote.option(for: selected)
                    VStack(spacing: Spacing.s) {
                        ForEach(quote.options.filter { $0.available }) { option in
                            CheckoutOptionRow(
                                title: option.label,
                                detail: option.arrivalText ?? "Estimated arrival unavailable",
                                isSelected: option.service == current?.service,
                                trailing: AnyView(price(option))
                            ) {
                                onSelect(option.service)
                            }
                        }
                    }
                }
            } else if isLoading {
                VStack(spacing: Spacing.s) {
                    Skeleton(cornerRadius: Radius.small).frame(height: 60)
                    Skeleton(cornerRadius: Radius.small).frame(height: 60)
                }
                .accessibilityLabel(Text("Loading shipping options for \(brandName)"))
            } else {
                Text("Shipping for \(brandName) couldn't be calculated.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
    }

    @ViewBuilder
    private func price(_ option: BagQuoteOption) -> some View {
        if option.free {
            Text("Free")
                .font(.yardBodyEmphasis)
                .foregroundStyle(Color.yard.success)
        } else {
            PriceText(minor: option.priceMinor, currency: option.currency, font: .yardBodyEmphasis)
        }
    }
}

struct CheckoutSummaryRow<Value: View>: View {
    let title: String
    var emphasized: Bool = false
    @ViewBuilder let value: () -> Value

    init(title: String, emphasized: Bool = false, @ViewBuilder value: @escaping () -> Value) {
        self.title = title
        self.emphasized = emphasized
        self.value = value
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(emphasized ? .yardHeadline : .yardCallout)
                .foregroundStyle(emphasized ? Color.yard.ink : Color.yard.ink2)
            Spacer(minLength: Spacing.s)
            value()
        }
    }
}

/// Loading placeholder shaped like the checkout.
struct CheckoutSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Skeleton(cornerRadius: 8).frame(width: 200, height: 40)
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: Spacing.m) {
                        Skeleton(shape: .capsule).frame(width: 140, height: 18)
                        VStack(spacing: Spacing.m) {
                            Skeleton(cornerRadius: Radius.small).frame(height: 48)
                            Skeleton(cornerRadius: Radius.small).frame(height: 48)
                        }
                        .padding(Spacing.l)
                        .yardCard()
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
        .scrollDisabled(true)
        .accessibilityLabel(Text("Loading checkout"))
    }
}

// MARK: - Previews

@MainActor
private func checkoutPreviewModel() -> CheckoutModel {
    let cart = Cart(
        id: "cart_preview",
        currency: "NGN",
        itemCount: 2,
        subtotalMinor: 6_840_000,
        lines: [
            CartLine(variantId: "v1", productId: "p1", brandId: "b1", title: "Boxy heavyweight tee", variantLabel: "Size M", qty: 1, available: 4, unitMinor: 2_280_000, lineMinor: 2_280_000, brandName: "Acme Studio"),
            CartLine(variantId: "v2", productId: "p2", brandId: "b1", title: "Cargo pant", variantLabel: "Size 32", qty: 1, available: 2, unitMinor: 4_560_000, lineMinor: 4_560_000, brandName: "Acme Studio"),
        ],
        groups: [],
        issues: [],
        removedSample: 0,
        destination: Cart.Destination(country: "NG", city: "Lagos")
    )
    let quotes = BagQuoteLoader.preview(cart: cart, quotes: [
        BagGroupQuote(brandId: "b1", brandName: "Acme Studio", options: [
            BagQuoteOption(service: "standard", label: "Standard", priceMinor: 450_000, currency: "NGN", estimate: BagEstimate(arrivalFrom: "2026-11-18", arrivalTo: "2026-11-20")),
            BagQuoteOption(service: "express", label: "Express", priceMinor: 900_000, currency: "NGN", estimate: BagEstimate(arrivalFrom: "2026-11-16", arrivalTo: "2026-11-17")),
        ]),
    ])
    let model = CheckoutModel(quotes: quotes)
    model.name = "Ada Obi"
    return model
}

#Preview("CheckoutView — dark") {
    NavigationStack { CheckoutView(previewModel: checkoutPreviewModel()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CheckoutView — light") {
    NavigationStack { CheckoutView(previewModel: checkoutPreviewModel()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
