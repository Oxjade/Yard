import SwiftUI
import Observation

// You › Settings, in the style of reference 08 (grouped rounded cards, icon tile per row).
//   General: Appearance, Notifications, Ship to, Currency
//   Account: Your details, Password, Sign-in methods (GET /api/auth/security?as=shopper,
//            DELETE /api/auth/identities/{id}?as=shopper), Delete account, Sign out
//   About:   Help, Terms, Privacy, Refunds, Data deletion

@Observable
@MainActor
final class YouSecurityModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var security: YouSecurity? = nil
    private(set) var unlinkingId: String? = nil

    func load() async {
        if security == nil { phase = .loading }
        do {
            let s: YouSecurity = try await APIClient.shared.get("/api/auth/security", query: [URLQueryItem(name: "as", value: "shopper")])
            security = s
            phase = .loaded
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            if security == nil { phase = .failed(APIError.message(for: error)) }
        }
    }

    func reset() {
        security = nil
        phase = .idle
    }

    /// DELETE /api/auth/identities/{id}?as=shopper (422 when it's the only way left to sign in).
    func unlink(_ identity: YouIdentity, toast: ToastCenter) async {
        unlinkingId = identity.id
        defer { unlinkingId = nil }
        do {
            let escaped = identity.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? identity.id
            try await APIClient.shared.send(.delete, "/api/auth/identities/\(escaped)", query: [URLQueryItem(name: "as", value: "shopper")])
            toast.show("\(identity.providerName) disconnected.", style: .success)
            await load()
        } catch {
            toast.show(error)
        }
    }
}

@MainActor
struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(CartStore.self) private var cart
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @AppStorage(AppearancePreference.storageKey) private var appearance: String = AppearancePreference.system.rawValue

    @State private var security = YouSecurityModel()
    @State private var webPage: YouWebPage? = nil
    @State private var regionSheet: YouRegionSheet.Mode? = nil
    @State private var showsDetails = false
    @State private var showsPassword = false
    @State private var showsDelete = false
    @State private var pendingUnlink: YouIdentity? = nil
    @State private var isSigningOut = false
    @State private var shipTo: String? = YouRegion.storedShipTo

    init() {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                general
                if session.isSignedIn {
                    account
                } else if session.hasLoaded {
                    signedOutCard
                }
                about
                if session.isSignedIn {
                    YouSettingsGroup(nil, footer: "Sign out of Yard on this iPhone. Your bag stays here for next time.") {
                        Button {
                            signOut()
                        } label: {
                            SettingsRow("Sign out", systemImage: "rectangle.portrait.and.arrow.right", tint: Color.yard.danger, showsChevron: false) {
                                if isSigningOut { ProgressView().tint(Color.yard.ink2) }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(isSigningOut)
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xxl)
        }
        .yardScreenBackground()
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.shopper?.id) {
            YouRegion.restore(into: cart)
            if session.isSignedIn {
                await security.load()
            } else {
                security.reset()
            }
        }
        .youWebPage($webPage)
        .sheet(item: $regionSheet) { mode in
            YouRegionSheet(mode: mode) { shipTo = YouRegion.storedShipTo }
        }
        .sheet(isPresented: $showsDetails) {
            YouAccountDetailsSheet(security: security.security) {
                // Let the sheet finish dismissing before presenting Safari.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    webPage = .help
                }
            }
        }
        .sheet(isPresented: $showsPassword) {
            YouChangePasswordSheet(hasPassword: security.security?.hasPassword ?? true) {
                Task { @MainActor in await security.load() }
            }
        }
        .sheet(isPresented: $showsDelete) {
            YouDeleteAccountSheet(security: security.security)
        }
        .confirmationDialog(
            "Disconnect \(pendingUnlink?.providerName ?? "")?",
            isPresented: Binding(get: { pendingUnlink != nil }, set: { if !$0 { pendingUnlink = nil } }),
            titleVisibility: .visible,
            presenting: pendingUnlink
        ) { identity in
            Button("Disconnect", role: .destructive) {
                Task { @MainActor in await security.unlink(identity, toast: toast) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { identity in
            Text("You won't be able to sign in with \(identity.providerName) until you connect it again.")
        }
    }

    // MARK: General

    private var appearanceTitle: String {
        (AppearancePreference(rawValue: appearance) ?? .system).title
    }

    private var general: some View {
        YouSettingsGroup("General") {
            NavigationLink(value: Route.appearance) {
                SettingsRow("Appearance", systemImage: "circle.lefthalf.filled", value: appearanceTitle)
            }
            .buttonStyle(.plain)
            NavigationLink(value: Route.notificationSettings) {
                SettingsRow("Notifications", systemImage: "bell")
            }
            .buttonStyle(.plain)
            Button { regionSheet = .country } label: {
                SettingsRow("Ship to", systemImage: "shippingbox", value: YouMarkets.country(shipTo)?.name ?? "Not set")
            }
            .buttonStyle(.plain)
            Button { regionSheet = .currency } label: {
                SettingsRow("Currency", systemImage: "dollarsign.circle", value: YouMarkets.currency(cart.currency)?.label ?? cart.currency)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Account

    @ViewBuilder
    private var account: some View {
        YouSettingsGroup("Account", footer: "Your name goes on your orders.") {
            Button { showsDetails = true } label: {
                SettingsRow("Your details", systemImage: "person.text.rectangle", value: session.shopper?.name)
            }
            .buttonStyle(.plain)
            NavigationLink(value: Route.addresses) {
                SettingsRow("Addresses", systemImage: "mappin.and.ellipse")
            }
            .buttonStyle(.plain)
            switch security.phase {
            case .idle, .loading:
                YouSkeletonRow()
            case .failed:
                Button {
                    Task { @MainActor in await security.load() }
                } label: {
                    SettingsRow("Couldn't load sign-in settings", systemImage: "exclamationmark.triangle", value: "Retry", showsChevron: false)
                }
                .buttonStyle(.plain)
            case .loaded:
                if let s = security.security, !s.demo {
                    Button { showsPassword = true } label: {
                        SettingsRow(s.hasPassword ? "Change password" : "Set a password", systemImage: "key")
                    }
                    .buttonStyle(.plain)
                }
            }
            if let s = security.security, s.isDeletionPending {
                SettingsRow("Deletion requested", systemImage: "hourglass", value: deletionValue(s), tint: Color.yard.danger, showsChevron: false)
            } else {
                Button { showsDelete = true } label: {
                    SettingsRow("Delete account", systemImage: "trash", tint: Color.yard.danger)
                }
                .buttonStyle(.plain)
                .disabled(security.security == nil)
            }
        }

        if let s = security.security {
            YouSettingsGroup("Sign-in methods", footer: methodsFooter(s)) {
                SettingsRow("Email and password", systemImage: "envelope", value: s.hasPassword ? "On" : "Not set", showsChevron: false)
                ForEach(s.identities) { identity in
                    SettingsRow(identity.providerName, systemImage: identity.systemImage, value: identity.email ?? "Connected", showsChevron: false) {
                        if security.unlinkingId == identity.id {
                            ProgressView().tint(Color.yard.ink2)
                        } else {
                            Button("Disconnect") { pendingUnlink = identity }
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(Color.yard.danger)
                                .buttonStyle(.plain)
                        }
                    }
                }
                if s.providers.google && !s.identities.contains(where: { $0.provider == "google" }) && !s.demo {
                    Button { webPage = .webSettings } label: {
                        SettingsRow("Google", systemImage: "g.circle", value: "Connect on the web")
                    }
                    .buttonStyle(.plain)
                }
                if s.providers.apple && !s.identities.contains(where: { $0.provider == "apple" }) && !s.demo {
                    Button { webPage = .webSettings } label: {
                        SettingsRow("Apple", systemImage: "apple.logo", value: "Connect on the web")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func methodsFooter(_ s: YouSecurity) -> String {
        if s.demo { return "This is a demo account. It has no password and can't use Google or Apple sign-in." }
        return "Connecting Google or Apple happens on yardstore.space, signed in to this account. Keep at least one way to sign in."
    }

    private func deletionValue(_ s: YouSecurity) -> String {
        if let at = s.deletion?.requestedAt, let date = YardDate.parse(at) {
            return Formatters.relative(date)
        }
        return "Pending"
    }

    private var signedOutCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Text("Settings").yardDisplay(28).foregroundStyle(Color.yard.ink)
                Text("Sign in to change your details, the notifications you get, where you ship to and what you're into.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                YardButton("Sign in", size: .medium) { router.present(.signIn) }
            }
        }
    }

    // MARK: About

    private var about: some View {
        YouSettingsGroup("Help and legal") {
            Button { webPage = .help } label: {
                SettingsRow("Help", systemImage: "questionmark.circle")
            }
            .buttonStyle(.plain)
            ForEach(LegalPage.allCases) { page in
                NavigationLink(value: Route.legal(page)) {
                    SettingsRow(page.title, systemImage: YouLegalIcon.systemImage(for: page))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Actions

    private func signOut() {
        guard !isSigningOut else { return }
        isSigningOut = true
        Task { @MainActor in
            await session.signOut()
            isSigningOut = false
            security.reset()
            toast.show("Signed out", style: .info, systemImage: "rectangle.portrait.and.arrow.right")
            router.popToRoot(.you)
        }
    }
}

enum YouLegalIcon {
    static func systemImage(for page: LegalPage) -> String {
        switch page {
        case .terms: return "doc.text"
        case .privacy: return "hand.raised"
        case .refunds: return "arrow.uturn.backward.circle"
        case .dataDeletion: return "externaldrive.badge.xmark"
        }
    }
}

// MARK: - Ship to / currency

/// Pick the ship-to country or the display currency (src/components/market/locale-select.tsx).
@MainActor
struct YouRegionSheet: View {
    enum Mode: String, Identifiable {
        case country
        case currency
        var id: String { rawValue }
    }

    let mode: Mode
    let onChange: () -> Void

    @Environment(CartStore.self) private var cart
    @Environment(\.dismiss) private var dismiss
    @State private var selected: String? = nil
    @State private var isSaving = false

    var body: some View {
        VStack(spacing: 0) {
            YardSheetHeader(
                mode == .country ? "Ship to" : "Currency",
                subtitle: mode == .country
                    ? "Sets delivery times and shipping costs. The currency follows the country unless you pick one."
                    : "Prices show in your currency as an estimate; checkout confirms the rate."
            ) { dismiss() }
            ScrollView {
                Card(padding: Spacing.xs) {
                    VStack(spacing: 0) {
                        switch mode {
                        case .country:
                            ForEach(YouMarkets.countries) { c in
                                row(title: c.name, value: c.currency, isSelected: (selected ?? YouRegion.storedShipTo) == c.code) {
                                    choose(country: c)
                                }
                            }
                        case .currency:
                            ForEach(YouMarkets.currencies) { c in
                                row(title: c.code, value: c.symbol, isSelected: (selected ?? cart.currency) == c.code) {
                                    choose(currency: c)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.bottom, Spacing.xl)
            }
        }
        .yardSheet(detents: [.large])
        .disabled(isSaving)
    }

    private func row(title: String, value: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.m) {
                Text(title)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
                Spacer()
                Text(value)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink3)
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.yard.ink)
                    .opacity(isSelected ? 1 : 0)
            }
            .padding(.horizontal, Spacing.m)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func choose(country: YouCountry) {
        selected = country.code
        isSaving = true
        Task { @MainActor in
            await YouRegion.setShipTo(country, cart: cart)
            isSaving = false
            onChange()
            dismiss()
        }
    }

    private func choose(currency: YouCurrency) {
        selected = currency.code
        isSaving = true
        Task { @MainActor in
            await YouRegion.setCurrency(currency, cart: cart)
            isSaving = false
            onChange()
            dismiss()
        }
    }
}

#Preview("SettingsView — dark") {
    NavigationStack { SettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SettingsView — light") {
    NavigationStack { SettingsView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
