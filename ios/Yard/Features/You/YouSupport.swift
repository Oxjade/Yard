import SwiftUI
import SafariServices

// Shared pieces for the You feature (profile hub + settings). Private to Features/You; every type
// is prefixed `You…` so it never clashes with another feature's helpers.

// MARK: - Markets (src/config/markets.ts)

/// A ship-to country, exactly as the website lists them (`countries` in src/config/markets.ts).
struct YouCountry: Identifiable, Hashable, Sendable {
    let code: String
    let name: String
    /// The currency the country pays in; the display currency follows it until the shopper picks one.
    let currency: String
    var id: String { code }
}

/// A display currency (`currencies` in src/config/markets.ts).
struct YouCurrency: Identifiable, Hashable, Sendable {
    let code: String
    let symbol: String
    var id: String { code }
    var label: String { "\(code) \(symbol)" }
}

enum YouMarkets {
    static let countries: [YouCountry] = [
        YouCountry(code: "NG", name: "Nigeria", currency: "NGN"),
        YouCountry(code: "GH", name: "Ghana", currency: "GHS"),
        YouCountry(code: "KE", name: "Kenya", currency: "KES"),
        YouCountry(code: "ZA", name: "South Africa", currency: "ZAR"),
        YouCountry(code: "GB", name: "United Kingdom", currency: "GBP"),
        YouCountry(code: "FR", name: "France", currency: "EUR"),
        YouCountry(code: "DE", name: "Germany", currency: "EUR"),
        YouCountry(code: "US", name: "United States", currency: "USD"),
        YouCountry(code: "MX", name: "Mexico", currency: "MXN"),
        YouCountry(code: "JP", name: "Japan", currency: "JPY"),
        YouCountry(code: "KR", name: "South Korea", currency: "KRW"),
    ]

    static let currencies: [YouCurrency] = [
        YouCurrency(code: "USD", symbol: "$"),
        YouCurrency(code: "NGN", symbol: "₦"),
        YouCurrency(code: "GBP", symbol: "£"),
        YouCurrency(code: "EUR", symbol: "€"),
        YouCurrency(code: "GHS", symbol: "GH₵"),
        YouCurrency(code: "KES", symbol: "KSh"),
        YouCurrency(code: "ZAR", symbol: "R"),
        YouCurrency(code: "JPY", symbol: "¥"),
        YouCurrency(code: "KRW", symbol: "₩"),
        YouCurrency(code: "MXN", symbol: "MX$"),
    ]

    static func country(_ code: String?) -> YouCountry? {
        guard let code else { return nil }
        return countries.first { $0.code == code.uppercased() }
    }

    static func currency(_ code: String?) -> YouCurrency? {
        guard let code else { return nil }
        return currencies.first { $0.code == code.uppercased() }
    }
}

/// The ship-to country lives here (CartStore only keeps it in memory). Anyone may read
/// `YouRegion.storedShipTo` at launch and set `cart.destinationCountry` from it.
enum YouRegion {
    /// UserDefaults key of the ship-to country code ("NG", "US", …).
    static let shipToKey = "yard.shipTo"
    /// True once the shopper picked a currency themselves (then it no longer follows the country).
    static let currencyChosenKey = "yard.currencyChosen"

    static var storedShipTo: String? {
        UserDefaults.standard.string(forKey: shipToKey)
    }

    static var currencyChosen: Bool {
        UserDefaults.standard.bool(forKey: currencyChosenKey)
    }

    /// Changes the ship-to country; the currency follows it unless the shopper chose one (site rule).
    @MainActor
    static func setShipTo(_ country: YouCountry, cart: CartStore) async {
        UserDefaults.standard.set(country.code, forKey: shipToKey)
        cart.destinationCountry = country.code
        if !currencyChosen && cart.currency != country.currency {
            await cart.setCurrency(country.currency)
        } else {
            await cart.load()
        }
    }

    /// The shopper's own currency choice: from now on it no longer follows the country.
    @MainActor
    static func setCurrency(_ currency: YouCurrency, cart: CartStore) async {
        UserDefaults.standard.set(true, forKey: currencyChosenKey)
        await cart.setCurrency(currency.code)
    }

    /// Fills `cart.destinationCountry` from the stored choice when nothing set it yet.
    @MainActor
    static func restore(into cart: CartStore) {
        if cart.destinationCountry == nil, let code = storedShipTo {
            cart.destinationCountry = code
        }
    }
}

// MARK: - Web pages (SFSafariViewController)

/// A web page opened in-app (Help, Sell on Yard). Present with `.fullScreenCover(item:)`.
struct YouWebPage: Identifiable, Hashable {
    let url: URL
    var id: String { url.absoluteString }

    static let help = YouWebPage(url: URL(string: "https://yardstore.space/support")!)
    static var sell: YouWebPage { YouWebPage(url: Config.webURL("/sell")) }
    static var webSettings: YouWebPage { YouWebPage(url: Config.webURL("/you/settings")) }
}

/// SFSafariViewController in SwiftUI.
struct YouSafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        controller.preferredControlTintColor = UIColor(Color.yard.ink)
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

extension View {
    /// Presents `page` full screen in Safari View Controller.
    func youWebPage(_ page: Binding<YouWebPage?>) -> some View {
        fullScreenCover(item: page) { p in
            YouSafariView(url: p.url).ignoresSafeArea()
        }
    }
}

// MARK: - Grouped settings cards (reference 08-settings)

/// A titled group of rows in one rounded card, as in reference 08.
struct YouSettingsGroup<Content: View>: View {
    let title: String?
    var footer: String? = nil
    @ViewBuilder let content: () -> Content

    init(_ title: String?, footer: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let title {
                Text(title)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink2)
                    .padding(.horizontal, Spacing.xs)
                    .accessibilityAddTraits(.isHeader)
            }
            Card(padding: Spacing.xs) {
                VStack(spacing: 0) {
                    content()
                }
            }
            if let footer {
                Text(footer)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .padding(.horizontal, Spacing.xs)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A placeholder row while a group loads.
struct YouSkeletonRow: View {
    var body: some View {
        HStack(spacing: Spacing.m) {
            Skeleton(cornerRadius: 10).frame(width: 36, height: 36)
            Skeleton(cornerRadius: 4).frame(width: 140, height: 12)
            Spacer()
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .frame(minHeight: 52)
    }
}

/// A row with a title, an explanation under it and a trailing toggle (notification settings).
struct YouToggleRow: View {
    let title: String
    let detail: String?
    let systemImage: String
    @Binding var isOn: Bool
    var isEnabled: Bool = true

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 36, height: 36)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
                if let detail {
                    Text(detail)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Spacing.s)
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .tint(Color.yard.acid)
                .disabled(!isEnabled)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}

/// A themed text field for the account sheets.
struct YouTextField: View {
    let title: String
    @Binding var text: String
    var isSecure: Bool = false
    var error: String? = nil
    var contentType: UITextContentType? = nil
    var capitalization: TextInputAutocapitalization = .never
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink2)
            Group {
                if isSecure {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                        .textInputAutocapitalization(capitalization)
                        .autocorrectionDisabled(true)
                        .keyboardType(keyboard)
                }
            }
            .textContentType(contentType)
            .font(.yardBody)
            .foregroundStyle(Color.yard.ink)
            .padding(.horizontal, Spacing.m)
            .frame(height: 48)
            .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                    .strokeBorder(error == nil ? Color.yard.line : Color.yard.danger, lineWidth: 1)
            )
            .accessibilityLabel(Text(title))
            if let error {
                Text(error)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
            }
        }
    }
}

// MARK: - API models (GET /api/auth/security?as=shopper)

/// A linked Google/Apple identity (src/server/auth/oauth/flow.ts listIdentities).
struct YouIdentity: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let provider: String
    let email: String?

    var providerName: String {
        switch provider {
        case "google": return "Google"
        case "apple": return "Apple"
        case "auth0": return "Social sign-in"
        default: return provider.capitalized
        }
    }

    var systemImage: String {
        switch provider {
        case "apple": return "apple.logo"
        case "google": return "g.circle"
        default: return "person.badge.key"
        }
    }

    enum CodingKeys: String, CodingKey { case id, provider, email }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        provider = c.lenient(.provider, "")
        email = c.lenientOptional(.email)
    }

    init(id: String, provider: String, email: String?) {
        self.id = id
        self.provider = provider
        self.email = email
    }
}

struct YouProviders: Decodable, Hashable, Sendable {
    let google: Bool
    let apple: Bool

    enum CodingKeys: String, CodingKey { case google, apple }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        google = c.lenient(.google, false)
        apple = c.lenient(.apple, false)
    }

    init(google: Bool, apple: Bool) {
        self.google = google
        self.apple = apple
    }
}

struct YouDeletion: Decodable, Hashable, Sendable {
    /// "pending" | "processing" | "completed" | …
    let status: String
    let requestedAt: String?

    enum CodingKeys: String, CodingKey { case status, requestedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = c.lenient(.status, "pending")
        requestedAt = c.lenientOptional(.requestedAt)
    }
}

/// GET /api/auth/security?as=shopper: how this account signs in.
struct YouSecurity: Decodable, Sendable {
    /// How this session signed in: "password", "google", "magic_link", "demo", …
    let method: String
    let demo: Bool
    let emailVerified: Bool
    let hasPassword: Bool
    let identities: [YouIdentity]
    let providers: YouProviders
    /// Seconds since the last re-auth on this session (nil = never).
    let reauthAgeSec: Int?
    let deletion: YouDeletion?

    enum CodingKeys: String, CodingKey { case method, demo, emailVerified, hasPassword, identities, providers, reauthAgeSec, deletion }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        method = c.lenient(.method, "password")
        demo = c.lenient(.demo, false)
        emailVerified = c.lenient(.emailVerified, false)
        hasPassword = c.lenient(.hasPassword, false)
        identities = c.lenient(.identities, [YouIdentity]())
        providers = c.lenient(.providers, YouProviders(google: false, apple: false))
        reauthAgeSec = c.lenientOptional(.reauthAgeSec)
        deletion = c.lenientOptional(.deletion)
    }

    /// Whether a re-auth happened recently enough for an action that allows `maxAgeSec`.
    func isRecentlyConfirmed(within maxAgeSec: Int) -> Bool {
        guard let age = reauthAgeSec else { return false }
        return age < maxAgeSec - 30
    }

    var isDeletionPending: Bool {
        guard let deletion else { return false }
        return deletion.status == "pending" || deletion.status == "processing"
    }
}

/// POST /api/auth/reauth?as=shopper { password }.
struct YouReauthBody: Encodable, Sendable {
    let password: String
}

extension APIError {
    /// 403 with `fields.reauth = "required"`: confirm it's you, then retry.
    var youNeedsReauth: Bool { status == 403 && fields["reauth"] == "required" }
}
