package space.yardstore.app.features.search

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * SearchLiveModel and SearchResultsModel against MockWebServer. viewModelScope runs on a
 * single-thread "main" dispatcher; requests go to the real APIClient with the host rewritten.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private lateinit var main: ExecutorCoroutineDispatcher

    @Before fun setUp() {
        main = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        Dispatchers.setMain(main)
        server = MockWebServer()
        server.start()
        val base = APIClient.buildHttpClient(PersistentCookieJar(null))
        val http = base.newBuilder().addInterceptor { chain ->
            val url = chain.request().url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
            chain.proceed(chain.request().newBuilder().url(url).build())
        }.build()
        api = APIClient(http)
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
        main.close()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun waitFor(condition: () -> Boolean) = runBlocking {
        withTimeout(5_000) { while (!condition()) delay(10) }
    }

    private fun take(): RecordedRequest = server.takeRequest(2, TimeUnit.SECONDS)!!

    private fun RecordedRequest.query(name: String): List<String> =
        requestUrl!!.queryParameterValues(name).filterNotNull()

    // region SearchLiveModel

    @Test fun liveCategoriesGiveTriesAndMatches() {
        server.enqueue(json(SearchFixtures.categories))
        val model = SearchLiveModel(api)
        model.loadCategories()
        waitFor { model.categories.isNotEmpty() }
        assertEquals("/api/catalog/categories", take().requestUrl!!.encodedPath)
        // Tries: product counts > 0, most first, at most 6.
        assertEquals(listOf("tops", "hoodies", "hoodie-dresses"), model.tries.map { it.slug })
        // On-device matches: name contains the term, case-insensitive, at most 3.
        assertEquals(listOf("hoodies", "hoodie-dresses"), model.matchingCategories(" HOOD ").map { it.slug })
        assertTrue(model.matchingCategories("  ").isEmpty())
        // Loaded once only.
        model.loadCategories()
        Thread.sleep(100)
        assertEquals(1, server.requestCount)
    }

    @Test fun liveSearchDebouncesAndLoads() {
        server.enqueue(json(SearchFixtures.live))
        val model = SearchLiveModel(api)
        model.update("ho", "USD")
        model.update("hoo", "USD")
        model.update("hood ", "USD")
        waitFor { model.phase == SearchLiveModel.Phase.Loaded }
        assertEquals(1, server.requestCount)
        val req = take()
        assertEquals("/api/search", req.requestUrl!!.encodedPath)
        assertEquals(listOf("hood"), req.query("q"))
        assertEquals(listOf("USD"), req.query("currency"))
        assertEquals(listOf("6"), req.query("limit"))
        assertEquals("hood", model.term)
        assertEquals(1, model.products.size)
        assertEquals("hoodclub", model.brands.single().handle)
        assertEquals(14, model.total)

        // Same term and currency again (e.g. back from a product): no new request.
        model.update("hood", "USD")
        Thread.sleep(400)
        assertEquals(1, server.requestCount)
    }

    @Test fun liveSearchBelowMinimumResets() {
        val model = SearchLiveModel.preview("hood", SearchPreviewData.items, SearchPreviewData.brands, emptyList())
        model.update("h", "USD")
        assertEquals("", model.term)
        assertEquals(SearchLiveModel.Phase.Idle, model.phase)
        assertTrue(model.products.isEmpty())
        assertTrue(model.brands.isEmpty())
        assertEquals(0, model.total)
    }

    @Test fun liveSearchErrorShowsServerMessageAndRetries() {
        server.enqueue(json("""{"error":{"code":"rate_limited","message":"Slow down a little."}}""", 429))
        server.enqueue(json(SearchFixtures.live))
        val model = SearchLiveModel(api)
        model.retry("hood", "USD")
        waitFor { model.phase is SearchLiveModel.Phase.Failed }
        assertEquals(SearchLiveModel.Phase.Failed("Slow down a little."), model.phase)
        assertEquals("hood", model.term)
        model.retry("hood", "USD")
        waitFor { model.phase == SearchLiveModel.Phase.Loaded }
        assertEquals(1, model.products.size)
    }

    // endregion

    // region SearchResultsModel

    @Test fun resultsLoadTwoStepsInSearchOrder() {
        server.enqueue(json(SearchFixtures.searchPage1))
        server.enqueue(json(SearchFixtures.productsAB))
        val model = SearchResultsModel("  hoodie ", api)
        assertEquals("hoodie", model.query)
        assertEquals(SearchResultsModel.Phase.Loading, model.phase)
        model.ensureLoaded("NGN")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }

        val search = take()
        assertEquals("/api/search", search.requestUrl!!.encodedPath)
        assertEquals(listOf("hoodie"), search.query("q"))
        assertEquals(listOf("NGN"), search.query("currency"))
        assertEquals(listOf("24"), search.query("limit"))
        assertEquals(listOf("relevance"), search.query("sort"))
        assertTrue(search.query("category").isEmpty())
        assertTrue(search.query("inStock").isEmpty())
        assertTrue(search.query("cursor").isEmpty())

        val products = take()
        assertEquals("/api/catalog/products", products.requestUrl!!.encodedPath)
        assertEquals(listOf("prd_b", "prd_a"), products.query("ids"))
        assertEquals(listOf("2"), products.query("limit"))

        // Re-ordered to the search's order.
        assertEquals(listOf("prd_b", "prd_a"), model.products.map { it.id })
        assertEquals(31, model.total)
        assertEquals("2", model.nextCursor)
        assertFalse(model.capped)
        assertEquals(20, model.inStockCount)
        assertEquals(listOf("tops", "outerwear"), model.categoryFacets.map { it.value })
        assertEquals("hoodclub", model.brands.single().handle)

        // Same filters/currency (coming back to the screen): no refetch.
        model.ensureLoaded("NGN")
        Thread.sleep(100)
        assertEquals(2, server.requestCount)
    }

    @Test fun resultsLoadMoreAppendsWithoutDuplicates() {
        server.enqueue(json(SearchFixtures.searchPage1))
        server.enqueue(json(SearchFixtures.productsAB))
        server.enqueue(json(SearchFixtures.searchPage2))
        server.enqueue(json(SearchFixtures.productsAC))
        val model = SearchResultsModel("hoodie", api)
        model.ensureLoaded("USD")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }
        take(); take()

        model.loadMore("USD")
        waitFor { !model.isLoadingMore && model.products.size == 3 }
        val page2 = take()
        assertEquals(listOf("2"), page2.query("cursor"))
        take()
        assertEquals(listOf("prd_b", "prd_a", "prd_c"), model.products.map { it.id })
        assertNull(model.nextCursor)
        assertTrue(model.capped)
        assertNull(model.loadMoreError)

        // No cursor left: loadMore does nothing.
        model.loadMore("USD")
        Thread.sleep(100)
        assertEquals(4, server.requestCount)
    }

    @Test fun resultsFiltersAndSortGoToTheQuery() {
        server.enqueue(json(SearchFixtures.searchEmpty))
        val model = SearchResultsModel("hoodie", api)
        model.category = "tops"
        model.inStockOnly = true
        model.sort = SearchSort.PriceDesc
        assertTrue(model.hasFilters)
        model.ensureLoaded("USD")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }
        val req = take()
        assertEquals(listOf("tops"), req.query("category"))
        assertEquals(listOf("1"), req.query("inStock"))
        assertEquals(listOf("price_desc"), req.query("sort"))
        // Empty page: no products request, empty state.
        Thread.sleep(100)
        assertEquals(1, server.requestCount)
        assertTrue(model.products.isEmpty())
        assertEquals(0, model.total)

        model.clearFilters()
        assertFalse(model.hasFilters)
        assertEquals("-|false|PriceDesc|USD", model.reloadKey("USD"))
    }

    @Test fun resultsErrorThenRetry() {
        server.enqueue(json("""{"error":{"code":"internal","message":"Search is having a moment."}}""", 500))
        server.enqueue(json(SearchFixtures.searchEmpty))
        val model = SearchResultsModel("hoodie", api)
        model.ensureLoaded("USD")
        waitFor { model.phase is SearchResultsModel.Phase.Failed }
        assertEquals(SearchResultsModel.Phase.Failed("Search is having a moment."), model.phase)
        // A failed screen reloads when shown again.
        model.ensureLoaded("USD")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }
        assertEquals(2, server.requestCount)
    }

    @Test fun resultsLoadMoreErrorKeepsGrid() {
        server.enqueue(json(SearchFixtures.searchPage1))
        server.enqueue(json(SearchFixtures.productsAB))
        server.enqueue(json("""{"error":{"code":"network","message":"You're offline."}}""", 503))
        val model = SearchResultsModel("hoodie", api)
        model.ensureLoaded("USD")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }
        model.loadMore("USD")
        waitFor { model.loadMoreError != null }
        assertEquals("You're offline.", model.loadMoreError)
        assertEquals(SearchResultsModel.Phase.Loaded, model.phase)
        assertEquals(2, model.products.size)
        assertFalse(model.isLoadingMore)
    }

    @Test fun refreshKeepsContentAndClearsFlag() {
        server.enqueue(json(SearchFixtures.searchPage1))
        server.enqueue(json(SearchFixtures.productsAB))
        server.enqueue(json(SearchFixtures.searchPage1))
        server.enqueue(json(SearchFixtures.productsAB))
        val model = SearchResultsModel("hoodie", api)
        model.ensureLoaded("USD")
        waitFor { model.phase == SearchResultsModel.Phase.Loaded }
        model.load("USD", refreshing = true)
        assertEquals(SearchResultsModel.Phase.Loaded, model.phase)
        waitFor { !model.isRefreshing }
        assertEquals(4, server.requestCount)
        assertEquals(2, model.products.size)
    }

    // endregion
}
