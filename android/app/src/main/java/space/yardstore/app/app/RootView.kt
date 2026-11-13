package space.yardstore.app.app

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.OnBackPressedDispatcherOwner
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalLayoutDirection
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.ProvideYardWindow
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.toRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import space.yardstore.app.core.stores.LocalAppearanceStore
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BackAction
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardToastHost
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.bag.BagView
import space.yardstore.app.features.home.HomeView
import space.yardstore.app.features.liveactivity.LiveTrackingManager
import space.yardstore.app.features.notifications.YardPushNotifications
import space.yardstore.app.features.search.SearchView
import space.yardstore.app.features.you.YouView
import kotlin.math.sign

/**
 * Bottom space a screen must leave for the floating tab pill: `Spacing.tabPillClearance` + the
 * navigation-bar inset on tab roots, 0 on pushed screens and sheets. Add it to your scrolling
 * content's bottom padding (iOS gets this from `.safeAreaPadding(.bottom, …)` on tab roots).
 * On wide windows there is no bottom pill (the vertical [TabRail] is used), so tab roots get only
 * the navigation-bar inset; the shell already keeps every tab screen clear of the rail at the start.
 */
val LocalTabPillClearance = compositionLocalOf { 0.dp }

/** Sizes of the vertical tab rail shown on wide windows. */
object TabRailDefaults {
    /** The rail capsule's width (5dp padding + 58dp buttons + 5dp padding). */
    val railWidth: Dp = 68.dp
    /** Space between the window's start edge (after insets) and the rail, and between the rail and content. */
    val margin: Dp = Spacing.m
    /** Start space the shell reserves for the rail (content starts after it), excluding the start inset. */
    val reservedWidth: Dp = margin + railWidth + margin
}

/**
 * The app shell: one NavHost (back stack) per tab, the floating tab pill, the route sheet and the
 * toast host. Tabs are built lazily on first visit and kept alive. Mirrors `RootView.swift`.
 */
@Composable
fun RootView(container: AppContainer) {
    val router = container.router
    val session = container.session
    val cart = container.cart
    val follows = container.follows
    val saved = container.saved
    val toast = container.toast

    CompositionLocalProvider(
        LocalRouter provides router,
        LocalSessionStore provides session,
        LocalCartStore provides cart,
        LocalFollowStore provides follows,
        LocalSavedStore provides saved,
        LocalToastCenter provides toast,
        LocalAppearanceStore provides container.appearance,
    ) {
        var visitedTabs by rememberSaveable { mutableStateOf(setOf(AppTab.Home.name)) }
        LaunchedEffect(router.selectedTab) { visitedTabs = visitedTabs + router.selectedTab.name }

        ProvideYardWindow {
            val wide = LocalYardWindow.current.isWide
            val railVisible = wide && router.isTabRailVisible
            val startInset = WindowInsets.safeDrawing.only(WindowInsetsSides.Start).asPaddingValues()
                .calculateStartPadding(LocalLayoutDirection.current)
            // Content always starts after the rail on wide windows, so no screen sits under it.
            val railReserve by animateDpAsState(
                if (railVisible) TabRailDefaults.reservedWidth + startInset else 0.dp,
                Motion.spring(),
                label = "rail-reserve",
            )

            YardToastHost(toast, Modifier.fillMaxSize().background(Color.yard.bg)) {
                // The tab stacks keep the same position in the tree for every window size, so
                // rotating or unfolding never recreates a back stack.
                Box(Modifier.fillMaxSize().padding(start = railReserve)) {
                    for (tab in AppTab.entries) {
                        if (tab.name in visitedTabs) {
                            key(tab) { TabStack(tab, router, container.tabTops, selected = router.selectedTab == tab, wide = wide) }
                        }
                    }
                }
                AnimatedVisibility(
                    visible = !wide && router.isTabPillVisible,
                    modifier = Modifier.align(Alignment.BottomCenter),
                    enter = slideInVertically { it } + fadeIn(),
                    exit = slideOutVertically { it } + fadeOut(),
                ) {
                    TabPill(Modifier.navigationBarsPadding().padding(bottom = Spacing.s))
                }
                AnimatedVisibility(
                    visible = railVisible,
                    modifier = Modifier.align(Alignment.CenterStart),
                    enter = slideInHorizontally { -it } + fadeIn(),
                    exit = slideOutHorizontally { -it } + fadeOut(),
                ) {
                    TabRail(
                        Modifier
                            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Start + WindowInsetsSides.Vertical))
                            .padding(start = TabRailDefaults.margin),
                    )
                }
            }

            RouteSheetHost(router)
            // Notification channels, the soft "Never miss a drop" prompt and notification-tap routing.
            YardPushNotifications()
        }

        // Android back on a non-Home tab root goes to Home first (then leaves the app).
        BackHandler(enabled = router.sheet == null && router.depth == 0 && router.selectedTab != AppTab.Home) {
            router.select(AppTab.Home)
        }
    }

    LaunchedEffect(Unit) { session.refresh() }
    // Reload the shopper's data whenever who is signed in changes (launch, sign in, sign out).
    LaunchedEffect(session.shopper?.id ?: "signed-out") {
        cart.load()
        if (session.isSignedIn) {
            launch { follows.load() }
            launch { saved.load() }
        } else {
            follows.reset()
            saved.reset()
        }
    }
    // The app came back to the foreground (iOS scenePhase .active).
    var resumedOnce by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        // Launch and every foreground: refresh the running order-tracking notifications.
        scope.launch { LiveTrackingManager.resume() }
        if (resumedOnce) {
            scope.launch {
                session.refresh()
                cart.load()
            }
        }
        resumedOnce = true
    }
}

/** A dispatcher that nobody listens to: hidden tabs register their back handlers here. */
private class DetachedBackOwner(override val lifecycle: Lifecycle) : OnBackPressedDispatcherOwner {
    override val onBackPressedDispatcher = OnBackPressedDispatcher()
}

@Composable
private fun TabStack(tab: AppTab, router: Router, tops: TabTopRoutes, selected: Boolean, wide: Boolean) {
    val controller: NavHostController = rememberNavController()
    DisposableEffect(controller) {
        router.attach(tab, controller)
        onDispose {
            router.detach(tab, controller)
            tops.remove(tab)
        }
    }
    val topEntry by controller.currentBackStackEntryAsState()
    val top = topEntry?.let(::shellRelevantRoute)
    LaunchedEffect(tab, top) { tops.set(tab, top) }
    val realOwner = LocalOnBackPressedDispatcherOwner.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val detached = remember(lifecycle) { DetachedBackOwner(lifecycle) }
    val navBarBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    // Read through a State inside the NavHost builder so a change (rotation, wide ↔ compact) never
    // rebuilds the nav graph.
    val clearance = rememberUpdatedState(if (wide) navBarBottom else Spacing.tabPillClearance + navBarBottom)

    Box(
        Modifier
            .fillMaxSize()
            // Hidden tabs stay composed (state kept) but are neither placed, drawn nor touchable.
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                layout(placeable.width, placeable.height) { if (selected) placeable.place(0, 0) }
            },
    ) {
        CompositionLocalProvider(
            LocalOnBackPressedDispatcherOwner provides (if (selected && realOwner != null) realOwner else detached),
        ) {
            NavHost(
                navController = controller,
                startDestination = TabRoot,
                modifier = Modifier.fillMaxSize(),
                enterTransition = pushEnter,
                exitTransition = pushExit,
                popEnterTransition = popEnter,
                popExitTransition = popExit,
            ) {
                composable<TabRoot> {
                    CompositionLocalProvider(LocalBackAction provides null, LocalTabPillClearance provides clearance.value) {
                        when (tab) {
                            AppTab.Home -> HomeView()
                            AppTab.Search -> SearchView(query = "")
                            AppTab.Bag -> BagView()
                            AppTab.You -> YouView()
                        }
                    }
                }
                yardRouteDestinations { _, route ->
                    val back = remember(controller) { BackAction(isClose = false) { controller.popBackStack() } }
                    CompositionLocalProvider(LocalBackAction provides back, LocalTabPillClearance provides 0.dp) {
                        RouteView(route)
                    }
                }
            }
        }
    }
}

/** The top entry as far as [TabTopRoutes] cares: an order confirmation (with its id), checkout, or null. */
private fun shellRelevantRoute(entry: NavBackStackEntry): Route? = when {
    entry.destination.hasRoute<Route.OrderConfirmation>() -> runCatching { entry.toRoute<Route.OrderConfirmation>() }.getOrNull()
    entry.destination.hasRoute<Route.Checkout>() -> Route.Checkout
    else -> null
}

/** The route sheet (`router.present(…)`): its own back stack, toasts, × on its root. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RouteSheetHost(router: Router) {
    var shown by remember { mutableStateOf<Route?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val dialog = LocalYardWindow.current.sheetIsDialog
    LaunchedEffect(router.sheet) {
        val target = router.sheet
        if (target != null) {
            shown = target
        } else if (shown != null) {
            if (!dialog) runCatching { sheetState.hide() }
            shown = null
        }
    }
    val route = shown ?: return
    val toast = LocalToastCenter.current
    YardSheet(
        onDismissRequest = { router.dismissSheet(); shown = null },
        sheetState = sheetState,
        // Wide windows: a centered dialog surface (max 560dp) instead of a full-width bottom sheet.
        presentAsDialogOnWide = true,
    ) {
        key(route) {
            YardToastHost(toast, Modifier.fillMaxSize()) {
                val controller = rememberNavController()
                val close = remember(router) { BackAction(isClose = true) { router.dismissSheet() } }
                NavHost(
                    navController = controller,
                    startDestination = route,
                    modifier = Modifier.fillMaxSize(),
                    enterTransition = pushEnter,
                    exitTransition = pushExit,
                    popEnterTransition = popEnter,
                    popExitTransition = popExit,
                ) {
                    yardRouteDestinations { entry, r ->
                        val isRoot = remember(entry) { controller.previousBackStackEntry == null }
                        val back = if (isRoot) close else BackAction(isClose = false) { controller.popBackStack() }
                        CompositionLocalProvider(LocalBackAction provides back, LocalTabPillClearance provides 0.dp) {
                            RouteView(r)
                        }
                    }
                }
            }
        }
    }
}

// region Floating tab pill

@Composable
private fun BagBadge(count: Int, modifier: Modifier = Modifier) {
    AnimatedVisibility(visible = count > 0, modifier = modifier, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
        Box(
            Modifier
                .defaultMinSize(minWidth = 18.dp, minHeight = 18.dp)
                .background(Color.yard.ink, YardShapes.pill)
                .padding(horizontal = 5.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (count > 99) "99+" else "$count", style = YardFonts.micro.monospacedDigits(), color = Color.yard.bg)
        }
    }
}

/**
 * Home · Search · Bag (count badge) · You, in a translucent capsule hovering over content.
 * Collapses to a smaller pill while the user scrolls down (`Modifier.tabPillScrollSensor()`).
 * Mirrors `TabPill` in `RootView.swift` (Android: translucent surface, no backdrop blur).
 */
@Composable
fun TabPill(modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val cart = LocalCartStore.current
    val haptics = LocalHapticFeedback.current
    val collapsed = router.isTabPillCollapsed
    val scale by animateFloatAsState(if (collapsed) 0.86f else 1f, Motion.spring(), label = "pill-scale")
    val buttonWidth: Dp = if (collapsed) 48.dp else 58.dp
    val gap: Dp = if (collapsed) 2.dp else 6.dp
    val index = AppTab.entries.indexOf(router.selectedTab)
    val indicatorX by animateDpAsState((buttonWidth + gap) * index, Motion.spring(), label = "pill-indicator")

    Box(
        modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f)
            }
            .shadow(18.dp, YardShapes.pill, ambientColor = Color.yard.scrim.copy(alpha = 0.22f), spotColor = Color.yard.scrim.copy(alpha = 0.22f))
            .background(Color.yard.surface.copy(alpha = 0.9f), YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .padding(5.dp),
    ) {
        Box(
            Modifier
                .offset(x = indicatorX)
                .size(width = buttonWidth, height = 48.dp)
                .background(Color.yard.acid, YardShapes.pill),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
            for (tab in AppTab.entries) {
                val isSelected = router.selectedTab == tab
                val tint by animateColorAsState(if (isSelected) Color.yard.onAcid else Color.yard.ink, Motion.snappy(), label = "tab-tint")
                val label = if (tab == AppTab.Bag && cart.count > 0) "Bag, ${cart.count} item${if (cart.count == 1) "" else "s"}" else tab.title
                Box(
                    Modifier
                        .size(width = buttonWidth, height = 48.dp)
                        .semantics {
                            contentDescription = label
                            this.selected = isSelected
                        }
                        .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                            if (!isSelected) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            router.select(tab)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (isSelected) tab.selectedIcon else tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
                    if (tab == AppTab.Bag) {
                        BagBadge(cart.count, Modifier.align(Alignment.TopEnd).offset(x = (-6).dp, y = 4.dp))
                    }
                }
            }
        }
    }
}

/**
 * The wide-window version of [TabPill]: the same translucent capsule, icons, acid selection and
 * Bag badge, stacked vertically and floating at the start edge (centered vertically). Shown on
 * Medium/Expanded windows instead of the bottom pill; it does not collapse on scroll.
 */
@Composable
fun TabRail(modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val cart = LocalCartStore.current
    val haptics = LocalHapticFeedback.current
    val buttonSize = 58.dp
    val gap = 6.dp
    val index = AppTab.entries.indexOf(router.selectedTab)
    val indicatorY by animateDpAsState((buttonSize + gap) * index, Motion.spring(), label = "rail-indicator")

    Box(
        modifier
            .width(TabRailDefaults.railWidth)
            .shadow(18.dp, YardShapes.pill, ambientColor = Color.yard.scrim.copy(alpha = 0.22f), spotColor = Color.yard.scrim.copy(alpha = 0.22f))
            .background(Color.yard.surface.copy(alpha = 0.9f), YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .padding(5.dp)
            .selectableGroup(),
    ) {
        Box(
            Modifier
                .offset(y = indicatorY)
                .size(buttonSize)
                .background(Color.yard.acid, YardShapes.pill),
        )
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            for (tab in AppTab.entries) {
                val isSelected = router.selectedTab == tab
                val tint by animateColorAsState(if (isSelected) Color.yard.onAcid else Color.yard.ink, Motion.snappy(), label = "rail-tint")
                val label = if (tab == AppTab.Bag && cart.count > 0) "Bag, ${cart.count} item${if (cart.count == 1) "" else "s"}" else tab.title
                Box(
                    Modifier
                        .size(buttonSize)
                        .semantics {
                            contentDescription = label
                            this.selected = isSelected
                        }
                        .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                            if (!isSelected) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            router.select(tab)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (isSelected) tab.selectedIcon else tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
                    if (tab == AppTab.Bag) {
                        BagBadge(cart.count, Modifier.align(Alignment.TopEnd).offset(x = (-6).dp, y = 6.dp))
                    }
                }
            }
        }
    }
}

/**
 * Collapses the tab pill while scrolling down and restores it when scrolling up. Put it on a
 * tab-root scrolling container (iOS: `TabPillScrollSensor()` as the first child):
 *
 *   LazyColumn(Modifier.tabPillScrollSensor()) { … }
 */
fun Modifier.tabPillScrollSensor(): Modifier = composed {
    val router = LocalRouter.current
    val threshold = with(LocalDensity.current) { 14.dp.toPx() }
    val connection = remember(router, threshold) {
        object : NestedScrollConnection {
            var accumulated = 0f
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                // Pulling past the top: always show.
                if (available.y > 0f) {
                    router.isTabPillCollapsed = false
                    accumulated = 0f
                    return Offset.Zero
                }
                val dy = consumed.y
                if (dy == 0f) return Offset.Zero
                if (sign(dy) != sign(accumulated)) accumulated = 0f
                accumulated += dy
                if (accumulated < -threshold && !router.isTabPillCollapsed) router.isTabPillCollapsed = true
                if (accumulated > threshold && router.isTabPillCollapsed) router.isTabPillCollapsed = false
                return Offset.Zero
            }
        }
    }
    nestedScroll(connection)
}

// endregion
