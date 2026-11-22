package space.yardstore.app.features.sell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.features.studio.StudioApplication
import space.yardstore.app.features.studio.StudioApplyBody
import space.yardstore.app.features.studio.StudioApplyResult
import space.yardstore.app.features.studio.StudioCategory
import space.yardstore.app.features.studio.StudioStore
import space.yardstore.app.features.studio.categories
import space.yardstore.app.features.studio.latestApplication
import space.yardstore.app.features.studio.submitApplication
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException

/**
 * The short application's rules, as the server checks them (src/lib/api/contracts/studio-app.ts
 * `studioApplyBody`), so a step only moves on with an answer the server will take. Pure; unit-tested.
 */
object SellRules {
    /** Countries Yard sells in (POST /api/studio/apply `country`); the currency follows the country. */
    val countries: List<String> = listOf("NG", "GH", "KE", "ZA", "GB", "FR", "DE", "US", "MX", "JP", "KR")

    private val instagramHandle = Regex("^[A-Za-z0-9._]{1,30}$")
    private val instagramLink = Regex("^(?:https?://)?(?:www\\.)?instagram\\.com/([^/?#\\s]+)", RegexOption.IGNORE_CASE)
    private val website = Regex("^(https?://)?[^\\s/$.?#][^\\s]*\\.[^\\s]{2,}$", RegexOption.IGNORE_CASE)

    /** "2–40 chars (the shop's name)". */
    fun brandNameProblem(raw: String): String? {
        val name = raw.trim()
        return when {
            name.length < 2 -> "Enter your shop's name."
            name.length > 40 -> "Keep it to 40 characters."
            else -> null
        }
    }

    /** "@kachi", "kachi" or an instagram.com link → "kachi"; null when it isn't one. */
    fun instagramHandleOf(raw: String): String? {
        val s = raw.trim()
        if (s.isEmpty()) return null
        var h = s
        instagramLink.find(s)?.let { h = it.groupValues[1] }
        h = h.removePrefix("@")
        return if (instagramHandle.matches(h)) h else null
    }

    fun websiteValid(raw: String): Boolean = website.matches(raw.trim())

    /** The Instagram / website step: at least one, each well-formed. Returns (field, message) or null. */
    fun presenceProblem(instagram: String, website: String): Pair<String, String>? {
        val ig = instagram.trim()
        val web = website.trim()
        if (ig.isEmpty() && web.isEmpty()) return "instagram" to "Add your Instagram or your website, so Yard can see what you sell."
        if (ig.isNotEmpty() && instagramHandleOf(ig) == null) return "instagram" to "Enter an Instagram handle like @yourshop."
        if (web.isNotEmpty() && !websiteValid(web)) return "website" to "Enter your website address, like yourshop.com."
        return null
    }

    fun categoryProblem(selected: List<String>): String? = if (selected.isEmpty()) "Choose what you sell." else null

    /**
     * The API takes ONE category: the first one tapped is the primary (the others only help the
     * person think; they are not sent). See android/Docs/studio.md.
     */
    fun primaryCategory(selected: List<String>): String? = selected.firstOrNull()

    fun cityProblem(raw: String): String? {
        val city = raw.trim()
        return when {
            city.length < 2 -> "Enter your city."
            city.length > 80 -> "Keep it to 80 characters."
            else -> null
        }
    }

    fun countryProblem(code: String?): String? = if (code == null || code !in countries) "Choose a country Yard sells in." else null

    /** The phone's region when Yard sells there, else none (the person picks). */
    fun defaultCountry(locale: Locale = Locale.getDefault()): String? = locale.country.uppercase().takeIf { it in countries }

    /** "Nigeria" for "NG", in the phone's language. */
    fun countryName(code: String): String =
        runCatching { Locale.Builder().setRegion(code).build().displayCountry }.getOrNull()?.ifBlank { null } ?: code

    /** A flag emoji for a country code ("NG" → 🇳🇬). */
    fun flag(code: String): String =
        if (code.length != 2) "" else code.uppercase().map { Character.toChars(0x1F1E6 + (it - 'A')).concatToString() }.joinToString("")

    /** The body the server takes (blank optional fields omitted: the body is strict). */
    fun body(name: String, instagram: String, website: String, category: String, city: String, country: String): StudioApplyBody =
        StudioApplyBody(
            brandName = name.trim(),
            instagram = instagram.trim().takeIf { it.isNotEmpty() },
            website = website.trim().takeIf { it.isNotEmpty() },
            category = category,
            city = city.trim(),
            country = country,
        )

    /** Which step shows the server's field error. */
    fun stepFor(field: String): SellStep = when (field) {
        "brandName" -> SellStep.Name
        "instagram", "website" -> SellStep.Presence
        "category" -> SellStep.Category
        "city", "country" -> SellStep.Location
        else -> SellStep.Review
    }
}

/** One question per screen. */
enum class SellStep(val index: Int) {
    Name(0), Presence(1), Category(2), Location(3), Review(4);

    companion object { const val COUNT = 5 }
}

/**
 * "Sell on Yard": the short application (docs/APP.md › Shop or sell). One question per screen,
 * validated with [SellRules] before moving on, then POST /api/studio/apply.
 */
class SellApplicationModel(
    private val store: StudioStore?,
    previewCategories: List<StudioCategory>? = null,
    initialCountry: String? = SellRules.defaultCountry(),
) : ViewModel() {
    var step by mutableStateOf(SellStep.Name)
        private set
    /** True after moving back (the screen slides the other way). */
    var movingBack by mutableStateOf(false)
        private set

    var brandName by mutableStateOf("")
    var instagram by mutableStateOf("")
    var website by mutableStateOf("")
    /** Which presence field the Instagram / website toggle shows. */
    var showsWebsite by mutableStateOf(false)
    val selected = mutableStateListOf<String>()
    var city by mutableStateOf("")
    var country by mutableStateOf(initialCountry)

    var categories by mutableStateOf(previewCategories.orEmpty())
        private set
    var categoriesLoading by mutableStateOf(previewCategories == null)
        private set
    var categoriesError by mutableStateOf<String?>(null)
        private set

    /** The problem shown under the current step's input. */
    var problem by mutableStateOf<String?>(null)
        private set
    /** A whole-application error (409, 422, 429, offline) shown on the review step. */
    var submitError by mutableStateOf<String?>(null)
        private set
    var isSubmitting by mutableStateOf(false)
        private set
    var result by mutableStateOf<StudioApplyResult?>(null)
        private set
    /** An application already waiting (GET /api/studio/apply) — no need to ask again. */
    var existing by mutableStateOf<StudioApplication?>(null)
        private set

    val progress: Float get() = (step.index + 1).toFloat() / SellStep.COUNT
    val primaryCategory: StudioCategory? get() = SellRules.primaryCategory(selected)?.let { slug -> categories.firstOrNull { it.slug == slug } }

    fun load() {
        val store = store ?: return
        viewModelScope.launch {
            try {
                val app = store.latestApplication()
                if (app != null && app.isWaiting) existing = app
                if (app != null && app.isRejected && brandName.isEmpty()) brandName = app.brand?.name.orEmpty()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Optional: the application still works without it.
            }
        }
        loadCategories()
    }

    fun loadCategories() {
        val store = store ?: return
        categoriesLoading = true
        categoriesError = null
        viewModelScope.launch {
            try {
                categories = store.categories()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                categoriesError = APIError.messageFor(if (e is APIError) e else APIError.network(e))
            } finally {
                categoriesLoading = false
            }
        }
    }

    fun toggle(slug: String) {
        if (slug in selected) selected.remove(slug) else selected.add(slug)
        problem = null
    }

    fun clearProblem() {
        problem = null
    }

    /** The current step's problem, or null when it can move on. */
    fun currentProblem(): String? = when (step) {
        SellStep.Name -> SellRules.brandNameProblem(brandName)
        SellStep.Presence -> SellRules.presenceProblem(instagram, website)?.let { (field, message) ->
            showsWebsite = field == "website"
            message
        }
        SellStep.Category -> SellRules.categoryProblem(selected)
        SellStep.Location -> SellRules.cityProblem(city) ?: SellRules.countryProblem(country)
        SellStep.Review -> null
    }

    /** Validates and moves on; false (with [problem] set) when the answer isn't right yet. */
    fun next(): Boolean {
        val issue = currentProblem()
        problem = issue
        if (issue != null) return false
        val nextStep = SellStep.entries.getOrNull(step.index + 1) ?: return true
        movingBack = false
        step = nextStep
        return true
    }

    /** One step back; false on the first step (the caller closes the flow). */
    fun back(): Boolean {
        val previous = SellStep.entries.getOrNull(step.index - 1) ?: return false
        movingBack = true
        problem = null
        submitError = null
        step = previous
        return true
    }

    fun goTo(target: SellStep) {
        movingBack = target.index < step.index
        step = target
    }

    /** POST /api/studio/apply. Errors land on the step they belong to, in friendly words. */
    suspend fun submit(): Boolean {
        val store = store ?: return false
        for (s in SellStep.entries.filter { it != SellStep.Review }) {
            val saved = step
            step = s
            val issue = currentProblem()
            if (issue != null) {
                problem = issue
                movingBack = true
                return false
            }
            step = saved
        }
        val category = SellRules.primaryCategory(selected) ?: return false
        val code = country ?: return false
        isSubmitting = true
        submitError = null
        try {
            result = store.submitApplication(SellRules.body(brandName, instagram, website, category, city, code))
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            val field = e.fields.keys.firstOrNull()
            when {
                e.status == 400 && field != null -> {
                    val target = SellRules.stepFor(field)
                    if (field == "website") showsWebsite = true
                    if (field == "instagram") showsWebsite = false
                    goTo(target)
                    problem = e.fields[field]
                }
                e.status == 409 -> submitError = e.message.ifBlank { "You have an application in progress on the website. Finish it there, then apply here." }
                e.status == 422 -> submitError = e.message
                e.isRateLimited -> submitError = "That's a lot of tries. Wait a minute, then slide again."
                e.isUnauthorized -> submitError = "Your session ended. Sign in again to apply."
                else -> submitError = e.message
            }
            return false
        } catch (e: Exception) {
            submitError = APIError.network(e).message
            return false
        } finally {
            isSubmitting = false
        }
    }

    companion object {
        /** Previews and screenshots: a model on [step] with answers filled in. */
        fun preview(step: SellStep, categories: List<StudioCategory>): SellApplicationModel =
            SellApplicationModel(store = null, previewCategories = categories, initialCountry = "NG").also { m ->
                m.brandName = "Kachi Studio"
                if (step.index >= SellStep.Presence.index) m.instagram = "kachi.studio"
                if (step.index >= SellStep.Category.index) categories.take(2).forEach { m.selected.add(it.slug) }
                if (step.index >= SellStep.Location.index) m.city = "Lagos"
                m.step = step
            }

        fun previewDone(categories: List<StudioCategory>): SellApplicationModel =
            preview(SellStep.Review, categories).also { m ->
                m.result = StudioApplyResult(
                    application = StudioApplication(id = "onb_preview", status = "submitted", brand = space.yardstore.app.features.studio.StudioApplicationBrand(id = "b_preview", handle = "kachi-studio", name = "Kachi Studio")),
                    websiteScan = space.yardstore.app.features.studio.StudioWebsiteScan(status = "started", importId = "imp_1"),
                )
            }
    }
}
