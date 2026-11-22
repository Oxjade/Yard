package space.yardstore.app.features.studio

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.edit
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.BrandMember
import space.yardstore.app.core.models.Shopper
import space.yardstore.app.core.models.ShopperBrand
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.SessionStore
import kotlin.coroutines.cancellation.CancellationException

/** Which half of the app is showing. */
enum class AppMode(val raw: String) {
    Shopping("shopping"),
    Studio("studio");

    companion object {
        fun from(raw: String?): AppMode? = entries.firstOrNull { it.raw == raw }
    }
}

/**
 * The pure decisions behind Studio mode (unit-tested).
 */
object StudioModeRules {
    /**
     * The mode to show after sign-in / launch: Studio when the account has a Studio-capable brand,
     * unless the person last chose shopping (the last mode is remembered).
     */
    fun initialMode(brands: List<ShopperBrand>, lastMode: AppMode?): AppMode {
        if (brands.none { it.canOpenStudio }) return AppMode.Shopping
        return lastMode ?: AppMode.Studio
    }

    /** The brand Studio opens: the remembered one if it can still open, else the first that can (oldest first). */
    fun pickBrand(brands: List<ShopperBrand>, lastBrandId: String?): ShopperBrand? {
        val open = brands.filter { it.canOpenStudio }
        return open.firstOrNull { it.id == lastBrandId } ?: open.firstOrNull()
    }

    /**
     * Whether to ask "What brings you to Yard?": a signed-in, non-demo account that never answered on
     * this device and isn't already a brand member (members are sellers: no question).
     */
    fun needsRoleChoice(shopper: Shopper?, answered: Boolean): Boolean =
        shopper != null && !shopper.demo && !answered && shopper.brands.isEmpty()
}

/** Local answers: the role choice per account and the last mode / brand. SharedPreferences `yard`. */
class StudioPrefs(private val prefsProvider: () -> SharedPreferences? = { Config.preferences }) {
    private val memory = mutableMapOf<String, String>()
    private val prefs: SharedPreferences? get() = prefsProvider()

    private fun get(key: String): String? = prefs?.getString(key, null) ?: memory[key]
    private fun put(key: String, value: String?) {
        if (value == null) memory.remove(key) else memory[key] = value
        prefs?.edit { if (value == null) remove(key) else putString(key, value) }
    }

    /** "shop" | "sell" for [userId], or null when never answered here. */
    fun roleChoice(userId: String): String? = get("$ROLE_PREFIX$userId")
    fun setRoleChoice(userId: String, role: String) = put("$ROLE_PREFIX$userId", role)

    var lastMode: AppMode?
        get() = AppMode.from(get(MODE_KEY))
        set(value) = put(MODE_KEY, value?.raw)

    var lastBrandId: String?
        get() = get(BRAND_KEY)
        set(value) = put(BRAND_KEY, value)

    companion object {
        const val ROLE_PREFIX = "yard.role."
        const val MODE_KEY = "yard.studio.mode"
        const val BRAND_KEY = "yard.studio.brand"
    }
}

/** Thrown by [StudioStore.call] when the shopper session itself is gone (the switch answered 401). */
class StudioSignedOut : Exception("Your session ended. Sign in again.")

/**
 * Studio mode: which brand is open, the brand session (`yard_b`) and every Studio API call.
 * App-scoped (`AppContainer.studio`), Compose state; read it with `LocalStudioStore.current`.
 *
 * - [call] opens the brand session first when needed (POST /api/studio/session/switch), and on a
 *   401 from any `/api/studio/…` call switches again silently and retries once. A 401 from the
 *   switch itself means the shopper session is gone: the session is re-read and [StudioSignedOut]
 *   is thrown.
 * - [enter] / [leave] flip the mode (remembered), [selectBrand] changes brand (re-switches).
 * - [openLink] handles `yard://studio/…` links and Studio push taps.
 */
class StudioStore(
    internal val api: APIClient,
    private val session: SessionStore,
    val prefs: StudioPrefs = StudioPrefs(),
    /** Tests only: prefix paths with a mock server's base URL. */
    internal val baseOverride: String? = null,
) {
    var mode: AppMode by mutableStateOf(AppMode.Shopping)
        private set
    /** The brand Studio shows (its id); the brand session follows it. */
    var activeBrandId: String? by mutableStateOf(null)
        private set
    /** The open brand session's profile (role, permissions), after the first switch. */
    var profile: BrandMember? by mutableStateOf(null)
        private set
    /** A deep link waiting for the Studio shell. */
    var pendingLink: StudioLink? by mutableStateOf(null)
    /** The short application ("Sell on Yard") is showing. Open it with [openApplication]. */
    var showsApplication: Boolean by mutableStateOf(false)
    /** A fresh key per opening, so each application starts clean. */
    var applicationKey: Int by mutableStateOf(0)
        private set

    fun openApplication() {
        applicationKey += 1
        showsApplication = true
    }
    /** The brand picker sheet is showing. */
    var showsBrandPicker: Boolean by mutableStateOf(false)
    /** The open brand's currency (from the dashboard), for prices typed in Quick add. */
    var brandCurrency: String? by mutableStateOf(null)
    /** Bumped on every brand change, so screens reload. */
    var generation: Int by mutableStateOf(0)
        private set

    private var switchedBrandId: String? = null
    private val switchLock = Mutex()
    private var appliedForUser: String? = null

    internal fun p(path: String): String = baseOverride?.let { it.trimEnd('/') + path } ?: path

    val brands: List<ShopperBrand> get() = session.shopper?.brands.orEmpty()
    val studioBrands: List<ShopperBrand> get() = brands.filter { it.canOpenStudio }
    val canOpenStudio: Boolean get() = studioBrands.isNotEmpty()
    val activeBrand: ShopperBrand? get() = studioBrands.firstOrNull { it.id == activeBrandId } ?: studioBrands.firstOrNull()
    val isStudio: Boolean get() = mode == AppMode.Studio && canOpenStudio

    /** Has the open profile [permission]? Unknown (no switch yet) → true, the server still decides. */
    fun can(permission: String): Boolean = profile?.can(permission) ?: true

    /**
     * Applies the remembered mode once per signed-in account (launch, sign-in). Signed out:
     * shopping, nothing open.
     */
    fun sessionChanged() {
        val shopper = session.shopper
        if (shopper == null) {
            appliedForUser = null
            mode = AppMode.Shopping
            activeBrandId = null
            profile = null
            switchedBrandId = null
            return
        }
        val picked = StudioModeRules.pickBrand(shopper.brands, prefs.lastBrandId ?: activeBrandId)
        if (picked?.id != activeBrandId) {
            activeBrandId = picked?.id
            generation += 1
        }
        if (appliedForUser != shopper.id) {
            appliedForUser = shopper.id
            mode = StudioModeRules.initialMode(shopper.brands, prefs.lastMode)
        } else if (picked == null) {
            mode = AppMode.Shopping
        }
    }

    /** Switches to Studio (optionally on [brandId]). */
    fun enter(brandId: String? = null) {
        if (brandId != null && studioBrands.any { it.id == brandId }) selectBrand(brandId)
        if (activeBrandId == null) activeBrandId = StudioModeRules.pickBrand(brands, prefs.lastBrandId)?.id
        if (activeBrandId == null) return
        mode = AppMode.Studio
        prefs.lastMode = AppMode.Studio
    }

    /** Back to shopping (the brand session stays open for next time). */
    fun leave() {
        mode = AppMode.Shopping
        prefs.lastMode = AppMode.Shopping
    }

    fun selectBrand(brandId: String) {
        if (brandId == activeBrandId) return
        activeBrandId = brandId
        prefs.lastBrandId = brandId
        profile = null
        brandCurrency = null
        generation += 1
    }

    private var pendingBrandId: String? = null
    private var linkWaiting = false

    /**
     * A Studio link or push tap: switch brand when it names one, enter Studio, then route. Before
     * the session has loaded (a cold start from a notification) it waits for [resolvePendingLink].
     */
    fun openLink(link: StudioLink, brandId: String? = null) {
        pendingLink = link
        pendingBrandId = brandId
        linkWaiting = true
        resolvePendingLink()
    }

    /** Applies a waiting link once the session is known; drops it when this account has no Studio. */
    fun resolvePendingLink() {
        if (!linkWaiting || !session.hasLoaded) return
        linkWaiting = false
        if (!canOpenStudio) {
            pendingLink = null
            return
        }
        enter(pendingBrandId)
        pendingBrandId = null
    }

    /** The "What brings you to Yard?" answer for [shopper] (stored per account on this device). */
    fun recordRole(shopper: Shopper, role: String) {
        prefs.setRoleChoice(shopper.id, role)
        roleRevision += 1
    }

    /** Bumped when a role is recorded (recomposes [needsRoleChoice] readers). */
    var roleRevision: Int by mutableStateOf(0)
        private set

    val needsRoleChoice: Boolean
        get() {
            roleRevision
            val s = session.shopper ?: return false
            return StudioModeRules.needsRoleChoice(s, prefs.roleChoice(s.id) != null)
        }

    // region Brand session

    /** POST /api/studio/session/switch for [brandId]. Throws [StudioSignedOut] on 401. */
    suspend fun switchTo(brandId: String): BrandMember? {
        try {
            val r: StudioSwitchResult = api.post(p("/api/studio/session/switch"), StudioSwitchBody(brandId))
            switchedBrandId = brandId
            if (brandId == activeBrandId) profile = r.profile
            return r.profile
        } catch (e: APIError) {
            if (e.isUnauthorized) {
                switchedBrandId = null
                runCatching { session.refresh() }
                throw StudioSignedOut()
            }
            throw e
        }
    }

    private suspend fun ensureSwitched(force: Boolean = false) {
        val brand = activeBrandId ?: activeBrand?.id ?: throw APIError(0, "no_brand", "Pick a brand to open Studio.")
        switchLock.withLock {
            if (force || switchedBrandId != brand) switchTo(brand)
        }
    }

    /**
     * Runs a Studio request with the brand session open: switch first if this brand isn't the open
     * one, then on a 401 switch again and retry once.
     */
    suspend fun <T> call(block: suspend (api: APIClient) -> T): T {
        ensureSwitched()
        return try {
            block(api)
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (!e.isUnauthorized) throw e
            ensureSwitched(force = true)
            block(api)
        }
    }

    /** Leaving Studio for good on this device: POST /api/auth/sign-out?actor=brand (keeps the shopper). */
    suspend fun signOutBrand() {
        try {
            api.send(HTTPMethod.POST, p("/api/auth/sign-out"), query = listOf("actor" to "brand"))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
        switchedBrandId = null
        profile = null
    }

    /** Forgets the switched brand (e.g. the cookie jar was cleared). */
    internal fun forgetSwitch() {
        switchedBrandId = null
    }

    internal val switchedBrandForTests: String? get() = switchedBrandId

    // endregion
}

/** The app's [StudioStore]. */
val LocalStudioStore = staticCompositionLocalOf<StudioStore> { error("StudioStore not provided (wrap in RootView or a preview)") }
