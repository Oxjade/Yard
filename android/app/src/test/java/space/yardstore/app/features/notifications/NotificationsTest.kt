package space.yardstore.app.features.notifications

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.time.Instant
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        api = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private val origin get() = server.url("/").toString().trimEnd('/')
    private fun model(items: List<ShopperNotification>? = null) = NotificationsViewModel(api, items, origin)

    private fun n(id: String, read: Boolean, at: String = Instant.now().toString(), key: String = "k:$id") =
        ShopperNotification(id = id, key = key, category = "drop_update", title = "T $id", body = "", href = null, at = at, read = read)

    /** Shaped like GET /api/notifications?as=shopper (notificationDto). */
    private val listJson = """
        {"items":[
          {"id":"ntf_1","key":"msg:cv_1","recipient":{"kind":"shopper","id":"shp_1"},"category":"new_message",
           "title":"Acme Studio replied","body":"Open your inbox to read it.","href":"/inbox?thread=cv_1",
           "at":"2026-11-13T10:00:00.000Z","read":false},
          {"id":"ntf_2","key":"shipped:ord_1","recipient":{"kind":"shopper","id":"shp_1"},"category":"delivery_update",
           "title":"Acme Studio shipped your order","body":"Estimated arrival 14–18 Nov.","href":"/you/orders/ord_1",
           "at":"2026-11-12T09:00:00.000Z","read":true},
          {"id":"ntf_3","key":"acct:1","recipient":{"kind":"shopper","id":"shp_1"},"category":"account",
           "title":"Welcome","body":"","href":null,"at":"2026-11-01T09:00:00Z","read":false}
        ]}
    """.trimIndent()

    // region DTOs

    @Test fun decodesListResponse() {
        val r = YardJson.decodeFromString(NotificationsListResponse.serializer(), listJson).notifications
        assertEquals(3, r.size)
        assertEquals("msg:cv_1", r[0].key)
        assertEquals(ShopperNotificationKind.Message, r[0].kind)
        assertEquals(ShopperNotificationKind.Order, r[1].kind)
        assertTrue(r[1].read)
        assertNull(r[2].href)
        assertEquals(Instant.parse("2026-11-13T10:00:00Z"), r[0].date)
    }

    @Test fun malformedRowIsDroppedAndMissingFieldsDefault() {
        val json = """{"items":[{"title":"no id"},{"id":"ntf_9","read":null},{"id":"ntf_8","key":"x","read":true}]}"""
        val r = YardJson.decodeFromString(NotificationsListResponse.serializer(), json).notifications
        assertEquals(listOf("ntf_9", "ntf_8"), r.map { it.id })
        assertFalse(r[0].read)
        assertEquals("ntf_9", r[0].eventKey) // missing key falls back to id
        assertEquals("x", r[1].eventKey)
        assertEquals(0, YardJson.decodeFromString(NotificationsListResponse.serializer(), "{}").notifications.size)
    }

    @Test fun readBodyOmitsNullsAndResultDecodes() {
        assertEquals("""{"keys":["a"],"read":false}""", YardJson.encodeToString(NotificationsReadBody.serializer(), NotificationsReadBody(keys = listOf("a"), read = false)))
        assertEquals("""{"all":true}""", YardJson.encodeToString(NotificationsReadBody.serializer(), NotificationsReadBody(all = true)))
        val res = YardJson.decodeFromString(NotificationsReadResult.serializer(), """{"updated":2,"keys":["a","b"],"read":true}""")
        assertEquals(2, res.updated); assertEquals(listOf("a", "b"), res.keys); assertEquals(true, res.read)
    }

    // endregion

    // region Helpers

    @Test fun kindsAndLabels() {
        assertEquals(ShopperNotificationKind.Drop, ShopperNotificationKind.from("drops"))
        assertEquals(ShopperNotificationKind.Order, ShopperNotificationKind.from("shipping_issue"))
        assertEquals(ShopperNotificationKind.Follow, ShopperNotificationKind.from("chart_movement"))
        assertEquals(ShopperNotificationKind.Wishlist, ShopperNotificationKind.from("back_in_stock"))
        assertEquals(ShopperNotificationKind.Account, ShopperNotificationKind.from("content_moderation"))
        assertEquals(ShopperNotificationKind.Other, ShopperNotificationKind.from("something_new"))
        assertEquals("Delivery", ShopperNotificationKind.Order.label)
        assertEquals("Yard", ShopperNotificationKind.Other.label)
    }

    @Test fun channelIds() {
        assertEquals(YardNotificationChannels.DROPS, YardNotificationChannels.idFor("drop_update"))
        assertEquals(YardNotificationChannels.MESSAGES, YardNotificationChannels.idFor("new_message"))
        assertEquals(YardNotificationChannels.ORDERS, YardNotificationChannels.idFor("delivery_update"))
        assertEquals(YardNotificationChannels.GENERAL, YardNotificationChannels.idFor("unknown"))
    }

    @Test fun routing() {
        assertEquals(Route.Conversation("cv_1"), NotificationsRouting.route("/inbox?thread=cv_1"))
        assertEquals(Route.Inbox, NotificationsRouting.route("/inbox"))
        assertEquals(Route.Order("ord_1"), NotificationsRouting.route("/you/orders/ord_1"))
        assertEquals(Route.Drop("night-shift"), NotificationsRouting.route("/drops/night-shift"))
        assertEquals(Route.Product("boxy-tee"), NotificationsRouting.route("/products/boxy-tee"))
        assertEquals(Route.Brand("acme"), NotificationsRouting.route("/brands/acme"))
        assertEquals(Route.Saved, NotificationsRouting.route("/wishlist"))
        assertEquals(Route.Charts, NotificationsRouting.route("/charts"))
        assertNull(NotificationsRouting.route(null))
        assertNull(NotificationsRouting.route("//evil.com/x"))
        assertNull(NotificationsRouting.route("https://evil.com/drops/x"))
        assertNull(NotificationsRouting.route("/studio/orders"))
        assertNull(NotificationsRouting.route("/admin"))
        assertNull(NotificationsRouting.route("/some-unknown-page"))
    }

    @Test fun sectionsAndFilter() {
        val now = Instant.now()
        val old = now.minus(3, ChronoUnit.DAYS).toString()
        val m = model(listOf(n("a", false, now.toString()), n("b", true, old), n("c", false, old), n("d", true, "")))
        assertEquals(listOf("Today", "Earlier"), m.sections.map { it.title })
        assertEquals(listOf("a"), m.sections[0].items.map { it.id })
        assertEquals(listOf("b", "c", "d"), m.sections[1].items.map { it.id })
        assertEquals(2, m.unreadCount)
        m.filter = NotificationsViewModel.Filter.Unread
        assertEquals(listOf("a", "c"), m.visible.map { it.id })
        m.reset()
        assertTrue(m.items.isEmpty())
        assertEquals(NotificationsViewModel.Phase.Idle, m.phase)
        assertEquals(NotificationsViewModel.Filter.All, m.filter)
    }

    // endregion

    // region ViewModel against the API

    @Test fun loadSuccess() = runTest {
        server.enqueue(MockResponse().setBody(listJson))
        val m = model()
        m.load().join()
        assertEquals(NotificationsViewModel.Phase.Loaded, m.phase)
        assertEquals(3, m.items.size)
        assertEquals(2, m.unreadCount)
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/notifications?as=shopper", req.path)
    }

    @Test fun loadEmpty() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[]}"""))
        val m = model()
        m.load().join()
        assertEquals(NotificationsViewModel.Phase.Loaded, m.phase)
        assertTrue(m.sections.isEmpty())
    }

    @Test fun loadErrorWithoutItemsFails() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Something broke."}}"""))
        val m = model()
        m.load().join()
        val phase = m.phase
        assertTrue(phase is NotificationsViewModel.Phase.Failed)
        assertEquals("Something broke.", (phase as NotificationsViewModel.Phase.Failed).message)
    }

    @Test fun failedRefreshKeepsItems() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":{"code":"unavailable","message":"Down."}}"""))
        val m = model(listOf(n("a", false)))
        m.load().join()
        assertEquals(NotificationsViewModel.Phase.Loaded, m.phase)
        assertEquals(1, m.items.size)
    }

    @Test fun setReadSendsKeyAndUpdates() = runTest {
        server.enqueue(MockResponse().setBody("""{"updated":1,"keys":["k:a"],"read":true}"""))
        val m = model(listOf(n("a", false), n("b", false)))
        val job = m.setRead(true, m.items[0])
        assertTrue(m.items[0].read) // optimistic
        assertNotNull(job); job!!.join()
        assertTrue(m.items[0].read)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/notifications/read?as=shopper", req.path)
        assertEquals("""{"keys":["k:a"],"read":true}""", req.body.readUtf8())
        assertNull(m.setRead(true, m.items[0])) // no-op when unchanged
    }

    @Test fun setReadRollsBackOnFailure() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":{"code":"rate_limited","message":"Slow down."}}"""))
        val m = model(listOf(n("a", true)))
        var error: Throwable? = null
        m.setRead(false, m.items[0]) { error = it }!!.join()
        assertTrue(m.items[0].read)
        assertEquals("Slow down.", error?.message)
        assertEquals("""{"keys":["k:a"],"read":false}""", server.takeRequest().body.readUtf8())
    }

    @Test fun markAllReadSuccess() = runTest {
        server.enqueue(MockResponse().setBody("""{"updated":2,"keys":["k:a","k:b"],"read":true}"""))
        val m = model(listOf(n("a", false), n("b", false), n("c", true)))
        var ok = false
        m.markAllRead(onSuccess = { ok = true })!!.join()
        assertTrue(ok)
        assertEquals(0, m.unreadCount)
        assertFalse(m.isMarkingAll)
        assertEquals("""{"all":true}""", server.takeRequest().body.readUtf8())
        assertNull(m.markAllRead()) // nothing unread → no request
    }

    @Test fun markAllReadRollsBack() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Nope."}}"""))
        val m = model(listOf(n("a", false), n("b", true)))
        var error: Throwable? = null
        m.markAllRead(onError = { error = it })!!.join()
        assertEquals(1, m.unreadCount)
        assertFalse(m.isMarkingAll)
        assertEquals("Nope.", error?.message)
    }

    // endregion

    // region Push center

    @Test fun handleTapFallsBackToList() {
        YardPushCenter.handleTap(null)
        assertEquals("/notifications", YardPushCenter.pendingHref)
        YardPushCenter.handleTap("/you/orders/ord_1")
        assertEquals("/you/orders/ord_1", YardPushCenter.pendingHref)
        YardPushCenter.pendingHref = null
    }

    // endregion
}
