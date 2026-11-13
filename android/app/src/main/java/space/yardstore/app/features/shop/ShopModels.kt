package space.yardstore.app.features.shop

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.StorefrontCollection
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.time.Instant

// Shop feature models and the small shared category cache. Shop-private (prefixed `Shop…`).
// Mirrors ios/Yard/Features/Shop/ShopModels.swift.

// MARK: - Categories

/**
 * One marketplace category from GET /api/catalog/categories
 * (`src/server/catalog/public.ts` › `publicCategories`).
 */
@Serializable
data class ShopCategory(
    val slug: String,
    val name: String = shopTitleCase(slug),
    val description: String = "",
    /** Library photo path ("/media/…") or null. */
    val imagePath: String? = null,
    val subcategories: List<String> = emptyList(),
    /** Public products in the category. */
    val productCount: Int = 0,
    /** Distinct brands with public products in the category. */
    val brandCount: Int = 0,
) {
    val id: String get() = slug
    val imageUrl: String? get() = Config.url(imagePath)

    /** "12 pieces from 3 brands", or "Coming soon" for an empty shelf (the website never prints "0 pieces"). */
    val countText: String
        get() {
            if (productCount == 0) return "Coming soon"
            val pieces = "${Formatters.grouped(productCount)} ${if (productCount == 1) "piece" else "pieces"}"
            if (brandCount <= 0) return pieces
            return "$pieces from ${Formatters.grouped(brandCount)} ${if (brandCount == 1) "brand" else "brands"}"
        }
}

@Serializable
data class ShopCategoriesResponse(val categories: List<ShopCategory> = emptyList())

/**
 * Categories are read by both CategoriesView and ShopView (chips, banner). One short-lived
 * in-memory copy keeps the two screens from fetching the same list back to back
 * (the server caches it for 5 minutes too).
 */
object ShopCategoryCache {
    private const val TTL_MS = 300_000L
    private val mutex = Mutex()

    @Volatile private var cached: List<ShopCategory>? = null
    @Volatile private var fetchedAt: Long = 0L

    /** The categories, from memory when fresh; `force` refetches. */
    suspend fun categories(force: Boolean = false, api: APIClient = APIClient.shared, baseUrl: String = ""): List<ShopCategory> = mutex.withLock {
        val now = System.currentTimeMillis()
        val hit = cached
        if (!force && hit != null && now - fetchedAt < TTL_MS) return@withLock hit
        val response = api.get<ShopCategoriesResponse>("$baseUrl/api/catalog/categories")
        cached = response.categories
        fetchedAt = System.currentTimeMillis()
        response.categories
    }

    /** Tests only: forget the cached list. */
    internal fun reset() {
        cached = null
        fetchedAt = 0L
    }

    /** Whatever is in memory (no network), for an instant first paint. */
    val current: List<ShopCategory>? get() = cached
}

// MARK: - Sort

/** Server-side sort for GET /api/catalog/products (`publicProductsQuery.sort`). */
enum class ShopSort(val rawValue: String) {
    New("new"),
    PriceAsc("price_asc"),
    PriceDesc("price_desc");

    /** Website wording (`catalog-state.ts` › `sortOptions`). */
    val title: String
        get() = when (this) {
            New -> "Newest"
            PriceAsc -> "Price low–high"
            PriceDesc -> "Price high–low"
        }

    val icon: ImageVector
        get() = when (this) {
            New -> Icons.Outlined.AutoAwesome
            PriceAsc -> Icons.Filled.ArrowUpward
            PriceDesc -> Icons.Filled.ArrowDownward
        }
}

/** Client-side sort of a collection's pieces (`collection-view.tsx` › `sorts`). */
enum class ShopCollectionSort {
    Featured,
    Newest,
    PriceAsc,
    PriceDesc;

    val title: String
        get() = when (this) {
            Featured -> "Featured"
            Newest -> "Newest"
            PriceAsc -> "Price, low to high"
            PriceDesc -> "Price, high to low"
        }

    /** [products] must be in the collection's own order (featured). Stable sorts. */
    fun apply(products: List<Product>): List<Product> = when (this) {
        Featured -> products
        Newest -> products.sortedByDescending { YardDate.parse(it.publishedAt ?: it.createdAt) ?: Instant.EPOCH }
        PriceAsc -> products.sortedBy { it.priceMinor }
        PriceDesc -> products.sortedByDescending { it.priceMinor }
    }
}

// MARK: - Collection

/**
 * GET /api/catalog/storefronts/{handle}/collections/{collection}
 * → `{ collection: {id, handle, name, description, imageSrc, imageMediaId, productIds}, brand: {id, handle, name} }`.
 */
@Serializable
data class ShopCollectionResponse(
    val collection: StorefrontCollection,
    val brand: Brand,
) {
    @Serializable
    data class Brand(
        val id: String,
        val handle: String = id,
        val name: String = "",
    )
}

/** Shared piece-count wording ("1 piece", "12 pieces"). */
object ShopText {
    fun pieces(n: Int): String = "${Formatters.grouped(n)} ${if (n == 1) "piece" else "pieces"}"
}

// MARK: - Helpers

/** Swift `String.capitalized` for a slug: "t-shirts" → "T-Shirts", "new in" → "New In". */
internal fun shopTitleCase(raw: String): String {
    val sb = StringBuilder(raw.length)
    var startOfWord = true
    for (ch in raw) {
        if (ch.isLetterOrDigit()) {
            sb.append(if (startOfWord) ch.titlecaseChar() else ch.lowercaseChar())
            startOfWord = false
        } else {
            sb.append(ch)
            startOfWord = true
        }
    }
    return sb.toString()
}

/** Cancellation (screen left, newer request) is never shown as an error. */
internal fun shopIsCancellation(error: Throwable): Boolean =
    error is CancellationException || (error is APIError && error.isCancelled)
