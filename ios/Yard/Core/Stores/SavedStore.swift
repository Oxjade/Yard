import Foundation
import Observation

/// The shopper's wishlist ("Saved"). Injected at the root: `@Environment(SavedStore.self) private var saved`.
///
/// Saving needs a signed-in shopper: check `session.isSignedIn` first and present `.signIn`
/// otherwise. `toggle` updates `savedIds` optimistically and rolls back on failure.
@Observable
@MainActor
final class SavedStore {
    private(set) var items: [WishlistItem] = []
    private(set) var savedIds: Set<String> = []
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    private(set) var lastError: APIError?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func isSaved(_ productId: String) -> Bool { savedIds.contains(productId) }

    /// GET /api/wishlist. Signed out (401) → empty, no error.
    func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let response: WishlistResponse = try await api.get("/api/wishlist")
            items = response.items
            savedIds = Set(response.items.map(\.productId))
            lastError = nil
        } catch let error as APIError {
            if error.isUnauthorized {
                reset()
            } else if !error.isCancelled {
                lastError = error
            }
        } catch {
            lastError = APIError.network(error)
        }
    }

    /// Saves or unsaves a product.
    @discardableResult
    func toggle(productId: String) async throws -> Bool {
        try await setSaved(!isSaved(productId), productId: productId)
    }

    /// POST /api/wishlist or DELETE /api/wishlist/{productId}. Returns the new saved state.
    @discardableResult
    func setSaved(_ save: Bool, productId: String) async throws -> Bool {
        let wasSaved = isSaved(productId)
        if save { savedIds.insert(productId) } else { savedIds.remove(productId) }
        do {
            let result: SaveResult
            if save {
                result = try await api.post("/api/wishlist", body: WishlistBody(productId: productId), as: SaveResult.self)
            } else {
                let escaped = productId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? productId
                result = try await api.delete("/api/wishlist/\(escaped)", as: SaveResult.self)
            }
            if result.saved { savedIds.insert(productId) } else { savedIds.remove(productId) }
            if !result.saved { items.removeAll { $0.productId == productId } }
            return result.saved
        } catch {
            if wasSaved { savedIds.insert(productId) } else { savedIds.remove(productId) }
            throw error
        }
    }

    /// Clears local state (sign-out).
    func reset() {
        items = []
        savedIds = []
        lastError = nil
    }

    static func preview(saved: Set<String> = []) -> SavedStore {
        let store = SavedStore()
        store.savedIds = saved
        store.hasLoaded = true
        return store
    }
}
