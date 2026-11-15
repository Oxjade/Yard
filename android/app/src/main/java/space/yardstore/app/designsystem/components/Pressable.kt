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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion

/**
 * A subtle press-scale click for tappable cards and tiles (no ripple, no colour change).
 * iOS `PressableButtonStyle()`. GPU-only: scale and alpha on a graphics layer, never a relayout.
 * Under reduced motion the press still dims, but snaps instead of animating.
 *
 *   ProductTile(p, Modifier.pressableClick { router.push(Route.Product(p.slug)) })
 *   Modifier.pressableClick(pressedScale = Motion.PRESSED_SCALE, haptic = true) { … }   // quick links
 *
 * [interactionSource]: pass one to drive extra pressed visuals (a highlight) from the same press.
 */
fun Modifier.pressableClick(
    enabled: Boolean = true,
    pressedScale: Float = 0.98f,
    pressedAlpha: Float = 0.92f,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    haptic: Boolean = false,
    interactionSource: MutableInteractionSource? = null,
    onClick: () -> Unit,
): Modifier = composed {
    val interaction = interactionSource ?: remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduce = rememberReducedMotion()
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(if (pressed) pressedScale else 1f, Motion.or(reduce) { Motion.press() }, label = "press-scale")
    val alpha by animateFloatAsState(if (pressed) pressedAlpha else 1f, Motion.or(reduce) { Motion.press() }, label = "press-alpha")
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
        ) {
            if (haptic) haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
            onClick()
        }
}
