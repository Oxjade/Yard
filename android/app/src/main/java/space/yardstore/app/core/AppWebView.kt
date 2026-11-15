package space.yardstore.app.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * URL rules for website pages shown inside an in-app WebView (the legal pages).
 *
 * Shared contract with the website: a page requested with `?view=app` renders only its content
 * (no market header, tab bar, footer, overlays). Links to other `/legal/` pages stay in the
 * WebView with `?view=app`; anything else leaves the WebView (Custom Tab / system handler).
 */
object AppWebView {
    const val VIEW_PARAM = "view"
    const val VIEW_APP = "app"

    /** What the WebView does with a navigation. */
    sealed interface Navigation {
        /** Let the WebView load [url] as is (already an in-app page). */
        data object Allow : Navigation
        /** Load [url] in the WebView instead (the in-app form of the link). */
        data class Rewrite(val url: String) : Navigation
        /** Open [url] outside the WebView (Custom Tab for http(s), system handler otherwise). */
        data class External(val url: String) : Navigation
    }

    /**
     * [url] with `view=app` set, keeping every other query parameter and the fragment.
     * A url that already says `view=app` is returned unchanged; another `view` value is replaced.
     * A url that isn't http(s) is returned unchanged.
     */
    fun appViewUrl(url: String): String {
        val parsed = url.toHttpUrlOrNull() ?: return url
        if (parsed.queryParameterValues(VIEW_PARAM) == listOf(VIEW_APP)) return url
        return parsed.newBuilder().setQueryParameter(VIEW_PARAM, VIEW_APP).build().toString()
    }

    /** The in-app URL of a site path, e.g. `appViewUrl(base, "/legal/terms")`. */
    fun appViewUrl(base: HttpUrl, path: String): String =
        appViewUrl(base.resolve(path)?.toString() ?: base.toString())

    /** True when [url] is a `/legal/…` page on the site ([base]'s host, or its www./apex twin). */
    fun isLegalPage(url: String, base: HttpUrl): Boolean {
        val parsed = url.toHttpUrlOrNull() ?: return false
        if (!sameSite(parsed.host, base.host)) return false
        val path = parsed.encodedPath.trimEnd('/')
        return path == "/legal" || path.startsWith("/legal/")
    }

    /** The site path of a `/legal/…` page [url] (no trailing slash, no query), or null when it isn't one. */
    fun legalPath(url: String, base: HttpUrl): String? {
        if (!isLegalPage(url, base)) return null
        return url.toHttpUrlOrNull()?.encodedPath?.trimEnd('/')
    }

    /** Decide what a main-frame navigation to [url] does inside the WebView. */
    fun route(url: String, base: HttpUrl): Navigation = when {
        !isLegalPage(url, base) -> Navigation.External(url)
        appViewUrl(url) == url -> Navigation.Allow
        else -> Navigation.Rewrite(appViewUrl(url))
    }

    private fun sameSite(a: String, b: String): Boolean =
        a.lowercase().removePrefix("www.") == b.lowercase().removePrefix("www.")
}
