package space.yardstore.app.features.around

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.YardJson
import java.time.Instant
import kotlin.math.PI
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.tan

// The typed message API between Kotlin and the globe page (assets/around/globe.js). Pure functions,
// so the encoding, parsing and camera maths are unit tested without a WebView.
//
//   Kotlin → JS  window.yardGlobe.receive(<message>)
//     {"type":"places","places":[{id,lat,lng,brand,mark,logo,kind,area,status,sample}]}
//     {"type":"select","id":"loc_1"|null}
//     {"type":"flyTo","lat":6.45,"lng":3.43,"zoom":12.3,"animate":true}
//     {"type":"you","lat":…,"lng":…}  or  {"type":"you"} to remove the dot
//   JS → Kotlin  YardAndroid.post("<json>")
//     ready · placeTapped{id} · cameraIdle{lat,lng,zoom,west,south,east,north,user} ·
//     streets{state} · fallback{reason}

/** A MapLibre camera: centre and zoom (website `Camera`). */
data class AroundGlobeCamera(val latitude: Double, val longitude: Double, val zoom: Double)

/** Bounds of the visible map in degrees (west may exceed east across the antimeridian). */
data class AroundGlobeBounds(val west: Double, val south: Double, val east: Double, val north: Double)

/** What the globe page tells Kotlin. */
sealed interface AroundGlobeEvent {
    /** The page's script is running: Kotlin replays places, selection, the "you" dot and the camera. */
    data object Ready : AroundGlobeEvent

    data class PlaceTapped(val id: String) : AroundGlobeEvent

    /** The camera came to rest (`moveend`); [user] when a gesture moved it. */
    data class CameraIdle(val camera: AroundGlobeCamera, val bounds: AroundGlobeBounds, val user: Boolean) : AroundGlobeEvent

    /** OpenFreeMap streets loaded ("ready") or the bundled map stays ("failed"). */
    data class Streets(val ready: Boolean) : AroundGlobeEvent

    /** No WebGL 2, or the bundled data didn't load: the page can't draw a map. */
    data class Fallback(val reason: String) : AroundGlobeEvent
}

object AroundGlobeBridge {
    /** The page, served by WebViewAssetLoader from `assets/around/`. */
    const val PAGE_URL = "https://appassets.androidplatform.net/assets/around/index.html"
    const val ASSET_HOST = "appassets.androidplatform.net"
    /** The name of the JavaScript interface object (`window.YardAndroid`). */
    const val JS_INTERFACE = "YardAndroid"

    /** The globe the screen opens on: Africa and Europe (website `GLOBE_CAMERA`; wide screens 2.1). */
    fun globeCamera(wide: Boolean): AroundGlobeCamera = AroundGlobeCamera(12.0, 15.0, if (wide) 2.1 else 1.6)

    const val MIN_ZOOM = 0.8
    /** The bundled map's limit; streets allow 18, and the page clamps to whatever it has. */
    const val MAX_ZOOM = 18.0
    /** Below this the camera shows a whole globe: every place counts as in view. */
    const val GLOBE_ZOOM = 3.0

    // region Kotlin → JS

    /** The pin's kind dot (website `pinStatus`): store ink, showroom grey, a live dated place acid, else upcoming. */
    fun pinStatus(place: AroundPlace, now: Instant): String = when (place.kind) {
        AroundPlaceKind.Store -> "store"
        AroundPlaceKind.Showroom -> "showroom"
        else -> if (AroundTime.timedStatus(place.startsAt, place.endsAt, now) == AroundTime.Timed.Live) "live" else "upcoming"
    }

    /** One pin for the page: absolute logo URL (or null for the monogram), mark, labels and status. */
    fun placeJson(place: AroundPlace, logoUrl: String?, now: Instant): JsonObject = buildJsonObject {
        put("id", place.id)
        put("lat", place.lat)
        put("lng", place.lng)
        put("brand", place.brand.name)
        put("mark", BrandCard.monogram(place.brand.name))
        put("logo", Config.url(logoUrl)?.let { JsonPrimitive(it) } ?: JsonNull)
        put("kind", place.kind.label)
        put("area", place.neighbourhood?.takeIf { it.isNotEmpty() } ?: place.city)
        put("status", pinStatus(place, now))
        put("sample", place.sample)
    }

    fun placesMessage(places: List<AroundPlace>, logoUrl: (AroundPlace) -> String?, now: Instant): String = buildJsonObject {
        put("type", "places")
        put("places", buildJsonArray { for (p in places) add(placeJson(p, logoUrl(p), now)) })
    }.toString()

    fun selectMessage(id: String?): String = buildJsonObject {
        put("type", "select")
        put("id", id?.let { JsonPrimitive(it) } ?: JsonNull)
    }.toString()

    fun flyToMessage(camera: AroundGlobeCamera, animate: Boolean): String = buildJsonObject {
        put("type", "flyTo")
        put("lat", camera.latitude)
        put("lng", camera.longitude)
        put("zoom", camera.zoom)
        put("animate", animate)
    }.toString()

    fun youMessage(you: AroundCoordinate?): String = buildJsonObject {
        put("type", "you")
        if (you != null) {
            put("lat", you.latitude)
            put("lng", you.longitude)
        }
    }.toString()

    /** The script that hands [message] (a JSON object, which is also a JS literal) to the page. */
    fun script(message: String): String = "window.yardGlobe&&window.yardGlobe.receive($message)"

    // endregion

    // region JS → Kotlin

    /** Parses one message from the page; null for anything malformed or unknown. */
    fun parse(raw: String): AroundGlobeEvent? {
        val obj = runCatching { YardJson.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
        fun str(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
        fun num(key: String) = (obj[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }
        return when (str("type")) {
            "ready" -> AroundGlobeEvent.Ready
            "placeTapped" -> str("id")?.takeIf { it.isNotEmpty() }?.let { AroundGlobeEvent.PlaceTapped(it) }
            "cameraIdle" -> {
                val lat = num("lat") ?: return null
                val lng = num("lng") ?: return null
                val zoom = num("zoom") ?: return null
                val bounds = AroundGlobeBounds(
                    west = num("west") ?: return null,
                    south = num("south") ?: return null,
                    east = num("east") ?: return null,
                    north = num("north") ?: return null,
                )
                AroundGlobeEvent.CameraIdle(AroundGlobeCamera(lat, lng, zoom), bounds, (obj["user"] as? JsonPrimitive)?.booleanOrNull ?: false)
            }
            "streets" -> AroundGlobeEvent.Streets(str("state") == "ready")
            "fallback" -> AroundGlobeEvent.Fallback(str("reason") ?: "error")
            else -> null
        }
    }

    // endregion

    // region Camera mapping

    /**
     * The list's region for a camera at rest. A whole globe (zoom < [GLOBE_ZOOM]) counts as the
     * world, so places on the far side stay in the list; closer in, the visible bounds.
     */
    fun regionFor(camera: AroundGlobeCamera, bounds: AroundGlobeBounds): AroundRegion {
        val center = AroundCoordinate(camera.latitude, camera.longitude)
        if (camera.zoom < GLOBE_ZOOM) return AroundRegion(center, 180.0, 360.0)
        var lngDelta = bounds.east - bounds.west
        if (lngDelta < 0) lngDelta += 360.0
        val latDelta = (bounds.north - bounds.south).coerceIn(0.0, 180.0)
        return AroundRegion(center, latDelta, lngDelta.coerceIn(0.0, 360.0))
    }

    private fun mercY(lat: Double): Double = ln(tan(PI / 4 + Math.toRadians(lat.coerceIn(-85.0, 85.0)) / 2))

    /**
     * The camera that frames [region] in a map [widthDp] × [heightDp] (CSS px = dp in the WebView),
     * as the website's `fitPoints` does: MapLibre's world is 512·2^z px wide. A region spanning most
     * of the world is the opening globe.
     */
    fun cameraFor(region: AroundRegion, widthDp: Double, heightDp: Double, wide: Boolean = false): AroundGlobeCamera {
        if (region.longitudeDelta >= 300.0 || region.latitudeDelta >= 150.0) {
            return globeCamera(wide).copy(latitude = region.center.latitude.coerceIn(-60.0, 60.0), longitude = region.center.longitude)
        }
        val w = widthDp.takeIf { it > 0 } ?: 360.0
        val h = heightDp.takeIf { it > 0 } ?: 640.0
        val lngSpan = region.longitudeDelta.coerceAtLeast(1e-6)
        val north = region.center.latitude + region.latitudeDelta / 2
        val south = region.center.latitude - region.latitudeDelta / 2
        val ySpan = (mercY(north) - mercY(south)).coerceAtLeast(1e-9)
        val zx = log2(w * 360.0 / (512.0 * lngSpan))
        val zy = log2(h * 2 * PI / (512.0 * ySpan))
        val zoom = (minOf(zx, zy) * 20).toInt() / 20.0
        return AroundGlobeCamera(region.center.latitude, region.center.longitude, zoom.coerceIn(MIN_ZOOM, MAX_ZOOM))
    }

    // endregion
}

