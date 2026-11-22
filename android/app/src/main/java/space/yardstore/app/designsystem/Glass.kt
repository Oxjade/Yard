package space.yardstore.app.designsystem

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import space.yardstore.app.designsystem.components.YardTabBarDefaults
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

// Liquid glass for FLOATING layers only: the tab pill / rail, buttons floating over photos and
// headers, toasts, sheets. Never on cards, rows or page content. Mirrors `Glass.swift` (which uses
// system materials, and `glassEffect` on iOS 26+).
//
// A glass surface is: what is behind it, blurred (API 31+, when a [GlassBackdrop] is given) or a
// denser translucent fill (older Android, or no backdrop), a tint, a top-lit sheen, a hairline
// rim that is brighter along the top edge, and a soft shadow so it floats.
//
//   val backdrop = rememberGlassBackdrop()
//   Box(Modifier.glassBackdropSource(backdrop)) { content() }          // what floats over
//   TabPill(Modifier.yardGlass(YardShapes.pill, backdrop = backdrop))   // a SIBLING of the source
//
// A glass element must never sit INSIDE its own backdrop source (it would draw itself).

/** The content glass floats over, recorded once per frame so glass layers can blur it. */
@Stable
class GlassBackdrop internal constructor(internal val layer: GraphicsLayer?) {
    internal var sourceCoordinates: LayoutCoordinates? by mutableStateOf(null)
}

/** True where real backdrop blur is available (RenderEffect, API 31+). */
val glassBlurSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/** A backdrop to record content into. On API < 31 (no blur) it records nothing. */
@Composable
fun rememberGlassBackdrop(): GlassBackdrop {
    val enabled = glassBlurSupported && !LocalInspectionMode.current
    val layer = if (enabled) rememberGraphicsLayer() else null
    return remember(layer) { GlassBackdrop(layer) }
}

/** Records this node's drawing into [backdrop] (and draws it as usual). */
fun Modifier.glassBackdropSource(backdrop: GlassBackdrop): Modifier {
    val layer = backdrop.layer ?: return this
    return this
        .onGloballyPositioned { backdrop.sourceCoordinates = it }
        .drawWithContent {
            layer.record { this@drawWithContent.drawContent() }
            drawLayer(layer)
        }
}

/** Glass looks: how much tint over the blurred backdrop. */
enum class GlassStyle {
    /** Bars and the tab pill: enough tint that labels read over any photo. */
    Regular,
    /** Small round buttons floating over photos: lighter, the photo shows through. */
    Clear,
    /** Toasts and notices: the densest, text-heavy. */
    Thick,
    /**
     * The bottom tab bars (shopper and Studio): smoked black glass in BOTH appearances, like the
     * website's `glass-bar` (rgba(8,8,8,0.74)): the page shows through blurred, never bright.
     */
    Bar,
}

/** The fill colour of a glass surface (also the whole look when there is no blur). */
@Composable
fun glassTint(style: GlassStyle = GlassStyle.Regular, blurred: Boolean): Color {
    val c = Color.yard
    if (style == GlassStyle.Bar) return YardTabBarDefaults.glass.copy(alpha = if (blurred) 0.74f else 0.92f)
    val base = c.surface
    // Light glass needs more white than dark glass needs black to stay clean over dark photos.
    val lift = if (c.isDark) 0f else 0.12f
    val alpha = when (style) {
        GlassStyle.Regular -> if (blurred) 0.6f + lift else 0.88f
        GlassStyle.Clear -> if (blurred) 0.42f + lift else 0.72f
        GlassStyle.Thick -> if (blurred) 0.78f + lift else 0.95f
        GlassStyle.Bar -> 1f
    }
    return base.copy(alpha = alpha)
}

/**
 * The glass surface: shadow, blurred backdrop (when [backdrop] is given and supported), tint,
 * sheen and rim, all clipped to [shape]. Put it BEFORE padding; content draws on top.
 */
fun Modifier.yardGlass(
    shape: Shape,
    style: GlassStyle = GlassStyle.Regular,
    backdrop: GlassBackdrop? = null,
    elevation: Dp = 18.dp,
    blurRadius: Dp = 24.dp,
): Modifier = composed {
    val c = Color.yard
    val blurLayer = if (backdrop?.layer != null) rememberGraphicsLayer() else null
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val blurred = blurLayer != null
    val tint = glassTint(style, blurred)
    val dark = c.isDark || style == GlassStyle.Bar
    // Top-lit sheen and a rim that catches the light along the top edge.
    val sheenTop = if (dark) Color.White.copy(alpha = 0.07f) else Color.White.copy(alpha = 0.55f)
    val rimTop = if (dark) Color.White.copy(alpha = 0.18f) else Color.White.copy(alpha = 0.9f)
    val rimBottom = if (dark) Color.White.copy(alpha = 0.05f) else Color.Black.copy(alpha = 0.08f)
    val shadowColor = c.scrim.copy(alpha = if (dark) 0.45f else 0.16f)

    this
        .then(if (elevation > 0.dp) Modifier.shadow(elevation, shape, clip = false, ambientColor = shadowColor, spotColor = shadowColor) else Modifier)
        .then(if (blurLayer != null) Modifier.onGloballyPositioned { coords = it } else Modifier)
        .drawBehind {
            val outline: Outline = shape.createOutline(size, layoutDirection, this)
            val path = Path().apply { addOutline(outline) }
            val source = backdrop?.sourceCoordinates
            val here = coords
            val content = backdrop?.layer
            if (blurLayer != null && content != null && source != null && here != null && source.isAttached && here.isAttached) {
                // Draw the backdrop at quarter resolution, blurred, then scale it back up: the
                // blur stays cheap at any screen size.
                val factor = 0.25f
                val full = content.size
                if (full.width > 0 && full.height > 0) {
                    val small = IntSize((full.width * factor).toInt().coerceAtLeast(1), (full.height * factor).toInt().coerceAtLeast(1))
                    val r = blurRadius.toPx() * factor
                    blurLayer.renderEffect = BlurEffect(r, r, TileMode.Clamp)
                    blurLayer.record(size = small) {
                        scale(factor, factor, pivot = Offset.Zero) { drawLayer(content) }
                    }
                    // Map through the glass's own layer transform (e.g. the collapsed tab pill's
                    // 0.86 scale): this draw happens in UNSCALED local space and the layer scales
                    // it afterwards, so place the backdrop by where our origin really lands in the
                    // source and undo the on-screen scale. Otherwise the blur shrinks and drifts
                    // against the real content (up to ~18dp at the collapsed pill's ends).
                    val origin = source.localPositionOf(here, Offset.Zero)
                    val edge = source.localPositionOf(here, Offset(size.width, 0f))
                    val onScreen = if (size.width > 0f) ((edge.x - origin.x) / size.width).takeIf { it > 0f } ?: 1f else 1f
                    clipPath(path) {
                        scale(1f / onScreen, 1f / onScreen, pivot = Offset.Zero) {
                            translate(-origin.x, -origin.y) {
                                scale(1f / factor, 1f / factor, pivot = Offset.Zero) { drawLayer(blurLayer) }
                            }
                        }
                    }
                }
            }
            drawOutline(outline, tint)
            drawOutline(outline, Brush.verticalGradient(0f to sheenTop, 0.55f to sheenTop.copy(alpha = 0f)))
            drawOutline(
                outline,
                Brush.verticalGradient(listOf(rimTop, rimBottom)),
                style = Stroke(width = 1.dp.toPx()),
            )
        }
}

/**
 * How dense the smoked-glass fill under labels on photos is. These capsules get no backdrop blur,
 * so the fill alone must carry 11sp white text: at 0.6 black over a pure white photo the capsule
 * is about #666 and white reads at ~5.7:1 (0.38 gave ~2.7:1).
 */
const val OnPhotoGlassAlpha = 0.6f

/** A photo-friendly glass capsule fill for labels ON photos (status pills): dark smoked glass. */
@Composable
fun onPhotoGlassTint(): Color = Color.yard.scrim.copy(alpha = OnPhotoGlassAlpha)
