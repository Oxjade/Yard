package space.yardstore.app.features.search

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError

/**
 * Type-ahead state for the Search tab: the live brand/product matches for what is typed (like the
 * website's search overlay: /api/search with limit 6 after a short debounce, 2+ characters), and
 * the marketplace categories (for "Try" chips and on-device category matches).
 * Mirrors `SearchLiveModel.swift`; the debounce (`.task(id:)` + sleep on iOS) lives here in
 * [update], so each keystroke cancels the previous request.
 */
class SearchLiveModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    /** The term the current results (or error) belong to. */
    var term by mutableStateOf(""); private set
    var phase by mutableStateOf<Phase>(Phase.Idle); private set
    var products by mutableStateOf<List<SearchItem>>(emptyList()); private set
    var brands by mutableStateOf<List<SearchBrandHit>>(emptyList()); private set
    var total by mutableStateOf(0); private set

    /** Live categories (with public product counts). Empty until loaded or if it fails. */
    var categories by mutableStateOf<List<SearchCategory>>(emptyList()); private set
    private var categoriesLoaded = false
    private var categoriesJob: Job? = null

    /** Previews only: never touch the network. */
    var skipsNetwork = false

    private var searchJob: Job? = null
    private var searchedCurrency: String? = null

    /** "Try" chips: the categories that hold public pieces, most first, so each one finds something. */
    val tries: List<SearchCategory>
        get() = categories
            .filter { (it.productCount ?: 0) > 0 }
            .sortedByDescending { it.productCount ?: 0 }
            .take(6)

    /** Categories whose name contains the term (on device). */
    fun matchingCategories(term: String): List<SearchCategory> {
        val needle = term.trim().lowercase()
        if (needle.isEmpty()) return emptyList()
        return categories.filter { it.name.lowercase().contains(needle) }.take(3)
    }

    fun loadCategories() {
        if (categoriesLoaded || skipsNetwork || categoriesJob?.isActive == true) return
        categoriesJob = viewModelScope.launch {
            try {
                categories = api.get<SearchCategoriesResponse>("/api/catalog/categories").categories
                categoriesLoaded = true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Categories only add chips; Search works without them.
            }
        }
    }

    /** Clears results (field emptied or below the minimum length). */
    fun reset() {
        searchJob?.cancel()
        term = ""
        phase = Phase.Idle
        products = emptyList()
        brands = emptyList()
        total = 0
    }

    /**
     * The field changed: searches [rawTerm] after [debounceMillis] (cancelling any earlier call).
     * Below the minimum length it resets. Results already loaded for the same term and currency
     * are kept (e.g. coming back from a product).
     */
    fun update(rawTerm: String, currency: String, debounceMillis: Long = DEBOUNCE_MILLIS) {
        val trimmed = rawTerm.trim()
        if (trimmed.length < MINIMUM_LENGTH) {
            reset()
            return
        }
        if (skipsNetwork) return
        if (trimmed == term && currency == searchedCurrency && phase == Phase.Loaded) return
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            if (debounceMillis > 0) delay(debounceMillis)
            search(trimmed, currency)
        }
    }

    /** Searches now (the inline Retry). */
    fun retry(rawTerm: String, currency: String) = update(rawTerm, currency, debounceMillis = 0)

    private suspend fun search(trimmed: String, currency: String) {
        if (term != trimmed) {
            term = trimmed
            products = emptyList()
            brands = emptyList()
            total = 0
        }
        phase = Phase.Loading
        try {
            val response = api.get<SearchResponse>(
                "/api/search",
                listOf("q" to trimmed, "currency" to currency, "limit" to "6"),
            )
            if (term != trimmed) return
            products = response.items
            brands = response.brands
            total = response.total
            searchedCurrency = currency
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (term != trimmed) return
            if (e is APIError && e.isCancelled) return
            phase = Phase.Failed(message(e))
        }
    }

    companion object {
        /** Minimum characters before searching the marketplace (matches the website). */
        const val MINIMUM_LENGTH = 2
        const val DEBOUNCE_MILLIS = 220L

        fun message(error: Throwable): String =
            APIError.messageFor(error).ifEmpty { "Search couldn't be loaded." }

        /** Previews only. */
        fun preview(term: String, products: List<SearchItem>, brands: List<SearchBrandHit>, categories: List<SearchCategory>): SearchLiveModel =
            SearchLiveModel().apply {
                skipsNetwork = true
                this.term = term
                this.products = products
                this.brands = brands
                this.total = products.size
                this.categories = categories
                categoriesLoaded = true
                phase = if (term.isEmpty()) Phase.Idle else Phase.Loaded
            }
    }
}
