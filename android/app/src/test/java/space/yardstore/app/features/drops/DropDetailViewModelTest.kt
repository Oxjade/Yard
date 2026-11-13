package space.yardstore.app.features.drops

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient

class DropDetailViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        api = dropsTestClient(server)
        APIClient.install(api)
    }

    @After fun tearDown() = server.shutdown()

    private fun product(id: String) =
        """{"id":"$id","slug":"$id-slug","brandId":"brd_1","title":"Piece $id","priceMinor":4500,"currency":"USD","images":[]}"""

    private val drawDrop = dropJson("drp_draw", 86_400, 172_800, access = "draw", phase = "entries_open", entryOpensIn = -3600, entryClosesIn = 80_000,
        productIds = listOf("prd_b", "prd_a", "prd_missing"), extra = ""","variantIds":["var_1"],"unitsAvailable":12""")

    @Test fun loadsDetailAndProductsInDropOrder() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/the-draw" to json("""{"drop":$drawDrop,"me":{"reminder":true,"following":true,"earlyAccess":false,"entry":null,"canBuy":false,"reason":"Entries are open. Enter the draw for a chance to buy.","claimed":0,"remainingAllowance":1}}"""),
            "GET /api/catalog/products" to json("""{"products":[${product("prd_a")},${product("prd_b")}],"total":2,"nextOffset":null}"""),
        ))
        val model = DropDetailViewModel("the-draw", api = api)
        model.load()
        assertEquals(DropDetailViewModel.LoadState.Loaded, model.state)
        assertEquals("drp_draw", model.drop?.id)
        assertEquals(12, model.drop?.unitsAvailable)
        assertTrue(model.me!!.reminder)
        assertFalse(model.isEntered)
        assertEquals(DropLivePhase.EntriesOpen, model.loadedPhase)
        assertEquals(listOf("prd_b", "prd_a"), model.products.map { it.id })
        assertFalse(model.productsFailed)
        server.takeRequest()
        val productsReq = server.takeRequest()
        assertEquals("/api/catalog/products?ids=prd_b&ids=prd_a&ids=prd_missing&limit=60", productsReq.path)
    }

    @Test fun signedOutHasNoViewerState() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/drp_up" to json("""{"drop":${dropJson("drp_up", 5400, 90_000)}}"""),
        ))
        val model = DropDetailViewModel("drp_up", api = api)
        model.load()
        assertNull(model.me)
        assertTrue(model.products.isEmpty())
        assertEquals(1, server.requestCount)
    }

    @Test fun notFoundShowsError() = runTest {
        server.dispatcher = DropsRoutes(emptyMap())
        val model = DropDetailViewModel("nope", api = api)
        model.load()
        val state = model.state
        assertTrue(state is DropDetailViewModel.LoadState.Failed)
        assertEquals("We couldn't find that drop.", (state as DropDetailViewModel.LoadState.Failed).error.message)
    }

    @Test fun productsFailureIsQuietAndRetried() = runTest {
        var productsOk = false
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/drp_draw" to json("""{"drop":$drawDrop,"me":null}"""),
            "GET /api/catalog/products" to {
                if (productsOk) json("""{"products":[${product("prd_a")}]}""")() else json("""{"error":{"code":"internal","message":"x"}}""", 500)()
            },
        ))
        val model = DropDetailViewModel("drp_draw", api = api)
        model.load()
        assertEquals(DropDetailViewModel.LoadState.Loaded, model.state)
        assertTrue(model.productsFailed)
        productsOk = true
        model.load()
        assertFalse(model.productsFailed)
        assertEquals(listOf("prd_a"), model.products.map { it.id })
    }

    @Test fun enterAndWithdrawTheDraw() = runTest {
        var entered = false
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/drp_draw" to {
                val entry = if (entered) """{"status":"entered","rank":null,"windowOpensAt":null,"windowEndsAt":null,"enteredAt":"2026-11-13T10:00:00.000Z"}""" else "null"
                json("""{"drop":$drawDrop,"me":{"reminder":false,"entry":$entry,"canBuy":false}}""")()
            },
            "GET /api/catalog/products" to json("""{"products":[]}"""),
            "POST /api/drops/drp_draw/entry" to { entered = true; json("""{"entered":true,"status":"entered"}""")() },
            "DELETE /api/drops/drp_draw/entry" to { entered = false; json("""{"entered":false}""")() },
        ))
        val model = DropDetailViewModel("drp_draw", api = api)
        model.load()
        assertFalse(model.isEntered)
        assertEquals("Entered the draw", model.toggleEntry())
        assertTrue(model.isEntered)
        assertEquals("Entry withdrawn", model.toggleEntry())
        assertFalse(model.isEntered)
        assertFalse(model.isWorking)
    }

    @Test fun reminderToggleReloadsViewerState() = runTest {
        var reminder = false
        val up = dropJson("drp_up", 5400, 90_000)
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/drp_up" to { json("""{"drop":$up,"me":{"reminder":$reminder}}""")() },
            "POST /api/drops/drp_up/reminder" to { reminder = true; json("""{"reminder":true}""")() },
            "DELETE /api/drops/drp_up/reminder" to { reminder = false; json("""{"reminder":false}""")() },
        ))
        val model = DropDetailViewModel("drp_up", api = api)
        model.load()
        assertEquals("Reminder set", model.toggleReminder(context = null, permission = null).text)
        assertTrue(model.me!!.reminder)
        assertEquals("Reminder removed", model.toggleReminder(context = null, permission = null).text)
        assertFalse(model.me!!.reminder)
    }
}
