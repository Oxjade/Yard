package space.yardstore.app.designsystem.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.yard

/**
 * The violet unread dot of a list row (notifications, inbox). It keeps its space either way, so the
 * row never reflows; marking read shrinks and fades it out, a new unread pops it in. Instant under
 * reduced motion. Say "Unread" in the row's semantics; the dot itself is hidden from TalkBack.
 */
@Composable
fun UnreadDot(unread: Boolean, modifier: Modifier = Modifier, size: Dp = 8.dp, color: Color = Color.yard.violet) {
    val reduce = rememberReducedMotion()
    val k by animateFloatAsState(if (unread) 1f else 0f, Motion.or(reduce) { Motion.snappy() }, label = "unread-dot")
    Box(
        modifier
            .size(size)
            .graphicsLayer {
                scaleX = 0.4f + 0.6f * k
                scaleY = 0.4f + 0.6f * k
                alpha = k
            }
            .background(color, CircleShape)
            .clearAndSetSemantics { },
    )
}
