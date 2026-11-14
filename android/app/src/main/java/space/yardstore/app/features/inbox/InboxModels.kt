package space.yardstore.app.features.inbox

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import java.time.Instant
import kotlin.math.roundToInt

// Inbox wire models (shopper side). Shapes from src/lib/api/contracts/inbox.ts.
// Mirrors ios/Yard/Features/Inbox/InboxModels.swift: only the fields the screens use; every
// field the server may omit has a default (YardJson turns nulls into those defaults).

/** `conversationSummary.brand.mark`. */
@Serializable
data class InboxBrandMark(val text: String? = null)

/** `conversationSummary.brand`. */
@Serializable
data class InboxBrandRef(
    val id: String,
    val handle: String = "",
    val name: String = "",
    val verified: Boolean = false,
    val mark: InboxBrandMark? = null,
) {
    /** `mark.text`: the brand's 1–3 letter mark (monogram fallback). */
    val markText: String? get() = mark?.text
}

/** `conversationSummary.lastMessage`. */
@Serializable
data class InboxLastMessage(
    val preview: String = "",
    val at: String = "",
    /** "customer" | "brand" | "system" | "support" (Yard Support's replies). */
    val side: String = "customer",
    val held: Boolean = false,
)

/** Why the composer can't send (`interaction`). */
@Serializable
data class InboxInteraction(
    val canSend: Boolean = true,
    /** "blocked_by_them" | "blocked_by_me" | "restricted" | "locked" | "brand_unavailable" | "role". */
    val reason: String? = null,
    val until: String? = null,
)

/** `conversationSummary.blocked`. */
@Serializable
data class InboxBlocked(val byMe: Boolean? = null, val byThem: Boolean? = null)

/** `conversationSummary` as the shopper sees it. */
@Serializable
data class InboxConversation(
    val id: String,
    val brand: InboxBrandRef,
    /** "open" | "resolved". */
    val status: String = "open",
    val locked: Boolean = false,
    val lastMessage: InboxLastMessage? = null,
    val unread: Int = 0,
    val markedUnread: Boolean = false,
    val archived: Boolean = false,
    val muted: Boolean = false,
    val blocked: InboxBlocked? = null,
    val sample: Boolean = false,
    val createdAt: String = "",
    /** Only on single-conversation reads. */
    val interaction: InboxInteraction? = null,
    /**
     * "brand" (a brand conversation) | "support" (the shopper's one thread with Yard Support, whose
     * `brand` is always Yard Support). Older servers omit it: treat missing as "brand".
     */
    val kind: String = "brand",
) {
    val blockedByMe: Boolean get() = blocked?.byMe == true
    val blockedByThem: Boolean get() = blocked?.byThem == true

    val isUnread: Boolean get() = unread > 0 || markedUnread

    /** The Yard Support thread: Yard's mark, no storefront link, no archive/mute/block/report. */
    val isSupport: Boolean get() = kind == "support"

    /** Newest activity: the last message, else when it started. */
    val sortAt: String get() = lastMessage?.at ?: createdAt

    /** "You: …" for the shopper's own delivered messages, like the website. */
    val previewText: String
        get() {
            val m = lastMessage ?: return "No messages yet"
            return (if (m.side == "customer" && !m.held) "You: " else "") + m.preview
        }

    /** A copy with local read state cleared (after mark-read). */
    fun markingRead(): InboxConversation = copy(unread = 0, markedUnread = false)
}

/** GET /api/inbox/conversations → `{ items, nextCursor }`. */
@Serializable
data class InboxConversationsPage(
    val items: List<InboxConversation> = emptyList(),
    val nextCursor: String? = null,
)

/** `{ conversation }` (GET/PATCH one conversation). */
@Serializable
data class InboxConversationResponse(val conversation: InboxConversation)

/** A money value on a card (`{ amount, currency }`, minor units; the schema allows any number). */
@Serializable
data class InboxMoney(val amount: Double = 0.0, val currency: String = "USD") {
    val minor: Int get() = amount.roundToInt()
    val formatted: String get() = Formatters.price(minor, currency)
}

/** `productCard`: a piece shared in the thread (price as it was when shared). */
@Serializable
data class InboxProductCard(
    val productId: String = "",
    val slug: String = "",
    val name: String = "",
    val price: InboxMoney = InboxMoney(),
    val variantLabel: String? = null,
)

/** `orderCard`: an order attached to a message. */
@Serializable
data class InboxOrderCard(
    val orderId: String,
    val reference: String = "",
    val status: String = "",
    val placedAt: String = "",
    val total: InboxMoney = InboxMoney(),
    val itemCount: Int = 0,
)

/** A photo on a message: `src` is always `/api/media/<id>?as=shopper` (cookie-authorised). */
@Serializable
data class InboxAttachment(
    val mediaId: String = "",
    val src: String = "",
    val width: Int? = null,
    val height: Int? = null,
) {
    /** The path; `RemoteImage` resolves it against the base URL. */
    val url: String? get() = src.ifEmpty { null }
}

/** `messageDto`. */
@Serializable
data class InboxMessage(
    val id: String,
    val seq: Int = 0,
    /** "customer" | "brand" | "system" | "support" (Yard Support, in the support thread). */
    val side: String = "brand",
    /** "text" | "product" | "order" | "image" | "system". */
    val kind: String = "text",
    /** Null for a message Yard removed. */
    val body: String? = null,
    val product: InboxProductCard? = null,
    val order: InboxOrderCard? = null,
    val attachments: List<InboxAttachment> = emptyList(),
    /** "sent" | "held" | "removed" (MESSAGE_STATUSES). */
    val status: String = "sent",
    val safetyNotice: Boolean = false,
    val createdAt: String = "",
    val clientId: String = "",
) {
    val isMine: Boolean get() = side == "customer"
    val isSystem: Boolean get() = side == "system" || kind == "system"
    val isRemoved: Boolean get() = status == "removed"
    val isHeld: Boolean get() = status == "held"
    val date: Instant? get() = YardDate.parse(createdAt)
}

/** GET /api/inbox/conversations/{id}/messages → `threadDto`. */
@Serializable
data class InboxThread(
    val conversation: InboxConversation,
    val messages: List<InboxMessage> = emptyList(),
    val hasMore: Boolean = false,
)

/** GET /api/inbox/conversations/by-brand/{brandId}. */
@Serializable
data class InboxByBrand(
    val conversation: InboxConversation? = null,
    val canMessage: Boolean = true,
    /** "blocked" | "blocked_by_me" | "restricted" | "brand_unavailable". */
    val reason: String? = null,
    val until: String? = null,
) {
    /** The composer state for a new thread (by-brand's "blocked" is the thread's "blocked_by_them"). */
    val interaction: InboxInteraction
        get() = if (canMessage) {
            InboxInteraction(canSend = true)
        } else {
            InboxInteraction(canSend = false, reason = if (reason == "blocked") "blocked_by_them" else reason, until = until)
        }
}

/** POST /api/inbox/messages → 201 `{ message, conversation }`. */
@Serializable
data class InboxSendResult(val message: InboxMessage, val conversation: InboxConversation)

/**
 * POST /api/inbox/messages body (strict on the server: only these keys). Null properties are not
 * encoded (YardJson has `explicitNulls = false`), so unset keys never reach the server.
 */
@Serializable
data class InboxSendBody(
    val conversationId: String? = null,
    val brandId: String? = null,
    val clientId: String,
    /** "text" | "image" (product/order sharing is web-only for now). */
    val kind: String,
    val body: String? = null,
    val attachmentIds: List<String>? = null,
    /** "inbox" | "product" | "order" — only with brandId (new conversation). */
    val origin: String? = null,
)

/** PATCH /api/inbox/conversations/{id} `{ archived?, muted? }`. */
@Serializable
data class InboxPatchBody(val archived: Boolean? = null, val muted: Boolean? = null)

/** POST /api/inbox/conversations/{id}/read `{ upToSeq }` → 204. */
@Serializable
data class InboxReadBody(val upToSeq: Int)

/** POST /api/inbox/blocks `{ brandId }` (DELETE with the same body unblocks). */
@Serializable
data class InboxBlockBody(val brandId: String)

/** POST /api/uploads → 201 `{ media: { id, src, … } }`. */
@Serializable
data class InboxUploadResult(val media: Media) {
    @Serializable
    data class Media(val id: String, val src: String? = null)
}

/** GET /api/inbox/unread → `{ conversations }`. */
@Serializable
data class InboxUnreadCount(val conversations: Int = 0)
