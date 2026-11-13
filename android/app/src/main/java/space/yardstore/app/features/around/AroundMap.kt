package space.yardstore.app.features.around

import android.content.Context
import android.graphics.Canvas
import android.graphics.Point
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.material3.Text
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.Projection
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.TilesOverlay
import space.yardstore.app.BuildConfig
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import java.io.File
import java.time.Instant
import kotlin.math.roundToInt

// ANDROID-ONLY: iOS uses MapKit's `Map` with SwiftUI `Annotation`s. Here an osmdroid MapView
// (OpenStreetMap tiles, no API key) sits under a Compose layer that places the same brand pins
// at the projected coordinates, so pins are real composables (BrandAvatar, Coil logos, ripples).

/** Drives the osmdroid map from Compose (iOS `MapCameraPosition` + `onMapCameraChange`). */
@Stable
class AroundMapController {
    internal var mapView: MapView? = null
        set(value) {
            field = value
            if (value != null) pending?.let { run -> runWhenLaidOut(value, run) }
            pending = null
        }

    /** Bumped whenever the camera moves (every frame of a pan, zoom or animation). */
    var cameraTick by mutableIntStateOf(0)
        internal set

    private var pending: ((MapView) -> Unit)? = null

    /** The visible region, or null before the map has been laid out. */
    fun currentRegion(): AroundRegion? {
        val map = mapView ?: return null
        if (!map.isLayoutOccurred || map.width == 0) return null
        val box = map.boundingBox
        var lngDelta = box.lonEast - box.lonWest
        if (lngDelta < 0) lngDelta += 360.0
        val center = map.mapCenter
        return AroundRegion(
            AroundCoordinate(center.latitude, center.longitude),
            latitudeDelta = (box.latNorth - box.latSouth).coerceAtLeast(0.0),
            longitudeDelta = lngDelta,
        )
    }

    /** Animates the camera to show [region] (iOS `withAnimation { position = .region(r) }`). */
    fun flyTo(region: AroundRegion, animated: Boolean = true) {
        val run: (MapView) -> Unit = { map ->
            val maxLat = 85.0
            val north = (region.center.latitude + region.latitudeDelta / 2).coerceIn(-maxLat, maxLat)
            val south = (region.center.latitude - region.latitudeDelta / 2).coerceIn(-maxLat, maxLat)
            val (west, east) = if (region.longitudeDelta >= 359.0) {
                -180.0 to 180.0
            } else {
                (region.center.longitude - region.longitudeDelta / 2).coerceIn(-180.0, 180.0) to
                    (region.center.longitude + region.longitudeDelta / 2).coerceIn(-180.0, 180.0)
            }
            runCatching {
                map.zoomToBoundingBox(BoundingBox(north, east, south, west), animated, 0, MAX_ZOOM, if (animated) 650L else null)
            }
        }
        val map = mapView
        if (map == null) pending = run else runWhenLaidOut(map, run)
    }

    /** The map view pixel for a coordinate, or null without a map. */
    internal fun toPixels(c: AroundCoordinate, out: Point): Point? {
        val map = mapView ?: return null
        if (!map.isLayoutOccurred) return null
        return runCatching { map.projection.toPixels(GeoPoint(c.latitude, c.longitude), out) }.getOrNull()
    }

    private fun runWhenLaidOut(map: MapView, run: (MapView) -> Unit) {
        if (map.isLayoutOccurred && map.width > 0) run(map) else map.addOnFirstLayoutListener { _, _, _, _, _ -> run(map) }
    }

    companion object {
        const val MIN_ZOOM = 2.0
        const val MAX_ZOOM = 19.0
    }
}

/** Bumps [AroundMapController.cameraTick] whenever the projection changed since the last frame. */
private class AroundCameraWatcher(private val controller: AroundMapController) : Overlay() {
    private var lastLat = Double.NaN
    private var lastLng = Double.NaN
    private var lastZoom = Double.NaN
    private var lastW = -1
    private var lastH = -1

    override fun draw(canvas: Canvas, projection: Projection) {
        val center = projection.currentCenter
        val zoom = projection.zoomLevel
        val w = projection.width
        val h = projection.height
        if (center.latitude != lastLat || center.longitude != lastLng || zoom != lastZoom || w != lastW || h != lastH) {
            lastLat = center.latitude
            lastLng = center.longitude
            lastZoom = zoom
            lastW = w
            lastH = h
            controller.cameraTick += 1
        }
    }
}

private fun makeAroundMapView(context: Context, controller: AroundMapController): MapView {
    Configuration.getInstance().apply {
        load(context, context.getSharedPreferences("osmdroid", Context.MODE_PRIVATE))
        userAgentValue = BuildConfig.APPLICATION_ID
        osmdroidBasePath = File(context.cacheDir, "osmdroid")
        osmdroidTileCache = File(context.cacheDir, "osmdroid/tiles")
    }
    return MapView(context).apply {
        setTileSource(TileSourceFactory.MAPNIK)
        setMultiTouchControls(true)
        zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
        setTilesScaledToDpi(true)
        setMinZoomLevel(AroundMapController.MIN_ZOOM)
        setMaxZoomLevel(AroundMapController.MAX_ZOOM)
        setVerticalMapRepetitionEnabled(false)
        setScrollableAreaLimitLatitude(MapView.getTileSystem().maxLatitude, MapView.getTileSystem().minLatitude, 0)
        this.controller.setZoom(AroundMapController.MIN_ZOOM)
        this.controller.setCenter(GeoPoint(20.0, 0.0))
        overlays.add(AroundCameraWatcher(controller))
    }
}

/**
 * The map with a pin per place (acid ring when selected, acid dot when open/live) and the
 * shopper's dot. Tapping a pin calls [onSelect].
 */
@Composable
fun AroundMap(
    controller: AroundMapController,
    places: List<AroundPlace>,
    logoUrl: (AroundPlace) -> String?,
    selectedId: String?,
    now: Instant,
    userLocation: AroundCoordinate?,
    onSelect: (AroundPlace) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = Color.yard.isDark
    val bg = Color.yard.bg.toArgb()
    val line = Color.yard.line.toArgb()
    Box(modifier.clipToBounds()) {
        if (LocalInspectionMode.current) {
            Box(Modifier.fillMaxSize().background(Color.yard.surface2))
        } else {
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            AndroidView(
                factory = { ctx -> makeAroundMapView(ctx, controller).also { controller.mapView = it } },
                modifier = Modifier.fillMaxSize(),
                update = { map ->
                    map.overlayManager.tilesOverlay.setColorFilter(if (isDark) TilesOverlay.INVERT_COLORS else null)
                    map.overlayManager.tilesOverlay.loadingBackgroundColor = bg
                    map.overlayManager.tilesOverlay.loadingLineColor = line
                    map.invalidate()
                },
                onRelease = { map ->
                    if (controller.mapView === map) controller.mapView = null
                    map.onDetach()
                },
            )
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_RESUME -> controller.mapView?.onResume()
                        Lifecycle.Event.ON_PAUSE -> controller.mapView?.onPause()
                        else -> Unit
                    }
                }
                lifecycle.addObserver(observer)
                onDispose { lifecycle.removeObserver(observer) }
            }
        }

        // Pins, placed at their projected coordinates (anchor: bottom centre); the selected one on top.
        val point = remember { Point() }
        Layout(
            content = {
                for (place in places) {
                    key(place.id) {
                        AroundPin(
                            name = place.brand.name,
                            logoUrl = logoUrl(place),
                            isSelected = place.id == selectedId,
                            isOpen = AroundTime.isOpenNow(place, now),
                            modifier = Modifier.pressableClick(onClickLabel = "Show ${place.brand.name}") { onSelect(place) },
                        )
                    }
                }
                if (userLocation != null) AroundUserDot()
            },
            modifier = Modifier.fillMaxSize(),
        ) { measurables, constraints ->
            val placeables = measurables.map { it.measure(Constraints()) }
            layout(constraints.maxWidth, constraints.maxHeight) {
                @Suppress("UNUSED_VARIABLE")
                val tick = controller.cameraTick // re-place on every camera move
                val inPreview = controller.mapView == null
                places.forEachIndexed { i, place ->
                    val p = placeables.getOrNull(i) ?: return@forEachIndexed
                    val px = if (inPreview) {
                        previewPoint(place, i, constraints)
                    } else {
                        controller.toPixels(place.coordinate, point)?.let { it.x to it.y } ?: return@forEachIndexed
                    }
                    p.place(px.first - p.width / 2, px.second - p.height, zIndex = if (place.id == selectedId) 1f else 0f)
                }
                if (userLocation != null) {
                    val dot = placeables.lastOrNull()
                    val px = controller.toPixels(userLocation, point)
                    if (dot != null && px != null) dot.place(px.x - dot.width / 2, px.y - dot.height / 2, zIndex = 0.5f)
                }
            }
        }

        // OpenStreetMap's licence asks for visible attribution.
        Text(
            "© OpenStreetMap contributors",
            style = YardFonts.micro,
            color = Color.yard.ink2,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(Spacing.s)
                .background(Color.yard.surface.copy(alpha = 0.8f), YardShapes.pill)
                .padding(horizontal = Spacing.s, vertical = 2.dp),
        )
    }
}

/** Previews have no map: spread the pins over the top half so they can be seen. */
private fun previewPoint(place: AroundPlace, index: Int, constraints: Constraints): Pair<Int, Int> {
    val w = constraints.maxWidth.takeIf { it != Constraints.Infinity } ?: 1000
    val h = constraints.maxHeight.takeIf { it != Constraints.Infinity } ?: 1000
    val x = (w * (0.3f + 0.4f * (index % 2))).roundToInt()
    val y = (h * (0.22f + 0.08f * (index % 3))).roundToInt() + (place.lat.toInt() % 3)
    return x to y
}
