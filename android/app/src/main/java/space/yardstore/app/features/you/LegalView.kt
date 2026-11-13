package space.yardstore.app.features.you

import android.annotation.SuppressLint
import android.graphics.Bitmap
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
 */
@Composable
fun LegalView(page: LegalPage) {
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val url = remember(page) { Config.webUrl(page.path) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var reloadToken by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(page.title, actions = {
            GlassIconButton(Icons.Outlined.OpenInBrowser, "Open in browser", size = 38.dp) {
                WebPages.open(context, url, dark)
            }
        })
        Box(Modifier.fillMaxSize()) {
            val error = errorMessage
            if (error != null) {
                EmptyState.Error(message = error) {
                    errorMessage = null
                    isLoading = true
                    reloadToken += 1
                }
            } else {
                if (!LocalInspectionMode.current) {
                    key(reloadToken) {
                        YouLegalWebView(
                            url = url,
                            modifier = Modifier.fillMaxSize().alpha(if (isLoading) 0f else 1f),
                            onFinish = { isLoading = false },
                            onFail = { message ->
                                isLoading = false
                                errorMessage = message
                            },
                        )
                    }
                }
                if (isLoading) YouLegalSkeleton()
            }
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

/** WebView wrapper (iOS `YouLegalWebView`). A fresh one is made for each reload (keyed by the caller). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun YouLegalWebView(url: String, modifier: Modifier, onFinish: () -> Unit, onFail: (String) -> Unit) {
    val finish by rememberUpdatedState(onFinish)
    val fail by rememberUpdatedState(onFail)
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webViewClient = object : WebViewClient() {
                    private var failed = false

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                        failed = false
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        if (!failed) finish()
                    }

                    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                        if (request?.isForMainFrame != true) return
                        failed = true
                        fail(APIError.network(IOException(error?.description?.toString() ?: "Network error")).message)
                    }
                }
                loadUrl(url)
            }
        },
        onRelease = { it.destroy() },
    )
}

@Preview(name = "LegalView — dark")
@Composable
private fun LegalDark() = YardPreview(darkTheme = true) { LegalView(LegalPage.Terms) }

@Preview(name = "LegalView — light")
@Composable
private fun LegalLight() = YardPreview(darkTheme = false) { LegalView(LegalPage.Privacy) }
