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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.SavedStore
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.product
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.productsPage
import space.yardstore.app.features.saved.SavedFakeBackend.Companion.wishlistItem

@OptIn(ExperimentalCoroutinesApi::class)
/**
 * Uses runBlocking (not runTest): ToastCenter auto-dismisses after a delay on Main, and runTest's
 * virtual clock would skip that delay while we wait for OkHttp threads in real time.
 */
class SavedViewModelTest {
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

    private fun wishlist(vararg items: String) =
        backend.json("GET", "/api/wishlist", """{"items":[${items.joinToString(",")}]}""")

    @Test fun loadFetchesSavedProductsByIdsAndFlagsMissing() = runBlocking {
        wishlist(
            wishlistItem("prd_a", "2026-11-03T10:00:00.000Z"),
            wishlistItem("prd_b", "2026-11-02T10:00:00.000Z"),
            wishlistItem("prd_gone", "2026-11-01T10:00:00.000Z", listed = false),
        )
        backend.json("GET", "/api/catalog/products", productsPage(product("prd_a"), product("prd_b")))
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)

        model.load(saved).join()

        assertEquals(SavedViewModel.Phase.Loaded, model.phase)
        assertEquals(setOf("prd_a", "prd_b"), model.productsById.keys)
        assertEquals(setOf("prd_gone"), model.missingIds)
        val req = backend.requestsTo("/api/catalog/products").single().requestUrl!!
        assertEquals(listOf("prd_a", "prd_b", "prd_gone"), req.queryParameterValues("ids"))
        assertEquals("3", req.queryParameter("limit"))
        assertEquals(listOf("prd_a", "prd_b"), model.visibleProducts(saved).map { it.id })
        assertEquals(listOf("prd_gone"), model.unlistedItems(saved).map { it.productId })
    }

    @Test fun loadChunksIdsIntoSixties() = runBlocking {
        val items = (0 until 65).map { wishlistItem("prd_$it", "2026-11-01T10:00:${(it % 60).toString().padStart(2, '0')}.000Z") }
        wishlist(*items.toTypedArray())
        backend.on("GET", "/api/catalog/products") { r ->
            val ids = r.requestUrl!!.queryParameterValues("ids").filterNotNull()
            MockResponse().setHeader("Content-Type", "application/json").setBody(productsPage(*ids.map { product(it) }.toTypedArray()))
        }
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)

        model.load(saved).join()

        val calls = backend.requestsTo("/api/catalog/products").map { it.requestUrl!! }
        assertEquals(2, calls.size)
        assertEquals(setOf(60, 5), calls.map { it.queryParameterValues("ids").size }.toSet())
        assertEquals(setOf("60", "5"), calls.map { it.queryParameter("limit") }.toSet())
        assertEquals(65, model.productsById.size)
        assertTrue(model.missingIds.isEmpty())
    }

    @Test fun emptyWishlistIsLoadedWithoutCatalogueCall() = runBlocking {
        wishlist()
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)

        model.load(saved).join()

        assertEquals(SavedViewModel.Phase.Loaded, model.phase)
        assertTrue(model.productsById.isEmpty())
        assertTrue(backend.requestsTo("/api/catalog/products").isEmpty())
        assertTrue(model.visibleProducts(saved).isEmpty())
        assertTrue(model.unlistedItems(saved).isEmpty())
    }

    @Test fun wishlistErrorFails() = runBlocking {
        backend.on("GET", "/api/wishlist") { SavedFakeBackend.error(500, "internal", "Something went wrong on our side.") }
        val model = SavedViewModel(backend.api)

        model.load(SavedStore(backend.api)).join()

        assertEquals(SavedViewModel.Phase.Failed("Something went wrong on our side."), model.phase)
    }

    @Test fun catalogueErrorFailsOnFirstLoad() = runBlocking {
        wishlist(wishlistItem("prd_a", "2026-11-03T10:00:00.000Z"))
        backend.on("GET", "/api/catalog/products") { SavedFakeBackend.error(503, "unavailable", "Try again in a moment.") }
        val model = SavedViewModel(backend.api)

        model.load(SavedStore(backend.api)).join()

        assertEquals(SavedViewModel.Phase.Failed("Try again in a moment."), model.phase)
    }

    @Test fun signedOutWishlistIsEmptyNotAnError() = runBlocking {
        backend.on("GET", "/api/wishlist") { SavedFakeBackend.error(401, "unauthorized", "Sign in first.") }
        val model = SavedViewModel(backend.api)

        model.load(SavedStore(backend.api)).join()

        assertEquals(SavedViewModel.Phase.Loaded, model.phase)
    }

    @Test fun sortOrders() = runBlocking {
        wishlist(
            wishlistItem("prd_cheap", "2026-11-01T10:00:00.000Z"),
            wishlistItem("prd_dear", "2026-11-03T10:00:00.000Z"),
            wishlistItem("prd_mid", "2026-11-02T10:00:00.000Z"),
        )
        backend.json(
            "GET", "/api/catalog/products",
            productsPage(
                product("prd_cheap", brandName = "zulu", priceMinor = 1000),
                product("prd_dear", brandName = "Bravo", priceMinor = 9000, available = 0),
                product("prd_mid", brandName = "alpha", priceMinor = 5000),
            ),
        )
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)
        model.load(saved).join()

        fun order(sort: SavedSort): List<String> {
            model.sort = sort
            return model.visibleProducts(saved).map { it.id }
        }
        assertEquals(listOf("prd_dear", "prd_mid", "prd_cheap"), order(SavedSort.Recent))
        assertEquals(listOf("prd_cheap", "prd_mid", "prd_dear"), order(SavedSort.PriceAsc))
        assertEquals(listOf("prd_dear", "prd_mid", "prd_cheap"), order(SavedSort.PriceDesc))
        assertEquals(listOf("prd_mid", "prd_dear", "prd_cheap"), order(SavedSort.Brand))
        assertEquals(listOf("prd_mid", "prd_cheap", "prd_dear"), order(SavedSort.InStock))
    }

    @Test fun priceSortComparesMajorUnits() = runBlocking {
        // ₦12,000 (1,200,000 kobo) vs $45 (4,500 cents): sorted by major units like iOS (no FX).
        wishlist(wishlistItem("prd_ngn", "2026-11-01T10:00:00.000Z"), wishlistItem("prd_usd", "2026-11-02T10:00:00.000Z"))
        backend.json(
            "GET", "/api/catalog/products",
            productsPage(product("prd_ngn", priceMinor = 1_200_000, currency = "NGN"), product("prd_usd", priceMinor = 4500)),
        )
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)
        model.load(saved).join()
        model.sort = SavedSort.PriceAsc
        assertEquals(listOf("prd_usd", "prd_ngn"), model.visibleProducts(saved).map { it.id })
    }

    @Test fun moveAddsToBagThenUnsaves() = runBlocking {
        wishlist(wishlistItem("prd_a", "2026-11-03T10:00:00.000Z"))
        backend.json("GET", "/api/catalog/products", productsPage(product("prd_a")))
        backend.json("POST", "/api/cart/lines", """{"ok":true}""")
        backend.json("GET", "/api/cart", """{"id":"cart_1","currency":"USD","itemCount":1,"subtotalMinor":4500,"lines":[]}""")
        backend.json("DELETE", "/api/wishlist/prd_a", """{"productId":"prd_a","saved":false,"verdict":"direct"}""")
        val saved = SavedStore(backend.api)
        val cart = CartStore(backend.api)
        val toast = newToast()
        val model = SavedViewModel(backend.api)
        model.load(saved).join()
        val product = model.productsById.getValue("prd_a")
        var moved = 0

        model.move(product, product.variants.single(), cart, saved, toast) { moved++ }
        waitUntil { model.busyIds.isEmpty() && moved == 1 }

        val post = backend.requestsTo("/api/cart/lines").single()
        assertEquals("""{"variantId":"var_prd_a_0","qty":1}""", post.body.readUtf8())
        assertEquals(1, backend.requestsTo("/api/wishlist/prd_a").size)
        assertFalse(saved.isSaved("prd_a"))
        assertTrue(model.visibleProducts(saved).isEmpty())
        assertEquals("Moved to your bag", toast.current?.message)
        assertEquals(Toast.Style.Success, toast.current?.style)
    }

    @Test fun moveFailureKeepsPieceSavedAndShowsServerMessage() = runBlocking {
        wishlist(wishlistItem("prd_a", "2026-11-03T10:00:00.000Z"))
        backend.json("GET", "/api/catalog/products", productsPage(product("prd_a")))
        backend.on("POST", "/api/cart/lines") { SavedFakeBackend.error(409, "conflict", "Only 1 left.") }
        val saved = SavedStore(backend.api)
        val toast = newToast()
        val model = SavedViewModel(backend.api)
        model.load(saved).join()
        val product = model.productsById.getValue("prd_a")
        var moved = 0

        model.move(product, product.variants.single(), CartStore(backend.api), saved, toast) { moved++ }
        waitUntil { toast.current != null && model.busyIds.isEmpty() }

        assertEquals(0, moved)
        assertTrue(saved.isSaved("prd_a"))
        assertTrue(backend.requestsTo("/api/wishlist/prd_a").isEmpty())
        assertEquals("Only 1 left.", toast.current?.message)
        assertEquals(Toast.Style.Error, toast.current?.style)
    }

    @Test fun removeUnsavesUnlistedItem() = runBlocking {
        wishlist(wishlistItem("prd_gone", "2026-11-03T10:00:00.000Z", listed = false, title = null, brandName = null))
        backend.json("GET", "/api/catalog/products", productsPage())
        backend.json("DELETE", "/api/wishlist/prd_gone", """{"productId":"prd_gone","saved":false,"verdict":"direct"}""")
        val saved = SavedStore(backend.api)
        val model = SavedViewModel(backend.api)
        model.load(saved).join()
        assertEquals(1, model.unlistedItems(saved).size)
        assertEquals(null, model.unlistedItems(saved).single().title)

        model.remove("prd_gone", saved, newToast())
        waitUntil { !saved.isSaved("prd_gone") && backend.requestsTo("/api/wishlist/prd_gone").isNotEmpty() }

        assertTrue(model.unlistedItems(saved).isEmpty())
    }

    @Test fun subtitleCopy() {
        assertEquals("Pieces you save from any brand wait here until you're ready.", savedSubtitle(0, 0))
        assertEquals("1 saved piece from 1 brand. Add one to your bag and it moves out of your wishlist.", savedSubtitle(1, 1))
        assertEquals("4 saved pieces from 2 brands. Add one to your bag and it moves out of your wishlist.", savedSubtitle(4, 2))
    }

    @Test fun sortTitlesMatchIOS() {
        assertEquals(
            listOf("Recently saved", "Price, low to high", "Price, high to low", "Brand, A to Z", "In stock first"),
            SavedSort.entries.map { it.title },
        )
    }

    private fun pieceWith(vararg variants: ProductVariant) = Product(id = "prd_v", slug = "prd-v", brandId = "brd_1", title = "Piece", variants = variants.toList())

    @Test fun moveActionAddsTheOnlyInStockVariantDirectly() {
        val only = ProductVariant(id = "v1", label = "One size", available = 3, inStock = true)
        assertEquals(SavedMoveAction.Direct(only), savedMoveAction(pieceWith(only)))
    }

    @Test fun moveActionSaysSoldOutWhenNothingIsInStock() {
        assertEquals(SavedMoveAction.SoldOut, savedMoveAction(pieceWith(ProductVariant(id = "v1", available = 0, inStock = false))))
        assertEquals(
            SavedMoveAction.SoldOut,
            savedMoveAction(pieceWith(ProductVariant(id = "s", available = 0, inStock = true), ProductVariant(id = "m", available = 2, inStock = false))),
        )
    }

    @Test fun moveActionAsksForASizeWhenThereAreSeveralVariants() {
        // Even with only one size left, several variants open the sheet (it pre-selects that size), as on iOS.
        assertEquals(
            SavedMoveAction.PickSize,
            savedMoveAction(pieceWith(ProductVariant(id = "s", available = 2, inStock = true), ProductVariant(id = "m", available = 0, inStock = false))),
        )
    }
}
