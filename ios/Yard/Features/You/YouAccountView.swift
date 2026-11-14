import SwiftUI
import Observation

// Settings › Account: the signed-in person's name and email (src/server/auth/account.ts,
// web src/components/market/account/account-details.tsx).
//   GET    /api/account?as=shopper                  → { account }
//   PATCH  /api/account?as=shopper { name }         → { account }   (saved at once)
//   POST   /api/account/email?as=shopper { email, currentPassword? } → { account } with pendingEmail
//   DELETE /api/account/email?as=shopper            → { account } with pendingEmail null
// The email only changes once the link sent to the NEW address is opened (usually in Mail or
// Safari), so the screen re-reads the account whenever the app comes back to the foreground.
// Accounts without a password confirm it's them with Google / Apple first (403 reauth).

// MARK: - API models

/// `AccountDto`.
struct YouAccount: Decodable, Hashable, Sendable {
    struct PendingEmail: Decodable, Hashable, Sendable {
        let email: String
        let expiresAt: String

        enum CodingKeys: String, CodingKey { case email, expiresAt }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            email = c.lenient(.email, "")
            expiresAt = c.lenient(.expiresAt, "")
        }

        init(email: String, expiresAt: String) {
            self.email = email
            self.expiresAt = expiresAt
        }
    }

    let name: String
    let email: String
    let emailVerified: Bool
    let hasPassword: Bool
    /// Linked sign-in identities: "apple" | "auth0" | "google" (sorted; empty when none).
    let signInProviders: [String]
    let pendingEmail: PendingEmail?
    let demo: Bool

    init(name: String, email: String, emailVerified: Bool, hasPassword: Bool, signInProviders: [String], pendingEmail: PendingEmail?, demo: Bool) {
        self.name = name
        self.email = email
        self.emailVerified = emailVerified
        self.hasPassword = hasPassword
        self.signInProviders = signInProviders
        self.pendingEmail = pendingEmail
        self.demo = demo
    }

    enum CodingKeys: String, CodingKey { case name, email, emailVerified, hasPassword, signInProviders, pendingEmail, demo }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lenient(.name, "")
        email = c.lenient(.email, "")
        emailVerified = c.lenient(.emailVerified, false)
        hasPassword = c.lenient(.hasPassword, false)
        signInProviders = c.lenient(.signInProviders, [String]())
        pendingEmail = c.lenientOptional(.pendingEmail)
        demo = c.lenient(.demo, false)
    }

    /// "Google and Apple" for the sign-in note.
    var providerWords: String {
        let words: [String] = signInProviders.map { p in
            switch p {
            case "google": return "Google"
            case "apple": return "Apple"
            case "auth0": return "social sign-in"
            default: return p.capitalized
            }
        }
        return words.joined(separator: " and ")
    }
}

/// `{ account }`.
struct YouAccountResponse: Decodable, Sendable {
    let account: YouAccount
}

private struct YouAccountNameBody: Encodable, Sendable {
    let name: String
}

/// POST /api/account/email (strict: `currentPassword` only when the account has a password).
private struct YouEmailChangeBody: Encodable, Sendable {
    let email: String
    let currentPassword: String?

    enum CodingKeys: String, CodingKey { case email, currentPassword }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(email, forKey: .email)
        try c.encodeIfPresent(currentPassword, forKey: .currentPassword)
    }
}

// MARK: - Model

@Observable
@MainActor
final class YouAccountModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var account: YouAccount?

    // Name
    var nameDraft: String = ""
    var nameError: String?
    private(set) var isSavingName = false
    /// True right after a save, until the name is edited again ("Saved").
    var nameJustSaved = false

    // Email
    var isChangingEmail = false
    var newEmail: String = ""
    var password: String = ""
    var emailError: String?
    var passwordError: String?
    var formError: String?
    private(set) var isSending = false
    private(set) var isCancelling = false
    /// 403 reauth: an account without a password confirms with a provider first.
    private(set) var needsReauth = false
    private(set) var reauthButtons: [AuthSocialButton] = []
    private(set) var startingReauthKey: String?
    var reauthFlow: AuthWebFlow?

    private static let asShopper: [URLQueryItem] = [URLQueryItem(name: "as", value: "shopper")]

    init() {}

    /// Previews only.
    init(preview account: YouAccount) {
        self.account = account
        self.nameDraft = account.name
        self.phase = .loaded
    }

    var trimmedName: String { nameDraft.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isNameDirty: Bool { trimmedName != (account?.name ?? "") }

    // MARK: Load

    /// GET /api/account?as=shopper. Keeps an unsaved name draft.
    func load() async {
        if account == nil { phase = .loading }
        do {
            let r: YouAccountResponse = try await APIClient.shared.get("/api/account", query: Self.asShopper)
            let previous = account
            account = r.account
            if previous == nil || nameDraft.trimmingCharacters(in: .whitespacesAndNewlines) == previous?.name {
                nameDraft = r.account.name
            }
            phase = .loaded
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            if account == nil { phase = .failed(APIError.message(for: error)) }
        }
    }

    // MARK: Name

    /// The sign-up name rules (src/server/auth/contracts.ts `name`), checked before the round trip.
    static func nameProblem(_ name: String) -> String? {
        if name.isEmpty { return "Enter your name." }
        if name.count > 80 { return "Keep it to 80 characters." }
        for scalar in name.unicodeScalars {
            let v = scalar.value
            if v < 0x20 || v == 0x7F || scalar == "<" || scalar == ">" {
                return "Use letters, numbers and simple punctuation."
            }
        }
        return nil
    }

    /// PATCH /api/account?as=shopper { name }. Returns true when saved.
    func saveName() async -> Bool {
        let name = trimmedName
        let problem = Self.nameProblem(name)
        nameError = problem
        guard problem == nil, isNameDirty, !isSavingName else { return false }
        isSavingName = true
        defer { isSavingName = false }
        do {
            let r: YouAccountResponse = try await APIClient.shared.patch("/api/account", body: YouAccountNameBody(name: name), query: Self.asShopper)
            account = r.account
            nameDraft = r.account.name
            nameJustSaved = true
            return true
        } catch {
            if let api = error as? APIError {
                if api.isCancelled { return false }
                nameError = api.fields["name"] ?? api.message
            } else {
                nameError = "Your name wasn't saved. Try again."
            }
            return false
        }
    }

    // MARK: Email

    func startChange(prefill: String = "") {
        newEmail = prefill
        password = ""
        emailError = nil
        passwordError = nil
        formError = nil
        needsReauth = false
        isChangingEmail = true
    }

    func stopChange() {
        isChangingEmail = false
        newEmail = ""
        password = ""
        emailError = nil
        passwordError = nil
        formError = nil
        needsReauth = false
    }

    /// POST /api/account/email?as=shopper. Returns the address the link went to, or nil.
    func requestEmailChange() async -> String? {
        guard let account, !isSending else { return nil }
        let to = newEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        emailError = nil
        passwordError = nil
        formError = nil
        if to.range(of: #"^\S+@\S+\.\S+$"#, options: .regularExpression) == nil {
            emailError = "Enter an email address like name@example.com."
        } else if to.lowercased() == account.email.lowercased() {
            emailError = "That's already your email."
        }
        if account.hasPassword && password.isEmpty { passwordError = "Enter your current password." }
        guard emailError == nil, passwordError == nil else { return nil }

        isSending = true
        defer { isSending = false }
        do {
            let body = YouEmailChangeBody(email: to, currentPassword: account.hasPassword ? password : nil)
            let r: YouAccountResponse = try await APIClient.shared.post("/api/account/email", body: body, query: Self.asShopper)
            self.account = r.account
            stopChange()
            return to
        } catch let error as APIError {
            if error.isCancelled { return nil }
            if error.youNeedsReauth {
                needsReauth = true
                formError = "Changing your email needs you to confirm it's you."
                await loadReauthButtons()
            } else if error.fields["email"] != nil || error.fields["currentPassword"] != nil {
                emailError = error.fields["email"]
                passwordError = error.fields["currentPassword"]
            } else {
                formError = error.message
            }
            return nil
        } catch {
            formError = "The link wasn't sent. Try again."
            return nil
        }
    }

    /// DELETE /api/account/email?as=shopper. Returns true when cancelled.
    func cancelPending() async -> Bool {
        guard !isCancelling else { return false }
        isCancelling = true
        defer { isCancelling = false }
        do {
            let r: YouAccountResponse = try await APIClient.shared.delete("/api/account/email", query: Self.asShopper)
            account = r.account
            return true
        } catch {
            if let api = error as? APIError, api.isCancelled { return false }
            formError = APIError.message(for: error)
            return false
        }
    }

    // MARK: Re-confirm (accounts without a password)

    /// The sign-in buttons this account can confirm with: the server's providers, limited to the
    /// identities linked to the account.
    private func loadReauthButtons() async {
        let linked = Set(account?.signInProviders ?? [])
        do {
            let providers = try await AuthAPI.providers()
            reauthButtons = AuthSocialButton.buttons(from: providers).filter { linked.contains($0.provider) }
        } catch {
            // Providers unreadable: the Auth0 Google button only confirms an Auth0-linked account
            // (a direct Google link is a different identity), else the sign-out-and-back-in copy.
            reauthButtons = linked.contains("auth0") ? [AuthSocialButton.auth0Google] : []
        }
    }

    /// POST /api/auth/oauth/{provider}/start { mode: "reauth", actor: "shopper" } → the in-app web
    /// sheet, which carries this session's cookies, so the provider round trip confirms this session.
    func startReauth(_ button: AuthSocialButton) async {
        guard startingReauthKey == nil else { return }
        startingReauthKey = button.key
        defer { startingReauthKey = nil }
        do {
            let body = AuthOAuthStartBody(mode: "reauth", actor: "shopper", connection: button.connection)
            let r: AuthOAuthStartResponse = try await APIClient.shared.post("/api/auth/oauth/\(button.provider)/start", body: body)
            guard let url = Config.url(for: r.url) else {
                formError = "Couldn't start \(button.label). Try again."
                return
            }
            reauthFlow = AuthWebFlow(url: url, label: button.label)
        } catch {
            formError = APIError.message(for: error)
        }
    }

    /// The web sheet ended. Returns true when the session is confirmed (then send again).
    func finishReauth(_ outcome: AuthWebOutcome) -> Bool {
        reauthFlow = nil
        switch outcome {
        case .completed(let result):
            if result == "reauthed" || result == "signed_in" {
                needsReauth = false
                formError = nil
                return true
            }
            formError = AuthOAuthResult.message(for: result)
            return false
        case .cancelled:
            return false
        case .failed(let message):
            formError = message
            return false
        }
    }
}

// MARK: - View

/// Settings › Account: edit your name (saved at once) and change your email (confirmed by a link
/// sent to the new address; pending change can be resent or cancelled).
@MainActor
struct YouAccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.scenePhase) private var scenePhase

    @State private var model: YouAccountModel
    @State private var savedTick = 0
    @State private var sentTick = 0
    private let isPreview: Bool

    init() {
        _model = State(initialValue: YouAccountModel())
        isPreview = false
    }

    /// Previews only.
    init(previewModel: YouAccountModel) {
        _model = State(initialValue: previewModel)
        isPreview = true
    }

    var body: some View {
        @Bindable var bindable = model
        content
            .yardScreenBackground()
            .navigationTitle("Name and email")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: session.shopper?.id) {
                guard !isPreview, session.isSignedIn else { return }
                await model.load()
            }
            .onChange(of: scenePhase) { _, phase in
                // Back from Mail / Safari after opening the confirmation link: the email may have changed.
                guard phase == .active, !isPreview, session.isSignedIn else { return }
                Task { @MainActor in
                    let before = model.account?.email
                    await model.load()
                    if let after = model.account?.email, let before, after != before {
                        await session.refresh()
                        toast.show("Your email is now \(after).", style: .success)
                    }
                }
            }
            .sheet(item: $bindable.reauthFlow) { flow in
                AuthWebSheet(flow: flow) { outcome in
                    if model.finishReauth(outcome) {
                        Task { @MainActor in await sendLink() }
                    }
                }
            }
            .sensoryFeedback(.success, trigger: savedTick)
            .sensoryFeedback(.success, trigger: sentTick)
    }

    @ViewBuilder
    private var content: some View {
        if !isPreview && !session.isSignedIn {
            if session.hasLoaded {
                EmptyState.signedOut(message: "Sign in to change your name and email.") { router.present(.signIn) }
            } else {
                loadingView
            }
        } else {
            switch model.phase {
            case .loading:
                loadingView
            case .failed(let message):
                EmptyState(title: "Couldn't load your account.", message: message, systemImage: "wifi.exclamationmark", actionTitle: "Try again") {
                    Task { @MainActor in await model.load() }
                }
            case .loaded:
                if let account = model.account {
                    form(account)
                } else {
                    loadingView
                }
            }
        }
    }

    private var loadingView: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Skeleton(cornerRadius: Radius.small).frame(height: 120)
            Skeleton(cornerRadius: Radius.small).frame(height: 160)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.m)
        .accessibilityLabel(Text("Loading your account"))
    }

    private func form(_ account: YouAccount) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                nameSection(account)
                emailSection(account)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.load() }
    }

    // MARK: Name

    private func nameSection(_ account: YouAccount) -> some View {
        section("Name", footer: "Goes on your orders and shows to brands you message.") {
            VStack(alignment: .leading, spacing: Spacing.m) {
                YouTextField(
                    title: "Your name",
                    text: Binding(
                        get: { model.nameDraft },
                        set: { value in
                            model.nameDraft = value
                            model.nameError = nil
                            model.nameJustSaved = false
                        }
                    ),
                    error: model.nameError,
                    contentType: .name,
                    capitalization: .words
                )
                .disabled(account.demo)
                YardButton(
                    model.nameJustSaved && !model.isNameDirty ? "Saved" : "Save name",
                    systemImage: model.nameJustSaved && !model.isNameDirty ? "checkmark" : nil,
                    style: .primary,
                    size: .medium,
                    isLoading: model.isSavingName
                ) {
                    saveName()
                }
                .disabled(account.demo || !model.isNameDirty)
            }
        }
    }

    private func saveName() {
        Task { @MainActor in
            if await model.saveName() {
                savedTick += 1
                // GET /api/session carries the new name (You header, greetings).
                await session.refresh()
                toast.show("Name saved.", style: .success)
            }
        }
    }

    // MARK: Email

    private func emailSection(_ account: YouAccount) -> some View {
        section(
            "Email",
            footer: account.signInProviders.isEmpty
                ? "Sign-in links, order updates and receipts go here."
                : "You also sign in with \(account.providerWords); that keeps working after a change."
        ) {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "envelope")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.yard.ink)
                        .frame(width: 36, height: 36)
                        .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Text(account.email)
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: Spacing.s)
                    if account.emailVerified {
                        Tag("Verified", style: .success)
                    }
                }

                if let pending = account.pendingEmail {
                    pendingCard(pending)
                }

                if account.demo {
                    Text("Demo accounts can't change their email.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                } else if model.isChangingEmail {
                    changeForm(account)
                } else if account.pendingEmail == nil {
                    YardButton("Change email", systemImage: "envelope.badge", style: .secondary, size: .medium) {
                        withAnimation(Motion.spring) { model.startChange() }
                    }
                }
            }
        }
    }

    private func pendingCard(_ pending: YouAccount.PendingEmail) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .top, spacing: Spacing.s) {
                Image(systemName: "envelope.open")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.violet)
                    .padding(.top, 2)
                Text(pendingText(pending))
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !model.isChangingEmail {
                HStack(spacing: Spacing.s) {
                    YardButton("Resend link", style: .secondary, size: .small, fullWidth: false) {
                        withAnimation(Motion.spring) { model.startChange(prefill: pending.email) }
                    }
                    YardButton("Use a different email", style: .secondary, size: .small, fullWidth: false) {
                        withAnimation(Motion.spring) { model.startChange() }
                    }
                }
                YardButton("Cancel change", style: .ghost, size: .small, isLoading: model.isCancelling, fullWidth: false) {
                    cancelChange()
                }
            }
        }
        .padding(Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.surface2.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    private func pendingText(_ pending: YouAccount.PendingEmail) -> String {
        var text = "We sent a link to \(pending.email). Your email changes once you open it."
        if let date = YardDate.parse(pending.expiresAt) {
            let f = DateFormatter()
            f.setLocalizedDateFormatFromTemplate("d MMM HH:mm")
            text += " The link expires \(f.string(from: date))."
        }
        return text
    }

    private func changeForm(_ account: YouAccount) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            YouTextField(
                title: "New email",
                text: Binding(
                    get: { model.newEmail },
                    set: { value in
                        model.newEmail = value
                        model.emailError = nil
                        model.formError = nil
                    }
                ),
                error: model.emailError,
                contentType: .emailAddress,
                keyboard: .emailAddress
            )
            if account.hasPassword {
                YouTextField(
                    title: "Current password",
                    text: Binding(
                        get: { model.password },
                        set: { value in
                            model.password = value
                            model.passwordError = nil
                            model.formError = nil
                        }
                    ),
                    isSecure: true,
                    error: model.passwordError,
                    contentType: .password
                )
            }
            if model.needsReauth {
                reauthBox
            }
            if let formError = model.formError, !model.needsReauth {
                Text(formError)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("We'll email a link to the new address. Your email changes only when you open it, and we tell your current address.")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.s) {
                YardButton("Send link", style: .primary, size: .medium, isLoading: model.isSending) {
                    Task { @MainActor in await sendLink() }
                }
                YardButton("Cancel", style: .ghost, size: .medium, fullWidth: false) {
                    withAnimation(Motion.spring) { model.stopChange() }
                }
            }
        }
        .padding(Spacing.m)
        .background(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
        .transition(.opacity)
    }

    /// Accounts without a password: confirm with a linked provider, then the link is sent.
    private var reauthBox: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Label("Changing your email needs you to confirm it's you.", systemImage: "lock.shield")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
            if model.reauthButtons.isEmpty {
                Text("Sign out and sign back in, then change your email within 10 minutes.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(model.reauthButtons) { button in
                    YardButton(
                        "Confirm with \(button.label)",
                        systemImage: button.mark == .apple ? "apple.logo" : "person.badge.key",
                        style: .secondary,
                        size: .medium,
                        isLoading: model.startingReauthKey == button.key
                    ) {
                        Task { @MainActor in await model.startReauth(button) }
                    }
                }
            }
            if let formError = model.formError, formError != "Changing your email needs you to confirm it's you." {
                Text(formError)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.surface2.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
    }

    private func sendLink() async {
        if let to = await model.requestEmailChange() {
            sentTick += 1
            toast.show("Check your new inbox. We sent a link to \(to).", style: .success, systemImage: "envelope")
        }
    }

    private func cancelChange() {
        Task { @MainActor in
            if await model.cancelPending() {
                toast.show("Email change cancelled. The link we sent no longer works.", style: .info)
            } else if let message = model.formError {
                toast.show(message, style: .error)
            }
        }
    }

    // MARK: Layout

    private func section<Content: View>(_ title: String, footer: String?, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: Spacing.s) {
            Text(title)
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink2)
                .padding(.horizontal, Spacing.xs)
                .accessibilityAddTraits(.isHeader)
            Card {
                inner
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

// MARK: - Email change links opened in the app

/// `/auth/change-email?token=…` (the link sent to the new address). The website handles it in the
/// browser; if the link ever reaches the app (a `yard://` link or a claimed https link), the app
/// confirms it itself: POST /api/auth/change-email/confirm { token } → { status, email }.
@MainActor
enum YouEmailChangeLink {
    private struct Body: Encodable, Sendable {
        let token: String
    }

    private struct ConfirmResult: Decodable, Sendable {
        let status: String?
        let email: String?
    }

    static func canHandle(_ url: URL) -> Bool {
        guard url.host == Config.baseURL.host || url.scheme == "yard" else { return false }
        return path(url) == "/auth/change-email" && token(in: url) != nil
    }

    /// Confirms the change; returns a sentence for a toast.
    static func handle(_ url: URL, session: SessionStore) async -> String {
        guard let token = token(in: url) else { return "This link isn't complete. Open it from the email again." }
        do {
            let r: ConfirmResult = try await APIClient.shared.post("/api/auth/change-email/confirm", body: Body(token: token))
            await session.refresh()
            if let email = r.email, !email.isEmpty { return "Your email is now \(email)." }
            return "Your email was changed."
        } catch {
            if let api = error as? APIError, let field = api.fields["token"] { return field }
            return APIError.message(for: error)
        }
    }

    private static func path(_ url: URL) -> String {
        if url.scheme == "yard", let host = url.host { return "/" + host + url.path }
        return url.path
    }

    private static func token(in url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let value = items.first(where: { $0.name == "token" })?.value, !value.isEmpty else { return nil }
        return value
    }
}

// MARK: - Previews

private enum YouAccountPreviewData {
    @MainActor
    static func model(pending: Bool) -> YouAccountModel {
        let account = YouAccount(
            name: "Ada Obi",
            email: "ada@example.com",
            emailVerified: true,
            hasPassword: true,
            signInProviders: ["google"],
            pendingEmail: pending ? YouAccount.PendingEmail(email: "ada.new@example.com", expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_000))) : nil,
            demo: false
        )
        return YouAccountModel(preview: account)
    }
}

#Preview("Account — dark") {
    NavigationStack { YouAccountView(previewModel: YouAccountPreviewData.model(pending: true)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Account — light") {
    NavigationStack { YouAccountView(previewModel: YouAccountPreviewData.model(pending: false)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
