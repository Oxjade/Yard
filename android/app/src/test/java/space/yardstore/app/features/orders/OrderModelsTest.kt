package space.yardstore.app.features.orders

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.util.Collections
import java.util.Locale

/**
 * The orders view models and OrdersAPI against MockWebServer. APIClient.shared is pointed at the
 * mock server by rewriting every request's host (paths stay exactly what the app sends).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OrderModelsTest {
    private lateinit var server: MockWebServer
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private var routes: (RecordedRequest) -> MockResponse = { MockResponse().setResponseCode(404) }

    @Before fun setUp() {
        Locale.setDefault(Locale.UK)
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                return routes(request)
            }
        }
        server.start()
        val http = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val original = chain.request()
                val url = original.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
                chain.proceed(original.newBuilder().url(url).build())
            }
            .build()
        APIClient.install(APIClient(http))
    }

    @After fun tearDown() {
        server.shutdown()
        APIClient.install(APIClient(APIClient.buildHttpClient(CookieJar.NO_COOKIES)))
        Dispatchers.resetMain()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun error(code: Int, message: String) = json("""{ "error": { "code": "e", "message": "$message" } }""", code)

    // region OrdersListModel

    @Test fun listLoadsThenPagesWithoutDuplicates() = runTest {
        routes = { r ->
            when {
                r.path == "/api/orders?limit=50" -> json(
                    OrderFixtures.pageJson(
                        OrderFixtures.summaryJson(id = "ord_1"),
                        OrderFixtures.summaryJson(id = "ord_2", reference = "YRD-48213-2", brandName = "Northside", handle = "northside"),
                        nextCursor = "cur_1",
                    ),
                )
                r.path == "/api/orders?limit=50&before=cur_1" -> json(
                    OrderFixtures.pageJson(
                        OrderFixtures.summaryJson(id = "ord_2"),
                        OrderFixtures.summaryJson(id = "ord_3", checkoutId = "chk_old", placedAt = "2026-10-01T10:00:00.000Z"),
                    ),
                )
                else -> MockResponse().setResponseCode(404)
            }
        }
        val model = OrdersListModel()
        assertFalse(model.hasLoaded)
        model.load()
        assertTrue(model.hasLoaded)
        assertFalse(model.isLoading)
        assertNull(model.error)
        assertEquals(listOf("ord_1", "ord_2"), model.items.map { it.id })
        assertEquals("cur_1", model.nextCursor)
        assertEquals(1, model.groups.size) // both brand orders belong to chk_1

        model.loadMore()
        assertEquals(listOf("ord_1", "ord_2", "ord_3"), model.items.map { it.id })
        assertNull(model.nextCursor)
        assertEquals(listOf("chk_1", "chk_old"), model.groups.map { it.id })

        model.loadMore() // no cursor: no request
        assertEquals(2, requests.size)
        assertEquals("1", requests[0].getHeader("X-Yard-Client"))
    }

    @Test fun listEmptyAndErrorStates() = runTest {
        routes = { json(OrderFixtures.pageJson()) }
        val model = OrdersListModel()
        model.load()
        assertTrue(model.hasLoaded)
        assertTrue(model.items.isEmpty())

        routes = { error(500, "Yard is having trouble right now. Try again in a moment.") }
        val failing = OrdersListModel()
        failing.load()
        assertTrue(failing.hasLoaded)
        val e = failing.error as APIError
        assertEquals(500, e.status)
        assertEquals("Yard is having trouble right now. Try again in a moment.", e.message)

        failing.reset()
        assertFalse(failing.hasLoaded)
        assertNull(failing.error)
    }

    @Test fun listLoadMoreFailureKeepsItemsAndCursor() = runTest {
        routes = { r ->
            if (r.path!!.contains("before=")) error(503, "Down") else json(OrderFixtures.pageJson(OrderFixtures.summaryJson(), nextCursor = "cur_1"))
        }
        val model = OrdersListModel()
        model.load()
        model.loadMore()
        assertEquals(1, model.items.size)
        assertEquals("cur_1", model.nextCursor)
        assertFalse(model.isLoadingMore)
    }

    // endregion

    // region OrderConfirmationModel

    private fun confirmationRoutes(checkoutBodies: List<String>, verifyBody: String? = null): (RecordedRequest) -> MockResponse {
        var reads = 0
        return { r ->
            when (r.path) {
                "/api/checkout/chk_1" -> json(checkoutBodies[minOf(reads++, checkoutBodies.size - 1)])
                "/api/checkout/chk_1/verify" -> json(verifyBody ?: checkoutBodies.last())
                "/api/orders/checkouts/chk_1" -> json(
                    OrderFixtures.pageJson(
                        OrderFixtures.summaryJson(id = "ord_1"),
                        OrderFixtures.summaryJson(id = "ord_2", brandName = "Northside", handle = "northside", merchant = "paid", fulfilment = "unfulfilled"),
                    ),
                )
                else -> MockResponse().setResponseCode(404)
            }
        }
    }

    @Test fun confirmationLoadsCheckoutAndBrandOrders() = runTest {
        routes = confirmationRoutes(listOf(OrderFixtures.checkoutJson()))
        val model = OrderConfirmationModel(clock = { testScheduler.currentTime })
        assertTrue(model.isLoading)
        model.load("chk_1")
        assertFalse(model.isLoading)
        assertEquals("YRD-48213", model.checkout?.reference)
        assertEquals(2, model.orders.size)
        assertEquals(6, model.itemCount)
        assertEquals(OrderConfirmationOutcome.Confirmed, model.outcome(model.checkout!!))

        // Already paid: polling ends straight away.
        model.poll("chk_1")
        assertEquals(OrderConfirmationModel.Confirming.Idle, model.confirming)
    }

    @Test fun confirmationPollsUntilPaidAndVerifiesEveryFourthRead() = runTest {
        val pending = OrderFixtures.checkoutJson("pending_payment")
        routes = confirmationRoutes(listOf(pending, pending, pending, pending, pending), verifyBody = OrderFixtures.checkoutJson())
        val model = OrderConfirmationModel(clock = { testScheduler.currentTime })
        model.load("chk_1")
        assertEquals(OrderConfirmationOutcome.Placed, model.outcome(model.checkout!!))
        model.poll("chk_1")
        assertEquals(OrderConfirmationModel.Confirming.Idle, model.confirming)
        assertTrue(model.checkout!!.isPaid)
        val paths = requests.map { it.path }
        assertEquals(1, paths.count { it == "/api/checkout/chk_1/verify" })
        assertEquals("POST", requests.first { it.path == "/api/checkout/chk_1/verify" }.method)
        // 1 initial read + 3 polled reads before the 4th (verify) read.
        assertEquals(4, paths.count { it == "/api/checkout/chk_1" })
        assertEquals(10_000L, testScheduler.currentTime)
    }

    @Test fun confirmationTimesOutAfterAMinute() = runTest {
        val pending = OrderFixtures.checkoutJson("pending_payment")
        routes = confirmationRoutes(listOf(pending))
        val model = OrderConfirmationModel(clock = { testScheduler.currentTime })
        model.load("chk_1")
        model.poll("chk_1")
        assertEquals(OrderConfirmationModel.Confirming.TimedOut, model.confirming)
        assertEquals(60_000L, testScheduler.currentTime)
        assertEquals(24, requests.count { it.path!!.startsWith("/api/checkout/chk_1") } - 1)
    }

    @Test fun confirmationAbandonedAndFailedOutcomes() = runTest {
        routes = confirmationRoutes(listOf(OrderFixtures.checkoutJson("pending_payment", providerStatus = "abandoned", authorizationUrl = "https://checkout.paystack.com/abc")))
        val model = OrderConfirmationModel(clock = { testScheduler.currentTime })
        model.load("chk_1")
        assertEquals(OrderConfirmationOutcome.NotPaid, model.outcome(model.checkout!!))
        assertEquals("https://checkout.paystack.com/abc", model.checkout!!.payment!!.authorizationUrl)
        model.poll("chk_1") // abandoned: no polling
        assertEquals(OrderConfirmationModel.Confirming.Idle, model.confirming)
        assertEquals(OrderConfirmationOutcome.Failed, model.outcome(OrderCheckout(status = "failed")))
    }

    @Test fun confirmationErrorOnlyWhenNothingShown() = runTest {
        routes = { error(404, "We couldn't find that.") }
        val model = OrderConfirmationModel()
        model.load("chk_1")
        assertNull(model.checkout)
        assertTrue((model.error as APIError).isNotFound)
    }

    // endregion

    // region OrderDetailModel + actions

    @Test fun detailLoadsOrderAndBrandCity() = runTest {
        routes = { r ->
            when (r.path) {
                "/api/orders/ord_1" -> json(OrderFixtures.detailJson)
                "/api/catalog/storefronts/acme" -> json("""{ "brand": { "id": "brd_acme", "handle": "acme", "name": "Acme Studio", "city": "Lagos", "country": "NG" }, "storefront": null, "collections": [] }""")
                else -> MockResponse().setResponseCode(404)
            }
        }
        val model = OrderDetailModel()
        model.load("ord_1")
        assertFalse(model.isLoading)
        assertEquals("ord_1", model.order?.id)
        assertEquals("Lagos", model.brandCity)
        assertNotNull(OrderTrackingSnapshot.from(model.order!!, model.brandCity))
    }

    @Test fun detailNotFoundAndMissingStorefront() = runTest {
        routes = { error(404, "Order not found.") }
        val model = OrderDetailModel()
        model.load("ord_missing")
        assertNull(model.order)
        assertTrue((model.error as APIError).isNotFound)
        assertNull(OrdersAPI.brandCity("acme"))
        assertNull(OrdersAPI.brandCity(""))
    }

    @Test fun cancelPostsReasonAndKeyAndReturnsUpdatedOrder() = runTest {
        val cancelled = OrderFixtures.detailJson
            .replace(""""merchant": "shipped", "payment": "paid", "fulfilment": "shipped"""", """"merchant": "cancelled", "payment": "refunded", "fulfilment": "cancelled"""")
        routes = { r -> if (r.path == "/api/orders/ord_1/cancel") json("""{ "duplicate": false, ${cancelled.trim().removePrefix("{")}""") else json(OrderFixtures.detailJson) }
        val model = OrderDetailModel()
        model.load("ord_1")
        model.cancel("ord_1")
        assertFalse(model.isCancelling)
        assertEquals(OrderStatus.Cancelled, model.order?.status)
        val req = requests.first { it.path == "/api/orders/ord_1/cancel" }
        assertEquals("POST", req.method)
        val body = req.body.readUtf8()
        assertTrue(body, body.startsWith("""{"reason":"Cancelled by the shopper","idempotencyKey":"cancel_"""))
    }

    @Test fun cancelFailureSurfacesServerMessage() = runTest {
        routes = { r -> if (r.path == "/api/orders/ord_1/cancel") error(422, "This order has already shipped.") else json(OrderFixtures.detailJson) }
        val model = OrderDetailModel()
        model.load("ord_1")
        try {
            model.cancel("ord_1")
            throw AssertionError("expected an APIError")
        } catch (e: APIError) {
            assertEquals("This order has already shipped.", e.message)
        }
        assertFalse(model.isCancelling)
        assertEquals(OrderStatus.Shipped, model.order?.status)
    }

    @Test fun requestReturnSendsLinesReasonAndNote() = runTest {
        routes = { json(OrderFixtures.detailJson, 201) }
        val updated = OrdersAPI.requestReturn("ord_1", listOf(OrderReturnLineBody("var_2", 1)), OrderReturnReason.Damaged, "Seam split")
        assertEquals("ord_1", updated.id)
        val req = requests.single()
        assertEquals("/api/orders/ord_1/returns", req.path)
        val body = req.body.readUtf8()
        assertTrue(body, body.startsWith("""{"lines":[{"variantId":"var_2","qty":1}],"reason":"damaged","note":"Seam split","idempotencyKey":"return_"""))
    }

    @Test fun pathSegmentsAreEncoded() = runTest {
        routes = { json(OrderFixtures.detailJson) }
        OrdersAPI.detail("ord 1/x")
        assertEquals("/api/orders/ord%201%2Fx", requests.single().path)
    }

    // endregion
}
