package space.yardstore.app.features.around

import android.content.Context
import android.location.Address
import android.location.Geocoder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.HTTPMethod
import java.text.Normalizer
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Loads every public place once (`scope=world`, the server's coarse-by-design read; the response
 * is CDN-cached), then filters to the visible map region and sorts by distance on the device.
 * The phone's location never leaves it. Mirrors `AroundViewModel.swift`.
 */
class AroundViewModel(
    private val api: APIClient = APIClient.shared,
    /** Tests only: an absolute origin (MockWebServer) prefixed to the API paths. */
    private val baseUrl: String = "",
) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val error: Throwable) : Phase
    }

    var places by mutableStateOf<List<AroundPlace>>(emptyList()); private set
    var phase by mutableStateOf<Phase>(Phase.Idle); private set

    /** Brand logos by brand id, from the public brand directory (best effort; monograms otherwise). */
    var logos by mutableStateOf<Map<String, String>>(emptyMap()); private set

    private var logosLoaded = false

    /** Preview / fixture constructor. */
    constructor(places: List<AroundPlace>) : this() {
        this.places = places
        this.phase = Phase.Loaded
    }

    val isLoading: Boolean get() = phase is Phase.Loading
    val error: Throwable? get() = (phase as? Phase.Failed)?.error
    val hasLoaded: Boolean get() = phase is Phase.Loaded

    fun place(id: String): AroundPlace? = places.firstOrNull { it.id == id }

    fun logoUrl(place: AroundPlace): String? = logos[place.brand.id]

    // region Loading

    fun load() {
        viewModelScope.launch { loadNow() }
    }

    suspend fun loadNow() {
        if (isLoading) return
        if (places.isEmpty()) phase = Phase.Loading
        try {
            val raw = api.data(HTTPMethod.GET, "$baseUrl/api/around/places", listOf("scope" to "world"))
            val res = withContext(Dispatchers.Default) { AroundPlacesResponse.decode(raw) }
            places = res.places
            phase = Phase.Loaded
            loadLogos()
        } catch (e: CancellationException) {
            if (phase is Phase.Loading) phase = Phase.Idle
            throw e
        } catch (e: Exception) {
            // Keep what's on the map; a refresh failure isn't worth blanking it.
            phase = if (places.isEmpty()) Phase.Failed(e) else Phase.Loaded
        }
    }

    /** Logos for the brands on the map: the public directory, up to three pages of 60. */
    private suspend fun loadLogos() {
        if (logosLoaded || places.isEmpty()) return
        logosLoaded = true
        val wanted = places.map { it.brand.id }.toSet()
        val found = mutableMapOf<String, String>()
        var offset: Int? = 0
        var pages = 0
        while (offset != null && pages < 3 && found.size < wanted.size) {
            pages += 1
            val page: BrandsPage = try {
                api.get("$baseUrl/api/catalog/brands", listOf("limit" to "60", "offset" to offset.toString()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                break
            }
            for (b in page.brands) {
                if (b.id in wanted) b.logoUrl?.let { found[b.id] = it }
            }
            offset = page.nextOffset
        }
        if (found.isNotEmpty()) logos = found
    }

    // endregion

    // region Filtering and sorting

    /**
     * Places inside [region] (all of them when the region is unknown), nearest first from
     * [origin] (the shopper, else the map centre).
     */
    fun visiblePlaces(region: AroundRegion?, origin: AroundCoordinate?): List<AroundPlace> {
        var list = places
        if (region != null) list = list.filter { contains(region, it.coordinate) }
        val ref = origin ?: region?.center
            ?: return list.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.brand.name })
        return list.sortedBy { it.coordinate.distanceTo(ref) }
    }

    // endregion

    // region Search

    /** Places whose city, neighbourhood, country or brand matches the text (accents ignored). */
    fun matches(query: String): List<AroundPlace> {
        val q = fold(query)
        if (q.isEmpty()) return emptyList()
        val byArea = places.filter { p ->
            fold(p.city).contains(q) ||
                fold(p.citySlug.replace("-", " ")).contains(q) ||
                fold(p.neighbourhood.orEmpty()).contains(q) ||
                fold(AroundCountry.name(p.country)) == q
        }
        if (byArea.isNotEmpty()) return byArea
        return places.filter { fold(it.brand.name).contains(q) || fold(it.name).contains(q) }
    }

    /**
     * Where to fly for a search: matching places first, else the device geocoder for any city
     * (iOS uses CLGeocoder). Null when nothing is found or no geocoder is available.
     */
    suspend fun regionForSearch(query: String, context: Context): AroundRegion? {
        val hits = matches(query)
        if (hits.isNotEmpty()) return regionFitting(hits.map { it.coordinate })
        if (!Geocoder.isPresent()) return null
        val address: Address = withContext(Dispatchers.IO) {
            runCatching {
                @Suppress("DEPRECATION")
                Geocoder(context, Locale.getDefault()).getFromLocationName(query, 1)?.firstOrNull()
            }.getOrNull()
        } ?: return null
        if (!address.hasLatitude() || !address.hasLongitude()) return null
        // Android's Address has no radius (iOS reads the placemark's CLCircularRegion): size the
        // view by how precise the match is, within the same 2–400 km bounds.
        val radius: Double = when {
            address.locality != null || address.subLocality != null -> 15_000.0
            address.adminArea != null -> 120_000.0
            else -> 400_000.0
        }
        return AroundRegion.around(AroundCoordinate(address.latitude, address.longitude), radius * 2)
    }

    // endregion

    companion object {
        fun contains(region: AroundRegion, c: AroundCoordinate): Boolean {
            val halfLat = region.latitudeDelta / 2
            val halfLng = region.longitudeDelta / 2
            val dLat = abs(c.latitude - region.center.latitude)
            var dLng = abs(c.longitude - region.center.longitude)
            if (dLng > 180) dLng = 360 - dLng
            return dLat <= halfLat && dLng <= halfLng
        }

        fun regionFitting(coords: List<AroundCoordinate>): AroundRegion? {
            val first = coords.firstOrNull() ?: return null
            var minLat = first.latitude
            var maxLat = first.latitude
            var minLng = first.longitude
            var maxLng = first.longitude
            for (c in coords) {
                minLat = min(minLat, c.latitude)
                maxLat = max(maxLat, c.latitude)
                minLng = min(minLng, c.longitude)
                maxLng = max(maxLng, c.longitude)
            }
            val center = AroundCoordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2)
            return AroundRegion(
                center,
                latitudeDelta = min(170.0, max(0.04, (maxLat - minLat) * 1.6)),
                longitudeDelta = min(350.0, max(0.04, (maxLng - minLng) * 1.6)),
            )
        }

        private val marks = Regex("\\p{Mn}+")

        fun fold(s: String): String =
            Normalizer.normalize(s, Normalizer.Form.NFD).replace(marks, "").lowercase(Locale.ENGLISH).trim()
    }
}
