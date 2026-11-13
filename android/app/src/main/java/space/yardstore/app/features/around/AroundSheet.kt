package space.yardstore.app.features.around

import androidx.compose.animation.core.animate
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.YardSheetGrabber
import space.yardstore.app.designsystem.yard
import kotlin.math.abs
import kotlin.math.roundToInt

// ANDROID-ONLY: iOS shows the list in a non-dismissable `.sheet` with detents 150pt / medium /
// large and `.presentationBackgroundInteraction(.enabled(upThrough: .medium))`. Material 3's
// sheets have two states, so this is a small non-modal sheet with the same three detents that
// lives inside the screen (the map stays interactive around it) and hands scrolling over to its
// list the way a bottom sheet should.

enum class AroundDetent { Peek, Medium, Large }

@Stable
class AroundSheetState internal constructor(initial: AroundDetent, private val scope: CoroutineScope) {
    /** The detent the sheet is at or moving to. */
    var detent by mutableStateOf(initial)
        private set

    /** Distance of the sheet's top from the container's top, in px. */
    var offset by mutableFloatStateOf(Float.NaN)
        private set

    private var anchors: Map<AroundDetent, Float> = emptyMap()
    private var animation: Job? = null
    internal var velocityThreshold = 400f

    private val top: Float get() = anchors.values.minOrNull() ?: 0f
    private val bottom: Float get() = anchors.values.maxOrNull() ?: 0f

    internal fun updateAnchors(new: Map<AroundDetent, Float>) {
        if (new == anchors) return
        anchors = new
        val target = new[detent] ?: return
        animation?.cancel()
        offset = target
    }

    /** Moves the sheet by [delta] px (positive = down); returns what it actually moved. */
    internal fun dragBy(delta: Float): Float {
        if (anchors.isEmpty() || offset.isNaN()) return 0f
        animation?.cancel()
        val old = offset
        offset = (offset + delta).coerceIn(top, bottom)
        return offset - old
    }

    /** Snaps to a detent after a drag: the next one in the fling's direction, else the nearest. */
    internal fun settle(velocity: Float) {
        if (anchors.isEmpty() || offset.isNaN()) return
        val sorted = anchors.entries.sortedBy { it.value }
        val target = when {
            velocity < -velocityThreshold -> sorted.lastOrNull { it.value < offset - 1f }?.key ?: sorted.first().key
            velocity > velocityThreshold -> sorted.firstOrNull { it.value > offset + 1f }?.key ?: sorted.last().key
            else -> sorted.minBy { abs(it.value - offset) }.key
        }
        animateTo(target, velocity)
    }

    internal val isAtTop: Boolean get() = !offset.isNaN() && offset <= top + 0.5f

    /** Animates to [target] (iOS `detent = .medium`). */
    fun animateTo(target: AroundDetent, velocity: Float = 0f) {
        detent = target
        val to = anchors[target] ?: return
        val from = offset.takeUnless { it.isNaN() } ?: to
        animation?.cancel()
        animation = scope.launch {
            animate(from, to, velocity, Motion.spring()) { value, _ -> offset = value }
        }
    }

    internal val nestedScroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            // Finger moving up: grow the sheet before the list scrolls.
            return if (available.y < 0 && source == NestedScrollSource.UserInput) Offset(0f, dragBy(available.y)) else Offset.Zero
        }

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            // List is at its top and the finger keeps pulling down: shrink the sheet.
            return if (available.y > 0 && source == NestedScrollSource.UserInput) Offset(0f, dragBy(available.y)) else Offset.Zero
        }

        override suspend fun onPreFling(available: Velocity): Velocity {
            if (available.y < 0 && !isAtTop) {
                settle(available.y)
                return available
            }
            return Velocity.Zero
        }

        override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
            settle(available.y)
            return available
        }
    }
}

@Composable
fun rememberAroundSheetState(initial: AroundDetent = AroundDetent.Peek): AroundSheetState {
    val scope = rememberCoroutineScope()
    return remember { AroundSheetState(initial, scope) }
}

/**
 * The sheet itself: fills the parent's height, slides between the three detents. Put it last in a
 * Box above the map.
 */
@Composable
fun AroundSheet(
    state: AroundSheetState,
    modifier: Modifier = Modifier,
    peekHeight: androidx.compose.ui.unit.Dp = 150.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val density = LocalDensity.current
    val navBar = WindowInsets.navigationBars.getBottom(density)
    BoxWithConstraints(modifier) {
        val height = constraints.maxHeight.toFloat()
        val peek = with(density) { peekHeight.toPx() } + navBar
        val anchors = mapOf(
            AroundDetent.Large to with(density) { 8.dp.toPx() },
            AroundDetent.Medium to height * 0.5f,
            AroundDetent.Peek to (height - peek).coerceAtLeast(height * 0.5f),
        )
        LaunchedEffect(anchors) { state.updateAnchors(anchors) }
        state.velocityThreshold = with(density) { 125.dp.toPx() }
        val drag = rememberDraggableState { delta -> state.dragBy(delta) }
        Column(
            Modifier
                .offset { IntOffset(0, (state.offset.takeUnless { it.isNaN() } ?: anchors.getValue(state.detent)).roundToInt()) }
                .fillMaxWidth()
                .height(with(density) { height.toDp() })
                .shadow(12.dp, YardShapes.sheet, ambientColor = Color.yard.scrim, spotColor = Color.yard.scrim)
                .clip(YardShapes.sheet)
                .background(Color.yard.bg)
                .nestedScroll(state.nestedScroll)
                .draggable(drag, Orientation.Vertical, onDragStopped = { v -> state.settle(v) }),
        ) {
            YardSheetGrabber()
            content()
        }
    }
}
