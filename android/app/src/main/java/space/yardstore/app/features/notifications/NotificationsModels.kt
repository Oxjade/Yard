package space.yardstore.app.features.notifications

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.models.YardJson
import java.net.URI
import java.net.URLDecoder
import java.time.Instant

// Models for the shopper's in-app notifications. Mirrors `NotificationsModels.swift`.
// Source of truth: src/lib/api/contracts/notifications.ts (notificationDto) and
// src/server/notify.ts (toNotificationDto).

/** One server notification (GET /api/notifications?as=shopper → `{ items: [...] }`). */
@Serializable
data class ShopperNotification(
    val id: String,
    /** The server event key ("msg:cv_…", "shipped:ord_…"). Mark-read calls send these keys. Falls back to [id]. */
    val key: String = "",
    val category: String = "",
    val title: String = "",
    val body: String = "",
    /** A same-origin path ("/you/orders/ord_1", "/drops/slug", "/inbox?thread=cv_1") or null. */
    val href: String? = null,
    /** ISO timestamp. */
    val at: String = "",
    val read: Boolean = false,
) {
    /** The key mark-read sends (the Swift decoder falls back to the id when `key` is missing). */
    val eventKey: String get() = key.ifEmpty { id }
    val date: Instant? get() = YardDate.parse(at)
    val kind: ShopperNotificationKind get() = ShopperNotificationKind.from(category)
    /** The in-app destination of [href], if the app has that page. */
    val route: Route? get() = NotificationsRouting.route(href)
}

/** `{ items }`. One malformed row never hides the rest (decoded one by one, bad rows dropped). */
@Serializable
data class NotificationsListResponse(val items: List<JsonElement> = emptyList()) {
    val notifications: List<ShopperNotification>
        get() = items.mapNotNull { runCatching { YardJson.decodeFromJsonElement(ShopperNotification.serializer(), it) }.getOrNull() }
}

/** POST /api/notifications/read?as=shopper — `{ keys?, all?, read? }` (strict: no other fields; nulls are not sent). */
@Serializable
data class NotificationsReadBody(
    val keys: List<String>? = null,
    val all: Boolean? = null,
    val read: Boolean? = null,
)

/** `{ updated, keys, read }`. */
@Serializable
data class NotificationsReadResult(
    val updated: Int? = null,
    val keys: List<String>? = null,
    val read: Boolean? = null,
)

/** Visual family of a notification, from its server `category`. */
enum class ShopperNotificationKind {
    Drop, Order, Message, Follow, Wishlist, Account, Other;

    val icon: ImageVector
        get() = when (this) {
            Drop -> Icons.Outlined.LocalFireDepartment
            Order -> Icons.Outlined.Inventory2
            Message -> Icons.Outlined.Forum
            Follow -> Icons.Outlined.PersonAddAlt
            Wishlist -> Icons.Outlined.LocalOffer
            Account -> Icons.Outlined.AccountCircle
            Other -> Icons.Outlined.Notifications
        }

    /** Short label (matches the website's category labels). */
    val label: String
        get() = when (this) {
            Drop -> "Drop"
            Order -> "Delivery"
            Message -> "Inbox"
            Follow -> "Following"
            Wishlist -> "Wishlist"
            Account -> "Account"
            Other -> "Yard"
        }

    companion object {
        fun from(category: String): ShopperNotificationKind = when (category) {
            "drop_update", "drops", "drop_live", "drop_performance" -> Drop
            "delivery_update", "delivery_complaint", "orders", "order_confirmed", "order_shipped",
            "order_delivered", "refund", "shipping_issue" -> Order
            "new_message" -> Message
            "followed_activity", "new_follower", "brand_announcement", "chart_movement" -> Follow
            "price_drop", "price_drops", "back_in_stock", "wishlist_update" -> Wishlist
            "account_status", "account", "report_update", "content_moderation" -> Account
            else -> Other
        }
    }
}

/** Maps a notification `href` (always a same-origin path) to an app route. */
object NotificationsRouting {
    fun route(href: String?): Route? {
        if (href == null || !href.startsWith("/") || href.startsWith("//")) return null
        // The website never sends Studio/admin paths to shoppers, but be safe.
        if (href.startsWith("/studio") || href.startsWith("/admin")) return null
        val url = Config.url(href) ?: return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val parts = (uri.path ?: "").split("/").filter { it.isNotEmpty() }
        // Inbox links are "/inbox?thread=cv_…" (src/server/inbox/service.ts threadHref).
        if (parts.firstOrNull() == "inbox") {
            val thread = (uri.rawQuery ?: "").split("&").firstNotNullOfOrNull { item ->
                val i = item.indexOf('=')
                if (i > 0 && item.substring(0, i) == "thread") {
                    runCatching { URLDecoder.decode(item.substring(i + 1).replace("+", "%2B"), "UTF-8") }.getOrNull()
                } else {
                    null
                }
            }
            if (!thread.isNullOrEmpty()) return Route.Conversation(id = thread)
        }
        return Route.fromUrl(url)
    }
}
