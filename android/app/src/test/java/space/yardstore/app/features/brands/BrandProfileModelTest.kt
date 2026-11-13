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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.FollowResult
import space.yardstore.app.core.stores.FollowStore

@OptIn(ExperimentalCoroutinesApi::class)
class BrandProfileModelTest {
    private val t = BrandsTestServer()
    private lateinit var follows: FollowStore

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        t.start()
        follows = FollowStore(t.api)
        t.json("/api/catalog/storefronts/acme", BrandsJson.storefront())
        t.json("/api/catalog/products", BrandsJson.productsPage(listOf("p1", "p2"), total = 30, nextOffset = 24))
        t.json("/api/drops", BrandsJson.dropsPage(listOf(BrandsJson.drop("d1", "live"), BrandsJson.drop("d2", "draft"), BrandsJson.drop("d3", "scheduled"))))
        t.json("/api/follows/counts", """{"counts": {"brd_1": 1240}}""")
    }

    @After fun tearDown() {
        t.shutdown()
        Dispatchers.resetMain()
    }

    private fun model(handle: String = "acme") = BrandProfileModel(handle, t.api)

    @Test fun loadsStorefrontProductsDropsAndFollowers() = runBlocking {
        val m = model()
        m.load(follows)
        assertEquals(BrandProfileModel.Phase.Loaded, m.phase)
        assertEquals("Acme Studio", m.brand?.name)
        assertEquals("Heavyweight basics cut and sewn in Lagos.", m.story)
        assertEquals(2, m.products.size)
        assertEquals(30, m.productsTotal)
        assertEquals(24, m.productsNextOffset)
        assertEquals(1240, m.followers)
        assertEquals(listOf("d1", "d3"), m.visibleDrops.map { it.id })
        assertEquals(2, m.dropsCount)
        assertEquals(1, m.collections.size)
        assertEquals("https://yardstore.space/api/media/cover1", m.heroUrl)
        assertEquals("Summer drop Friday", m.storefront?.storefront?.config?.announcement?.text)

        val products = t.requestsTo("/api/catalog/products").single().requestUrl!!
        assertEquals("brd_1", products.queryParameter("brand"))
        assertEquals("new", products.queryParameter("sort"))
        assertEquals("24", products.queryParameter("limit"))
        assertEquals("0", products.queryParameter("offset"))
        val drops = t.requestsTo("/api/drops").single().requestUrl!!
        assertEquals("all", drops.queryParameter("phase"))
        assertEquals("brd_1", drops.queryParameter("brandId"))
        assertEquals("50", drops.queryParameter("limit"))
        assertEquals("brd_1", t.requestsTo("/api/follows/counts").single().requestUrl!!.queryParameter("brandIds"))
        assertEquals("1", t.requests.first().getHeader("X-Yard-Client"))
    }

    @Test fun storyFallsBackToIntroThenNull() = runBlocking {
        t.json("/api/catalog/storefronts/acme", BrandsJson.storefront(story = "   "))
        val m = model()
        m.load(follows)
        assertEquals("Basics from Lagos.", m.story)

        t.json("/api/catalog/storefronts/acme", BrandsJson.storefront(story = null, intro = ""))
        val m2 = model()
        m2.load(follows)
        assertNull(m2.story)
    }

    @Test fun heroFallsBackToFirstProductPhoto() = runBlocking {
        t.json("/api/catalog/storefronts/acme", BrandsJson.storefront(coverMediaId = null))
        val m = model()
        m.load(follows)
        assertEquals("https://yardstore.space/api/media/m_p1", m.heroUrl)
    }

    @Test fun notFoundShowsServerMessage() = runBlocking {
        t.json("/api/catalog/storefronts/ghost", """{"error":{"code":"not_found","message":"That brand isn't on Yard."}}""", code = 404)
        val m = model("ghost")
        m.load(follows)
        assertEquals(BrandProfileModel.Phase.NotFound("That brand isn't on Yard."), m.phase)
        assertTrue(t.requestsTo("/api/catalog/products").isEmpty())
    }

    @Test fun serverErrorFails() = runBlocking {
        t.json("/api/catalog/storefronts/acme", """{"error":{"code":"internal","message":"Something went wrong."}}""", code = 500)
        val m = model()
        m.load(follows)
        val phase = m.phase
        assertTrue(phase is BrandProfileModel.Phase.Failed)
        assertEquals("Something went wrong.", (phase as BrandProfileModel.Phase.Failed).message)
    }

    @Test fun refreshFailureKeepsLoadedStorefront() = runBlocking {
        val m = model()
        m.load(follows)
        t.json("/api/catalog/storefronts/acme", """{"error":{"code":"internal","message":"Down."}}""", code = 500)
        m.load(follows)
        assertEquals(BrandProfileModel.Phase.Loaded, m.phase)
        assertEquals("Acme Studio", m.brand?.name)
    }

    @Test fun productErrorIsPerSection() = runBlocking {
        t.json("/api/catalog/products", """{"error":{"code":"rate_limited","message":"Slow down."}}""", code = 429)
        val m = model()
        m.load(follows)
        assertEquals(BrandProfileModel.Phase.Loaded, m.phase)
        assertEquals("Slow down.", m.productsError)
        assertTrue(m.products.isEmpty())
        assertNull(m.productsTotal)
        assertFalse(m.productsLoading)
        assertEquals(2, m.visibleDrops.size)
    }

    @Test fun dropsCountHiddenWhenIncompleteOrFailed() = runBlocking {
        t.json("/api/drops", BrandsJson.dropsPage(listOf(BrandsJson.drop("d1", "live")), nextCursor = "c2"))
        val m = model()
        m.load(follows)
        assertTrue(m.dropsHasMore)
        assertNull(m.dropsCount)

        t.json("/api/drops", """{"error":{"code":"internal","message":"Drops are down."}}""", code = 500)
        val m2 = model()
        m2.load(follows)
        assertEquals("Drops are down.", m2.dropsError)
        assertNull(m2.dropsCount)
    }

    @Test fun dropsOfOtherBrandsAreFilteredOut() = runBlocking {
        t.json("/api/drops", BrandsJson.dropsPage(listOf(BrandsJson.drop("d1", "live"), BrandsJson.drop("x", "live", brandId = "brd_other"))))
        val m = model()
        m.load(follows)
        assertEquals(listOf("d1"), m.drops.map { it.id })
    }

    @Test fun followerCountMissingStaysHidden() = runBlocking {
        t.json("/api/follows/counts", """{"error":{"code":"internal","message":"x"}}""", code = 500)
        val m = model()
        m.load(follows)
        assertNull(m.followers)
        m.apply(FollowResult(brandId = "brd_1", following = true, followers = 7))
        assertEquals(7, m.followers)
    }

    @Test fun loadMoreAppendsWithoutDuplicates() = runBlocking {
        val m = model()
        m.load(follows)
        t.routes["/api/catalog/products"] = { req ->
            assertEquals("24", req.requestUrl!!.queryParameter("offset"))
            MockResponse().setBody(BrandsJson.productsPage(listOf("p2", "p3"), total = 30, nextOffset = null))
        }
        m.loadMoreProducts()
        brandsWaitUntil { !m.productsLoadingMore }
        assertEquals(listOf("p1", "p2", "p3"), m.products.map { it.id })
        assertNull(m.productsNextOffset)
        val before = t.requestsTo("/api/catalog/products").size
        m.loadMoreProducts() // no next offset → no request
        assertEquals(before, t.requestsTo("/api/catalog/products").size)
    }

    @Test fun startLoadsOnce() = runBlocking {
        val m = model()
        m.start(follows)
        brandsWaitUntil { m.phase == BrandProfileModel.Phase.Loaded && m.followers != null && !m.dropsLoading && !m.productsLoading }
        m.start(follows)
        Thread.sleep(100)
        assertEquals(1, t.requestsTo("/api/catalog/storefronts/acme").size)
    }
}
