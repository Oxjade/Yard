package space.yardstore.app.app

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import space.yardstore.app.core.AppearanceStore
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.SavedStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.features.you.YouRegion

/**
 * The app-scoped objects, created once in `YardApp` (iOS: the `@State` stores in `YardApp`).
 * No DI framework: screens read the stores through CompositionLocals (`LocalSessionStore` …)
 * and the API through `APIClient.shared`.
 */
class AppContainer(context: Context) {
    val cookieJar = PersistentCookieJar(Config.preferences)
    val api: APIClient = APIClient(APIClient.buildHttpClient(cookieJar)).also { APIClient.install(it) }

    val session = SessionStore(api)
    /** Restores the stored ship-to country before the first cart load (iOS `YouRegion.restore`). */
    val cart = CartStore(api).also { YouRegion.restore(it) }
    val follows = FollowStore(api)
    val saved = SavedStore(api)
    val router = Router()
    val toast = ToastCenter()
    val appearance = AppearanceStore(context)
    /** The route on top of each tab's stack, kept by `RootView` (for app-level link handling). */
    val tabTops = TabTopRoutes()
    /** App-lifetime work that must not die with the activity (e.g. consuming a one-time sign-in link). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
}

/**
 * What each tab's stack shows on top, as far as the app shell needs to know: the
 * [Route.OrderConfirmation] (with its checkout id) or [Route.Checkout]; any other screen or the
 * tab root is null. `RootView` keeps it current; `MainActivity` reads it to de-duplicate links.
 */
class TabTopRoutes {
    private val tops = mutableStateMapOf<AppTab, Route?>()

    operator fun get(tab: AppTab): Route? = tops[tab]

    /** The top route of every tab whose stack exists. */
    val all: Collection<Route?> get() = tops.values.toList()

    internal fun set(tab: AppTab, route: Route?) {
        tops[tab] = route
    }

    internal fun remove(tab: AppTab) {
        tops.remove(tab)
    }
}
