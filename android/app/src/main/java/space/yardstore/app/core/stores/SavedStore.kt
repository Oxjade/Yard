package space.yardstore.app.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.SaveResult
import space.yardstore.app.core.models.WishlistBody
import space.yardstore.app.core.models.WishlistItem
import space.yardstore.app.core.models.WishlistResponse
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import kotlin.coroutines.cancellation.CancellationException

/**
 * The shopper's wishlist ("Saved"). Mirrors `Core/Stores/SavedStore.swift`. Read with `LocalSavedStore.current`.
 *
 * Saving needs a signed-in shopper: check `session.isSignedIn` first and present `Route.SignIn`
 * otherwise. [toggle] updates [savedIds] optimistically and rolls back on failure.
 */
class SavedStore(private val api: APIClient = APIClient.shared) {
    var items: List<WishlistItem> by mutableStateOf(emptyList())
        private set
    var savedIds: Set<String> by mutableStateOf(emptySet())
        private set
    var isLoading: Boolean by mutableStateOf(false)
        private set
    var hasLoaded: Boolean by mutableStateOf(false)
        private set
    var lastError: APIError? by mutableStateOf(null)
        private set

    fun isSaved(productId: String): Boolean = productId in savedIds

    /** GET /api/wishlist. Signed out (401) → empty, no error. */
    suspend fun load() {
        isLoading = true
        try {
            val response: WishlistResponse = api.get("/api/wishlist")
            items = response.items
            savedIds = response.items.map { it.productId }.toSet()
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

    /** Saves or unsaves a product. Returns the new saved state. */
    suspend fun toggle(productId: String): Boolean = setSaved(!isSaved(productId), productId)

    /** POST /api/wishlist or DELETE /api/wishlist/{productId}. Returns the new saved state. */
    suspend fun setSaved(save: Boolean, productId: String): Boolean {
        val wasSaved = isSaved(productId)
        savedIds = if (save) savedIds + productId else savedIds - productId
        try {
            val result: SaveResult = if (save) {
                api.post("/api/wishlist", body = WishlistBody(productId))
            } else {
                api.delete("/api/wishlist/${Config.encodePath(productId)}")
            }
            savedIds = if (result.saved) savedIds + productId else savedIds - productId
            if (!result.saved) items = items.filterNot { it.productId == productId }
            return result.saved
        } catch (e: Throwable) {
            savedIds = if (wasSaved) savedIds + productId else savedIds - productId
            throw e
        }
    }

    /** Clears local state (sign-out). */
    fun reset() {
        items = emptyList()
        savedIds = emptySet()
        lastError = null
    }

    companion object {
        fun preview(saved: Set<String> = emptySet()): SavedStore {
            val store = SavedStore(APIClient.shared)
            store.savedIds = saved
            store.hasLoaded = true
            return store
        }
    }
}
