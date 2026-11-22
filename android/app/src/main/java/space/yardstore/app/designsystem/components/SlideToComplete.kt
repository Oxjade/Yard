package space.yardstore.app.designsystem.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.yard
import kotlin.math.roundToInt

/**
 * The pure rules behind [SlideToComplete] (unit-tested): how far the thumb is, which haptic
 * ticks a move crosses, and whether a release completes the action.
 */
object SlideToCompleteMath {
    /** A release at or past this share of the track completes the action. */
    const val COMPLETE_AT = 0.9f
    /** Rising ticks while sliding: one per step (8 steps → a tick every 12.5%). */
    const val TICK_STEPS = 8

    /** Thumb offset (px) → progress 0…1 on a track whose travel is [travel] px. */
    fun progress(offset: Float, travel: Float): Float =
        if (travel <= 0f) 0f else (offset / travel).coerceIn(0f, 1f)

    /** The tick step a progress falls in (0…[TICK_STEPS]). */
    fun step(progress: Float, steps: Int = TICK_STEPS): Int = (progress.coerceIn(0f, 1f) * steps).toInt().coerceIn(0, steps)

    /** Ticks to play moving from [from] to [to]: only forward steps tick (sliding back is silent). */
    fun ticksCrossed(from: Float, to: Float, steps: Int = TICK_STEPS): Int =
        (step(to, steps) - step(from, steps)).coerceAtLeast(0)

    /** True when releasing at [progress] completes the action. */
    fun completes(progress: Float): Boolean = progress >= COMPLETE_AT
}

/**
 * "Slide to …" for key actions (submit an application, mark an order shipped, publish): the thumb
 * must travel ~90% of the pill, so it never fires by accident. Rising ticks while sliding, a
 * threshold bump when it would complete, a confirm on release. While [isLoading] the thumb waits
 * at the end with a spinner; when loading ends without the screen moving on, it springs back.
 *
 * Accessible alternatives: TalkBack's double-tap (the semantic click) and the "[label]" custom
 * action run [onComplete]; a long-press anywhere on the pill does too (a deliberate gesture).
 *
 *   SlideToComplete("Slide to publish", isLoading = publishing) { publish() }
 */
@Composable
fun SlideToComplete(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isLoading: Boolean = false,
    /** Track colours: ink-on-acid by default (the screen's one main action). */
    trackColor: Color = Color.yard.acid,
    contentColor: Color = Color.yard.onAcid,
    thumbColor: Color = Color.yard.onAcid,
    thumbIconColor: Color = Color.yard.acid,
    onComplete: () -> Unit,
) {
    val haptics = rememberYardHaptics()
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val complete by rememberUpdatedState(onComplete)
    val thumbSize = 56.dp
    val inset = 4.dp
    var travel by remember { mutableFloatStateOf(0f) }
    val offset = remember { Animatable(0f) }
    var done by remember { mutableStateOf(false) }
    var armed by remember { mutableStateOf(false) }

    fun finish() {
        if (done || !enabled) return
        done = true
        haptics.confirm()
        scope.launch {
            if (travel > 0f) offset.animateTo(travel, Motion.or(reduce) { Motion.snappy() })
        }
        complete()
    }

    // Loading finished and we're still here (an error, a retry): spring back to the start.
    LaunchedEffect(isLoading) {
        if (!isLoading && done) {
            done = false
            armed = false
            offset.animateTo(0f, Motion.or(reduce) { spring(dampingRatio = 0.6f, stiffness = 380f) })
        }
    }

    val progress = SlideToCompleteMath.progress(offset.value, travel)
    val dragState = rememberDraggableState { delta ->
        if (done || !enabled) return@rememberDraggableState
        val before = SlideToCompleteMath.progress(offset.value, travel)
        val next = (offset.value + delta).coerceIn(0f, travel)
        scope.launch { offset.snapTo(next) }
        val after = SlideToCompleteMath.progress(next, travel)
        repeat(SlideToCompleteMath.ticksCrossed(before, after)) { haptics.slideTick() }
        val nowArmed = SlideToCompleteMath.completes(after)
        if (nowArmed && !armed) haptics.threshold()
        armed = nowArmed
    }

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(thumbSize + inset * 2)
            .clip(YardShapes.pill)
            .background(if (enabled) trackColor else Color.yard.surface2, YardShapes.pill)
            .border(1.dp, Color.yard.line, YardShapes.pill)
            .clearAndSetSemantics {
                role = Role.Button
                contentDescription = label
                if (isLoading) stateDescription = "Working"
                if (!enabled) disabled()
                onClick(label) { finish(); true }
                customActions = listOf(CustomAccessibilityAction(label) { finish(); true })
            }
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled && !done,
                onClick = { haptics.tick() },
                onLongClick = { finish() },
            ),
    ) {
        val full = with(density) { maxWidth.toPx() }
        val thumbPx = with(density) { (thumbSize + inset * 2).toPx() }
        travel = (full - thumbPx).coerceAtLeast(0f)
        val fg = if (enabled) contentColor else Color.yard.ink3

        // The trail behind the thumb fills in as it moves.
        Box(
            Modifier
                .fillMaxHeight()
                .width(with(density) { (offset.value + thumbPx).toDp() })
                .padding(inset)
                .clip(YardShapes.pill)
                .background(
                    Brush.horizontalGradient(listOf(thumbColor.copy(alpha = 0.0f), thumbColor.copy(alpha = 0.16f))),
                    YardShapes.pill,
                ),
        )
        Row(
            Modifier.fillMaxWidth().fillMaxHeight().padding(start = thumbSize + inset * 2, end = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (isLoading) "Working…" else label,
                style = YardFonts.bodyEmphasis,
                color = fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .graphicsLayer { alpha = if (isLoading) 1f else (1f - progress * 1.4f).coerceIn(0f, 1f) },
            )
            Text("»", style = YardFonts.title, color = fg.copy(alpha = (0.55f - progress).coerceIn(0f, 0.55f)))
        }
        Box(
            Modifier
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .padding(inset)
                .size(thumbSize)
                .graphicsLayer {
                    val s = if (armed && !done) 1.06f else 1f
                    scaleX = s
                    scaleY = s
                }
                .background(if (enabled) thumbColor else Color.yard.ink3, CircleShape)
                .draggable(
                    state = dragState,
                    orientation = Orientation.Horizontal,
                    enabled = enabled && !done,
                    onDragStopped = {
                        if (done) return@draggable
                        val p = SlideToCompleteMath.progress(offset.value, travel)
                        if (SlideToCompleteMath.completes(p)) {
                            finish()
                        } else {
                            armed = false
                            offset.animateTo(0f, Motion.or(reduce) { spring(dampingRatio = 0.55f, stiffness = 420f) })
                        }
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            when {
                isLoading -> CircularProgressIndicator(color = thumbIconColor, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                done -> Icon(Icons.Filled.Check, contentDescription = null, tint = thumbIconColor, modifier = Modifier.size(24.dp))
                else -> Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = if (enabled) thumbIconColor else Color.yard.surface2, modifier = Modifier.size(24.dp))
            }
        }
    }
}
