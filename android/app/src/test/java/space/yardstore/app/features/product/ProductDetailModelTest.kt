package space.yardstore.app.features.product

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartLine
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.CartStore
import java.util.Collections

/** ProductDetailModel against MockWebServer with JSON shaped like the website's routes. */
@OptIn(ExperimentalCoroutinesApi::class)
class ProductDetailModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val routes = mutableMapOf<String, MockResponse>()

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val path = request.path.orEmpty()
                val key = routes.keys.sortedByDescending { it.length }.firstOrNull { path.startsWith(it) }
                return key?.let { routes[it] } ?: MockResponse().setResponseCode(404)
                    .setBody("""{"error":{"code":"not_found","message":"We couldn't find that."}}""")
            }
        }
        server.start()
        val base = server.url("/")
        // Send every request (built against the production base URL) to the mock server.
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val r = chain.request()
                val url = r.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
                chain.proceed(r.newBuilder().url(url).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private val productJson = """
        {"product":{"id":"prd_1","slug":"boxy-tee","brandId":"brd_1","title":"Boxy tee","description":"Heavy jersey.",
         "details":["100% cotton"],"category":"tops","subcategory":null,"tags":[],"badges":["new"],
         "priceMinor":4500,"compareAtMinor":6000,"currency":"USD",
         "images":[{"id":"img1","src":"/api/media/m1","alt":"","width":800,"height":1000,"mediaId":"m1"}],
         "options":[{"name":"Colour","values":[{"value":"Black","hex":"#111111"},{"value":"Bone","hex":"#E8E2D4"}]},
                    {"name":"Size","values":[{"value":"S"},{"value":"M"},{"value":"L"}]}],
         "variants":[
           {"id":"v1","sku":"BT-BLK-S","options":{"Colour":"Black","Size":"S"},"label":"Black, S","priceMinor":4500,"available":4,"inStock":true},
           {"id":"v2","sku":"BT-BLK-M","options":{"Colour":"Black","Size":"M"},"label":"Black, M","priceMinor":4800,"available":2,"inStock":true},
           {"id":"v3","sku":"BT-BLK-L","options":{"Colour":"Black","Size":"L"},"label":"Black, L","priceMinor":4500,"available":0,"inStock":false},
           {"id":"v4","sku":"BT-BON-S","options":{"Colour":"Bone","Size":"S"},"label":"Bone, S","priceMinor":4500,"available":0,"inStock":false}],
         "available":6,"processingDays":[2,4],"dropId":null,"collectionIds":[],"publishedAt":"2026-10-01T10:00:00.000Z",
         "createdAt":"2026-09-30T10:00:00.000Z",
         "brand":{"id":"brd_1","handle":"acme","name":"Acme Studio","verified":true,"city":"Lagos","country":"NG","currency":"NGN","foundingBadge":true,"forSale":true,"hasStorefront":true}}}
    """.trimIndent()

    private val estimateJson = """
        {"brand":{"id":"brd_1","name":"Acme Studio","originCity":"Lagos","originCountry":"NG","timeZone":"Africa/Lagos","cutoffLocal":"14:00","workdays":31},
         "handling":[1,2],"destination":{"country":"NG","city":null},
         "options":[
           {"methodId":"m1","service":"standard","label":"Standard","available":true,"price":{"amount":250000,"currency":"NGN"},"free":false,"transit":[2,4],"providerId":"manual","guaranteed":false,
            "estimate":{"basis":"zone","arrivalFrom":"2026-11-18","arrivalTo":"2026-11-21","late":false,"holidaysCrossed":[],"guaranteed":false,"isEstimate":true}},
           {"methodId":"m2","service":"express","label":"Express","available":true,"price":{"amount":500000,"currency":"NGN"},"free":false,"transit":[1,1],"providerId":"manual","guaranteed":false,
            "estimate":{"basis":"zone","arrivalFrom":"2026-11-16","arrivalTo":"2026-11-16","late":false,"holidaysCrossed":[],"guaranteed":false,"isEstimate":true}},
           {"methodId":"m3","service":"pickup","label":"Pickup","available":true,"price":{"amount":0,"currency":"NGN"},"free":true,"transit":[0,0],"providerId":"manual","guaranteed":false}],
         "unavailable":false,"cutoffAt":null,"calendarCountries":["NG"],"providerKind":"manual","computedAt":"2026-11-13T09:00:00.000Z"}
    """.trimIndent()

    private val pageJson = """
        {"products":[
          {"id":"prd_1","slug":"boxy-tee","brandId":"brd_1","title":"Boxy tee","priceMinor":4500,"currency":"USD","available":6},
          {"id":"prd_2","slug":"cargo","brandId":"brd_1","title":"Cargo","priceMinor":9000,"currency":"USD","available":3},
          {"id":"prd_3","slug":"other","brandId":"brd_2","title":"Other tee","priceMinor":3000,"currency":"USD","available":1}],
         "total":3,"nextOffset":null}
    """.trimIndent()

    /** What the server sends for ?brand=brd_1 (only that brand's pieces). */
    private val brandPageJson = """
        {"products":[
          {"id":"prd_1","slug":"boxy-tee","brandId":"brd_1","title":"Boxy tee","priceMinor":4500,"currency":"USD","available":6},
          {"id":"prd_2","slug":"cargo","brandId":"brd_1","title":"Cargo","priceMinor":9000,"currency":"USD","available":3}],
         "total":2,"nextOffset":null}
    """.trimIndent()

    private fun stubAll() {
        routes["/api/catalog/products/boxy-tee"] = json(productJson)
        routes["/api/catalog/products?brand="] = json(brandPageJson)
        routes["/api/catalog/products?"] = json(pageJson)
        routes["/api/shipping/estimate"] = json(estimateJson)
    }

    @Test fun loadsProductRailsAndEstimate() = runTest {
        stubAll()
        val model = ProductDetailModel("boxy-tee", api)
        model.load(destinationCountry = "ng", currency = "NGN")

        assertEquals(ProductDetailModel.Phase.Loaded, model.phase)
        assertEquals("prd_1", model.product?.id)
        // Colour starts on its first value in stock; size unchosen.
        assertEquals(mapOf("Colour" to "Black"), model.selection)
        // Rails: own product removed; similar excludes the same brand.
        assertEquals(listOf("prd_2"), model.moreFromBrand.map { it.id })
        assertEquals(listOf("prd_3"), model.similar.map { it.id })
        assertTrue(model.railsLoaded)
        // Estimate.
        assertEquals("NG", model.estimateCountry)
        assertEquals("standard", model.estimate?.standard?.service)
        assertEquals("express", model.estimate?.express?.service)
        assertFalse(model.estimateFailed)

        val paths = requests.map { it.path.orEmpty() }
        assertTrue(paths.any { it.startsWith("/api/catalog/products?brand=brd_1&sort=new&limit=9") })
        assertTrue(paths.any { it.startsWith("/api/catalog/products?category=tops&sort=new&limit=24") })
        assertTrue(paths.any { it == "/api/shipping/estimate?product=prd_1&to=NG&cur=NGN" })
        requests.forEach { assertEquals("1", it.getHeader("X-Yard-Client")) }
    }

    @Test fun notFoundPhase() = runTest {
        val model = ProductDetailModel("missing", api)
        model.load(null, "USD")
        assertEquals(ProductDetailModel.Phase.NotFound, model.phase)
    }

    @Test fun serverErrorShowsServerMessage() = runTest {
        routes["/api/catalog/products/boxy-tee"] = json("""{"error":{"code":"internal","message":"Something went wrong on our side."}}""", 500)
        val model = ProductDetailModel("boxy-tee", api)
        model.load(null, "USD")
        assertEquals(ProductDetailModel.Phase.Failed("Something went wrong on our side."), model.phase)
    }

    @Test fun estimateFailureIsFlagged() = runTest {
        routes["/api/catalog/products/boxy-tee"] = json(productJson)
        routes["/api/catalog/products?"] = json(pageJson)
        routes["/api/shipping/estimate"] = json("""{"error":{"code":"bad","message":"No."}}""", 400)
        val model = ProductDetailModel("boxy-tee", api)
        model.load("US", "USD")
        assertNull(model.estimate)
        assertTrue(model.estimateFailed)
        assertFalse(model.estimateLoading)
        assertEquals("US", model.estimateCountry)
    }

    @Test fun nonMarketDestinationFallsBack() = runTest {
        stubAll()
        val model = ProductDetailModel("boxy-tee", api)
        model.load("ZZ", "USD")
        assertTrue(model.estimateCountry in ProductDetailModel.MARKETS)
    }

    @Test fun selectionStockAndActions() = runTest {
        stubAll()
        val model = ProductDetailModel("boxy-tee", api)
        model.load("NG", "USD")
        val cart = CartStore.preview()
        val size = model.sizeOption!!

        assertEquals(ProductBuyAction.ChooseSize, model.action(cart))
        assertEquals("2 of 3 sizes in stock" to ProductDetailModel.StockTone.Muted, model.stockLine())
        assertEquals(4, model.stock("S", size))
        assertEquals(0, model.stock("L", size))
        assertEquals(4500, model.priceMinor)

        model.choose("M", size)
        assertEquals("v2", model.variant?.id)
        assertEquals(4800, model.priceMinor)
        assertEquals(ProductBuyAction.Ready, model.action(cart))
        assertEquals("Only 2 left" to ProductDetailModel.StockTone.Low, model.stockLine())
        assertEquals(2, model.maxQuantity(cart))

        // Bone has no M: the size is cleared, and Bone is sold out everywhere.
        model.choose("Bone", model.otherOptions.first())
        assertNull(model.selection["Size"])
        assertEquals(ProductBuyAction.SoldOut, model.action(cart))
        assertEquals("Sold out in bone" to ProductDetailModel.StockTone.Out, model.stockLine())
    }

    @Test fun limitWhenBagHoldsAllStock() = runTest {
        stubAll()
        val model = ProductDetailModel("boxy-tee", api)
        model.load("NG", "USD")
        model.choose("M", model.sizeOption!!)
        val cart = CartStore.preview(Cart(itemCount = 2, lines = listOf(CartLine(variantId = "v2", qty = 2))))
        assertEquals(2, model.inBag(cart))
        assertEquals(0, model.maxQuantity(cart))
        assertEquals(ProductBuyAction.Limit, model.action(cart))
    }

    @Test fun openingBrandReadsAsNotifyMe() {
        val p = YardJson.decodeFromString(space.yardstore.app.core.models.ProductResponse.serializer(), productJson).product
        val opening = p.copy(brand = p.brand!!.copy(forSale = false))
        val model = ProductDetailModel(opening)
        assertEquals(ProductBuyAction.Opening, model.action(CartStore.preview()))
        assertEquals("Opening soon" to ProductDetailModel.StockTone.Muted, model.stockLine())
    }

    @Test fun backInStockToggle() = runTest {
        routes["/api/wishlist/back-in-stock/v3"] = json("""{"variantId":"v3","watching":false}""")
        routes["/api/wishlist/back-in-stock"] = json("""{"variantId":"v3","watching":true}""", 201)
        val model = ProductDetailModel("boxy-tee", api)

        assertTrue(model.toggleWatch("v3"))
        assertTrue(model.isWatching("v3"))
        val post = requests.last()
        assertEquals("POST", post.method)
        assertEquals("/api/wishlist/back-in-stock", post.path)
        assertEquals("""{"variantId":"v3"}""", post.body.readUtf8())

        assertFalse(model.toggleWatch("v3"))
        assertEquals("DELETE", requests.last().method)
        assertEquals("/api/wishlist/back-in-stock/v3", requests.last().path)
        assertFalse(model.watchBusy)
    }

    @Test fun refreshFailureKeepsThePageAndReportsTheMessage() = runTest {
        stubAll()
        val model = ProductDetailModel("boxy-tee", api)
        assertNull(model.load("NG", "USD"))
        routes["/api/catalog/products/boxy-tee"] = json("""{"error":{"code":"internal","message":"Something went wrong on our side."}}""", 500)

        assertEquals("Something went wrong on our side.", model.load("NG", "USD"))
        assertEquals(ProductDetailModel.Phase.Loaded, model.phase)
        assertEquals("prd_1", model.product?.id)
    }

    @Test fun firstLoadFailureGoesToPhaseNotTheReturnValue() = runTest {
        routes["/api/catalog/products/boxy-tee"] = json("""{"error":{"code":"internal","message":"Down."}}""", 500)
        val model = ProductDetailModel("boxy-tee", api)
        assertNull(model.load(null, "USD"))
        assertEquals(ProductDetailModel.Phase.Failed("Down."), model.phase)
    }
}
