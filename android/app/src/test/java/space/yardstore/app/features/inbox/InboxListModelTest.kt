package space.yardstore.app.features.inbox

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIError

class InboxListModelTest {
    private val t = InboxTestServer()

    @Before fun setUp() = t.start()
    @After fun tearDown() = t.stop()

    private fun page(vararg items: String, next: String? = null) =
        """{"items":[${items.joinToString(",")}],"nextCursor":${next?.let { "\"$it\"" } ?: "null"}}"""

    @Test fun loadSortsNewestFirstAndPages() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(
            InboxJson.conversation("cv_old", at = "2026-11-01T10:00:00.000Z"),
            InboxJson.conversation("cv_new", at = "2026-11-13T10:00:00.000Z"),
            next = "cur_2",
        ))
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_new"), InboxJson.conversation("cv_3", at = "2026-10-01T10:00:00.000Z")))
        val m = InboxListModel()
        m.load().join()
        assertEquals(InboxListModel.Phase.Loaded, m.phase)
        assertEquals(listOf("cv_new", "cv_old"), m.items.map { it.id })
        assertEquals("cur_2", m.nextCursor)
        m.loadMore()!!.join()
        assertEquals(listOf("cv_new", "cv_old", "cv_3"), m.items.map { it.id })
        assertNull(m.nextCursor)
        assertFalse(m.isLoadingMore)
        assertEquals("cur_2", t.requests("GET", "/api/inbox/conversations").last().requestUrl!!.queryParameter("cursor"))
        assertNull(m.loadMore())
    }

    @Test fun filterAndSearchQueryParams() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page())
        val m = InboxListModel()
        m.load().join()
        assertNull(t.requests.last().requestUrl!!.queryParameter("filter"))
        m.setFilter(InboxAPI.Filter.Archived)!!.join()
        assertEquals("archived", t.requests.last().requestUrl!!.queryParameter("filter"))
        assertNull(m.setFilter(InboxAPI.Filter.Archived))
        m.search("tee")!!.join()
        assertEquals("tee", t.requests.last().requestUrl!!.queryParameter("q"))
        assertEquals("archived", t.requests.last().requestUrl!!.queryParameter("filter"))
        assertTrue(m.items.isEmpty())
        assertEquals(InboxListModel.Phase.Loaded, m.phase)
    }

    @Test fun firstLoadErrorFailsButRefreshErrorKeepsList() = runBlocking {
        t.on("GET", "/api/inbox/conversations", status = 401, body = """{"error":{"code":"unauthorized","message":"Sign in to continue."}}""")
        val m = InboxListModel()
        m.load().join()
        assertEquals(InboxListModel.Phase.Failed("Sign in to continue."), m.phase)
    }

    @Test fun refreshFailureKeepsLoadedRows() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_1")))
        t.on("GET", "/api/inbox/conversations", status = 500)
        val m = InboxListModel()
        m.load().join()
        m.refresh().join()
        assertEquals(InboxListModel.Phase.Loaded, m.phase)
        assertEquals(1, m.items.size)
    }

    @Test fun archiveRemovesFromInboxAndMuteReplaces() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_1"), InboxJson.conversation("cv_2", at = "2026-11-12T10:00:00.000Z")))
        t.on("PATCH", "/api/inbox/conversations/cv_1", body = """{"conversation":${InboxJson.conversation("cv_1", archived = true)}}""")
        t.on("PATCH", "/api/inbox/conversations/cv_2", body = """{"conversation":${InboxJson.conversation("cv_2", muted = true)}}""")
        val m = InboxListModel()
        m.load().join()
        m.setArchived(true, m.items[0])
        assertEquals(listOf("cv_2"), m.items.map { it.id })
        m.setMuted(true, m.items[0])
        assertTrue(m.items[0].muted)
        assertTrue(m.busyIds.isEmpty())
        assertEquals("""{"archived":true}""", t.requests("PATCH", "/api/inbox/conversations/cv_1").single().body.readUtf8())
    }

    @Test fun markReadReadsNewestSeqFirst() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_1", unread = 3)))
        t.on("GET", "/api/inbox/conversations/cv_1/messages", body = InboxJson.thread(InboxJson.conversation("cv_1"), listOf(InboxJson.message("m9", 9))))
        t.on("POST", "/api/inbox/conversations/cv_1/read", status = 204)
        val m = InboxListModel()
        m.load().join()
        m.markRead(m.items[0])
        assertFalse(m.items[0].isUnread)
        assertEquals("1", t.requests("GET", "/api/inbox/conversations/cv_1/messages").single().requestUrl!!.queryParameter("limit"))
        assertEquals("""{"upToSeq":9}""", t.requests("POST", "/api/inbox/conversations/cv_1/read").single().body.readUtf8())
    }

    @Test fun unblockRemovesRowAndSendsDelete() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_1", byMe = true)))
        t.on("DELETE", "/api/inbox/blocks", status = 204)
        val m = InboxListModel()
        m.setFilter(InboxAPI.Filter.Blocked)!!.join()
        m.unblock(m.items[0])
        assertTrue(m.items.isEmpty())
        assertEquals("""{"brandId":"brd_acme"}""", t.requests("DELETE", "/api/inbox/blocks").single().body.readUtf8())
    }

    @Test fun actionErrorPropagatesAndClearsBusy() = runBlocking {
        t.on("GET", "/api/inbox/conversations", body = page(InboxJson.conversation("cv_1")))
        t.on("PATCH", "/api/inbox/conversations/cv_1", status = 429, body = """{"error":{"code":"rate_limited","message":"Too many tries."}}""")
        val m = InboxListModel()
        m.load().join()
        val e = runCatching { m.setMuted(true, m.items[0]) }.exceptionOrNull()
        assertEquals("Too many tries.", (e as APIError).message)
        assertTrue(m.busyIds.isEmpty())
        assertFalse(m.items[0].muted)
    }

    @Test fun uploadPhotoUsesShopperPurposeAndScope() = runBlocking {
        t.on("POST", "/api/uploads", status = 201, body = """{"media":{"id":"med_42","src":"/api/media/med_42?as=shopper"}}""")
        assertEquals("med_42", InboxAPI.uploadPhoto(byteArrayOf(1, 2, 3), conversationId = null, brandId = "brd_acme"))
        val r = t.requests("POST", "/api/uploads").single()
        val url = r.requestUrl!!
        assertEquals("inbox_attachment", url.queryParameter("purpose"))
        assertEquals("shopper", url.queryParameter("as"))
        assertEquals("brd_acme", url.queryParameter("brandId"))
        assertNull(url.queryParameter("conversationId"))
        assertTrue(r.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        assertTrue(r.body.readUtf8().contains("name=\"file\"; filename=\"photo.jpg\""))
    }

    @Test fun sortedTieBreaksById() {
        val a = InboxConversation("a", InboxBrandRef("b"), createdAt = "2026-11-01")
        val b = InboxConversation("b", InboxBrandRef("b"), createdAt = "2026-11-01")
        assertEquals(listOf("b", "a"), InboxListModel.sorted(listOf(a, b)).map { it.id })
    }

    // Two-pane inbox: the open thread's conversation flows back into the list.

    private suspend fun loadedTwo(): InboxListModel {
        t.on("GET", "/api/inbox/conversations", body = page(
            InboxJson.conversation("cv_1", unread = 2, at = "2026-11-12T10:00:00.000Z"),
            InboxJson.conversation("cv_2", at = "2026-11-13T10:00:00.000Z"),
        ))
        val m = InboxListModel()
        m.load().join()
        assertEquals(listOf("cv_2", "cv_1"), m.items.map { it.id })
        return m
    }

    @Test fun threadUpdateClearsUnreadAndResorts() = runBlocking {
        val m = loadedTwo()
        val row = m.items.first { it.id == "cv_1" }
        val fromThread = row.markingRead().copy(
            lastMessage = InboxLastMessage("Thanks!", "2026-11-13T11:00:00.000Z", "customer"),
            interaction = InboxInteraction(canSend = true),
        )
        m.applyThreadUpdate(fromThread)
        assertEquals(listOf("cv_1", "cv_2"), m.items.map { it.id })
        val updated = m.items.first()
        assertFalse(updated.isUnread)
        assertEquals("You: Thanks!", updated.previewText)
        assertNull(updated.interaction)
    }

    @Test fun threadUpdateKeepsListPreviewWhenThreadHasNone() = runBlocking {
        val m = loadedTwo()
        val row = m.items.first { it.id == "cv_1" }
        m.applyThreadUpdate(row.copy(lastMessage = null, muted = true))
        val updated = m.items.first { it.id == "cv_1" }
        assertTrue(updated.muted)
        assertEquals(row.lastMessage, updated.lastMessage)
        assertEquals(listOf("cv_2", "cv_1"), m.items.map { it.id })
    }

    @Test fun threadUpdateRemovesRowsThatLeaveTheFilterAndIgnoresUnknown() = runBlocking {
        val m = loadedTwo()
        m.applyThreadUpdate(m.items.first { it.id == "cv_2" }.copy(archived = true))
        assertEquals(listOf("cv_1"), m.items.map { it.id })
        m.applyThreadUpdate(InboxConversation("cv_9", InboxBrandRef("b"), createdAt = "2026-11-13"))
        assertEquals(listOf("cv_1"), m.items.map { it.id })
        m.applyThreadUpdate(m.items.first().copy(blocked = InboxBlocked(byMe = true)))
        assertTrue(m.items.isEmpty())
    }
}
