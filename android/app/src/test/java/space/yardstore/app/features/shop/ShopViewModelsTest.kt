package space.yardstore.app.features.shop

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
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
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.util.Collections

@OptIn(ExperimentalCoroutinesApi::class)
class ShopViewModelsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private lateinit var base: String
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())

    /** path prefix → response factory (longest matching prefix wins). */
    private val routes = linkedMapOf<String, (RecordedRequest) -> MockResponse>()

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        ShopCategoryCache.reset()
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                val path = request.path ?: ""
                val match = synchronized(routes) { routes.entries.filter { path.startsWith(it.key) }.maxByOrNull { it.key.length }?.value }
                return match?.invoke(request) ?: MockResponse().setResponseCode(404)
                    .setBody("""{"error":{"code":"not_found","message":"Not found."}}""")
            }
        }
        server.start()
        base = server.url("").toString().trimEnd('/')
        api = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
        ShopCategoryCache.reset()
    }

    private fun route(prefix: String, response: (RecordedRequest) -> MockResponse) {
        synchronized(routes) { routes[prefix] = response }
    }

    private fun productRequests() = requests.filter { it.path!!.startsWith("/api/catalog/products") }

    // MARK: ShopListingModel

    @Test fun listingLoadsFirstPageAndCategories() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        route("/api/catalog/products") { ShopJson.ok(ShopJson.page((1..24).map { "p$it" }, total = 30, nextOffset = 24)) }
        val model = ShopListingModel(null, api, base)
        assertEquals(ShopListingModel.Phase.Loading, model.phase)
        model.start()
        awaitUntil { model.isLoaded && model.categories.isNotEmpty() }
        assertEquals(24, model.products.size)
        assertEquals(30, model.total)
        assertTrue(model.hasMore)
        assertEquals(3, model.categories.size)
        val req = productRequests().first()
        assertEquals("/api/catalog/products?sort=new&limit=24&offset=0", req.path)
    }

    @Test fun listingPaginatesAndStopsAtEnd() {
        route("/api/catalog/products") { r ->
            if (r.path!!.contains("offset=24")) ShopJson.ok(ShopJson.page((24..30).map { "p$it" }, total = 30, nextOffset = null))
            else ShopJson.ok(ShopJson.page((1..24).map { "p$it" }, total = 30, nextOffset = 24))
        }
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        val model = ShopListingModel(null, api, base)
        model.start()
        awaitUntil { model.isLoaded }
        model.loadMore()
        awaitUntil { !model.isLoadingMore && !model.hasMore }
        // p24 came back twice: deduplicated.
        assertEquals(30, model.products.size)
        assertEquals(model.products.map { it.id }.distinct(), model.products.map { it.id })
        val before = productRequests().size
        model.loadMore() // at the end: no request
        Thread.sleep(50)
        assertEquals(before, productRequests().size)
    }

    @Test fun listingCategoryFiltersAndSortGoOnTheQuery() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        route("/api/catalog/products") { ShopJson.ok(ShopJson.page(listOf("p1"), total = 1, nextOffset = null)) }
        val model = ShopListingModel("fashion", api, base)
        model.start()
        awaitUntil { model.isLoaded && model.categories.isNotEmpty() }
        assertEquals("Fashion", model.categoryName)
        assertEquals(listOf("Outerwear", "Shirts"), model.subcategories)
        assertTrue(productRequests().last().path!!.contains("category=fashion"))

        model.selectSubcategory("Outerwear")
        awaitUntil { productRequests().any { it.path!!.contains("subcategory=Outerwear") } && model.isLoaded && !model.isRefreshing }
        model.setInStock(true)
        awaitUntil { productRequests().any { it.path!!.contains("inStock=1") } && !model.isRefreshing }
        assertEquals(1, model.panelFilterCount)
        model.setSort(ShopSort.PriceDesc)
        awaitUntil { !model.isRefreshing && productRequests().last().path!!.contains("sort=price_desc") }
        val last = productRequests().last().path!!
        assertTrue(last.contains("category=fashion") && last.contains("subcategory=Outerwear") && last.contains("inStock=1"))

        // A fixed category can't be changed from the chips.
        model.selectCategory("streetwear")
        assertEquals("fashion", model.category)

        model.clearFilters()
        awaitUntil { !model.isRefreshing && !productRequests().last().path!!.contains("inStock") }
        assertFalse(model.inStock)
        assertNull(model.subcategory)
        assertEquals(ShopSort.PriceDesc, model.sort)
    }

    @Test fun listingWholeShopCategoryChipResetsSubcategory() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        route("/api/catalog/products") { ShopJson.ok(ShopJson.page(listOf("p1"), total = 1, nextOffset = null)) }
        val model = ShopListingModel(null, api, base)
        model.start()
        awaitUntil { model.isLoaded && model.categories.isNotEmpty() }
        model.selectCategory("fashion")
        model.selectSubcategory("Shirts")
        awaitUntil { !model.isRefreshing && productRequests().last().path!!.contains("subcategory=Shirts") }
        model.selectCategory("streetwear")
        assertNull(model.subcategory)
        awaitUntil { !model.isRefreshing && productRequests().last().path!!.contains("category=streetwear") }
        assertFalse(productRequests().last().path!!.contains("subcategory"))
    }

    @Test fun listingEmptyAndErrorStates() {
        route("/api/catalog/categories") { ShopJson.error(500, "internal", "Categories down.") }
        route("/api/catalog/products") { ShopJson.ok("""{"products": [], "total": 0, "nextOffset": null}""") }
        val model = ShopListingModel("sneakers", api, base)
        model.start()
        awaitUntil { model.isLoaded }
        assertTrue(model.products.isEmpty())
        assertEquals(0, model.panelFilterCount)
        // Categories failing is non-fatal; the name comes from the slug.
        assertEquals("Sneakers", model.categoryName)

        route("/api/catalog/products") { ShopJson.error(503, "unavailable", "The shop is resting.") }
        model.reload()
        awaitUntil { model.phase is ShopListingModel.Phase.Failed }
        assertEquals("The shop is resting.", (model.phase as ShopListingModel.Phase.Failed).error.message)
    }

    @Test fun listingLoadMoreErrorKeepsProducts() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        route("/api/catalog/products") { r ->
            if (r.path!!.contains("offset=24")) ShopJson.error(429, "rate_limited", "Slow down a little.")
            else ShopJson.ok(ShopJson.page((1..24).map { "p$it" }, total = 40, nextOffset = 24))
        }
        val model = ShopListingModel(null, api, base)
        model.start()
        awaitUntil { model.isLoaded }
        model.loadMore()
        awaitUntil { model.loadMoreError != null }
        assertEquals("Slow down a little.", model.loadMoreError)
        assertEquals(24, model.products.size)
        assertTrue(model.isLoaded)
    }

    @Test fun categoryCacheServesSecondReadFromMemory() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        kotlinx.coroutines.runBlocking {
            ShopCategoryCache.categories(api = api, baseUrl = base)
            ShopCategoryCache.categories(api = api, baseUrl = base)
            assertEquals(1, requests.count { it.path == "/api/catalog/categories" })
            ShopCategoryCache.categories(force = true, api = api, baseUrl = base)
            assertEquals(2, requests.count { it.path == "/api/catalog/categories" })
        }
        assertEquals(3, ShopCategoryCache.current?.size)
    }

    // MARK: CollectionModel

    @Test fun collectionLoadsInCollectionOrderWithOthers() {
        route("/api/catalog/storefronts/acme/collections/winter-uniform") { ShopJson.ok(ShopJson.collection(listOf("p3", "p1", "gone", "p2"))) }
        route("/api/catalog/storefronts/acme") { ShopJson.ok(ShopJson.storefront) }
        // The server returns its own order (sort=new); the model restores the collection's.
        route("/api/catalog/products") { ShopJson.ok(ShopJson.page(listOf("p1", "p2", "p3"), total = 3, nextOffset = null)) }
        val model = CollectionModel("acme", "winter-uniform", api, base)
        model.load()
        awaitUntil { model.isLoaded }
        assertEquals(listOf("p3", "p1", "p2"), model.products.map { it.id })
        assertEquals("Acme Studio", model.brandName)
        assertEquals(listOf("basics"), model.others.map { it.handle })
        assertTrue(model.brandLogoUrl!!.endsWith("/api/media/med_logo"))
        assertTrue(model.shareUrl.endsWith("/brands/acme/collections/winter-uniform"))
        val q = productRequests().single().path!!
        assertTrue(q.contains("ids=p3&ids=p1&ids=gone&ids=p2"))
        assertTrue(q.contains("limit=60"))

        model.sort = ShopCollectionSort.PriceAsc
        assertEquals(3, model.sortedProducts.size)
    }

    @Test fun collectionChunksIdsBySixty() {
        val ids = (1..130).map { "p$it" }
        route("/api/catalog/storefronts/acme/collections/big") { ShopJson.ok(ShopJson.collection(ids)) }
        route("/api/catalog/storefronts/acme") { ShopJson.ok(ShopJson.storefront) }
        route("/api/catalog/products") { r ->
            val got = r.requestUrl!!.queryParameterValues("ids").filterNotNull()
            ShopJson.ok(ShopJson.page(got, total = got.size, nextOffset = null))
        }
        val model = CollectionModel("acme", "big", api, base)
        model.load()
        awaitUntil { model.isLoaded }
        assertEquals(ids, model.products.map { it.id })
        assertEquals(listOf(60, 60, 10), productRequests().map { it.requestUrl!!.queryParameterValues("ids").size })
    }

    @Test fun collectionNotFoundUsesServerMessage() {
        route("/api/catalog/storefronts/acme/collections/nope") { ShopJson.error(404, "not_found", "That collection isn't available.") }
        route("/api/catalog/storefronts/acme") { ShopJson.ok(ShopJson.storefront) }
        val model = CollectionModel("acme", "nope", api, base)
        model.load()
        awaitUntil { model.phase !is CollectionModel.Phase.Loading }
        assertEquals(CollectionModel.Phase.NotFound("That collection isn't available."), model.phase)
    }

    @Test fun collectionStorefrontFailureIsIgnoredAndOtherErrorsFail() {
        route("/api/catalog/storefronts/acme/collections/winter-uniform") { ShopJson.ok(ShopJson.collection(emptyList())) }
        route("/api/catalog/storefronts/acme") { ShopJson.error(500, "internal", "Storefront down.") }
        val model = CollectionModel("acme", "winter-uniform", api, base)
        model.load()
        awaitUntil { model.isLoaded }
        assertTrue(model.products.isEmpty())
        assertTrue(model.others.isEmpty())
        assertNull(model.brandLogoUrl)
        assertTrue(productRequests().isEmpty()) // no ids → no products call

        route("/api/catalog/storefronts/acme/collections/other") { ShopJson.error(500, "internal", "Something broke.") }
        val failing = CollectionModel("acme", "other", api, base)
        failing.load()
        awaitUntil { failing.phase is CollectionModel.Phase.Failed }
        assertEquals("Something broke.", (failing.phase as CollectionModel.Phase.Failed).error.message)
    }

    // MARK: CategoriesModel

    @Test fun categoriesModelLoadsAndFails() {
        route("/api/catalog/categories") { ShopJson.ok(ShopJson.categories) }
        val model = CategoriesModel(api, base)
        model.load()
        awaitUntil { model.phase == CategoriesModel.Phase.Loaded }
        assertEquals(listOf("fashion", "streetwear", "sneakers"), model.categories.map { it.slug })

        ShopCategoryCache.reset()
        route("/api/catalog/categories") { ShopJson.error(500, "internal", "Categories down.") }
        val failing = CategoriesModel(api, base)
        failing.load()
        awaitUntil { failing.phase is CategoriesModel.Phase.Failed }
        assertEquals("Categories down.", (failing.phase as CategoriesModel.Phase.Failed).error.message)
    }
}
