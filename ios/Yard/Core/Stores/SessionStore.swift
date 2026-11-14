import Foundation
import Observation

/// Who is signed in. Injected at the root: `@Environment(SessionStore.self) private var session`.
///
/// - `refresh()` reads GET /api/session (call after sign-in; the root calls it on launch/foreground).
/// - `signOut()` posts /api/auth/sign-out?actor=shopper and clears local state.
/// - Gate shopper-only actions with `session.isSignedIn`, else `router.present(.signIn)`.
@Observable
@MainActor
final class SessionStore {
    /// The signed-in shopper, or nil.
    private(set) var shopper: Shopper?
    /// The full session (brand membership etc.), nil before the first load.
    private(set) var session: Session?
    /// True until the first `refresh()` finishes (show neutral UI rather than "signed out" flicker).
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    /// Last error from `refresh()` (network); the previous session is kept.
    private(set) var lastError: APIError?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    /// A shopper is signed in.
    var isSignedIn: Bool { shopper != nil }

    /// Re-reads GET /api/session.
    func refresh() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let s: Session = try await api.get("/api/session")
            let wasSignedIn = shopper != nil
            session = s
            shopper = s.shopper
            lastError = nil
            // The session ended elsewhere (expired / signed out on the web): drop the local
            // drop alerts that belong to that account.
            if wasSignedIn && s.shopper == nil { await DropLocalReminder.cancelAll() }
        } catch let error as APIError {
            if !error.isCancelled { lastError = error }
        } catch {
            lastError = APIError.network(error)
        }
    }

    /// Call after a successful sign-in/sign-up response (the cookie is already stored): re-reads the session.
    func didSignIn() async {
        await refresh()
    }

    /// Signs the shopper out on the server and locally. Never throws: the user always ends signed out.
    func signOut() async {
        do {
            try await api.send(.post, "/api/auth/sign-out", query: [URLQueryItem(name: "actor", value: "shopper")])
        } catch {
            // The server always succeeds; a network failure still signs out locally.
        }
        shopper = nil
        session = Session.signedOut
        // A signed-out phone shouldn't keep showing someone's order on the Lock Screen.
        await LiveActivityManager.shared.endAll()
        // Local "opens in 10 minutes" drop alerts belong to the account that set them.
        await DropLocalReminder.cancelAll()
        await refresh()
    }

    /// Previews only: a store that looks signed in (or out) without the network.
    static func preview(signedIn: Bool = true) -> SessionStore {
        let store = SessionStore()
        if signedIn {
            store.shopper = Shopper(id: "preview", name: "Ada Obi", email: "ada@example.com")
        }
        store.hasLoaded = true
        return store
    }
}
