package space.yardstore.app.app

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavController
import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import java.net.URI
import java.net.URLDecoder

// region Tabs

/** The four tabs of the floating tab pill. Mirrors `AppTab` in `Router.swift`. */
enum class AppTab(val title: String, val icon: ImageVector, val selectedIcon: ImageVector) {
    Home("Home", Icons.Outlined.Home, Icons.Filled.Home),
    Search("Search", Icons.Outlined.Search, Icons.Filled.Search),
    Bag("Bag", Icons.Outlined.ShoppingBag, Icons.Filled.ShoppingBag),
    You("You", Icons.Outlined.Person, Icons.Filled.Person),
}

// endregion

// region Routes

/** Legal pages (You › Legal). [path] is the website page; open `Config.webUrl(page.path)`. */
@Serializable
enum class LegalPage(val title: String, val path: String) {
    Terms("Terms", "/legal/terms"),
    Privacy("Privacy", "/legal/privacy"),
    Refunds("Refunds", "/legal/refunds"),
    DataDeletion("Data deletion", "/legal/data-deletion"),
}

/**
 * Every destination in the app. Mirrors `enum Route` in `Router.swift`, case for case, same
 * parameter names. Push with `router.push(Route.Product(slug = p.slug))`. `RouteView` maps each
 * case to its feature screen. Routes are `@Serializable` (Navigation Compose type-safe routes).
 */
@Serializable
sealed interface Route {
    // Brands
    @Serializable data object BrandsDirectory : Route
    @Serializable data class Brand(val handle: String) : Route
    @Serializable data class Collection(val brand: String, val handle: String) : Route

    // Product & shop
    @Serializable data class Product(val slug: String) : Route
    @Serializable data object Categories : Route
    @Serializable data class Category(val slug: String) : Route
    @Serializable data object Shop : Route
    @Serializable data class Search(val query: String) : Route

    // Bag & checkout
    @Serializable data object Bag : Route
    @Serializable data object Checkout : Route
    @Serializable data class OrderConfirmation(val checkoutId: String) : Route

    // Orders
    @Serializable data object Orders : Route
    @Serializable data class Order(val id: String) : Route

    // Drops
    @Serializable data object Drops : Route
    @Serializable data class Drop(val id: String) : Route
    @Serializable data object MyDrops : Route

    // Auth
    @Serializable data object SignIn : Route
    @Serializable data object Welcome : Route

    // You
    @Serializable data object You : Route
    @Serializable data object Settings : Route
    @Serializable data object Appearance : Route
    @Serializable data object NotificationSettings : Route
    @Serializable data object Addresses : Route
    @Serializable data class Legal(val page: LegalPage) : Route

    // Inbox
    @Serializable data object Inbox : Route
    @Serializable data class Conversation(val id: String) : Route
    @Serializable data class MessageBrand(val brandId: String) : Route

    // Saved
    @Serializable data object Saved : Route
    @Serializable data object Following : Route

    // Discovery
    @Serializable data object Charts : Route
    @Serializable data object Around : Route
    @Serializable data object Notifications : Route

    companion object {
        /**
         * Maps a Yard web URL or app link (`https://yardstore.space/products/x`, `/brands/acme`
         * relative to the site, `yard://drops/abc`) to a route. Null for pages the app doesn't
         * have. Mirrors `Route(url:)`.
         */
        fun fromUrl(url: String): Route? {
            val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return null
            val parts = (uri.path ?: "").split("/").filter { it.isNotEmpty() }.toMutableList()
            // yard://brands/acme → host "brands" is the first segment.
            if (uri.scheme == "yard") {
                val host = uri.host ?: uri.rawAuthority
                if (!host.isNullOrEmpty()) parts.add(0, host)
            }
            val query = parseQuery(uri.rawQuery)
            fun q(name: String): String? = query.firstOrNull { it.first == name }?.second

            val first = parts.firstOrNull() ?: return null
            val second = parts.getOrNull(1)
            return when (first) {
                "brands" -> when {
                    second == null -> BrandsDirectory
                    parts.size > 3 && parts[2] == "collections" -> Collection(brand = second, handle = parts[3])
                    else -> Brand(handle = second)
                }
                "products" -> second?.let { Product(slug = it) }
                "categories" -> if (second != null) Category(slug = second) else Categories
                "shop" -> q("category")?.let { Category(slug = it) } ?: Shop
                "search" -> Search(query = q("q") ?: "")
                "bag" -> Bag
                "checkout" -> {
                    val id = q("checkout") ?: q("id")
                    if (second == "confirmation" && id != null) OrderConfirmation(checkoutId = id) else Checkout
                }
                "drops" -> if (second != null) Drop(id = second) else Drops
                "you" -> when (second ?: "") {
                    "orders" -> if (parts.size > 2) Order(id = parts[2]) else Orders
                    "drops" -> MyDrops
                    "settings" -> Settings
                    else -> You
                }
                "inbox" -> (q("c") ?: q("conversation") ?: second)?.let { Conversation(id = it) } ?: Inbox
                "wishlist" -> Saved
                "following" -> Following
                "charts" -> Charts
                "around" -> Around
                "notifications" -> Notifications
                "sign-in" -> SignIn
                "welcome" -> Welcome
                "legal" -> when (second ?: "") {
                    "terms" -> Legal(LegalPage.Terms)
                    "privacy" -> Legal(LegalPage.Privacy)
                    "refunds" -> Legal(LegalPage.Refunds)
                    "data-deletion" -> Legal(LegalPage.DataDeletion)
                    else -> null
                }
                else -> null
            }
        }

        /** Maps a site path like "/drops/abc" (e.g. an announcement `href`). Mirrors `Route(path:)`. */
        fun fromPath(path: String): Route? {
            val url = Config.url(path) ?: return null
            return fromUrl(url)
        }

        /** Query items, decoded like `URLComponents.queryItems` (a literal `+` stays a plus). */
        private fun parseQuery(raw: String?): List<Pair<String, String?>> {
            if (raw.isNullOrEmpty()) return emptyList()
            return raw.split("&").filter { it.isNotEmpty() }.map { item ->
                val i = item.indexOf('=')
                val name = if (i >= 0) item.substring(0, i) else item
                val value = if (i >= 0) item.substring(i + 1) else null
                decode(name) to value?.let { decode(it) }
            }
        }

        private fun decode(s: String): String =
            runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)
    }
}

/** The start destination of every tab's NavHost (the tab root screen). Not a `Route`. */
@Serializable
data object TabRoot

// endregion

// region Router

/**
 * Navigation state: the selected tab, one back stack per tab (a NavHostController each), and a
 * modal sheet. Mirrors `Router` in `Router.swift`. Provided at the root: `val router = LocalRouter.current`.
 *
 *   router.push(Route.Brand(handle = "acme"))   // onto the current tab's stack
 *   router.present(Route.SignIn)                // as a sheet (with its own back stack)
 *   router.dismissSheet()
 *   router.select(AppTab.Bag)                   // switch tab (re-selecting pops to root)
 *   router.open(url)                            // deep link / app link
 */
class Router {
    var selectedTab: AppTab by mutableStateOf(AppTab.Home)
        private set
    /** The route shown as a sheet, if any. */
    var sheet: Route? by mutableStateOf(null)
        private set
    /** Set by `Modifier.tabPillScrollSensor()` while the user scrolls down; the pill collapses. */
    var isTabPillCollapsed: Boolean by mutableStateOf(false)
    /** Force-hide the floating pill (e.g. a full-screen composer). Reset it when you leave. */
    var isTabPillSuppressed: Boolean by mutableStateOf(false)

    private val depths = mutableStateMapOf<AppTab, Int>()
    private val controllers = mutableMapOf<AppTab, NavHostController>()
    private val listeners = mutableMapOf<AppTab, NavController.OnDestinationChangedListener>()
    private val pending = mutableMapOf<AppTab, MutableList<Route>>()

    /** Pushes onto the selected tab's stack. */
    fun push(route: Route) = push(route, selectedTab)

    /** Pushes onto [tab]'s stack (queued until that tab's NavHost exists). */
    fun push(route: Route, tab: AppTab) {
        val controller = controllers[tab]
        if (controller == null) {
            pending.getOrPut(tab) { mutableListOf() } += route
            depths[tab] = (depths[tab] ?: 0) + 1
        } else {
            controller.navigate(route)
        }
    }

    /** Pops one screen off the selected tab's stack. */
    fun pop() {
        val tab = selectedTab
        val controller = controllers[tab]
        if (controller == null) {
            pending[tab]?.removeLastOrNull()
            depths[tab] = pending[tab]?.size ?: 0
        } else if ((depths[tab] ?: 0) > 0) {
            controller.popBackStack()
        }
    }

    /** Pops a tab to its root. */
    fun popToRoot(tab: AppTab? = null) {
        val t = tab ?: selectedTab
        pending.remove(t)
        val controller = controllers[t]
        if (controller == null) {
            depths[t] = 0
        } else {
            controller.popBackStack<TabRoot>(inclusive = false)
        }
    }

    /** Selects a tab; selecting the current tab pops it to root. */
    fun select(tab: AppTab) {
        if (tab == selectedTab) popToRoot(tab) else selectedTab = tab
        isTabPillCollapsed = false
    }

    /** Switches to [tab] and pushes [route] there (e.g. "View order" from a notification). */
    fun show(route: Route, tab: AppTab) {
        selectedTab = tab
        popToRoot(tab)
        push(route, tab)
    }

    /** Presents a route modally (sign in, size guide…). */
    fun present(route: Route) {
        sheet = route
    }

    fun dismissSheet() {
        sheet = null
    }

    /** Number of screens pushed on the selected tab. */
    val depth: Int get() = depths[selectedTab] ?: 0

    /** Number of screens pushed on [tab]. */
    fun depth(tab: AppTab): Int = depths[tab] ?: 0

    /** Whether the floating pill is visible: only on tab roots, and not while suppressed or a sheet is up. */
    val isTabPillVisible: Boolean get() = depth == 0 && !isTabPillSuppressed && sheet == null

    /**
     * Whether the vertical tab rail (wide windows) is visible: on every screen of every tab (the
     * shell keeps content clear of it), hidden only while [isTabPillSuppressed].
     */
    val isTabRailVisible: Boolean get() = !isTabPillSuppressed

    /**
     * Opens a deep link. Tab roots switch tabs; other routes push on the current tab.
     * Returns false when the URL isn't an app destination (open it in a Custom Tab instead).
     */
    fun open(url: String): Boolean {
        val route = Route.fromUrl(url) ?: return false
        when {
            route == Route.Bag -> { select(AppTab.Bag); popToRoot(AppTab.Bag) }
            route == Route.You -> { select(AppTab.You); popToRoot(AppTab.You) }
            route == Route.SignIn -> present(Route.SignIn)
            route is Route.Search && route.query.isEmpty() -> select(AppTab.Search)
            else -> push(route)
        }
        return true
    }

    // region NavHost wiring (RootView only)

    /** Called by `RootView` when a tab's NavHost is created. Replays queued pushes. */
    fun attach(tab: AppTab, controller: NavHostController) {
        if (controllers[tab] === controller) return
        controllers[tab]?.let { old -> listeners[tab]?.let { old.removeOnDestinationChangedListener(it) } }
        controllers[tab] = controller
        val listener = NavController.OnDestinationChangedListener { c, _, _ ->
            depths[tab] = (c.currentBackStack.value.count { it.destination !is NavGraph } - 1).coerceAtLeast(0)
        }
        listeners[tab] = listener
        controller.addOnDestinationChangedListener(listener)
        pending.remove(tab)?.forEach { controller.navigate(it) }
    }

    /** Called by `RootView` when a tab's NavHost leaves composition. */
    fun detach(tab: AppTab, controller: NavHostController) {
        if (controllers[tab] !== controller) return
        listeners.remove(tab)?.let { controller.removeOnDestinationChangedListener(it) }
        controllers.remove(tab)
    }

    // endregion
}

/** The app's [Router]. */
val LocalRouter = staticCompositionLocalOf<Router> { error("Router not provided (wrap in RootView or YardPreview)") }

// endregion
