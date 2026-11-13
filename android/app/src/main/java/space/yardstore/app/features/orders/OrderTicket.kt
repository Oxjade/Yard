package space.yardstore.app.features.orders

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard
import kotlin.math.max
import kotlin.math.min

// region Ticket shape (reference 06)

/**
 * A card with two semicircle notches cut into its sides at [notchY] (from the top): the
 * "tear here" line of a ticket. Mirrors `OrderTicketShape`.
 */
class OrderTicketShape(
    private val notchY: Dp,
    private val cornerRadius: Dp = Radius.card,
    private val notchRadius: Dp = 12.dp,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width
        val h = size.height
        val r = max(0f, min(with(density) { cornerRadius.toPx() }, min(w / 2f, h / 2f)))
        val n = max(0f, min(with(density) { notchRadius.toPx() }, h / 4f))
        val lowest = r + n
        val highest = max(lowest, h - r - n)
        val y = min(max(with(density) { notchY.toPx() }, lowest), highest)

        val p = Path()
        p.moveTo(r, 0f)
        p.lineTo(w - r, 0f)
        p.arcTo(Rect(w - 2 * r, 0f, w, 2 * r), -90f, 90f, false)
        p.lineTo(w, y - n)
        // Right notch: from its top round the inside (left) to its bottom.
        p.arcTo(Rect(w - n, y - n, w + n, y + n), -90f, -180f, false)
        p.lineTo(w, h - r)
        p.arcTo(Rect(w - 2 * r, h - 2 * r, w, h), 0f, 90f, false)
        p.lineTo(r, h)
        p.arcTo(Rect(0f, h - 2 * r, 2 * r, h), 90f, 90f, false)
        p.lineTo(0f, y + n)
        // Left notch: from its bottom round the inside (right) to its top.
        p.arcTo(Rect(-n, y - n, n, y + n), 90f, -180f, false)
        p.lineTo(0f, r)
        p.arcTo(Rect(0f, 0f, 2 * r, 2 * r), 180f, 90f, false)
        p.close()
        return Outline.Generic(p)
    }

    override fun equals(other: Any?): Boolean =
        other is OrderTicketShape && other.notchY == notchY && other.cornerRadius == cornerRadius && other.notchRadius == notchRadius

    override fun hashCode(): Int = (notchY.hashCode() * 31 + cornerRadius.hashCode()) * 31 + notchRadius.hashCode()
}

/** The dashed perforation drawn between the notches. */
@Composable
fun OrderPerforation(modifier: Modifier = Modifier) {
    val color = Color.yard.ink3.copy(alpha = 0.6f)
    Canvas(
        modifier
            .fillMaxWidth()
            .height(2.dp)
            .clearAndSetSemantics { },
    ) {
        val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 6.dp.toPx()))
        drawLine(
            color = color,
            start = Offset(0f, size.height / 2f),
            end = Offset(size.width, size.height / 2f),
            strokeWidth = 1.5.dp.toPx(),
            cap = StrokeCap.Round,
            pathEffect = dash,
        )
    }
}

/**
 * A ticket card: [header], a perforated tear line with side notches, then [content].
 *
 *   OrderTicket(header = { Text("Checkout YRD-1234") }) { detailsGrid }
 */
@Composable
fun OrderTicket(
    modifier: Modifier = Modifier,
    background: Color = Color.yard.surface,
    header: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val notchRadius = 12.dp
    val density = LocalDensity.current
    var headerHeightPx by remember { mutableIntStateOf(with(density) { 96.dp.roundToPx() }) }
    val headerHeight = with(density) { headerHeightPx.toDp() }
    val shape = remember(headerHeight) { OrderTicketShape(notchY = headerHeight + Spacing.m, notchRadius = notchRadius) }
    Column(
        modifier
            .fillMaxWidth()
            .background(background, shape)
            .border(1.dp, Color.yard.line, shape),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .onSizeChanged { headerHeightPx = it.height },
            content = header,
        )
        OrderPerforation(
            Modifier
                .padding(horizontal = notchRadius + Spacing.s)
                .padding(vertical = Spacing.m - 1.dp),
        )
        Column(Modifier.fillMaxWidth(), content = content)
    }
}

// endregion

// region Success badge

/** Which seal the confirmation shows. */
enum class OrderBadgeTone { Success, Pending, Failed }

/**
 * The glowing success seal at the top of the confirmation: an acid glow in dark mode, a soft
 * halo in light mode, sunburst rays, a slow breathing pulse. [tone] switches it for pending / failed.
 */
@Composable
fun OrderSuccessBadge(modifier: Modifier = Modifier, tone: OrderBadgeTone = OrderBadgeTone.Success) {
    val c = Color.yard
    val fill = when (tone) {
        OrderBadgeTone.Success -> c.acid
        OrderBadgeTone.Pending -> c.violet
        OrderBadgeTone.Failed -> c.danger
    }
    val iconColor = if (tone == OrderBadgeTone.Success) c.onAcid else c.onPhoto
    val icon = when (tone) {
        OrderBadgeTone.Success -> Icons.Filled.Verified
        OrderBadgeTone.Pending -> Icons.Filled.Schedule
        OrderBadgeTone.Failed -> Icons.Filled.Warning
    }
    val glowOpacity = if (c.isDark) 0.55f else 0.28f
    val rayAlpha = if (c.isDark) 0.22f else 0.35f

    val transition = rememberInfiniteTransition(label = "order-badge")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "order-badge-phase",
    )

    Box(
        modifier
            .fillMaxWidth()
            .height(220.dp)
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(260.dp)) {
            val center = Offset(size.width / 2f, size.height / 2f)
            // Halo
            val start = 30.dp.toPx()
            val end = 130.dp.toPx()
            drawCircle(
                brush = Brush.radialGradient(
                    0f to fill.copy(alpha = glowOpacity),
                    start / end to fill.copy(alpha = glowOpacity),
                    1f to fill.copy(alpha = 0f),
                    center = center,
                    radius = end,
                ),
                radius = end,
                center = center,
            )
            // Sunburst rays (reference 06)
            for (i in 0 until 36) {
                val length = (if (i % 2 == 0) 26 else 16).dp.toPx()
                val mid = 86.dp.toPx()
                rotate(degrees = i * 10f, pivot = center) {
                    drawLine(
                        color = fill.copy(alpha = rayAlpha),
                        start = Offset(center.x, center.y - mid - length / 2f),
                        end = Offset(center.x, center.y - mid + length / 2f),
                        strokeWidth = 1.dp.toPx(),
                        cap = StrokeCap.Round,
                    )
                }
            }
            // Breathing glow behind the seal (SwiftUI's coloured shadow).
            val glowRadius = 46.dp.toPx() + (22.dp.toPx() + 12.dp.toPx() * phase)
            drawCircle(
                brush = Brush.radialGradient(
                    0f to fill.copy(alpha = glowOpacity + 0.15f * phase),
                    0.55f to fill.copy(alpha = (glowOpacity + 0.15f * phase) * 0.5f),
                    1f to fill.copy(alpha = 0f),
                    center = center,
                    radius = glowRadius,
                ),
                radius = glowRadius,
                center = center,
            )
        }
        Box(
            Modifier
                .size(92.dp)
                .graphicsLayer {
                    val s = 1f + 0.03f * phase
                    scaleX = s
                    scaleY = s
                }
                .background(fill, androidx.compose.foundation.shape.CircleShape),
        )
        Icon(icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(38.dp))
    }
}

// endregion

// region Details grid

/** One label/value pair in [OrderDetailsGrid]. */
data class OrderDetailsGridItem(val label: String, val value: String)

/** A two-column label/value grid for tickets ("Order number", "Date"…). */
@Composable
fun OrderDetailsGrid(items: List<OrderDetailsGridItem>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        items.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
                row.forEach { item ->
                    Column(
                        Modifier
                            .weight(1f)
                            .semantics(mergeDescendants = true) { },
                        verticalArrangement = Arrangement.spacedBy(Spacing.xxs),
                    ) {
                        Text(item.label, style = YardFonts.caption, color = Color.yard.ink3)
                        SelectionContainer {
                            Text(item.value, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
                        }
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

// endregion

// region Previews

@Composable
private fun OrderTicketPreviewContent() {
    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        OrderSuccessBadge()
        OrderTicket(
            header = {
                Column(Modifier.padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Checkout YRD-48213", style = YardFonts.title, color = Color.yard.ink)
                    Text("2 brands, shipping separately", style = YardFonts.caption, color = Color.yard.ink2)
                }
            },
        ) {
            OrderDetailsGrid(
                listOf(
                    OrderDetailsGridItem("Order number", "YRD-48213"),
                    OrderDetailsGridItem("Date", "13 Nov 2026"),
                    OrderDetailsGridItem("Items", "3"),
                    OrderDetailsGridItem("Total", "$165"),
                ),
                Modifier.padding(Spacing.l),
            )
        }
    }
}

@Preview(name = "Ticket — dark")
@Composable
private fun OrderTicketDarkPreview() = YardPreview(darkTheme = true) { OrderTicketPreviewContent() }

@Preview(name = "Ticket — light")
@Composable
private fun OrderTicketLightPreview() = YardPreview(darkTheme = false) { OrderTicketPreviewContent() }

// endregion
