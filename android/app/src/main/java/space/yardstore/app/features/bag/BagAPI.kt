package space.yardstore.app.features.bag

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import kotlin.coroutines.cancellation.CancellationException

// Bag + checkout endpoints (website: src/app/api/cart, src/app/api/checkout, src/server/payments/checkout.ts).
// Mirrors BagAPI.swift.
//
//   GET  /api/cart?currency=&to=&city=     → the cart, with per-brand shipping quotes (+ arrival estimates)
//   GET  /api/checkout/options             → { mode: off|stub|test|live, provider, currencies }
//   POST /api/checkout                     → BagCheckout (201 new / 200 same idempotency key)
//   GET  /api/checkout/{id}                → BagCheckout
//   POST /api/checkout/{id}/verify         → BagCheckout (asks the provider; payment.providerStatus while pending)

// region Shipping quotes with estimates

/** The shared `ShippingOption` has no arrival estimate; these mirror the server's GroupQuote with it. */
@Serializable
data class BagEstimate(
    val arrivalFrom: String? = null,
    val arrivalTo: String? = null,
) {
    val rangeText: String? get() = BagMarkets.arrivalRange(arrivalFrom, arrivalTo)
}

@Serializable
data class BagQuoteOption(
    /** "standard" | "express" | "pickup". */
    val service: String = "standard",
    val label: String = "Standard",
    val available: Boolean = false,
    val reason: String? = null,
    val priceMinor: Int = 0,
    val currency: String = "USD",
    val free: Boolean = false,
    val estimate: BagEstimate? = null,
) {
    val id: String get() = service

    /** "Est. arrival 11–16 Nov", "Est. ready 11 Nov" (pickup) or null. */
    val arrivalText: String?
        get() {
            if (service == "pickup") {
                val from = estimate?.arrivalFrom
                val day = if (from != null) BagMarkets.arrivalRange(from, from) else null
                return if (day != null) "Est. ready $day" else "Ready once packed"
            }
            val range = estimate?.rangeText ?: return null
            return "Est. arrival $range"
        }
}

@Serializable
data class BagGroupQuote(
    val brandId: String = "",
    val brandName: String = "",
    val unavailable: Boolean = false,
    val reason: String? = null,
    val options: List<BagQuoteOption> = emptyList(),
) {
    /**
     * The option for a chosen service when offered, else standard, else the first non-pickup one
     * (the website's optionFor).
     */
    fun option(service: String?): BagQuoteOption? {
        val available = options.filter { it.available }
        if (service != null) available.firstOrNull { it.service == service }?.let { return it }
        return available.firstOrNull { it.service == "standard" } ?: available.firstOrNull { it.service != "pickup" }
    }
}

/** Only the per-brand quotes of GET /api/cart (decoded from the same body as `Cart`). */
@Serializable
internal data class BagQuoteEnvelope(val groups: List<Group> = emptyList()) {
    @Serializable
    data class Group(val brandId: String = "", val shipping: BagGroupQuote? = null)
}

/**
 * Reads the cart priced for a destination (and currency) with per-brand delivery quotes.
 * The bag uses it next to `CartStore` for estimates; the checkout uses it for everything it shows
 * (lines, subtotal and options in the currency it will charge).
 */
class BagQuoteLoader(private val api: APIClient = APIClient.shared) {
    var cart: Cart? by mutableStateOf(null)
        private set
    /** brandId → quote. */
    var quotes: Map<String, BagGroupQuote> by mutableStateOf(emptyMap())
        private set
    var isLoading: Boolean by mutableStateOf(false)
        private set
    var error: APIError? by mutableStateOf(null)
        private set
    /** The query the current `cart`/`quotes` answer. */
    var loadedKey: String? by mutableStateOf(null)
        private set

    fun quote(brandId: String): BagGroupQuote? = quotes[brandId]

    suspend fun load(currency: String, to: String, city: String?) {
        val key = "$currency|$to|${city.orEmpty()}"
        isLoading = true
        val query = mutableListOf<Pair<String, String?>>("currency" to currency, "to" to to)
        if (!city.isNullOrEmpty()) query += "city" to city.take(60)
        try {
            val raw = api.data(HTTPMethod.GET, "/api/cart", query)
            // Two decodes of the whole cart body: off the main thread.
            val (decodedCart, map) = withContext(Dispatchers.Default) {
                val decoded = api.decode(Cart.serializer(), raw)
                val envelope = api.decode(BagQuoteEnvelope.serializer(), raw)
                val quotes = mutableMapOf<String, BagGroupQuote>()
                for (g in envelope.groups) {
                    g.shipping?.let { quotes[g.brandId] = it }
                }
                decoded to quotes
            }
            cart = decodedCart
            quotes = map
            loadedKey = key
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (!e.isCancelled) error = e
        } catch (e: Exception) {
            error = APIError.network(e)
        } finally {
            isLoading = false
        }
    }

    companion object {
        /** Previews only. */
        fun preview(cart: Cart?, quotes: List<BagGroupQuote>): BagQuoteLoader {
            val l = BagQuoteLoader()
            l.cart = cart
            l.quotes = quotes.associateBy { it.brandId }
            l.loadedKey = "preview"
            return l
        }
    }
}

// endregion

// region Checkout

/** GET /api/checkout/options. */
@Serializable
data class BagCheckoutOptions(
    /** "off" | "stub" | "test" | "live". */
    val mode: String = "live",
    /** "paystack" | "bachs" | "stub" | "off". */
    val provider: String = "paystack",
    val currencies: List<String> = listOf("NGN"),
) {
    companion object {
        /**
         * The server's PAYMENTS_OFF_MESSAGE (src/server/payments/config.ts); POST /api/checkout answers
         * 503 with the same words while payments are off.
         */
        const val OFF_MESSAGE = "Payments open soon. Your cart is saved — you can place your order once payments open."
    }
}

/** The server's CheckoutView (named apart from the `CheckoutView` screen). */
@Serializable
data class BagCheckout(
    val id: String,
    /** "pending_payment" | "paid" | "failed" | "expired" | "review". */
    val status: String = "pending_payment",
    val currency: String = "USD",
    val subtotalMinor: Int = 0,
    val shippingMinor: Int = 0,
    val totalMinor: Int = 0,
    val orderIds: List<String> = emptyList(),
    val failureReason: String? = null,
    val payment: Payment? = null,
) {
    @Serializable
    data class Payment(
        val id: String = "",
        /** "paystack" | "bachs" | "stub". */
        val provider: String = "paystack",
        val status: String = "initialized",
        val authorizationUrl: String? = null,
        /** True for the stub: nothing is charged and the app must say so. */
        val stub: Boolean = false,
        val message: String? = null,
        /** Only on a verify answer while pending: "abandoned" = left the provider's page without paying. */
        val providerStatus: String? = null,
    )

    val isPending: Boolean get() = status == "pending_payment"
    /** Paid, or paid and held for review: either way the orders exist and the confirmation explains. */
    val isSettled: Boolean get() = status == "paid" || status == "review"
    val paymentUrl: String? get() = payment?.authorizationUrl?.takeIf { it.isNotEmpty() }
}

/** POST /api/checkout body (startCheckoutBody, strict: null optionals are left out). */
@Serializable
data class BagStartCheckoutBody(
    val idempotencyKey: String,
    val currency: String,
    val shipTo: ShipTo,
    val shipping: List<Choice>,
    val expectedTotalMinor: Int? = null,
    val paymentMethod: String? = null,
) {
    @Serializable
    data class ShipTo(
        val name: String,
        val line1: String,
        val city: String,
        val postalCode: String? = null,
        val country: String,
        val phone: String? = null,
    )

    @Serializable
    data class Choice(val brandId: String, val service: String)
}

// endregion
