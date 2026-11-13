package space.yardstore.app.core

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Opens web pages the app doesn't have (legal pages, hosted payment, help) in a Custom Tab
 * (iOS: SFSafariViewController / Safari). Falls back to the default browser.
 *
 *   WebPages.open(context, Config.webUrl(LegalPage.Terms.path), darkTheme = isDark)
 */
object WebPages {
    fun open(context: Context, url: String, darkTheme: Boolean = true) {
        val uri = Uri.parse(url)
        val toolbar = if (darkTheme) 0xFF080808.toInt() else 0xFFF6F5F1.toInt()
        val params = CustomTabColorSchemeParams.Builder().setToolbarColor(toolbar).setNavigationBarColor(toolbar).build()
        val intent = CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(params)
            .setColorScheme(if (darkTheme) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT)
            .setShowTitle(true)
            .build()
        try {
            intent.launchUrl(context, uri)
        } catch (_: ActivityNotFoundException) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}
