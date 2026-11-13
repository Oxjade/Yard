package space.yardstore.app.designsystem.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

/** A short message at the top of the screen. Mirrors `Toast` in `Toast.swift`. */
data class Toast(
    val message: String,
    val style: Style = Style.Info,
    /** Icon; defaults per style when null. */
    val icon: ImageVector? = null,
    val id: String = UUID.randomUUID().toString(),
) {
    enum class Style { Info, Success, Error }

    val resolvedIcon: ImageVector
        get() = icon ?: when (style) {
            Style.Info -> Icons.Filled.Info
            Style.Success -> Icons.Filled.CheckCircle
            Style.Error -> Icons.Filled.Warning
        }
}

/**
 * App-scoped toasts. Provided at the root via [LocalToastCenter]; the root hosts them ([YardToastHost]).
 *
 *   val toast = LocalToastCenter.current
 *   toast.show("Added to your bag", Toast.Style.Success)
 *   toast.show(error)                        // any Throwable → its user-facing message
 */
class ToastCenter {
    var current: Toast? by mutableStateOf(null)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var dismissJob: Job? = null

    fun show(message: String, style: Toast.Style = Toast.Style.Info, icon: ImageVector? = null, durationMillis: Long = 2600) {
        show(Toast(message, style, icon), durationMillis)
    }

    fun show(toast: Toast, durationMillis: Long = 2600) {
        dismissJob?.cancel()
        current = toast
        val id = toast.id
        dismissJob = scope.launch {
            delay(durationMillis)
            if (current?.id == id) current = null
        }
    }

    /** Shows an error's user-facing message (cancellations are ignored). */
    fun show(error: Throwable) {
        if (error is CancellationException) return
        if (error is APIError && error.isCancelled) return
        show(APIError.messageFor(error), Toast.Style.Error)
    }

    fun dismiss() {
        dismissJob?.cancel()
        current = null
    }
}

/** The app's [ToastCenter]. */
val LocalToastCenter = staticCompositionLocalOf<ToastCenter> { error("ToastCenter not provided (wrap in RootView or YardPreview)") }

/** The toast capsule. */
@Composable
fun ToastView(toast: Toast, modifier: Modifier = Modifier) {
    val iconColor = when (toast.style) {
        Toast.Style.Info -> Color.yard.ink
        Toast.Style.Success -> Color.yard.success
        Toast.Style.Error -> Color.yard.danger
    }
    Row(
        modifier
            .shadow(16.dp, YardShapes.pill, ambientColor = Color.yard.scrim.copy(alpha = 0.18f), spotColor = Color.yard.scrim.copy(alpha = 0.18f))
            .background(Color.yard.surface.copy(alpha = 0.96f), YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .padding(horizontal = Spacing.l, vertical = Spacing.m)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(toast.resolvedIcon, contentDescription = null, tint = iconColor, modifier = Modifier.size(18.dp))
        Text(toast.message, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = Color.yard.ink, maxLines = 3)
    }
}

/**
 * Shows [center]'s toasts over [content] (iOS `.yardToastHost(center)`). The root applies it once;
 * the route sheet applies it too. For your own full-screen dialogs, wrap their content in it.
 */
@Composable
fun YardToastHost(center: ToastCenter, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier) {
        content()
        val toast = center.current
        var last by remember { mutableStateOf<Toast?>(null) }
        if (toast != null) last = toast
        AnimatedVisibility(
            visible = toast != null,
            modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(horizontal = Spacing.gutter, vertical = Spacing.s),
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
        ) {
            last?.let { shown ->
                ToastView(shown, Modifier.clickable(remember { MutableInteractionSource() }, indication = null) { center.dismiss() })
            }
        }
    }
}

@Preview(name = "Toast — dark")
@Composable
private fun ToastDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ToastView(Toast("Added to your bag", Toast.Style.Success))
        ToastView(Toast("Only 1 left.", Toast.Style.Error))
        ToastView(Toast("Reminder set", Toast.Style.Info, Icons.Filled.Notifications))
    }
}

@Preview(name = "Toast — light")
@Composable
private fun ToastLightPreview() = YardPreview(darkTheme = false) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ToastView(Toast("Added to your bag", Toast.Style.Success))
        ToastView(Toast("Only 1 left.", Toast.Style.Error))
    }
}
