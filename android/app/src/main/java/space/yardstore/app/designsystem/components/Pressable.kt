package space.yardstore.app.designsystem.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import space.yardstore.app.designsystem.Motion

/**
 * A subtle press-scale click for tappable cards and tiles (no ripple, no colour change).
 * iOS `PressableButtonStyle()`.
 *
 *   ProductTile(p, Modifier.pressableClick { router.push(Route.Product(p.slug)) })
 */
fun Modifier.pressableClick(
    enabled: Boolean = true,
    pressedScale: Float = 0.98f,
    pressedAlpha: Float = 0.92f,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    onClick: () -> Unit,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) pressedScale else 1f, Motion.snappy(), label = "press-scale")
    val alpha by animateFloatAsState(if (pressed) pressedAlpha else 1f, Motion.snappy(), label = "press-alpha")
    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
            this.alpha = alpha
        }
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onClickLabel = onClickLabel,
            onClick = onClick,
        )
}
