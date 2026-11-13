package space.yardstore.app.features.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import kotlin.coroutines.cancellation.CancellationException

/**
 * A marketplace category for the Welcome picks (GET /api/catalog/categories →
 * `{ categories: [{ slug, name, description, imagePath, subcategories, productCount, brandCount }] }`).
 */
@Serializable
data class WelcomeCategory(
    val slug: String,
    val name: String = "",
    val imagePath: String? = null,
) {
    val id: String get() = slug
    /** The name, or the slug when the server sent none (iOS decodes `name` with the slug as fallback). */
    val title: String get() = name.ifEmpty { slug }
    val imageUrl: String? get() = Config.url(imagePath)
}

@Serializable
data class WelcomeCategoriesResponse(val categories: List<WelcomeCategory> = emptyList())

/** The looks (src/lib/data/index.ts `aestheticLabels`): fixed on the website too. */
data class WelcomeLook(val slug: String, val label: String) {
    val id: String get() = slug

    companion object {
        val all: List<WelcomeLook> = listOf(
            WelcomeLook("minimalist", "Minimalist"),
            WelcomeLook("vintage", "Vintage"),
            WelcomeLook("avant-garde", "Avant-garde"),
            WelcomeLook("streetwear", "Streetwear"),
            WelcomeLook("contemporary", "Contemporary"),
            WelcomeLook("luxury", "Luxury"),
            WelcomeLook("experimental", "Experimental"),
        )
    }
}

/**
 * Data for WelcomeView: categories (step 1) and brand suggestions (step 3). Mirrors WelcomeModel.swift.
 *
 * [base] is a test hook (MockWebServer URL); the app uses relative paths on `APIClient.shared`.
 */
class WelcomeModel(
    private val api: APIClient = APIClient.shared,
    private val base: String? = null,
    previewCategories: List<WelcomeCategory>? = null,
    previewSuggestions: List<BrandCard>? = null,
) : ViewModel() {
    var categories by mutableStateOf(previewCategories ?: emptyList()); private set
    var categoriesLoading by mutableStateOf(false); private set
    var categoriesLoaded by mutableStateOf(previewCategories != null); private set
    var categoriesError by mutableStateOf<APIError?>(null); private set

    /** null while loading (or before step 3 opens); fixed once loaded so following doesn't reshuffle. */
    var suggestions by mutableStateOf(previewSuggestions); private set
    private var suggestionsLoading = false

    private fun p(path: String) = base?.let { it.trimEnd('/') + path } ?: path

    fun loadCategories() {
        if (categoriesLoading) return
        categoriesLoading = true
        viewModelScope.launch {
            try {
                val response: WelcomeCategoriesResponse = api.get(p("/api/catalog/categories"))
                categories = response.categories
                categoriesError = null
                categoriesLoaded = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: APIError) {
                if (!e.isCancelled) categoriesError = e
            } catch (e: Exception) {
                categoriesError = APIError.network(e)
            } finally {
                categoriesLoading = false
            }
        }
    }

    /**
     * Up to six listed brands, newest first, those in the picked categories first (the website's
     * `useLiveSuggestions`): GET /api/catalog/brands?category=&sort=new&limit=6 for up to three
     * categories, then GET /api/catalog/brands?sort=new&limit=12 to fill.
     */
    fun loadSuggestions(picked: List<String>) {
        if (suggestions != null || suggestionsLoading) return
        suggestionsLoading = true
        viewModelScope.launch {
            val out = mutableListOf<BrandCard>()
            try {
                for (category in picked.take(3)) {
                    val page: BrandsPage = api.get(p("/api/catalog/brands"), listOf("category" to category, "sort" to "new", "limit" to "6"))
                    addUpToSix(out, page.brands)
                }
                if (out.size < 6) {
                    val page: BrandsPage = api.get(p("/api/catalog/brands"), listOf("sort" to "new", "limit" to "12"))
                    addUpToSix(out, page.brands)
                }
                suggestions = out
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Like the website: no suggestions rather than an error on an optional step.
                suggestions = out
            } finally {
                suggestionsLoading = false
            }
        }
    }

    companion object {
        /** Adds brands not already in [out] until it holds six. */
        internal fun addUpToSix(out: MutableList<BrandCard>, brands: List<BrandCard>) {
            for (brand in brands) {
                if (out.size >= 6) break
                if (out.none { it.id == brand.id }) out += brand
            }
        }
    }
}
