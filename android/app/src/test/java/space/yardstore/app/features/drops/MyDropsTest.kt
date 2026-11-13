package space.yardstore.app.features.drops

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import java.time.Instant

class MyDropsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        api = dropsTestClient(server)
        APIClient.install(api)
    }

    @After fun tearDown() = server.shutdown()

    private val draw = dropJson("drp_draw", -60, 86_400, access = "draw", status = "live", phase = "live", entryOpensIn = -7200, entryClosesIn = -120)
    private val up = dropJson("drp_up", 5400, 90_000)

    /** Exactly what myDrops() returns, including a reminder whose drop went back to draft (drop: null). */
    private val meJson = """
    {"entries":[
       {"drop":$draw,"status":"won","rank":3,"windowOpensAt":"2026-11-13T10:00:00.000Z","windowEndsAt":"2026-11-14T10:00:00.000Z","enteredAt":"2026-11-12T09:00:00.000Z"},
       {"drop":$draw,"status":"withdrawn","rank":null,"windowOpensAt":null,"windowEndsAt":null,"enteredAt":"2026-11-12T09:00:00.000Z"}],
     "reminders":[
       {"dropId":"drp_up","setAt":"2026-11-12T10:00:00.000Z","drop":$up},
       {"dropId":"drp_gone","setAt":"2026-11-11T10:00:00.000Z","drop":null}]}
    """

    @Test fun decodesMyDropsResponse() {
        val r = YardJson.decodeFromString(MyDropsResponse.serializer(), meJson)
        assertEquals(2, r.entries.size)
        assertEquals("won", r.entries[0].status)
        assertEquals(3, r.entries[0].rank)
        assertEquals("drp_draw", r.entries[0].id)
        assertEquals(2, r.reminders.size)
        assertNull(r.reminders[1].drop)
        assertEquals("drp_gone", r.reminders[1].id)
        val empty = YardJson.decodeFromString(MyDropsResponse.serializer(), "{}")
        assertTrue(empty.entries.isEmpty() && empty.reminders.isEmpty())
    }

    @Test fun captions() {
        val r = YardJson.decodeFromString(MyDropsResponse.serializer(), meJson)
        val won = r.entries[0]
        assertEquals("Purchase by ${Formatters.dateTime(YardDate.parse(won.windowEndsAt)!!)} · your time", MyDropsText.entryCaption(won))
        assertEquals("Purchase window: 1 day", MyDropsText.windowFootnote(won))
        val entered = won.copy(status = "entered")
        assertEquals("Entered ${Formatters.dateTime(YardDate.parse(won.enteredAt)!!)} · your time", MyDropsText.entryCaption(entered))
        assertNull(MyDropsText.windowFootnote(entered))
        assertEquals("Queue position 3", MyDropsText.entryCaption(won.copy(status = "waitlisted")))
        assertEquals("Draw result is available on the drop page.", MyDropsText.entryCaption(won.copy(status = "lost", rank = null)))

        val now = Instant.now()
        val reminder = r.reminders[0]
        val caption = MyDropsText.reminderCaption(reminder, reminder.drop!!, now)
        assertTrue(caption, caption.startsWith("Opens ") && caption.endsWith("in 1h"))
        val liveCaption = MyDropsText.reminderCaption(reminder, won.drop, now)
        assertTrue(liveCaption, liveCaption.startsWith("Reminder set ") && liveCaption.endsWith("· Winners buying"))
    }

    @Test fun loadAndRemoveReminder() = runTest {
        var removed = false
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/me" to { json(if (removed) """{"entries":[],"reminders":[]}""" else meJson)() },
            "DELETE /api/drops/drp_up/reminder" to { removed = true; json("""{"reminder":false}""")() },
        ))
        val model = MyDropsViewModel(api = api)
        model.loadNow()
        assertEquals(MyDropsViewModel.LoadState.Loaded, model.state)
        assertEquals(2, model.response!!.reminders.size)
        model.removeReminder(model.response!!.reminders[0].drop!!, context = null)
        assertTrue(model.response!!.reminders.isEmpty())
        model.reset()
        assertNull(model.response)
        assertEquals(MyDropsViewModel.LoadState.Loading, model.state)
    }

    @Test fun signedOutIsAnError() = runTest {
        server.dispatcher = DropsRoutes(mapOf(
            "GET /api/drops/me" to json("""{"error":{"code":"unauthorized","message":"Sign in to continue."}}""", 401),
        ))
        val model = MyDropsViewModel(api = api)
        model.loadNow()
        assertTrue(model.state is MyDropsViewModel.LoadState.Failed)
    }
}
