package space.yardstore.app.features.liveactivity

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.ContentState
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.Step
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.cancellation.CancellationException

// What order tracking needs from an order, read from the live API. Mirrors LiveActivityOrder.swift.
//
//   GET /api/orders/{id}                  → { order: OrderDetailDto }  (brand id/name/handle, ship-to, states.fulfilment)
//   GET /api/orders/{id}/delivery         → DeliveryDto (unwrapped)    (estimate, shipment events, shippedOn)
//   GET /api/catalog/storefronts/{handle} → brand.city                 (where it ships from; best effort)

/** A snapshot of one order for tracking: the static attributes plus the current state. */
data class LiveActivityOrder(
    val orderId: String,
    val brandName: String,
    val brandCity: String,
    val deliveryCity: String,
    /** The state to show, or null when the order shouldn't be tracked (not shipped yet). */
    val state: ContentState?,
    /** True when the order is over without a delivery (cancelled, returned to the brand): end tracking. */
    val isClosed: Boolean,
) {
    val attributes: YardOrderActivityAttributes
        get() = YardOrderActivityAttributes(orderId, brandName, brandCity, deliveryCity)

    companion object {
        /**
         * Reads the order, its delivery and the brand's city, and works out the state.
         * [knownBrandCity]: pass a known value to skip the storefront request (e.g. on refresh).
         */
        suspend fun load(
            orderId: String,
            knownBrandCity: String? = null,
            now: Instant = Instant.now(),
            api: APIClient = APIClient.shared,
        ): LiveActivityOrder {
            val encoded = Config.encodePath(orderId)
            val envelope = api.get<LiveActivityOrderEnvelope>("/api/orders/$encoded")
            // The delivery panel can fail on its own (e.g. a legacy order); the order alone still gives a state.
            val delivery: LiveActivityDeliveryDTO? = try {
                api.get<LiveActivityDeliveryDTO>("/api/orders/$encoded/delivery")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }

            var brandCity = knownBrandCity ?: ""
            val handle = envelope.order?.brand?.handle
            if (knownBrandCity == null && !handle.isNullOrEmpty()) {
                try {
                    val storefront = api.get<LiveActivityStorefrontDTO>("/api/catalog/storefronts/${Config.encodePath(handle)}")
                    brandCity = storefront.brand?.city ?: ""
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Best effort: the origin city is optional.
                }
            }
            return make(orderId, envelope.order, delivery, brandCity, now)
        }

        /** Pure mapping from the API's order + delivery to the tracking state (no I/O). */
        fun make(
            orderId: String,
            order: LiveActivityOrderDTO?,
            delivery: LiveActivityDeliveryDTO?,
            brandCity: String,
            now: Instant,
            zone: ZoneId = ZoneId.systemDefault(),
        ): LiveActivityOrder {
            val brandName = order?.brand?.name ?: "The brand"
            val deliveryCity = delivery?.shipTo?.city ?: order?.shipToPreview?.city ?: ""
            val fulfilment = order?.states?.fulfilment ?: ""

            fun result(state: ContentState?, closed: Boolean = false) =
                LiveActivityOrder(orderId, brandName, brandCity, deliveryCity, state, closed)

            if (fulfilment == "cancelled" || fulfilment == "returned_to_sender") return result(null, closed = true)

            val events = (delivery?.events ?: emptyList()).sortedBy { YardDate.parse(it.occurredAt) ?: Instant.MIN }
            val statuses = events.mapNotNull { it.status }
            if ("returned" in statuses) return result(null, closed = true)

            val estimate = delivery?.estimate
            val isDelivered = fulfilment == "delivered" ||
                "delivered" in statuses ||
                !estimate?.deliveredOn.isNullOrEmpty() ||
                !order?.deliveredAt.isNullOrEmpty()
            if (isDelivered) return result(ContentState(Step.Delivered, null, 1.0, "Delivered"))

            // The ETA: the end of the estimated arrival window, at 8 pm local time (the API sends calendar dates).
            val eta = LiveActivityDates.endOfArrivalDay(estimate?.arrivalTo ?: estimate?.arrivalFrom, zone)
            val arrivalStart = LiveActivityDates.startOfDay(estimate?.arrivalFrom ?: estimate?.arrivalTo, zone)
            val isLate = (estimate?.late ?: false) || estimate?.basis == "late"
            val latestShipment = statuses.lastOrNull { it != "exception" }
            val lastIsException = statuses.lastOrNull() == "exception"
            val shippedStatuses = setOf("shipped", "in_transit", "out_for_delivery")
            val hasShipped = fulfilment == "shipped" || statuses.any { it in shippedStatuses }

            if (latestShipment == "out_for_delivery") {
                val line = if (deliveryCity.isEmpty()) "Out for delivery" else "Out for delivery in $deliveryCity"
                return result(ContentState(Step.OutForDelivery, eta, Step.OutForDelivery.baseProgress + 0.04, line))
            }

            if (hasShipped) {
                // Time-based progress between the shipping moment and the ETA.
                val shippedEvent = events.firstOrNull { (it.status ?: "") in shippedStatuses }
                val shippedAt = YardDate.parse(shippedEvent?.occurredAt) ?: LiveActivityDates.startOfDay(delivery?.shippedOn, zone)
                var progress = Step.Shipped.baseProgress
                if (shippedAt != null && eta != null && eta.isAfter(shippedAt)) {
                    val fraction = (now.toEpochMilli() - shippedAt.toEpochMilli()).toDouble() /
                        (eta.toEpochMilli() - shippedAt.toEpochMilli()).toDouble()
                    progress = 0.25 + 0.53 * fraction.coerceIn(0.0, 1.0)
                }
                val arrivingSoon = arrivalStart != null && !now.isBefore(arrivalStart)
                if (arrivingSoon) {
                    val line = if (deliveryCity.isEmpty()) "Arriving soon" else "Arriving soon in $deliveryCity"
                    return result(
                        ContentState(
                            Step.ArrivingSoon, eta, maxOf(progress, Step.ArrivingSoon.baseProgress),
                            if (isLate) "Running late — ${line.lowercasedFirst()}" else line,
                        ),
                    )
                }
                val line = when {
                    lastIsException -> "Delayed — $brandName reported a delay"
                    isLate -> "Running late — new estimate"
                    brandCity.isNotEmpty() -> "On its way from $brandCity"
                    else -> "On its way"
                }
                return result(ContentState(Step.Shipped, eta, progress, line))
            }

            if (fulfilment == "processing" || "label_created" in statuses) {
                // Packed but not shipped: shown if tracking is already running; never auto-started.
                return result(ContentState(Step.Packed, eta, Step.Packed.baseProgress, "Packed by $brandName"))
            }
            return result(null)
        }
    }
}

private fun String.lowercasedFirst(): String = if (isEmpty()) this else first().lowercase() + drop(1)

// MARK: - DTOs (private to order tracking; every field optional)

@Serializable
data class LiveActivityOrderEnvelope(val order: LiveActivityOrderDTO? = null)

@Serializable
data class LiveActivityOrderDTO(
    val id: String? = null,
    val reference: String? = null,
    val brand: BrandRef? = null,
    val shipToPreview: ShipToPreview? = null,
    val states: States? = null,
    val deliveredAt: String? = null,
) {
    @Serializable data class BrandRef(val id: String? = null, val name: String? = null, val handle: String? = null)
    @Serializable data class ShipToPreview(val city: String? = null, val country: String? = null)
    @Serializable data class States(val fulfilment: String? = null)
}

@Serializable
data class LiveActivityDeliveryDTO(
    val estimate: Estimate? = null,
    val shippedOn: String? = null,
    val shipTo: ShipTo? = null,
    val events: List<Event>? = null,
) {
    @Serializable
    data class Estimate(
        val basis: String? = null,
        val arrivalFrom: String? = null,
        val arrivalTo: String? = null,
        val deliveredOn: String? = null,
        val late: Boolean? = null,
    )
    @Serializable data class Event(val status: String? = null, val occurredAt: String? = null, val locationText: String? = null)
    @Serializable data class ShipTo(val country: String? = null, val city: String? = null)
}

@Serializable
data class LiveActivityStorefrontDTO(val brand: Brand? = null) {
    @Serializable data class Brand(val city: String? = null)
}

// MARK: - Calendar dates ("2026-11-16") → local instants

object LiveActivityDates {
    /** Local midnight of a yyyy-MM-dd date (accepts a full ISO timestamp too). */
    fun startOfDay(string: String?, zone: ZoneId = ZoneId.systemDefault()): Instant? {
        if (string == null || string.length < 10) return null
        val day = runCatching { LocalDate.parse(string.take(10)) }.getOrNull() ?: return null
        return day.atStartOfDay(zone).toInstant()
    }

    /** 8 pm local on a yyyy-MM-dd date: "arrives by the end of that day". */
    fun endOfArrivalDay(string: String?, zone: ZoneId = ZoneId.systemDefault()): Instant? {
        if (string == null || string.length < 10) return null
        val day = runCatching { LocalDate.parse(string.take(10)) }.getOrNull() ?: return null
        return day.atTime(20, 0).atZone(zone).toInstant()
    }
}
