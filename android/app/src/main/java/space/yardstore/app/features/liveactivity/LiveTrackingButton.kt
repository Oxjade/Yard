package space.yardstore.app.features.liveactivity

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/**
 * "Track in notifications" for an order that has shipped. Mirrors iOS `LiveActivityTrackButton`
 * ("Track on Lock Screen"). The Orders screen can drop it into the order detail's delivery section:
 *
 *   LiveTrackingButton(orderId = order.id)
 *
 * It starts the ongoing tracking notification (or stops it when one is running). On Android 13+
 * the first tap asks for the notification permission; when notifications are off it says so and
 * offers the system settings instead of showing a dead button.
 */
@Composable
fun LiveTrackingButton(orderId: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val inPreview = LocalInspectionMode.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var notificationsEnabled by remember { mutableStateOf(!inPreview && LiveTrackingManager.areNotificationsEnabled(context)) }
    var askedForPermission by remember { mutableStateOf(false) }
    var isWorking by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    if (!inPreview) {
        LaunchedEffect(Unit) { LiveTrackingManager.install(context) }
        // Coming back from Settings or the shade: re-read permission and what is still showing.
        LifecycleResumeEffect(Unit) {
            notificationsEnabled = LiveTrackingManager.areNotificationsEnabled(context)
            LiveTrackingManager.refreshTracked()
            onPauseOrDispose { }
        }
    }

    val isTracking = orderId in LiveTrackingManager.trackedOrderIds
    var lastTracking by remember { mutableStateOf(isTracking) }
    LaunchedEffect(isTracking) {
        // iOS `.sensoryFeedback(.success, trigger:)`: a tick whenever tracking turns on or off.
        if (isTracking != lastTracking) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            lastTracking = isTracking
        }
    }

    fun startTracking() {
        isWorking = true
        message = null
        scope.launch {
            try {
                LiveTrackingManager.install(context)
                val order = LiveActivityOrder.load(orderId)
                message = when {
                    order.state == null || order.isClosed -> "Tracking starts once the brand ships it."
                    order.state.step == YardOrderActivityAttributes.Step.Delivered -> "This order has been delivered."
                    !LiveTrackingManager.start(order) -> "Couldn't start tracking. Try again in a moment."
                    else -> null
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                message = APIError.messageFor(e)
            } finally {
                isWorking = false
            }
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        askedForPermission = true
        notificationsEnabled = LiveTrackingManager.areNotificationsEnabled(context)
        if (granted && notificationsEnabled) startTracking()
    }
    // Android 13+: the permission can still be asked for (until the person declines).
    val canAskPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !askedForPermission &&
        !inPreview && !NotificationsPermission.isGranted(context)

    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        when {
            !notificationsEnabled && !canAskPermission -> {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.NotificationsOff, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(16.dp))
                    Text(
                        "Turn on notifications for Yard in Settings to track this order.",
                        style = YardFonts.caption,
                        color = Color.yard.ink2,
                    )
                }
                YardButton(
                    "Open notification settings",
                    style = YardButtonStyle.Secondary,
                    size = YardButtonSize.Small,
                    fullWidth = false,
                ) { openNotificationSettings(context) }
            }
            isTracking -> YardButton(
                "Stop tracking in notifications",
                icon = Icons.Outlined.Cancel,
                style = YardButtonStyle.Secondary,
                size = YardButtonSize.Medium,
                isLoading = isWorking,
            ) {
                isWorking = true
                message = null
                LiveTrackingManager.end(orderId, immediately = true)
                isWorking = false
            }
            else -> YardButton(
                "Track in notifications",
                icon = Icons.Outlined.NotificationsActive,
                style = YardButtonStyle.Primary,
                size = YardButtonSize.Medium,
                isLoading = isWorking,
            ) {
                if (!notificationsEnabled && canAskPermission) {
                    permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    startTracking()
                }
            }
        }
        AnimatedVisibility(visible = message != null) {
            Text(message.orEmpty(), style = YardFonts.caption, color = Color.yard.ink2)
        }
    }
}

private object NotificationsPermission {
    fun isGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
}

/** Yard's notification settings (Android 8+: the app page with its channels). */
private fun openNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

@Preview(name = "Track button — light")
@Composable
private fun LiveTrackingButtonLight() = YardPreview(darkTheme = false) {
    Box(Modifier.fillMaxSize().padding(Spacing.gutter)) { LiveTrackingButton(orderId = "ord_preview") }
}

@Preview(name = "Track button — dark")
@Composable
private fun LiveTrackingButtonDark() = YardPreview(darkTheme = true) {
    Box(Modifier.fillMaxSize().padding(Spacing.gutter)) { LiveTrackingButton(orderId = "ord_preview") }
}
