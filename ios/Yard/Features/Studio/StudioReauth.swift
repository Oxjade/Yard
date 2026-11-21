import Foundation
import UIKit
import AuthenticationServices
import CryptoKit
import Security

/// PKCE for the app sign-in hand-off (docs/APP.md › Google / Apple / Auth0 sign-in):
/// verifier = base64url(32 random bytes), challenge = base64url(sha256(verifier)), 43 chars each.
enum StudioPKCE {
    static func makeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            bytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
        }
        return base64url(Data(bytes))
    }

    static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Re-confirms a brand session with the sign-in provider (Google / Apple / Auth0) for money
/// actions: `app-start?client=ios&actor=brand` in an ASWebAuthenticationSession, then
/// `POST /api/auth/oauth/app-exchange { code, verifier }`, whose new `yard_b` counts as
/// re-confirmed for 5 minutes. Returns the brand id of the new brand session.
final class StudioProviderReauth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    private struct ExchangeBody: Encodable {
        let code: String
        let verifier: String
    }

    private struct ExchangeResult: Decodable {
        struct Profile: Decodable {
            struct Brand: Decodable { let id: String? }
            let brand: Brand?
        }
        let profile: Profile?
    }

    @MainActor
    func run(provider: String, connection: String?) async throws -> String? {
        let verifier = StudioPKCE.makeVerifier()
        var components = URLComponents(url: Config.webURL("/api/auth/oauth/\(provider)/app-start"), resolvingAgainstBaseURL: false)
        var items: [URLQueryItem] = [
            URLQueryItem(name: "client", value: "ios"),
            URLQueryItem(name: "challenge", value: StudioPKCE.challenge(for: verifier)),
            URLQueryItem(name: "mode", value: "signin"),
            URLQueryItem(name: "actor", value: "brand"),
        ]
        if let connection, !connection.isEmpty { items.append(URLQueryItem(name: "connection", value: connection)) }
        components?.queryItems = items
        guard let startURL = components?.url else {
            throw APIError(status: 0, code: "bad_url", message: "Couldn't start the confirmation. Try again.")
        }
        let callback = try await authenticate(startURL)
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        guard let code = value("code"), value("result") == "signed_in" else {
            let message = value("message")?.replacingOccurrences(of: "+", with: " ")
            throw APIError(status: 0, code: value("result") ?? "error", message: (message?.isEmpty == false ? message : nil) ?? "Sign-in could not be completed.")
        }
        let result = try await APIClient.shared.post("/api/auth/oauth/app-exchange", body: ExchangeBody(code: code, verifier: verifier), as: ExchangeResult.self)
        return result.profile?.brand?.id
    }

    @MainActor
    private func authenticate(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: "yard") { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    continuation.resume(throwing: APIError(status: 0, code: "cancelled", message: "Confirmation was cancelled."))
                } else {
                    continuation.resume(throwing: APIError(status: 0, code: "error", message: "The provider couldn’t complete sign-in. Try again."))
                }
            }
            auth.presentationContextProvider = self
            auth.prefersEphemeralWebBrowserSession = false
            session = auth
            if !auth.start() {
                continuation.resume(throwing: APIError(status: 0, code: "error", message: "Couldn't open the sign-in page. Try again."))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let window = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) {
                return window
            }
            if let scene = scenes.first {
                return UIWindow(windowScene: scene)
            }
            return ASPresentationAnchor()
        }
    }
}
