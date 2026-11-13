import Foundation
import Observation

/// Checkout state: the delivery form (with the website's per-country validation), per-brand
/// shipping choices from the server quote, the payment method, and the payment round trip.
///
/// Flow (website: checkout-flow.tsx, lib/stores/orders.ts placeCheckout, confirmation-view.tsx):
///   1. POST /api/checkout with an idempotency key (a retry returns the same checkout).
///   2. The answer carries the provider's hosted page (`payment.authorizationUrl`): open it in-app.
///      With the stub provider there is no page and nothing is charged: go to the confirmation.
///   3. While the page is open, poll GET /api/checkout/{id} (and POST …/verify now and then).
///      When the shopper comes back, verify and poll a little longer.
///   4. Paid → the order confirmation. Failed / expired / left without paying → say so; nothing charged.
@Observable
@MainActor
final class CheckoutModel {
    // MARK: Form

    var name: String = ""
    var phone: String = ""
    var line1: String = ""
    var line2: String = ""
    var city: String = ""
    var region: String = ""
    var postcode: String = ""
    var country: String
    /// brandId → chosen service ("standard" / "express" / "pickup").
    var choices: [String: String] = [:]
    var method: BagPaymentMethod = .card
    /// Set once Pay was tapped: every field's error shows from then on.
    var attempted: Bool = false
    /// The server's field errors from the last attempt (form key → message).
    var serverFieldErrors: [String: String] = [:]

    // MARK: Remote

    let quotes: BagQuoteLoader
    private(set) var options: BagCheckoutOptions?
    private(set) var optionsFailed: Bool = false
    /// The shopper's display currency (CartStore.currency); the checkout may charge in another.
    var displayCurrency: String = "USD"

    // MARK: Payment state

    enum Phase: Equatable {
        case idle
        /// POST /api/checkout in flight.
        case starting
        /// The provider's page is open.
        case paying
        /// Back from the provider: waiting for its answer.
        case confirming
        /// Paid: the view routes to the confirmation.
        case done
    }

    private(set) var phase: Phase = .idle
    /// Why the last Pay didn't go through (shown above the Pay pill).
    var placeError: String?
    /// A neutral note ("You left the payment page…", "Still waiting for…").
    var notice: String?
    /// The hosted payment page while it is open.
    var paymentPage: BagPaymentPage?
    /// Set when the checkout is paid (or charges nothing): the view routes to OrderConfirmationView.
    private(set) var completedCheckoutId: String?
    /// A checkout still pending after the poll ran out: offer to open its status.
    private(set) var pendingCheckoutId: String?
    /// Set on a 401: the view presents sign-in.
    var needsSignIn: Bool = false

    private var idempotencyKey: String?
    private var keySignature: Data?
    private var keyMethod: BagPaymentMethod?
    private var pollTask: Task<Void, Never>?

    init(quotes: BagQuoteLoader? = nil) {
        self.quotes = quotes ?? BagQuoteLoader()
        self.country = BagMarkets.shipTo
        if let draft = CheckoutDraft.load() {
            name = draft.name
            phone = draft.phone
            line1 = draft.line1
            line2 = draft.line2
            city = draft.city
            region = draft.region
            postcode = draft.postcode
            if BagMarkets.isSupported(draft.country) { country = draft.country }
        }
    }

    // MARK: Derived

    var countryInfo: BagCountry { BagMarkets.country(country) }
    var provider: String { options?.provider ?? "paystack" }
    var providerName: String { BagMarkets.providerName(provider) }
    var optionsReady: Bool { options != nil || optionsFailed }
    var paymentsClosed: Bool { options?.mode == "off" }
    var isStub: Bool { options?.mode == "stub" }
    /// Until the options load (or if they fail) only NGN: the live-safe answer, as on the website.
    var allowedCurrencies: [String] {
        if let list = options?.currencies, !list.isEmpty { return list.map { $0.uppercased() } }
        return ["NGN"]
    }
    var chargeCurrency: String {
        BagMarkets.chargeCurrency(display: displayCurrency, country: countryInfo, allowed: allowedCurrencies)
    }
    var methods: [BagPaymentMethod] {
        BagMarkets.paymentMethods(country: country, currency: chargeCurrency, provider: provider)
    }
    var effectiveMethod: BagPaymentMethod {
        let list = methods
        return list.contains(method) ? method : (list.first ?? .card)
    }
    /// The delivery city for quotes: the address's once typed, else the one saved for the bag.
    var quoteCity: String? {
        let c = city.trimmingCharacters(in: .whitespacesAndNewlines)
        return c.isEmpty ? BagMarkets.shipToCity : String(c.prefix(60))
    }
    var isBusy: Bool { phase == .starting || phase == .paying || phase == .confirming }

    /// The cart priced in the charge currency (from the quote read).
    var cart: Cart? { quotes.cart }

    func option(for brandId: String) -> BagQuoteOption? {
        quotes.quote(for: brandId)?.option(for: choices[brandId])
    }

    /// Shipping across brands, or nil until every brand has an option.
    var shippingMinor: Int? {
        guard let cart, !cart.groups.isEmpty else { return nil }
        var sum = 0
        for g in cart.groups {
            guard let q = quotes.quote(for: g.brandId), !q.unavailable, let o = q.option(for: choices[g.brandId]) else { return nil }
            sum += o.free ? 0 : o.priceMinor
        }
        return sum
    }

    var totalMinor: Int? {
        guard let cart, let shipping = shippingMinor else { return nil }
        return cart.subtotalMinor + shipping
    }

    /// Why Pay can't go yet because of shipping or the cart (the website's shippingBlock).
    var shippingBlock: String? {
        guard let cart else {
            if quotes.error != nil { return "Couldn't calculate shipping. Retry to continue." }
            return "Shipping is still being calculated."
        }
        if cart.lines.contains(where: { $0.isUnavailable }) {
            return "Some pieces in your bag aren't available any more. Remove them to continue."
        }
        for g in cart.groups {
            guard let q = quotes.quote(for: g.brandId) else { return "Shipping isn't ready for every brand yet." }
            if q.unavailable || q.option(for: choices[g.brandId]) == nil {
                let brand = brandName(for: g)
                return "\(brand) doesn't ship to \(countryInfo.name). Remove its pieces or change the delivery country."
            }
        }
        return nil
    }

    func brandName(for group: CartGroup) -> String {
        if let cart, let n = cart.lines(in: group).first(where: { !($0.brandName ?? "").isEmpty })?.brandName { return n }
        if let q = quotes.quote(for: group.brandId), !q.brandName.isEmpty { return q.brandName }
        return "This brand"
    }

    /// "Payments here are taken in NGN for now…" when the checkout charges in another currency.
    var currencyNotice: String? {
        guard optionsReady else { return nil }
        let charge = chargeCurrency
        let display = displayCurrency.uppercased()
        guard charge != display else { return nil }
        let chargeable = ["NGN", "GHS", "ZAR", "KES", "USD"]
        if chargeable.contains(display) {
            return "Payments here are taken in \(Self.list(allowedCurrencies)) for now, so you'll be charged in \(charge). Every price in this checkout is shown in \(charge)."
        }
        return "\(providerName) can't charge in \(display), so you'll be charged in \(charge). Every price in this checkout is shown in \(charge)."
    }

    private static func list(_ items: [String]) -> String {
        if items.count <= 1 { return items.first ?? "" }
        return items.dropLast().joined(separator: ", ") + " and " + (items.last ?? "")
    }

    // MARK: Validation (rules.ts validateContact / validateAddress)

    var localErrors: [String: String] {
        let rules = countryInfo
        var e: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 { e["name"] = "Enter your full name." }
        let p = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isEmpty {
            e["phone"] = "Enter a phone number so couriers can reach you."
        } else if BagMarkets.parsePhone(p, country: rules) == nil {
            e["phone"] = "Enter a \(rules.name) number, for example \(rules.phoneExample)."
        }
        if line1.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 { e["line1"] = "Enter the street address." }
        if city.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 { e["city"] = "Enter the city or town." }
        if rules.regionRequired {
            let r = region.trimmingCharacters(in: .whitespacesAndNewlines)
            let valid: Bool
            if let options = rules.regionOptions { valid = options.contains(r) } else { valid = r.count >= 2 }
            if !valid {
                e["region"] = rules.regionOptions != nil ? "Choose a \(rules.regionLabel.lowercased())." : "Enter the \(rules.regionLabel.lowercased())."
            }
        }
        let pc = postcode.trimmingCharacters(in: .whitespacesAndNewlines)
        if pc.isEmpty {
            if rules.postcodeRequired { e["postcode"] = "Enter the \(rules.postcodeLabel.lowercased())." }
        } else if pc.range(of: rules.postcodePattern, options: [.regularExpression, .caseInsensitive]) == nil {
            e["postcode"] = "Check the \(rules.postcodeLabel.lowercased()), for example \(rules.postcodeExample)."
        }
        return e
    }

    /// The message to show under a field (local rules after the first attempt, else the server's).
    func error(for key: String) -> String? {
        if attempted, let m = localErrors[key] { return m }
        return serverFieldErrors[key]
    }

    func changeCountry(_ code: String) {
        guard code != country else { return }
        country = code
        region = ""
        postcode = ""
        BagMarkets.shipTo = code
    }

    // MARK: Loading

    func loadOptions() async {
        do {
            options = try await APIClient.shared.get("/api/checkout/options", as: BagCheckoutOptions.self)
            optionsFailed = false
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            optionsFailed = true
        }
    }

    func loadQuotes() async {
        await quotes.load(currency: chargeCurrency, to: country, city: quoteCity)
    }

    // MARK: Pay

    func pay() async {
        guard !isBusy else { return }
        placeError = nil
        notice = nil
        pendingCheckoutId = nil
        attempted = true
        serverFieldErrors = [:]
        if !localErrors.isEmpty {
            placeError = "Check the highlighted details."
            return
        }
        if paymentsClosed {
            placeError = BagCheckoutOptions.offMessage
            return
        }
        guard optionsReady else {
            placeError = "Still loading payment options. Try again in a moment."
            return
        }
        if let block = shippingBlock {
            placeError = block
            return
        }
        guard let cart, let total = totalMinor else {
            placeError = "Shipping isn't ready for every brand yet."
            return
        }
        CheckoutDraft(name: name, phone: phone, line1: line1, line2: line2, city: city, region: region, postcode: postcode, country: country).save()
        BagMarkets.shipToCity = city

        let rules = countryInfo
        let phoneValue = BagMarkets.parsePhone(phone, country: rules) ?? phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let street = [line1, line2]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        let pc = postcode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let shipTo = BagStartCheckoutBody.ShipTo(
            name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
            line1: String(street.prefix(120)),
            city: String(BagMarkets.cityLine(city: city, region: region).prefix(60)),
            postalCode: pc.isEmpty ? nil : String(pc.prefix(20)),
            country: country,
            phone: phoneValue.isEmpty ? nil : phoneValue
        )
        var shipping: [BagStartCheckoutBody.Choice] = []
        for g in cart.groups {
            guard let o = option(for: g.brandId) else { continue }
            shipping.append(BagStartCheckoutBody.Choice(brandId: g.brandId, service: o.service))
        }
        var body = BagStartCheckoutBody(idempotencyKey: "", currency: chargeCurrency, shipTo: shipTo, shipping: shipping, expectedTotalMinor: nil, paymentMethod: nil)

        // One key per attempt: the same details (and method) reuse it, so a retry returns the same
        // checkout; anything else that changed gets a fresh key (the server would refuse the old one).
        let signature = try? JSONEncoder().encode(body)
        let chosen = effectiveMethod
        if idempotencyKey == nil || signature != keySignature || keyMethod != chosen {
            idempotencyKey = UUID().uuidString.lowercased()
            keySignature = signature
            keyMethod = chosen
        }
        body.idempotencyKey = idempotencyKey ?? UUID().uuidString.lowercased()
        body.expectedTotalMinor = total
        body.paymentMethod = chosen.rawValue

        phase = .starting
        do {
            let checkout: BagCheckout = try await APIClient.shared.post("/api/checkout", body: body, as: BagCheckout.self)
            handleStarted(checkout)
        } catch let e as APIError {
            phase = .idle
            handleStartError(e)
        } catch {
            phase = .idle
            placeError = "Your order wasn't placed. Nothing was charged. Try again."
        }
    }

    private func handleStartError(_ e: APIError) {
        if e.isCancelled { return }
        if e.isUnauthorized {
            placeError = "Sign in again to continue with your order."
            needsSignIn = true
            return
        }
        if e.isConflict {
            placeError = e.message
            Task { @MainActor in await self.loadQuotes() }
            return
        }
        if e.status == 400, e.fields.keys.contains(where: { $0.hasPrefix("shipping.") }) {
            placeError = "Your cart changed since you last looked. Check it and place your order again."
            Task { @MainActor in await self.loadQuotes() }
            return
        }
        if e.status == 0 {
            placeError = "Couldn't reach Yard. Nothing was placed."
            return
        }
        var mapped: [String: String] = [:]
        for (k, v) in e.fields {
            guard k.hasPrefix("shipTo.") else { continue }
            var key = String(k.dropFirst("shipTo.".count))
            if key == "postalCode" { key = "postcode" }
            mapped[key] = v
        }
        serverFieldErrors = mapped
        if e.status == 503 {
            placeError = e.message
        } else {
            let m = e.message.hasSuffix(".") ? String(e.message.dropLast()) : e.message
            placeError = "\(m). Nothing was placed."
        }
    }

    private func handleStarted(_ checkout: BagCheckout) {
        if checkout.isSettled {
            finish(checkout.id)
            return
        }
        switch checkout.status {
        case "failed":
            phase = .idle
            idempotencyKey = nil
            placeError = checkout.failureReason ?? "The payment didn't go through. Nothing was charged. Try again."
            return
        case "expired":
            phase = .idle
            idempotencyKey = nil
            placeError = "This checkout expired before payment. Nothing was charged. Place your order again."
            return
        default:
            break
        }
        if let url = checkout.paymentURL {
            phase = .paying
            paymentPage = BagPaymentPage(checkoutId: checkout.id, url: url)
            startPolling(checkout.id, whilePaying: true)
            return
        }
        if checkout.payment?.stub == true {
            // Nothing is charged with the stub provider: the confirmation says so.
            notice = checkout.payment?.message
            finish(checkout.id)
            return
        }
        phase = .idle
        placeError = checkout.payment?.message ?? "We couldn't reach the payment provider. Nothing was charged. Try again."
    }

    /// The shopper tapped Done on the payment page.
    func paymentPageClosed() {
        guard let page = paymentPage ?? lastPage else { return }
        paymentPage = nil
        guard phase == .paying else { return }
        phase = .confirming
        startPolling(page.checkoutId, whilePaying: false)
    }

    /// Kept so Done after an automatic close still knows the checkout.
    private var lastPage: BagPaymentPage?

    private func startPolling(_ checkoutId: String, whilePaying: Bool) {
        pollTask?.cancel()
        if let page = paymentPage { lastPage = page }
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.poll(checkoutId, whilePaying: whilePaying)
        }
    }

    private func poll(_ checkoutId: String, whilePaying: Bool) async {
        var round = 0
        // While the page is open: every 3 s, asking the provider every 5th round. After it closes:
        // ask right away, then every 2 s for about 30 s.
        let limit = whilePaying ? Int.max : 15
        while round < limit {
            if Task.isCancelled { return }
            let verify: Bool = whilePaying ? (round % 5 == 4) : (round % 3 == 0)
            if let checkout = try? await fetch(checkoutId, verify: verify) {
                if Task.isCancelled { return }
                if checkout.isSettled {
                    paymentPage = nil
                    finish(checkout.id)
                    return
                }
                if checkout.status == "failed" || checkout.status == "expired" {
                    paymentPage = nil
                    phase = .idle
                    idempotencyKey = nil
                    placeError = checkout.status == "expired"
                        ? "This checkout expired before payment. Nothing was charged. Place your order again."
                        : (checkout.failureReason ?? "The payment didn't go through. Nothing was charged. Try again.")
                    return
                }
                if !whilePaying, checkout.payment?.providerStatus == "abandoned" {
                    phase = .idle
                    notice = "You left the payment page before paying. Nothing was charged. Tap Pay to go back to it."
                    return
                }
            }
            round += 1
            let seconds: UInt64 = whilePaying ? 3 : 2
            try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
        }
        if Task.isCancelled { return }
        phase = .idle
        pendingCheckoutId = checkoutId
        notice = "We're still waiting for \(providerName) to confirm your payment. If you paid, your order updates shortly."
    }

    private func fetch(_ checkoutId: String, verify: Bool) async throws -> BagCheckout {
        let path = "/api/checkout/\(checkoutId)"
        if verify {
            return try await APIClient.shared.post(path + "/verify", as: BagCheckout.self)
        }
        return try await APIClient.shared.get(path, as: BagCheckout.self)
    }

    private func finish(_ checkoutId: String) {
        pollTask?.cancel()
        pollTask = nil
        idempotencyKey = nil
        phase = .done
        completedCheckoutId = checkoutId
    }

    func cancelPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}

/// The delivery details, kept on the device so the next checkout starts filled in.
struct CheckoutDraft: Codable, Sendable {
    var name: String
    var phone: String
    var line1: String
    var line2: String
    var city: String
    var region: String
    var postcode: String
    var country: String

    private static let key = "yard.checkout.draft"

    static func load() -> CheckoutDraft? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(CheckoutDraft.self, from: data)
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: CheckoutDraft.key)
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
