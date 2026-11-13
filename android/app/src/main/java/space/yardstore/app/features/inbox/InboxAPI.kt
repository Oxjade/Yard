package space.yardstore.app.features.inbox

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.ui.graphics.vector.ImageVector
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.models.StorefrontBrand
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.networking.MultipartPart

/** The shopper inbox endpoints (src/app/api/inbox/…, src/app/api/uploads). Mirrors `InboxAPI.swift`. */
object InboxAPI {
    /** Which list the inbox shows (`filter` on GET /api/inbox/conversations). */
    enum class Filter(val rawValue: String, val title: String, val icon: ImageVector) {
        Inbox("inbox", "Inbox", Icons.Outlined.Inbox),
        Archived("archived", "Archived", Icons.Outlined.Archive),
        Blocked("blocked", "Blocked", Icons.Outlined.Block),
    }

    /** Test hook: a client pointed at a mock server. Null = the app's shared client. */
    internal var client: APIClient? = null

    private val api: APIClient get() = client ?: APIClient.shared

    private fun encoded(id: String): String = Config.encodePath(id)

    /** GET /api/inbox/conversations?q=&filter=blocked|archived&cursor= */
    suspend fun conversations(filter: Filter, query: String, cursor: String?): InboxConversationsPage {
        val items = mutableListOf<Pair<String, String?>>()
        val q = query.trim()
        if (q.isNotEmpty()) items += "q" to q.take(100)
        if (filter != Filter.Inbox) items += "filter" to filter.rawValue
        if (cursor != null) items += "cursor" to cursor
        return api.get("/api/inbox/conversations", items)
    }

    /** GET /api/inbox/conversations/{id}/messages?before=&after=&limit= */
    suspend fun thread(id: String, before: Int? = null, after: Int? = null, limit: Int = 50): InboxThread {
        val items = mutableListOf<Pair<String, String?>>("limit" to limit.toString())
        if (before != null) items += "before" to before.toString()
        if (after != null) items += "after" to after.toString()
        return api.get("/api/inbox/conversations/${encoded(id)}/messages", items)
    }

    /** GET /api/inbox/conversations/by-brand/{brandId} */
    suspend fun byBrand(brandId: String): InboxByBrand =
        api.get("/api/inbox/conversations/by-brand/${encoded(brandId)}")

    /** POST /api/inbox/messages */
    suspend fun send(body: InboxSendBody): InboxSendResult = api.post("/api/inbox/messages", body)

    /** POST /api/inbox/conversations/{id}/read { upToSeq } → 204 */
    suspend fun markRead(id: String, upToSeq: Int) {
        api.send(HTTPMethod.POST, "/api/inbox/conversations/${encoded(id)}/read", InboxReadBody(upToSeq = maxOf(0, upToSeq)))
    }

    /** Mark read from the list, where the row doesn't carry the last seq: read the newest message first. */
    suspend fun markReadLatest(id: String) {
        val t = thread(id, limit = 1)
        val seq = t.messages.maxOfOrNull { it.seq } ?: 0
        markRead(id, seq)
    }

    /** PATCH /api/inbox/conversations/{id} { archived?, muted? } */
    suspend fun patch(id: String, archived: Boolean? = null, muted: Boolean? = null): InboxConversation {
        val r: InboxConversationResponse = api.patch("/api/inbox/conversations/${encoded(id)}", InboxPatchBody(archived = archived, muted = muted))
        return r.conversation
    }

    /** POST (block) / DELETE (unblock) /api/inbox/blocks { brandId } */
    suspend fun setBlocked(on: Boolean, brandId: String) {
        api.send(if (on) HTTPMethod.POST else HTTPMethod.DELETE, "/api/inbox/blocks", InboxBlockBody(brandId = brandId))
    }

    /** GET /api/catalog/storefronts/{handle or brand id} (public): the brand's name, handle and logo. */
    suspend fun brand(idOrHandle: String): StorefrontBrand {
        val s: PublicStorefront = api.get("/api/catalog/storefronts/${encoded(idOrHandle)}")
        return s.brand
    }

    /** GET /api/catalog/products?ids=…: one batched read for the photos of shared product cards. */
    suspend fun products(ids: List<String>): List<Product> {
        val unique = ids.distinct().take(60)
        if (unique.isEmpty()) return emptyList()
        val items: MutableList<Pair<String, String?>> = unique.map { "ids" to it }.toMutableList()
        items += "limit" to minOf(60, unique.size).toString()
        val page: ProductsPage = api.get("/api/catalog/products", items)
        return page.products
    }

    /**
     * POST /api/uploads?purpose=inbox_attachment&as=shopper&(conversationId=|brandId=), multipart field `file`.
     * Returns the media id to pass in `attachmentIds`.
     */
    suspend fun uploadPhoto(jpeg: ByteArray, conversationId: String?, brandId: String): String {
        val query = mutableListOf<Pair<String, String?>>(
            "purpose" to "inbox_attachment",
            "as" to "shopper",
        )
        if (conversationId != null) query += "conversationId" to conversationId else query += "brandId" to brandId
        val r: InboxUploadResult = api.upload(
            "/api/uploads",
            listOf(MultipartPart.File("file", "photo.jpg", "image/jpeg", jpeg)),
            query = query,
        )
        return r.media.id
    }
}
