package space.yardstore.app.features.search

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError

/**
 * "See all results for …": the full search listing, like the website's shop listing with `q=`.
 * It pages /api/search (24 at a time), then loads the full products by id from
 * /api/catalog/products?ids=… so the grid can use `ProductTile` (the same two steps the
 * website's `CatalogListing` takes). Mirrors `SearchResultsModel.swift`.
 */
class SearchResultsModel(query: String, private val api: APIClient = APIClient.shared) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    val query: String = query.trim()

    // Filters and sort (changing any reloads from the first page: the view keys a LaunchedEffect on reloadKey).
    var category by mutableStateOf<String?>(null)
    var inStockOnly by mutableStateOf(false)
    var sort by mutableStateOf(SearchSort.Relevance)

    var phase by mutableStateOf<Phase>(Phase.Loading); private set
    var products by mutableStateOf<List<Product>>(emptyList()); private set
    var brands by mutableStateOf<List<SearchBrandHit>>(emptyList()); private set
    var categoryFacets by mutableStateOf<List<SearchCategoryFacet>>(emptyList()); private set
    var inStockCount by mutableStateOf<Int?>(null); private set
    var total by mutableStateOf(0); private set
    var nextCursor by mutableStateOf<String?>(null); private set
    var capped by mutableStateOf(false); private set
    var isLoadingMore by mutableStateOf(false); private set
    var loadMoreError by mutableStateOf<String?>(null); private set
    /** Pull to refresh in progress (Android keeps the grid on screen while it reloads). */
    var isRefreshing by mutableStateOf(false); private set

    /** Previews only: never touch the network. */
    var skipsNetwork = false

    /** Bumped on every fresh load so a slow older response can't overwrite a newer one. */
    private var generation = 0
    private var loadJob: Job? = null
    private var loadMoreJob: Job? = null
    /** The reload key the current content belongs to (so coming back to the screen doesn't refetch). */
    private var loadedKey: String? = null

    val hasFilters: Boolean get() = category != null || inStockOnly

    /** Changes whenever a reload is needed; drive `LaunchedEffect` with it. */
    fun reloadKey(currency: String): String = "${category ?: "-"}|$inStockOnly|${sort.name}|$currency"

    fun clearFilters() {
        category = null
        inStockOnly = false
    }

    /** Loads the first page unless the content already matches the filters, sort and currency. */
    fun ensureLoaded(currency: String) {
        val key = reloadKey(currency)
        if (key == loadedKey && phase !is Phase.Failed) return
        load(currency)
    }

    /** Loads the first page with the current filters. [refreshing] keeps the current grid on screen. */
    fun load(currency: String, refreshing: Boolean = false) {
        if (skipsNetwork) return
        generation += 1
        val current = generation
        loadJob?.cancel()
        loadMoreJob?.cancel()
        loadedKey = reloadKey(currency)
        if (refreshing) isRefreshing = true else phase = Phase.Loading
        loadMoreError = null
        isLoadingMore = false
        loadJob = viewModelScope.launch {
            try {
                val response = fetchPage(cursor = null, currency = currency)
                val pageProducts = fetchProducts(response.items.map { it.productId })
                if (current != generation) return@launch
                products = pageProducts
                brands = response.brands
                categoryFacets = response.facets?.categories ?: emptyList()
                inStockCount = response.facets?.inStockCount
                total = response.total
                nextCursor = response.nextCursor
                capped = response.capped
                phase = Phase.Loaded
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (current != generation) return@launch
                if (e is APIError && e.isCancelled) return@launch
                phase = Phase.Failed(SearchLiveModel.message(e))
            } finally {
                if (current == generation) isRefreshing = false
            }
        }
    }

    /**
     * Appends the next page, if there is one. Not while pull to refresh reloads the first page:
     * the old cursor would append a stale page to the fresh list.
     */
    fun loadMore(currency: String) {
        val cursor = nextCursor
        if (skipsNetwork || phase != Phase.Loaded || isLoadingMore || isRefreshing || cursor == null) return
        val current = generation
        isLoadingMore = true
        loadMoreError = null
        loadMoreJob = viewModelScope.launch {
            try {
                val response = fetchPage(cursor = cursor, currency = currency)
                val pageProducts = fetchProducts(response.items.map { it.productId })
                if (current != generation) return@launch
                val known = products.map { it.id }.toHashSet()
                products = products + pageProducts.filter { it.id !in known }
                total = response.total
                nextCursor = response.nextCursor
                capped = response.capped
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (current != generation) return@launch
                if (e is APIError && e.isCancelled) return@launch
                loadMoreError = SearchLiveModel.message(e)
            } finally {
                if (current == generation) isLoadingMore = false
            }
        }
    }

    // region Requests

    private suspend fun fetchPage(cursor: String?, currency: String): SearchResponse {
        val items = mutableListOf<Pair<String, String?>>(
            "currency" to currency,
            "limit" to PAGE_SIZE.toString(),
            "sort" to sort.apiValue,
        )
        if (query.isNotEmpty()) items += "q" to query
        category?.let { items += "category" to it }
        if (inStockOnly) items += "inStock" to "1"
        if (cursor != null) items += "cursor" to cursor
        return api.get<SearchResponse>("/api/search", items)
    }

    /** Full products for the ids, in the search's order (pieces no longer public drop out). */
    private suspend fun fetchProducts(ids: List<String>): List<Product> {
        if (ids.isEmpty()) return emptyList()
        val items = ids.map<String, Pair<String, String?>> { "ids" to it } +
            ("limit" to ids.size.coerceIn(1, 60).toString())
        val page = api.get<ProductsPage>("/api/catalog/products", items)
        val byId = page.products.associateBy { it.id }
        return ids.mapNotNull { byId[it] }
    }

    // endregion

    companion object {
        const val PAGE_SIZE = 24

        /** Previews only. */
        fun preview(query: String, products: List<Product>, brands: List<SearchBrandHit> = emptyList(), facets: List<SearchCategoryFacet> = emptyList()): SearchResultsModel =
            SearchResultsModel(query).apply {
                skipsNetwork = true
                this.products = products
                this.brands = brands
                categoryFacets = facets
                inStockCount = products.size
                total = products.size
                phase = Phase.Loaded
            }
    }
}
