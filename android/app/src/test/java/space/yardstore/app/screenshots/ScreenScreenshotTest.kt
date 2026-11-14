package space.yardstore.app.screenshots

import android.app.Application
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import space.yardstore.app.app.AppContainer
import space.yardstore.app.app.RootView
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTheme
import space.yardstore.app.features.around.AroundFixtures
import space.yardstore.app.features.around.AroundPlacesList
import space.yardstore.app.features.around.AroundScreen
import space.yardstore.app.features.around.AroundViewModel
import space.yardstore.app.features.around.PlaceDetailView
import space.yardstore.app.features.auth.AuthProviders
import space.yardstore.app.features.auth.SignInModel
import space.yardstore.app.features.auth.SignInScreen
import space.yardstore.app.features.auth.WelcomeCategory
import space.yardstore.app.features.auth.WelcomeModel
import space.yardstore.app.features.auth.WelcomeScreen
import space.yardstore.app.features.bag.BagGroupQuote
import space.yardstore.app.features.bag.BagQuoteLoader
import space.yardstore.app.features.bag.BagView
import space.yardstore.app.features.bag.CheckoutModel
import space.yardstore.app.features.bag.CheckoutView
import space.yardstore.app.features.brands.BrandsDirectoryView
import space.yardstore.app.features.charts.ChartsView
import space.yardstore.app.features.drops.DropDetailViewModel
import space.yardstore.app.features.drops.DropsPreviewFixtures
import space.yardstore.app.features.drops.DropsViewModel
import space.yardstore.app.features.home.HomeView
import space.yardstore.app.features.inbox.InboxThreadPreviewData
import space.yardstore.app.features.inbox.InboxThreadScreen
import space.yardstore.app.features.inbox.InboxView
import space.yardstore.app.features.notifications.NotificationsViewModel
import space.yardstore.app.features.notifications.ShopperNotification
import space.yardstore.app.features.orders.OrderConfirmationModel
import space.yardstore.app.features.orders.OrderConfirmationScreen
import space.yardstore.app.features.orders.OrderDetailModel
import space.yardstore.app.features.orders.OrderDetailScreen
import space.yardstore.app.features.orders.OrderPreviewData
import space.yardstore.app.features.orders.OrdersListModel
import space.yardstore.app.features.orders.OrdersListScreen
import space.yardstore.app.features.product.ProductDetailModel
import space.yardstore.app.features.product.ProductDetailPreviewData
import space.yardstore.app.features.saved.SavedView
import space.yardstore.app.features.search.SearchHomeView
import space.yardstore.app.features.search.SearchLiveModel
import space.yardstore.app.features.search.SearchPreviewData
import space.yardstore.app.features.you.SettingsView
import space.yardstore.app.features.you.YouView
import java.time.Instant

/**
 * Screen screenshots without an emulator (Robolectric native graphics + Roborazzi) and the
 * permanent screen smoke test: every screen below must compose, lay out and draw without
 * crashing, in light and dark, at phone size (412×915dp) and — for a subset — tablet landscape
 * (1280×800dp, `LocalYardWindow` follows the configuration).
 *
 * Data: the feature agents' preview fixtures. Screens whose public composable loads from the API
 * run for real against [FakeYardBackend] (MockWebServer serving those fixtures as JSON); images
 * come from [FakeImages]. Nothing touches the real network.
 *
 *   ./gradlew :app:testDebugUnitTest --tests 'space.yardstore.app.screenshots.*'                              # smoke only
 *   ./gradlew :app:testDebugUnitTest --tests 'space.yardstore.app.screenshots.*' -Proborazzi.test.record=true # + PNGs
 *
 * PNGs land in `app/build/outputs/roborazzi/<screen>-<phone|tablet>-<dark|light>.png`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w412dp-h915dp-port-xhdpi")
class ScreenScreenshotTest(private val screen: String, private val dark: Boolean) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-phone-{1}")
        fun params(): List<Array<Any>> = YardScreens.phone.flatMap { listOf(arrayOf<Any>(it, true), arrayOf<Any>(it, false)) }
    }

    @get:Rule val compose = createComposeRule()

    @Test fun renders() = ScreenshotHarness.capture(compose, screen, "phone", dark)
}

@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w1280dp-h800dp-land-hdpi")
class TabletScreenScreenshotTest(private val screen: String, private val dark: Boolean) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-tablet-{1}")
        fun params(): List<Array<Any>> = YardScreens.tablet.flatMap { listOf(arrayOf<Any>(it, true), arrayOf<Any>(it, false)) }
    }

    @get:Rule val compose = createComposeRule()

    @Test fun renders() = ScreenshotHarness.capture(compose, screen, "tablet", dark)
}

object ScreenshotHarness {
    fun capture(compose: ComposeContentTestRule, screen: String, size: String, dark: Boolean) {
        val context: Context = RuntimeEnvironment.getApplication()
        val server = FakeYardBackend.start(context)
        FakeImages.install(context)
        try {
            compose.setContent { YardScreens.Render(screen, dark) }
            // Let API calls (MockWebServer threads → main looper), effects and animations settle.
            repeat(16) {
                compose.mainClock.advanceTimeBy(250)
                compose.waitForIdle()
                Thread.sleep(40)
            }
            compose.onRoot().captureRoboImage("build/outputs/roborazzi/$screen-$size-${if (dark) "dark" else "light"}.png")
        } finally {
            server.shutdown()
        }
    }
}

/** The screens, by file-name key. Each renders its real screen composable with preview fixtures. */
object YardScreens {
    val phone = listOf(
        "home", "product", "brand", "brands", "shop", "categories", "drops", "drop-detail", "bag", "checkout",
        "order-confirmation", "order-detail", "orders", "inbox", "conversation", "you", "settings", "charts",
        "search", "search-typing", "saved", "sign-in", "welcome", "notifications", "around", "around-list",
        "place-detail", "root",
    )
    val tablet = listOf("root", "home", "product", "brand", "shop", "drops", "inbox", "orders", "order-detail", "checkout", "sign-in", "charts")

    private const val F = "space.yardstore.app.features"

    @Composable
    fun Render(screen: String, dark: Boolean) {
        if (screen == "root") {
            val context = LocalContext.current
            val container = remember { AppContainer(context.applicationContext) }
            YardTheme(darkTheme = dark) { RootView(container) }
            return
        }
        YardPreview(darkTheme = dark, signedIn = screen != "sign-in") { Screen(screen) }
    }

    @Suppress("UNCHECKED_CAST")
    @Composable
    private fun Screen(screen: String) {
        when (screen) {
            "home" -> HomeView()
            "product" -> Reflect.PrivateComposable("$F.product.ProductDetailViewKt", "ProductDetailScreen",
                remember { ProductDetailModel(ProductDetailPreviewData.product) })
            "brand" -> Reflect.PrivateComposable("$F.brands.BrandProfileViewKt", "BrandProfileContent",
                remember { Reflect.call("$F.brands.BrandProfileViewKt", "brandProfilePreviewModel") })
            "brands" -> BrandsDirectoryView()
            "shop" -> Reflect.PrivateComposable("$F.shop.ShopViewKt", "ShopPreviewScreen", null, FakeYardBackend.products)
            "categories" -> Reflect.PrivateComposable("$F.shop.CategoriesViewKt", "CategoriesPreviewScreen")
            "drops" -> Reflect.PrivateComposable("$F.drops.DropsViewKt", "DropsScreen", remember {
                DropsViewModel(previewDrops = listOf(DropsPreviewFixtures.live, DropsPreviewFixtures.draw, DropsPreviewFixtures.upcoming, DropsPreviewFixtures.tomorrow, DropsPreviewFixtures.past))
            })
            "drop-detail" -> Reflect.PrivateComposable("$F.drops.DropDetailViewKt", "DropDetailScreen", remember {
                DropDetailViewModel(previewDrop = DropsPreviewFixtures.live, products = FakeYardBackend.products.take(4))
            })
            "bag" -> {
                val cart = remember { FakeYardBackend.cart }
                val quotes = remember { Reflect.objectProperty("$F.bag.BagPreviewData", "quotes") as List<BagGroupQuote> }
                CompositionLocalProvider(LocalCartStore provides remember { CartStore.preview(cart) }) {
                    BagView(quotes = remember { BagQuoteLoader.preview(cart, quotes) })
                }
            }
            "checkout" -> CheckoutView(remember { Reflect.call("$F.bag.CheckoutViewKt", "checkoutPreviewModel") as CheckoutModel })
            "order-confirmation" -> OrderConfirmationScreen("co_1", remember { OrderConfirmationModel(OrderPreviewData.checkout, OrderPreviewData.summaries) }, isPreview = true)
            "order-detail" -> OrderDetailScreen("or_1", remember { OrderDetailModel(OrderPreviewData.detail, brandCity = "Lagos") }, isPreview = true)
            "orders" -> OrdersListScreen(remember { OrdersListModel(OrderPreviewData.summaries) }, isPreview = true)
            "inbox" -> InboxView()
            "conversation" -> InboxThreadScreen(remember { InboxThreadPreviewData.model() }, autoLoad = false)
            "you" -> YouView()
            "settings" -> SettingsView()
            "charts" -> ChartsView()
            "search" -> SearchHomeView(
                model = remember { SearchLiveModel.preview("", emptyList(), emptyList(), SearchPreviewData.categories) },
                initialRecents = listOf("hoodie", "lagos"),
            )
            "search-typing" -> SearchHomeView(model = remember { SearchPreviewData.typingModel }, initialText = "hood", initialRecents = emptyList())
            "saved" -> SavedView()
            "sign-in" -> SignInScreen(remember { SignInModel(previewProviders = AuthProviders.preview()) })
            "welcome" -> WelcomeScreen(remember {
                WelcomeModel(previewCategories = listOf(WelcomeCategory("tops", "Tops"), WelcomeCategory("outerwear", "Outerwear"), WelcomeCategory("bottoms", "Bottoms"), WelcomeCategory("accessories", "Accessories")))
            })
            "notifications" -> Reflect.PrivateComposable("$F.notifications.NotificationsViewKt", "NotificationsScreen", remember {
                NotificationsViewModel(items = Reflect.objectProperty("$F.notifications.NotificationsPreviewData", "items") as List<ShopperNotification>)
            })
            "around" -> AroundScreen(remember { AroundViewModel(AroundFixtures.places) })
            "around-list" -> AroundPlacesList(
                places = AroundFixtures.places, totalCount = AroundFixtures.places.size, isLoading = false, error = null, isLocated = true, selectedId = null, now = Instant.now(),
                logo = { null }, distanceText = { "1.2 km" }, onSelect = {}, onRetry = {}, onShowAll = {}, onBrowseBrands = {},
            )
            "place-detail" -> PlaceDetailView(
                placeId = AroundFixtures.store.id, summary = AroundFixtures.store, distanceMeters = 1200.0, logoUrl = null,
                onBack = {}, onExit = {}, previewDetail = AroundFixtures.detail,
            )
            else -> error("Unknown screen $screen")
        }
    }
}
