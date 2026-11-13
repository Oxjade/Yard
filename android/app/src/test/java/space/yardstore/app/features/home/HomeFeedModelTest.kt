package space.yardstore.app.features.home

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeFeedModelTest {
    private var fake: HomeFakeServer? = null

    @After fun tearDown() {
        fake?.shutdown()
        Dispatchers.resetMain()
    }

    private fun serve(route: (String, (String) -> String?) -> MockResponse) = HomeFakeServer(route).also { fake = it }

    private val tenProducts = (1..10).map { productJson("prd_$it") }

    /** For you with every side module answering. */
    private fun forYouServer(productsResponse: MockResponse = json(productsPage(tenProducts, nextOffset = 24, total = 30))) = serve { path, q ->
        when (path) {
            "/api/catalog/products" -> if (q("offset") == "0") productsResponse
            else json(productsPage(listOf(productJson("prd_10"), productJson("prd_11")), nextOffset = null))
            "/api/catalog/brands" -> if (q("founding") == "1") json(brandsPage(listOf(brandJson("brd_f", founding = true))))
            else json(brandsPage(listOf(brandJson("brd_f", founding = true), brandJson("brd_nocover", cover = false), brandJson("brd_ok"))))
            "/api/drops" -> if (q("phase") == "live") json(dropsPage(listOf(dropJson("drp_live", "live"))))
            else json(dropsPage(listOf(dropJson("drp_live", "live"), dropJson("drp_ended", "ended"))))
            else -> errorJson(404, "Not found")
        }
    }

    @Test fun forYouMixesDropsAndBrandsAfterEveryFifthProduct() = runTest {
        val f = forYouServer()
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        assertEquals(HomeFeedPhase.Idle, model.phase)
        model.refresh(emptyList()).join()

        assertEquals(HomeFeedPhase.Loaded, model.phase)
        assertEquals(
            listOf("p-prd_1", "p-prd_2", "p-prd_3", "p-prd_4", "p-prd_5", "d-drp_live",
                "p-prd_6", "p-prd_7", "p-prd_8", "p-prd_9", "p-prd_10", "b-brd_ok"),
            model.items.map { it.id },
        )
        assertEquals(listOf("brd_f"), model.founding.map { it.id })
        assertTrue(model.hasMore)

        val products = f.requestsTo("/api/catalog/products").single().requestUrl!!
        assertEquals("new", products.queryParameter("sort"))
        assertEquals("24", products.queryParameter("limit"))
        assertEquals("0", products.queryParameter("offset"))
        assertEquals(setOf("live", "upcoming"), f.requestsTo("/api/drops").map { it.requestUrl!!.queryParameter("phase") }.toSet())
        assertTrue(f.requestsTo("/api/drops").all { it.requestUrl!!.queryParameter("limit") == "8" })
    }

    @Test fun sideModulesNeverFailTheFeed() = runTest {
        val f = serve { path, _ ->
            when (path) {
                "/api/catalog/products" -> json(productsPage((1..3).map { productJson("prd_$it") }, nextOffset = null))
                else -> errorJson(500, "Boom")
            }
        }
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.refresh(emptyList()).join()
        assertEquals(HomeFeedPhase.Loaded, model.phase)
        assertEquals(3, model.items.size)
        assertTrue(model.founding.isEmpty())
        assertFalse(model.hasMore)
    }

    @Test fun shortCatalogueStillShowsLiveDrops() = runTest {
        val f = serve { path, q ->
            when (path) {
                "/api/catalog/products" -> json(productsPage(listOf(productJson("prd_1")), nextOffset = null))
                "/api/drops" -> if (q("phase") == "live") json(dropsPage(listOf(dropJson("drp_a", "live"), dropJson("drp_b", "live"), dropJson("drp_c", "live"))))
                else json(dropsPage(emptyList()))
                else -> json(brandsPage(emptyList()))
            }
        }
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.refresh(emptyList()).join()
        assertEquals(listOf("p-prd_1", "d-drp_a", "d-drp_b"), model.items.map { it.id })
    }

    @Test fun productsFailureShowsTheServerMessage() = runTest {
        val f = forYouServer(productsResponse = errorJson(503, "Yard is busy. Try again in a minute."))
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.refresh(emptyList()).join()
        assertEquals(HomeFeedPhase.Failed("Yard is busy. Try again in a minute."), model.phase)
        assertTrue(model.items.isEmpty())
    }

    @Test fun loadMoreAppendsWithoutDuplicatesAndStopsAtTheEnd() = runTest {
        val f = forYouServer()
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.refresh(emptyList()).join()
        val before = model.items.map { it.id }
        model.loadMore()!!.join()

        // prd_10 was already there; only prd_11 is new. The prefix never reshuffles.
        assertEquals(before + "p-prd_11", model.items.map { it.id })
        assertFalse(model.hasMore)
        assertFalse(model.isLoadingMore)
        assertEquals("24", f.requestsTo("/api/catalog/products").last().requestUrl!!.queryParameter("offset"))
        assertNull(model.loadMore())
    }

    @Test fun loadMoreFailureIsRetryable() = runTest {
        var failNext = true
        val f = serve { path, q ->
            when {
                path == "/api/catalog/products" && q("offset") == "0" -> json(productsPage(listOf(productJson("prd_1")), nextOffset = 24))
                path == "/api/catalog/products" -> if (failNext) errorJson(500, "Boom").also { failNext = false } else json(productsPage(listOf(productJson("prd_2")), nextOffset = null))
                else -> json("{}")
            }
        }
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.refresh(emptyList()).join()
        model.loadMore()!!.join()
        assertTrue(model.loadMoreFailed)
        assertEquals(1, model.items.size)
        model.loadMore()!!.join()
        assertFalse(model.loadMoreFailed)
        assertEquals(listOf("p-prd_1", "p-prd_2"), model.items.map { it.id })
    }

    @Test fun categoryTabFiltersByCategoryAndCanBeEmpty() = runTest {
        val f = serve { _, _ -> json(productsPage(emptyList(), nextOffset = null)) }
        val model = HomeFeedModel(HomeTab.Category(HomeCategory("bags", "Bags", 0)), this, f.api)
        model.refresh(emptyList()).join()
        assertEquals(HomeFeedPhase.Loaded, model.phase)
        assertTrue(model.items.isEmpty())
        val url = f.requests.single().requestUrl!!
        assertEquals("/api/catalog/products", url.encodedPath)
        assertEquals("bags", url.queryParameter("category"))
        assertEquals("new", url.queryParameter("sort"))
    }

    @Test fun followingMergesNewestFirstAndRevealsPages() = runTest {
        val f = serve { _, q ->
            when (q("brand")) {
                // 20 older pieces from A, 10 newer from B.
                "brd_a" -> json(productsPage((1..20).map { productJson("a$it", "brd_a", "2026-10-%02dT10:00:00.000Z".format(it)) }, nextOffset = null))
                "brd_b" -> json(productsPage((1..10).map { productJson("b$it", "brd_b", "2026-11-%02dT10:00:00.000Z".format(it)) }, nextOffset = null))
                else -> errorJson(404, "Not found")
            }
        }
        val model = HomeFeedModel(HomeTab.Following, this, f.api)
        model.refresh(listOf("brd_a", "brd_b", "brd_gone")).join()

        assertEquals(HomeFeedPhase.Loaded, model.phase)
        assertEquals(setOf("brd_a", "brd_b", "brd_gone"), model.builtForFollowIds)
        assertEquals(24, model.items.size)
        assertEquals("p-b10", model.items.first().id)
        assertTrue(model.items.all { it is HomeFeedItem.ProductItem })
        assertTrue(model.hasMore)
        assertTrue(f.requests.all { it.requestUrl!!.queryParameter("limit") == "6" && it.requestUrl!!.queryParameter("sort") == "new" })

        assertNull(model.loadMore()) // revealed locally, no request
        assertEquals(30, model.items.size)
        assertEquals("p-a1", model.items.last().id)
        assertFalse(model.hasMore)
    }

    @Test fun followingWithNoFollowsIsEmpty() = runTest {
        val f = serve { _, _ -> errorJson(500, "unused") }
        val model = HomeFeedModel(HomeTab.Following, this, f.api)
        model.refresh(emptyList()).join()
        assertEquals(HomeFeedPhase.Loaded, model.phase)
        assertTrue(model.items.isEmpty())
        assertTrue(f.requests.isEmpty())
    }

    @Test fun loadIfNeededRunsOnce() = runTest {
        val f = forYouServer()
        val model = HomeFeedModel(HomeTab.ForYou, this, f.api)
        model.loadIfNeeded(emptyList())
        model.loadIfNeeded(emptyList())
        testScheduler.advanceUntilIdle()
        while (model.phase != HomeFeedPhase.Loaded) { kotlinx.coroutines.yield(); Thread.sleep(5) }
        model.loadIfNeeded(emptyList())
        assertEquals(1, f.requestsTo("/api/catalog/products").size)
    }

    @Test fun cacheKeepsOneModelPerTab() = runTest {
        val cache = HomeFeedCache(this)
        val a = cache.model(HomeTab.ForYou)
        assertTrue(a === cache.model(HomeTab.ForYou))
        val following = cache.model(HomeTab.Following)
        cache.drop(HomeTab.Following.id)
        assertFalse(following === cache.model(HomeTab.Following))
    }

    @Test fun viewModelLoadsCategoriesAndBadges() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher(testScheduler))
        val f = serve { path, q ->
            when (path) {
                "/api/catalog/categories" -> json("""{"categories": [{"slug": "tops", "name": "Tops", "productCount": 4, "brandCount": 2}]}""")
                "/api/notifications" -> if (q("as") == "shopper") json("""{"items": [{"id": "1", "read": false}, {"id": "2", "read": true}, {"id": "3", "read": false}]}""") else errorJson(400, "Use as=shopper")
                "/api/inbox/unread" -> json("""{"conversations": 4}""")
                else -> errorJson(404, "Not found")
            }
        }
        val vm = HomeViewModel(f.api)
        vm.loadCategories()
        vm.loadBadges(signedIn = true)
        vm.awaitLoads()
        assertEquals(listOf("tops"), vm.categories.map { it.slug })
        assertEquals(2, vm.unreadNotifications)
        assertEquals(4, vm.unreadConversations)

        vm.loadBadges(signedIn = false)
        assertEquals(0, vm.unreadNotifications)
        assertEquals(0, vm.unreadConversations)
    }

    @Test fun viewModelIgnoresCategoryFailure() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher(testScheduler))
        val f = serve { _, _ -> errorJson(500, "Boom") }
        val vm = HomeViewModel(f.api)
        vm.loadCategories()
        vm.loadBadges(signedIn = true)
        vm.awaitLoads()
        assertTrue(vm.categories.isEmpty())
        assertEquals(0, vm.unreadNotifications)
    }
}
