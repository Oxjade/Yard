package space.yardstore.app.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.AddCartLineBody
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartLine
import space.yardstore.app.core.models.SetCartLineBody
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import kotlin.coroutines.cancellation.CancellationException

/**
 * The server cart. Mirrors `Core/Stores/CartStore.swift`. Read with `LocalCartStore.current`.
 *
 * Mutations throw [APIError] (show `error.message`, e.g. "Only 2 left.") and reload the cart on
 * success. [count] drives the Bag badge.
 */
class CartStore(private val api: APIClient = APIClient.shared) {
    /** The last cart read; null before the first load. */
    var cart: Cart? by mutableStateOf(null)
        private set
    var isLoading: Boolean by mutableStateOf(false)
        private set
    /** Last load error (mutations throw instead). */
    var lastError: APIError? by mutableStateOf(null)
        private set
    /** Variant ids with a mutation in flight (disable their steppers). */
    var busyVariantIds: Set<String> by mutableStateOf(emptySet())
        private set

    /** Display currency for GET /api/cart (ISO code). Persisted; change with [setCurrency]. */
    var currency: String by mutableStateOf(Config.preferences?.getString(CURRENCY_KEY, null) ?: "USD")
        private set
    /** Optional destination for shipping quotes (`to=` country code). Set by checkout / settings. */
    var destinationCountry: String? by mutableStateOf(null)
    /** Optional destination city (`city=`). */
    var destinationCity: String? by mutableStateOf(null)

    /** Changes the display currency, persists it and reloads the cart. */
    suspend fun setCurrency(code: String) {
        currency = code.uppercase()
        Config.preferences?.edit()?.putString(CURRENCY_KEY, currency)?.apply()
        load()
    }

    /** Units in the bag (badge). */
    val count: Int get() = cart?.itemCount ?: 0
    val isEmpty: Boolean get() = cart?.lines?.isEmpty() ?: true

    /** The line for a variant, if it is in the bag. */
    fun line(variantId: String): CartLine? = cart?.lines?.firstOrNull { it.variantId == variantId }

    /** GET /api/cart. */
    suspend fun load() {
        isLoading = true
        val query = mutableListOf<Pair<String, String?>>("currency" to currency)
        val to = destinationCountry
        if (!to.isNullOrEmpty()) {
            query += "to" to to
            val city = destinationCity
            if (!city.isNullOrEmpty()) query += "city" to city
        }
        try {
            cart = api.get<Cart>("/api/cart", query)
            lastError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (!e.isCancelled) lastError = e
        } catch (e: Exception) {
            lastError = APIError.network(e)
        } finally {
            isLoading = false
        }
    }

    /** POST /api/cart/lines. Adds [qty] to the line (creates it). Throws e.g. 409 "Only 1 left.". */
    suspend fun add(variantId: String, qty: Int = 1) {
        busy(variantId) {
            api.send(HTTPMethod.POST, "/api/cart/lines", body = AddCartLineBody(variantId, qty))
            load()
        }
    }

    /** PATCH /api/cart/lines/{variantId}. 0 removes the line. */
    suspend fun setQuantity(variantId: String, qty: Int) {
        busy(variantId) {
            api.send(HTTPMethod.PATCH, "/api/cart/lines/${Config.encodePath(variantId)}", body = SetCartLineBody(maxOf(0, qty)))
            load()
        }
    }

    /** DELETE /api/cart/lines/{variantId}. */
    suspend fun remove(variantId: String) {
        busy(variantId) {
            api.send(HTTPMethod.DELETE, "/api/cart/lines/${Config.encodePath(variantId)}")
            load()
        }
    }

    /** DELETE /api/cart (empties the bag). */
    suspend fun clear() {
        api.send(HTTPMethod.DELETE, "/api/cart")
        load()
    }

    /** Forget the local copy (e.g. after an order is placed, before reloading). */
    fun reset() {
        cart = null
        lastError = null
    }

    private suspend fun busy(variantId: String, block: suspend () -> Unit) {
        busyVariantIds = busyVariantIds + variantId
        try {
            block()
        } finally {
            busyVariantIds = busyVariantIds - variantId
        }
    }

    companion object {
        const val CURRENCY_KEY = "yard.currency"

        /** Previews only. */
        fun preview(cart: Cart? = null): CartStore {
            val store = CartStore(APIClient.shared)
            store.cart = cart
            return store
        }
    }
}
