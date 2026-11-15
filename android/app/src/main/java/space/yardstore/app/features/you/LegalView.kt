package space.yardstore.app.features.you

import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.AdaptiveContent
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ContextThemeWrapper
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import androidx.compose.ui.graphics.toArgb
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import space.yardstore.app.R
import space.yardstore.app.core.AppWebView
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import space.yardstore.app.app.LegalPage
import space.yardstore.app.core.Config
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.io.IOException

/**
 * A legal page (Terms, Privacy, Refunds, Data deletion): the website's page in an in-app WebView,
 * so the text is always the one in force. Mirrors LegalView.swift (WKWebView → android.webkit.WebView).
 *
 * The page is requested with `?view=app` (website contract: content only, no site header, tab bar,
 * footer or overlays) and in the app's light/dark choice. Links to other `/legal/` pages stay in the
 * WebView (with `?view=app`); any other link opens in a Custom Tab.
 */
@Composable
fun LegalView(page: LegalPage) {
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val pageUrl = remember(page) { Config.webUrl(page.path) }
    val inAppUrl = remember(pageUrl) { AppWebView.appViewUrl(pageUrl) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var reloadToken by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(page.title, actions = {
            GlassIconButton(Icons.Outlined.OpenInBrowser, "Open in browser", size = 38.dp) {
                WebPages.open(context, pageUrl, dark)
            }
        })
        // Reading screen: the page's text column is capped on wide windows (Tablet rule 2).
        AdaptiveContent(Modifier.fillMaxSize()) {
            val error = errorMessage
            if (error != null) {
                EmptyState.Error(message = error) {
                    errorMessage = null
                    isLoading = true
                    reloadToken += 1
                }
            } else {
                if (!LocalInspectionMode.current) {
                    // A new WebView for each retry and for a light/dark switch (the theme is read at creation).
                    key(reloadToken, dark) {
                        YouLegalWebView(
                            url = inAppUrl,
                            dark = dark,
                            background = Color.yard.bg,
                            modifier = Modifier.fillMaxSize().alpha(if (isLoading) 0f else 1f),
                            onStart = { isLoading = true },
                            onFinish = { isLoading = false },
                            onFail = { message ->
                                isLoading = false
                                errorMessage = message
                            },
                            onExternal = { link -> openExternal(context, link, dark) },
                        )
                    }
                }
                if (isLoading) YouLegalSkeleton()
            }
        }
    }
}

/** A link that leaves the legal WebView: http(s) in a Custom Tab, anything else (mailto:, tel:) to the system. */
private fun openExternal(context: Context, url: String, dark: Boolean) {
    val scheme = url.substringBefore(':', "").lowercase()
    if (scheme == "http" || scheme == "https") {
        WebPages.open(context, url, dark)
    } else {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

@Composable
private fun YouLegalSkeleton() {
    Column(
        Modifier.fillMaxSize().padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Skeleton(Modifier.size(width = 200.dp, height = 28.dp), cornerRadius = 6.dp)
        repeat(8) { i ->
            Skeleton(Modifier.fillMaxWidth().padding(end = ((i * 37) % 90).dp).height(12.dp), cornerRadius = 4.dp)
        }
    }
}

/**
 * WebView wrapper (iOS `YouLegalWebView`). A fresh one is made for each reload and theme (keyed by the caller).
 * Its background is the app's screen colour, so it is never an empty black (or white) box.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun YouLegalWebView(
    url: String,
    dark: Boolean,
    background: Color,
    modifier: Modifier,
    onStart: () -> Unit,
    onFinish: () -> Unit,
    onFail: (String) -> Unit,
    onExternal: (String) -> Unit,
) {
    val start by rememberUpdatedState(onStart)
    val finish by rememberUpdatedState(onFinish)
    val fail by rememberUpdatedState(onFail)
    val external by rememberUpdatedState(onExternal)
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            // prefers-color-scheme follows the app's choice, not the activity theme's (always light) flag.
            val themed = ContextThemeWrapper(ctx, if (dark) R.style.ThemeOverlay_Yard_WebDark else R.style.ThemeOverlay_Yard_WebLight)
            WebView(themed).apply {
                setBackgroundColor(background.toArgb())
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                applyColorScheme(settings, dark)
                webViewClient = object : WebViewClient() {
                    private var failed = false

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        if (!request.isForMainFrame) return false
                        return when (val nav = AppWebView.route(request.url.toString(), Config.baseHttpUrl)) {
                            AppWebView.Navigation.Allow -> false
                            is AppWebView.Navigation.Rewrite -> { view.loadUrl(nav.url); true }
                            is AppWebView.Navigation.External -> { external(nav.url); true }
                        }
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                        failed = false
                        start()
                    }

                    // The first paint of the new page: show it as soon as there is something to see.
                    override fun onPageCommitVisible(view: WebView?, url: String?) {
                        if (!failed) finish()
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        if (!failed) finish()
                    }

                    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                        if (request?.isForMainFrame != true) return
                        failed = true
                        fail(APIError.network(IOException(error?.description?.toString() ?: "Network error")).message)
                    }

                    override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                        if (request?.isForMainFrame != true) return
                        failed = true
                        fail("The page couldn't be loaded (${errorResponse?.statusCode ?: "error"}). Try again in a moment.")
                    }
                }
                loadUrl(url)
            }
        },
        onRelease = { it.destroy() },
    )
}

/**
 * The page draws its own light/dark theme (prefers-color-scheme); never let WebView invert it.
 * On older WebViews (no isLightTheme support) the deprecated force-dark switch carries the choice.
 */
@Suppress("DEPRECATION")
private fun applyColorScheme(settings: WebSettings, dark: Boolean) = runCatching {
    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
        WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
        WebSettingsCompat.setForceDarkStrategy(settings, WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY)
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
        WebSettingsCompat.setForceDark(settings, if (dark) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF)
    }
}

@Preview(name = "LegalView — dark")
@Composable
private fun LegalDark() = YardPreview(darkTheme = true) { LegalView(LegalPage.Terms) }

@Preview(name = "LegalView — light")
@Composable
private fun LegalLight() = YardPreview(darkTheme = false) { LegalView(LegalPage.Privacy) }

@YardTabletPreviews
@Composable
private fun LegalTablet() = YardPreview(darkTheme = true) { LegalView(LegalPage.Terms) }
