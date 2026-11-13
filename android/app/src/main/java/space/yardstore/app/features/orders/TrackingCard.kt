package space.yardstore.app.features.orders

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallMade
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import java.time.Duration
import java.time.Instant
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Everything the tracking card shows, as plain values. The Live Activity uses the same design
 * (reference 03: big ETA, from → to route line with a moving marker, Details / Track).
 */
data class OrderTrackingSnapshot(
    /** "On its way", "Out for delivery", "Delivered". */
    val statusLabel: String,
    val brandName: String,
    /** Big ETA: "11–16 Nov", "Today", "12 Nov". */
    val etaTitle: String,
    /** Above the ETA: "Estimated arrival", "Running late, now", "Delivered". */
    val etaCaption: String,
    /** Origin (brand) city, else the brand's name. */
    val originLabel: String,
    /** Destination (shopper) city. */
    val destinationLabel: String,
    /** Under each end of the route: "Shipped 9 Nov", "Est. 16 Nov". */
    val originDetail: String? = null,
    val destinationDetail: String? = null,
    /** Under the arc: "Standard shipping". */
    val serviceLabel: String,
    /** 0…1 along the route. */
    val progress: Double,
    val isLate: Boolean = false,
    val trackingUrl: String? = null,
) {
    companion object {
        /** Builds the snapshot from an order (null until the order has shipped). */
        fun from(order: OrderDetail, brandCity: String?, now: Instant = Instant.now()): OrderTrackingSnapshot? {
            val states = order.summary.states
            val delivery = order.delivery
            val isShipped = order.status == OrderStatus.Shipped || order.status == OrderStatus.Delivered ||
                states.fulfilment in setOf("shipped", "delivered")
            if (!isShipped) return null

            val out = delivery?.lastEvent("out_for_delivery") != null
            val deliveredOn = delivery?.estimate?.deliveredOn
            val delivered = states.fulfilment == "delivered" || order.status == OrderStatus.Delivered || deliveredOn != null
            val estimate = delivery?.estimate
            val range = OrderText.range(estimate?.arrivalFrom, estimate?.arrivalTo)
            val deliveredAtDay = YardDate.parse(order.deliveredAt)?.let { Formatters.shortDate(it) }
            val deliveredDay = OrderText.day(deliveredOn) ?: deliveredAtDay

            val statusLabel: String
            val etaTitle: String
            val etaCaption: String
            val progress: Double
            when {
                delivered -> {
                    statusLabel = "Delivered"
                    etaCaption = "Delivered"
                    etaTitle = deliveredDay ?: "Delivered"
                    progress = 1.0
                }
                out -> {
                    statusLabel = "Out for delivery"
                    etaCaption = "Arriving"
                    etaTitle = "Today"
                    progress = 0.85
                }
                else -> {
                    statusLabel = "On its way"
                    etaCaption = if (estimate?.late == true) "Running late, now" else "Estimated arrival"
                    etaTitle = range ?: "Soon"
                    progress = timeProgress(delivery?.shippedOn, estimate?.arrivalTo, now)
                }
            }

            val destinationCity = OrderText.nonEmpty(delivery?.shipTo?.city)
                ?: OrderText.nonEmpty(order.shipTo?.city)
                ?: OrderText.nonEmpty(order.summary.shipToPreview.city)
            val destination = destinationCity ?: OrderText.countryName(order.summary.shipToPreview.country) ?: "You"
            val shipped = OrderText.day(delivery?.shippedOn)?.let { "Shipped $it" }
            val destinationDetail = if (delivered) {
                deliveredDay?.let { "Delivered $it" }
            } else {
                OrderText.day(estimate?.arrivalTo)?.let { "Est. $it" }
            }
            val tracking = order.tracking

            return OrderTrackingSnapshot(
                statusLabel = statusLabel,
                brandName = order.summary.brand.name,
                etaTitle = etaTitle,
                etaCaption = etaCaption,
                originLabel = OrderText.nonEmpty(brandCity) ?: order.summary.brand.name,
                destinationLabel = destination,
                originDetail = shipped,
                destinationDetail = destinationDetail,
                serviceLabel = "${OrderText.serviceLabel(delivery?.service ?: order.summary.service)} shipping",
                progress = progress,
                isLate = estimate?.late == true && !delivered,
                trackingUrl = tracking?.let { OrderText.trackingUrl(it.number, it.carrier) },
            )
        }

        /** Between 0.2 (just shipped) and 0.8 (due) by elapsed time; 0.5 when the dates are unknown. */
        fun timeProgress(shippedOn: String?, arrivalTo: String?, now: Instant = Instant.now()): Double {
            val start = YardDate.parse(shippedOn) ?: return 0.5
            val end = YardDate.parse(arrivalTo) ?: return 0.5
            val total = Duration.between(start, end).seconds.toDouble()
            if (total <= 0) return 0.7
            val elapsed = Duration.between(start, now).seconds.toDouble() / total
            return min(0.8, max(0.2, 0.2 + elapsed * 0.6))
        }
    }
}

/** The in-app tracking card (top of Order detail once shipped). Acid card, black ink, in both modes. */
@Composable
fun TrackingCard(
    snapshot: OrderTrackingSnapshot,
    modifier: Modifier = Modifier,
    onDetails: (() -> Unit)? = null,
    onTrack: (() -> Unit)? = null,
) {
    val c = Color.yard
    val ink = c.onAcid
    val ink2 = c.onAcid.copy(alpha = 0.62f)
    Column(
        modifier
            .fillMaxWidth()
            .background(c.acid, YardShapes.card)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        // Status line
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Icon(
                if (snapshot.progress >= 1) Icons.Filled.CheckCircle else Icons.Filled.Inventory2,
                contentDescription = null,
                tint = ink,
                modifier = Modifier.size(16.dp),
            )
            Text(snapshot.statusLabel, style = YardFonts.bodyEmphasis, color = ink)
            Spacer(Modifier.weight(1f))
            Text(snapshot.brandName, style = YardFonts.caption, color = ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        // Big ETA
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(snapshot.etaCaption, style = YardFonts.captionEmphasis, color = if (snapshot.isLate) c.purple else ink2)
            Text(
                snapshot.etaTitle.uppercase(),
                style = YardFonts.display(44.sp),
                color = ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Route
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            OrderTrackingRouteArc(snapshot.progress, ink, ink2, Modifier.fillMaxWidth().height(54.dp))
            Row(verticalAlignment = Alignment.Top) {
                OrderRouteEnd(snapshot.originLabel, snapshot.originDetail, Alignment.Start, ink, ink2, Modifier.weight(1f))
                Text(
                    snapshot.serviceLabel,
                    style = YardFonts.micro,
                    color = ink2,
                    modifier = Modifier.padding(top = 2.dp, start = Spacing.s, end = Spacing.s),
                )
                OrderRouteEnd(snapshot.destinationLabel, snapshot.destinationDetail, Alignment.End, ink, ink2, Modifier.weight(1f))
            }
        }

        val showsTrack = onTrack != null && snapshot.trackingUrl != null
        if (onDetails != null || showsTrack) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                if (onDetails != null) {
                    Box(
                        Modifier
                            .height(34.dp)
                            .background(c.onAcid.copy(alpha = 0.1f), YardShapes.pill)
                            .pressableClick(onClick = onDetails)
                            .padding(horizontal = Spacing.l),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Details", style = YardFonts.captionEmphasis, color = ink)
                    }
                }
                if (showsTrack) {
                    Row(
                        Modifier
                            .height(34.dp)
                            .background(c.onAcid, YardShapes.pill)
                            .pressableClick(onClick = onTrack!!)
                            .padding(horizontal = Spacing.l),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        Text("Track", style = YardFonts.captionEmphasis, color = c.acid)
                        Icon(Icons.AutoMirrored.Filled.CallMade, contentDescription = null, tint = c.acid, modifier = Modifier.size(12.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderRouteEnd(
    title: String,
    detail: String?,
    alignment: Alignment.Horizontal,
    ink: Color,
    ink2: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier, horizontalAlignment = alignment, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = YardFonts.headline, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (detail != null) {
            Text(detail, style = YardFonts.micro, color = ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A dotted arc from origin to destination with a solid travelled part and a marker at [progress]. */
@Composable
fun OrderTrackingRouteArc(progress: Double, color: Color, faint: Color, modifier: Modifier = Modifier) {
    val animated by animateFloatAsState(progress.toFloat().coerceIn(0f, 1f), Motion.spring(), label = "route-progress")
    val density = LocalDensity.current
    BoxWithConstraints(modifier.clearAndSetSemantics { }) {
        val w = with(density) { maxWidth.toPx() }
        val h = with(density) { maxHeight.toPx() }
        val inset = with(density) { 6.dp.toPx() }
        val p0 = Offset(inset, h - inset)
        val p2 = Offset(w - inset, h - inset)
        val p1 = Offset(w / 2f, -h * 0.55f)
        val marker = orderQuadPoint(animated, p0, p1, p2)

        Canvas(Modifier.fillMaxSize()) {
            val arc = Path().apply {
                moveTo(p0.x, p0.y)
                quadraticTo(p1.x, p1.y, p2.x, p2.y)
            }
            drawPath(
                arc,
                faint,
                style = Stroke(
                    width = 1.5.dp.toPx(),
                    cap = StrokeCap.Round,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 5.dp.toPx())),
                ),
            )
            val measure = PathMeasure().apply { setPath(arc, false) }
            val travelled = Path()
            if (animated > 0f) measure.getSegment(0f, measure.length * animated, travelled, true)
            drawPath(travelled, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
            drawCircle(color, radius = 4.dp.toPx(), center = p0)
            drawCircle(color, radius = 4.dp.toPx(), center = p2, style = Stroke(width = 2.dp.toPx()))
        }
        val half = with(density) { 13.dp.toPx() }
        Box(
            Modifier
                .offset { IntOffset((marker.x - half).roundToInt(), (marker.y - half).roundToInt()) }
                .size(26.dp)
                .background(color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (animated >= 1f) Icons.Filled.Check else Icons.Filled.Inventory2,
                contentDescription = null,
                tint = Color.yard.acid,
                modifier = Modifier.size(13.dp),
            )
        }
    }
}

/** Point on the quadratic Bézier p0 → p2 (control p1) at [t]. */
internal fun orderQuadPoint(t: Float, p0: Offset, p1: Offset, p2: Offset): Offset {
    val u = 1 - t
    return Offset(
        u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    )
}

// region Previews

@Composable
private fun TrackingCardPreviewContent() {
    Column(Modifier.padding(Spacing.gutter).widthIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        TrackingCard(
            OrderTrackingSnapshot(
                statusLabel = "On its way", brandName = "Acme Studio", etaTitle = "11–16 Nov", etaCaption = "Estimated arrival",
                originLabel = "Lagos", destinationLabel = "London", originDetail = "Shipped 9 Nov", destinationDetail = "Est. 16 Nov",
                serviceLabel = "Standard shipping", progress = 0.45, trackingUrl = "https://parcelsapp.com/en/tracking/1",
            ),
            onDetails = {},
            onTrack = {},
        )
        TrackingCard(
            OrderTrackingSnapshot(
                statusLabel = "Delivered", brandName = "Acme Studio", etaTitle = "12 Nov", etaCaption = "Delivered",
                originLabel = "Lagos", destinationLabel = "Abuja", serviceLabel = "Express shipping", progress = 1.0,
            ),
        )
    }
}

@Preview(name = "TrackingCard — dark")
@Composable
private fun TrackingCardDarkPreview() = YardPreview(darkTheme = true) { TrackingCardPreviewContent() }

@Preview(name = "TrackingCard — light")
@Composable
private fun TrackingCardLightPreview() = YardPreview(darkTheme = false) { TrackingCardPreviewContent() }

// endregion
