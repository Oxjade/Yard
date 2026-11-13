import Foundation

/// The auth endpoints the app uses (src/app/api/auth/**). Every call goes through `APIClient.shared`,
/// so the session cookie (`yard_s` / `__Host-yard_s`) lands in `HTTPCookieStorage.shared`.
enum AuthAPI {
    /// GET /api/auth/providers.
    static func providers() async throws -> AuthProviders {
        try await APIClient.shared.get("/api/auth/providers", as: AuthProviders.self)
    }

    /// POST /api/auth/sign-in → `signed_in` (cookie set) | `verify_email` | `mfa_*` (admins only).
    /// Wrong email or password: 401 with the server's sentence.
    static func signIn(email: String, password: String) async throws -> AuthStatusResponse {
        try await APIClient.shared.post("/api/auth/sign-in", body: AuthSignInBody(email: email, password: password, actor: "shopper"), as: AuthStatusResponse.self)
    }

    /// POST /api/auth/sign-up → always `{ status: "verify_email" }` (no account enumeration).
    static func signUp(name: String, email: String, password: String) async throws {
        try await APIClient.shared.send(.post, "/api/auth/sign-up", body: AuthSignUpBody(name: name, email: email, password: password))
    }

    /// POST /api/auth/magic-link → `{ ok: true }` (a 15-minute sign-in link by email).
    static func requestMagicLink(email: String) async throws {
        try await APIClient.shared.send(.post, "/api/auth/magic-link", body: AuthEmailBody(email: email))
    }

    /// POST /api/auth/password/forgot → `{ ok: true }` whether or not the account exists.
    static func requestPasswordReset(email: String) async throws {
        try await APIClient.shared.send(.post, "/api/auth/password/forgot", body: AuthEmailBody(email: email))
    }

    /// POST /api/auth/oauth/{provider}/start → the provider URL. The response also sets the
    /// browser-binding cookie (`yard_oauth`) in the app's cookie jar; `AuthWebSheet` carries it
    /// into the web view so the callback can complete.
    static func startOAuth(_ button: AuthSocialButton) async throws -> URL {
        let body = AuthOAuthStartBody(mode: "signin", actor: "shopper", connection: button.connection)
        let response: AuthOAuthStartResponse = try await APIClient.shared.post("/api/auth/oauth/\(button.provider)/start", body: body, as: AuthOAuthStartResponse.self)
        guard let url = Config.url(for: response.url) else {
            throw APIError(status: 0, code: "bad_url", message: "Couldn't start \(button.label) sign-in. Try again.")
        }
        return url
    }

    /// POST /api/auth/demo { actor: "shopper", account: "u_ada" } (only when providers.demo.shopper).
    static func signInDemo() async throws {
        try await APIClient.shared.send(.post, "/api/auth/demo", body: AuthDemoBody(actor: "shopper", account: "u_ada"))
    }

    /// POST /api/auth/magic-link/consume { token } → `{ status: "signed_in" }`.
    static func consumeMagicLink(token: String) async throws -> AuthStatusResponse {
        try await APIClient.shared.post("/api/auth/magic-link/consume", body: AuthTokenBody(token: token), as: AuthStatusResponse.self)
    }

    /// POST /api/auth/verify-email/confirm { token } → `{ status: "verified", signedIn }`.
    static func confirmEmail(token: String) async throws -> AuthStatusResponse {
        try await APIClient.shared.post("/api/auth/verify-email/confirm", body: AuthTokenBody(token: token), as: AuthStatusResponse.self)
    }
}

/// Email links (`/auth/magic?token=…`, `/auth/verify?token=…`) opened in the app.
///
/// Not wired yet: the Router (foundation) sends `/auth/*` to Safari. To finish sign-in in the app
/// from a universal link, call this from `onOpenURL` before `router.open(url)`:
///
///   if AuthEmailLinks.canHandle(url) {
///       Task { @MainActor in
///           if let message = await AuthEmailLinks.handle(url, session: session) { toast.show(message) }
///       }
///   }
@MainActor
enum AuthEmailLinks {
    static func canHandle(_ url: URL) -> Bool {
        guard url.host == Config.baseURL.host || url.scheme == "yard" else { return false }
        let path = normalisedPath(url)
        return (path == "/auth/magic" || path == "/auth/verify") && token(in: url) != nil
    }

    /// Consumes the link; returns a sentence for a toast.
    static func handle(_ url: URL, session: SessionStore) async -> String? {
        guard let token = token(in: url) else { return nil }
        do {
            switch normalisedPath(url) {
            case "/auth/magic":
                _ = try await AuthAPI.consumeMagicLink(token: token)
                await session.didSignIn()
                return session.isSignedIn ? "You're signed in." : "Yard couldn't confirm this sign-in. Try again."
            case "/auth/verify":
                let result = try await AuthAPI.confirmEmail(token: token)
                if result.signedIn == true {
                    await session.didSignIn()
                    return "Your email is verified. You're signed in."
                }
                return "Your email is verified. Sign in to continue."
            default:
                return nil
            }
        } catch {
            return APIError.message(for: error)
        }
    }

    private static func normalisedPath(_ url: URL) -> String {
        if url.scheme == "yard", let host = url.host {
            return "/" + host + url.path
        }
        return url.path
    }

    private static func token(in url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let value = items.first(where: { $0.name == "token" })?.value, !value.isEmpty else { return nil }
        return value
    }
}
