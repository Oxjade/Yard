package space.yardstore.app.app

import android.content.Intent
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
import space.yardstore.app.core.AppearancePreference
import space.yardstore.app.core.WebPages
import space.yardstore.app.designsystem.YardTheme

/**
 * The single activity: edge-to-edge, applies the appearance choice at the root (iOS
 * `.preferredColorScheme`), hosts `RootView`, and routes incoming links (iOS `.onOpenURL` /
 * universal links): app destinations go through `Router.open`, anything else opens in a Custom Tab.
 */
class MainActivity : ComponentActivity() {
    private val container: AppContainer get() = (application as YardApp).container

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
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
        if (savedInstanceState == null) handleLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    private fun handleLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val url = intent.dataString ?: return
        // Email sign-in / verification links (iOS AuthEmailLinks) are not intercepted yet: see Docs/foundation.md.
        if (!container.router.open(url)) {
            val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES
            WebPages.open(this, url, darkTheme = dark)
        }
    }
}
