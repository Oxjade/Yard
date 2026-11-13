package space.yardstore.app.app

import android.content.Context
import space.yardstore.app.core.AppearanceStore
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.SavedStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.components.ToastCenter

/**
 * The app-scoped objects, created once in `YardApp` (iOS: the `@State` stores in `YardApp`).
 * No DI framework: screens read the stores through CompositionLocals (`LocalSessionStore` …)
 * and the API through `APIClient.shared`.
 */
class AppContainer(context: Context) {
    val cookieJar = PersistentCookieJar(Config.preferences)
    val api: APIClient = APIClient(APIClient.buildHttpClient(cookieJar)).also { APIClient.install(it) }

    val session = SessionStore(api)
    val cart = CartStore(api)
    val follows = FollowStore(api)
    val saved = SavedStore(api)
    val router = Router()
    val toast = ToastCenter()
    val appearance = AppearanceStore(context)
}
