package space.yardstore.app.designsystem.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.rememberReducedMotion

/**
 * A number that rolls when it changes: the new value slides in from below when it grows (from
 * above when it shrinks) while the old one leaves the other way, with a short crossfade. Instant
 * under reduced motion. The bag badge, chart ranks and stat figures use it; use tabular digits
 * (`style.monospacedDigits()`) so the width doesn't jump.
 *
 *   RollingNumber(cart.count, style = YardFonts.micro.monospacedDigits(), color = Color.yard.bg) { if (it > 99) "99+" else "$it" }
 */
@Composable
fun RollingNumber(
    value: Int,
    modifier: Modifier = Modifier,
    style: TextStyle,
    color: Color,
    label: String = "rolling-number",
    format: (Int) -> String = { it.toString() },
) {
    RollingValue(value, modifier, rising = { from, to -> to > from }, label = label) { n ->
        Text(format(n), style = style, color = color, maxLines = 1)
    }
}

/**
 * The same roll for any value (a figure like "+1.2K"); [rising] decides the direction.
 * Key it on data, not on every recomposition.
 */
@Composable
fun <T> RollingValue(
    value: T,
    modifier: Modifier = Modifier,
    rising: (from: T, to: T) -> Boolean = { _, _ -> true },
    label: String = "rolling-value",
    content: @Composable (T) -> Unit,
) {
    val reduce = rememberReducedMotion()
    AnimatedContent(
        targetState = value,
        modifier = modifier,
        contentAlignment = Alignment.Center,
        transitionSpec = {
            if (reduce) {
                fadeIn(snap()) togetherWith fadeOut(snap())
            } else {
                val up = rising(initialState, targetState)
                (slideInVertically(Motion.snappy()) { if (up) it else -it } + fadeIn(Motion.crossfade())) togetherWith
                    (slideOutVertically(Motion.snappy()) { if (up) -it else it } + fadeOut(Motion.crossfade()))
            }
        },
        label = label,
    ) { content(it) }
}
