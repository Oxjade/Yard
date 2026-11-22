package space.yardstore.app.features.studio

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.YardPreview

private const val BATCH_SESSION_JSON = """
{ "shopper": { "id": "u_1", "name": "Ada", "email": "ada@example.com", "status": "active",
    "brands": [ { "id": "b_1", "handle": "kachi-studio", "name": "Kachi Studio", "initials": "KS", "role": "owner", "status": "approved", "canOpenStudio": true } ] } }
"""

private const val PROPOSALS_JSON = """
{ "items": [
    { "id": "pr_1", "kind": "new", "status": "pending", "title": "Amber room spray", "cover": null, "fields": [], "createdAt": "2026-11-21T09:00:00Z" },
    { "id": "pr_2", "kind": "new", "status": "pending", "title": "Stoneware bowl", "cover": null, "fields": [] },
    { "id": "pr_3", "kind": "edit", "status": "pending", "productId": "p_3", "title": "Linen tote", "fields": ["price", "images"] },
    { "id": "pr_9", "kind": "new", "status": "accepted", "productId": "p_9", "title": "Old one", "fields": [] }
  ], "total": 4, "counts": { "pending": 3, "accepted": 1, "declined": 0, "withdrawn": 0, "superseded": 0 }, "nextOffset": null }
"""

/** Batch endpoints against a fake server: bodies, action-key reuse on a retry, skipped reasons. */
class StudioBatchRequestTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    /** path → bodies, in order. */
    private val bodies = mutableMapOf<String, MutableList<String>>()
    /** Fail the next N batch calls with a 503 (a dropped connection, as the app sees it). */
    @Volatile private var failNext = 0
    private var acceptAnswer = """{"accepted":["pr_2"],"skipped":[{"id":"pr_1","reason":"A product with this SKU already exists."}]}"""

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath
                if (request.method == "POST") bodies.getOrPut(path) { mutableListOf() } += request.body.readUtf8()
                val batch = path.endsWith("/accept-all") || path.endsWith("/decline-all") || path.endsWith("/add-all")
                if (batch && failNext > 0) {
                    failNext -= 1
                    return json("""{"error":{"code":"unavailable","message":"Yard is busy. Try again."}}""", 503)
                }
                return when (path) {
                    "/api/session" -> json(BATCH_SESSION_JSON)
                    "/api/studio/session/switch" -> json("""{"actor":"brand","profile":{"userId":"u_1","name":"Ada","brand":{"id":"b_1","handle":"kachi-studio","name":"Kachi Studio"},"role":"owner","permissions":["content.publish"]}}""")
                    "/api/studio/proposals" -> json(PROPOSALS_JSON)
                    "/api/studio/proposals/accept-all" -> json(acceptAnswer)
                    "/api/studio/proposals/decline-all" -> json("""{"accepted":["pr_1","pr_2","pr_3"],"skipped":[]}""")
                    "/api/studio/catalog/website-pieces/add-all" -> json(
                        """{"items":[{"id":"sp_2","title":"Holder","status":"waiting","error":"Photos couldn't be copied."}],"count":1,"mayAdd":true,"site":"kachi.com","currency":"NGN",
                           "accepted":["sp_1"],"skipped":[{"id":"sp_2","reason":"Photos couldn't be copied."}]}""",
                    )
                    else -> json("""{"error":{"code":"not_found","message":"Not found."}}""", 404)
                }
            }
        }
        server.start()
        val base = server.url("/")
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                chain.proceed(original.newBuilder().url(original.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun store(): StudioStore = runBlocking {
        val session = SessionStore(api)
        session.refresh()
        StudioStore(api, session, StudioPrefs { null }).also { it.sessionChanged() }
    }

    private fun body(path: String, i: Int = 0): JsonObject = Json.parseToJsonElement(bodies.getValue(path)[i]).jsonObject

    @Test fun acceptAllSendsNoIdsAndAKey() = runBlocking {
        store().acceptProposals(null, "key_accept_all_1")
        val b = body("/api/studio/proposals/accept-all")
        assertFalse("ids is omitted for Accept all", "ids" in b)
        assertEquals("key_accept_all_1", b["idempotencyKey"]!!.jsonPrimitive.content)
    }

    @Test fun selectedAndDeclineAndAddAllBodies() = runBlocking {
        val s = store()
        s.acceptProposals(listOf("pr_1", "pr_3"), "key_selected_01")
        assertEquals(listOf("pr_1", "pr_3"), body("/api/studio/proposals/accept-all")["ids"]!!.jsonArray.map { it.jsonPrimitive.content })

        s.declineProposals(null, "  We don't stock these.  ", "key_decline_001")
        val d = body("/api/studio/proposals/decline-all")
        assertFalse("ids" in d)
        assertEquals("We don't stock these.", d["reason"]!!.jsonPrimitive.content)
        assertEquals("key_decline_001", d["idempotencyKey"]!!.jsonPrimitive.content)

        s.declineProposals(listOf("pr_2"), "   ", "key_decline_002")
        val d2 = body("/api/studio/proposals/decline-all", 1)
        assertFalse("a blank reason is left out", "reason" in d2)
        assertEquals(listOf("pr_2"), d2["ids"]!!.jsonArray.map { it.jsonPrimitive.content })

        val r = s.addWebsitePieces(listOf("sp_1", "sp_2"), "key_pieces_0001")
        val a = body("/api/studio/catalog/website-pieces/add-all")
        assertEquals(listOf("sp_1", "sp_2"), a["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("key_pieces_0001", a["idempotencyKey"]!!.jsonPrimitive.content)
        // The response is the refreshed list plus the result.
        assertEquals(1, r.pieces.count)
        assertEquals(listOf("sp_1"), r.result.accepted)
        assertEquals("Photos couldn't be copied.", r.result.skipped.single().reason)
    }

    @Test fun aRetryAfterAFailureReusesTheKeyAndAnAnswerRenewsIt() = runBlocking {
        val model = StudioSuggestionsModel(store())
        model.load()
        failNext = 1
        val first = model.run(StudioBatchKind.All)
        assertFalse(first.success)
        assertTrue(first.message.startsWith("That didn't go through."))
        val second = model.run(StudioBatchKind.All)
        assertTrue(second.success)
        val keys = bodies.getValue("/api/studio/proposals/accept-all").map { Json.parseToJsonElement(it).jsonObject["idempotencyKey"]!!.jsonPrimitive.content }
        assertEquals(2, keys.size)
        assertEquals("the retry sends the same key", keys[0], keys[1])
        assertTrue(keys[0].length in 8..80 && keys[0].all { it.isLetterOrDigit() || it == '_' || it == '-' })
        // The next tap is a new request.
        model.run(StudioBatchKind.All)
        val third = bodies.getValue("/api/studio/proposals/accept-all").last().let { Json.parseToJsonElement(it).jsonObject["idempotencyKey"]!!.jsonPrimitive.content }
        assertNotEquals(keys[0], third)
    }

    @Test fun piecesRetryReusesTheKeyToo() = runBlocking {
        val model = StudioWebsitePiecesModel(store())
        failNext = 1
        assertFalse(model.addMany(all = true).success)
        val ok = model.addMany(all = true)
        assertTrue(ok.success)
        val keys = bodies.getValue("/api/studio/catalog/website-pieces/add-all").map { Json.parseToJsonElement(it).jsonObject["idempotencyKey"]!!.jsonPrimitive.content }
        assertEquals(keys[0], keys[1])
        assertEquals("1 piece added to your products. 1 couldn't be added: the reason is on it.", ok.message)
        assertEquals("Photos couldn't be copied.", model.reason(model.pieces!!.items.single()))
    }

    @Test fun skippedSuggestionsKeepTheirReasonAndAcceptedOnesLoseIt() = runBlocking {
        val model = StudioSuggestionsModel(store())
        model.load()
        assertEquals(3, model.waiting.size)
        assertEquals(1, model.past.size)
        model.selecting = true
        model.toggle("pr_1")
        model.toggle("pr_2")
        assertTrue(model.partial)
        val out = model.run(StudioBatchKind.Selected)
        assertEquals(listOf("pr_1", "pr_2"), body("/api/studio/proposals/accept-all")["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertTrue(out.success)
        assertEquals("1 suggestion accepted. 1 suggestion still needs you: the reason is next to it.", out.message)
        assertEquals(mapOf("pr_1" to "A product with this SKU already exists."), model.reasons)
        assertFalse("selection clears after a batch", model.selecting)
        assertTrue(model.selected.isEmpty())

        // A later batch accepts it: the reason goes.
        acceptAnswer = """{"accepted":["pr_1"],"skipped":[],"replayed":true}"""
        model.run(StudioBatchKind.All)
        assertTrue(model.reasons.isEmpty())
    }

    @Test fun declineNeedsTheConfirmAndPrefixesSkips() = runBlocking {
        val model = StudioSuggestionsModel(store())
        model.load()
        model.confirmDecline = true
        model.declineReason = "Not our style"
        val out = model.run(StudioBatchKind.Decline)
        assertEquals("3 suggestions declined.", out.message)
        assertFalse(model.confirmDecline)
        assertEquals("", model.declineReason)
        assertEquals("Not our style", body("/api/studio/proposals/decline-all")["reason"]!!.jsonPrimitive.content)
    }
}

class StudioBatchRulesTest {
    @Test fun idsForAllAndSelected() {
        val waiting = listOf("a", "b", "c")
        assertNull(StudioBatch.ids(all = true, selected = setOf("a"), waiting = waiting))
        assertEquals(listOf("a", "c"), StudioBatch.ids(all = false, selected = setOf("c", "a", "gone"), waiting = waiting))
        assertNull(StudioBatch.ids(all = false, selected = emptySet(), waiting = waiting))
        assertTrue(StudioBatch.allChosen(setOf("a", "b", "c", "x"), waiting))
        assertFalse(StudioBatch.allChosen(emptySet(), emptyList()))
    }

    @Test fun reasonsAndOutcomes() {
        val r = StudioBatchResult(accepted = listOf("a"), skipped = listOf(StudioBatchSkip("b", "Changed since."), StudioBatchSkip("c", "")))
        val reasons = StudioBatch.reasons(mapOf("a" to "old", "z" to "kept"), r, prefix = "Not declined: ")
        assertEquals(mapOf("z" to "kept", "b" to "Not declined: Changed since.", "c" to "Not declined: This one couldn't be done."), reasons)
        assertEquals("1 suggestion accepted. 2 suggestions still need you: the reason is next to each.", StudioBatch.acceptOutcome(r).message)
        assertEquals("Nothing could be accepted. Reload and try again.", StudioBatch.acceptOutcome(StudioBatchResult()).message)
        assertFalse(StudioBatch.acceptOutcome(StudioBatchResult()).success)
        assertEquals("Nothing was added. Reload and try again.", StudioBatch.addOutcome(StudioBatchResult()).message)
    }

    @Test fun preparedLine() {
        val new = StudioProposal("1", kind = "new")
        val edit = StudioProposal("2", kind = "edit", title = "Tote", fields = listOf("price"))
        assertEquals("Yard prepared 2 products for you" to "Accept all in one tap", StudioBatch.preparedLine(listOf(new, new.copy(id = "3"))))
        assertEquals("Yard prepared 1 product for you" to "Accept it in one tap", StudioBatch.preparedLine(listOf(new)))
        assertEquals("Yard has 2 suggestions for you", StudioBatch.preparedLine(listOf(new, edit)).first)
        assertEquals("Changes to Tote", edit.heading)
        assertEquals("1 change", edit.detail)
    }

    @Test fun keysAreFreshAndValid() {
        val k = StudioActionKey()
        val first = k.current
        assertEquals(32, first.length)
        assertTrue(first.all { it.isLetterOrDigit() })
        assertEquals(first, k.current)
        k.renew()
        assertNotEquals(first, k.current)
    }

    @Test fun decodesBatchResults() {
        val r = YardJson.decodeFromString(StudioBatchResult.serializer(), """{"accepted":["a"],"skipped":[{"id":"b","reason":"Why"}],"replayed":true}""")
        assertTrue(r.replayed)
        assertEquals("Why", r.skipped.single().reason)
        assertFalse(YardJson.decodeFromString(StudioBatchResult.serializer(), """{"accepted":[],"skipped":[]}""").replayed)
    }

    @Test fun suggestionLinks() {
        assertEquals(StudioLink.Suggestions(focusAcceptAll = true), StudioLink.parse("/studio/products/suggestions?focus=accept-all"))
        assertEquals(StudioLink.Suggestions(focusAcceptAll = true), StudioLink.parse("https://yardstore.space/studio/products/suggestions?focus=accept-all"))
        assertEquals(StudioLink.Suggestions(), StudioLink.parse("yard://studio/products/suggestions"))
        assertEquals(StudioLink.Suggestions(), StudioLink.parse("/studio/products/suggestions/pr_1"))
        assertEquals(StudioLink.Product("p_2"), StudioLink.parse("/studio/products/p_2"))
        val nav = StudioNav()
        nav.show(StudioLink.Suggestions(focusAcceptAll = true))
        assertEquals(StudioTab.Products, nav.tab)
        assertEquals(listOf<StudioRoute>(StudioRoute.Suggestions(focusAcceptAll = true)), nav.stack(StudioTab.Products).toList())
        // A push for a batch of suggestions (any scope) opens it too.
        val push = mapOf("google.message_id" to "m1", "scope" to "studio", "brandId" to "b_1", "url" to "/studio/products/suggestions?focus=accept-all")
        assertEquals(StudioPushTap(StudioLink.Suggestions(true), "b_1"), StudioPushTap.from { push[it] })
    }
}

/** Skipped suggestions render their reason under the row; the batch actions show. */
@RunWith(RobolectricTestRunner::class)
// A tall window so every row of the lazy list is composed.
@Config(sdk = [35], application = Application::class, qualifiers = "w412dp-h2000dp-port-xhdpi")
class StudioSuggestionsRenderTest {
    @get:Rule val compose = createComposeRule()

    private val items = listOf(
        StudioProposal("pr_1", title = "Amber room spray"),
        StudioProposal("pr_2", title = "Stoneware bowl"),
        StudioProposal("pr_9", status = "accepted", title = "Old one"),
    )

    @Test fun showsSkippedReasonsAndActions() {
        val model = StudioSuggestionsModel.preview(items, reasons = mapOf("pr_1" to "The product changed since Yard suggested this."))
        compose.setContent {
            YardPreview(darkTheme = false) {
                CompositionLocalProvider(LocalStudioNav provides StudioNav()) {
                    StudioSuggestionsScreen(model, focusAcceptAll = true, canPublish = true)
                }
            }
        }
        compose.onNodeWithText("Yard prepared 2 products for you", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Slide to accept all (2)", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("The product changed since Yard suggested this.", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Decline all", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Accepted", useUnmergedTree = true).assertExists()
    }

    @Test fun selectedRowsOfferAcceptSelected() {
        val model = StudioSuggestionsModel.preview(items, selecting = true, selected = setOf("pr_2"))
        compose.setContent {
            YardPreview(darkTheme = true) {
                CompositionLocalProvider(LocalStudioNav provides StudioNav()) {
                    StudioSuggestionsScreen(model, focusAcceptAll = false, canPublish = true)
                }
            }
        }
        compose.onNodeWithText("Accept selected (1)", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Decline selected (1)", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("1 of 2 selected", useUnmergedTree = true).assertExists()
    }

    @Test fun withoutPublishRightsNoBatchButtons() {
        val model = StudioSuggestionsModel.preview(items)
        compose.setContent {
            YardPreview(darkTheme = false) {
                CompositionLocalProvider(LocalStudioNav provides StudioNav()) {
                    StudioSuggestionsScreen(model, focusAcceptAll = false, canPublish = false)
                }
            }
        }
        compose.onNodeWithText("Only people who can publish for this brand can accept suggestions.", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Slide to accept all (2)", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun piecesShowTheirSkipReason() {
        val pieces = StudioSitePieces(
            items = listOf(StudioSitePiece("sp_1", title = "Fig candle", status = "waiting"), StudioSitePiece("sp_2", title = "Holder", status = "waiting", error = "Photos couldn't be copied.")),
            count = 2, mayAdd = true,
        )
        val model = StudioWebsitePiecesModel.preview(pieces, selected = setOf("sp_1"))
        compose.setContent {
            YardPreview(darkTheme = false) {
                CompositionLocalProvider(LocalStudioNav provides StudioNav()) { StudioWebsitePiecesScreen(model) }
            }
        }
        compose.onNodeWithText("Add all (2)", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Add selected (1)", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Photos couldn't be copied.", useUnmergedTree = true).assertExists()
    }
}
