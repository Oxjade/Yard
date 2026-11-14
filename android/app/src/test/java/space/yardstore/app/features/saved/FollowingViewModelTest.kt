package space.yardstore.app.features.saved

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.brandCard
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.drop
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.followed
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.product
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.productsPage

@OptIn(ExperimentalCoroutinesApi::class)
class FollowingViewModelTest {
    // Toasts auto-dismiss after 2.6s on Dispatchers.Main. Dismiss them before resetMain() so that
    // timer cannot resume during a later test with no Main dispatcher (the suite's flaky failure).
    private val toasts = mutableListOf<ToastCenter>()
    private fun newToast() = ToastCenter().also { toasts += it }

    private lateinit var backend: SavedFakeBackend

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        backend = SavedFakeBackend()
    }

    @After fun tearDown() {
        toasts.forEach { it.dismiss() }
        backend.shutdown()
        Dispatchers.resetMain()
    }

    /** Waits in real time (runTest's clock is virtual) for work on OkHttp threads. */
    private suspend fun waitUntil(condition: () -> Boolean) = kotlinx.coroutines.withContext(Dispatchers.Default) {
        withTimeout(5_000) { while (!condition()) kotlinx.coroutines.delay(10) }
    }

    private fun follows(vararg items: String) =
        backend.json("GET", "/api/follows", """{"items":[${items.joinToString(",")}]}""")

    /** Products per brand, newest given by publishedAt. */
    private fun productsByBrand(map: Map<String, List<String>>) {
        backend.on("GET", "/api/catalog/products") { r ->
            val brand = r.requestUrl!!.queryParameter("brand")
            MockResponse().setHeader("Content-Type", "application/json")
                .setBody(productsPage(*(map[brand] ?: emptyList()).toTypedArray()))
        }
    }

    private fun drops(live: List<String>, upcoming: List<String>) {
        backend.on("GET", "/api/drops") { r ->
            val list = if (r.requestUrl!!.queryParameter("phase") == "live") live else upcoming
            MockResponse().setHeader("Content-Type", "application/json").setBody("""{"items":[${list.joinToString(",")}],"nextCursor":null}""")
        }
    }

    private fun brands(vararg cards: String) =
        backend.json("GET", "/api/catalog/brands", """{"brands":[${cards.joinToString(",")}],"total":${cards.size},"nextOffset":null}""")

    @Test fun loadBuildsFeedFromFollowedBrands() = runBlocking {
        follows(followed("brd_1", "Acme Studio"), followed("brd_2", "Second Hand"))
        productsByBrand(
            mapOf(
                "brd_1" to listOf(product("p_old", brandId = "brd_1", publishedAt = "2026-10-01T10:00:00.000Z")),
                "brd_2" to listOf(product("p_new", brandId = "brd_2", publishedAt = "2026-11-10T10:00:00.000Z")),
            ),
        )
        drops(
            live = listOf(drop("d_live", "brd_1", "live", "Acme Studio"), drop("d_other", "brd_9", "live")),
            upcoming = listOf(drop("d_soon", "brd_2", "scheduled"), drop("d_live", "brd_1", "live")),
        )
        brands(brandCard("brd_1", "Acme Studio"), brandCard("brd_3", "Third"), brandCard("brd_4", "Fourth"))
        val store = FollowStore(backend.api)
        val model = FollowingViewModel(backend.api)

        model.load(store).join()

        assertEquals(FollowingViewModel.Phase.Loaded, model.phase)
        assertEquals(listOf("brd_1", "brd_2"), model.rows.map { it.brandId })
        assertEquals(listOf("p_new", "p_old"), model.pieces!!.map { it.id })
        assertEquals(listOf("d_live", "d_soon"), model.drops.map { it.id })
        assertEquals(listOf("brd_3", "brd_4"), model.suggestions(store).map { it.id })
        assertEquals(FollowingViewModel.PAGE, model.limit)

        val productCalls = backend.requestsTo("/api/catalog/products").map { it.requestUrl!! }
        assertEquals(setOf("brd_1", "brd_2"), productCalls.map { it.queryParameter("brand") }.toSet())
        assertTrue(productCalls.all { it.queryParameter("sort") == "new" && it.queryParameter("limit") == "6" })
        val dropCalls = backend.requestsTo("/api/drops").map { it.requestUrl!! }
        assertEquals(setOf("live", "upcoming"), dropCalls.map { it.queryParameter("phase") }.toSet())
        assertTrue(dropCalls.all { it.queryParameter("source") == "brands" && it.queryParameter("limit") == "50" })
        val brandCall = backend.requestsTo("/api/catalog/brands").single().requestUrl!!
        assertEquals("new", brandCall.queryParameter("sort"))
        assertEquals("8", brandCall.queryParameter("limit"))
    }

    @Test fun piecesAreFetchedForAtMost24Brands() = runBlocking {
        follows(*(0 until 30).map { followed("brd_$it", "Brand $it") }.toTypedArray())
        productsByBrand(emptyMap())
        drops(emptyList(), emptyList())
        brands()
        val model = FollowingViewModel(backend.api)

        model.load(FollowStore(backend.api)).join()

        assertEquals(30, model.rows.size)
        assertEquals(24, backend.requestsTo("/api/catalog/products").size)
        assertEquals(emptyList<Any>(), model.pieces)
    }

    @Test fun noFollowsShowsEmptyFeedWithSuggestions() = runBlocking {
        follows()
        brands(brandCard("brd_3", "Third"))
        val store = FollowStore(backend.api)
        val model = FollowingViewModel(backend.api)

        model.load(store).join()

        assertEquals(FollowingViewModel.Phase.Loaded, model.phase)
        assertTrue(model.rows.isEmpty())
        assertEquals(emptyList<Any>(), model.pieces)
        assertTrue(model.drops.isEmpty())
        assertTrue(backend.requestsTo("/api/catalog/products").isEmpty())
        assertTrue(backend.requestsTo("/api/drops").isEmpty())
        assertEquals(listOf("brd_3"), model.suggestions(store).map { it.id })
    }

    @Test fun followsErrorFails() = runBlocking {
        backend.on("GET", "/api/follows") { SavedFakeBackend.error(500, "internal", "Something went wrong on our side.") }
        val model = FollowingViewModel(backend.api)

        model.load(FollowStore(backend.api)).join()

        assertEquals(FollowingViewModel.Phase.Failed("Something went wrong on our side."), model.phase)
        assertNull(model.pieces)
    }

    @Test fun feedFailuresDegradeToEmptySections() = runBlocking {
        follows(followed("brd_1", "Acme Studio"))
        backend.on("GET", "/api/catalog/products") { SavedFakeBackend.error(500, "internal", "x") }
        backend.on("GET", "/api/drops") { SavedFakeBackend.error(500, "internal", "x") }
        backend.on("GET", "/api/catalog/brands") { SavedFakeBackend.error(500, "internal", "x") }
        val store = FollowStore(backend.api)
        val model = FollowingViewModel(backend.api)

        model.load(store).join()

        assertEquals(FollowingViewModel.Phase.Loaded, model.phase)
        assertEquals(emptyList<Any>(), model.pieces)
        assertTrue(model.drops.isEmpty())
        assertTrue(model.suggestions(store).isEmpty())
    }

    @Test fun unfollowKeepsRowAndFollowAgainKeepsRows() = runBlocking {
        follows(followed("brd_1", "Acme Studio"), followed("brd_2", "Second Hand"))
        productsByBrand(emptyMap())
        drops(emptyList(), emptyList())
        brands()
        backend.json("DELETE", "/api/follows/brd_1", """{"brandId":"brd_1","following":false,"followers":11}""")
        val store = FollowStore(backend.api)
        val toast = newToast()
        val model = FollowingViewModel(backend.api)
        model.load(store).join()
        var changed = 0

        model.setFollowing(false, "brd_1", "Acme Studio", store, toast) { changed++ }
        waitUntil { model.busyBrandIds.isEmpty() && changed == 1 }

        assertEquals(listOf("brd_1", "brd_2"), model.rows.map { it.brandId })
        assertTrue(!store.isFollowing("brd_1"))
        assertEquals("Unfollowed Acme Studio", toast.current?.message)

        // Following again reloads with keepRows: the row list stays put and gains nothing new.
        follows(followed("brd_1", "Acme Studio"), followed("brd_2", "Second Hand"), followed("brd_5", "Fifth"))
        backend.json("POST", "/api/follows", """{"brandId":"brd_5","following":true,"followers":3}""")
        model.setFollowing(true, "brd_5", "Fifth", store, toast) { changed++ }
        waitUntil { changed == 2 && model.rows.size == 3 }

        assertEquals(listOf("brd_1", "brd_2", "brd_5"), model.rows.map { it.brandId })
        assertEquals("Following Fifth", toast.current?.message)
        assertEquals("""{"brandId":"brd_5"}""", backend.requestsTo("/api/follows").last { it.method == "POST" }.body.readUtf8())
    }

    @Test fun followFailureShowsErrorAndRollsBack() = runBlocking {
        follows()
        brands()
        backend.on("POST", "/api/follows") { SavedFakeBackend.error(429, "rate_limited", "Slow down a little.") }
        val store = FollowStore(backend.api)
        val toast = newToast()
        val model = FollowingViewModel(backend.api)
        model.load(store).join()

        model.setFollowing(true, "brd_3", "Third", store, toast) {}
        waitUntil { model.busyBrandIds.isEmpty() && toast.current != null }

        assertTrue(!store.isFollowing("brd_3"))
        assertEquals("Slow down a little.", toast.current?.message)
    }

    @Test fun brandNameFallsBackToFollowedRow() = runBlocking {
        follows(followed("brd_1", "Acme Studio"))
        productsByBrand(emptyMap())
        drops(emptyList(), emptyList())
        brands()
        val model = FollowingViewModel(backend.api)
        model.load(FollowStore(backend.api)).join()

        assertEquals("Acme Studio", model.brandName(Drop(id = "d1", brand = Drop.BrandRef(id = "brd_1", name = null))))
        assertEquals("Named", model.brandName(Drop(id = "d2", brand = Drop.BrandRef(id = "brd_1", name = "Named"))))
        assertEquals("", model.brandName(Drop(id = "d3", brand = Drop.BrandRef(id = "brd_x"))))
    }

    @Test fun showMoreAddsAPage() {
        val model = FollowingViewModel(SavedFakeBackend().also { it.shutdown() }.api)
        assertEquals(12, model.limit)
        model.showMore()
        assertEquals(24, model.limit)
    }

    @Test fun followStaysBusyUntilTheFeedHasReloaded() = runBlocking {
        follows(followed("brd_1", "Acme Studio"))
        productsByBrand(mapOf("brd_1" to listOf(product("p_1", brandId = "brd_1")), "brd_5" to listOf(product("p_5", brandId = "brd_5"))))
        drops(emptyList(), emptyList())
        brands(brandCard("brd_5", "Fifth"))
        val store = FollowStore(backend.api)
        val toast = newToast()
        val model = FollowingViewModel(backend.api)
        model.load(store).join()
        assertEquals(listOf("p_1"), model.pieces?.map { it.id })

        follows(followed("brd_1", "Acme Studio"), followed("brd_5", "Fifth"))
        backend.json("POST", "/api/follows", """{"brandId":"brd_5","following":true,"followers":3}""")
        model.setFollowing(true, "brd_5", "Fifth", store, toast) {}
        assertTrue("brd_5" in model.busyBrandIds)
        waitUntil { model.busyBrandIds.isEmpty() }

        // iOS awaits the reload before clearing busy, so the new brand's pieces are already in.
        assertEquals(setOf("p_1", "p_5"), model.pieces?.map { it.id }?.toSet())
        assertEquals(listOf("brd_1", "brd_5"), model.rows.map { it.brandId })
    }
}
