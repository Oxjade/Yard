package space.yardstore.app.designsystem

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext

/**
 * Reduced motion (iOS `accessibilityReduceMotion`). Android has no single switch: "Remove
 * animations" sets the animator duration scale to 0, which is what we read. Provide it once at the
 * root (tests and previews) or read [rememberReducedMotion] directly.
 *
 *   val reduce = LocalReducedMotion.current
 *   val scale by animateFloatAsState(target, Motion.or(reduce) { Motion.press() })
 */
val LocalReducedMotion = staticCompositionLocalOf<Boolean?> { null }

/** True when the system asks for no animations. */
fun Context.prefersReducedMotion(): Boolean = runCatching {
    Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

/** The reduced-motion preference: [LocalReducedMotion] when provided, else the system setting. */
@Composable
fun rememberReducedMotion(): Boolean {
    val provided = LocalReducedMotion.current
    val context = LocalContext.current
    val system = remember(context) { context.prefersReducedMotion() }
    return provided ?: system
}

/** [spec] normally, an instant change under reduced motion. */
fun <T> Motion.or(reduce: Boolean, spec: () -> FiniteAnimationSpec<T>): FiniteAnimationSpec<T> =
    if (reduce) instant() else spec()
