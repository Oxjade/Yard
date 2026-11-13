package space.yardstore.app.features.brands

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BrandsDirectoryModelTest {
    private val t = BrandsTestServer()

    private val firstPage = BrandsJson.brandsPage(
        listOf(
            BrandsJson.brandCard("b1", listOf("streetwear", "unknown-slug")),
            BrandsJson.brandCard("b2", listOf("fashion"), founding = true),
            BrandsJson.brandCard("b3", listOf("streetwear", "jewelry")),
        ),
        total = 40,
        nextOffset = 24,
    )

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        t.start()
        t.json("/api/catalog/brands", firstPage)
    }

    @After fun tearDown() {
        t.shutdown()
        Dispatchers.resetMain()
    }

    @Test fun firstLoadSetsOptionsInWebsiteOrder() = runBlocking {
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        assertTrue(m.hasLoaded)
        assertFalse(m.isLoading)
        assertEquals(3, m.brands.size)
        assertEquals(40, m.total)
        assertEquals(24, m.nextOffset)
        assertEquals(40, m.unfilteredTotal)
        assertEquals(listOf("fashion", "streetwear", "jewelry"), m.categoryOptions)
        assertTrue(m.hasFoundingBrands)
        assertEquals(m.requestKey, m.loadedKey)
        val url = t.requests.single().requestUrl!!
        assertEquals("name", url.queryParameter("sort"))
        assertEquals("24", url.queryParameter("limit"))
        assertEquals("0", url.queryParameter("offset"))
        assertNull(url.queryParameter("q"))
        assertNull(url.queryParameter("founding"))
    }

    @Test fun narrowingSendsFiltersAndKeepsUnfilteredTotals() = runBlocking {
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        t.json("/api/catalog/brands", BrandsJson.brandsPage(listOf(BrandsJson.brandCard("b9", listOf("beauty"))), total = 1, nextOffset = null))
        m.query = "  " + "x".repeat(80) + "  "
        m.category = "beauty"
        m.foundingOnly = true
        m.sort = BrandsDirectoryModel.Sort.New
        assertTrue(m.isNarrowing)
        m.reload()
        val url = t.requests.last().requestUrl!!
        assertEquals("x".repeat(60), url.queryParameter("q"))
        assertEquals("beauty", url.queryParameter("category"))
        assertEquals("1", url.queryParameter("founding"))
        assertEquals("new", url.queryParameter("sort"))
        assertEquals(1, m.total)
        assertEquals(40, m.unfilteredTotal)
        assertEquals(listOf("fashion", "streetwear", "jewelry"), m.categoryOptions)

        m.clearFilters()
        assertFalse(m.isNarrowing)
        assertEquals("||false|new", m.requestKey)
    }

    @Test fun emptyDirectoryIsJoiningState() = runBlocking {
        t.json("/api/catalog/brands", BrandsJson.brandsPage(emptyList(), total = 0, nextOffset = null))
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        assertEquals(0, m.unfilteredTotal)
        assertTrue(m.categoryOptions.isEmpty())
        assertFalse(m.hasFoundingBrands)
    }

    @Test fun errorIsKept() = runBlocking {
        t.json("/api/catalog/brands", """{"error":{"code":"rate_limited","message":"Too many requests. Try again in a minute."}}""", code = 429)
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        assertNotNull(m.loadError)
        assertEquals("Too many requests. Try again in a minute.", m.loadError?.message)
        assertTrue(m.hasLoaded)
        assertFalse(m.isLoading)
        assertNull(m.unfilteredTotal)
    }

    @Test fun loadMoreAppendsAndDedupes() = runBlocking {
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        t.routes["/api/catalog/brands"] = { req ->
            assertEquals("24", req.requestUrl!!.queryParameter("offset"))
            MockResponse().setBody(BrandsJson.brandsPage(listOf(BrandsJson.brandCard("b3", emptyList()), BrandsJson.brandCard("b4", emptyList())), total = 40, nextOffset = null))
        }
        m.loadMore()
        brandsWaitUntil { !m.isLoadingMore }
        assertEquals(listOf("b1", "b2", "b3", "b4"), m.brands.map { it.id })
        assertNull(m.nextOffset)
        assertFalse(m.loadMoreFailed)
    }

    @Test fun loadMoreFailureShowsRetry() = runBlocking {
        val m = BrandsDirectoryModel(t.api)
        m.reload()
        t.json("/api/catalog/brands", """{"error":{"code":"internal","message":"x"}}""", code = 500)
        m.loadMore()
        brandsWaitUntil { !m.isLoadingMore }
        assertTrue(m.loadMoreFailed)
        assertEquals(3, m.brands.size)
    }
}
