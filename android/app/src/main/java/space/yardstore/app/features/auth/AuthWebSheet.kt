package space.yardstore.app.features.auth

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Cookie
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.components.BackAction
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.UUID
import kotlin.coroutines.resume

// Social sign-in (Google via Auth0, Apple, …) in an in-app WebView. Mirrors AuthWebSheet.swift.
//
// Why a WebView and not a Custom Tab: the server binds every OAuth round trip to the browser that
// started it (`yard_oauth` cookie set by POST /api/auth/oauth/{p}/start, checked by the callback)
// and finishes by setting the session cookie (`yard_s`) on the callback response. A Custom Tab runs
// in the browser's cookie jar, which the app can neither write the binding cookie into nor read the
// session cookie back from, so the callback would answer `invalid_state` and the app would never be
// signed in. With a WebView we copy the app's cookies (OkHttp's `PersistentCookieJar`, exposed as
// `APIClient.shared.http.cookieJar`) into `android.webkit.CookieManager` before loading, and copy
// the API host's cookies back into the OkHttp jar when the flow lands on /auth/complete.
//
// CookieManager is process-wide (iOS uses a non-persistent WKWebsiteDataStore per flow), so the
// sheet clears the WebView's cookies and web storage before and after each flow to the same effect.

/** How the web flow ended. */
sealed interface AuthWebOutcome {
    /** Reached /auth/complete with `result=` (e.g. "signed_in", "cancelled", "invalid_state"). */
    data class Completed(val result: String) : AuthWebOutcome
    /** The shopper closed the sheet. */
    data object Cancelled : AuthWebOutcome
    /** The page could not load. */
    data class Failed(val message: String) : AuthWebOutcome
}

/** A started social sign-in, shown with [AuthWebSheet]. */
data class AuthWebFlow(val url: String, val label: String, val id: String = UUID.randomUUID().toString())

/** Copies cookies between the app's OkHttp jar and the WebView's [CookieManager]. */
object AuthCookieBridge {
    /** New imported cookies without a known lifetime: the shopper session's idle window (30 days). */
    private const val IMPORTED_LIFETIME_MS = 30L * 24 * 60 * 60 * 1000

    private val jar get() = APIClient.shared.http.cookieJar

    /** True when a cookie domain belongs to the API host (host-only `__Host-` cookies or `.domain` ones). */
    fun belongsToAPI(domain: String): Boolean {
        val host = Config.baseHttpUrl.host.lowercase()
        val d = domain.lowercase().removePrefix(".")
        return d == host || host.endsWith(".$d")
    }

    /** The app's cookies for the API host (guest cart, the OAuth binding cookie, …). */
    fun appCookies(): List<Cookie> = jar.loadForRequest(Config.baseHttpUrl)

    /** Empties the WebView's cookie store and web storage (a fresh, private browser per flow). */
    suspend fun clearWebView() {
        val manager = CookieManager.getInstance()
        suspendCancellableCoroutine { cont -> manager.removeAllCookies { cont.resume(Unit) } }
        runCatching { WebStorage.getInstance().deleteAllData() }
    }

    /** Copies the app's API-host cookies into the WebView. */
    suspend fun copyAppCookiesToWebView() {
        val manager = CookieManager.getInstance()
        manager.setAcceptCookie(true)
        val url = Config.baseUrl
        for (cookie in appCookies()) {
            val header = buildString {
                append(cookie.name).append('=').append(cookie.value)
                append("; Path=").append(cookie.path)
                if (!cookie.hostOnly) append("; Domain=").append(cookie.domain)
                if (cookie.secure) append("; Secure")
                if (cookie.httpOnly) append("; HttpOnly")
            }
            suspendCancellableCoroutine { cont -> manager.setCookie(url, header) { cont.resume(Unit) } }
        }
        manager.flush()
    }

    /** The WebView's cookies for the API host as name → value (CookieManager only exposes those). */
    fun webViewCookies(): List<Pair<String, String>> {
        val raw = CookieManager.getInstance().getCookie(Config.baseUrl) ?: return emptyList()
        return raw.split(';').mapNotNull { part ->
            val trimmed = part.trim()
            val eq = trimmed.indexOf('=')
            if (eq <= 0) null else trimmed.substring(0, eq) to trimmed.substring(eq + 1)
        }
    }

    /**
     * Copies the WebView's API-host cookies into the app's jar. Returns true when a shopper
     * session cookie (`yard_s` / `__Host-yard_s`) came across.
     */
    fun importCookies(cookies: List<Pair<String, String>>): Boolean {
        val base = Config.baseHttpUrl
        val existing = appCookies().associateBy { it.name }
        val now = System.currentTimeMillis()
        var gotSession = false
        val toSave = mutableListOf<Cookie>()
        for ((name, value) in cookies) {
            if (name.endsWith("yard_oauth")) continue
            val known = existing[name]
            val builder = Cookie.Builder().name(name).value(value)
            if (known != null && belongsToAPI(known.domain)) {
                builder.path(known.path).expiresAt(maxOf(known.expiresAt, now + IMPORTED_LIFETIME_MS))
                if (known.hostOnly) builder.hostOnlyDomain(known.domain) else builder.domain(known.domain)
                if (known.secure) builder.secure()
            } else {
                builder.hostOnlyDomain(base.host).path("/").expiresAt(now + IMPORTED_LIFETIME_MS)
                if (base.isHttps) builder.secure()
            }
            builder.httpOnly()
            val cookie = runCatching { builder.build() }.getOrNull() ?: continue
            toSave += cookie
            if (name == "yard_s" || name == "__Host-yard_s") gotSession = true
        }
        // The binding cookie is single-use; drop the app's stale copy (an expired cookie removes it).
        for (stale in appCookies().filter { it.name.endsWith("yard_oauth") }) {
            val b = Cookie.Builder().name(stale.name).value("").path(stale.path).expiresAt(1)
            if (stale.hostOnly) b.hostOnlyDomain(stale.domain) else b.domain(stale.domain)
            runCatching { b.build() }.getOrNull()?.let { toSave += it }
        }
        if (toSave.isNotEmpty()) jar.saveFromResponse(base, toSave)
        return gotSession
    }
}

/**
 * The full-screen sheet: a top bar with × (Cancel), the WebView, and a spinner card while pages load.
 * Android back goes back in the web history first, then cancels.
 */
@Composable
fun AuthWebSheet(flow: AuthWebFlow, onFinish: (AuthWebOutcome) -> Unit) {
    val currentOnFinish by rememberUpdatedState(onFinish)
    var isReady by remember(flow.id) { mutableStateOf(false) }
    var isLoading by remember(flow.id) { mutableStateOf(true) }
    var didFinish by remember(flow.id) { mutableStateOf(false) }
    var canGoBack by remember(flow.id) { mutableStateOf(false) }
    var webView by remember(flow.id) { mutableStateOf<WebView?>(null) }
    val scope = rememberCoroutineScope()

    fun finish(outcome: AuthWebOutcome) {
        if (didFinish) return
        didFinish = true
        currentOnFinish(outcome)
    }

    LaunchedEffect(flow.id) {
        // A fresh browser, then the app's cookies (above all the OAuth binding cookie).
        AuthCookieBridge.clearWebView()
        AuthCookieBridge.copyAppCookiesToWebView()
        isReady = true
    }
    DisposableEffect(flow.id) {
        onDispose {
            // Like iOS's non-persistent data store: nothing from this flow stays in the WebView.
            CookieManager.getInstance().removeAllCookies(null)
            runCatching { WebStorage.getInstance().deleteAllData() }
        }
    }

    Dialog(
        onDismissRequest = { finish(AuthWebOutcome.Cancelled) },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BackHandler(enabled = canGoBack) { webView?.goBack() }
        Column(Modifier.fillMaxSize().yardScreenBackground()) {
            YardTopBar(
                title = "Continue with ${flow.label}",
                back = BackAction(isClose = true) { finish(AuthWebOutcome.Cancelled) },
            )
            Box(Modifier.weight(1f).navigationBarsPadding()) {
                if (isReady) {
                    AuthWebView(
                        url = flow.url,
                        onCreated = { webView = it },
                        onLoading = { if (!didFinish) isLoading = it },
                        onHistory = { canGoBack = it },
                        onComplete = { result ->
                            isLoading = true
                            scope.launch {
                                // The session cookie arrives on the callback's redirect; give the
                                // cookie store a moment to settle before reading it.
                                var attempt = 0
                                while (attempt < 5) {
                                    val gotSession = AuthCookieBridge.importCookies(AuthCookieBridge.webViewCookies())
                                    if (gotSession || result != "signed_in") break
                                    attempt += 1
                                    delay(300)
                                }
                                finish(AuthWebOutcome.Completed(result))
                            }
                        },
                        onFailed = { message -> finish(AuthWebOutcome.Failed(message)) },
                    )
                }
                androidx.compose.animation.AnimatedVisibility(
                    visible = isLoading,
                    enter = fadeIn(Motion.fade()),
                    exit = fadeOut(Motion.fade()),
                    modifier = Modifier.align(Alignment.Center),
                ) {
                    Column(
                        Modifier.yardCard().padding(Spacing.xl),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(Spacing.m),
                    ) {
                        CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                        Text("Opening ${flow.label}…", style = YardFonts.callout, color = Color.yard.ink2)
                    }
                }
            }
        }
    }
}

/** WebView that stops at https://<api host>/auth/complete and reports `result=`. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun AuthWebView(
    url: String,
    onCreated: (WebView) -> Unit,
    onLoading: (Boolean) -> Unit,
    onHistory: (Boolean) -> Unit,
    onComplete: (String) -> Unit,
    onFailed: (String) -> Unit,
) {
    val background = Color.yard.bg.toArgb()
    val callbacks by rememberUpdatedState(AuthWebCallbacks(onLoading, onHistory, onComplete, onFailed))
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(background)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // Providers sometimes open a new window (target=_blank / window.open): keep it in this view.
                settings.setSupportMultipleWindows(false)
                settings.javaScriptCanOpenWindowsAutomatically = false
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                webViewClient = AuthWebClient { callbacks }
                onCreated(this)
                loadUrl(url)
            }
        },
        onRelease = { view ->
            view.stopLoading()
            view.destroy()
        },
    )
}

private class AuthWebCallbacks(
    val onLoading: (Boolean) -> Unit,
    val onHistory: (Boolean) -> Unit,
    val onComplete: (String) -> Unit,
    val onFailed: (String) -> Unit,
)

private class AuthWebClient(private val callbacks: () -> AuthWebCallbacks) : WebViewClient() {
    private var completed = false

    private fun isCompletionUrl(url: String?): Boolean {
        val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return false
        return uri.host.equals(Config.baseHttpUrl.host, ignoreCase = true) && uri.path == "/auth/complete"
    }

    private fun complete(url: String) {
        if (completed) return
        completed = true
        val result = runCatching { Uri.parse(url).getQueryParameter("result") }.getOrNull() ?: "error"
        callbacks().onComplete(result)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        if (isCompletionUrl(url)) {
            complete(url)
            return true
        }
        // Only web pages inside the sheet (no intent:// or app schemes).
        val scheme = request.url.scheme?.lowercase()
        return scheme != "http" && scheme != "https"
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        // A completion reached without shouldOverrideUrlLoading (e.g. after a POST callback).
        if (isCompletionUrl(url)) {
            view.stopLoading()
            complete(url!!)
            return
        }
        if (!completed) callbacks().onLoading(true)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        if (!completed) callbacks().onLoading(false)
        callbacks().onHistory(view.canGoBack())
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        callbacks().onHistory(view.canGoBack())
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (completed || !request.isForMainFrame) return
        if (isCompletionUrl(request.url.toString())) return
        val cause: Throwable = when (error.errorCode) {
            ERROR_HOST_LOOKUP, ERROR_CONNECT -> UnknownHostException()
            ERROR_TIMEOUT -> SocketTimeoutException()
            else -> IOException("web")
        }
        completed = true
        callbacks().onLoading(false)
        callbacks().onFailed(APIError.network(cause).message)
    }
}
