package space.yardstore.app.features.inbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.YardJson

class InboxModelsTest {
    @Test fun decodesConversationsPage() {
        val json = """{"items":[${InboxJson.conversation(unread = 2, byMe = true)}],"nextCursor":"c2"}"""
        val page = YardJson.decodeFromString(InboxConversationsPage.serializer(), json)
        assertEquals("c2", page.nextCursor)
        val c = page.items.single()
        assertEquals("Acme Studio", c.brand.name)
        assertEquals("AS", c.brand.markText)
        assertTrue(c.brand.verified)
        assertTrue(c.isUnread)
        assertTrue(c.blockedByMe)
        assertFalse(c.blockedByThem)
        assertEquals("2026-11-13T09:00:00.000Z", c.sortAt)
        assertEquals("Restock lands Friday.", c.previewText)
        assertNull(c.interaction)
        assertFalse(c.markingRead().isUnread)
    }

    @Test fun conversationDefaultsAndPreviewText() {
        val c = YardJson.decodeFromString(InboxConversation.serializer(), """{"id":"cv_9","brand":{"id":"b"},"lastMessage":null,"blocked":null}""")
        assertEquals("open", c.status)
        assertEquals("No messages yet", c.previewText)
        assertEquals("", c.sortAt)
        val mine = c.copy(lastMessage = InboxLastMessage("Hi", "2026-11-13T09:00:00Z", "customer"))
        assertEquals("You: Hi", mine.previewText)
        assertEquals("Hi", mine.copy(lastMessage = mine.lastMessage!!.copy(held = true)).previewText)
    }

    @Test fun decodesThreadWithCardsAttachmentsAndStates() {
        val product = ""","product":{"productId":"prd_1","slug":"boxy-tee","name":"Boxy tee","price":{"amount":4500,"currency":"USD"},"variantLabel":"M / Black"}"""
        val order = ""","order":{"orderId":"ord_1","reference":"YD-4821","status":"shipped","placedAt":"2026-11-10T10:00:00.000Z","total":{"amount":12000.4,"currency":"USD"},"itemCount":2}"""
        val photos = """[{"mediaId":"med_1","src":"/api/media/med_1?as=shopper","width":1200,"height":1600}]"""
        val json = InboxJson.thread(
            InboxJson.conversation(interaction = """{"canSend":false,"reason":"restricted","until":"2026-12-01T00:00:00.000Z"}"""),
            listOf(
                InboxJson.message("m1", 1, attachments = photos, extra = product),
                InboxJson.message("m2", 2, side = "customer", extra = order),
                InboxJson.message("m3", 3, body = null, status = "removed"),
                InboxJson.message("m4", 4, side = "system", body = "Acme Studio marked this resolved."),
            ),
            hasMore = true,
        )
        val t = YardJson.decodeFromString(InboxThread.serializer(), json)
        assertTrue(t.hasMore)
        assertEquals(4, t.messages.size)
        val m1 = t.messages[0]
        assertEquals("Boxy tee", m1.product!!.name)
        assertEquals("$45", m1.product!!.price.formatted)
        assertEquals("/api/media/med_1?as=shopper", m1.attachments.single().url)
        val m2 = t.messages[1]
        assertTrue(m2.isMine)
        assertEquals(12000, m2.order!!.total.minor)
        assertEquals(2, m2.order!!.itemCount)
        assertTrue(t.messages[2].isRemoved)
        assertNull(t.messages[2].body)
        assertTrue(t.messages[3].isSystem)
        assertEquals("restricted", t.conversation.interaction!!.reason)
        assertFalse(t.conversation.interaction!!.canSend)
    }

    @Test fun byBrandInteractionMapsBlocked() {
        val none = YardJson.decodeFromString(InboxByBrand.serializer(), """{"conversation":null,"canMessage":true}""")
        assertNull(none.conversation)
        assertTrue(none.interaction.canSend)
        val blocked = YardJson.decodeFromString(InboxByBrand.serializer(), """{"conversation":null,"canMessage":false,"reason":"blocked"}""")
        assertEquals("blocked_by_them", blocked.interaction.reason)
        val existing = YardJson.decodeFromString(InboxByBrand.serializer(), """{"conversation":${InboxJson.conversation()},"canMessage":true}""")
        assertEquals("cv_1", existing.conversation!!.id)
    }

    @Test fun sendBodyOmitsUnsetKeys() {
        val existing = YardJson.encodeToString(InboxSendBody.serializer(), InboxSendBody(conversationId = "cv_1", clientId = "abcdef12", kind = "text", body = "Hi"))
        assertEquals("""{"conversationId":"cv_1","clientId":"abcdef12","kind":"text","body":"Hi"}""", existing)
        val fresh = YardJson.encodeToString(InboxSendBody.serializer(), InboxSendBody(brandId = "brd_1", origin = "inbox", clientId = "abcdef12", kind = "image", attachmentIds = listOf("med_1")))
        assertEquals("""{"brandId":"brd_1","clientId":"abcdef12","kind":"image","attachmentIds":["med_1"],"origin":"inbox"}""", fresh)
        assertEquals("""{"muted":true}""", YardJson.encodeToString(InboxPatchBody.serializer(), InboxPatchBody(muted = true)))
        assertEquals("""{"upToSeq":7}""", YardJson.encodeToString(InboxReadBody.serializer(), InboxReadBody(7)))
    }

    @Test fun decodesSendUploadAndUnread() {
        val sent = YardJson.decodeFromString(InboxSendResult.serializer(), """{"message":${InboxJson.message("m9", 9, side = "customer")},"conversation":${InboxJson.conversation()}}""")
        assertEquals(9, sent.message.seq)
        val up = YardJson.decodeFromString(InboxUploadResult.serializer(), """{"media":{"id":"med_7","src":"/api/media/med_7?as=shopper","width":10}}""")
        assertEquals("med_7", up.media.id)
        assertEquals(3, YardJson.decodeFromString(InboxUnreadCount.serializer(), """{"conversations":3}""").conversations)
    }

    @Test fun mergedUnionsByIdOrderedBySeq() {
        val a = listOf(InboxMessage("m2", 2, createdAt = "b"), InboxMessage("m1", 1, createdAt = "a"))
        val b = listOf(InboxMessage("m2", 2, body = "edited", createdAt = "b"), InboxMessage("m3", 3, createdAt = "c"))
        val out = InboxThreadModel.merged(a, b)
        assertEquals(listOf("m1", "m2", "m3"), out.map { it.id })
        assertEquals("edited", out[1].body)
    }
}
