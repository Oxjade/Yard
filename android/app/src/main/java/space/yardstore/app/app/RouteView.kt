package space.yardstore.app.app

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import space.yardstore.app.features.around.AroundView
import space.yardstore.app.features.auth.SignInView
import space.yardstore.app.features.auth.WelcomeView
import space.yardstore.app.features.bag.BagView
import space.yardstore.app.features.bag.CheckoutView
import space.yardstore.app.features.brands.BrandProfileView
import space.yardstore.app.features.brands.BrandsDirectoryView
import space.yardstore.app.features.charts.ChartsView
import space.yardstore.app.features.drops.DropDetailView
import space.yardstore.app.features.drops.DropsView
import space.yardstore.app.features.drops.MyDropsView
import space.yardstore.app.features.inbox.BrandConversationView
import space.yardstore.app.features.inbox.ConversationView
import space.yardstore.app.features.inbox.InboxView
import space.yardstore.app.features.inbox.YardSupportConversationView
import space.yardstore.app.features.notifications.NotificationsView
import space.yardstore.app.features.orders.OrderConfirmationView
import space.yardstore.app.features.orders.OrderDetailView
import space.yardstore.app.features.orders.OrdersListView
import space.yardstore.app.features.product.ProductDetailView
import space.yardstore.app.features.saved.FollowingView
import space.yardstore.app.features.saved.SavedView
import space.yardstore.app.features.search.SearchView
import space.yardstore.app.features.shop.CategoriesView
import space.yardstore.app.features.shop.CollectionView
import space.yardstore.app.features.shop.ShopView
import space.yardstore.app.features.you.AddressesView
import space.yardstore.app.features.you.AppearanceView
import space.yardstore.app.features.you.LegalView
import space.yardstore.app.features.you.NotificationSettingsView
import space.yardstore.app.features.you.SettingsView
import space.yardstore.app.features.you.YouAccountView
import space.yardstore.app.features.you.YouView
import kotlin.reflect.typeOf

/**
 * Maps a [Route] to its feature screen. Mirrors `RouteView` in `Router.swift`. Feature agents
 * implement the named composables; never change a function name or parameter used here.
 */
@Composable
fun RouteView(route: Route) {
    when (route) {
        Route.BrandsDirectory -> BrandsDirectoryView()
        is Route.Brand -> BrandProfileView(handle = route.handle)
        is Route.Collection -> CollectionView(brand = route.brand, handle = route.handle)
        is Route.Product -> ProductDetailView(slug = route.slug)
        Route.Categories -> CategoriesView()
        is Route.Category -> ShopView(category = route.slug)
        Route.Shop -> ShopView(category = null)
        is Route.Search -> SearchView(query = route.query)
        Route.Bag -> BagView()
        Route.Checkout -> CheckoutView()
        is Route.OrderConfirmation -> OrderConfirmationView(checkoutId = route.checkoutId)
        Route.Orders -> OrdersListView()
        is Route.Order -> OrderDetailView(id = route.id)
        Route.Drops -> DropsView()
        is Route.Drop -> DropDetailView(id = route.id)
        Route.MyDrops -> MyDropsView()
        Route.SignIn -> SignInView()
        Route.Welcome -> WelcomeView()
        Route.You -> YouView()
        Route.Settings -> SettingsView()
        Route.Appearance -> AppearanceView()
        Route.NotificationSettings -> NotificationSettingsView()
        Route.Addresses -> AddressesView()
        Route.Account -> YouAccountView()
        is Route.Legal -> LegalView(page = route.page)
        Route.Inbox -> InboxView()
        is Route.Conversation -> ConversationView(id = route.id)
        is Route.MessageBrand -> BrandConversationView(brandId = route.brandId)
        is Route.YardSupport -> YardSupportConversationView(orderId = route.orderId, orderRef = route.orderRef)
        Route.Saved -> SavedView()
        Route.Following -> FollowingView()
        Route.Charts -> ChartsView()
        Route.Around -> AroundView()
        Route.Notifications -> NotificationsView()
    }
}

/** iOS-like push: the new screen slides in from the right, the old one drifts left. */
internal val pushEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition =
    { slideInHorizontally(tween(320)) { it } }
internal val pushExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition =
    { slideOutHorizontally(tween(320)) { -it / 4 } + fadeOut(tween(320), targetAlpha = 0.6f) }
internal val popEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition =
    { slideInHorizontally(tween(320)) { -it / 4 } + fadeIn(tween(320), initialAlpha = 0.6f) }
internal val popExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition =
    { slideOutHorizontally(tween(320)) { it } }

private inline fun <reified T : Route> NavGraphBuilder.routeDestination(
    noinline content: @Composable (NavBackStackEntry, Route) -> Unit,
) {
    composable<T>(
        enterTransition = pushEnter,
        exitTransition = pushExit,
        popEnterTransition = popEnter,
        popExitTransition = popExit,
    ) { entry -> content(entry, entry.toRoute<T>()) }
}

/**
 * Registers every [Route] on a NavHost (iOS `.yardRouteDestinations()`). [content] renders a
 * destination; `RootView` wraps [RouteView] with the screen's back action.
 */
fun NavGraphBuilder.yardRouteDestinations(content: @Composable (NavBackStackEntry, Route) -> Unit) {
    routeDestination<Route.BrandsDirectory>(content)
    routeDestination<Route.Brand>(content)
    routeDestination<Route.Collection>(content)
    routeDestination<Route.Product>(content)
    routeDestination<Route.Categories>(content)
    routeDestination<Route.Category>(content)
    routeDestination<Route.Shop>(content)
    routeDestination<Route.Search>(content)
    routeDestination<Route.Bag>(content)
    routeDestination<Route.Checkout>(content)
    routeDestination<Route.OrderConfirmation>(content)
    routeDestination<Route.Orders>(content)
    routeDestination<Route.Order>(content)
    routeDestination<Route.Drops>(content)
    routeDestination<Route.Drop>(content)
    routeDestination<Route.MyDrops>(content)
    routeDestination<Route.SignIn>(content)
    routeDestination<Route.Welcome>(content)
    routeDestination<Route.You>(content)
    routeDestination<Route.Settings>(content)
    routeDestination<Route.Appearance>(content)
    routeDestination<Route.NotificationSettings>(content)
    routeDestination<Route.Addresses>(content)
    routeDestination<Route.Account>(content)
    composable<Route.Legal>(
        typeMap = mapOf(typeOf<LegalPage>() to NavType.EnumType(LegalPage::class.java)),
        enterTransition = pushEnter,
        exitTransition = pushExit,
        popEnterTransition = popEnter,
        popExitTransition = popExit,
    ) { entry -> content(entry, entry.toRoute<Route.Legal>()) }
    routeDestination<Route.Inbox>(content)
    routeDestination<Route.Conversation>(content)
    routeDestination<Route.MessageBrand>(content)
    routeDestination<Route.YardSupport>(content)
    routeDestination<Route.Saved>(content)
    routeDestination<Route.Following>(content)
    routeDestination<Route.Charts>(content)
    routeDestination<Route.Around>(content)
    routeDestination<Route.Notifications>(content)
}
