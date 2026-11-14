package space.yardstore.app.features.around

import android.content.Context
import kotlinx.serialization.Serializable
import space.yardstore.app.core.models.YardJson
import java.text.Normalizer
import java.util.Locale
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

// The website's gazetteer and area cameras (src/lib/around/gazetteer.ts, geo.ts) for the globe.
// The data is assets/around/data/gazetteer.json, generated from gazetteer.ts and also read by the
// globe page (rings, names, title), so Kotlin and the page share one list of cities.
//
// Privacy (§5.6): a location fix only ever chooses an *area* camera (a neighbourhood or city
// centroid), never the fix itself; a manual choice of that area lands on the same camera.

@Serializable
data class AroundNeighbourhood(val slug: String, val name: String, val lat: Double, val lng: Double, val aliases: List<String> = emptyList())

@Serializable
data class AroundCity(
    val slug: String,
    val name: String,
    val country: String = "",
    val lat: Double,
    val lng: Double,
    val aliases: List<String> = emptyList(),
    val neighbourhoods: List<AroundNeighbourhood> = emptyList(),
)

@Serializable
private data class GazetteerFile(val cities: List<AroundCity> = emptyList())

/** A city or neighbourhood (website `AreaHit`). */
data class AroundArea(val isCity: Boolean, val slug: String, val name: String, val label: String, val city: AroundCity, val lat: Double, val lng: Double)

/** The part of the map a camera frames, in dp: the map minus the padding kept for the screen's chrome. */
data class AroundFrame(val width: Double, val height: Double)

class AroundGazetteer(val cities: List<AroundCity>) {
    private fun cityHit(c: AroundCity) = AroundArea(true, c.slug, c.name, c.name, c, c.lat, c.lng)
    private fun hoodHit(c: AroundCity, h: AroundNeighbourhood) = AroundArea(false, "${c.slug}/${h.slug}", h.name, "${h.name}, ${c.name}", c, h.lat, h.lng)

    fun city(slug: String): AroundArea? = cities.firstOrNull { it.slug == slug }?.let { cityHit(it) }

    /** Cities and neighbourhoods matching the text (names and aliases, accents ignored), best first (`searchAreas`). */
    fun search(query: String, limit: Int = 8): List<AroundArea> {
        val q = fold(query)
        if (q.isEmpty()) return emptyList()
        fun score(names: List<String>): Int {
            var best = 0
            for (n in names) {
                val f = fold(n)
                best = max(best, if (f == q) 3 else if (f.startsWith(q)) 2 else if (f.contains(q)) 1 else 0)
            }
            return best
        }
        val scored = mutableListOf<Pair<AroundArea, Double>>()
        for (c in cities) {
            val sc = score(listOf(c.name) + c.aliases)
            if (sc > 0) scored += cityHit(c) to sc + 0.5
            for (h in c.neighbourhoods) {
                val sh = score(listOf(h.name) + h.aliases)
                if (sh > 0) scored += hoodHit(c, h) to sh.toDouble()
            }
        }
        return scored.sortedWith(compareByDescending<Pair<AroundArea, Double>> { it.second }.thenBy { it.first.label }).take(limit).map { it.first }
    }

    /** The nearest area within [maxKm]: neighbourhoods and/or cities (`nearestArea`). */
    fun nearest(lat: Double, lng: Double, maxKm: Double, neighbourhoods: Boolean, cities: Boolean): Pair<AroundArea, Double>? {
        var best: Pair<AroundArea, Double>? = null
        for (c in this.cities) {
            if (cities) {
                val km = haversineKm(lat, lng, c.lat, c.lng)
                if (km <= maxKm && (best == null || km < best.second)) best = cityHit(c) to km
            }
            if (neighbourhoods) for (h in c.neighbourhoods) {
                val km = haversineKm(lat, lng, h.lat, h.lng)
                if (km <= maxKm && (best == null || km < best.second)) best = hoodHit(c, h) to km
            }
        }
        return best
    }

    /**
     * The camera a manual area choice and a location fix both use (`areaCamera`): a neighbourhood's
     * centroid at 13.5; a city framed with its neighbourhoods between 10.4 and 11.5, or, where even
     * 10.4 can't fit them, the city's places down to [HOOD_ZOOM].
     */
    fun areaCamera(area: AroundArea, frame: AroundFrame?, places: List<AroundCoordinate> = emptyList()): AroundGlobeCamera {
        if (!area.isCity) return AroundGlobeCamera(area.lat, area.lng, 13.5)
        val pts = listOf(AroundCoordinate(area.city.lat, area.city.lng)) + area.city.neighbourhoods.map { AroundCoordinate(it.lat, it.lng) }
        val city = fitPoints(pts, frame, CITY_ZOOM_MIN)
        if (city.second) return city.first
        val near = places.filter { haversineKm(area.city.lat, area.city.lng, it.latitude, it.longitude) <= areaRadiusKm(area) }
        return if (near.isNotEmpty()) fitPoints(near, frame, HOOD_ZOOM).first else city.first
    }

    /** After a fix: the nearest neighbourhood within 5 km, else city within 60 km, else the fix at zoom 10 (`cameraForFix`). */
    fun cameraForFix(lat: Double, lng: Double, frame: AroundFrame?, places: List<AroundCoordinate> = emptyList()): Pair<AroundGlobeCamera, AroundArea?> {
        nearest(lat, lng, 5.0, neighbourhoods = true, cities = false)?.let { return areaCamera(it.first, frame, places) to it.first }
        nearest(lat, lng, 60.0, neighbourhoods = false, cities = true)?.let { return areaCamera(it.first, frame, places) to it.first }
        return AroundGlobeCamera(lat, lng, 10.0) to null
    }

    companion object {
        const val CITY_ZOOM_MAX = 11.5
        const val CITY_ZOOM_MIN = 10.4
        const val HOOD_ZOOM = 10.2
        private const val FRAME_PAD = 0.012
        const val ASSET = "around/data/gazetteer.json"

        @Volatile private var loaded: AroundGazetteer? = null

        fun parse(json: String): AroundGazetteer =
            AroundGazetteer(runCatching { YardJson.decodeFromString(GazetteerFile.serializer(), json).cities }.getOrDefault(emptyList()))

        /** The bundled gazetteer (read once; empty if the asset is missing). */
        fun get(context: Context): AroundGazetteer = loaded ?: synchronized(this) {
            loaded ?: parse(runCatching { context.assets.open(ASSET).bufferedReader().use { it.readText() } }.getOrDefault("{}")).also { loaded = it }
        }

        fun areaRadiusKm(area: AroundArea): Double = if (area.isCity) 60.0 else 5.0

        fun haversineKm(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
            val r = { d: Double -> d * PI / 180 }
            val dLat = r(bLat - aLat)
            val dLng = r(bLng - aLng)
            val x = sin(dLat / 2) * sin(dLat / 2) + cos(r(aLat)) * cos(r(bLat)) * sin(dLng / 2) * sin(dLng / 2)
            return 2 * 6371 * asin(min(1.0, sqrt(x)))
        }

        private fun mercY(lat: Double) = ln(tan(PI / 4 + lat * PI / 360))
        private fun fromMercY(y: Double) = atan(exp(y)) * 360 / PI - 90
        private fun round5(v: Double) = Math.round(v * 1e5) / 1e5

        /** The camera framing [pts] (plus a ring's radius) in [frame], no further out than [minZoom], and whether they fit. */
        internal fun fitPoints(pts: List<AroundCoordinate>, frame: AroundFrame?, minZoom: Double): Pair<AroundGlobeCamera, Boolean> {
            val west = pts.minOf { it.longitude } - FRAME_PAD
            val east = pts.maxOf { it.longitude } + FRAME_PAD
            val south = pts.minOf { it.latitude } - FRAME_PAD
            val north = pts.maxOf { it.latitude } + FRAME_PAD
            val lat = round5(fromMercY((mercY(south) + mercY(north)) / 2))
            val lng = round5((west + east) / 2)
            if (frame == null || frame.width <= 0 || frame.height <= 0) return AroundGlobeCamera(lat, lng, CITY_ZOOM_MAX) to true
            val zx = log2(frame.width * 360 / (512 * (east - west)))
            val zy = log2(frame.height * 2 * PI / (512 * (mercY(north) - mercY(south))))
            val z = floor(min(zx, zy) * 20) / 20
            return AroundGlobeCamera(lat, lng, min(CITY_ZOOM_MAX, max(minZoom, z))) to (z >= minZoom)
        }

        private val marks = Regex("\\p{Mn}+")
        private val punct = Regex("[^a-z0-9\\u3040-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7af]+")

        /** Lower-case, accents removed, punctuation collapsed (gazetteer.ts `fold`). */
        fun fold(s: String): String =
            Normalizer.normalize(s, Normalizer.Form.NFD).replace(marks, "").lowercase(Locale.ENGLISH).replace(punct, " ").trim()
    }
}
