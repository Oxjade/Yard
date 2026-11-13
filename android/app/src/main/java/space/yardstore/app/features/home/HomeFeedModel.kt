package space.yardstore.app.features.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import kotlin.coroutines.cancellation.CancellationException

/** Load phase of one Home tab (iOS `HomeFeedModel.Phase`). */
sealed interface HomeFeedPhase {
    data object Idle : HomeFeedPhase
    data object Loading : HomeFeedPhase
    data object Loaded : HomeFeedPhase
    data class Failed(val message: String) : HomeFeedPhase
}

/**
 * Loads and pages one Home tab's feed. Mirrors `HomeFeedModel.swift`.
 *
 * - For you: GET /api/catalog/products?sort=new&limit=24&offset= (paged by `nextOffset`), mixed
 *   with brand tiles (GET /api/catalog/brands?sort=new&limit=24) and drop tiles
 *   (GET /api/drops?phase=live&limit=8 and ?phase=upcoming&limit=8, as the site's Discover band),
 *   plus the founding-brands row (GET /api/catalog/brands?founding=1&limit=8).
 * - Following: like the site's LiveFollowingFeed: the newest 6 pieces of each followed brand
 *   (first 24 follows), newest first.
 * - Category: GET /api/catalog/products?category=<slug>&sort=new (paged).
 *
 * Android: the model is owned by [HomeViewModel] and runs its loads in that ViewModel's scope,
 * so switching tabs never cancels (or repeats) a load.
 */
class HomeFeedModel(
    val tab: HomeTab,
    private val scope: CoroutineScope,
    private val api: APIClient = APIClient.shared,
) {
    var phase: HomeFeedPhase by mutableStateOf(HomeFeedPhase.Idle)
        private set
    var items: List<HomeFeedItem> by mutableStateOf(emptyList())
        private set
    var founding: List<BrandCard> by mutableStateOf(emptyList())
        private set
    var isLoadingMore: Boolean by mutableStateOf(false)
        private set
    var loadMoreFailed: Boolean by mutableStateOf(false)
        private set
    /** A pull to refresh is running over loaded content. */
    var isRefreshing: Boolean by mutableStateOf(false)
        private set

    private var products: List<Product> = emptyList()
    private var brands: List<BrandCard> = emptyList()
    private var drops: List<Drop> = emptyList()
    private var nextOffset: Int? by mutableStateOf(null)
    /** Following tab: every piece, revealed a page at a time. */
    private var followingPool: List<Product> = emptyList()
    private var followingShown: Int by mutableStateOf(0)
    /** Follow ids the Following feed was built from (rebuild when they change). */
    var builtForFollowIds: Set<String> = emptySet()
        private set

    private var refreshJob: Job? = null
    private var loadMoreJob: Job? = null

    val hasMore: Boolean
        get() = when (tab) {
            HomeTab.Following -> followingShown < followingPool.size
            else -> nextOffset != null
        }

    /** First load (no-op when already loaded or loading). */
    fun loadIfNeeded(followIds: List<String>) {
        if (phase != HomeFeedPhase.Idle || refreshJob?.isActive == true) return
        refresh(followIds)
    }

    /** Reloads from scratch (pull to refresh, retry). Join the job to wait for it. */
    fun refresh(followIds: List<String>, pulled: Boolean = false): Job {
        refreshJob?.cancel()
        loadMoreJob?.cancel()
        val job = scope.launch {
            if (items.isEmpty()) phase = HomeFeedPhase.Loading else if (pulled) isRefreshing = true
            loadMoreFailed = false
            try {
                when (tab) {
                    HomeTab.ForYou -> loadForYou()
                    HomeTab.Following -> loadFollowing(followIds)
                    is HomeTab.Category -> {
                        val page = fetchProducts(listOf("category" to tab.category.slug), offset = 0)
                        products = page.products.map(HomeShape::shaped)
                        nextOffset = page.nextOffset
                    }
                }
                rebuild()
                phase = HomeFeedPhase.Loaded
            } catch (e: CancellationException) {
                // Leave it loadable again (unless a newer refresh already took over).
                if (refreshJob === coroutineContext.job) {
                    phase = if (items.isEmpty()) HomeFeedPhase.Idle else HomeFeedPhase.Loaded
                }
                throw e
            } catch (e: Exception) {
                if (e is APIError && e.isCancelled) {
                    phase = if (items.isEmpty()) HomeFeedPhase.Idle else HomeFeedPhase.Loaded
                } else {
                    phase = if (items.isEmpty()) HomeFeedPhase.Failed(APIError.messageFor(e)) else HomeFeedPhase.Loaded
                }
            } finally {
                if (refreshJob === coroutineContext.job) isRefreshing = false
            }
        }
        refreshJob = job
        return job
    }

    /** Next page, triggered when the last tiles come into view. Returns the network job, if any. */
    fun loadMore(): Job? {
        if (phase != HomeFeedPhase.Loaded || isLoadingMore || !hasMore) return null
        if (tab == HomeTab.Following) {
            followingShown = minOf(followingPool.size, followingShown + PAGE_SIZE)
            products = followingPool.take(followingShown)
            rebuild()
            return null
        }
        val offset = nextOffset ?: return null
        isLoadingMore = true
        loadMoreFailed = false
        val extra = if (tab is HomeTab.Category) listOf("category" to tab.category.slug) else emptyList()
        val job = scope.launch {
            try {
                val page = fetchProducts(extra, offset)
                val known = products.mapTo(HashSet()) { it.id }
                products = products + page.products.filter { it.id !in known }.map(HomeShape::shaped)
                nextOffset = page.nextOffset
                rebuild()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (!(e is APIError && e.isCancelled)) loadMoreFailed = true
            } finally {
                isLoadingMore = false
            }
        }
        loadMoreJob = job
        return job
    }

    /** Stops any running load (the tab was dropped). */
    fun cancel() {
        refreshJob?.cancel()
        loadMoreJob?.cancel()
    }

    // region Loading

    private suspend fun fetchProducts(extra: List<Pair<String, String?>>, offset: Int): ProductsPage =
        api.get(
            "/api/catalog/products",
            listOf("sort" to "new", "limit" to PAGE_SIZE.toString(), "offset" to offset.toString()) + extra,
        )

    /** A side module never fails the feed: without it the feed is just products. */
    private inline fun <T> optional(block: () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    private suspend fun loadForYou() = coroutineScope {
        val productsTask = async { fetchProducts(emptyList(), offset = 0) }
        val brandsTask = async { optional { api.get<BrandsPage>("/api/catalog/brands", listOf("sort" to "new", "limit" to "24")) } }
        val foundingTask = async { optional { api.get<BrandsPage>("/api/catalog/brands", listOf("founding" to "1", "limit" to "8")) } }
        val liveTask = async { optional { api.get<DropsPage>("/api/drops", listOf("phase" to "live", "limit" to "8")) } }
        val upcomingTask = async { optional { api.get<DropsPage>("/api/drops", listOf("phase" to "upcoming", "limit" to "8")) } }

        val page = productsTask.await()
        val brandsPage = brandsTask.await()
        val foundingPage = foundingTask.await()
        val livePage = liveTask.await()
        val upcomingPage = upcomingTask.await()

        products = page.products.map(HomeShape::shaped)
        nextOffset = page.nextOffset
        founding = foundingPage?.brands ?: emptyList()
        // Founding brands already have their own row; don't repeat them as tiles.
        val foundingIds = founding.mapTo(HashSet()) { it.id }
        brands = (brandsPage?.brands ?: emptyList()).filter { it.id !in foundingIds && it.coverSrc != null }
        val seen = HashSet<String>()
        drops = ((livePage?.items ?: emptyList()) + (upcomingPage?.items ?: emptyList())).filter { drop ->
            !drop.isEnded && seen.add(drop.id)
        }
    }

    private suspend fun loadFollowing(followIds: List<String>) {
        builtForFollowIds = followIds.toSet()
        val ids = followIds.take(MAX_BRANDS)
        val pages: List<List<Product>> = coroutineScope {
            ids.map { id ->
                async {
                    optional {
                        api.get<ProductsPage>(
                            "/api/catalog/products",
                            listOf("brand" to id, "sort" to "new", "limit" to PER_BRAND.toString()),
                        ).products
                    } ?: emptyList()
                }
            }.awaitAll()
        }
        val merged = pages.flatten().sortedByDescending { it.publishedAt ?: it.createdAt }
        followingPool = merged.map(HomeShape::shaped)
        followingShown = minOf(followingPool.size, PAGE_SIZE)
        products = followingPool.take(followingShown)
        nextOffset = null
        brands = emptyList()
        drops = emptyList()
    }

    // endregion

    // region Mixing

    /**
     * Products in order, with a drop or brand tile after every 5th product (drops first,
     * alternating). Prefix-stable, so appending a page never reshuffles the columns above.
     */
    private fun rebuild() {
        val out = ArrayList<HomeFeedItem>(products.size + brands.size + drops.size)
        var brandIndex = 0
        var dropIndex = 0
        var slot = 0
        products.forEachIndexed { i, product ->
            out += HomeFeedItem.ProductItem(product)
            if ((i + 1) % 5 != 0) return@forEachIndexed
            val preferDrop = slot % 2 == 0
            slot += 1
            if (preferDrop && dropIndex < drops.size) {
                out += HomeFeedItem.DropItem(drops[dropIndex++])
            } else if (brandIndex < brands.size) {
                out += HomeFeedItem.BrandItem(brands[brandIndex++])
            } else if (dropIndex < drops.size) {
                out += HomeFeedItem.DropItem(drops[dropIndex++])
            }
        }
        // A short catalogue still shows its live drops.
        if (products.size < 5 && dropIndex < drops.size) {
            drops.drop(dropIndex).take(2).forEach { out += HomeFeedItem.DropItem(it) }
        }
        items = out
    }

    // endregion

    companion object {
        private const val PAGE_SIZE = 24
        private const val PER_BRAND = 6
        private const val MAX_BRANDS = 24
    }
}

/**
 * Keeps one feed model per visited tab, so switching tabs doesn't refetch (iOS `HomeFeedCache`).
 * Not observed: creating a model during composition triggers no recomposition.
 */
class HomeFeedCache(private val scope: CoroutineScope, private val api: APIClient = APIClient.shared) {
    private val models = HashMap<String, HomeFeedModel>()

    fun model(tab: HomeTab): HomeFeedModel = models.getOrPut(tab.id) { HomeFeedModel(tab, scope, api) }

    fun drop(id: String) {
        models.remove(id)?.cancel()
    }
}

/**
 * Home's screen state (the iOS `@State` of `HomeView`): the feed cache, the category tabs and the
 * unread badges. Scoped to the Home tab root's back-stack entry.
 *
 * GET /api/catalog/categories; GET /api/notifications?as=shopper and GET /api/inbox/unread (signed in).
 */
class HomeViewModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    val cache = HomeFeedCache(viewModelScope, api)

    var categories: List<HomeCategory> by mutableStateOf(emptyList())
        private set
    var unreadNotifications: Int by mutableStateOf(0)
        private set
    var unreadConversations: Int by mutableStateOf(0)
        private set

    private var categoriesJob: Job? = null
    private var badgesJob: Job? = null

    /** For tests: wait for the running category / badge loads. */
    internal suspend fun awaitLoads() {
        categoriesJob?.join()
        badgesJob?.join()
    }

    fun loadCategories() {
        if (categories.isNotEmpty() || categoriesJob?.isActive == true) return
        categoriesJob = viewModelScope.launch {
            try {
                categories = api.get<HomeCategoriesResponse>("/api/catalog/categories").categories
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The category tabs are optional; For you still works without them.
            }
        }
    }

    fun loadBadges(signedIn: Boolean) {
        badgesJob?.cancel()
        if (!signedIn) {
            unreadNotifications = 0
            unreadConversations = 0
            return
        }
        badgesJob = viewModelScope.launch {
            coroutineScope {
                val notes = async {
                    try { api.get<HomeNotificationsResponse>("/api/notifications", listOf("as" to "shopper")) }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { null }
                }
                val inbox = async {
                    try { api.get<HomeInboxUnread>("/api/inbox/unread") }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { null }
                }
                val n = notes.await()
                val i = inbox.await()
                unreadNotifications = n?.items?.count { it.read == false } ?: 0
                unreadConversations = i?.conversations ?: 0
            }
        }
    }
}
