package space.yardstore.app.features.orders

import kotlinx.coroutines.CancellationException
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.networking.APIClient

/**
 * Every orders endpoint this feature calls (src/app/api/orders/…, src/app/api/checkout/[id]/…).
 * All are shopper-only: a signed-out call is a 401 (`APIError.isUnauthorized`).
 * Mirrors ios/Yard/Features/Orders/OrdersAPI.swift.
 */
object OrdersAPI {
    private val api: APIClient get() = APIClient.shared

    /** GET /api/orders?limit=&before= — the shopper's orders, newest first. */
    suspend fun list(before: String? = null, limit: Int = 50): OrdersPage =
        api.get("/api/orders", listOf("limit" to limit.toString(), "before" to before))

    /** GET /api/orders/{id} — one order with lines, timeline, delivery and allowed actions. */
    suspend fun detail(id: String): OrderDetail =
        api.get<OrderDetailResponse>("/api/orders/${encoded(id)}").order

    /** GET /api/checkout/{id} — the checkout's status, totals and payment. */
    suspend fun checkout(id: String): OrderCheckout =
        api.get("/api/checkout/${encoded(id)}")

    /** POST /api/checkout/{id}/verify — asks the payment provider directly (used while pending). */
    suspend fun verifyCheckout(id: String): OrderCheckout =
        api.post("/api/checkout/${encoded(id)}/verify")

    /** GET /api/orders/checkouts/{checkoutId} — the brand orders one checkout created. */
    suspend fun checkoutOrders(checkoutId: String): List<OrderSummary> =
        api.get<OrdersPage>("/api/orders/checkouts/${encoded(checkoutId)}").items

    /** POST /api/orders/{id}/cancel — before dispatch only. Returns the updated order. */
    suspend fun cancel(id: String): OrderDetail {
        val body = OrderCancelBody(reason = "Cancelled by the shopper", idempotencyKey = OrderText.idempotencyKey("cancel"))
        return api.post<OrderDetailResponse>("/api/orders/${encoded(id)}/cancel", body = body).order
    }

    /** POST /api/orders/{id}/returns — delivered orders inside the return window. Returns the updated order. */
    suspend fun requestReturn(id: String, lines: List<OrderReturnLineBody>, reason: OrderReturnReason, note: String): OrderDetail {
        val body = OrderReturnBody(lines = lines, reason = reason.rawValue, note = note, idempotencyKey = OrderText.idempotencyKey("return"))
        return api.post<OrderDetailResponse>("/api/orders/${encoded(id)}/returns", body = body).order
    }

    /** The brand's city for the tracking route line (public storefront). Null when unavailable. */
    suspend fun brandCity(handle: String): String? {
        if (handle.isEmpty()) return null
        return try {
            val storefront = api.get<PublicStorefront>("/api/catalog/storefronts/${encoded(handle)}")
            OrderText.nonEmpty(storefront.brand.city)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    /** One path segment: like Swift's `.urlPathAllowed` minus "/". */
    private fun encoded(id: String): String = Config.encodePath(id).replace("/", "%2F")
}
