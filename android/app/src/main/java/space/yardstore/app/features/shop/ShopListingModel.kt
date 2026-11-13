package space.yardstore.app.features.shop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError

/**
 * The shop listing (website: /shop and /categories/{slug}): GET /api/catalog/products with
 * category / subcategory / inStock / sort, paged with limit + offset (`publicProductsQuery`).
 * Mirrors ios/Yard/Features/Shop/ShopListingModel.swift.
 */
class ShopListingModel private constructor(
    /** The category the screen was opened on (`null` = the whole shop). Its chip row is hidden. */
    val fixedCategory: String?,
    private val fetches: Boolean,
    private val api: APIClient = APIClient.shared,
    /** Tests only: prefix for API paths (a MockWebServer URL). */
    private val baseUrl: String = "",
) : ViewModel() {

    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val error: Throwable) : Phase
    }

    companion object {
        const val PAGE_SIZE = 24

        /** Previews only: fixed products, no network. */
        fun preview(previewCategory: String?, categories: List<ShopCategory>, products: List<Product>): ShopListingModel =
            ShopListingModel(previewCategory, fetches = false).apply {
                this.categories = categories
                this.products = products
                this.total = products.size
                this.nextOffset = null
                this.phase = Phase.Loaded
                this.hasStarted = true
            }

        private fun unique(list: List<Product>): List<Product> {
            val seen = HashSet<String>()
            return list.filter { seen.add(it.id) }
        }
    }

    constructor(category: String?) : this(category, fetches = true)

    /** Tests: a fetching model against another client/server. */
    internal constructor(category: String?, api: APIClient, baseUrl: String) : this(category, true, api, baseUrl)

    // Filters
    var category by mutableStateOf(fixedCategory); private set
    var subcategory by mutableStateOf<String?>(null); private set
    var inStock by mutableStateOf(false); private set
    var sort by mutableStateOf(ShopSort.New); private set

    // Data
    var categories by mutableStateOf(ShopCategoryCache.current ?: emptyList()); private set
    var products by mutableStateOf<List<Product>>(emptyList()); private set
    var total by mutableStateOf(0); private set
    var nextOffset by mutableStateOf<Int?>(null); private set
    var phase by mutableStateOf<Phase>(Phase.Loading); private set
    /** A filter change is loading while the previous results stay on screen (dimmed). */
    var isRefreshing by mutableStateOf(false); private set
    var isLoadingMore by mutableStateOf(false); private set
    var loadMoreError by mutableStateOf<String?>(null); private set
    /** Pull to refresh is running (Android: drives the indicator). */
    var isPullRefreshing by mutableStateOf(false); private set

    private var generation = 0
    private var hasStarted = false
    private var reloadJob: Job? = null

    // MARK: Derived

    val isLoaded: Boolean get() = phase == Phase.Loaded
    val hasMore: Boolean get() = nextOffset != null

    val selectedCategory: ShopCategory?
        get() {
            val c = category ?: return null
            return categories.firstOrNull { it.slug == c }
        }

    /** Subcategories of the selected category (empty when none is selected). */
    val subcategories: List<String> get() = selectedCategory?.subcategories ?: emptyList()

    /** Name for titles: the category's name, or a readable slug until the list arrives. */
    val categoryName: String?
        get() {
            val c = category ?: return null
            return selectedCategory?.name ?: shopTitleCase(c.replace("-", " "))
        }

    /** Filters a shopper set from the panel (website `panelCount`): only the stock toggle here. */
    val panelFilterCount: Int get() = if (inStock) 1 else 0

    // MARK: Loading

    /** First appearance: categories (for chips and the banner) and the first page. */
    fun start() {
        if (!fetches) return
        // A cancelled first load leaves `Loading`: start again on return.
        if (hasStarted && (isLoaded || isRefreshing || reloadJob?.isActive == true)) return
        hasStarted = true
        viewModelScope.launch { loadCategories(force = false) }
        reload()
    }

    /** Pull to refresh: categories (forced) and page one. */
    fun refresh() {
        if (!fetches || isPullRefreshing) return
        isPullRefreshing = true
        viewModelScope.launch {
            try {
                coroutineScope {
                    launch { loadCategories(force = true) }
                    launch { reloadNow() }
                }
            } finally {
                isPullRefreshing = false
            }
        }
    }

    private suspend fun loadCategories(force: Boolean) {
        // Non-fatal: without categories the listing still works, only the chips are missing.
        try {
            categories = ShopCategoryCache.categories(force, api, baseUrl)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    /** Reloads page one for the current filters. Results of an older request are dropped. */
    fun reload() {
        if (!fetches) return
        reloadJob?.cancel()
        reloadJob = viewModelScope.launch { reloadNow() }
    }

    private suspend fun reloadNow() {
        generation += 1
        val gen = generation
        loadMoreError = null
        isLoadingMore = false
        if (products.isEmpty()) phase = Phase.Loading else isRefreshing = true
        try {
            val page = fetch(offset = 0)
            if (gen != generation) return
            products = unique(page.products)
            total = page.total
            nextOffset = page.nextOffset
            phase = Phase.Loaded
            isRefreshing = false
        } catch (e: CancellationException) {
            if (gen == generation) isRefreshing = false
            throw e
        } catch (e: Exception) {
            if (gen != generation) return
            isRefreshing = false
            if (shopIsCancellation(e)) return
            products = emptyList()
            total = 0
            nextOffset = null
            phase = Phase.Failed(e)
        }
    }

    /** Next page (infinite scroll). Safe to call repeatedly. */
    fun loadMore() {
        if (!fetches || !isLoaded || isRefreshing || isLoadingMore) return
        val offset = nextOffset ?: return
        val gen = generation
        isLoadingMore = true
        loadMoreError = null
        viewModelScope.launch {
            try {
                val page = fetch(offset)
                if (gen != generation) return@launch
                val known = products.mapTo(HashSet()) { it.id }
                products = products + unique(page.products).filter { it.id !in known }
                total = page.total
                nextOffset = page.nextOffset
                isLoadingMore = false
            } catch (e: CancellationException) {
                if (gen == generation) isLoadingMore = false
                throw e
            } catch (e: Exception) {
                if (gen != generation) return@launch
                isLoadingMore = false
                if (shopIsCancellation(e)) return@launch
                loadMoreError = APIError.messageFor(e)
            }
        }
    }

    private suspend fun fetch(offset: Int): ProductsPage {
        val query = buildList<Pair<String, String?>> {
            add("sort" to sort.rawValue)
            add("limit" to PAGE_SIZE.toString())
            add("offset" to offset.toString())
            category?.let { add("category" to it) }
            subcategory?.let { add("subcategory" to it) }
            if (inStock) add("inStock" to "1")
        }
        return api.get<ProductsPage>("$baseUrl/api/catalog/products", query)
    }

    // MARK: Filters (each reloads page one)

    fun selectCategory(slug: String?) {
        if (fixedCategory != null || slug == category) return
        category = slug
        subcategory = null
        reload()
    }

    fun selectSubcategory(sub: String?) {
        if (sub == subcategory) return
        subcategory = sub
        reload()
    }

    @JvmName("applyInStock")
    fun setInStock(on: Boolean) {
        if (on == inStock) return
        inStock = on
        reload()
    }

    @JvmName("applySort")
    fun setSort(newSort: ShopSort) {
        if (newSort == sort) return
        sort = newSort
        reload()
    }

    /** "Clear filters": the stock toggle and the subcategory; the category and sort stay. */
    fun clearFilters() {
        inStock = false
        subcategory = null
        reload()
    }
}
