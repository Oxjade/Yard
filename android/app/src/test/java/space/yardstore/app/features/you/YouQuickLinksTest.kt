package space.yardstore.app.features.you

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import space.yardstore.app.app.Route
import space.yardstore.app.features.home.HomeFakeServer
import space.yardstore.app.features.home.errorJson
import space.yardstore.app.features.home.json
import java.time.Instant

/** The You quick links: badge rules (never invented, hidden at zero/unknown) and the live counts model. */
@OptIn(ExperimentalCoroutinesApi::class)
class YouQuickLinksTest {
    private var fake: HomeFakeServer? = null
    private var model: YouBadgesModel? = null

    @Before fun setUp() { Dispatchers.setMain(UnconfinedTestDispatcher()) }

    @After fun tearDown() {
        // Nothing of the model's may still be running when Main is reset (see YouViewModelsTest).
        model?.viewModelScope?.cancel()
        fake?.shutdown()
        Dispatchers.resetMain()
    }

    @Test fun badgesOnlyFromKnownPositiveCounts() {
        val links = youLinks(saved = 6, following = 0, unreadConversations = null, unreadNotifications = 3, ordersInProgress = 0, activeReminders = 2)
        assertEquals(listOf("Orders", "Saved", "Following", "Inbox", "Drop reminders", "Updates"), links.map { it.title })
        assertEquals(listOf(Route.Orders, Route.Saved, Route.Following, Route.Inbox, Route.MyDrops, Route.Notifications), links.map { it.route })
        assertNull(links[0].badge) // 0 in progress
        assertEquals(YouLinkBadge.Total(6, "6 saved"), links[1].badge)
        assertNull(links[2].badge) // following 0
        assertNull(links[3].badge) // unknown
        assertEquals(YouLinkBadge.Total(2, "2 set"), links[4].badge)
        assertEquals(YouLinkBadge.Attention(3, "3 unread"), links[5].badge)

        val more = youLinks(saved = null, following = 4, unreadConversations = 2, unreadNotifications = 0, ordersInProgress = 1, activeReminders = null)
        assertEquals(YouLinkBadge.Attention(1, "1 in progress"), more[0].badge)
        assertEquals(YouLinkBadge.Dot("2 unread"), more[3].badge)
        assertNull(more[5].badge)
    }

    @Test fun loadsLiveCountsFromTheAppsEndpoints() = runTest {
        val soon = Instant.now().plusSeconds(3600).toString()
        val later = Instant.now().plusSeconds(7200).toString()
        val past = Instant.now().minusSeconds(7200).toString()
        val f = HomeFakeServer { path, _ ->
            when (path) {
                "/api/inbox/unread" -> json("""{"conversations":2}""")
                "/api/notifications" -> json("""{"items":[{"id":"n1","read":false},{"id":"n2","read":true},{"id":"n3","read":false}]}""")
                "/api/orders" -> json(
                    """{"items":[{"id":"o1","states":{"merchant":"shipped"}},{"id":"o2","states":{"merchant":"delivered"}},
                    {"id":"o3","states":{"merchant":"paid"}}],"nextCursor":null}""",
                )
                "/api/drops/me" -> json(
                    """{"entries":[],"reminders":[
                    {"dropId":"d1","drop":{"id":"d1","slug":"a","brand":{"id":"b","name":"B"},"name":"A","status":"scheduled","phase":"upcoming","startsAt":"$soon","endsAt":"$later"}},
                    {"dropId":"d2","drop":{"id":"d2","slug":"b","brand":{"id":"b","name":"B"},"name":"B","status":"ended","phase":"ended","startsAt":"$past","endsAt":"$past"}},
                    {"dropId":"d3"}]}""",
                )
                else -> errorJson(404, "Not found.")
            }
        }.also { fake = it }
        val m = YouBadgesModel(f.api).also { model = it }
        m.refresh(signedIn = true)
        m.awaitLoad()
        assertEquals(2, m.unreadConversations)
        assertEquals(2, m.unreadNotifications)
        assertEquals(2, m.ordersInProgress)
        assertEquals(1, m.activeReminders)
        assertEquals("/api/notifications?as=shopper", f.requestsTo("/api/notifications").single().path)

        // Throttled: an immediate second refresh makes no requests; a forced one does.
        m.refresh(signedIn = true)
        m.awaitLoad()
        assertEquals(1, f.requestsTo("/api/inbox/unread").size)
        m.refresh(signedIn = true, force = true)
        m.awaitLoad()
        assertEquals(2, f.requestsTo("/api/inbox/unread").size)

        // Signed out: everything unknown again.
        m.refresh(signedIn = false)
        assertNull(m.unreadConversations)
        assertNull(m.ordersInProgress)
    }

    @Test fun aFailedEndpointHidesOnlyItsBadge() = runTest {
        val f = HomeFakeServer { path, _ ->
            when (path) {
                "/api/inbox/unread" -> json("""{"conversations":1}""")
                else -> errorJson(500, "Something went wrong on our side.")
            }
        }.also { fake = it }
        val m = YouBadgesModel(f.api).also { model = it }
        m.refresh(signedIn = true)
        m.awaitLoad()
        assertEquals(1, m.unreadConversations)
        assertNull(m.unreadNotifications)
        assertNull(m.ordersInProgress)
        assertNull(m.activeReminders)
    }
}
