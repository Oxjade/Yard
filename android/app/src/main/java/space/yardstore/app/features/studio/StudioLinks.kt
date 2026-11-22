package space.yardstore.app.features.studio

import java.net.URI
import java.net.URLDecoder

/**
 * A Studio destination from a deep link or a push (docs/APP.md › Push for brands):
 * `yard://studio` (home), `yard://studio/orders[/{id}]`, `yard://studio/inbox[/{conversationId}]`,
 * `yard://studio/support`, `yard://studio/products[/{id}]`, `yard://studio/products/suggestions`,
 * `yard://studio/payouts`. The push's
 * web path (`/studio/orders/{id}`, `/studio/inbox?thread={id}`, …) maps the same way.
 */
sealed interface StudioLink {
    data object Home : StudioLink
    data object Orders : StudioLink
    data class Order(val id: String) : StudioLink
    data object Inbox : StudioLink
    data class Conversation(val id: String) : StudioLink
    data object Support : StudioLink
    data object Products : StudioLink
    data class Product(val id: String) : StudioLink
    /** Suggestions from Yard; [focusAcceptAll] from `?focus=accept-all` ("Yard prepared N products for you"). */
    data class Suggestions(val focusAcceptAll: Boolean = false) : StudioLink
    data object Payouts : StudioLink

    companion object {
        /**
         * Parses `yard://studio/…`, a site path `/studio/…` or `https://<site>/studio/…`. Null for
         * anything that isn't a Studio link. Unknown Studio pages open Studio home.
         */
        fun parse(url: String?): StudioLink? {
            val raw = url?.trim().orEmpty()
            if (raw.isEmpty()) return null
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            val parts = (uri.rawPath ?: "").split("/").filter { it.isNotEmpty() }.map(::decode).toMutableList()
            when (uri.scheme?.lowercase()) {
                "yard" -> {
                    val host = uri.host ?: uri.rawAuthority
                    if (!host.isNullOrEmpty()) parts.add(0, host)
                }
                null, "http", "https" -> Unit
                else -> return null
            }
            if (parts.firstOrNull() != "studio") return null
            val query = (uri.rawQuery ?: "").split("&").mapNotNull {
                val i = it.indexOf('=')
                if (i <= 0) null else decode(it.substring(0, i)) to decode(it.substring(i + 1))
            }.toMap()
            val second = parts.getOrNull(1)
            val third = parts.getOrNull(2)?.takeIf { it.isNotBlank() }
            return when (second) {
                null -> Home
                "orders" -> third?.let(::Order) ?: Orders
                "inbox" -> (third ?: query["thread"]?.takeIf { it.isNotBlank() })?.let(::Conversation) ?: Inbox
                "support" -> Support
                "products" -> when (third) {
                    // `/studio/products/suggestions[/{id}]`: the list (the app has no single-suggestion screen).
                    "suggestions" -> Suggestions(focusAcceptAll = query["focus"] == "accept-all")
                    null -> Products
                    else -> Product(third)
                }
                "payouts" -> Payouts
                else -> Home
            }
        }

        private fun decode(s: String): String = runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)
    }
}

/**
 * A tapped Studio push (`data.scope == "studio"`): where to go and which brand session it needs.
 * From our own notification's extras ([EXTRA_LINK], [EXTRA_BRAND]) or, for a push the system showed
 * in the background, from FCM's data keys (`scope`, `link`, `brandId`, `url`).
 */
data class StudioPushTap(val link: StudioLink, val brandId: String?) {
    companion object {
        const val EXTRA_LINK = "space.yardstore.app.push.studioLink"
        const val EXTRA_BRAND = "space.yardstore.app.push.studioBrand"

        fun from(get: (String) -> String?): StudioPushTap? {
            get(EXTRA_LINK)?.let { link ->
                return StudioPushTap(StudioLink.parse(link) ?: StudioLink.Home, get(EXTRA_BRAND)?.takeIf { it.isNotBlank() })
            }
            if (get("google.message_id") == null || get("scope") != "studio") return null
            val link = StudioLink.parse(get("link")) ?: StudioLink.parse(get("url")) ?: StudioLink.Home
            return StudioPushTap(link, get("brandId")?.takeIf { it.isNotBlank() })
        }
    }
}
