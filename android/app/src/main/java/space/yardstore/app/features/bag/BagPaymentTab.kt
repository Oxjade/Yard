package space.yardstore.app.features.bag

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import space.yardstore.app.core.WebPages
import space.yardstore.app.designsystem.yard

/**
 * The payment provider's hosted page (Paystack / Bachs) in a Custom Tab. Card details are typed
 * there, never in Yard. Mirrors `BagPaymentSafariView.swift`.
 *
 * - iOS presents SFSafariViewController and gets `safariViewControllerDidFinish` on Done. Android's
 *   Custom Tab has no such callback, so "Done" = the app comes back to the foreground after the tab
 *   was opened (close button, back, or the provider's redirect handing control back). [onFinish]
 *   runs then.
 * - iOS closes the sheet when the poll settles (`paymentPage = nil`). Android brings the app's own
 *   activity back to the front of its task, which finishes the Custom Tab sitting above it.
 */
@Composable
fun BagPaymentTabEffect(
    page: BagPaymentPage?,
    launchedPageId: String?,
    onLaunched: (String) -> Unit,
    onFinish: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val dark = Color.yard.isDark
    val currentLaunchedId by rememberUpdatedState(launchedPageId)
    val finish by rememberUpdatedState(onFinish)
    val currentPage by rememberUpdatedState(page)

    // Open each page once (the model remembers which one was opened, across recompositions).
    LaunchedEffect(page?.id) {
        if (page != null && page.id != currentLaunchedId) {
            onLaunched(page.id)
            WebPages.open(context, page.url, darkTheme = dark)
        }
    }

    // A resume after the tab took the foreground = the shopper is back (iOS: Done).
    DisposableEffect(lifecycleOwner) {
        var leftForTab = false
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> if (currentPage != null && currentPage?.id == currentLaunchedId) leftForTab = true
                Lifecycle.Event.ON_RESUME -> if (leftForTab) {
                    leftForTab = false
                    finish()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
}

object BagPaymentTab {
    /**
     * Closes the Custom Tab (if it is still on top) by bringing the app's activity back to the front
     * of its task; the activity is `singleTask`, so everything above it is finished. The intent has no
     * data, so the activity's link handling ignores it.
     */
    fun close(context: Context) {
        val activity = context.findActivity() ?: return
        val intent = Intent(activity, activity.javaClass)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        runCatching { activity.startActivity(intent) }
    }

    /** [close], only while the app is not in front (i.e. the Custom Tab still covers it). */
    fun closeIfCovered(context: Context) {
        val activity = context.findActivity() ?: return
        val owner = activity as? androidx.lifecycle.LifecycleOwner ?: return
        if (!owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) close(context)
    }

    private fun Context.findActivity(): Activity? {
        var c: Context? = this
        while (c is ContextWrapper) {
            if (c is Activity) return c
            c = c.baseContext
        }
        return null
    }
}

/** The hosted payment page while it is open (iOS: drives `.fullScreenCover(item:)`). */
data class BagPaymentPage(val checkoutId: String, val url: String) {
    val id: String get() = "$checkoutId|$url"
}
