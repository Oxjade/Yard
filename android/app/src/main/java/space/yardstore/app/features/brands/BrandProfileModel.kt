package space.yardstore.app.features.brands

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.models.FollowResult
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.models.StorefrontBrand
import space.yardstore.app.core.models.StorefrontCollection
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.FollowStore

// Data for BrandProfileView. Mirrors BrandProfileModel.swift.
//
//   GET /api/catalog/storefronts/{handle}                    → PublicStorefront (+ brand.story)
//   GET /api/catalog/products?brand={brandId}&sort=new&limit=24&offset=  → ProductsPage
//   GET /api/drops?phase=all&brandId={brandId}&limit=50      → DropsPage
//   GET /api/follows/counts?brandIds={brandId}               → real follower count (via FollowStore)

enum class BrandProfileTab(val title: String) {
    Products("Products"),
    Collections("Collections"),
    Drops("Drops"),
}

class BrandProfileModel(
    val handle: String,
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class NotFound(val message: String) : Phase
        data class Failed(val message: String) : Phase
    }

    var phase: Phase by mutableStateOf(Phase.Loading); private set
    var storefront: PublicStorefront? by mutableStateOf(null); private set
    /** The brand's story (brands.story), else the storefront intro. */
    var story: String? by mutableStateOf(null); private set

    var products: List<Product> by mutableStateOf(emptyList()); private set
    var productsTotal: Int? by mutableStateOf(null); private set
    var productsNextOffset: Int? by mutableStateOf(null); private set
    var productsLoading: Boolean by mutableStateOf(false); private set
    var productsLoadingMore: Boolean by mutableStateOf(false); private set
    var productsError: String? by mutableStateOf(null); private set

    var drops: List<Drop> by mutableStateOf(emptyList()); private set
    var dropsHasMore: Boolean by mutableStateOf(false); private set
    var dropsLoading: Boolean by mutableStateOf(false); private set
    var dropsError: String? by mutableStateOf(null); private set

    /** Real follower count from the API; null until known (then the stat is omitted). */
    var followers: Int? by mutableStateOf(null); private set

    private var started = false

    val brand: StorefrontBrand? get() = storefront?.brand
    val collections: List<StorefrontCollection> get() = storefront?.collections ?: emptyList()

    /** The hero: the storefront cover, else the first product photo. */
    val heroUrl: String?
        get() = storefront?.storefront?.config?.coverUrl ?: products.firstNotNullOfOrNull { it.coverUrl }

    /** Drops worth showing (drafts and cancelled ones are left out). */
    val visibleDrops: List<Drop> get() = drops.filter { it.phase != "draft" && it.phase != "cancelled" }

    /** The drops count only when the list is complete (never a guess). */
    val dropsCount: Int?
        get() {
            if (storefront == null || dropsLoading || dropsError != null || dropsHasMore) return null
            return visibleDrops.count()
        }

    // region Loading

    /** First load (once per back-stack entry; survives configuration changes). */
    fun start(follows: FollowStore) {
        if (started) return
        started = true
        viewModelScope.launch { load(follows) }
    }

    suspend fun load(follows: FollowStore) {
        if (storefront == null) phase = Phase.Loading
        try {
            val text = api.data(HTTPMethod.GET, "/api/catalog/storefronts/${Config.encodePath(handle)}")
            // Two decodes of a whole storefront: keep them off the main thread.
            val (decoded, extras) = withContext(Dispatchers.Default) { decodeStorefront(text) }
            storefront = decoded
            val rawStory = extras?.brand?.story?.trim().orEmpty()
            val intro = decoded.storefront?.config?.intro?.trim().orEmpty()
            story = rawStory.ifEmpty { intro.ifEmpty { null } }
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError) {
                if (e.isCancelled) return
                if (e.isNotFound) {
                    phase = Phase.NotFound(e.message)
                    return
                }
            }
            if (storefront == null) phase = Phase.Failed(APIError.messageFor(e))
            return
        }

        val brandId = storefront?.brand?.id ?: return
        coroutineScope {
            launch { loadProducts(brandId) }
            launch { loadDrops(brandId) }
            launch { loadFollowers(brandId, follows) }
        }
    }

    suspend fun loadProducts(brandId: String) {
        productsLoading = true
        productsError = null
        try {
            val page: ProductsPage = api.get("/api/catalog/products", productQuery(brandId, 0))
            products = page.products
            productsTotal = page.total
            productsNextOffset = page.nextOffset
        } catch (e: CancellationException) {
            productsLoading = false
            throw e
        } catch (e: Exception) {
            if (!(e is APIError && e.isCancelled)) productsError = APIError.messageFor(e)
        }
        productsLoading = false
    }

    fun loadMoreProducts() {
        val brandId = brand?.id ?: return
        val offset = productsNextOffset ?: return
        if (productsLoadingMore || productsLoading) return
        productsLoadingMore = true
        viewModelScope.launch {
            try {
                val page: ProductsPage = api.get("/api/catalog/products", productQuery(brandId, offset))
                val known = products.map { it.id }.toSet()
                products = products + page.products.filter { it.id !in known }
                productsTotal = page.total
                productsNextOffset = page.nextOffset
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Keep what is shown; scrolling to the end again retries.
            } finally {
                productsLoadingMore = false
            }
        }
    }

    suspend fun loadDrops(brandId: String) {
        dropsLoading = true
        dropsError = null
        try {
            val page: DropsPage = api.get(
                "/api/drops",
                listOf("phase" to "all", "brandId" to brandId, "limit" to DROPS_LIMIT.toString()),
            )
            drops = page.items.filter { it.brand.id.isEmpty() || it.brand.id == brandId }
            dropsHasMore = page.nextCursor != null
        } catch (e: CancellationException) {
            dropsLoading = false
            throw e
        } catch (e: Exception) {
            if (!(e is APIError && e.isCancelled)) dropsError = APIError.messageFor(e)
        }
        dropsLoading = false
    }

    suspend fun loadFollowers(brandId: String, follows: FollowStore) {
        follows.followerCountCache[brandId]?.let { followers = it }
        try {
            follows.followerCounts(listOf(brandId))[brandId]?.let { followers = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The stat stays hidden (or at the cached value): never a guess.
        }
    }

    /** After a follow/unfollow the server returns the new count. */
    fun apply(result: FollowResult) {
        followers = result.followers
    }

    private fun decodeStorefront(text: String): Pair<PublicStorefront, BrandsStorefrontExtras?> {
        val decoded = try {
            YardJson.decodeFromString<PublicStorefront>(text)
        } catch (e: Exception) {
            throw APIError.decoding(e)
        }
        val extras = try { YardJson.decodeFromString<BrandsStorefrontExtras>(text) } catch (e: Exception) { null }
        return decoded to extras
    }

    private fun productQuery(brandId: String, offset: Int): List<Pair<String, String?>> = listOf(
        "brand" to brandId,
        "sort" to "new",
        "limit" to PRODUCT_PAGE_SIZE.toString(),
        "offset" to offset.toString(),
    )

    // endregion

    companion object {
        const val PRODUCT_PAGE_SIZE = 24
        const val DROPS_LIMIT = 50

        /** Preview-only model with already-loaded values. */
        fun preview(
            storefront: PublicStorefront,
            story: String?,
            products: List<Product>,
            followers: Int?,
            drops: List<Drop> = emptyList(),
        ): BrandProfileModel = BrandProfileModel(storefront.brand.handle).apply {
            this.storefront = storefront
            this.story = story
            this.products = products
            this.productsTotal = products.size
            this.followers = followers
            this.drops = drops
            this.phase = Phase.Loaded
            this.started = true
        }
    }
}
