package space.yardstore.app.features.orders

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

// Orders feature models. Mirrors ios/Yard/Features/Orders/OrderModels.swift. Shapes come from the website:
//   src/server/orders/contracts.ts (OrderSummaryDto, OrderDetailDto, OrdersPageDto)
//   src/lib/api/contracts/shipping.ts (DeliveryDto)
//   src/lib/api/contracts/checkout.ts (CheckoutStartResponse)
// Everything decodes leniently (YardJson + defaults on every field; lists skip a malformed row).

// region Lenient lists

/** Decodes a JSON array element by element so one malformed row is skipped, not the page (Swift `OrderLenientItem`). */
abstract class OrderLenientListSerializer<T>(private val element: KSerializer<T>) : KSerializer<List<T>> {
    private val delegate = ListSerializer(element)
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): List<T> {
        val input = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val array = input.decodeJsonElement() as? JsonArray ?: return emptyList()
        return array.mapNotNull { runCatching { input.json.decodeFromJsonElement(element, it) }.getOrNull() }
    }

    override fun serialize(encoder: Encoder, value: List<T>) = delegate.serialize(encoder, value)
}

object OrderSummaryListSerializer : OrderLenientListSerializer<OrderSummary>(OrderSummary.serializer())
object OrderLineListSerializer : OrderLenientListSerializer<OrderLine>(OrderLine.serializer())
object OrderReturnListSerializer : OrderLenientListSerializer<OrderReturn>(OrderReturn.serializer())
object OrderRefundListSerializer : OrderLenientListSerializer<OrderRefund>(OrderRefund.serializer())
object OrderEventListSerializer : OrderLenientListSerializer<OrderEvent>(OrderEvent.serializer())
object ShipmentEventListSerializer : OrderLenientListSerializer<ShipmentEvent>(ShipmentEvent.serializer())

// endregion

// region Summary (GET /api/orders, GET /api/orders/checkouts/{id})

@Serializable
data class OrderBrandRef(
    val id: String = "",
    val name: String = "The brand",
    val handle: String = "",
)

@Serializable
data class OrderStates(
    /** pending_payment, paid, processing, shipped, delivered, cancelled, refund_requested, refunded */
    val merchant: String = "pending_payment",
    /** pending, paid, failed, partially_refunded, refunded */
    val payment: String = "pending",
    /** unfulfilled, processing, shipped, delivered, returned_to_sender, cancelled */
    val fulfilment: String = "unfulfilled",
    /** none, requested, approved, received, rejected, cancelled, expired */
    @SerialName("return") val returnState: String = "none",
    val dispute: String = "none",
) {
    val status: OrderStatus get() = OrderStatus.from(merchant)
}

@Serializable
data class OrderPreviewItem(
    val productId: String = "",
    val variantId: String = "",
    val name: String = "",
    val qty: Int = 1,
    val unitMinor: Int = 0,
)

@Serializable
data class OrderShipToPreview(
    val city: String? = null,
    val country: String = "",
)

/** One brand's order (one part of a checkout). */
@Serializable
data class OrderSummary(
    val id: String,
    val reference: String = "",
    val groupReference: String = "",
    val checkoutId: String? = null,
    val brand: OrderBrandRef = OrderBrandRef(),
    val shipToPreview: OrderShipToPreview = OrderShipToPreview(),
    val placedAt: String = "",
    val currency: String = "USD",
    val subtotalMinor: Int = 0,
    val shippingMinor: Int = 0,
    val totalMinor: Int = 0,
    val refundedMinor: Int = 0,
    val itemCount: Int = 0,
    val previewItems: List<OrderPreviewItem> = emptyList(),
    val states: OrderStates = OrderStates(),
    val service: String = "standard",
) {
    val status: OrderStatus get() = states.status
    val placedDate: Instant? get() = YardDate.parse(placedAt)
    val groupKey: String get() = checkoutId ?: groupReference

    /** "Boxy tee and 2 more" (the website's wording), else "3 items". */
    val itemsTitle: String
        get() {
            val first = previewItems.firstOrNull() ?: return itemsCountText
            val more = itemCount - first.qty
            return if (more > 0) "${first.name} and $more more" else first.name
        }

    val itemsCountText: String get() = "$itemCount ${if (itemCount == 1) "item" else "items"}"
}

@Serializable
data class OrdersPage(
    @Serializable(with = OrderSummaryListSerializer::class)
    val items: List<OrderSummary> = emptyList(),
    val nextCursor: String? = null,
)

// endregion

// region Detail (GET /api/orders/{id})

@Serializable
data class OrderLineImage(
    val src: String = "",
    val alt: String = "",
)

@Serializable
data class OrderLine(
    val id: String = UUID.randomUUID().toString(),
    val variantId: String = "",
    val productId: String = "",
    val title: String = "",
    val qty: Int = 1,
    val unitMinor: Int = 0,
    val returnedQty: Int = 0,
    val variantLabel: String = "",
    val image: OrderLineImage? = null,
) {
    /** Relative or absolute; `RemoteImage` resolves it. */
    val imageUrl: String? get() = image?.src?.takeIf { it.isNotBlank() }
    val returnableQty: Int get() = maxOf(0, qty - returnedQty)
}

/** The full delivery address (`shipTo` is a free-form object on the server). */
@Serializable
data class OrderShipTo(
    val name: String? = null,
    val line1: String? = null,
    val line2: String? = null,
    val city: String? = null,
    val region: String? = null,
    val postcode: String? = null,
    val postalCode: String? = null,
    val country: String? = null,
    val phone: String? = null,
) {
    /** Multi-line address as the website prints it. */
    val formatted: String
        get() {
            val cityLine = listOf(city, region, postalCode ?: postcode).mapNotNull { OrderText.nonEmpty(it) }.joinToString(", ")
            val parts = listOf(name, line1, line2, cityLine, OrderText.countryName(country), phone)
            return parts.mapNotNull { OrderText.nonEmpty(it) }.joinToString("\n")
        }
}

@Serializable
data class OrderEventData(val by: String? = null)

@Serializable
data class OrderEvent(
    val id: String = UUID.randomUUID().toString(),
    val kind: String = "",
    val at: String = "",
    val data: OrderEventData = OrderEventData(),
) {
    val date: Instant? get() = YardDate.parse(at)

    /** Shopper copy for the event (src/components/market/account/server-order-detail.tsx); null = internal. */
    val label: String?
        get() = when (kind) {
            "order.placed" -> "Order placed"
            "payment.captured" -> "Payment confirmed"
            "payment.failed" -> "Payment didn’t go through"
            "fulfilment.processing" -> "Order being prepared"
            "fulfilment.shipped" -> "Order shipped"
            "fulfilment.delivered" -> "Order delivered"
            "fulfilment.returned_to_sender" -> "Returned to the brand"
            "order.cancelled" -> if (data.by == "shopper") "You cancelled this order" else "Order cancelled"
            "return.requested" -> "Return requested"
            "return.cancelled" -> "Return request withdrawn"
            "return.approved" -> "Return approved"
            "return.rejected" -> "Return declined"
            "return.received" -> "Return received by the brand"
            "return.expired" -> "Return request expired"
            "refund.requested" -> "Refund started"
            "refund.succeeded" -> "Refund issued"
            else -> null
        }
}

@Serializable
data class OrderReturnLine(
    val variantId: String = "",
    val title: String = "",
    val qty: Int = 0,
)

@Serializable
data class OrderReturn(
    val id: String = UUID.randomUUID().toString(),
    /** requested, approved, rejected, received, cancelled, expired */
    val status: String = "requested",
    val reasonLabel: String = "",
    val lines: List<OrderReturnLine> = emptyList(),
    val requestedAt: String = "",
    val decisionReason: String? = null,
) {
    val isOpen: Boolean get() = status == "requested" || status == "approved"
    val itemCount: Int get() = lines.sumOf { it.qty }
}

@Serializable
data class OrderRefund(
    val id: String = UUID.randomUUID().toString(),
    val status: String = "pending",
    val amountMinor: Int = 0,
    val currency: String = "USD",
    val createdAt: String = "",
)

@Serializable
data class OrderActions(
    val canCancel: Boolean = false,
    val canRequestReturn: Boolean = false,
    val returnWindowEndsAt: String? = null,
)

/** The detail-only fields of OrderDetailDto (the summary fields sit on the same object). */
@Serializable
private data class OrderDetailFields(
    @Serializable(with = OrderLineListSerializer::class)
    val lines: List<OrderLine> = emptyList(),
    val shipTo: OrderShipTo? = null,
    val paidAt: String? = null,
    val cancelledAt: String? = null,
    val cancelReason: String? = null,
    val deliveredAt: String? = null,
    @Serializable(with = OrderReturnListSerializer::class)
    val returns: List<OrderReturn> = emptyList(),
    @Serializable(with = OrderRefundListSerializer::class)
    val refunds: List<OrderRefund> = emptyList(),
    @Serializable(with = OrderEventListSerializer::class)
    val timeline: List<OrderEvent> = emptyList(),
    val actions: OrderActions = OrderActions(),
    val delivery: OrderDelivery? = null,
)

/** OrderDetailDto = OrderSummaryDto & { lines, shipTo, … } — decoded as a summary plus the detail fields. */
@Serializable(with = OrderDetailSerializer::class)
data class OrderDetail(
    val summary: OrderSummary,
    val lines: List<OrderLine> = emptyList(),
    val shipTo: OrderShipTo? = null,
    val paidAt: String? = null,
    val cancelledAt: String? = null,
    val cancelReason: String? = null,
    val deliveredAt: String? = null,
    val returns: List<OrderReturn> = emptyList(),
    val refunds: List<OrderRefund> = emptyList(),
    val timeline: List<OrderEvent> = emptyList(),
    val actions: OrderActions = OrderActions(),
    val delivery: OrderDelivery? = null,
) {
    val id: String get() = summary.id
    val status: OrderStatus get() = summary.status
    val openReturn: OrderReturn? get() = returns.firstOrNull { it.isOpen }

    /** The first time an event of [kind] happened. */
    fun eventDate(kind: String): Instant? = timeline.firstOrNull { it.kind == kind }?.date

    /** The latest shipment event that carries a tracking number. */
    val tracking: OrderTracking?
        get() {
            val events = delivery?.events ?: return null
            for (event in events.asReversed()) {
                val number = OrderText.nonEmpty(event.trackingNumber)
                if (number != null) return OrderTracking(number, OrderText.nonEmpty(event.carrier))
            }
            return null
        }
}

/** A tracking number and its carrier (Swift's `(number:, carrier:)` tuple). */
data class OrderTracking(val number: String, val carrier: String?)

object OrderDetailSerializer : KSerializer<OrderDetail> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("space.yardstore.app.features.orders.OrderDetail")

    override fun deserialize(decoder: Decoder): OrderDetail {
        val input = decoder as? JsonDecoder ?: error("OrderDetail decodes from JSON only")
        val obj = input.decodeJsonElement() as? JsonObject ?: error("OrderDetail must be an object")
        val summary = input.json.decodeFromJsonElement(OrderSummary.serializer(), obj)
        val f = input.json.decodeFromJsonElement(OrderDetailFields.serializer(), obj)
        return OrderDetail(
            summary = summary,
            lines = f.lines,
            shipTo = f.shipTo,
            paidAt = f.paidAt,
            cancelledAt = f.cancelledAt,
            cancelReason = f.cancelReason,
            deliveredAt = f.deliveredAt,
            returns = f.returns,
            refunds = f.refunds,
            timeline = f.timeline,
            actions = f.actions,
            delivery = f.delivery,
        )
    }

    override fun serialize(encoder: Encoder, value: OrderDetail) {
        error("OrderDetail is never sent to the server")
    }
}

@Serializable
data class OrderDetailResponse(val order: OrderDetail)

// endregion

// region Delivery (DeliveryDto)

@Serializable
data class OrderEstimate(
    val arrivalFrom: String? = null,
    val arrivalTo: String? = null,
    val deliveredOn: String? = null,
    val shipBy: String? = null,
    val late: Boolean = false,
)

@Serializable
data class ShipmentEvent(
    val id: String = UUID.randomUUID().toString(),
    /** label_created, shipped, in_transit, out_for_delivery, delivered, exception, returned */
    val status: String = "",
    val occurredAt: String = "",
    val carrier: String? = null,
    val trackingNumber: String? = null,
    val locationText: String? = null,
    val note: String? = null,
) {
    val date: Instant? get() = YardDate.parse(occurredAt)

    /** The website's words (src/components/market/delivery/order-delivery.tsx). */
    val label: String
        get() = when (status) {
            "label_created" -> "Label created"
            "shipped" -> "Shipped"
            "in_transit" -> "In transit"
            "out_for_delivery" -> "Out for delivery"
            "delivered" -> "Delivered"
            "exception" -> "Delayed"
            "returned" -> "Returned to the brand"
            else -> status.replace("_", " ").split(" ").joinToString(" ") { w ->
                w.lowercase().replaceFirstChar { it.titlecase(Locale.getDefault()) }
            }
        }
}

@Serializable
data class OrderDeliveryShipTo(
    val country: String = "",
    val city: String? = null,
)

@Serializable
data class OrderDelivery(
    val service: String = "standard",
    val shipTo: OrderDeliveryShipTo? = null,
    val estimate: OrderEstimate? = null,
    val shippedOn: String? = null,
    @Serializable(with = ShipmentEventListSerializer::class)
    val events: List<ShipmentEvent> = emptyList(),
) {
    fun lastEvent(status: String): ShipmentEvent? = events.lastOrNull { it.status == status }
    fun firstEvent(statuses: Set<String>): ShipmentEvent? = events.firstOrNull { it.status in statuses }
}

// endregion

// region Checkout (GET /api/checkout/{id})

@Serializable
data class OrderCheckoutPayment(
    val provider: String = "",
    val status: String = "",
    val authorizationUrl: String? = null,
    val message: String? = null,
    val channel: String? = null,
    val providerStatus: String? = null,
) {
    /** "Card", "Bank transfer", "USSD"… from the provider's channel. */
    val methodLabel: String?
        get() {
            val channel = OrderText.nonEmpty(channel) ?: return null
            return when (channel) {
                "card" -> "Card"
                "bank_transfer", "bank" -> "Bank transfer"
                "ussd" -> "USSD"
                "mobile_money" -> "Mobile money"
                "apple_pay" -> "Apple Pay"
                "eft" -> "Instant EFT"
                else -> channel.replace("_", " ").split(" ").joinToString(" ") { w ->
                    w.lowercase().replaceFirstChar { it.titlecase(Locale.getDefault()) }
                }
            }
        }
}

@Serializable
data class OrderCheckout(
    val id: String = "",
    /** pending_payment, paid, failed, expired, review */
    val status: String = "pending_payment",
    val reference: String? = null,
    val currency: String = "USD",
    val subtotalMinor: Int = 0,
    val shippingMinor: Int = 0,
    val totalMinor: Int = 0,
    val orderIds: List<String> = emptyList(),
    val createdAt: String = "",
    val paidAt: String? = null,
    val failureReason: String? = null,
    val payment: OrderCheckoutPayment? = null,
) {
    val isPending: Boolean get() = status == "pending_payment"
    val isPaid: Boolean get() = status == "paid"
    val isFailed: Boolean get() = status == "failed" || status == "expired" || payment?.status == "failed"
    val isAbandoned: Boolean get() = isPending && payment?.providerStatus == "abandoned"
}

// endregion

// region Request bodies

@Serializable
data class OrderCancelBody(val reason: String, val idempotencyKey: String)

@Serializable
data class OrderReturnLineBody(val variantId: String, val qty: Int)

@Serializable
data class OrderReturnBody(
    val lines: List<OrderReturnLineBody>,
    val reason: String,
    val note: String,
    val idempotencyKey: String,
)

/** Return reasons and their labels (src/server/orders/contracts.ts returnReasonLabels). */
enum class OrderReturnReason(val rawValue: String, val label: String) {
    TooSmall("too_small", "Too small"),
    TooLarge("too_large", "Too large"),
    NotAsDescribed("not_as_described", "Not as described"),
    Damaged("damaged", "Arrived damaged or faulty"),
    WrongItem("wrong_item", "Wrong item sent"),
    Unwanted("unwanted", "Changed my mind"),
    Other("other", "Something else"),
}

// endregion

// region Text helpers

object OrderText {
    fun nonEmpty(s: String?): String? = s?.trim()?.takeIf { it.isNotEmpty() }

    /** "NG" → "Nigeria" (falls back to the code). */
    fun countryName(code: String?): String? {
        val c = nonEmpty(code) ?: return null
        val name = runCatching { Locale.Builder().setRegion(c).build().displayCountry }.getOrNull()
        return nonEmpty(name) ?: c
    }

    /** "Lagos, Nigeria" / "Nigeria" / null. */
    fun place(city: String?, country: String?): String? {
        val parts = listOfNotNull(nonEmpty(city), countryName(country))
        return if (parts.isEmpty()) null else parts.joinToString(", ")
    }

    private fun utcFormat(pattern: String, ymd: String?): String? {
        val instant = YardDate.parse(ymd) ?: return null
        return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(instant.atZone(ZoneOffset.UTC))
    }

    /** A calendar day ("2026-11-16") as "16 Nov". */
    fun day(ymd: String?): String? = utcFormat("d MMM", ymd)

    /** A calendar day as "Mon 16 Nov". */
    fun weekdayDay(ymd: String?): String? = utcFormat("EEE d MMM", ymd)

    /** "11–16 Nov" / "30 Nov – 2 Dec" / "16 Nov". */
    fun range(from: String?, to: String?): String? {
        val a = day(from) ?: return day(to)
        val b = day(to)
        if (b == null || from == to) return a
        if (from != null && to != null && from.length >= 7 && to.length >= 7 && from.take(7) == to.take(7)) {
            val fromDay = from.takeLast(2).toIntOrNull() ?: 0
            return "$fromDay–$b"
        }
        return "$a – $b"
    }

    /** "12 Nov 2026" (as in "Placed 12 Nov 2026"). */
    fun longDate(date: Instant, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(date.atZone(zone))

    /** "Today at 21:44" / "Yesterday at 09:10" / "12 Nov at 18:00" (reference 07). */
    fun stamp(date: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val day = date.atZone(zone).toLocalDate()
        val today: LocalDate = now.atZone(zone).toLocalDate()
        val time = Formatters.time(date, zone)
        return when (day) {
            today -> "Today at $time"
            today.minusDays(1) -> "Yesterday at $time"
            else -> "${Formatters.shortDate(date, now, zone)} at $time"
        }
    }

    fun serviceLabel(service: String): String = when (service) {
        "express" -> "Express"
        "pickup" -> "Pickup"
        else -> "Standard"
    }

    /** Carrier tracking page (src/components/market/account/order-status.tsx trackingUrl). */
    fun trackingUrl(number: String, carrier: String?): String {
        val n = URLEncoder.encode(number, "UTF-8").replace("+", "%20")
        val c = (carrier ?: "").lowercase()
        return when {
            c.contains("dhl") -> "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=$n"
            c.contains("ups") -> "https://www.ups.com/track?tracknum=$n"
            c.contains("royal mail") -> "https://www.royalmail.com/track-your-item#/tracking-results/$n"
            else -> "https://parcelsapp.com/en/tracking/$n"
        }
    }

    fun idempotencyKey(prefix: String): String = "${prefix}_${UUID.randomUUID()}"
}

// endregion
