package space.yardstore.app.features.around

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import space.yardstore.app.designsystem.LocalYardWindow
import java.time.Instant
import kotlin.math.min

// ANDROID-ONLY: iOS uses MapKit. Android draws the website's dark 3D globe: MapLibre GL JS 6.16.0
// (the website's own version) with globe projection, in a WebView that loads only the APK's assets
// (assets/around/, served by WebViewAssetLoader at https://appassets.androidplatform.net). MapLibre
// Native for Android has globe only in preview builds, so the WebView is the stable way to get it.
// Kotlin and the page talk through the typed messages in AroundGlobeBridge.

/**
 * The globe's space and ocean colours. The globe is dark in both appearances, like the website's
 * (src/components/around/map/around-map.css: #050505 space, #060609 ocean, #1d1c24 land).
 */
private val GlobeSpace = Color(0xFF050505)
private val GlobeOcean = Color(0xFF060609)
private val GlobeRim = Color(0x73858585)

/** Drives the globe from Compose (iOS `MapCameraPosition` + `onMapCameraChange`). */
@Stable
class AroundMapController {
    /** Bumped whenever the camera comes to rest (iOS `onMapCameraChange(frequency: .onEnd)`). */
    var cameraTick by mutableIntStateOf(0)
        internal set

    /** The page shows its simplified SVG map instead of the globe (no WebGL 2, or the map failed). */
    var isUnavailable by mutableStateOf(false)
        internal set

    /** Bumped when the WebView's renderer died, so the composable builds a fresh one. */
    internal var generation by mutableIntStateOf(0)
        private set

    private var region: AroundRegion? = null
    private var webView: WebView? = null
    private var ready = false
    private var widthDp = 0.0
    private var heightDp = 0.0
    internal var wide = false

    // The page's state, replayed whenever it (re)loads.
    private var placesMessage: String? = null
    private var selectMessage: String = AroundGlobeBridge.selectMessage(null)
    private var you: AroundCoordinate? = null
    private var chromeMessage: String? = null
    private var reducedMotion = false
    /** The last camera asked for or reported; where this screen was last time, else the opening globe. */
    private var camera: AroundGlobeCamera? = lastCamera
    /** A region asked for before the map knew its size. */
    private var pendingRegion: AroundRegion? = null
    /** The sheet's height at rest (peek), in dp: the camera's padding keeps the globe above it. */
    private var peekDp = 0.0

    internal var onPlaceTapped: (String) -> Unit = {}
    internal var onCityTapped: (String) -> Unit = {}

    /** The region in view once the camera last came to rest, or null before the globe has drawn. */
    fun currentRegion(): AroundRegion? = region

    /** The zoom the camera last rested at (or was sent to). */
    fun currentZoom(): Double? = camera?.zoom

    /**
     * The part of the map a camera frames, in dp: the map minus the page's padding (globe.js
     * `padding()`: under the title on top, above the sheet's peek; wide screens a margin all round).
     */
    fun frame(): AroundFrame? {
        if (widthDp <= 0 || heightDp <= 0) return null
        return if (wide) AroundFrame(widthDp - 96, heightDp - 96) else AroundFrame(widthDp - 32, heightDp - 56 - peekDp - 16)
    }

    /** Flies the camera to show [region] (iOS `withAnimation { position = .region(r) }`). */
    fun flyTo(region: AroundRegion, animated: Boolean = true) {
        if (widthDp <= 0 || heightDp <= 0) {
            pendingRegion = region
            camera = null
            return
        }
        pendingRegion = null
        flyTo(AroundGlobeBridge.cameraFor(region, widthDp, heightDp, wide), animated)
    }

    /** Flies to [camera] (the website's `flyTo`: speed 1.6, curve 1.4; a jump under reduced motion). */
    fun flyTo(camera: AroundGlobeCamera, animated: Boolean = true) {
        pendingRegion = null
        this.camera = camera
        lastCamera = camera
        send(AroundGlobeBridge.flyToMessage(camera, animated))
    }

    /** Brings [place]'s own pin into the free part of the map (out of a cluster, above the sheet), only if it isn't already. */
    fun reveal(place: AroundPlace) {
        send(AroundGlobeBridge.revealMessage(place))
    }

    internal fun setSize(widthDp: Double, heightDp: Double) {
        this.widthDp = widthDp
        this.heightDp = heightDp
        pendingRegion?.let { flyTo(it, animated = false) }
    }

    internal fun setChrome(wide: Boolean, peekDp: Double, coveredDp: Double) {
        this.peekDp = peekDp
        val msg = AroundGlobeBridge.chromeMessage(wide, peekDp, coveredDp)
        if (msg == chromeMessage) return
        chromeMessage = msg
        send(msg)
    }

    internal fun setReducedMotion(reduced: Boolean) {
        if (reduced == reducedMotion) return
        reducedMotion = reduced
        send(AroundGlobeBridge.motionMessage(reduced))
    }

    internal fun setPlaces(message: String) {
        if (message == placesMessage) return
        placesMessage = message
        send(message)
    }

    internal fun select(id: String?, area: String?) {
        val msg = AroundGlobeBridge.selectMessage(id, area)
        if (msg == selectMessage) return
        selectMessage = msg
        send(msg)
    }

    internal fun setYou(location: AroundCoordinate?) {
        if (location == you) return
        you = location
        send(AroundGlobeBridge.youMessage(location))
    }

    internal fun attach(view: WebView) {
        webView = view
        ready = false
    }

    internal fun detach(view: WebView) {
        if (webView === view) {
            webView = null
            ready = false
        }
    }

    internal fun rendererGone(view: WebView) {
        detach(view)
        generation += 1
    }

    /** Handles one page event on the main thread. */
    internal fun handle(event: AroundGlobeEvent) {
        when (event) {
            AroundGlobeEvent.Ready -> {
                ready = true
                isUnavailable = false
                // The screen around the map first (the camera's padding depends on it), then the
                // camera the page opens on, the pins, the selection and the "you" dot.
                chromeMessage?.let { send(it) }
                send(AroundGlobeBridge.motionMessage(reducedMotion))
                val cam = pendingRegion?.takeIf { widthDp > 0 && heightDp > 0 }
                    ?.let { AroundGlobeBridge.cameraFor(it, widthDp, heightDp, wide) }
                    ?: camera
                    ?: AroundGlobeBridge.globeCamera(wide)
                pendingRegion = null
                send(AroundGlobeBridge.flyToMessage(cam, animate = false))
                placesMessage?.let { send(it) }
                send(selectMessage)
                send(AroundGlobeBridge.youMessage(you))
            }
            is AroundGlobeEvent.PlaceTapped -> onPlaceTapped(event.id)
            is AroundGlobeEvent.CameraIdle -> {
                camera = event.camera
                lastCamera = event.camera
                region = AroundGlobeBridge.regionFor(event.camera, event.bounds)
                cameraTick += 1
            }
            is AroundGlobeEvent.Streets -> Unit
            is AroundGlobeEvent.Fallback -> isUnavailable = true
            is AroundGlobeEvent.CityTapped -> onCityTapped(event.slug)
        }
    }

    internal fun resumeView() {
        webView?.onResume()
    }

    internal fun pauseView() {
        webView?.onPause()
    }

    private fun send(message: String) {
        val view = webView ?: return
        if (!ready) return
        view.evaluateJavascript(AroundGlobeBridge.script(message), null)
    }

    companion object {
        /** Where the globe was when Around was left, so coming back restores it (website `rememberedCamera`). */
        internal var lastCamera: AroundGlobeCamera? = null
    }
}

/** `window.YardAndroid`: the page's only way back. Called on the WebView's binder thread. */
private class AroundGlobeJsInterface(private val controller: AroundMapController) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun post(message: String) {
        val event = AroundGlobeBridge.parse(message) ?: return
        main.post { controller.handle(event) }
    }
}

@SuppressLint("SetJavaScriptEnabled") // The page is our own bundled asset; navigation elsewhere is blocked.
private fun makeAroundGlobeView(context: Context, controller: AroundMapController): WebView {
    val loader = WebViewAssetLoader.Builder()
        .setDomain(AroundGlobeBridge.ASSET_HOST)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()
    return WebView(context).apply {
        setBackgroundColor(GlobeSpace.toArgb())
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = WebView.OVER_SCROLL_NEVER
        settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            setGeolocationEnabled(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        addJavascriptInterface(AroundGlobeJsInterface(controller), AroundGlobeBridge.JS_INTERFACE)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // The globe never navigates; links and redirects go nowhere.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                controller.rendererGone(view)
                return true
            }
        }
        controller.attach(this)
        loadUrl(AroundGlobeBridge.PAGE_URL)
    }
}

/**
 * The website's dark globe: a brand-mark pin per place (clustered when close; purple ring when
 * selected; the kind dot acid when live), neighbourhood rings and names, city coastlines, the
 * title, credits and scale bar, and the shopper's dot. Tapping a pin calls [onSelect]; a city on
 * the simplified no-WebGL map calls [onCity].
 */
@Composable
fun AroundMap(
    controller: AroundMapController,
    places: List<AroundPlace>,
    selectedId: String?,
    /** The open place's area (the title names it while the place is open), else null. */
    selectedArea: String?,
    now: Instant,
    userLocation: AroundCoordinate?,
    onSelect: (AroundPlace) -> Unit,
    modifier: Modifier = Modifier,
    onCity: (String) -> Unit = {},
) {
    val density = LocalDensity.current
    controller.wide = LocalYardWindow.current.isExpanded
    val currentPlaces by rememberUpdatedState(places)
    val currentOnSelect by rememberUpdatedState(onSelect)
    val currentOnCity by rememberUpdatedState(onCity)
    controller.onPlaceTapped = { id -> currentPlaces.firstOrNull { it.id == id }?.let { currentOnSelect(it) } }
    controller.onCityTapped = { slug -> currentOnCity(slug) }
    val context = LocalContext.current
    // System "Remove animations" → the page's reduced motion (jumps instead of flights, no pin lift easing).
    val reduceMotion = remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    controller.setReducedMotion(reduceMotion)

    Box(
        modifier
            .clipToBounds()
            .background(GlobeSpace)
            .onSizeChanged { size ->
                with(density) { controller.setSize(size.width.toDp().value.toDouble(), size.height.toDp().value.toDouble()) }
            },
    ) {
        if (LocalInspectionMode.current) {
            AroundGlobePlaceholder(Modifier.fillMaxSize())
        } else {
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            key(controller.generation) {
                AndroidView(
                    factory = { ctx -> makeAroundGlobeView(ctx, controller) },
                    modifier = Modifier.fillMaxSize(),
                    onRelease = { view ->
                        controller.detach(view)
                        view.removeJavascriptInterface(AroundGlobeBridge.JS_INTERFACE)
                        view.destroy()
                    },
                )
            }
            DisposableEffect(lifecycle, controller) {
                val pauser = LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_RESUME -> controller.resumeView()
                        Lifecycle.Event.ON_PAUSE -> controller.pauseView()
                        else -> Unit
                    }
                }
                lifecycle.addObserver(pauser)
                onDispose {
                    lifecycle.removeObserver(pauser)
                }
            }
        }
    }

    // Pins: encoded off the main thread; the page skips re-tiling when nothing changed.
    LaunchedEffect(places, now) {
        val message = withContext(Dispatchers.Default) { AroundGlobeBridge.placesMessage(places, now) }
        controller.setPlaces(message)
    }
    LaunchedEffect(selectedId, selectedArea) { controller.select(selectedId, selectedArea) }
    LaunchedEffect(userLocation) { controller.setYou(userLocation) }
}

/** Previews have no WebView: the globe as a dark disc with its grey rim. */
@Composable
private fun AroundGlobePlaceholder(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val r = min(size.width, size.height) * 0.42f
        val c = Offset(size.width / 2, size.height * 0.4f)
        drawCircle(GlobeOcean, r, c)
        drawCircle(GlobeRim, r, c, style = Stroke(1.dp.toPx()))
    }
}
