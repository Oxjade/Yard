package space.yardstore.app.designsystem.components

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.snap
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.rememberReducedMotion

/**
 * Skeleton → content (or → error/empty) as a short crossfade instead of a hard cut; instant under
 * reduced motion. Key it on the screen's load state, not on data that changes while loaded.
 *
 *   YardCrossfade(model.state) { state -> when (state) { Loading -> Skeleton(); Loaded -> Content() } }
 */
@Composable
fun <T> YardCrossfade(targetState: T, modifier: Modifier = Modifier, label: String = "crossfade", content: @Composable (T) -> Unit) {
    val reduce = rememberReducedMotion()
    Crossfade(targetState, modifier, animationSpec = if (reduce) snap() else Motion.crossfade(), label = label, content = content)
}
