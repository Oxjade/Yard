import Foundation
import Observation

/// Form state and actions for SignInView (mirrors the website's AuthForm,
/// src/components/market/auth-prompt.tsx: same checks, same sentences).
@Observable
@MainActor
final class SignInModel {
    enum Mode: Equatable {
        case signIn
        case signUp
    }

    enum Busy: Equatable {
        case email
        case signUp
        case forgot
        case magic
        case demo
        case social(String)
    }

    enum Field: Hashable {
        case name
        case email
        case password
    }

    var mode: Mode = .signIn
    var name: String = ""
    var email: String = ""
    var password: String = ""
    var isPasswordRevealed: Bool = false

    var nameError: String?
    var emailError: String?
    var passwordError: String?
    /// A non-field error (server sentence), shown in danger under the form.
    var failure: String?
    /// A neutral notice ("If an account exists… a sign-in link has been sent.").
    var notice: String?
    /// Set after sign-up: the address the verification link went to.
    var signUpSentTo: String?

    var busy: Busy?
    /// The social sign-in being shown in the web sheet.
    var webFlow: AuthWebFlow?
    /// The social button that started `webFlow`.
    private var webFlowButton: AuthSocialButton?

    private(set) var providers: AuthProviders?
    private(set) var providersLoaded: Bool = false
    private var providersFailed: Bool = false

    init() {}

    init(previewProviders: AuthProviders) {
        providers = previewProviders
        providersLoaded = true
    }

    // MARK: Providers

    var socialButtons: [AuthSocialButton] {
        if providersFailed { return [AuthSocialButton.auth0Google] }
        return AuthSocialButton.buttons(from: providers)
    }

    var magicLinkEnabled: Bool { providers?.magicLink ?? true }
    var demoEnabled: Bool { providers?.demoShopper ?? false }

    func loadProviders() async {
        guard !providersLoaded else { return }
        do {
            providers = try await AuthAPI.providers()
            providersFailed = false
        } catch {
            // Offer the site's default (Google via Auth0); the start call reports if it's off.
            providersFailed = true
        }
        providersLoaded = true
    }

    // MARK: Validation (website wording)

    private static func nameProblem(_ name: String) -> String? {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Enter your name." : nil
    }

    private static func emailProblem(_ email: String) -> String? {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Enter your email address." }
        if trimmed.range(of: "^\\S+@\\S+\\.\\S+$", options: .regularExpression) == nil {
            return "Enter an email address like name@example.com."
        }
        return nil
    }

    private func passwordProblem(_ password: String) -> String? {
        if password.isEmpty { return "Enter your password." }
        // New passwords need 10+ characters (server rule); existing ones are checked by the server.
        if mode == .signUp && password.count < 10 { return "Use at least 10 characters for your password." }
        return nil
    }

    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Clears a field's error as soon as the field becomes valid (call from `onChange`).
    func revalidate(_ field: Field) {
        switch field {
        case .name:
            if nameError != nil && SignInModel.nameProblem(name) == nil { nameError = nil }
        case .email:
            if emailError != nil && SignInModel.emailProblem(email) == nil { emailError = nil }
        case .password:
            if passwordError != nil && passwordProblem(password) == nil { passwordError = nil }
        }
    }

    func toggleMode() {
        mode = mode == .signIn ? .signUp : .signIn
        failure = nil
        notice = nil
        nameError = nil
        emailError = nil
        passwordError = nil
    }

    func backToSignIn() {
        signUpSentTo = nil
        mode = .signIn
        password = ""
        failure = nil
        notice = nil
    }

    // MARK: Actions

    /// Sign in or create the account. Returns true when the server signed the shopper in
    /// (the caller then refreshes the session). Returns the first invalid field through `focus`.
    func submit(focus: (Field) -> Void) async -> Bool {
        nameError = mode == .signUp ? SignInModel.nameProblem(name) : nil
        emailError = SignInModel.emailProblem(email)
        passwordError = passwordProblem(password)
        if nameError != nil { focus(.name); return false }
        if emailError != nil { focus(.email); return false }
        if passwordError != nil { focus(.password); return false }
        guard busy == nil else { return false }

        let signingUp = mode == .signUp
        busy = signingUp ? .signUp : .email
        failure = nil
        notice = nil
        defer { busy = nil }
        do {
            if signingUp {
                try await AuthAPI.signUp(name: name.trimmingCharacters(in: .whitespacesAndNewlines), email: trimmedEmail, password: password)
                signUpSentTo = trimmedEmail
                password = ""
                return false
            }
            let result = try await AuthAPI.signIn(email: trimmedEmail, password: password)
            switch result.status {
            case "signed_in":
                return true
            case "verify_email":
                failure = "Check your email for a verification link, then sign in again."
                return false
            default:
                failure = "Couldn't sign in. Check your email and password, then try again."
                return false
            }
        } catch {
            apply(error, fallback: "Couldn't sign in. Check your email and password, then try again.", focus: focus)
            return false
        }
    }

    func requestMagicLink(focus: (Field) -> Void) async {
        guard let email = validEmailForLink(focus: focus), busy == nil else { return }
        busy = .magic
        failure = nil
        notice = nil
        defer { busy = nil }
        do {
            try await AuthAPI.requestMagicLink(email: email)
            notice = "If an account exists for that address, a sign-in link has been sent."
        } catch {
            failure = message(for: error, fallback: "Couldn't request a sign-in link. Try again.")
        }
    }

    func requestPasswordReset(focus: (Field) -> Void) async {
        guard let email = validEmailForLink(focus: focus), busy == nil else { return }
        busy = .forgot
        failure = nil
        notice = nil
        defer { busy = nil }
        do {
            try await AuthAPI.requestPasswordReset(email: email)
            notice = "If an account exists for that address, a password reset link has been sent."
        } catch {
            failure = message(for: error, fallback: "Couldn't request a reset link. Try again.")
        }
    }

    /// Demo shopper (only offered when the server allows it). Returns true when signed in.
    func signInDemo() async -> Bool {
        guard busy == nil else { return false }
        busy = .demo
        failure = nil
        notice = nil
        defer { busy = nil }
        do {
            try await AuthAPI.signInDemo()
            return true
        } catch {
            failure = message(for: error, fallback: "Couldn't sign in. Check your connection and try again.")
            return false
        }
    }

    /// Starts a social sign-in; on success `webFlow` is set and the view shows the web sheet.
    func startSocial(_ button: AuthSocialButton) async {
        guard busy == nil else { return }
        busy = .social(button.key)
        failure = nil
        notice = nil
        do {
            let url = try await AuthAPI.startOAuth(button)
            webFlowButton = button
            webFlow = AuthWebFlow(url: url, label: button.label)
        } catch {
            busy = nil
            failure = message(for: error, fallback: "Couldn't start \(button.label) sign-in. Try again.")
        }
    }

    /// The web sheet ended. Returns true when the server reported `signed_in` (the caller then
    /// refreshes the session and confirms a shopper is really there).
    func finishSocial(_ outcome: AuthWebOutcome) -> Bool {
        webFlow = nil
        busy = nil
        let label = webFlowButton?.label ?? "social"
        webFlowButton = nil
        switch outcome {
        case .completed(let result):
            if result == "signed_in" { return true }
            failure = AuthOAuthResult.message(for: result)
            return false
        case .cancelled:
            return false
        case .failed(let message):
            failure = "Couldn't finish \(label) sign-in. \(message)"
            return false
        }
    }

    /// The server answered "signed in" but GET /api/session shows no shopper.
    func reportUnconfirmedSignIn() {
        failure = "Yard couldn’t confirm this sign-in. Try again."
    }

    // MARK: Helpers

    private func validEmailForLink(focus: (Field) -> Void) -> String? {
        if let problem = SignInModel.emailProblem(email) {
            emailError = problem
            focus(.email)
            return nil
        }
        return trimmedEmail
    }

    private func message(for error: Error, fallback: String) -> String {
        if let api = error as? APIError, !api.message.isEmpty { return api.message }
        return fallback
    }

    /// Server field messages go under their fields; anything else is the summary line.
    private func apply(_ error: Error, fallback: String, focus: (Field) -> Void) {
        if let api = error as? APIError, api.isCancelled { return }
        if let api = error as? APIError, !api.fields.isEmpty {
            let n = mode == .signUp ? api.fields["name"] : nil
            let e = api.fields["email"]
            let p = api.fields["password"]
            if n != nil || e != nil || p != nil {
                nameError = n
                emailError = e
                passwordError = p
                failure = nil
                if n != nil { focus(.name) } else if e != nil { focus(.email) } else { focus(.password) }
                return
            }
        }
        failure = message(for: error, fallback: fallback)
    }
}
