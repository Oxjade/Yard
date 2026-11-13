package space.yardstore.app.features.drops

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import java.time.Instant
import java.time.ZoneId

class DropsViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        api = dropsTestClient(server)
        APIClient.install(api)
    }

    @After fun tearDown() = server.shutdown()

    private fun page(vararg drops: String, next: String? = null) =
        json("""{"items":[${drops.joinToString(",")}],"nextCursor":${next?.let { "\"$it\"" } ?: "null"}}""")

    private val live = dropJson("drp_live", -3600, 7200, status = "live", phase = "live")
    private val draw = dropJson("drp_draw", 86_400, 172_800, access = "draw", phase = "entries_open", entryOpensIn = -3600, entryClosesIn = 80_000)
    private val soon = dropJson("drp_soon", 5400, 90_000)
    private val later = dropJson("drp_later", 3 * 86_400L, 4 * 86_400L)
    private val past = dropJson("drp_past", -400_000, -300_000, status = "ended", phase = "ended")

    @Test fun reloadReadsThreeFeedsAndGroupsOnTheClock() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            // The live feed holds the open draw too (startsAt filter differs on the server; dedupe by id).
            "GET /api/drops?phase=live" to page(live, draw),
            "GET /api/drops?phase=upcoming" to page(later, soon, draw, next = "24"),
            "GET /api/drops?phase=ended" to page(past),
            "GET /api/drops/me" to json("""{"entries":[{"drop":$draw,"status":"entered","rank":null,"windowOpensAt":null,"windowEndsAt":null,"enteredAt":"2026-11-12T10:00:00.000Z"}],
                "reminders":[{"dropId":"drp_soon","setAt":"2026-11-12T10:00:00.000Z","drop":$soon}]}"""),
        ))
        val model = DropsViewModel(api)
        model.reload(signedIn = true)

        assertEquals(DropsViewModel.LoadState.Loaded, model.state)
        val requests = (1..4).map { server.takeRequest() }
        val paths = requests.map { it.path!! }.toSet()
        assertTrue(paths.contains("/api/drops?phase=live&limit=24"))
        assertTrue(paths.contains("/api/drops?phase=upcoming&limit=24"))
        assertTrue(paths.contains("/api/drops?phase=ended&limit=24"))
        assertTrue(paths.contains("/api/drops/me"))
        assertTrue(requests.all { it.getHeader("X-Yard-Client") == "1" })

        val groups = model.groups(Instant.now())
        assertEquals(listOf("drp_live"), groups.live.map { it.id })
        assertEquals(listOf("drp_draw"), groups.entriesOpen.map { it.id })
        assertEquals(listOf("drp_soon", "drp_later"), groups.upcoming.map { it.id })
        assertEquals(listOf("drp_past"), groups.past.map { it.id })
        assertFalse(groups.isEmpty)
        assertEquals("24", model.feed(DropsViewModel.Source.Upcoming).cursor)

        assertEquals(setOf("drp_soon"), model.reminderIds)
        assertEquals(setOf("drp_draw"), model.entryIds)

        val days = model.days(groups.upcoming, Instant.now(), ZoneId.systemDefault())
        assertEquals(2, days.size)
        assertTrue(days[0].day < days[1].day)
        assertEquals("drp_later", days[1].drops.single().id)
    }

    @Test fun loadMoreAppendsAndDedupes() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops?phase=live" to page(),
            "GET /api/drops?phase=upcoming&cursor=24" to page(soon, later, next = null),
            "GET /api/drops?phase=upcoming" to page(soon, next = "24"),
            "GET /api/drops?phase=ended" to page(),
        ))
        val model = DropsViewModel(api)
        model.reload(signedIn = false)
        assertEquals(1, model.feed(DropsViewModel.Source.Upcoming).items.size)
        model.loadMoreNow(DropsViewModel.Source.Upcoming)
        val feed = model.feed(DropsViewModel.Source.Upcoming)
        assertEquals(listOf("drp_soon", "drp_later"), feed.items.map { it.id })
        assertEquals(null, feed.cursor)
        assertFalse(feed.isLoadingMore)
        assertTrue(model.reminderIds.isEmpty())
    }

    @Test fun emptyBoard() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops?phase=live" to page(),
            "GET /api/drops?phase=upcoming" to page(),
            "GET /api/drops?phase=ended" to page(),
        ))
        val model = DropsViewModel(api)
        model.reload(signedIn = false)
        assertEquals(DropsViewModel.LoadState.Loaded, model.state)
        assertTrue(model.groups(Instant.now()).isEmpty)
    }

    @Test fun firstLoadFailureShowsErrorButRefreshFailureKeepsData() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops?phase=live" to json("""{"error":{"code":"internal","message":"Something went wrong."}}""", 500),
            "GET /api/drops?phase=upcoming" to page(),
            "GET /api/drops?phase=ended" to page(),
        ))
        val model = DropsViewModel(api)
        model.reload(signedIn = false)
        val state = model.state
        assertTrue(state is DropsViewModel.LoadState.Failed)
        assertEquals("Something went wrong.", (state as DropsViewModel.LoadState.Failed).error.message)

        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops?phase=live" to page(live),
            "GET /api/drops?phase=upcoming" to page(),
            "GET /api/drops?phase=ended" to page(),
        ))
        model.reload(signedIn = false)
        assertEquals(DropsViewModel.LoadState.Loaded, model.state)
        server.dispatcher = DropsRoutes(emptyMap())
        model.reload(signedIn = false)
        assertEquals(DropsViewModel.LoadState.Loaded, model.state)
        assertEquals(listOf("drp_live"), model.feed(DropsViewModel.Source.Live).items.map { it.id })
    }

    @Test fun toggleReminderPostsThenDeletes() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "POST /api/drops/drp_soon/reminder" to json("""{"reminder":true}"""),
            "DELETE /api/drops/drp_soon/reminder" to json("""{"reminder":false}"""),
        ))
        val model = DropsViewModel(api)
        val drop = space.yardstore.app.core.models.YardJson.decodeFromString(space.yardstore.app.core.models.Drop.serializer(), soon)
        val on = model.toggleReminder(drop, context = null, permission = null)
        assertEquals("Reminder set", on.text)
        assertTrue("drp_soon" in model.reminderIds)
        val post = server.takeRequest()
        assertEquals("POST", post.method)
        assertEquals("https://yardstore.space", post.getHeader("Origin"))
        val off = model.toggleReminder(drop, context = null, permission = null)
        assertEquals("Reminder removed", off.text)
        assertFalse("drp_soon" in model.reminderIds)
        assertEquals("DELETE", server.takeRequest().method)
        assertTrue(model.busyIds.isEmpty())
    }
}
