package space.yardstore.app.designsystem.components

import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/** iOS `Skeleton.ShapeKind`. */
enum class SkeletonShape { Rounded, Circle, Capsule }

/**
 * A shimmering placeholder block for loading states. Mirrors `Skeleton.swift`. It fills the size
 * you give it.
 *
 *   Skeleton(Modifier.fillMaxWidth().height(220.dp))                          // image-radius block
 *   Skeleton(Modifier.width(120.dp).height(14.dp), cornerRadius = 6.dp)       // a text line
 *   Skeleton(Modifier.size(40.dp), shape = SkeletonShape.Circle)
 *   anyModifier.shimmering()                                                   // shimmer anything
 */
@Composable
fun Skeleton(modifier: Modifier = Modifier, cornerRadius: Dp = Radius.image, shape: SkeletonShape = SkeletonShape.Rounded) {
    val s: Shape = when (shape) {
        SkeletonShape.Rounded -> RoundedCornerShape(cornerRadius)
        SkeletonShape.Circle -> CircleShape
        SkeletonShape.Capsule -> YardShapes.pill
    }
    Box(
        modifier
            .clearAndSetSemantics { }
            .background(Color.yard.surface2, s)
            .shimmering(),
    )
}

/** Sweeps a soft highlight across the content, clipped to what it draws (off when animations are disabled). */
fun Modifier.shimmering(active: Boolean = true): Modifier = composed {
    if (!active) return@composed this
    val context = LocalContext.current
    val reduceMotion = remember {
        runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
    if (reduceMotion) return@composed this
    val highlight = Color.yard.ink
    val transition = rememberInfiniteTransition(label = "shimmer")
    val phase by transition.animateFloat(
        initialValue = -1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmer-phase",
    )
    this
        .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val w = size.width
            val bandWidth = w * 0.6f
            val startX = phase * w * 1.6f
            drawRect(
                brush = Brush.horizontalGradient(
                    colors = listOf(highlight.copy(alpha = 0f), highlight.copy(alpha = 0.07f), highlight.copy(alpha = 0f)),
                    startX = startX,
                    endX = startX + bandWidth,
                ),
                topLeft = Offset.Zero,
                size = size,
                blendMode = BlendMode.SrcAtop,
            )
        }
}

/**
 * A loading placeholder shaped like a `MasonryGrid` of product tiles (non-lazy; put it where the grid goes).
 * [columns] defaults to `LocalYardWindow.current.gridColumns` (2 / 3 / 4); [count] defaults to
 * four rows' worth (8 on phones).
 *
 *   if (isLoading) MasonrySkeleton()
 */
@Composable
fun MasonrySkeleton(
    modifier: Modifier = Modifier,
    count: Int = LocalYardWindow.current.gridColumns * 4,
    spacing: Dp = Spacing.gridGap,
    showsCaption: Boolean = true,
    columns: Int = LocalYardWindow.current.gridColumns,
) {
    val aspects = floatArrayOf(0.75f, 0.62f, 0.8f, 0.7f, 0.66f, 0.85f, 0.72f, 0.6f)
    val n = columns.coerceAtLeast(1)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = Alignment.Top) {
        for (offset in 0 until n) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing + if (showsCaption) 4.dp else 0.dp)) {
                for (i in offset until count step n) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Skeleton(Modifier.fillMaxWidth().aspectRatio(aspects[i % aspects.size]))
                        if (showsCaption) {
                            Skeleton(Modifier.fillMaxWidth().padding(end = 40.dp).height(10.dp), cornerRadius = 4.dp)
                            Skeleton(Modifier.width(50.dp).height(10.dp), cornerRadius = 4.dp)
                        }
                    }
                }
            }
        }
    }
}

@Preview(name = "Skeleton — dark")
@Composable
private fun SkeletonDarkPreview() = YardPreview(darkTheme = true) { MasonrySkeleton() }

@Preview(name = "Skeleton — light")
@Composable
private fun SkeletonLightPreview() = YardPreview(darkTheme = false) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Skeleton(Modifier.size(44.dp), shape = SkeletonShape.Circle)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Skeleton(Modifier.width(140.dp).height(12.dp), cornerRadius = 4.dp)
                Skeleton(Modifier.width(90.dp).height(10.dp), cornerRadius = 4.dp)
            }
        }
        Skeleton(Modifier.fillMaxWidth().height(200.dp))
    }
}
