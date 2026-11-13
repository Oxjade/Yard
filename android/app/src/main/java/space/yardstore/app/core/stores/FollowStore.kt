package space.yardstore.app.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.FollowBody
import space.yardstore.app.core.models.FollowCountsResponse
import space.yardstore.app.core.models.FollowResult
import space.yardstore.app.core.models.FollowedBrand
import space.yardstore.app.core.models.FollowsResponse
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import kotlin.coroutines.cancellation.CancellationException

/**
 * Brands the shopper follows. Mirrors `Core/Stores/FollowStore.swift`. Read with `LocalFollowStore.current`.
 *
 * Following needs a signed-in shopper: check `session.isSignedIn` first and present
 * `Route.SignIn` otherwise. [toggle] updates [followedIds] optimistically and rolls back on failure.
 */
class FollowStore(private val api: APIClient = APIClient.shared) {
    var items: List<FollowedBrand> by mutableStateOf(emptyList())
        private set
    var followedIds: Set<String> by mutableStateOf(emptySet())
        private set
    var isLoading: Boolean by mutableStateOf(false)
        private set
    var hasLoaded: Boolean by mutableStateOf(false)
        private set
    var lastError: APIError? by mutableStateOf(null)
        private set
    /** Latest known follower counts by brand id (from toggles and [followerCounts]). */
    var followerCountCache: Map<String, Int> by mutableStateOf(emptyMap())
        private set

    fun isFollowing(brandId: String): Boolean = brandId in followedIds

    /** GET /api/follows. Signed out (401) → empty, no error. */
    suspend fun load() {
        isLoading = true
        try {
            val response: FollowsResponse = api.get("/api/follows")
            items = response.items
            followedIds = response.items.map { it.brandId }.toSet()
            followerCountCache = followerCountCache + response.items.associate { it.brandId to it.followers }
            lastError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (e.isUnauthorized) reset() else if (!e.isCancelled) lastError = e
        } catch (e: Exception) {
            lastError = APIError.network(e)
        } finally {
            isLoading = false
            hasLoaded = true
        }
    }

    /** Follows or unfollows. Returns the server result (with the new follower count). */
    suspend fun toggle(brandId: String): FollowResult = setFollowing(!isFollowing(brandId), brandId)

    /** POST /api/follows or DELETE /api/follows/{brandId}. */
    suspend fun setFollowing(follow: Boolean, brandId: String): FollowResult {
        val wasFollowing = isFollowing(brandId)
        followedIds = if (follow) followedIds + brandId else followedIds - brandId
        try {
            val result: FollowResult = if (follow) {
                api.post("/api/follows", body = FollowBody(brandId))
            } else {
                api.delete("/api/follows/${Config.encodePath(brandId)}")
            }
            followedIds = if (result.following) followedIds + brandId else followedIds - brandId
            followerCountCache = followerCountCache + (brandId to result.followers)
            if (!result.following) items = items.filterNot { it.brandId == brandId }
            return result
        } catch (e: Throwable) {
            followedIds = if (wasFollowing) followedIds + brandId else followedIds - brandId
            throw e
        }
    }

    /** GET /api/follows/counts (public): real follower counts for brand ids (max ~100 per call). */
    suspend fun followerCounts(brandIds: List<String>): Map<String, Int> {
        if (brandIds.isEmpty()) return emptyMap()
        val response: FollowCountsResponse = api.get("/api/follows/counts", brandIds.map { "brandIds" to it })
        followerCountCache = followerCountCache + response.counts
        return response.counts
    }

    /** Clears local state (sign-out). */
    fun reset() {
        items = emptyList()
        followedIds = emptySet()
        lastError = null
    }

    companion object {
        fun preview(following: Set<String> = emptySet()): FollowStore {
            val store = FollowStore(APIClient.shared)
            store.followedIds = following
            store.hasLoaded = true
            return store
        }
    }
}
