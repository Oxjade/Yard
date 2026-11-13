package space.yardstore.app.features.search

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.models.YardJson

// Models for the Search feature, mirroring the website's endpoints (SearchModels.swift):
//   GET /api/search             (src/app/api/search/route.ts → src/server/search/index.ts `searchCatalog`)
//   GET /api/catalog/categories (src/app/api/catalog/categories/route.ts → `publicCategories`)
// Only the fields Search uses are modelled; anything the server may omit has a default.

/** GET /api/search?q=&category=&inStock=&sort=&currency=&limit=&cursor= */
@Serializable
data class SearchResponse(
    val items: List<SearchItem> = emptyList(),
    val total: Int = 0,
    val nextCursor: String? = null,
    val capped: Boolean = false,
    /** Brand matches for the words (first page only). */
    val brands: List<SearchBrandHit> = emptyList(),
    val facets: SearchFacets? = null,
)

/** One product row of the search index (not a full `Product`: no variants or image sizes). */
@Serializable
data class SearchItem(
    val productId: String,
    val brandId: String? = null,
    val brandName: String? = null,
    val slug: String? = null,
    val title: String = "",
    val image: String? = null,
    val available: Int? = null,
    /** The price in the shopper's currency (display only). */
    val display: Money? = null,
    /** The brand's own price. */
    val price: Money? = null,
) {
    val id: String get() = productId

    /** The display price if present, else the brand's price. */
    val shownPrice: Money? get() = display ?: price
}

/** A brand that matches the words. */
@Serializable
data class SearchBrandHit(
    val brandId: String,
    val handle: String = "",
    val name: String = "",
    val city: String? = null,
    val country: String? = null,
) {
    val id: String get() = brandId

    val locationText: String?
        get() {
            val parts = listOfNotNull(city, country).filter { it.isNotEmpty() }
            return if (parts.isEmpty()) null else parts.joinToString(", ")
        }
}

@Serializable
data class SearchFacets(
    val categories: List<SearchCategoryFacet> = emptyList(),
    val inStockCount: Int? = null,
)

/** A category the results fall into, with how many pieces. */
@Serializable
data class SearchCategoryFacet(
    val value: String,
    val label: String = "",
    val count: Int = 0,
) {
    val id: String get() = value
}

/** GET /api/catalog/categories → `{ categories: [...] }`. */
@Serializable
data class SearchCategoriesResponse(
    val categories: List<SearchCategory> = emptyList(),
)

@Serializable
data class SearchCategory(
    val slug: String,
    val name: String = "",
    val productCount: Int? = null,
) {
    val id: String get() = slug
}

/**
 * Sort options for the results page. The website's listing offers Trending / Newest / Price;
 * Relevance is the API default when there are words.
 */
enum class SearchSort(val title: String, val icon: ImageVector, /** The `sort` query value of /api/search. */ val apiValue: String) {
    Relevance("Best match", Icons.Outlined.AutoAwesome, "relevance"),
    Trending("Trending", Icons.Outlined.LocalFireDepartment, "trending"),
    Newest("Newest", Icons.Outlined.Schedule, "newest"),
    PriceAsc("Price low–high", Icons.Outlined.ArrowUpward, "price_asc"),
    PriceDesc("Price high–low", Icons.Outlined.ArrowDownward, "price_desc"),
}

/**
 * Recent searches, kept on the device only (iOS: UserDefaults `yard.search.recents`; Android: the
 * app's SharedPreferences, same key, stored as a JSON string array so the order is kept).
 */
object SearchRecents {
    const val STORAGE_KEY = "yard.search.recents"
    const val LIMIT = 8

    private val serializer = ListSerializer(String.serializer())

    fun load(): List<String> {
        val raw = Config.preferences?.getString(STORAGE_KEY, null) ?: return emptyList()
        return runCatching { YardJson.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
    }

    /** Moves [term] to the front (case-insensitive dedupe) and returns the new list. */
    fun record(term: String): List<String> {
        if (term.isBlank()) return load()
        val list = recorded(load(), term)
        save(list)
        return list
    }

    /** [list] with [term] (trimmed) moved to the front, case-insensitive dedupe, at most [LIMIT]. */
    fun recorded(list: List<String>, term: String): List<String> {
        val trimmed = term.trim()
        if (trimmed.isEmpty()) return list
        return (listOf(trimmed) + list.filter { !it.equals(trimmed, ignoreCase = true) }).take(LIMIT)
    }

    fun remove(term: String): List<String> {
        val list = load().filter { it != term }
        save(list)
        return list
    }

    fun clear() {
        Config.preferences?.edit()?.remove(STORAGE_KEY)?.apply()
    }

    private fun save(list: List<String>) {
        Config.preferences?.edit()?.putString(STORAGE_KEY, YardJson.encodeToString(serializer, list))?.apply()
    }
}
