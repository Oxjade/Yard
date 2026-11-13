package space.yardstore.app.features.liveactivity

import android.net.Uri
import java.time.Instant

// Order tracking: the data the ongoing notification shows. Mirrors
// ios/Yard/Features/LiveActivity/Shared/YardOrderActivityAttributes.swift (attributes + ContentState
// + deep links). Android has no Live Activities, so these feed an ongoing notification instead.

/** One brand's part of an order, tracked in an ongoing notification. */
data class YardOrderActivityAttributes(
    /** The order (one brand's part of a checkout): `/api/orders/{id}`. */
    val orderId: String,
    /** The brand shipping it. */
    val brandName: String,
    /** Where it ships from; may be empty when unknown. */
    val brandCity: String,
    /** Where it's going (the shopper's city); may be empty when unknown. */
    val deliveryCity: String,
) {
    /** Where the parcel is in its journey. [raw] values match the iOS push payload values. */
    enum class Step(val raw: String) {
        Packed("packed"),
        Shipped("shipped"),
        OutForDelivery("outForDelivery"),
        ArrivingSoon("arrivingSoon"),
        Delivered("delivered");

        /** Short label shown in the notification title and on the track button's states. */
        val title: String
            get() = when (this) {
                Packed -> "Packed"
                Shipped -> "Shipped"
                OutForDelivery -> "Out for delivery"
                ArrivingSoon -> "Arriving soon"
                Delivered -> "Delivered"
            }

        /** Where the progress bar sits at least, so it never looks empty. */
        val baseProgress: Double
            get() = when (this) {
                Packed -> 0.08
                Shipped -> 0.25
                OutForDelivery -> 0.82
                ArrivingSoon -> 0.7
                Delivered -> 1.0
            }

        companion object {
            fun fromRaw(raw: String?): Step? = entries.firstOrNull { it.raw == raw }
        }
    }

    /** The changing part: step, ETA, progress and one status line. */
    class ContentState(
        val step: Step,
        /** Estimated arrival (end of the estimated arrival window), null when unknown. */
        val etaDate: Instant?,
        progress: Double,
        /** One human line: "On its way from Lagos", "Out for delivery", "Delivered". */
        val statusLine: String,
    ) {
        /** 0…1 along the brand → you line. */
        val progress: Double = progress.coerceIn(0.0, 1.0)

        /** Progress clamped to 0…1. */
        val clampedProgress: Double get() = progress.coerceIn(0.0, 1.0)

        /** True while there is a future ETA to count down to. */
        fun hasUpcomingETA(now: Instant = Instant.now()): Boolean =
            step != Step.Delivered && etaDate != null && etaDate.isAfter(now)

        override fun equals(other: Any?): Boolean =
            other is ContentState && other.step == step && other.etaDate == etaDate &&
                other.progress == progress && other.statusLine == statusLine

        override fun hashCode(): Int = listOf(step, etaDate, progress, statusLine).hashCode()

        override fun toString(): String = "ContentState(step=$step, eta=$etaDate, progress=$progress, statusLine=$statusLine)"
    }
}

/**
 * Links the notification opens. Same paths as iOS (`yard://you/orders/<id>`), which
 * `Route.fromUrl` already maps to `Route.Order(id)`; MainActivity's `yard://` intent filter receives them.
 */
object YardOrderActivityLink {
    /** Order detail. */
    fun details(orderId: String): Uri = url(orderId, query = null)

    /** Order detail, asking for the delivery/tracking section (`view=track`, ignored by the router today). */
    fun track(orderId: String): Uri = url(orderId, query = "view=track")

    private fun url(orderId: String, query: String?): Uri =
        Uri.Builder()
            .scheme("yard")
            .authority("you")
            .appendPath("orders")
            .appendPath(orderId)
            .apply { if (query != null) encodedQuery(query) }
            .build()
}
