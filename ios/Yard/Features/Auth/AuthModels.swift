import Foundation

// Auth request/response shapes (src/server/auth/contracts.ts — every body schema is `.strict()`,
// so these structs carry exactly the keys the server accepts; nil optionals are omitted).

// MARK: - Providers

/// GET /api/auth/providers →
/// `{ password, magicLink, google, apple, auth0, auth0Connections: [{ name, label }], demo: { shopper, brand, admin } }`.
/// google/apple/auth0 are false when the server has no keys for them: hide those buttons.
struct AuthProviders: Decodable, Sendable {
    struct Connection: Decodable, Hashable, Sendable {
        let name: String
        let label: String
    }

    let google: Bool
    let apple: Bool
    let auth0: Bool
    let auth0Connections: [Connection]
    let magicLink: Bool
    /// The server allows the shared demo shopper sign-in.
    let demoShopper: Bool

    init(google: Bool = false, apple: Bool = false, auth0: Bool = true, auth0Connections: [Connection] = [Connection(name: "google-oauth2", label: "Google")], magicLink: Bool = true, demoShopper: Bool = false) {
        self.google = google
        self.apple = apple
        self.auth0 = auth0
        self.auth0Connections = auth0Connections
        self.magicLink = magicLink
        self.demoShopper = demoShopper
    }

    private struct Demo: Decodable {
        let shopper: Bool?
    }

    enum CodingKeys: String, CodingKey { case google, apple, auth0, auth0Connections, magicLink, demo }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        google = c.lenient(.google, false)
        apple = c.lenient(.apple, false)
        auth0 = c.lenient(.auth0, false)
        auth0Connections = c.lenient(.auth0Connections, [Connection]())
        magicLink = c.lenient(.magicLink, true)
        let demo: Demo? = c.lenientOptional(.demo)
        demoShopper = demo?.shopper ?? false
    }
}

/// One "Continue with …" button (mirrors `socialButtons` in src/lib/auth/auth0.ts):
/// direct Google / Apple first, then one per Auth0 connection, without duplicates.
struct AuthSocialButton: Identifiable, Hashable, Sendable {
    enum Mark: Hashable, Sendable {
        case google
        case apple
        case generic
    }

    /// "google", "apple" or "auth0:<connection>".
    let key: String
    /// Path segment for /api/auth/oauth/{provider}/start: "google" | "apple" | "auth0".
    let provider: String
    /// Auth0 connection ("google-oauth2"), nil for direct providers.
    let connection: String?
    /// "Google", "Apple", "Facebook"…
    let label: String
    let mark: Mark

    var id: String { key }

    /// The Auth0 Google button, used when the providers list can't be read (the site's default connection).
    static let auth0Google = AuthSocialButton(key: "auth0:google-oauth2", provider: "auth0", connection: "google-oauth2", label: "Google", mark: .google)

    static func buttons(from p: AuthProviders?) -> [AuthSocialButton] {
        guard let p else { return [] }
        var out: [AuthSocialButton] = []
        if p.google {
            out.append(AuthSocialButton(key: "google", provider: "google", connection: nil, label: "Google", mark: .google))
        }
        if p.apple {
            out.append(AuthSocialButton(key: "apple", provider: "apple", connection: nil, label: "Apple", mark: .apple))
        }
        if p.auth0 {
            for c in p.auth0Connections {
                if c.name == "google-oauth2" && p.google { continue }
                if c.name == "apple" && p.apple { continue }
                let mark: Mark = c.name == "google-oauth2" ? .google : (c.name == "apple" ? .apple : .generic)
                out.append(AuthSocialButton(key: "auth0:\(c.name)", provider: "auth0", connection: c.name, label: c.label, mark: mark))
            }
        }
        return out
    }
}

// MARK: - Bodies

/// POST /api/auth/sign-in.
struct AuthSignInBody: Encodable, Sendable {
    let email: String
    let password: String
    let actor: String
}

/// POST /api/auth/sign-up.
struct AuthSignUpBody: Encodable, Sendable {
    let name: String
    let email: String
    let password: String
}

/// POST /api/auth/magic-link, /api/auth/password/forgot, /api/auth/verify-email/request.
struct AuthEmailBody: Encodable, Sendable {
    let email: String
}

/// POST /api/auth/magic-link/consume, /api/auth/verify-email/confirm.
struct AuthTokenBody: Encodable, Sendable {
    let token: String
}

/// POST /api/auth/oauth/{provider}/start.
struct AuthOAuthStartBody: Encodable, Sendable {
    let mode: String
    let actor: String
    let connection: String?
}

/// POST /api/auth/demo.
struct AuthDemoBody: Encodable, Sendable {
    let actor: String
    let account: String
}

// MARK: - Responses

/// Sign-in / magic-link consume / verify-email confirm:
/// `{ status: "signed_in" | "verify_email" | "verified" | "mfa_required" …, signedIn? }`.
struct AuthStatusResponse: Decodable, Sendable {
    let status: String
    let signedIn: Bool?

    enum CodingKeys: String, CodingKey { case status, signedIn }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = c.lenient(.status, "")
        signedIn = c.lenientOptional(.signedIn)
    }
}

/// POST /api/auth/oauth/{provider}/start → `{ url }`.
struct AuthOAuthStartResponse: Decodable, Sendable {
    let url: String
}

// MARK: - OAuth results

/// `result=` on /auth/complete (website) or yard://auth/complete (app hand-off) → the words shown.
/// Copy mirrors src/lib/auth/oauth-results.ts (OAUTH_RESULT_MESSAGES) exactly.
enum AuthOAuthResult {
    static let successResults: Set<String> = ["signed_in", "linked", "reauthed"]
    static let fallbackMessage = "Sign-in could not be completed."
    /// Longest server `message` shown for a result the app doesn't know.
    static let maxServerMessageLength = 300

    static let messages: [String: String] = [
        "cancelled": "Sign-in was cancelled.",
        "invalid_state": "This sign-in link expired or could not be verified. Start again.",
        "error": "The provider couldn’t complete sign-in. Try again.",
        "not_configured": "This sign-in provider isn’t configured on Yard yet.",
        "rate_limited": "Too many sign-in attempts. Wait a few minutes, then try again.",
        "identity_in_use": "That provider account is connected to another Yard account.",
        "already_linked": "That provider is already connected to this account.",
        "link_required": "Sign in with your password before connecting this provider.",
        "email_required": "The provider didn’t share an email address. Try another sign-in method.",
        "email_unverified": "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way.",
        "no_brand": "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses.",
        "suspended": "This account is currently unavailable.",
        "team_account": "This is a Yard team account, so it can’t shop. Sign in with a different account.",
        "account_unavailable": "This Yard account is being deleted or is no longer available. Sign in with a different account.",
        "reauth_mismatch": "The provider account didn’t match the account being confirmed.",
    ]

    static func isSuccess(_ result: String) -> Bool { successResults.contains(result) }

    /// The words for a failed `result`: the app's own copy for a known result; otherwise the
    /// server's `message` (trimmed, plain text, capped), else the generic fallback.
    static func message(for result: String, serverMessage: String? = nil) -> String {
        if let known = messages[result] { return known }
        if isSuccess(result) { return fallbackMessage }
        return sanitize(serverMessage) ?? fallbackMessage
    }

    /// Trims, collapses control characters/newlines to spaces, caps length. Nil when empty.
    static func sanitize(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let space: Unicode.Scalar = " "
        var scalars = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars {
            let control = CharacterSet.controlCharacters.contains(scalar) || CharacterSet.newlines.contains(scalar)
            scalars.append(control ? space : scalar)
        }
        let flattened = String(scalars)
        var text = flattened.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if text.count > maxServerMessageLength {
            text = String(text.prefix(maxServerMessageLength - 1)).trimmingCharacters(in: .whitespaces) + "…"
        }
        return text
    }
}

/// The query of a completion URL (`/auth/complete?result=…&provider=…&message=…`).
struct AuthOAuthCompletion: Equatable {
    let result: String
    let provider: String?
    /// Server copy for a failure; always nil for a success.
    let message: String?

    init(result: String, provider: String? = nil, message: String? = nil) {
        self.result = result
        self.provider = provider
        self.message = AuthOAuthResult.isSuccess(result) ? nil : message
    }

    /// Parses `result`, `provider` and `message` (form-decoded: the server builds the
    /// query with URLSearchParams, so '+' means a space and %2B a literal plus). A missing
    /// or empty `result` reads as "error".
    static func parse(_ url: URL) -> AuthOAuthCompletion {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let query = components?.percentEncodedQuery {
            components?.percentEncodedQuery = query.replacingOccurrences(of: "+", with: "%20")
        }
        let items = components?.queryItems ?? []
        func value(_ name: String) -> String? {
            guard let v = items.first(where: { $0.name == name })?.value, !v.isEmpty else { return nil }
            return v
        }
        return AuthOAuthCompletion(result: value("result") ?? "error", provider: value("provider"), message: value("message"))
    }

    /// The words to show; nil for a success.
    var failureMessage: String? {
        AuthOAuthResult.isSuccess(result) ? nil : AuthOAuthResult.message(for: result, serverMessage: message)
    }
}
