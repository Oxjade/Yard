package space.yardstore.app.app

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import space.yardstore.app.core.AppearancePreference
import space.yardstore.app.core.WebPages
import space.yardstore.app.designsystem.YardTheme
import space.yardstore.app.features.auth.AuthEmailLinks
import space.yardstore.app.features.notifications.YardPushCenter

/**
 * The single activity: edge-to-edge, applies the appearance choice at the root (iOS
 * `.preferredColorScheme`), hosts `RootView`, and routes incoming links (iOS `.onOpenURL` /
 * universal links): notification taps go to `YardPushCenter`, email sign-in links finish sign-in
 * in the app, app destinations go through `Router.open`, anything else opens in a Custom Tab.
 */
class MainActivity : ComponentActivity() {
    private val container: AppContainer get() = (application as YardApp).container

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        applyOrientationPolicy(resources.configuration)
        enableEdgeToEdge()
        setContent {
            val preference by container.appearance.preference.collectAsStateWithLifecycle(initialValue = AppearancePreference.SYSTEM)
            val dark = preference.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val style = if (dark) {
                    SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                } else {
                    SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            YardTheme(darkTheme = dark) {
                RootView(container)
            }
        }
        if (savedInstanceState == null) handleIntent(intent)
    }

    /**
     * Rotation, resize and fold/unfold are handled in place (manifest `configChanges`): Compose
     * recomposes with the new size (`LocalYardWindow`), so tab back stacks, sheets, ViewModels and
     * `remember` state are all kept. Re-check the orientation policy (a foldable can change class).
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyOrientationPolicy(newConfig)
    }

    /**
     * Phones (smallest width < 600dp) stay portrait like the iOS app; tablets and unfolded
     * foldables rotate freely. Multi-window ignores requested orientation, so leave it alone there.
     */
    private fun applyOrientationPolicy(config: Configuration) {
        if (isInMultiWindowMode) return
        val wanted = orientationFor(config.smallestScreenWidthDp)
        if (requestedOrientation != wanted) requestedOrientation = wanted
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    companion object {
        /** Portrait below 600dp smallest width (phones), unspecified (free rotation) otherwise. */
        fun orientationFor(smallestScreenWidthDp: Int): Int =
            if (smallestScreenWidthDp in 1 until 600) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    private fun handleIntent(intent: Intent?) {
        val incoming = AppLinkRouting.classify(
            action = intent?.action,
            url = intent?.dataString,
            pushHref = intent?.takeIf { it.hasExtra(YardPushCenter.EXTRA_HREF) }
                ?.let { it.getStringExtra(YardPushCenter.EXTRA_HREF).orEmpty() },
            isEmailLink = AuthEmailLinks::canHandle,
        )
        when (incoming) {
            is AppLinkRouting.Incoming.NotificationTap -> YardPushCenter.handleTap(incoming.href)
            is AppLinkRouting.Incoming.EmailLink -> container.appScope.launch {
                AuthEmailLinks.handle(incoming.url, container.session)?.let { container.toast.show(it) }
            }
            is AppLinkRouting.Incoming.AppLink -> handleLink(incoming.url)
            AppLinkRouting.Incoming.Ignore -> Unit
        }
    }

    private fun handleLink(url: String) {
        val route = Route.fromUrl(url)
        // The payment provider's redirect back to /checkout/confirmation: the bag's checkout flow
        // pushes that confirmation itself, so don't stack a second one (see Docs/bag.md).
        if (AppLinkRouting.isDuplicateConfirmation(route, container.tabTops.all)) return
        if (!container.router.open(url)) {
            val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES
            WebPages.open(this, url, darkTheme = dark)
        }
    }
}

/** Pure decisions behind [MainActivity]'s intent handling (unit-tested). */
internal object AppLinkRouting {
    sealed interface Incoming {
        /** A tapped notification carrying `YardPushCenter.EXTRA_HREF` (empty → the notifications list). */
        data class NotificationTap(val href: String) : Incoming
        /** An email sign-in / verification link (`AuthEmailLinks`): finish it in the app, then toast. */
        data class EmailLink(val url: String) : Incoming
        /** Any other link: an app route (`Router.open`) or else a Custom Tab. */
        data class AppLink(val url: String) : Incoming
        data object Ignore : Incoming
    }

    /**
     * [pushHref] is the notification extra when the intent has it (possibly empty), else null.
     * Notification taps win over the intent's data; other links must be ACTION_VIEW with a URL.
     */
    fun classify(action: String?, url: String?, pushHref: String?, isEmailLink: (String) -> Boolean): Incoming = when {
        pushHref != null -> Incoming.NotificationTap(pushHref)
        action != Intent.ACTION_VIEW || url.isNullOrEmpty() -> Incoming.Ignore
        isEmailLink(url) -> Incoming.EmailLink(url)
        else -> Incoming.AppLink(url)
    }

    /**
     * True when an incoming confirmation link should be dropped: that same confirmation is already
     * on top of a tab, or a checkout is on top of a tab (its model verifies on return from the
     * payment page and pushes the confirmation itself).
     */
    fun isDuplicateConfirmation(link: Route?, tabTops: Collection<Route?>): Boolean {
        if (link !is Route.OrderConfirmation) return false
        return link in tabTops || Route.Checkout in tabTops
    }
}
