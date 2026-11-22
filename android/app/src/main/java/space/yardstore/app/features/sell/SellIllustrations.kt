package space.yardstore.app.features.sell

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import kotlinx.coroutines.delay
import space.yardstore.app.designsystem.YardCondensedFamily
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.yard
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

// Animated onboarding art for "Shop or sell", the application's success and Quick add's success.
// Everything is drawn natively (Canvas paths) in Yard's colours. Performance: geometry is built once
// per size in drawWithCache; the animated values are State reads inside the draw lambda, so motion
// only redraws (no recomposition). Loops are low amplitude, run only while composed, and under
// reduced motion every piece shows its final pose without moving.

private const val TAU = (2 * PI).toFloat()

/** A looping 0→1 clock ([periodMillis] long), or a fixed 0 under reduced motion. */
@Composable
internal fun rememberLoopClock(periodMillis: Int, reduce: Boolean): State<Float> {
    if (reduce) return remember { mutableFloatStateOf(0f) }
    val transition = rememberInfiniteTransition(label = "illustration-loop")
    return transition.animateFloat(0f, 1f, infiniteRepeatable(tween(periodMillis, easing = LinearEasing)), label = "t")
}

/** An entrance spring 0→1 (overshoots a little) after [delayMillis]; 1 at once under reduced motion. */
@Composable
internal fun rememberEntrance(reduce: Boolean, delayMillis: Int = 0, damping: Float = 0.55f, stiffness: Float = 140f): State<Float> {
    val a = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) {
            a.snapTo(1f)
        } else {
            delay(delayMillis.toLong())
            a.animateTo(1f, spring(dampingRatio = damping, stiffness = stiffness))
        }
    }
    return a.asState()
}

private fun wave(t: Float, cycles: Int = 1, phase: Float = 0f): Float = sin(TAU * (t * cycles + phase))

/** A four-point sparkle. */
internal fun DrawScope.sparkle(center: Offset, r: Float, color: Color, alpha: Float = 1f) {
    if (r <= 0f) return
    val p = Path().apply {
        moveTo(center.x, center.y - r)
        quadraticTo(center.x + r * 0.12f, center.y - r * 0.12f, center.x + r, center.y)
        quadraticTo(center.x + r * 0.12f, center.y + r * 0.12f, center.x, center.y + r)
        quadraticTo(center.x - r * 0.12f, center.y + r * 0.12f, center.x - r, center.y)
        quadraticTo(center.x - r * 0.12f, center.y - r * 0.12f, center.x, center.y - r)
        close()
    }
    drawPath(p, color, alpha = alpha.coerceIn(0f, 1f))
}

/** A twinkle: scale and alpha pulse for a sparkle at [phase]. */
private fun twinkle(t: Float, phase: Float): Float = 0.55f + 0.45f * ((wave(t, 2, phase) + 1f) / 2f)

/** A soft drop shadow under a rounded rect (two stacked translucent layers read as a blur). */
private fun DrawScope.softShadow(topLeft: Offset, size: Size, corner: Float, color: Color, lift: Float) {
    drawRoundRect(color.copy(alpha = 0.10f), topLeft + Offset(lift * 0.4f, lift * 1.4f), size, CornerRadius(corner * 1.2f))
    drawRoundRect(color.copy(alpha = 0.10f), topLeft + Offset(lift * 0.2f, lift * 0.7f), size, CornerRadius(corner))
}

/**
 * SHOP: three product cards fanning out behind a shopping bag with depth, a price tag swinging on
 * a string, sparkles. Enter: the cards fan open with a springy settle, the bag drops in, the tag
 * swings. Idle: a slow bob, the cards breathe, the tag sways, sparkles twinkle. [tilt] (−1…1 per
 * axis) shifts the layers by depth for a parallax on press.
 */
@Composable
fun ShopIllustration(modifier: Modifier = Modifier, tilt: State<Offset>? = null, delayMillis: Int = 120) {
    val reduce = rememberReducedMotion()
    val clock = rememberLoopClock(6000, reduce)
    val fan = rememberEntrance(reduce, delayMillis, damping = 0.5f, stiffness = 120f)
    val drop = rememberEntrance(reduce, delayMillis + 120, damping = 0.6f, stiffness = 200f)
    val black = Color.yard.onAcid
    val white = Color.yard.onPhoto
    val violet = Color.yard.violetFill
    val acid = Color.yard.acid
    val graphite = lerp(black, white, 0.16f)
    val charcoal = lerp(black, white, 0.07f)
    Spacer(
        modifier
            .semantics { contentDescription = "Illustration: product cards and a shopping bag" }
            .drawWithCache {
                val w = size.width
                val cardSize = Size(w * 0.30f, w * 0.40f)
                val cardCorner = w * 0.045f
                val cardTopLeft = Offset(w * 0.35f, w * 0.10f)
                val pivot = Offset(w * 0.50f, w * 0.62f)
                // The bag: front face with a slight taper, a side face for depth, a rim.
                val bagTop = w * 0.42f
                val bagBottom = w * 0.90f
                val front = Path().apply {
                    moveTo(w * 0.31f, bagTop)
                    lineTo(w * 0.67f, bagTop)
                    lineTo(w * 0.70f, bagBottom - w * 0.04f)
                    quadraticTo(w * 0.705f, bagBottom, w * 0.66f, bagBottom)
                    lineTo(w * 0.32f, bagBottom)
                    quadraticTo(w * 0.275f, bagBottom, w * 0.28f, bagBottom - w * 0.04f)
                    close()
                }
                val side = Path().apply {
                    moveTo(w * 0.67f, bagTop)
                    lineTo(w * 0.76f, bagTop - w * 0.035f)
                    lineTo(w * 0.79f, bagBottom - w * 0.07f)
                    quadraticTo(w * 0.79f, bagBottom - w * 0.035f, w * 0.75f, bagBottom - w * 0.025f)
                    lineTo(w * 0.70f, bagBottom - w * 0.04f)
                    close()
                }
                val rim = Path().apply {
                    moveTo(w * 0.31f, bagTop)
                    lineTo(w * 0.67f, bagTop)
                    lineTo(w * 0.76f, bagTop - w * 0.035f)
                    lineTo(w * 0.40f, bagTop - w * 0.035f)
                    close()
                }
                val tag = Path().apply {
                    // A tag pointing up, hole at the tip; drawn around (0,0) = the hole.
                    val tw = w * 0.15f
                    val th = w * 0.21f
                    moveTo(0f, -w * 0.03f)
                    lineTo(tw / 2f, w * 0.03f)
                    lineTo(tw / 2f, th - w * 0.02f)
                    quadraticTo(tw / 2f, th, tw / 2f - w * 0.02f, th)
                    lineTo(-tw / 2f + w * 0.02f, th)
                    quadraticTo(-tw / 2f, th, -tw / 2f, th - w * 0.02f)
                    lineTo(-tw / 2f, w * 0.03f)
                    close()
                }
                val cards = listOf(black to violet, violet to white, white to violet)
                onDrawBehind {
                    val t = clock.value
                    val f = fan.value
                    val d = drop.value
                    val tl = tilt?.value ?: Offset.Zero
                    val bob = wave(t) * w * 0.012f
                    val par = w * 0.025f
                    // Ground shadow.
                    drawOval(
                        Brush.radialGradient(listOf(black.copy(alpha = 0.22f), black.copy(alpha = 0f)), center = Offset(w * 0.52f, w * 0.95f), radius = w * 0.34f),
                        topLeft = Offset(w * 0.18f, w * 0.89f),
                        size = Size(w * 0.68f, w * 0.12f),
                    )
                    // Cards fanning behind the bag.
                    translate(tl.x * par * 0.6f, tl.y * par * 0.6f + bob * 0.6f) {
                        val angles = listOf(-24f, -6f, 14f)
                        cards.forEachIndexed { i, (fill, accent) ->
                            val breathe = wave(t, 1, i * 0.22f) * 1.6f
                            val angle = angles[i] * f + breathe
                            val dx = (i - 1) * w * 0.07f * f
                            val grow = (0.35f + f * 0.65f).coerceIn(0f, 1.15f) * (if (f < 0.02f) 0f else 1f)
                            rotate(angle, pivot) {
                                scale(grow, grow, pivot) {
                                translate(dx, -w * 0.02f * f * (if (i == 1) 1f else 0f)) {
                                    softShadow(cardTopLeft, cardSize, cardCorner, black, w * 0.02f)
                                    drawRoundRect(fill, cardTopLeft, cardSize, CornerRadius(cardCorner))
                                    // Image area, two text lines, a price pill.
                                    val inset = w * 0.022f
                                    val img = Size(cardSize.width - inset * 2, cardSize.height * 0.55f)
                                    drawRoundRect(accent.copy(alpha = if (fill == white) 0.28f else 0.9f), cardTopLeft + Offset(inset, inset), img, CornerRadius(cardCorner * 0.6f))
                                    drawCircle(white.copy(alpha = 0.35f), radius = img.width * 0.16f, center = cardTopLeft + Offset(inset + img.width * 0.62f, inset + img.height * 0.42f))
                                    val lineColor = if (fill == white) black else white
                                    drawRoundRect(lineColor.copy(alpha = 0.8f), cardTopLeft + Offset(inset, inset * 2 + img.height), Size(img.width * 0.7f, w * 0.018f), CornerRadius(w * 0.01f))
                                    drawRoundRect(lineColor.copy(alpha = 0.35f), cardTopLeft + Offset(inset, inset * 2 + img.height + w * 0.03f), Size(img.width * 0.45f, w * 0.016f), CornerRadius(w * 0.01f))
                                }
                            }
                            }
                        }
                    }
                    // The bag drops in and bobs.
                    val dropY = (1f - d) * -w * 0.25f
                    translate(tl.x * par, tl.y * par + bob + dropY) {
                        val bagAlpha = (d * 3f).coerceIn(0f, 1f)
                        // Back handle (behind the rim), then the bag.
                        drawArc(
                            charcoal, 180f, 180f, false,
                            topLeft = Offset(w * 0.45f, bagTop - w * 0.165f), size = Size(w * 0.20f, w * 0.26f),
                            style = Stroke(width = w * 0.028f, cap = StrokeCap.Round), alpha = bagAlpha,
                        )
                        drawPath(side, graphite, alpha = bagAlpha)
                        drawPath(front, black, alpha = bagAlpha)
                        drawPath(rim, lerp(graphite, white, 0.15f), alpha = bagAlpha)
                        // Front highlight (top-left light) and an acid band.
                        drawPath(front, Brush.linearGradient(listOf(white.copy(alpha = 0.16f), white.copy(alpha = 0f)), start = Offset(w * 0.28f, bagTop), end = Offset(w * 0.55f, w * 0.70f)), alpha = bagAlpha)
                        drawRect(acid, topLeft = Offset(w * 0.295f, w * 0.60f), size = Size(w * 0.39f, w * 0.05f), alpha = bagAlpha)
                        drawRect(lerp(acid, black, 0.35f), topLeft = Offset(w * 0.685f, w * 0.585f), size = Size(w * 0.09f, w * 0.05f), alpha = bagAlpha * 0.9f)
                        // Front handle (its ends sit on the rim) with a highlight.
                        drawArc(
                            black, 180f, 180f, false,
                            topLeft = Offset(w * 0.38f, bagTop - w * 0.13f), size = Size(w * 0.20f, w * 0.26f),
                            style = Stroke(width = w * 0.032f, cap = StrokeCap.Round), alpha = bagAlpha,
                        )
                        drawArc(
                            white.copy(alpha = 0.3f), 205f, 70f, false,
                            topLeft = Offset(w * 0.385f, bagTop - w * 0.125f), size = Size(w * 0.19f, w * 0.25f),
                            style = Stroke(width = w * 0.008f, cap = StrokeCap.Round), alpha = bagAlpha,
                        )
                        // A little mark on the bag.
                        drawCircle(white, radius = w * 0.035f, center = Offset(w * 0.49f, w * 0.765f), alpha = bagAlpha)
                        drawCircle(black, radius = w * 0.016f, center = Offset(w * 0.49f, w * 0.765f), alpha = bagAlpha)
                    }
                    // The price tag on a string from the handle, swinging.
                    val tagAlpha = (d * 2f - 0.6f).coerceIn(0f, 1f)
                    val anchor = Offset(w * 0.575f, bagTop - w * 0.02f) + Offset(tl.x * par, tl.y * par + bob + dropY)
                    val swing = (1f - f).coerceIn(-1f, 1f) * 40f + wave(t, 1, 0.1f) * 9f
                    val hole = Offset(w * 0.78f, w * 0.50f) + Offset(tl.x * par * 1.4f, tl.y * par * 1.4f + bob + dropY)
                    rotate(swing, anchor) {
                        drawLine(lerp(black, white, 0.2f), anchor, hole, strokeWidth = w * 0.008f, cap = StrokeCap.Round, alpha = tagAlpha)
                        translate(hole.x, hole.y) {
                            rotate(-12f, Offset.Zero) {
                                translate(w * 0.008f, w * 0.014f) { drawPath(tag, black.copy(alpha = 0.18f), alpha = tagAlpha) }
                                drawPath(tag, violet, alpha = tagAlpha)
                                drawPath(tag, Brush.verticalGradient(listOf(white.copy(alpha = 0.18f), white.copy(alpha = 0f)), startY = 0f, endY = w * 0.12f), alpha = tagAlpha)
                                drawCircle(white, radius = w * 0.016f, center = Offset(0f, w * 0.02f), alpha = tagAlpha)
                                drawRoundRect(white, Offset(-w * 0.045f, w * 0.08f), Size(w * 0.09f, w * 0.022f), CornerRadius(w * 0.011f), alpha = tagAlpha)
                                drawRoundRect(white.copy(alpha = 0.55f), Offset(-w * 0.045f, w * 0.125f), Size(w * 0.06f, w * 0.018f), CornerRadius(w * 0.009f), alpha = tagAlpha)
                            }
                        }
                    }
                    // Sparkles.
                    val sp = tl * (par * 1.8f)
                    sparkle(Offset(w * 0.14f, w * 0.22f) + sp, w * 0.07f * twinkle(t, 0f) * f.coerceIn(0f, 1f), black)
                    sparkle(Offset(w * 0.88f, w * 0.14f) + sp, w * 0.05f * twinkle(t, 0.35f) * f.coerceIn(0f, 1f), black)
                    sparkle(Offset(w * 0.20f, w * 0.62f) + sp, w * 0.035f * twinkle(t, 0.7f) * f.coerceIn(0f, 1f), violet)
                }
            },
    )
}

/**
 * SELL: a shopfront with depth and a violet glow, a striped awning that ripples, an "OPEN" sign on
 * the door that flips, a parcel that pops out with a bounce, and a sales sparkline that draws up.
 */
@Composable
fun SellIllustration(modifier: Modifier = Modifier, tilt: State<Offset>? = null, delayMillis: Int = 260) {
    val reduce = rememberReducedMotion()
    val clock = rememberLoopClock(6000, reduce)
    val rise = rememberEntrance(reduce, delayMillis, damping = 0.65f, stiffness = 160f)
    val pop = rememberEntrance(reduce, delayMillis + 360, damping = 0.42f, stiffness = 260f)
    val measurer = rememberTextMeasurer()
    val black = Color.yard.onAcid
    val white = Color.yard.onPhoto
    val violet = Color.yard.violetFill
    val acid = Color.yard.acid
    val wall = lerp(white, black, 0.04f)
    val wallSide = lerp(white, black, 0.28f)
    val deepViolet = lerp(violet, black, 0.35f)
    Spacer(
        modifier
            .semantics { contentDescription = "Illustration: a shopfront, a parcel and rising sales" }
            .drawWithCache {
                val w = size.width
                val open = measurer.measure(
                    "OPEN",
                    TextStyle(fontFamily = YardCondensedFamily, fontWeight = FontWeight.Black, fontSize = (w * 0.05f).toSp(), textAlign = TextAlign.Center),
                    constraints = Constraints.fixedWidth((w * 0.13f).toInt().coerceAtLeast(1)),
                )
                val bodyTop = w * 0.46f
                val bodyLeft = w * 0.14f
                val bodyW = w * 0.52f
                val bodyH = w * 0.42f
                val sideFace = Path().apply {
                    moveTo(bodyLeft + bodyW, bodyTop)
                    lineTo(bodyLeft + bodyW + w * 0.07f, bodyTop - w * 0.04f)
                    lineTo(bodyLeft + bodyW + w * 0.07f, bodyTop + bodyH - w * 0.04f)
                    lineTo(bodyLeft + bodyW, bodyTop + bodyH)
                    close()
                }
                val points = listOf(0.10f, 0.22f, 0.16f, 0.34f, 0.30f, 0.52f, 0.62f, 0.88f)
                val spark = Path()
                val sparkStart = Offset(w * 0.06f, w * 0.30f)
                val sparkW = w * 0.46f
                val sparkH = w * 0.22f
                points.forEachIndexed { i, v ->
                    val x = sparkStart.x + sparkW * i / (points.size - 1)
                    val y = sparkStart.y - sparkH * v
                    if (i == 0) spark.moveTo(x, y) else spark.lineTo(x, y)
                }
                val measure = androidx.compose.ui.graphics.PathMeasure().apply { setPath(spark, false) }
                val sparkLength = measure.length
                onDrawBehind {
                    val t = clock.value
                    val r = rise.value
                    val pp = pop.value
                    val tl = tilt?.value ?: Offset.Zero
                    val par = w * 0.025f
                    val bob = wave(t) * w * 0.008f
                    // Glow.
                    drawCircle(
                        Brush.radialGradient(listOf(violet.copy(alpha = 0.55f), violet.copy(alpha = 0f)), center = Offset(w * 0.46f, w * 0.56f), radius = w * 0.55f),
                        radius = w * 0.55f, center = Offset(w * 0.46f, w * 0.56f),
                    )
                    // Sales sparkline (draws up each loop, then holds).
                    translate(tl.x * par * 0.5f, tl.y * par * 0.5f) {
                        val phase = if (t < 0.5f) (t / 0.45f).coerceAtMost(1f) else 1f
                        val drawn = if (reduce) 1f else phase * r.coerceIn(0f, 1f)
                        val seg = Path()
                        measure.getSegment(0f, sparkLength * drawn, seg, true)
                        drawPath(seg, acid.copy(alpha = 0.22f), style = Stroke(width = w * 0.05f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                        drawPath(seg, acid, style = Stroke(width = w * 0.016f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                        val head = measure.getPosition(sparkLength * drawn)
                        if (drawn > 0.02f) {
                            drawCircle(acid.copy(alpha = 0.3f), radius = w * 0.03f, center = head)
                            drawCircle(acid, radius = w * 0.017f, center = head)
                        }
                    }
                    // Ground.
                    drawOval(white.copy(alpha = 0.07f), topLeft = Offset(w * 0.06f, w * 0.86f), size = Size(w * 0.86f, w * 0.08f))
                    val rised = (1f - r) * w * 0.3f
                    translate(tl.x * par, tl.y * par + rised + bob) {
                        val a = r.coerceIn(0f, 1f)
                        // Building.
                        drawPath(sideFace, wallSide, alpha = a)
                        drawRoundRect(wall, Offset(bodyLeft, bodyTop), Size(bodyW, bodyH), CornerRadius(w * 0.02f), alpha = a)
                        drawRect(Brush.verticalGradient(listOf(black.copy(alpha = 0.22f), black.copy(alpha = 0f)), startY = bodyTop, endY = bodyTop + w * 0.06f), Offset(bodyLeft, bodyTop), Size(bodyW, w * 0.06f), alpha = a)
                        // Window with a glow and a reflection.
                        val win = Offset(bodyLeft + bodyW * 0.48f, bodyTop + bodyH * 0.22f)
                        val winSize = Size(bodyW * 0.42f, bodyH * 0.38f)
                        drawRoundRect(acid, win, winSize, CornerRadius(w * 0.02f), alpha = a)
                        drawPath(
                            Path().apply {
                                moveTo(win.x + winSize.width * 0.2f, win.y)
                                lineTo(win.x + winSize.width * 0.45f, win.y)
                                lineTo(win.x + winSize.width * 0.2f, win.y + winSize.height)
                                lineTo(win.x, win.y + winSize.height)
                                lineTo(win.x, win.y + winSize.height * 0.6f)
                                close()
                            },
                            white.copy(alpha = 0.45f), alpha = a,
                        )
                        // Little products on the window shelf.
                        drawRoundRect(black, Offset(win.x + winSize.width * 0.55f, win.y + winSize.height * 0.52f), Size(winSize.width * 0.16f, winSize.height * 0.36f), CornerRadius(w * 0.008f), alpha = a)
                        drawRoundRect(violet, Offset(win.x + winSize.width * 0.75f, win.y + winSize.height * 0.40f), Size(winSize.width * 0.14f, winSize.height * 0.48f), CornerRadius(w * 0.008f), alpha = a)
                        // Door.
                        val door = Offset(bodyLeft + bodyW * 0.10f, bodyTop + bodyH * 0.24f)
                        val doorSize = Size(bodyW * 0.30f, bodyH * 0.76f)
                        drawRoundRect(violet, door, doorSize, CornerRadius(w * 0.02f, w * 0.02f), alpha = a)
                        drawRect(Brush.horizontalGradient(listOf(white.copy(alpha = 0.18f), white.copy(alpha = 0f)), startX = door.x, endX = door.x + doorSize.width), door, doorSize, alpha = a)
                        drawCircle(acid, radius = w * 0.012f, center = Offset(door.x + doorSize.width * 0.8f, door.y + doorSize.height * 0.55f), alpha = a)
                        // The OPEN sign flips every loop (front acid, back white).
                        val flipT = ((t * 2f) % 1f)
                        val angle = if (flipT in 0.55f..0.75f) ((flipT - 0.55f) / 0.2f) * 180f else if (flipT > 0.75f) 180f else 0f
                        val half = ((t * 2f).toInt() % 2)
                        val faceAngle = angle + half * 180f
                        val sx = cos(faceAngle * PI.toFloat() / 180f)
                        val signCenter = Offset(door.x + doorSize.width / 2f, door.y + doorSize.height * 0.28f)
                        val signSize = Size(w * 0.15f, w * 0.075f)
                        drawLine(black.copy(alpha = 0.6f), Offset(signCenter.x - signSize.width * 0.3f, door.y + w * 0.01f), Offset(signCenter.x, signCenter.y - signSize.height / 2f), strokeWidth = w * 0.005f, alpha = a)
                        drawLine(black.copy(alpha = 0.6f), Offset(signCenter.x + signSize.width * 0.3f, door.y + w * 0.01f), Offset(signCenter.x, signCenter.y - signSize.height / 2f), strokeWidth = w * 0.005f, alpha = a)
                        scale(scaleX = if (abs(sx) < 0.02f) 0.02f else abs(sx), scaleY = 1f, pivot = signCenter) {
                            val front = sx >= 0f
                            drawRoundRect(if (front) acid else white, signCenter - Offset(signSize.width / 2f, signSize.height / 2f), signSize, CornerRadius(w * 0.012f), alpha = a)
                            drawText(
                                open,
                                color = if (front) black else violet,
                                topLeft = Offset(signCenter.x - open.size.width / 2f, signCenter.y - open.size.height / 2f),
                                alpha = a,
                            )
                        }
                        // Awning: stripes that ripple, scalloped edge.
                        val awTop = bodyTop - w * 0.13f
                        val awLeft = bodyLeft - w * 0.05f
                        val awW = bodyW + w * 0.10f
                        val stripes = 6
                        val sw = awW / stripes
                        drawRect(black.copy(alpha = 0.25f), Offset(bodyLeft, bodyTop), Size(bodyW, w * 0.03f), alpha = a)
                        for (i in 0 until stripes) {
                            val ripple = wave(t, 2, i / stripes.toFloat()) * w * 0.009f
                            val c = if (i % 2 == 0) violet else white
                            val x = awLeft + i * sw
                            val stripe = Path().apply {
                                moveTo(x + sw * 0.12f, awTop)
                                lineTo(x + sw * 0.88f + w * 0.001f, awTop)
                                lineTo(x + sw, awTop + w * 0.12f + ripple)
                                lineTo(x, awTop + w * 0.12f + ripple)
                                close()
                            }
                            drawPath(stripe, c, alpha = a)
                            drawCircle(c, radius = sw / 2f, center = Offset(x + sw / 2f, awTop + w * 0.12f + ripple), alpha = a)
                            drawCircle(black.copy(alpha = 0.10f), radius = sw / 2f, center = Offset(x + sw / 2f, awTop + w * 0.125f + ripple), alpha = a)
                        }
                        drawRoundRect(deepViolet, Offset(awLeft - w * 0.01f, awTop - w * 0.03f), Size(awW + w * 0.02f, w * 0.04f), CornerRadius(w * 0.02f), alpha = a)
                    }
                    // The parcel pops out, then hops now and then.
                    val hopPhase = (t * 2f) % 1f
                    val hop = if (hopPhase < 0.18f) sin(hopPhase / 0.18f * PI.toFloat()) else 0f
                    val squash = if (hopPhase in 0.18f..0.24f) 1f - sin((hopPhase - 0.18f) / 0.06f * PI.toFloat()) * 0.08f else 1f
                    val box = Offset(w * 0.70f, w * 0.70f)
                    val boxSize = w * 0.18f
                    translate(tl.x * par * 1.5f, tl.y * par * 1.5f - hop * w * 0.06f) {
                        val s = pp.coerceAtLeast(0f)
                        scale(scaleX = s * (2f - squash), scaleY = s * squash, pivot = Offset(box.x + boxSize / 2f, box.y + boxSize)) {
                            // Shadow, top, side, front, tape.
                            drawOval(black.copy(alpha = 0.35f), Offset(box.x - w * 0.01f, box.y + boxSize - w * 0.015f + hop * w * 0.06f), Size(boxSize * 1.25f, w * 0.04f))
                            val top = Path().apply {
                                moveTo(box.x, box.y)
                                lineTo(box.x + boxSize, box.y)
                                lineTo(box.x + boxSize + w * 0.05f, box.y - w * 0.04f)
                                lineTo(box.x + w * 0.05f, box.y - w * 0.04f)
                                close()
                            }
                            val right = Path().apply {
                                moveTo(box.x + boxSize, box.y)
                                lineTo(box.x + boxSize + w * 0.05f, box.y - w * 0.04f)
                                lineTo(box.x + boxSize + w * 0.05f, box.y + boxSize - w * 0.04f)
                                lineTo(box.x + boxSize, box.y + boxSize)
                                close()
                            }
                            drawPath(top, lerp(acid, white, 0.45f))
                            drawPath(right, lerp(acid, black, 0.30f))
                            drawRect(acid, box, Size(boxSize, boxSize))
                            drawRect(black, Offset(box.x + boxSize * 0.42f, box.y), Size(boxSize * 0.16f, boxSize))
                            drawPath(
                                Path().apply {
                                    moveTo(box.x + boxSize * 0.42f, box.y)
                                    lineTo(box.x + boxSize * 0.58f, box.y)
                                    lineTo(box.x + boxSize * 0.58f + w * 0.05f, box.y - w * 0.04f)
                                    lineTo(box.x + boxSize * 0.42f + w * 0.05f, box.y - w * 0.04f)
                                    close()
                                },
                                lerp(black, white, 0.2f),
                            )
                            drawRoundRect(white, Offset(box.x + boxSize * 0.66f, box.y + boxSize * 0.62f), Size(boxSize * 0.24f, boxSize * 0.18f), CornerRadius(w * 0.006f))
                        }
                    }
                    // Sparkles.
                    val sp = tl * (par * 1.8f)
                    val shown = r.coerceIn(0f, 1f)
                    sparkle(Offset(w * 0.90f, w * 0.12f) + sp, w * 0.06f * twinkle(t, 0.1f) * shown, acid)
                    sparkle(Offset(w * 0.64f, w * 0.06f) + sp, w * 0.035f * twinkle(t, 0.5f) * shown, white)
                    sparkle(Offset(w * 0.93f, w * 0.48f) + sp, w * 0.03f * twinkle(t, 0.8f) * shown, violet)
                }
            },
    )
}

/**
 * A rubber stamp tag ("ON THE LIST", "LIVE") that slams down with a squash, a shake and a burst of
 * confetti, then sways gently. Under reduced motion: stamped, with the confetti resting around it.
 */
@Composable
fun StampCelebration(text: String, modifier: Modifier = Modifier, ink: Color = Color.yard.onAcid, paper: Color = Color.yard.acid) {
    val reduce = rememberReducedMotion()
    val stamp = rememberEntrance(reduce, 180, damping = 0.42f, stiffness = 320f)
    val burstClock = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) burstClock.snapTo(1f) else {
            delay(300)
            burstClock.animateTo(1f, tween(2600, easing = LinearEasing))
        }
    }
    val idle = rememberLoopClock(5000, reduce)
    val measurer = rememberTextMeasurer()
    val violet = Color.yard.violetFill
    val white = Color.yard.onPhoto
    val colors = listOf(violet, ink, white, violet, ink)
    val pieces = remember {
        val r = Random(11)
        List(84) {
            val angle = r.nextFloat() * TAU
            val speed = 0.35f + r.nextFloat() * 0.75f
            ConfettiBit(
                vx = cos(angle) * speed,
                vy = sin(angle) * speed - 0.55f,
                spin = (r.nextFloat() - 0.5f) * 900f,
                w = 0.012f + r.nextFloat() * 0.016f,
                h = 0.022f + r.nextFloat() * 0.02f,
                color = it % 5,
                round = it % 3 == 0,
            )
        }
    }
    Spacer(
        modifier
            .semantics { contentDescription = text }
            .drawWithCache {
                val w = size.width
                val tagW = min(w * 0.78f, size.height * 1.2f)
                val tagH = tagW * 0.42f
                val center = Offset(w / 2f, size.height * 0.5f)
                val label = measurer.measure(
                    text,
                    TextStyle(fontFamily = YardCondensedFamily, fontWeight = FontWeight.Black, fontSize = (tagH * 0.30f).toSp(), textAlign = TextAlign.Center),
                    constraints = Constraints.fixedWidth((tagW * 0.78f).toInt().coerceAtLeast(1)),
                )
                val tag = Path().apply {
                    val l = center.x - tagW / 2f
                    val tp = center.y - tagH / 2f
                    val notch = tagH * 0.32f
                    moveTo(l + notch, tp)
                    lineTo(l + tagW - tagH * 0.12f, tp)
                    quadraticTo(l + tagW, tp, l + tagW, tp + tagH * 0.12f)
                    lineTo(l + tagW, tp + tagH - tagH * 0.12f)
                    quadraticTo(l + tagW, tp + tagH, l + tagW - tagH * 0.12f, tp + tagH)
                    lineTo(l + notch, tp + tagH)
                    lineTo(l, center.y)
                    close()
                }
                val dash = PathEffect.dashPathEffect(floatArrayOf(tagH * 0.08f, tagH * 0.06f))
                onDrawBehind {
                    val s = stamp.value
                    val b = burstClock.value
                    val t = idle.value
                    // Confetti burst from behind the stamp (gravity pulls it down and out).
                    val time = b * 2.6f
                    pieces.forEach { p ->
                        val x = center.x + p.vx * w * 0.55f * time
                        val y = center.y + (p.vy * time + 0.55f * time * time) * size.height * 0.45f
                        if (y > size.height * 1.05f || b <= 0f) return@forEach
                        val alpha = if (reduce) 0.85f else (1f - max(0f, time - 1.9f) / 0.7f).coerceIn(0f, 1f)
                        rotate(p.spin * time, Offset(x, y)) {
                            if (p.round) {
                                drawCircle(colors[p.color], radius = w * p.w * 0.6f, center = Offset(x, y), alpha = alpha)
                            } else {
                                drawRect(colors[p.color], Offset(x - w * p.w / 2f, y - w * p.h / 2f), Size(w * p.w, w * p.h), alpha = alpha)
                            }
                        }
                    }
                    // The stamp: falls from big to its size, squashes, sways.
                    val scaleIn = 1f + (1f - s) * 1.4f
                    val sway = -8f + wave(t) * 1.6f
                    val shake = if (s in 0.85f..1.08f) (1.08f - s) * 6f * wave(s * 6f) else 0f
                    rotate(sway + shake, center) {
                        scale(scaleIn, scaleIn, center) {
                            val a = s.coerceIn(0f, 1f)
                            translate(w * 0.012f, w * 0.02f) { drawPath(tag, ink.copy(alpha = 0.25f * a)) }
                            drawPath(tag, ink, alpha = a)
                            drawPath(tag, Brush.linearGradient(listOf(white.copy(alpha = 0.14f), white.copy(alpha = 0f)), start = center - Offset(tagW / 2f, tagH / 2f), end = center), alpha = a)
                            // Inner dashed border, hole, text.
                            val inset = tagH * 0.1f
                            scale(1f - inset * 2f / tagW, 1f - inset * 2f / tagH, center) {
                                drawPath(tag, paper.copy(alpha = 0.7f * a), style = Stroke(width = tagH * 0.025f, pathEffect = dash))
                            }
                            val holeAt = Offset(center.x - tagW / 2f + tagH * 0.36f, center.y)
                            drawCircle(paper, radius = tagH * 0.07f, center = holeAt, alpha = a)
                            drawText(
                                label,
                                color = paper,
                                topLeft = Offset(center.x - label.size.width / 2f + tagH * 0.12f, center.y - label.size.height / 2f),
                                alpha = a,
                            )
                        }
                    }
                }
            },
    )
}

private class ConfettiBit(val vx: Float, val vy: Float, val spin: Float, val w: Float, val h: Float, val color: Int, val round: Boolean)
