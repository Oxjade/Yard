package space.yardstore.app.features.inbox

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class InboxThreadModelTest {
    private val t = InboxTestServer()

    @Before fun setUp() = t.start()
    @After fun tearDown() = t.stop()

    private suspend fun until(check: () -> Boolean) = withTimeout(5_000) { while (!check()) delay(10) }

    @Test fun loadsConversationMarksReadAndLoadsBrandAndProducts() = runBlocking {
        val product = ""","product":{"productId":"prd_1","slug":"boxy-tee","name":"Boxy tee","price":{"amount":4500,"currency":"USD"}}"""
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(
            InboxJson.conversation(unread = 1, interaction = """{"canSend":true}"""),
            listOf(InboxJson.message("m2", 2), InboxJson.message("m1", 1, side = "customer", extra = product)),
            hasMore = true,
        ))
        t.on("POST", "/api/inbox/conversations/cv_1/read", status = 204)
        t.on("GET", "/api/catalog/storefronts/brd_acme", body = InboxJson.storefront)
        t.on("GET", "/api/catalog/products", body = """{"products":[{"id":"prd_1","slug":"boxy-tee","title":"Boxy tee","images":[{"src":"/api/media/med_p","width":800,"height":1000}]}],"total":1}""")

        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()

        assertEquals(InboxThreadModel.Phase.Ready, m.phase)
        assertEquals(listOf("m1", "m2"), m.messages.map { it.id })
        assertTrue(m.hasMore)
        assertEquals("Acme Studio", m.brandName)
        assertEquals("acme", m.brandHandle)
        assertTrue(m.brandLogoUrl!!.endsWith("/api/media/med_logo"))
        assertTrue(m.productImages["prd_1"]!!.endsWith("/api/media/med_p"))
        assertNull(m.disabledReason)
        val read = t.requests("POST", "/api/inbox/conversations/cv_1/read").single()
        assertEquals("""{"upToSeq":2}""", read.body.readUtf8())
        assertFalse(m.conversation!!.isUnread)
        assertEquals("50", t.requests("GET", "/api/inbox/conversations/cv_1/messages").first().requestUrl!!.queryParameter("limit"))
        assertEquals("prd_1", t.requests("GET", "/api/catalog/products").single().requestUrl!!.queryParameter("ids"))
    }

    @Test fun loadFailureShowsServerMessage() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_x/messages", status = 404, body = """{"error":{"code":"not_found","message":"We couldn't find that conversation."}}""")
        val m = InboxThreadModel.forConversation("cv_x")
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Failed("We couldn't find that conversation."), m.phase)
    }

    @Test fun pollFetchesAfterNewestAndKeepsInteraction() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(
            InboxJson.conversation(interaction = """{"canSend":false,"reason":"locked"}"""), listOf(InboxJson.message("m1", 1, side = "customer"))))
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(
            InboxJson.conversation(unread = 1), listOf(InboxJson.message("m2", 2, body = "New reply"))))
        t.on("POST", "/api/inbox/conversations/cv_1/read", status = 204)
        t.on("GET", "/api/catalog/storefronts/brd_acme", body = InboxJson.storefront)
        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()
        m.poll().join()
        assertEquals(listOf("m1", "m2"), m.messages.map { it.id })
        val pollReq = t.requests("GET", "/api/inbox/conversations/cv_1/messages").last().requestUrl!!
        assertEquals("1", pollReq.queryParameter("after"))
        assertEquals("100", pollReq.queryParameter("limit"))
        // The list-shaped conversation from the poll has no interaction: the thread's is kept.
        assertEquals("This conversation was closed by Yard.", m.disabledReason)
        assertEquals("""{"upToSeq":2}""", t.requests("POST", "/api/inbox/conversations/cv_1/read").single().body.readUtf8())
    }

    @Test fun newThreadFirstSendCreatesConversation() = runBlocking {
        t.on("GET", "/api/inbox/conversations/by-brand/brd_acme", body = """{"conversation":null,"canMessage":true}""")
        t.on("GET", "/api/catalog/storefronts/brd_acme", body = InboxJson.storefront)
        t.on("POST", "/api/inbox/messages", status = 201, body = """{"message":${InboxJson.message("m1", 1, side = "customer", body = "Does the M fit?")},"conversation":${InboxJson.conversation("cv_new")}}""")
        val m = InboxThreadModel.forBrand("brd_acme")
        var created: String? = null
        m.onCreated = { created = it }
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Ready, m.phase)
        assertTrue(m.isEmpty)
        assertNull(m.conversationId)
        assertEquals("Acme Studio", m.displayName)

        m.send("  Does the M fit?  ", emptyList())
        until { m.messages.isNotEmpty() }
        assertTrue(m.pending.isEmpty())
        assertEquals("cv_new", m.conversationId)
        assertEquals("cv_new", created)
        assertTrue(m.conversation!!.interaction!!.canSend)
        val body = t.requests("POST", "/api/inbox/messages").single().body.readUtf8()
        assertTrue(body, body.startsWith("""{"brandId":"brd_acme","clientId":"""))
        assertTrue(body, body.endsWith(""""kind":"text","body":"Does the M fit?","origin":"inbox"}"""))
    }

    @Test fun newThreadBlockedShowsReason() = runBlocking {
        t.on("GET", "/api/inbox/conversations/by-brand/brd_acme", body = """{"conversation":null,"canMessage":false,"reason":"blocked"}""")
        t.on("GET", "/api/catalog/storefronts/brd_acme", body = InboxJson.storefront)
        val m = InboxThreadModel.forBrand("brd_acme")
        m.load().join()
        until { m.brandName.isNotEmpty() }
        assertEquals("You can't message Acme Studio.", m.disabledReason)
    }

    @Test fun failedSendKeepsPendingAndRetryReusesClientId() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(), emptyList()))
        t.on("GET", "/api/catalog/storefronts/brd_acme", body = InboxJson.storefront)
        t.on("POST", "/api/inbox/messages", status = 429, body = """{"error":{"code":"rate_limited","message":"You're sending messages too fast. Wait a moment."}}""")
        t.on("POST", "/api/inbox/messages", status = 201, body = """{"message":${InboxJson.message("m1", 1, side = "customer", body = "Hi")},"conversation":${InboxJson.conversation()}}""")
        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()
        m.send("Hi", emptyList())
        until { m.pending.firstOrNull()?.isFailed == true }
        assertEquals("You're sending messages too fast. Wait a moment.", m.pending.single().failedMessage)
        m.retry(m.pending.single())
        until { m.pending.isEmpty() }
        assertEquals(listOf("m1"), m.messages.map { it.id })
        val ids = t.requests("POST", "/api/inbox/messages").map { Regex("\"clientId\":\"([^\"]+)\"").find(it.body.readUtf8())!!.groupValues[1] }
        assertEquals(2, ids.size)
        assertEquals(ids[0], ids[1])
    }

    @Test fun discardRemovesPending() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(), emptyList()))
        t.on("POST", "/api/inbox/messages", status = 500)
        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()
        m.send("Hi", emptyList())
        until { m.pending.firstOrNull()?.isFailed == true }
        m.discard(m.pending.single())
        assertTrue(m.isEmpty)
    }

    @Test fun loadOlderPagesBack() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(), listOf(InboxJson.message("m5", 5)), hasMore = true))
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(), listOf(InboxJson.message("m4", 4)), hasMore = false))
        t.on("POST", "/api/inbox/conversations/cv_1/read", status = 204)
        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()
        m.loadOlder().join()
        assertEquals(listOf("m4", "m5"), m.messages.map { it.id })
        assertFalse(m.hasMore)
        assertEquals("5", t.requests("GET", "/api/inbox/conversations/cv_1/messages").last().requestUrl!!.queryParameter("before"))
    }

    @Test fun actionsPatchMuteArchiveAndBlock() = runBlocking {
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(interaction = """{"canSend":true}"""), emptyList()))
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation(byMe = true, interaction = """{"canSend":false,"reason":"blocked_by_me"}"""), emptyList()))
        t.on("PATCH", "/api/inbox/conversations/cv_1", body = """{"conversation":${InboxJson.conversation(muted = true)}}""")
        t.on("POST", "/api/inbox/blocks", status = 204)
        val m = InboxThreadModel.forConversation("cv_1")
        m.load().join()
        m.setMuted(true)
        assertTrue(m.conversation!!.muted)
        assertEquals("""{"muted":true}""", t.requests("PATCH", "/api/inbox/conversations/cv_1").single().body.readUtf8())
        m.setBlocked(true)
        assertTrue(m.isBlockedByMe)
        assertEquals("""{"brandId":"brd_acme"}""", t.requests("POST", "/api/inbox/blocks").single().body.readUtf8())
        assertEquals("You blocked Acme Studio. Unblock them from the menu to send a message.", m.disabledReason)
    }

    @Test fun itemsGroupDaysAndRunTimes() {
        val conv = InboxConversation("cv_1", InboxBrandRef("b", "acme", "Acme"))
        val msgs = listOf(
            InboxMessage("a", 1, "brand", createdAt = "2026-11-12T10:00:00Z"),
            InboxMessage("b", 2, "brand", createdAt = "2026-11-12T10:02:00Z"),
            InboxMessage("c", 3, "customer", createdAt = "2026-11-12T10:03:00Z"),
            InboxMessage("d", 4, "customer", createdAt = Instant.now().toString()),
        )
        val m = InboxThreadModel.preview(conv, msgs)
        val items = m.items(ZoneOffset.UTC)
        val days = items.filterIsInstance<InboxThreadItem.Day>()
        assertEquals(2, days.size)
        assertEquals("Today", days.last().label)
        val shows = items.filterIsInstance<InboxThreadItem.Message>().associate { it.message.id to it.showsTime }
        assertEquals(mapOf("a" to false, "b" to true, "c" to true, "d" to true), shows)
    }

    @Test fun contextOrderIsNewestNonRemovedOrder() {
        val conv = InboxConversation("cv_1", InboxBrandRef("b"))
        val o1 = InboxOrderCard("ord_1", "YD-1")
        val o2 = InboxOrderCard("ord_2", "YD-2")
        val m = InboxThreadModel.preview(conv, listOf(
            InboxMessage("a", 1, order = o1),
            InboxMessage("b", 2, order = o2, status = "removed"),
        ))
        assertEquals("ord_1", m.contextOrder!!.orderId)
    }
}
