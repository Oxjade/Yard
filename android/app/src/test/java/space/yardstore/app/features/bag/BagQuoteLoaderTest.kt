package space.yardstore.app.features.bag

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartGroup
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar

/** BagQuoteLoader against GET /api/cart, the bag's shipping total, and the tablet column widths. */
class BagQuoteLoaderTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
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
        server.shutdown()
    }

    @Test fun loadsCartAndQuotesWithQuery() = runTest {
        server.enqueue(MockResponse().setBody(BagFixtures.CART_NG))
        val loader = BagQuoteLoader(api)
        loader.load("NGN", "NG", "Lagos")

        val req = server.takeRequest()
        assertEquals("/api/cart", req.requestUrl?.encodedPath)
        assertEquals("NGN", req.requestUrl?.queryParameter("currency"))
        assertEquals("NG", req.requestUrl?.queryParameter("to"))
        assertEquals("Lagos", req.requestUrl?.queryParameter("city"))

        assertEquals(2, loader.cart?.lines?.size)
        assertEquals("NGN|NG|Lagos", loader.loadedKey)
        assertEquals(450000, loader.quote("brd_acme")?.option(null)?.priceMinor)
        assertTrue(loader.quote("brd_lagos")!!.unavailable)
        assertFalse(loader.isLoading)
        assertNull(loader.error)
    }

    @Test fun omitsEmptyCityAndCapsLongOne() = runTest {
        server.enqueue(MockResponse().setBody(BagFixtures.CART_OK))
        server.enqueue(MockResponse().setBody(BagFixtures.CART_OK))
        val loader = BagQuoteLoader(api)
        loader.load("NGN", "NG", "")
        assertNull(server.takeRequest().requestUrl?.queryParameter("city"))
        loader.load("NGN", "NG", "x".repeat(90))
        assertEquals(60, server.takeRequest().requestUrl?.queryParameter("city")?.length)
    }

    @Test fun keepsLastGoodAnswerOnError() = runTest {
        server.enqueue(MockResponse().setBody(BagFixtures.CART_OK))
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Something went wrong."}}"""))
        val loader = BagQuoteLoader(api)
        loader.load("NGN", "NG", null)
        loader.load("NGN", "GH", null)
        assertNotNull(loader.error)
        assertEquals("NGN|NG|", loader.loadedKey)
        assertNotNull(loader.quote("brd_acme"))
        assertFalse(loader.isLoading)
    }

    @Test fun shippingTotalNeedsEveryBrand() {
        val cart = Cart(
            id = "c",
            currency = "NGN",
            groups = listOf(
                CartGroup(brandId = "a", variantIds = listOf("v1"), subtotalMinor = 100),
                CartGroup(brandId = "b", variantIds = listOf("v2"), subtotalMinor = 200),
            ),
        )
        val paid = BagGroupQuote(brandId = "a", options = listOf(BagQuoteOption(service = "standard", available = true, priceMinor = 500)))
        val free = BagGroupQuote(brandId = "b", options = listOf(BagQuoteOption(service = "standard", available = true, priceMinor = 900, free = true)))
        val off = BagGroupQuote(brandId = "b", unavailable = true)

        assertEquals(500, bagShippingTotal(cart) { mapOf("a" to paid, "b" to free)[it] })
        assertNull(bagShippingTotal(cart) { mapOf("a" to paid)[it] })
        assertNull(bagShippingTotal(cart) { mapOf("a" to paid, "b" to off)[it] })
        assertNull(bagShippingTotal(cart.copy(groups = emptyList())) { paid })
    }

    @Test fun tabletSideColumnsFitTheContent() {
        assertEquals(340.dp, bagSummaryWidth(900.dp))
        assertEquals(380.dp, bagSummaryWidth(1200.dp))
        assertEquals(360.dp, checkoutSideWidth(900.dp))
        assertEquals(400.dp, checkoutSideWidth(1200.dp))
    }
}
