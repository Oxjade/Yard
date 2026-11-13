package space.yardstore.app.features.orders

import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.yard
import java.time.Instant

/** One step of the order's vertical timeline (reference 07). Mirrors `OrderTimelineStep`. */
data class OrderTimelineStep(
    val id: String,
    val title: String,
    val date: Instant? = null,
    val detail: String? = null,
    val state: Progress,
) {
    enum class Progress {
        /** Done: filled dot, timestamp. */
        Done,
        /** Where the order is now: pulsing dot. */
        Current,
        /** Still to come: hollow dot. */
        Upcoming,
        /** The order stopped here (cancelled, returned to sender). */
        Stopped,
    }
}

/**
 * Builds Paid → Packed → Shipped → Out for delivery → Delivered from the server's payment and
 * fulfilment states, the order timeline and the carrier's shipment events.
 */
object OrderTimelineBuilder {
    private class Def(val id: String, val title: String, val date: Instant?, val doneDetail: String?, val currentDetail: String)

    fun steps(order: OrderDetail): List<OrderTimelineStep> {
        val states = order.summary.states
        val status = order.status
        val delivery = order.delivery

        val paidDate = YardDate.parse(order.paidAt) ?: order.eventDate("payment.captured")
        val packedDate = order.eventDate("fulfilment.processing")
        val shippedDate = order.eventDate("fulfilment.shipped") ?: delivery?.firstEvent(setOf("shipped", "in_transit"))?.date
        val outDate = delivery?.lastEvent("out_for_delivery")?.date
        val deliveredDate = YardDate.parse(order.deliveredAt) ?: order.eventDate("fulfilment.delivered") ?: delivery?.lastEvent("delivered")?.date

        // How far the order got: 0 Paid, 1 Packed, 2 Shipped, 3 Out for delivery, 4 Delivered.
        var reached = -1
        val paidStates = setOf("paid", "partially_refunded", "refunded")
        if (states.payment in paidStates || paidDate != null) reached = 0
        when (states.fulfilment) {
            "processing" -> reached = maxOf(reached, 1)
            "shipped" -> reached = maxOf(reached, 2)
            "delivered" -> reached = 4
        }
        when (status) {
            OrderStatus.Processing -> reached = maxOf(reached, 1)
            OrderStatus.Shipped -> reached = maxOf(reached, 2)
            OrderStatus.Delivered, OrderStatus.RefundRequested ->
                reached = maxOf(reached, if (states.fulfilment == "delivered" || deliveredDate != null) 4 else reached)
            else -> Unit
        }
        if (reached == 2 && outDate != null) reached = 3
        if (reached < 4 && deliveredDate != null && states.fulfilment == "delivered") reached = 4

        val stoppedCancelled = status == OrderStatus.Cancelled || states.fulfilment == "cancelled"
        val returnedToSender = states.fulfilment == "returned_to_sender"
        val paymentFailed = states.payment == "failed"

        val estimate = delivery?.estimate
        val arrival = OrderText.range(estimate?.arrivalFrom, estimate?.arrivalTo)
        val lastScan = delivery?.events?.lastOrNull()?.let { OrderText.nonEmpty(it.locationText) }
        val paidDetail = if (reached >= 0) {
            "Payment confirmed. The brand has your order and will start preparing it soon."
        } else {
            "Not charged yet. The brand starts preparing it once the payment provider confirms payment."
        }
        val shippedDetail = when {
            lastScan != null -> "Your parcel is with the carrier. Last seen in $lastScan."
            arrival != null -> "Your parcel is with the carrier. Estimated arrival $arrival."
            else -> "Your parcel is with the carrier."
        }
        val defs = listOf(
            Def("paid", "Paid", paidDate, null, paidDetail),
            Def("packed", "Packed", packedDate, null, "The brand is packing your order. Tracking follows when it ships."),
            Def("shipped", "Shipped", shippedDate, null, shippedDetail),
            Def("out", "Out for delivery", outDate, null, "Your parcel is on the last stretch and should arrive today."),
            Def("delivered", "Delivered", deliveredDate, "Something not right? You can request a return.", "Delivered."),
        )

        // Pending payment: the first step is current, the rest are to come.
        val currentIndex = maxOf(reached, 0)
        val stopped = stoppedCancelled || returnedToSender || paymentFailed

        val result = mutableListOf<OrderTimelineStep>()
        defs.forEachIndexed { index, def ->
            val state = when {
                index < currentIndex -> OrderTimelineStep.Progress.Done
                index == currentIndex -> when {
                    stopped -> if (reached >= index) OrderTimelineStep.Progress.Done else OrderTimelineStep.Progress.Upcoming
                    index == defs.size - 1 -> OrderTimelineStep.Progress.Done
                    else -> OrderTimelineStep.Progress.Current
                }
                else -> OrderTimelineStep.Progress.Upcoming
            }
            if (stopped && state == OrderTimelineStep.Progress.Upcoming) return@forEachIndexed
            val detail = when (state) {
                OrderTimelineStep.Progress.Current -> def.currentDetail
                OrderTimelineStep.Progress.Done -> if (index == defs.size - 1) def.doneDetail else null
                OrderTimelineStep.Progress.Upcoming, OrderTimelineStep.Progress.Stopped -> null
            }
            val awaitingPayment = index == 0 && reached < 0 && !paymentFailed
            val title = if (awaitingPayment) "Awaiting payment" else def.title
            val showsDate = state == OrderTimelineStep.Progress.Done || state == OrderTimelineStep.Progress.Current
            result += OrderTimelineStep(def.id, title, if (showsDate) def.date else null, detail, state)
        }

        when {
            paymentFailed -> result += OrderTimelineStep(
                "failed", "Payment didn’t go through", order.eventDate("payment.failed"),
                "Nothing was charged, and the order won’t be prepared.", OrderTimelineStep.Progress.Stopped,
            )
            stoppedCancelled -> result += OrderTimelineStep(
                "cancelled", "Cancelled", YardDate.parse(order.cancelledAt) ?: order.eventDate("order.cancelled"),
                OrderStatusText.note(OrderStatus.Cancelled, states.payment), OrderTimelineStep.Progress.Stopped,
            )
            returnedToSender -> result += OrderTimelineStep(
                "returned", "Returned to the brand",
                order.eventDate("fulfilment.returned_to_sender") ?: delivery?.lastEvent("returned")?.date,
                "The carrier sent the parcel back to the brand.", OrderTimelineStep.Progress.Stopped,
            )
        }
        return result
    }
}

/** The vertical timeline: dot column with connecting rails, title, timestamp, note. */
@Composable
fun OrderTimelineView(steps: List<OrderTimelineStep>, modifier: Modifier = Modifier) {
    Column(modifier.semantics { contentDescription = "Order progress" }) {
        steps.forEachIndexed { index, step ->
            OrderTimelineRow(
                step = step,
                isLast = index == steps.size - 1,
                nextState = steps.getOrNull(index + 1)?.state,
            )
        }
    }
}

@Composable
private fun OrderTimelineRow(step: OrderTimelineStep, isLast: Boolean, nextState: OrderTimelineStep.Progress?) {
    val c = Color.yard
    val railColor = when (nextState) {
        null -> Color.Transparent
        OrderTimelineStep.Progress.Done, OrderTimelineStep.Progress.Current, OrderTimelineStep.Progress.Stopped -> c.ink.copy(alpha = 0.5f)
        OrderTimelineStep.Progress.Upcoming -> c.line
    }
    val titleColor = when (step.state) {
        OrderTimelineStep.Progress.Done, OrderTimelineStep.Progress.Current -> c.ink
        OrderTimelineStep.Progress.Upcoming -> c.ink3
        OrderTimelineStep.Progress.Stopped -> c.danger
    }
    val a11yState = when (step.state) {
        OrderTimelineStep.Progress.Done -> "Done"
        OrderTimelineStep.Progress.Current -> "Current step"
        OrderTimelineStep.Progress.Upcoming -> "To come"
        OrderTimelineStep.Progress.Stopped -> ""
    }
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .semantics(mergeDescendants = true) { stateDescription = a11yState },
        horizontalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Column(
            Modifier
                .width(22.dp)
                .fillMaxHeight(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (step.date != null) Spacer(Modifier.height(18.dp))
            OrderTimelineDot(step.state, Modifier.size(22.dp))
            if (!isLast) {
                Box(
                    Modifier
                        .padding(vertical = Spacing.xs)
                        .width(1.5.dp)
                        .weight(1f)
                        .heightIn(min = 22.dp)
                        .background(railColor),
                )
            }
        }
        Column(
            Modifier
                .weight(1f)
                .padding(bottom = if (isLast) 0.dp else Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xxs),
        ) {
            if (step.date != null) {
                Text(OrderText.stamp(step.date), style = YardFonts.caption, color = c.ink2)
            }
            Text(
                step.title,
                style = if (step.state == OrderTimelineStep.Progress.Current) YardFonts.headline else YardFonts.body,
                color = titleColor,
            )
            if (step.detail != null) {
                Text(step.detail, style = YardFonts.callout, color = c.ink2, modifier = Modifier.padding(top = Spacing.xs))
            }
        }
    }
}

/** Filled (done), pulsing (current), hollow (upcoming), cross (stopped). */
@Composable
fun OrderTimelineDot(state: OrderTimelineStep.Progress, modifier: Modifier = Modifier) {
    val c = Color.yard
    Box(modifier, contentAlignment = Alignment.Center) {
        when (state) {
            OrderTimelineStep.Progress.Done -> {
                Box(Modifier.size(22.dp).background(c.ink, CircleShape))
                Icon(Icons.Filled.Check, contentDescription = null, tint = c.bg, modifier = Modifier.size(12.dp))
            }
            OrderTimelineStep.Progress.Current -> {
                val transition = rememberInfiniteTransition(label = "timeline-pulse")
                val pulse by transition.animateFloat(
                    initialValue = 0f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(1500, easing = LinearOutSlowInEasing), RepeatMode.Restart),
                    label = "timeline-pulse-value",
                )
                Box(
                    Modifier
                        .size(22.dp)
                        .graphicsLayer {
                            val s = 0.8f + 1.1f * pulse
                            scaleX = s
                            scaleY = s
                            alpha = 1f - pulse
                        }
                        .background(c.success.copy(alpha = 0.35f), CircleShape),
                )
                Box(Modifier.size(14.dp).background(c.success, CircleShape))
            }
            OrderTimelineStep.Progress.Upcoming -> {
                Box(Modifier.size(14.dp).border(2.dp, c.ink3, CircleShape))
            }
            OrderTimelineStep.Progress.Stopped -> {
                Box(Modifier.size(22.dp).background(c.danger, CircleShape))
                Icon(Icons.Filled.Close, contentDescription = null, tint = c.onPhoto, modifier = Modifier.size(12.dp))
            }
        }
    }
}

// region Previews

@Composable
private fun OrderTimelinePreviewContent() {
    val now = Instant.now()
    Card(Modifier.padding(Spacing.gutter)) {
        OrderTimelineView(
            listOf(
                OrderTimelineStep("paid", "Paid", now.minusSeconds(86_400 * 2), state = OrderTimelineStep.Progress.Done),
                OrderTimelineStep("packed", "Packed", now.minusSeconds(86_400), state = OrderTimelineStep.Progress.Done),
                OrderTimelineStep("shipped", "Shipped", now.minusSeconds(3_600), "Your parcel is with the carrier.", OrderTimelineStep.Progress.Current),
                OrderTimelineStep("out", "Out for delivery", state = OrderTimelineStep.Progress.Upcoming),
                OrderTimelineStep("delivered", "Delivered", state = OrderTimelineStep.Progress.Upcoming),
            ),
        )
    }
}

@Preview(name = "Timeline — dark")
@Composable
private fun OrderTimelineDarkPreview() = YardPreview(darkTheme = true) { OrderTimelinePreviewContent() }

@Preview(name = "Timeline — light")
@Composable
private fun OrderTimelineLightPreview() = YardPreview(darkTheme = false) { OrderTimelinePreviewContent() }

// endregion
