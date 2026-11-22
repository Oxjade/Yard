package space.yardstore.app.features.studio

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import space.yardstore.app.core.models.BrandMember
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.features.orders.OrderBrandRef
import space.yardstore.app.features.orders.OrderPreviewItem
import space.yardstore.app.features.orders.OrderShipTo
import space.yardstore.app.features.orders.OrderShipToPreview
import space.yardstore.app.features.orders.OrderStates
import space.yardstore.app.features.inbox.InboxAttachment
import space.yardstore.app.features.inbox.InboxLastMessage
import space.yardstore.app.features.inbox.InboxMessage
import java.time.Instant

// The Studio wire shapes the app uses (docs/APP.md › Studio in the app; src/lib/api/contracts/
// studio-app.ts, orders.ts, payouts.ts). Money is integer minor units + an ISO currency; times are
// ISO 8601 UTC. Every property has a default unless the server always sends it (ids).

// region Session switch

/** POST /api/studio/session/switch body. */
@Serializable
data class StudioSwitchBody(val brandId: String)

/** POST /api/studio/session/switch → 200 `{ actor: "brand", profile: BrandProfile }` + `yard_b`. */
@Serializable
data class StudioSwitchResult(val actor: String = "brand", val profile: BrandMember? = null)

// endregion

// region Categories (public)

/** GET /api/catalog/categories → `{ categories: [...] }`. Render one chip per category, in order; send its `slug`. */
@Serializable
data class StudioCategory(
    val slug: String,
    val name: String = "",
    val description: String = "",
    val imagePath: String? = null,
    val subcategories: List<String> = emptyList(),
    val productCount: Int = 0,
    val brandCount: Int = 0,
)

@Serializable
data class StudioCategoriesResponse(val categories: List<StudioCategory> = emptyList())

// endregion

// region Short application

/** POST /api/studio/apply body (strict: unknown fields are 400, so optional fields are omitted when null). */
@Serializable
data class StudioApplyBody(
    val brandName: String,
    val instagram: String? = null,
    val website: String? = null,
    val category: String,
    val city: String,
    val country: String,
    val about: String? = null,
)

@Serializable
data class StudioApplicationBrand(val id: String = "", val handle: String = "", val name: String = "")

/** StudioApplicationDto. `status`: draft | submitted | approved | rejected; `source`: app | studio. */
@Serializable
data class StudioApplication(
    val id: String,
    val status: String = "submitted",
    val source: String = "app",
    val brand: StudioApplicationBrand? = null,
    val submittedAt: String? = null,
    val reviewedAt: String? = null,
    val reviewNote: String? = null,
) {
    val isWaiting: Boolean get() = status == "submitted" || status == "draft"
    val isRejected: Boolean get() = status == "rejected"
}

/** `websiteScan`: `{ status: "started", importId }` | `{ status: "skipped", reason }` | null. */
@Serializable
data class StudioWebsiteScan(val status: String = "", val importId: String? = null, val reason: String? = null) {
    val started: Boolean get() = status == "started"
}

/** POST /api/studio/apply → 201 (submitted now) or 200 (one was already waiting, unchanged). */
@Serializable
data class StudioApplyResult(val application: StudioApplication, val websiteScan: StudioWebsiteScan? = null)

/** GET /api/studio/apply → `{ application: … | null }`. */
@Serializable
data class StudioApplicationResponse(val application: StudioApplication? = null)

// endregion

// region Dashboard

@Serializable
data class StudioSalesWindow(val orders: Int = 0, val grossMinor: Long = 0, val refundedMinor: Long = 0, val netMinor: Long = 0)

@Serializable
data class StudioSales(val today: StudioSalesWindow = StudioSalesWindow(), val week: StudioSalesWindow = StudioSalesWindow(), val month: StudioSalesWindow = StudioSalesWindow())

@Serializable
data class StudioSeriesPoint(val date: String = "", val orders: Int = 0, val grossMinor: Long = 0, val netMinor: Long = 0)

@Serializable
data class StudioSeries(val days: Int = 7, val points: List<StudioSeriesPoint> = emptyList())

@Serializable
data class StudioToShip(val total: Int = 0, val paid: Int = 0, val processing: Int = 0)

@Serializable
data class StudioLowStock(val variants: Int = 0, val products: Int = 0, val threshold: Int = 3)

@Serializable
data class StudioImageRef(val src: String = "", val alt: String = "")

@Serializable
data class StudioTopProduct(
    val productId: String = "",
    val title: String = "",
    val currency: String = "USD",
    val units: Int = 0,
    val revenueMinor: Long = 0,
    val image: StudioImageRef? = null,
)

@Serializable
data class StudioStoreViews(val today: Int = 0, val week: Int = 0, val month: Int = 0)

@Serializable
data class StudioDashboardBrand(val id: String = "", val handle: String = "", val name: String = "", val currency: String = "USD", val timeZone: String = "UTC")

/** GET /api/studio/dashboard?days=7|30 → StudioDashboardDto. */
@Serializable
data class StudioDashboard(
    val brand: StudioDashboardBrand = StudioDashboardBrand(),
    val sales: StudioSales = StudioSales(),
    val series: StudioSeries = StudioSeries(),
    val toShip: StudioToShip = StudioToShip(),
    val lowStock: StudioLowStock = StudioLowStock(),
    /** Null when the role can't read the inbox. */
    val unreadMessages: Int? = null,
    val websitePieces: Int = 0,
    val topProducts: List<StudioTopProduct> = emptyList(),
    val storeViews: StudioStoreViews = StudioStoreViews(),
) {
    /** The sales window for a Home toggle. */
    fun window(range: StudioRange): StudioSalesWindow = when (range) {
        StudioRange.Today -> sales.today
        StudioRange.Week -> sales.week
        StudioRange.Month -> sales.month
    }

    fun views(range: StudioRange): Int = when (range) {
        StudioRange.Today -> storeViews.today
        StudioRange.Week -> storeViews.week
        StudioRange.Month -> storeViews.month
    }
}

/** Home's sales toggle. Today and week chart the 7-day series; month charts `days=30`. */
enum class StudioRange(val title: String, val days: Int) {
    Today("Today", 7),
    Week("Week", 7),
    Month("Month", 30),
}

// endregion

// region Orders

/** OrderSummaryDto as Studio sees it (adds `customerName`). */
@Serializable
data class StudioOrderSummary(
    val id: String,
    val reference: String = "",
    val groupReference: String = "",
    val brand: OrderBrandRef = OrderBrandRef(),
    val customerName: String = "",
    val shipToPreview: OrderShipToPreview = OrderShipToPreview(),
    val placedAt: String = "",
    val currency: String = "USD",
    val subtotalMinor: Long = 0,
    val shippingMinor: Long = 0,
    val totalMinor: Long = 0,
    val refundedMinor: Long = 0,
    val itemCount: Int = 0,
    val previewItems: List<OrderPreviewItem> = emptyList(),
    val states: OrderStates = OrderStates(),
    val service: String = "standard",
) {
    val placedDate: Instant? get() = YardDate.parse(placedAt)
    val merchant: String get() = states.merchant

    /** "Candle (Large) and 2 more" style title from the preview items. */
    val itemsTitle: String
        get() {
            val first = previewItems.firstOrNull() ?: return "$itemCount ${if (itemCount == 1) "item" else "items"}"
            val qty = if (first.qty > 1) " ×${first.qty}" else ""
            val more = itemCount - first.qty
            return if (more > 0) "${first.name}$qty and $more more" else "${first.name}$qty"
        }
}

@Serializable
data class StudioOrdersPage(val items: List<StudioOrderSummary> = emptyList(), val nextCursor: String? = null)

@Serializable
data class StudioOrderLineImage(val src: String = "", val alt: String = "", val width: Int = 0, val height: Int = 0)

@Serializable
data class StudioOrderLine(
    val id: String = "",
    val variantId: String = "",
    val productId: String = "",
    val title: String = "",
    val qty: Int = 1,
    val unitMinor: Long = 0,
    val returnedQty: Int = 0,
    val restockedQty: Int = 0,
    /** The variant's option values ("M / Black"), empty for a product without options. */
    val variantLabel: String = "",
    val image: StudioOrderLineImage? = null,
)

@Serializable
data class StudioOrderEvent(val id: String = "", val kind: String = "", val actorKind: String = "", val at: String = "")

@Serializable
data class StudioOrderActions(val canCancel: Boolean = false, val canRequestReturn: Boolean = false, val returnWindowEndsAt: String? = null)

@Serializable
data class StudioOrderRefund(val id: String = "", val kind: String = "", val status: String = "", val amountMinor: Long = 0, val currency: String = "USD", val reason: String = "", val createdAt: String = "")

/** OrderDetailDto (the summary plus lines, address, timeline, actions…). */
@Serializable
data class StudioOrderDetail(
    val id: String,
    val reference: String = "",
    val customerName: String = "",
    val shipToPreview: OrderShipToPreview = OrderShipToPreview(),
    val placedAt: String = "",
    val currency: String = "USD",
    val subtotalMinor: Long = 0,
    val shippingMinor: Long = 0,
    val totalMinor: Long = 0,
    val refundedMinor: Long = 0,
    val itemCount: Int = 0,
    val states: OrderStates = OrderStates(),
    val service: String = "standard",
    val lines: List<StudioOrderLine> = emptyList(),
    /** A free-form address object on the wire; decoded leniently with [shipToAddress]. */
    val shipTo: JsonObject? = null,
    val paidAt: String? = null,
    val cancelledAt: String? = null,
    val cancelReason: String? = null,
    val deliveredAt: String? = null,
    val completedAt: String? = null,
    val refundableMinor: Long = 0,
    val refunds: List<StudioOrderRefund> = emptyList(),
    val timeline: List<StudioOrderEvent> = emptyList(),
    val actions: StudioOrderActions = StudioOrderActions(),
) {
    val merchant: String get() = states.merchant
    val shipToAddress: OrderShipTo?
        get() = shipTo?.let { runCatching { YardJson.decodeFromJsonElement(OrderShipTo.serializer(), it) }.getOrNull() }

    /** When the order reached [stage] (from the timeline / dates), for the progress line. */
    fun timeOf(stage: StudioOrderStage): String? = when (stage) {
        StudioOrderStage.Received -> paidAt ?: placedAt
        StudioOrderStage.Preparing -> timeline.lastOrNull { it.kind.contains("processing") }?.at
        StudioOrderStage.Shipped -> timeline.lastOrNull { it.kind.contains("shipped") || it.kind.contains("shipment") }?.at
        StudioOrderStage.Delivered -> deliveredAt
    }
}

@Serializable
data class StudioOrderResponse(val order: StudioOrderDetail)

/** The tracking-style progress line: received → preparing → shipped → delivered. */
enum class StudioOrderStage(val title: String) {
    Received("Received"),
    Preparing("Preparing"),
    Shipped("Shipped"),
    Delivered("Delivered");

    companion object {
        /** How far along an order with merchant state [merchant] is (-1 when it never moved: unpaid/cancelled). */
        fun reached(merchant: String): Int = when (merchant) {
            "paid" -> 0
            "processing" -> 1
            "shipped" -> 2
            "delivered", "refund_requested", "refunded" -> 3
            else -> -1
        }
    }
}

/** POST …/shipment body. `status`: shipped (others exist; the app sends shipped). */
@Serializable
data class StudioShipmentBody(val status: String = "shipped", val carrier: String? = null, val trackingNumber: String? = null, val note: String? = null)

@Serializable
data class StudioCancelBody(val reason: String, val restock: Boolean = true, val idempotencyKey: String)

@Serializable
data class StudioRefundBody(val amountMinor: Long, val reason: String, val idempotencyKey: String)

/** Responses whose `order` we read back (`processing`, `cancel`, `refunds`). */
@Serializable
data class StudioOrderEnvelope(val order: StudioOrderDetail? = null, val duplicate: Boolean = false, val alreadyProcessing: Boolean = false)

/** POST /api/auth/reauth?as=brand body. */
@Serializable
data class StudioReauthBody(val password: String)

// endregion

// region Products

@Serializable
data class StudioProductImage(val id: String = "", val src: String = "", val alt: String = "", val width: Int = 0, val height: Int = 0, val mediaId: String = "")

@Serializable
data class StudioOptionValue(val value: String, val hex: String? = null)

@Serializable
data class StudioOption(val name: String, val values: List<StudioOptionValue> = emptyList())

@Serializable
data class StudioVariant(
    val id: String,
    val sku: String = "",
    val options: Map<String, String> = emptyMap(),
    /** The option values ("M / Black"), empty without options. */
    val label: String = "",
    val priceMinor: Long? = null,
    /** = onHand − held. */
    val available: Int = 0,
    val inStock: Boolean = false,
    val status: String = "active",
    val onHand: Int = 0,
    val held: Int = 0,
    val priceOverrideMinor: Long? = null,
)

/** StudioProductDto. `status`: draft | scheduled | published | archived. */
@Serializable
data class StudioProduct(
    val id: String,
    val slug: String = "",
    val brandId: String = "",
    val title: String = "",
    val description: String = "",
    val category: String? = null,
    val priceMinor: Long = 0,
    val compareAtMinor: Long? = null,
    val currency: String = "USD",
    val images: List<StudioProductImage> = emptyList(),
    val options: List<StudioOption> = emptyList(),
    val variants: List<StudioVariant> = emptyList(),
    val available: Int = 0,
    val status: String = "draft",
    val publishedAt: String? = null,
    val moderationStatus: String? = null,
    val moderationReason: String? = null,
    val version: Int = 0,
    val updatedAt: String = "",
) {
    val isLive: Boolean get() = status == "published"
    val imageUrl: String? get() = images.firstOrNull()?.src?.takeIf { it.isNotBlank() }
    val totalAvailable: Int get() = if (variants.isEmpty()) available else variants.sumOf { it.available }
    val statusTitle: String
        get() = when (status) {
            "published" -> "Live"
            "scheduled" -> "Scheduled"
            "archived" -> "Archived"
            else -> "Draft"
        }
}

@Serializable
data class StudioProductsPage(val products: List<StudioProduct> = emptyList(), val total: Int = 0, val nextOffset: Int? = null)

@Serializable
data class StudioProductResponse(val product: StudioProduct)

/** POST /api/studio/catalog/variants/{id}/stock. `mode`: adjust (± qty) | set (exact on-hand). */
@Serializable
data class StudioStockBody(val mode: String, val qty: Int, val reason: String? = null)

@Serializable
data class StudioStockResult(val variantId: String = "", val onHand: Int = 0, val held: Int = 0, val available: Int = 0)

/** POST …/products/{id}/status. `action`: publish | unpublish | schedule | archive | restore. */
@Serializable
data class StudioStatusBody(val action: String, val expectedVersion: Int)

/** POST /api/uploads?purpose=social_post&as=brand → `{ media: { id, src, … } }`. */
@Serializable
data class StudioUploadResult(val media: Media) {
    @Serializable
    data class Media(val id: String, val src: String = "", val width: Int = 0, val height: Int = 0)
}

@Serializable
data class StudioCreateVariant(val sku: String, val options: Map<String, String>, val initialStock: Int)

@Serializable
data class StudioCreateImage(val mediaId: String, val alt: String = "")

/** POST /api/studio/catalog/products (Quick add) → 201 `{ product }` (a draft). */
@Serializable
data class StudioProductCreateBody(
    val title: String,
    val description: String = "",
    val categorySlug: String,
    val priceMinor: Long,
    val options: List<StudioOption>,
    val variants: List<StudioCreateVariant>,
    val images: List<StudioCreateImage>,
    val badges: List<String> = listOf("new"),
)

// endregion

// region Website pieces

/** SitePieceDto ("New from your website"). */
@Serializable
data class StudioSitePiece(
    val id: String,
    val title: String = "",
    val sourceUrl: String = "",
    val images: List<String> = emptyList(),
    val priceMinor: Long? = null,
    val currency: String = "USD",
    val yardPriceMinor: Long? = null,
    val sizes: List<String> = emptyList(),
    val availability: String? = null,
    val description: String? = null,
    val warnings: List<String> = emptyList(),
    val status: String = "",
    val taken: Boolean = false,
    val firstSeenAt: String? = null,
    val error: String? = null,
)

@Serializable
data class StudioSitePieces(
    val items: List<StudioSitePiece> = emptyList(),
    val count: Int = 0,
    val mayAdd: Boolean = false,
    val site: String? = null,
    val currency: String = "USD",
    val productId: String? = null,
    val published: Boolean? = null,
)

@Serializable
data class StudioSitePieceAction(val action: String)

/** POST /api/studio/catalog/website-pieces/add-all: the refreshed list plus what happened to each piece. */
@Serializable
data class StudioSitePiecesBatch(
    val items: List<StudioSitePiece> = emptyList(),
    val count: Int = 0,
    val mayAdd: Boolean = false,
    val site: String? = null,
    val currency: String = "USD",
    val accepted: List<String> = emptyList(),
    val skipped: List<StudioBatchSkip> = emptyList(),
    val replayed: Boolean = false,
) {
    val pieces: StudioSitePieces get() = StudioSitePieces(items = items, count = count, mayAdd = mayAdd, site = site, currency = currency)
    val result: StudioBatchResult get() = StudioBatchResult(accepted, skipped, replayed)
}

// endregion

// region Suggestions from Yard (docs/APP.md › Suggestions from Yard (Accept all))

/** ProposalSummaryDto: a product (kind "new") or changes to one ("edit") the Yard team suggested. */
@Serializable
data class StudioProposal(
    val id: String,
    val kind: String = "new",
    val status: String = "pending",
    val productId: String? = null,
    val title: String = "",
    val cover: String? = null,
    val note: String? = null,
    val fields: List<String> = emptyList(),
    val createdAt: String? = null,
    val declineReason: String? = null,
) {
    val isNew: Boolean get() = kind != "edit"
    val isPending: Boolean get() = status == "pending"
    /** "Linen tote" / "Changes to Linen tote". */
    val heading: String get() = if (isNew) title else "Changes to $title"
    /** "New product" / "3 changes". */
    val detail: String get() = if (isNew) "New product" else "${fields.size} ${if (fields.size == 1) "change" else "changes"}"
}

@Serializable
data class StudioProposalsPage(
    val items: List<StudioProposal> = emptyList(),
    val total: Int = 0,
)

/** Accept all / Add all body: `ids` omitted = every waiting one. */
@Serializable
data class StudioBatchBody(val ids: List<String>? = null, val idempotencyKey: String)

/** Decline all body (`reason` optional, ≤ 300). */
@Serializable
data class StudioDeclineBatchBody(val ids: List<String>? = null, val reason: String? = null, val idempotencyKey: String)

@Serializable
data class StudioBatchSkip(val id: String, val reason: String = "")

/** `{ accepted, skipped: [{ id, reason }], replayed? }` (for decline-all, `accepted` = the declined ones). */
@Serializable
data class StudioBatchResult(
    val accepted: List<String> = emptyList(),
    val skipped: List<StudioBatchSkip> = emptyList(),
    val replayed: Boolean = false,
)

// endregion

// region Payouts

@Serializable
data class StudioBalance(
    val currency: String = "USD",
    val pendingMinor: Long = 0,
    val availableMinor: Long = 0,
    val reserveMinor: Long = 0,
    val inPayoutMinor: Long = 0,
)

@Serializable
data class StudioPayoutAccount(
    val country: String = "",
    val currency: String = "",
    val bankCode: String? = null,
    val bankName: String? = null,
    val accountName: String? = null,
    val accountLast4: String? = null,
    val recipientProvider: String? = null,
    val verified: Boolean = false,
    val changedAt: String? = null,
    val cooldownUntil: String? = null,
)

@Serializable
data class StudioPayout(
    val id: String,
    val currency: String = "USD",
    val amountMinor: Long = 0,
    val status: String = "requested",
    val requestedAt: String? = null,
    val paidAt: String? = null,
    val failedAt: String? = null,
    val lastError: String? = null,
    val rejectReason: String? = null,
) {
    val statusTitle: String
        get() = when (status) {
            "paid" -> "Paid"
            "failed" -> "Failed"
            "rejected" -> "Rejected"
            "cancelled" -> "Cancelled"
            "sending", "processing" -> "On its way"
            "approved" -> "Approved"
            else -> "Requested"
        }
}

@Serializable
data class StudioPayoutRules(val onHold: Boolean = false, val holdReason: String? = null, val cooldownUntil: String? = null, val minPayoutMinor: Long = 0)

/** GET /api/studio/payouts (roles owner, admin, finance). */
@Serializable
data class StudioPayouts(
    val currency: String = "USD",
    val balances: List<StudioBalance> = emptyList(),
    val account: StudioPayoutAccount? = null,
    val payouts: List<StudioPayout> = emptyList(),
    val rules: StudioPayoutRules = StudioPayoutRules(),
) {
    /** The balance in the brand's currency (the first one otherwise). */
    val balance: StudioBalance get() = balances.firstOrNull { it.currency == currency } ?: balances.firstOrNull() ?: StudioBalance(currency = currency)
}

// endregion

// region Inbox

@Serializable
data class StudioCustomer(val id: String = "", val name: String = "", val photoSrc: String? = null)

/** ConversationSummary seen from the brand: the shopper is [customer]. */
@Serializable
data class StudioConversation(
    val id: String,
    val customer: StudioCustomer? = null,
    val status: String = "open",
    val lastMessage: InboxLastMessage? = null,
    val unread: Int = 0,
    val markedUnread: Boolean = false,
    val createdAt: String = "",
    val kind: String = "brand",
) {
    val isUnread: Boolean get() = unread > 0 || markedUnread
    val title: String get() = if (kind == "support") "Yard Support" else customer?.name?.ifBlank { null } ?: "Customer"
    val previewText: String get() = lastMessage?.preview?.ifBlank { null } ?: "No messages yet"
}

@Serializable
data class StudioInboxCounts(val open: Int = 0, val unread: Int = 0, val resolved: Int = 0, val spam: Int = 0, val blocked: Int = 0)

@Serializable
data class StudioConversationsPage(val items: List<StudioConversation> = emptyList(), val nextCursor: String? = null, val counts: StudioInboxCounts = StudioInboxCounts())

@Serializable
data class StudioThread(val conversation: StudioConversation, val messages: List<InboxMessage> = emptyList(), val hasMore: Boolean = false)

/** Yard Support for the brand: `{ conversation: … | null }`. */
@Serializable
data class StudioSupportConversation(val conversation: StudioConversation? = null)

@Serializable
data class StudioSendBody(val conversationId: String? = null, val clientId: String, val kind: String = "text", val body: String)

@Serializable
data class StudioSendResult(val message: InboxMessage? = null)

@Serializable
data class StudioReadBody(val upToSeq: Int)

@Serializable
data class StudioUnread(val conversations: Int = 0)

/** A message's photos (shared with the shopper inbox's DTO). */
val InboxMessage.photos: List<InboxAttachment> get() = attachments.filter { it.url != null }

// endregion

// region Settings and push

@Serializable
data class StudioPushChoices(val orders: Boolean = true, val messages: Boolean = true, val lowStock: Boolean = true, val payouts: Boolean = true)

/** GET / PUT /api/studio/settings/notifications. */
@Serializable
data class StudioNotificationSettings(val push: StudioPushChoices = StudioPushChoices())

/** POST /api/studio/push/test. */
@Serializable
data class StudioPushTest(val devices: Int = 0, val delivered: Boolean = false)

// endregion
