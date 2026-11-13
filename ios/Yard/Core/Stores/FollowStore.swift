import Foundation
import Observation

/// Brands the shopper follows. Injected at the root: `@Environment(FollowStore.self) private var follows`.
///
/// Following needs a signed-in shopper: check `session.isSignedIn` first and present `.signIn`
/// otherwise. `toggle` updates `followedIds` optimistically and rolls back on failure.
@Observable
@MainActor
final class FollowStore {
    private(set) var items: [FollowedBrand] = []
    private(set) var followedIds: Set<String> = []
    private(set) var isLoading: Bool = false
    private(set) var hasLoaded: Bool = false
    private(set) var lastError: APIError?
    /// Latest known follower counts by brand id (from toggles and `followerCounts`).
    private(set) var followerCountCache: [String: Int] = [:]

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func isFollowing(_ brandId: String) -> Bool { followedIds.contains(brandId) }

    /// GET /api/follows. Signed out (401) → empty, no error.
    func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            let response: FollowsResponse = try await api.get("/api/follows")
            items = response.items
            followedIds = Set(response.items.map(\.brandId))
            for item in response.items { followerCountCache[item.brandId] = item.followers }
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

    /// Follows or unfollows. Returns the server result (with the new follower count).
    @discardableResult
    func toggle(brandId: String) async throws -> FollowResult {
        try await setFollowing(!isFollowing(brandId), brandId: brandId)
    }

    /// POST /api/follows or DELETE /api/follows/{brandId}.
    @discardableResult
    func setFollowing(_ follow: Bool, brandId: String) async throws -> FollowResult {
        let wasFollowing = isFollowing(brandId)
        if follow { followedIds.insert(brandId) } else { followedIds.remove(brandId) }
        do {
            let result: FollowResult
            if follow {
                result = try await api.post("/api/follows", body: FollowBody(brandId: brandId), as: FollowResult.self)
            } else {
                let escaped = brandId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? brandId
                result = try await api.delete("/api/follows/\(escaped)", as: FollowResult.self)
            }
            if result.following { followedIds.insert(brandId) } else { followedIds.remove(brandId) }
            followerCountCache[brandId] = result.followers
            if !result.following { items.removeAll { $0.brandId == brandId } }
            return result
        } catch {
            if wasFollowing { followedIds.insert(brandId) } else { followedIds.remove(brandId) }
            throw error
        }
    }

    /// GET /api/follows/counts (public): real follower counts for brand ids (max ~100 per call).
    func followerCounts(for brandIds: [String]) async throws -> [String: Int] {
        guard !brandIds.isEmpty else { return [:] }
        let query = brandIds.map { URLQueryItem(name: "brandIds", value: $0) }
        let response: FollowCountsResponse = try await api.get("/api/follows/counts", query: query)
        for (id, n) in response.counts { followerCountCache[id] = n }
        return response.counts
    }

    /// Clears local state (sign-out).
    func reset() {
        items = []
        followedIds = []
        lastError = nil
    }

    static func preview(following: Set<String> = []) -> FollowStore {
        let store = FollowStore()
        store.followedIds = following
        store.hasLoaded = true
        return store
    }
}
