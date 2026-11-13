package space.yardstore.app.features.charts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.Query
import java.text.Normalizer

/** The board the shopper is looking at (the website keeps the same fields in the URL). */
data class ChartsQuery(
    val chart: ChartSlug = ChartSlug.Top,
    val period: ChartPeriod = ChartPeriod.Weekly,
    val category: String? = null,
    val country: String? = null,
    val city: String? = null,
) {
    /** Query items in the website's fixed order (`boardPath` in src/lib/api/charts.ts). */
    val queryItems: Query
        get() = buildList {
            add("chart" to chart.rawValue)
            add("period" to period.rawValue)
            if (category != null) add("category" to category)
            if (city != null) add("city" to city) else if (country != null) add("country" to country)
        }

    /** Number of filters set (City charts' city is part of the board, not a filter). */
    val filterCount: Int
        get() = (if (category != null) 1 else 0) + (if ((city != null || country != null) && chart != ChartSlug.City) 1 else 0)
}

/** Loads the live board and the scopes; the view keeps the board fresh while it is on screen. */
class ChartsViewModel(
    query: ChartsQuery = ChartsQuery(),
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    var query by mutableStateOf(query); private set
    /** The board for `query` (never another board's answer under the new name). */
    private var board by mutableStateOf<ChartBoard?>(null)
    var scopes by mutableStateOf<ChartScopes?>(null); private set
    var isLoading by mutableStateOf(false); private set
    /** A load of a board we don't have yet failed. */
    var error by mutableStateOf<Throwable?>(null); private set
    /** A refresh of the board on screen failed; the board stays with a quiet note. */
    var refreshFailed by mutableStateOf(false); private set
    /** City charts with no city chosen: the shopper's default city (applied to the request only). */
    var defaultCity by mutableStateOf<String?>(null); private set
    /** Pull to refresh in flight. */
    var isRefreshing by mutableStateOf(false); private set

    private var loadedFor by mutableStateOf<ChartsQuery?>(null)
    private var generation = 0

    /** The query actually sent (City charts with no city use the shopper's default city). */
    val effectiveQuery: ChartsQuery
        get() {
            val d = defaultCity
            return if (query.chart == ChartSlug.City && query.city == null && d != null) query.copy(city = d, country = null) else query
        }

    /** The board on screen, only while it is the board the query asks for. */
    val currentBoard: ChartBoard?
        get() = if (loadedFor == effectiveQuery) board else null

    val minCohort: Int get() = scopes?.minCohort ?: 3

    // region Loading

    suspend fun loadScopes() {
        if (scopes != null) return
        try {
            scopes = api.get<ChartScopes>("/api/charts/scopes")
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Filters stay limited to "Everywhere"; the board still loads.
        }
    }

    /** Loads the board for the current query. A board already on screen stays while it refreshes. */
    suspend fun load() {
        val q = effectiveQuery
        generation += 1
        val gen = generation
        val sameBoard = loadedFor == q && board != null
        if (!sameBoard) {
            isLoading = true
            error = null
        }
        try {
            val b = api.get<ChartBoard>("/api/charts", q.queryItems)
            if (gen != generation) return
            board = b
            loadedFor = q
            error = null
            refreshFailed = false
        } catch (e: CancellationException) {
            if (gen == generation) isLoading = false
            throw e
        } catch (e: Exception) {
            if (gen != generation) return
            if (e is APIError && e.isCancelled) { isLoading = false; return }
            if (sameBoard) refreshFailed = true else error = e
        }
        isLoading = false
    }

    /** Retry buttons. */
    fun reload() {
        viewModelScope.launch { load() }
    }

    /** Pull to refresh. */
    fun refresh() {
        viewModelScope.launch {
            isRefreshing = true
            try { load() } finally { isRefreshing = false }
        }
    }

    /** Applies a new board/period/filter choice. The view's effect keyed on `effectiveQuery` loads it. */
    fun apply(next: ChartsQuery) {
        // City charts take a city, never a country.
        val n = if (next.chart == ChartSlug.City) next.copy(country = null) else next
        if (n == query) return
        query = n
    }

    /**
     * Picks the shopper's default city for City charts: the ship-to city when it has a chart,
     * else the largest charted city in the ship-to country. Null lets the server choose (largest cohort).
     */
    fun resolveDefaultCity(shipToCity: String?, shipToCountry: String?) {
        val s = scopes ?: run { defaultCity = null; return }
        val charted = s.cities.filter { it.eligible >= s.minCohort }
        val name = shipToCity?.trim().orEmpty()
        if (name.isNotEmpty()) {
            val key = chartsFold(name)
            charted.firstOrNull { chartsFold(it.name) == key }?.let { defaultCity = it.slug; return }
        }
        val country = shipToCountry?.uppercase()
        if (country != null) {
            charted.filter { it.country.uppercase() == country }.maxByOrNull { it.eligible }?.let { defaultCity = it.slug; return }
        }
        defaultCity = null
    }

    // endregion

    // region Words

    /** "Everywhere", "Lagos", "Streetwear in Nigeria", "Streetwear, everywhere". */
    fun whereWords(): String? {
        val place: String?
        val category: String?
        val b = currentBoard
        if (b != null) {
            place = b.scope.city?.name ?: b.scope.country?.name
            category = b.scope.category?.label
        } else {
            val q = effectiveQuery
            place = when {
                q.city != null -> scopes?.cities?.firstOrNull { it.slug == q.city }?.name
                q.country != null -> scopes?.countries?.firstOrNull { it.code == q.country }?.name
                else -> null
            }
            category = q.category?.let { slug -> scopes?.categories?.firstOrNull { it.slug == slug }?.label }
        }
        return when {
            category != null && place != null -> "$category in $place"
            category != null -> "$category, everywhere"
            place != null -> place
            query.chart == ChartSlug.City -> null
            else -> "Everywhere"
        }
    }

    /** The location pill's title. */
    val locationTitle: String
        get() {
            val q = effectiveQuery
            if (q.city != null) {
                return currentBoard?.scope?.city?.name ?: scopes?.cities?.firstOrNull { it.slug == q.city }?.name ?: "City"
            }
            if (q.country != null) {
                return scopes?.countries?.firstOrNull { it.code == q.country }?.name ?: q.country
            }
            if (q.chart == ChartSlug.City) return currentBoard?.scope?.city?.name ?: "Choose a city"
            return "Everywhere"
        }

    // endregion
}

/** Case- and diacritic-insensitive key (Swift `compare(_:options: [.caseInsensitive, .diacriticInsensitive])`). */
private fun chartsFold(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
