package space.yardstore.app.features.inbox

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.features.notifications.NotificationsRouting

/** Yard Support: DTOs (docs/APP.md › Yard Support, exact shapes), the thread model through /api/support/…, the pinned row, links. */
class YardSupportTest {
    private val t = InboxTestServer()

    @Before fun setUp() = t.start()
    @After fun tearDown() = t.stop()

    /** `ConversationSummary` for a support thread, field for field as in docs/APP.md. */
    private fun summary(unread: Int = 0, status: String = "open", lastMessage: Boolean = true, side: String = "support") = """
        { "id": "cv_sup1", "kind": "support",
          "brand": { "id": "yard_support", "handle": "support", "name": "Yard Support", "mark": { "text": "Y", "style": "yard" }, "verified": true },
          "status": "$status",
          "spamState": "none", "locked": false,
          "lastMessage": ${if (lastMessage) """{ "preview": "We've asked the brand.", "at": "2026-11-14T09:00:00.000Z", "side": "$side" }""" else "null"},
          "unread": $unread,
          "markedUnread": false, "archived": false, "muted": false,
          "blocked": { "byMe": false, "byThem": false },
          "sample": false, "createdAt": "2026-11-13T10:00:00.000Z",
          "interaction": { "canSend": true } }"""

    private fun message(id: String, seq: Int, side: String, body: String = "Hello", kind: String = "text", extra: String = "") = """
        { "id": "$id", "seq": $seq, "conversationId": "cv_sup1", "side": "$side", "kind": "$kind", "body": "$body",
          "attachments": [], "status": "sent", "createdAt": "2026-11-14T09:0$seq:00.000Z", "clientId": "c-$id"$extra }"""

    private fun thread(vararg messages: String, hasMore: Boolean = false, unread: Int = 0) = """
        { "conversation": ${summary(unread = unread)}, "messages": [${messages.joinToString(",")}], "hasMore": $hasMore,
          "receipts": { "theirs": { "upToSeq": 1, "at": "2026-11-14T09:05:00.000Z" }, "enabled": true } }"""

    private fun sendResult(message: String) = """{ "message": $message, "conversation": ${summary()} }"""

    private fun bodyOf(method: String, path: String, index: Int = 0): JsonObject =
        Json.parseToJsonElement(t.requests(method, path)[index].body.readUtf8()).jsonObject

    // region DTOs

    @Test fun decodesSupportSummaryExactlyAsTheContract() {
        val c = YardJson.decodeFromString<YardSupportConversationResponse>("""{ "conversation": ${summary(unread = 2)} }""").conversation!!
        assertEquals("support", c.kind)
        assertTrue(c.isSupport)
        assertEquals("Yard Support", c.brand.name)
        assertEquals("support", c.brand.handle)
        assertEquals("Y", c.brand.markText)
        assertEquals("support", c.lastMessage!!.side)
        assertEquals(2, c.unread)
        assertTrue(c.isUnread)
        assertTrue(c.interaction!!.canSend)
        assertNull(YardJson.decodeFromString<YardSupportConversationResponse>("""{ "conversation": null }""").conversation)
        // Brand conversations: `kind` is "brand", and a missing value reads as "brand".
        val brand = YardJson.decodeFromString<InboxConversation>(InboxJson.conversation())
        assertEquals("brand", brand.kind)
        assertFalse(brand.isSupport)
    }

    @Test fun decodesSupportMessagesWithOrderCardAndSystemLine() {
        val order = """, "order": { "orderId": "mo_1", "reference": "NF-16827", "status": "shipped", "placedAt": "2026-11-01T10:00:00.000Z", "total": { "amount": 12000, "currency": "USD" }, "itemCount": 2 }"""
        val t = YardJson.decodeFromString<InboxThread>(thread(
            message("m1", 1, "customer", kind = "order", body = "Where is it?", extra = order),
            message("m2", 2, "support", body = "On its way."),
            message("m3", 3, "system", kind = "system", body = "Reopened"),
        ))
        assertEquals(listOf("customer", "support", "system"), t.messages.map { it.side })
        assertTrue(t.messages[0].isMine)
        assertFalse(t.messages[1].isMine)
        assertFalse(t.messages[1].isSystem)
        assertTrue(t.messages[2].isSystem)
        assertEquals("NF-16827", t.messages[0].order!!.reference)
        assertEquals("$120", t.messages[0].order!!.total.formatted)
        assertTrue(t.conversation.isSupport)
    }

    @Test fun sendBodyPicksKindLikeTheWebsite() {
        val chip = InboxOrderChip("mo_1", "NF-16827")
        assertEquals(YardSupportSendBody("c1", "text", body = "Hi"), YardSupportAPI.body("c1", "Hi", emptyList(), null))
        assertEquals(YardSupportSendBody("c1", "order", body = "Late", orderRefId = "mo_1"), YardSupportAPI.body("c1", "Late", emptyList(), chip))
        assertEquals(YardSupportSendBody("c1", "order", orderRefId = "mo_1"), YardSupportAPI.body("c1", "", emptyList(), chip))
        // Photos win over an attached order (the order isn't sent with them).
        assertEquals(YardSupportSendBody("c1", "image", attachmentIds = listOf("med_1")), YardSupportAPI.body("c1", "", listOf("med_1"), chip))
        // Unset keys are left out (the route is strict).
        assertEquals("""{"clientId":"c1","kind":"text","body":"Hi"}""", YardJson.encodeToString(YardSupportSendBody.serializer(), YardSupportAPI.body("c1", "Hi", emptyList(), null)))
        assertEquals("Order NF-16827", chip.label)
    }

    // endregion

    // region Thread model

    @Test fun noThreadYetStartsAFreshComposer() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        val m = InboxThreadModel.forSupport()
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Ready, m.phase)
        assertTrue(m.isSupport)
        assertNull(m.conversationId)
        assertTrue(m.isEmpty)
        assertNull(m.disabledReason)
        assertEquals("Yard Support", m.displayName)
        assertNull(m.brandHandle)
        assertTrue(t.requests("GET", "/api/support/conversation/messages").isEmpty())
        // Never the brand inbox or a storefront.
        assertTrue(t.requests.none { it.requestUrl!!.encodedPath.startsWith("/api/inbox") || it.requestUrl!!.encodedPath.startsWith("/api/catalog") })
    }

    @Test fun loadsThreadAndMarksYardSupportRepliesRead() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": ${summary(unread = 1)} }""")
        t.on("GET", "/api/support/conversation/messages", body = thread(message("m1", 1, "customer"), message("m2", 2, "support"), hasMore = true, unread = 1))
        t.on("POST", "/api/support/conversation/read", status = 204)
        val m = InboxThreadModel.forSupport()
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Ready, m.phase)
        assertEquals("cv_sup1", m.conversationId)
        assertEquals(listOf("m1", "m2"), m.messages.map { it.id })
        assertTrue(m.hasMore)
        assertEquals("Yard Support", m.brandName)
        assertNull(m.brandHandle)
        assertEquals("50", t.requests("GET", "/api/support/conversation/messages").single().requestUrl!!.queryParameter("limit"))
        assertEquals("""{"upToSeq":2}""", t.requests("POST", "/api/support/conversation/read").single().body.readUtf8())
        assertFalse(m.conversation!!.isUnread)
        assertTrue(t.requests.none { it.requestUrl!!.encodedPath.startsWith("/api/catalog") })
    }

    @Test fun conversationWithoutMessagesTreats404AsFresh() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": ${summary(lastMessage = false)} }""")
        t.on("GET", "/api/support/conversation/messages", status = 404, body = """{"error":{"code":"not_found","message":"Not found."}}""")
        val m = InboxThreadModel.forSupport()
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Ready, m.phase)
        assertTrue(m.isEmpty)
        assertNull(m.disabledReason)
    }

    @Test fun loadFailureShowsTheServerMessage() = runBlocking {
        t.on("GET", "/api/support/conversation", status = 401, body = """{"error":{"code":"unauthenticated","message":"Sign in to continue."}}""")
        val m = InboxThreadModel.forSupport()
        m.load().join()
        assertEquals(InboxThreadModel.Phase.Failed("Sign in to continue."), m.phase)
    }

    @Test fun pollAndOlderPagesUseTheSupportThread() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": ${summary()} }""")
        t.on("GET", "/api/support/conversation/messages", body = thread(message("m5", 5, "customer"), message("m6", 6, "customer"), hasMore = true))
        t.on("GET", "/api/support/conversation/messages", body = thread(message("m7", 7, "support", body = "Replying now")))
        t.on("GET", "/api/support/conversation/messages", body = thread(message("m3", 3, "customer"), message("m4", 4, "support"), hasMore = false))
        t.on("POST", "/api/support/conversation/read", status = 204)
        val m = InboxThreadModel.forSupport()
        m.load().join()
        m.poll().join()
        val poll = t.requests("GET", "/api/support/conversation/messages")[1].requestUrl!!
        assertEquals("6", poll.queryParameter("after"))
        assertEquals("100", poll.queryParameter("limit"))
        assertEquals("""{"upToSeq":7}""", t.requests("POST", "/api/support/conversation/read").last().body.readUtf8())
        m.loadOlder().join()
        val older = t.requests("GET", "/api/support/conversation/messages")[2].requestUrl!!
        assertEquals("5", older.queryParameter("before"))
        assertEquals(listOf("m3", "m4", "m5", "m6", "m7"), m.messages.map { it.id })
        assertFalse(m.hasMore)
    }

    @Test fun firstTextMessageCreatesTheThread() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        t.on("POST", "/api/support/messages", status = 201, body = sendResult(message("m1", 1, "customer", body = "Hi Yard")))
        val m = InboxThreadModel.forSupport()
        m.load().join()
        var created: String? = null
        m.onCreated = { created = it }
        m.send("  Hi Yard ", emptyList())
        t.until { m.pending.isEmpty() && m.messages.isNotEmpty() }
        val body = bodyOf("POST", "/api/support/messages")
        assertEquals(setOf("clientId", "kind", "body"), body.keys)
        assertEquals("text", body["kind"]!!.jsonPrimitive.content)
        assertEquals("Hi Yard", body["body"]!!.jsonPrimitive.content)
        assertTrue(body["clientId"]!!.jsonPrimitive.content.length in 8..64)
        assertEquals("cv_sup1", m.conversationId)
        assertEquals("cv_sup1", created)
        assertEquals(listOf("m1"), m.messages.map { it.id })
    }

    @Test fun orderHelpSendsTheOrderOnceThenClearsTheChip() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        val order = """, "order": { "orderId": "mo_1", "reference": "NF-16827", "status": "shipped", "placedAt": "2026-11-01T10:00:00.000Z", "total": { "amount": 12000, "currency": "USD" }, "itemCount": 2 }"""
        t.on("POST", "/api/support/messages", status = 201, body = sendResult(message("m1", 1, "customer", kind = "order", body = "It hasn't arrived", extra = order)))
        t.on("POST", "/api/support/messages", status = 201, body = sendResult(message("m2", 2, "customer", body = "Thanks")))
        val m = InboxThreadModel.forSupport(InboxOrderChip("mo_1", "NF-16827"))
        m.load().join()
        assertEquals(InboxOrderChip("mo_1", "NF-16827"), m.orderChip)
        assertTrue(m.canSendWithoutText)
        m.send("It hasn't arrived", emptyList())
        assertNull(m.orderChip) // cleared at once, like the website
        t.until { m.messages.size == 1 }
        val first = bodyOf("POST", "/api/support/messages", 0)
        assertEquals("order", first["kind"]!!.jsonPrimitive.content)
        assertEquals("mo_1", first["orderRefId"]!!.jsonPrimitive.content)
        assertEquals("It hasn't arrived", first["body"]!!.jsonPrimitive.content)
        assertEquals("mo_1", m.contextOrder!!.orderId)
        // The next message is plain text: the order isn't attached twice.
        m.send("Thanks", emptyList())
        t.until { m.messages.size == 2 }
        val second = bodyOf("POST", "/api/support/messages", 1)
        assertEquals("text", second["kind"]!!.jsonPrimitive.content)
        assertFalse(second.containsKey("orderRefId"))
    }

    @Test fun orderChipAloneCanBeSentAndRemoved() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        t.on("POST", "/api/support/messages", status = 201, body = sendResult(message("m1", 1, "customer", kind = "order", body = "")))
        val m = InboxThreadModel.forSupport(InboxOrderChip("mo_1", "NF-16827"))
        m.load().join()
        m.send("", emptyList())
        t.until { m.pending.isEmpty() && m.messages.isNotEmpty() }
        val body = bodyOf("POST", "/api/support/messages")
        assertEquals(setOf("clientId", "kind", "orderRefId"), body.keys)

        val other = InboxThreadModel.forSupport(InboxOrderChip("mo_2", "NF-2"))
        other.clearOrderChip()
        assertNull(other.orderChip)
        assertFalse(other.canSendWithoutText)
        other.send("", emptyList()) // nothing to send
        assertTrue(other.pending.isEmpty())
    }

    @Test fun failedSendKeepsTheOrderForRetryWithTheSameClientId() = runBlocking {
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        t.on("POST", "/api/support/messages", status = 400, body = """{"error":{"code":"validation","message":"Check the highlighted fields.","fields":{"orderRefId":"That order isn't one of yours."}}}""")
        t.on("POST", "/api/support/messages", status = 201, body = sendResult(message("m1", 1, "customer", kind = "order")))
        val m = InboxThreadModel.forSupport(InboxOrderChip("mo_9", "NF-9"))
        m.load().join()
        m.send("Help", emptyList())
        t.until { m.pending.singleOrNull()?.isFailed == true }
        assertEquals("NF-9", m.pending.single().order!!.reference)
        m.retry(m.pending.single())
        t.until { m.pending.isEmpty() }
        val a = bodyOf("POST", "/api/support/messages", 0)
        val b = bodyOf("POST", "/api/support/messages", 1)
        assertEquals(a["clientId"], b["clientId"])
        assertEquals("mo_9", b["orderRefId"]!!.jsonPrimitive.content)
    }

    @Test fun photoUploadTargetsTheSupportConversation() = runBlocking {
        t.on("POST", "/api/uploads", status = 201, body = """{ "media": { "id": "med_9", "src": "/api/media/med_9?as=shopper", "width": 800, "height": 600 } }""")
        assertEquals("med_9", YardSupportAPI.uploadPhoto(byteArrayOf(1, 2, 3), "cv_sup1"))
        val url = t.requests("POST", "/api/uploads").single().requestUrl!!
        assertEquals("inbox_attachment", url.queryParameter("purpose"))
        assertEquals("shopper", url.queryParameter("as"))
        assertEquals("cv_sup1", url.queryParameter("conversationId"))
        assertNull(url.queryParameter("brandId"))
    }

    // endregion

    // region Inbox list (pinned row)

    private val emptyPage = """{"items":[],"nextCursor":null}"""

    @Test fun pinsTheSupportThreadOnceItHasAMessage() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = """{"items":[${InboxJson.conversation()}],"nextCursor":null}""")
        t.on("GET", "/api/support/conversation", body = """{ "conversation": ${summary(unread = 1)} }""")
        val m = InboxListModel()
        m.load().join()
        assertEquals("cv_sup1", m.pinnedSupport!!.id)
        assertFalse(m.showsSupportLink)
        assertEquals(listOf("cv_1"), m.items.map { it.id }) // never mixed into the brand list
        m.setFilter(InboxAPI.Filter.Archived)!!.join()
        assertNull(m.pinnedSupport)
        assertFalse(m.showsSupportLink)
    }

    @Test fun showsTheLinkUntilTheThreadExists() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = emptyPage)
        t.on("GET", "/api/support/conversation", body = """{ "conversation": null }""")
        val m = InboxListModel()
        m.load().join()
        assertNull(m.pinnedSupport)
        assertTrue(m.showsSupportLink)
    }

    @Test fun supportReadFailureDoesNotBreakTheList() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = """{"items":[${InboxJson.conversation()}],"nextCursor":null}""")
        t.on("GET", "/api/support/conversation", status = 500, body = """{"error":{"code":"internal","message":"Something went wrong."}}""")
        val m = InboxListModel()
        m.load().join()
        assertEquals(InboxListModel.Phase.Loaded, m.phase)
        assertNull(m.support)
    }

    @Test fun openSupportThreadUpdatesThePinnedRow() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = emptyPage)
        t.on("GET", "/api/support/conversation", body = """{ "conversation": ${summary(unread = 1)} }""")
        val m = InboxListModel()
        m.load().join()
        val read = YardJson.decodeFromString<InboxConversation>(summary(unread = 0))
        m.applySupportUpdate(read)
        assertFalse(m.pinnedSupport!!.isUnread)
        m.applySupportUpdate(YardJson.decodeFromString<InboxConversation>(InboxJson.conversation())) // a brand thread: ignored
        assertEquals("cv_sup1", m.support!!.id)
    }

    // endregion

    // region Links and notifications

    @Test fun supportLinksOpenTheThread() {
        assertEquals(Route.YardSupport(), Route.fromUrl("https://yardstore.space/inbox?support=1"))
        assertEquals(Route.YardSupport("mo_1", "NF-16827"), Route.fromUrl("https://yardstore.space/inbox?support=1&order=mo_1&orderRef=NF-16827"))
        assertEquals(Route.YardSupport(), Route.fromUrl("yard://inbox?support=1"))
        // The push / notification href for a Yard Support reply.
        assertEquals(Route.YardSupport(), NotificationsRouting.route("/inbox?support=1"))
        // Brand threads are unchanged.
        assertEquals(Route.Conversation("cv_1"), NotificationsRouting.route("/inbox?thread=cv_1"))
        assertEquals(Route.Inbox, Route.fromUrl("https://yardstore.space/inbox"))
    }

    // endregion
}

private suspend fun InboxTestServer.until(check: () -> Boolean) =
    kotlinx.coroutines.withTimeout(5_000) { while (!check()) kotlinx.coroutines.delay(10) }
