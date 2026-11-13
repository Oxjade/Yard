package space.yardstore.app.features.bag

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.util.Collections

@OptIn(ExperimentalCoroutinesApi::class)
class CheckoutModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private val dispatcher = StandardTestDispatcher()
    private val requests: MutableList<Pair<RecordedRequest, String>> = Collections.synchronizedList(mutableListOf())

    // Route → response; tests replace entries.
    @Volatile private var options = MockResponse().setBody("""{"mode":"live","provider":"paystack","currencies":["NGN"]}""")
    @Volatile private var cart = MockResponse().setBody(BagFixtures.CART_OK)
    @Volatile private var start = MockResponse().setResponseCode(201).setBody(BagFixtures.checkout("pending_payment", "https://checkout.paystack.com/abc123"))
    @Volatile private var get = MockResponse().setBody(BagFixtures.checkout("pending_payment", null))
    @Volatile private var verify = MockResponse().setBody(BagFixtures.checkout("pending_payment", null))

    private val models = mutableListOf<CheckoutModel>()

    @Before fun setUp() {
        Dispatchers.setMain(dispatcher)
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                requests += request to body
                val path = request.path.orEmpty().substringBefore('?')
                return when {
                    path == "/api/checkout/options" -> options
                    path == "/api/cart" -> cart
                    path == "/api/checkout" -> start
                    path.endsWith("/verify") -> verify
                    path.startsWith("/api/checkout/") -> get
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val http = APIClient.buildHttpClient(PersistentCookieJar(null)).newBuilder()
            .addInterceptor { chain ->
                val r = chain.request()
                val url = r.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
                chain.proceed(r.newBuilder().url(url).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() {
        models.forEach { it.cancelPolling() }
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun newModel(): CheckoutModel = CheckoutModel(quotes = BagQuoteLoader(api), api = api).also {
        it.changeCountry("NG")
        it.displayCurrency = "NGN"
        models += it
    }

    private fun CheckoutModel.fillNigeria() {
        name = "Ada Obi"
        phone = "0803 123 4567"
        line1 = "12 Allen Avenue"
        line2 = "Flat 3"
        city = "Ikeja"
        region = "Lagos"
        postcode = ""
    }

    private suspend fun ready(): CheckoutModel {
        val m = newModel()
        m.loadOptions()
        m.loadQuotes()
        m.fillNigeria()
        return m
    }

    /** Lets virtual time and real network I/O both run until [cond] holds. */
    private fun TestScope.waitFor(timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (true) {
            advanceUntilIdle()
            if (cond()) return
            if (System.currentTimeMillis() > end) fail("Timed out waiting")
            Thread.sleep(5)
        }
    }

    private fun bodiesFor(path: String) = synchronized(requests) { requests.filter { it.first.path.orEmpty().substringBefore('?') == path }.map { it.second } }

    @Test fun validationFollowsCountryRules() = runTest(dispatcher) {
        val m = newModel()
        assertEquals(setOf("name", "phone", "line1", "city", "region"), m.localErrors.keys)
        assertNull(m.error("name")) // nothing shows before the first attempt
        m.fillNigeria()
        assertTrue(m.localErrors.isEmpty())
        m.region = "Atlantis"
        assertEquals("Choose a state.", m.localErrors["region"])

        m.changeCountry("GB")
        assertEquals("", m.region)
        m.phone = "07700 900123"
        m.postcode = "12345"
        assertNull(m.localErrors["region"]) // county is optional in the UK
        assertEquals("Check the postcode, for example E8 4DG.", m.localErrors["postcode"])
        m.phone = "0803 123"
        assertEquals("Enter a United Kingdom number, for example 07700 900123.", m.localErrors["phone"])
    }

    @Test fun quotesLoadWithQueryAndTotals() = runTest(dispatcher) {
        val m = ready()
        val req = synchronized(requests) { requests.last { it.first.path.orEmpty().startsWith("/api/cart") }.first }
        assertEquals("NGN", req.requestUrl?.queryParameter("currency"))
        assertEquals("NG", req.requestUrl?.queryParameter("to"))
        assertEquals(2_280_000, m.cart?.subtotalMinor)
        assertEquals(450_000, m.shippingMinor)
        assertEquals(2_730_000, m.totalMinor)
        m.choose("brd_acme", "express")
        assertEquals(3_180_000, m.totalMinor)
        assertNull(m.shippingBlock)
        assertEquals(listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer, BagPaymentMethod.Ussd), m.methods)
    }

    @Test fun unavailableBrandBlocksPay() = runTest(dispatcher) {
        cart = MockResponse().setBody(BagFixtures.CART_NG)
        val m = ready()
        assertEquals("Lagos Uniform doesn't ship to Nigeria. Remove its pieces or change the delivery country.", m.shippingBlock)
        m.pay()
        waitFor { m.placeError != null }
        assertEquals(m.shippingBlock, m.placeError)
        assertTrue(bodiesFor("/api/checkout").isEmpty())
    }

    @Test fun currencyNotice() = runTest(dispatcher) {
        val m = newModel()
        m.loadOptions()
        m.displayCurrency = "USD"
        assertEquals("NGN", m.chargeCurrency)
        assertEquals("Payments here are taken in NGN for now, so you'll be charged in NGN. Every price in this checkout is shown in NGN.", m.currencyNotice)
        m.displayCurrency = "EUR"
        assertEquals("Paystack can't charge in EUR, so you'll be charged in NGN. Every price in this checkout is shown in NGN.", m.currencyNotice)
        m.displayCurrency = "NGN"
        assertNull(m.currencyNotice)
    }

    @Test fun payOpensHostedPageThenVerifiesToConfirmation() = runTest(dispatcher) {
        val m = ready()
        m.method = BagPaymentMethod.BankTransfer
        m.pay()
        waitFor { m.phase == CheckoutModel.Phase.Paying }
        assertEquals("https://checkout.paystack.com/abc123", m.paymentPage?.url)
        assertEquals("chk_01", m.paymentPage?.checkoutId)

        val body = bodiesFor("/api/checkout").single()
        assertTrue(body, body.contains("\"currency\":\"NGN\""))
        assertTrue(body, body.contains("\"line1\":\"12 Allen Avenue, Flat 3\""))
        assertTrue(body, body.contains("\"city\":\"Ikeja, Lagos\""))
        assertTrue(body, body.contains("\"phone\":\"+234 8031234567\""))
        assertTrue(body, body.contains("\"shipping\":[{\"brandId\":\"brd_acme\",\"service\":\"standard\"}]"))
        assertTrue(body, body.contains("\"expectedTotalMinor\":2730000"))
        assertTrue(body, body.contains("\"paymentMethod\":\"bank_transfer\""))
        assertFalse(body, body.contains("postalCode"))

        // Shopper comes back: verify right away → paid.
        verify = MockResponse().setBody(BagFixtures.checkout("paid", null))
        m.paymentPageLaunched(m.paymentPage!!.id)
        m.paymentPageClosed()
        assertEquals(CheckoutModel.Phase.Confirming, m.phase)
        waitFor { m.completedCheckoutId != null }
        assertEquals("chk_01", m.completedCheckoutId)
        assertEquals(CheckoutModel.Phase.Done, m.phase)
        assertNull(m.paymentPage)
        assertTrue(bodiesFor("/api/checkout/chk_01/verify").isNotEmpty())
    }

    @Test fun pollWhilePageOpenSettles() = runTest(dispatcher) {
        val m = ready()
        m.pay()
        waitFor { m.phase == CheckoutModel.Phase.Paying }
        get = MockResponse().setBody(BagFixtures.checkout("paid", null))
        waitFor { m.completedCheckoutId == "chk_01" }
        assertNull(m.paymentPage)
    }

    @Test fun leavingWithoutPayingSaysSo() = runTest(dispatcher) {
        val m = ready()
        m.pay()
        waitFor { m.phase == CheckoutModel.Phase.Paying }
        verify = MockResponse().setBody(BagFixtures.checkout("pending_payment", null, providerStatus = "abandoned"))
        m.paymentPageClosed()
        waitFor { m.phase == CheckoutModel.Phase.Idle }
        assertEquals("You left the payment page before paying. Nothing was charged. Tap Pay to go back to it.", m.notice)
        assertNull(m.completedCheckoutId)
    }

    @Test fun stillPendingAfterPollOffersStatus() = runTest(dispatcher) {
        val m = ready()
        m.pay()
        waitFor { m.phase == CheckoutModel.Phase.Paying }
        m.paymentPageClosed()
        waitFor(timeoutMs = 10_000) { m.phase == CheckoutModel.Phase.Idle }
        assertEquals("chk_01", m.pendingCheckoutId)
        assertEquals("We're still waiting for Paystack to confirm your payment. If you paid, your order updates shortly.", m.notice)
    }

    @Test fun stubCheckoutGoesStraightToConfirmation() = runTest(dispatcher) {
        options = MockResponse().setBody("""{"mode":"stub","provider":"stub","currencies":["NGN"]}""")
        start = MockResponse().setResponseCode(201).setBody(BagFixtures.checkout("pending_payment", null, stub = true, message = "Payments aren't connected. Nothing was charged."))
        val m = ready()
        assertTrue(m.isStub)
        m.pay()
        waitFor { m.completedCheckoutId != null }
        assertEquals("Payments aren't connected. Nothing was charged.", m.notice)
        assertNull(m.paymentPage)
    }

    @Test fun failedStartShowsReason() = runTest(dispatcher) {
        start = MockResponse().setBody(BagFixtures.checkout("failed", null, failureReason = "Card declined. Nothing was charged."))
        val m = ready()
        m.pay()
        waitFor { m.placeError != null }
        assertEquals("Card declined. Nothing was charged.", m.placeError)
        assertEquals(CheckoutModel.Phase.Idle, m.phase)
    }

    @Test fun conflictShowsServerMessageAndRequotes() = runTest(dispatcher) {
        start = MockResponse().setResponseCode(409).setBody("""{"error":{"code":"conflict","message":"Prices changed. Check your bag.","fields":{}}}""")
        val m = ready()
        val cartReads = bodiesFor("/api/cart").size
        m.pay()
        waitFor { m.placeError != null && bodiesFor("/api/cart").size > cartReads }
        assertEquals("Prices changed. Check your bag.", m.placeError)
    }

    @Test fun fieldErrorsMapToFormKeys() = runTest(dispatcher) {
        start = MockResponse().setResponseCode(400).setBody("""{"error":{"code":"validation","message":"Check the delivery details.","fields":{"shipTo.postalCode":"That postcode isn't valid.","shipTo.city":"Too long."}}}""")
        val m = ready()
        m.pay()
        waitFor { m.placeError != null }
        assertEquals("Check the delivery details. Nothing was placed.", m.placeError)
        assertEquals("That postcode isn't valid.", m.error("postcode"))
        assertEquals("Too long.", m.error("city"))
    }

    @Test fun unauthorizedAsksForSignIn() = runTest(dispatcher) {
        start = MockResponse().setResponseCode(401).setBody("""{"error":{"code":"unauthorized","message":"Sign in to continue.","fields":{}}}""")
        val m = ready()
        m.pay()
        waitFor { m.needsSignIn }
        assertEquals("Sign in again to continue with your order.", m.placeError)
    }

    @Test fun retryReusesIdempotencyKeyUntilDetailsChange() = runTest(dispatcher) {
        start = MockResponse().setResponseCode(503).setBody("""{"error":{"code":"unavailable","message":"${BagCheckoutOptions.OFF_MESSAGE}","fields":{}}}""")
        val m = ready()
        m.pay(); waitFor { bodiesFor("/api/checkout").size == 1 && !m.isBusy }
        assertEquals(BagCheckoutOptions.OFF_MESSAGE, m.placeError)
        m.pay(); waitFor { bodiesFor("/api/checkout").size == 2 && !m.isBusy }
        m.line1 = "14 Allen Avenue"
        m.pay(); waitFor { bodiesFor("/api/checkout").size == 3 && !m.isBusy }
        val keys = bodiesFor("/api/checkout").map { Regex("\"idempotencyKey\":\"([^\"]+)\"").find(it)!!.groupValues[1] }
        assertEquals(keys[0], keys[1])
        assertNotEquals(keys[1], keys[2])
    }

    @Test fun paymentsOffNeverPosts() = runTest(dispatcher) {
        options = MockResponse().setBody("""{"mode":"off","provider":"off","currencies":[]}""")
        val m = ready()
        assertTrue(m.paymentsClosed)
        m.pay()
        waitFor { m.placeError != null }
        assertEquals(BagCheckoutOptions.OFF_MESSAGE, m.placeError)
        assertTrue(bodiesFor("/api/checkout").isEmpty())
    }
}
