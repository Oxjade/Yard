package space.yardstore.app.features.bag

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartGroup
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

/**
 * Checkout state: the delivery form (with the website's per-country validation), per-brand
 * shipping choices from the server quote, the payment method, and the payment round trip.
 * Mirrors `CheckoutModel.swift`.
 *
 * Flow (website: checkout-flow.tsx, lib/stores/orders.ts placeCheckout, confirmation-view.tsx):
 *   1. POST /api/checkout with an idempotency key (a retry returns the same checkout).
 *   2. The answer carries the provider's hosted page (`payment.authorizationUrl`): open it in-app
 *      (a Custom Tab). With the stub provider there is no page and nothing is charged: go to the confirmation.
 *   3. While the page is open, poll GET /api/checkout/{id} (and POST …/verify now and then).
 *      When the shopper comes back, verify and poll a little longer.
 *   4. Paid → the order confirmation. Failed / expired / left without paying → say so; nothing charged.
 */
class CheckoutModel(
    quotes: BagQuoteLoader? = null,
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    // region Form

    var name by mutableStateOf("")
    var phone by mutableStateOf("")
    var line1 by mutableStateOf("")
    var line2 by mutableStateOf("")
    var city by mutableStateOf("")
    var region by mutableStateOf("")
    var postcode by mutableStateOf("")
    var country by mutableStateOf(BagMarkets.shipTo)
        private set
    /** brandId → chosen service ("standard" / "express" / "pickup"). */
    var choices by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var method by mutableStateOf(BagPaymentMethod.Card)
    /** Set once Pay was tapped: every field's error shows from then on. */
    var attempted by mutableStateOf(false)
        private set
    /** The server's field errors from the last attempt (form key → message). */
    var serverFieldErrors by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    // endregion

    // region Remote

    val quotes: BagQuoteLoader = quotes ?: BagQuoteLoader(api)
    var options by mutableStateOf<BagCheckoutOptions?>(null)
        private set
    var optionsFailed by mutableStateOf(false)
        private set
    /** The shopper's display currency (CartStore.currency); the checkout may charge in another. */
    var displayCurrency by mutableStateOf("USD")

    // endregion

    // region Payment state

    enum class Phase {
        Idle,
        /** POST /api/checkout in flight. */
        Starting,
        /** The provider's page is open. */
        Paying,
        /** Back from the provider: waiting for its answer. */
        Confirming,
        /** Paid: the view routes to the confirmation. */
        Done,
    }

    var phase by mutableStateOf(Phase.Idle)
        private set
    /** Why the last Pay didn't go through (shown above the Pay pill). */
    var placeError by mutableStateOf<String?>(null)
    /** A neutral note ("You left the payment page…", "Still waiting for…"). */
    var notice by mutableStateOf<String?>(null)
    /** The hosted payment page while it is open. */
    var paymentPage by mutableStateOf<BagPaymentPage?>(null)
        private set
    /** Android: the page id already opened in a Custom Tab (so recomposition never reopens it). */
    var launchedPageId by mutableStateOf<String?>(null)
        private set
    /** Set when the checkout is paid (or charges nothing): the view routes to OrderConfirmationView. */
    var completedCheckoutId by mutableStateOf<String?>(null)
        private set
    /** A checkout still pending after the poll ran out: offer to open its status. */
    var pendingCheckoutId by mutableStateOf<String?>(null)
        private set
    /** Set on a 401: the view presents sign-in. */
    var needsSignIn by mutableStateOf(false)

    private var idempotencyKey: String? = null
    private var keySignature: String? = null
    private var keyMethod: BagPaymentMethod? = null
    private var pollJob: Job? = null
    /** Kept so Done after an automatic close still knows the checkout. */
    private var lastPage: BagPaymentPage? = null

    init {
        CheckoutDraft.load()?.let { draft ->
            name = draft.name
            phone = draft.phone
            line1 = draft.line1
            line2 = draft.line2
            city = draft.city
            region = draft.region
            postcode = draft.postcode
            if (BagMarkets.isSupported(draft.country)) country = draft.country.uppercase()
        }
    }

    // endregion

    // region Derived

    val countryInfo: BagCountry get() = BagMarkets.country(country)
    val provider: String get() = options?.provider ?: "paystack"
    val providerName: String get() = BagMarkets.providerName(provider)
    val optionsReady: Boolean get() = options != null || optionsFailed
    val paymentsClosed: Boolean get() = options?.mode == "off"
    val isStub: Boolean get() = options?.mode == "stub"

    /** Until the options load (or if they fail) only NGN: the live-safe answer, as on the website. */
    val allowedCurrencies: List<String>
        get() {
            val list = options?.currencies
            return if (!list.isNullOrEmpty()) list.map { it.uppercase() } else listOf("NGN")
        }
    val chargeCurrency: String
        get() = BagMarkets.chargeCurrency(displayCurrency, countryInfo, allowedCurrencies)
    val methods: List<BagPaymentMethod>
        get() = BagMarkets.paymentMethods(country, chargeCurrency, provider)
    val effectiveMethod: BagPaymentMethod
        get() {
            val list = methods
            return if (method in list) method else (list.firstOrNull() ?: BagPaymentMethod.Card)
        }

    /** The delivery city for quotes: the address's once typed, else the one saved for the bag. */
    val quoteCity: String?
        get() {
            val c = city.trim()
            return if (c.isEmpty()) BagMarkets.shipToCity else c.take(60)
        }
    val isBusy: Boolean get() = phase == Phase.Starting || phase == Phase.Paying || phase == Phase.Confirming

    /** The cart priced in the charge currency (from the quote read). */
    val cart: Cart? get() = quotes.cart

    fun option(brandId: String): BagQuoteOption? = quotes.quote(brandId)?.option(choices[brandId])

    fun choose(brandId: String, service: String) {
        choices = choices + (brandId to service)
    }

    /** Shipping across brands, or null until every brand has an option. */
    val shippingMinor: Int?
        get() {
            val cart = cart ?: return null
            if (cart.groups.isEmpty()) return null
            var sum = 0
            for (g in cart.groups) {
                val q = quotes.quote(g.brandId) ?: return null
                if (q.unavailable) return null
                val o = q.option(choices[g.brandId]) ?: return null
                sum += if (o.free) 0 else o.priceMinor
            }
            return sum
        }

    val totalMinor: Int?
        get() {
            val cart = cart ?: return null
            val shipping = shippingMinor ?: return null
            return cart.subtotalMinor + shipping
        }

    /** Why Pay can't go yet because of shipping or the cart (the website's shippingBlock). */
    val shippingBlock: String?
        get() {
            val cart = cart ?: return if (quotes.error != null) "Couldn't calculate shipping. Retry to continue." else "Shipping is still being calculated."
            if (cart.lines.any { it.isUnavailable }) {
                return "Some pieces in your bag aren't available any more. Remove them to continue."
            }
            for (g in cart.groups) {
                val q = quotes.quote(g.brandId) ?: return "Shipping isn't ready for every brand yet."
                if (q.unavailable || q.option(choices[g.brandId]) == null) {
                    return "${brandName(g)} doesn't ship to ${countryInfo.name}. Remove its pieces or change the delivery country."
                }
            }
            return null
        }

    fun brandName(group: CartGroup): String {
        cart?.lines(group)?.firstOrNull { !it.brandName.isNullOrEmpty() }?.brandName?.let { return it }
        val q = quotes.quote(group.brandId)
        if (q != null && q.brandName.isNotEmpty()) return q.brandName
        return "This brand"
    }

    /** "Payments here are taken in NGN for now…" when the checkout charges in another currency. */
    val currencyNotice: String?
        get() {
            if (!optionsReady) return null
            val charge = chargeCurrency
            val display = displayCurrency.uppercase()
            if (charge == display) return null
            val chargeable = listOf("NGN", "GHS", "ZAR", "KES", "USD")
            if (display in chargeable) {
                return "Payments here are taken in ${list(allowedCurrencies)} for now, so you'll be charged in $charge. Every price in this checkout is shown in $charge."
            }
            return "$providerName can't charge in $display, so you'll be charged in $charge. Every price in this checkout is shown in $charge."
        }

    private fun list(items: List<String>): String {
        if (items.size <= 1) return items.firstOrNull().orEmpty()
        return items.dropLast(1).joinToString(", ") + " and " + items.last()
    }

    // endregion

    // region Validation (rules.ts validateContact / validateAddress)

    val localErrors: Map<String, String>
        get() {
            val rules = countryInfo
            val e = mutableMapOf<String, String>()
            if (name.trim().length < 2) e["name"] = "Enter your full name."
            val p = phone.trim()
            if (p.isEmpty()) {
                e["phone"] = "Enter a phone number so couriers can reach you."
            } else if (BagMarkets.parsePhone(p, rules) == null) {
                e["phone"] = "Enter a ${rules.name} number, for example ${rules.phoneExample}."
            }
            if (line1.trim().length < 3) e["line1"] = "Enter the street address."
            if (city.trim().length < 2) e["city"] = "Enter the city or town."
            if (rules.regionRequired) {
                val r = region.trim()
                val opts = rules.regionOptions
                val valid = if (opts != null) r in opts else r.length >= 2
                if (!valid) {
                    e["region"] = if (opts != null) "Choose a ${rules.regionLabel.lowercase()}." else "Enter the ${rules.regionLabel.lowercase()}."
                }
            }
            val pc = postcode.trim()
            if (pc.isEmpty()) {
                if (rules.postcodeRequired) e["postcode"] = "Enter the ${rules.postcodeLabel.lowercase()}."
            } else if (!BagMarkets.postcodeMatches(pc, rules)) {
                e["postcode"] = "Check the ${rules.postcodeLabel.lowercase()}, for example ${rules.postcodeExample}."
            }
            return e
        }

    /** The message to show under a field (local rules after the first attempt, else the server's). */
    fun error(key: String): String? {
        if (attempted) localErrors[key]?.let { return it }
        return serverFieldErrors[key]
    }

    fun changeCountry(code: String) {
        if (code == country) return
        country = code
        region = ""
        postcode = ""
        BagMarkets.shipTo = code
    }

    // endregion

    // region Loading

    suspend fun loadOptions() {
        try {
            options = api.get<BagCheckoutOptions>("/api/checkout/options")
            optionsFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return
            optionsFailed = true
        }
    }

    suspend fun loadQuotes() {
        quotes.load(chargeCurrency, country, quoteCity)
    }

    // endregion

    // region Pay

    fun pay() {
        viewModelScope.launch { payNow() }
    }

    private suspend fun payNow() {
        if (isBusy) return
        placeError = null
        notice = null
        pendingCheckoutId = null
        attempted = true
        serverFieldErrors = emptyMap()
        if (localErrors.isNotEmpty()) {
            placeError = "Check the highlighted details."
            return
        }
        if (paymentsClosed) {
            placeError = BagCheckoutOptions.OFF_MESSAGE
            return
        }
        if (!optionsReady) {
            placeError = "Still loading payment options. Try again in a moment."
            return
        }
        shippingBlock?.let {
            placeError = it
            return
        }
        val cart = cart
        val total = totalMinor
        if (cart == null || total == null) {
            placeError = "Shipping isn't ready for every brand yet."
            return
        }
        CheckoutDraft(name, phone, line1, line2, city, region, postcode, country).save()
        BagMarkets.shipToCity = city

        val rules = countryInfo
        val phoneValue = BagMarkets.parsePhone(phone, rules) ?: phone.trim()
        val street = listOf(line1, line2).map { it.trim() }.filter { it.isNotEmpty() }.joinToString(", ")
        val pc = postcode.trim().uppercase()
        val shipTo = BagStartCheckoutBody.ShipTo(
            name = name.trim().take(80),
            line1 = street.take(120),
            city = BagMarkets.cityLine(city, region).take(60),
            postalCode = if (pc.isEmpty()) null else pc.take(20),
            country = country,
            phone = phoneValue.ifEmpty { null },
        )
        val shipping = cart.groups.mapNotNull { g ->
            option(g.brandId)?.let { BagStartCheckoutBody.Choice(brandId = g.brandId, service = it.service) }
        }
        var body = BagStartCheckoutBody(idempotencyKey = "", currency = chargeCurrency, shipTo = shipTo, shipping = shipping)

        // One key per attempt: the same details (and method) reuse it, so a retry returns the same
        // checkout; anything else that changed gets a fresh key (the server would refuse the old one).
        val signature = runCatching { YardJson.encodeToString(BagStartCheckoutBody.serializer(), body) }.getOrNull()
        val chosen = effectiveMethod
        if (idempotencyKey == null || signature != keySignature || keyMethod != chosen) {
            idempotencyKey = UUID.randomUUID().toString().lowercase()
            keySignature = signature
            keyMethod = chosen
        }
        body = body.copy(
            idempotencyKey = idempotencyKey ?: UUID.randomUUID().toString().lowercase(),
            expectedTotalMinor = total,
            paymentMethod = chosen.rawValue,
        )

        phase = Phase.Starting
        try {
            val checkout = api.post<BagCheckout>("/api/checkout", body = body)
            handleStarted(checkout)
        } catch (e: CancellationException) {
            phase = Phase.Idle
            throw e
        } catch (e: APIError) {
            phase = Phase.Idle
            handleStartError(e)
        } catch (e: Exception) {
            phase = Phase.Idle
            placeError = "Your order wasn't placed. Nothing was charged. Try again."
        }
    }

    private fun handleStartError(e: APIError) {
        if (e.isCancelled) return
        if (e.isUnauthorized) {
            placeError = "Sign in again to continue with your order."
            needsSignIn = true
            return
        }
        if (e.isConflict) {
            placeError = e.message
            viewModelScope.launch { loadQuotes() }
            return
        }
        if (e.status == 400 && e.fields.keys.any { it.startsWith("shipping.") }) {
            placeError = "Your cart changed since you last looked. Check it and place your order again."
            viewModelScope.launch { loadQuotes() }
            return
        }
        if (e.status == 0) {
            placeError = "Couldn't reach Yard. Nothing was placed."
            return
        }
        val mapped = mutableMapOf<String, String>()
        for ((k, v) in e.fields) {
            if (!k.startsWith("shipTo.")) continue
            var key = k.removePrefix("shipTo.")
            if (key == "postalCode") key = "postcode"
            mapped[key] = v
        }
        serverFieldErrors = mapped
        placeError = if (e.status == 503) {
            e.message
        } else {
            val m = if (e.message.endsWith(".")) e.message.dropLast(1) else e.message
            "$m. Nothing was placed."
        }
    }

    private fun handleStarted(checkout: BagCheckout) {
        if (checkout.isSettled) {
            finish(checkout.id)
            return
        }
        when (checkout.status) {
            "failed" -> {
                phase = Phase.Idle
                idempotencyKey = null
                placeError = checkout.failureReason ?: "The payment didn't go through. Nothing was charged. Try again."
                return
            }
            "expired" -> {
                phase = Phase.Idle
                idempotencyKey = null
                placeError = "This checkout expired before payment. Nothing was charged. Place your order again."
                return
            }
        }
        val url = checkout.paymentUrl
        if (url != null) {
            phase = Phase.Paying
            launchedPageId = null
            paymentPage = BagPaymentPage(checkout.id, url)
            startPolling(checkout.id, whilePaying = true)
            return
        }
        if (checkout.payment?.stub == true) {
            // Nothing is charged with the stub provider: the confirmation says so.
            notice = checkout.payment.message
            finish(checkout.id)
            return
        }
        phase = Phase.Idle
        placeError = checkout.payment?.message ?: "We couldn't reach the payment provider. Nothing was charged. Try again."
    }

    /** Android: the Custom Tab for [pageId] was opened. */
    fun paymentPageLaunched(pageId: String) {
        launchedPageId = pageId
    }

    /** The shopper came back from the payment page (iOS: tapped Done). */
    fun paymentPageClosed() {
        val page = paymentPage ?: lastPage ?: return
        paymentPage = null
        if (phase != Phase.Paying) return
        phase = Phase.Confirming
        startPolling(page.checkoutId, whilePaying = false)
    }

    private fun startPolling(checkoutId: String, whilePaying: Boolean) {
        pollJob?.cancel()
        paymentPage?.let { lastPage = it }
        pollJob = viewModelScope.launch { poll(checkoutId, whilePaying) }
    }

    private suspend fun poll(checkoutId: String, whilePaying: Boolean) {
        var round = 0
        // While the page is open: every 3 s, asking the provider every 5th round. After it closes:
        // ask right away, then every 2 s for about 30 s.
        val limit = if (whilePaying) Int.MAX_VALUE else 15
        while (round < limit) {
            if (!currentCoroutineIsActive()) return
            val verify = if (whilePaying) round % 5 == 4 else round % 3 == 0
            val checkout = try {
                fetch(checkoutId, verify)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            if (checkout != null) {
                if (!currentCoroutineIsActive()) return
                if (checkout.isSettled) {
                    paymentPage = null
                    finish(checkout.id)
                    return
                }
                if (checkout.status == "failed" || checkout.status == "expired") {
                    paymentPage = null
                    phase = Phase.Idle
                    idempotencyKey = null
                    placeError = if (checkout.status == "expired") {
                        "This checkout expired before payment. Nothing was charged. Place your order again."
                    } else {
                        checkout.failureReason ?: "The payment didn't go through. Nothing was charged. Try again."
                    }
                    return
                }
                if (!whilePaying && checkout.payment?.providerStatus == "abandoned") {
                    phase = Phase.Idle
                    notice = "You left the payment page before paying. Nothing was charged. Tap Pay to go back to it."
                    return
                }
            }
            round += 1
            delay(if (whilePaying) 3_000L else 2_000L)
        }
        if (!currentCoroutineIsActive()) return
        phase = Phase.Idle
        pendingCheckoutId = checkoutId
        notice = "We're still waiting for $providerName to confirm your payment. If you paid, your order updates shortly."
    }

    private suspend fun currentCoroutineIsActive(): Boolean = kotlin.coroutines.coroutineContext.isActive

    private suspend fun fetch(checkoutId: String, verify: Boolean): BagCheckout {
        val path = "/api/checkout/${Config.encodePath(checkoutId)}"
        return if (verify) api.post<BagCheckout>("$path/verify") else api.get<BagCheckout>(path)
    }

    private fun finish(checkoutId: String) {
        pollJob?.cancel()
        pollJob = null
        idempotencyKey = null
        phase = Phase.Done
        completedCheckoutId = checkoutId
    }

    fun cancelPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    override fun onCleared() {
        cancelPolling()
        super.onCleared()
    }

    // endregion
}

/** The delivery details, kept on the device so the next checkout starts filled in. */
@Serializable
data class CheckoutDraft(
    val name: String = "",
    val phone: String = "",
    val line1: String = "",
    val line2: String = "",
    val city: String = "",
    val region: String = "",
    val postcode: String = "",
    val country: String = "NG",
) {
    fun save() {
        val raw = runCatching { YardJson.encodeToString(serializer(), this) }.getOrNull() ?: return
        Config.preferences?.edit()?.putString(KEY, raw)?.apply()
    }

    companion object {
        private const val KEY = "yard.checkout.draft"

        fun load(): CheckoutDraft? {
            val raw = Config.preferences?.getString(KEY, null) ?: return null
            return runCatching { YardJson.decodeFromString(serializer(), raw) }.getOrNull()
        }

        fun clear() {
            Config.preferences?.edit()?.remove(KEY)?.apply()
        }
    }
}
