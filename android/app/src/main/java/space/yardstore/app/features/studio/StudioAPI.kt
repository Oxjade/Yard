package space.yardstore.app.features.studio

import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.networking.MultipartPart
import java.util.UUID

// Every Studio endpoint the app calls (docs/APP.md › Studio in the app). Brand-session calls go
// through [StudioStore.call] (switch first, re-switch and retry once on 401); the shopper-session
// ones (apply, categories) go straight to the client.

private fun enc(id: String) = Config.encodePath(id)

// region Shopper session (no brand session needed)

/** GET /api/catalog/categories (public, cached 5 min on the server). */
suspend fun StudioStore.categories(): List<StudioCategory> =
    api.get<StudioCategoriesResponse>(p("/api/catalog/categories")).categories

/** GET /api/studio/apply → the latest application (short or website), or null. */
suspend fun StudioStore.latestApplication(): StudioApplication? =
    api.get<StudioApplicationResponse>(p("/api/studio/apply")).application

/** POST /api/studio/apply. */
suspend fun StudioStore.submitApplication(body: StudioApplyBody): StudioApplyResult =
    api.post(p("/api/studio/apply"), body)

// endregion

// region Home

suspend fun StudioStore.dashboard(days: Int): StudioDashboard =
    call { it.get(p("/api/studio/dashboard"), listOf("days" to days.toString())) }

// endregion

// region Orders

/** GET /api/studio/orders with one tab's query (`fulfilment=…` / `returns=open`), paged by `before`. */
suspend fun StudioStore.orders(query: List<Pair<String, String?>>, before: String? = null, limit: Int = 30): StudioOrdersPage =
    call { it.get(p("/api/studio/orders"), query + listOf("before" to before, "limit" to limit.toString())) }

suspend fun StudioStore.order(id: String): StudioOrderDetail =
    call { it.get<StudioOrderResponse>(p("/api/studio/orders/${enc(id)}")).order }

suspend fun StudioStore.startProcessing(id: String): StudioOrderEnvelope =
    call { it.post(p("/api/studio/orders/${enc(id)}/processing")) }

suspend fun StudioStore.markShipped(id: String, carrier: String?, tracking: String?) {
    call { it.send(HTTPMethod.POST, p("/api/studio/orders/${enc(id)}/shipment"), StudioShipmentBody(status = "shipped", carrier = carrier, trackingNumber = tracking)) }
}

suspend fun StudioStore.cancelOrder(id: String, reason: String, restock: Boolean, idempotencyKey: String = UUID.randomUUID().toString()): StudioOrderEnvelope =
    call { it.post(p("/api/studio/orders/${enc(id)}/cancel"), StudioCancelBody(reason = reason, restock = restock, idempotencyKey = idempotencyKey)) }

suspend fun StudioStore.refundOrder(id: String, amountMinor: Long, reason: String, idempotencyKey: String = UUID.randomUUID().toString()): StudioOrderEnvelope =
    call { it.post(p("/api/studio/orders/${enc(id)}/refunds"), StudioRefundBody(amountMinor = amountMinor, reason = reason, idempotencyKey = idempotencyKey)) }

/** POST /api/auth/reauth?as=brand { password } — re-confirms the brand session for 5 minutes. */
suspend fun StudioStore.reauthWithPassword(password: String) {
    call { it.send(HTTPMethod.POST, p("/api/auth/reauth"), StudioReauthBody(password), query = listOf("as" to "brand")) }
}

// endregion

// region Products

/** GET /api/studio/catalog/products?status=&q=&lowStock=1&limit=&offset= */
suspend fun StudioStore.products(status: String = "all", q: String = "", lowStock: Boolean = false, offset: Int = 0, limit: Int = 30): StudioProductsPage =
    call {
        it.get(
            p("/api/studio/catalog/products"),
            listOf(
                "status" to status,
                "q" to q.trim().takeIf { s -> s.isNotEmpty() },
                "lowStock" to (if (lowStock) "1" else null),
                "limit" to limit.toString(),
                "offset" to offset.takeIf { o -> o > 0 }?.toString(),
            ),
        )
    }

suspend fun StudioStore.product(id: String): StudioProduct =
    call { it.get<StudioProductResponse>(p("/api/studio/catalog/products/${enc(id)}")).product }

/** Stock +/-: `mode adjust` adds [qty] (negative removes). */
suspend fun StudioStore.adjustStock(variantId: String, qty: Int): StudioStockResult =
    call { it.post(p("/api/studio/catalog/variants/${enc(variantId)}/stock"), StudioStockBody(mode = "adjust", qty = qty, reason = if (qty > 0) "restock" else "correction")) }

/** publish | unpublish with the product's current `version` (409 when it changed elsewhere). */
suspend fun StudioStore.setStatus(productId: String, action: String, version: Int): StudioProduct =
    call { it.post<StudioProductResponse>(p("/api/studio/catalog/products/${enc(productId)}/status"), StudioStatusBody(action = action, expectedVersion = version)).product }

/** Quick add step 1: POST /api/uploads?purpose=social_post&as=brand (one `file` part, Content-Length set). */
suspend fun StudioStore.uploadPhoto(jpeg: ByteArray): StudioUploadResult.Media =
    call {
        it.upload<StudioUploadResult>(
            p("/api/uploads"),
            listOf(MultipartPart.File("file", "photo.jpg", "image/jpeg", jpeg)),
            query = listOf("purpose" to "social_post", "as" to "brand"),
        ).media
    }

/** Quick add step 2: POST /api/studio/catalog/products → a draft. */
suspend fun StudioStore.createProduct(body: StudioProductCreateBody): StudioProduct =
    call { it.post<StudioProductResponse>(p("/api/studio/catalog/products"), body).product }

// endregion

// region Website pieces

suspend fun StudioStore.websitePieces(): StudioSitePieces =
    call { it.get(p("/api/studio/catalog/website-pieces")) }

suspend fun StudioStore.websitePiece(id: String, add: Boolean): StudioSitePieces =
    call { it.post(p("/api/studio/catalog/website-pieces/${enc(id)}"), StudioSitePieceAction(if (add) "add" else "skip")) }

// endregion

// region Payouts

suspend fun StudioStore.payouts(): StudioPayouts = call { it.get(p("/api/studio/payouts")) }

// endregion

// region Inbox

suspend fun StudioStore.conversations(filter: String = "open", cursor: String? = null): StudioConversationsPage =
    call { it.get(p("/api/studio/inbox/conversations"), listOf("filter" to filter, "cursor" to cursor)) }

suspend fun StudioStore.thread(conversationId: String): StudioThread =
    call { it.get(p("/api/studio/inbox/conversations/${enc(conversationId)}/messages"), listOf("limit" to "50")) }

suspend fun StudioStore.reply(conversationId: String, text: String, clientId: String = UUID.randomUUID().toString()): StudioSendResult =
    call { it.post(p("/api/studio/inbox/messages"), StudioSendBody(conversationId = conversationId, clientId = clientId, body = text)) }

suspend fun StudioStore.markThreadRead(conversationId: String, upToSeq: Int) {
    call { it.send(HTTPMethod.POST, p("/api/studio/inbox/conversations/${enc(conversationId)}/read"), StudioReadBody(upToSeq)) }
}

suspend fun StudioStore.inboxUnread(): Int = call { it.get<StudioUnread>(p("/api/studio/inbox/unread")).conversations }

/** Yard Support for the brand (`/api/studio/support/…`, same shapes). Null until the first message. */
suspend fun StudioStore.supportConversation(): StudioConversation? =
    call { it.get<StudioSupportConversation>(p("/api/studio/support/conversation")).conversation }

suspend fun StudioStore.supportThread(): StudioThread =
    call { it.get(p("/api/studio/support/conversation/messages"), listOf("limit" to "50")) }

suspend fun StudioStore.supportReply(text: String, clientId: String = UUID.randomUUID().toString()): StudioSendResult =
    call { it.post(p("/api/studio/support/messages"), StudioSendBody(conversationId = null, clientId = clientId, body = text)) }

suspend fun StudioStore.markSupportRead(upToSeq: Int) {
    call { it.send(HTTPMethod.POST, p("/api/studio/support/conversation/read"), StudioReadBody(upToSeq)) }
}

// endregion

// region Settings

suspend fun StudioStore.notificationSettings(): StudioNotificationSettings =
    call { it.get(p("/api/studio/settings/notifications")) }

suspend fun StudioStore.saveNotificationSettings(push: StudioPushChoices): StudioNotificationSettings =
    call { it.put(p("/api/studio/settings/notifications"), StudioNotificationSettings(push)) }

suspend fun StudioStore.testPush(): StudioPushTest = call { it.post(p("/api/studio/push/test")) }

// endregion
