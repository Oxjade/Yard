package space.yardstore.app.features.studio

import space.yardstore.app.designsystem.components.YardTabBar
import space.yardstore.app.designsystem.components.YardTabBarItem
import space.yardstore.app.designsystem.components.YardTabBarDefaults
import space.yardstore.app.designsystem.components.yardTabBarSurface
import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.glassBackdropSource
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberGlassBackdrop
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.yardGlass
import space.yardstore.app.designsystem.GlassBackdrop
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.adaptiveContentWidth

/** Studio's tabs. Add is not a bar item: it opens Quick add over everything (Home's tile, Products' +). */
enum class StudioTab(val title: String, val icon: ImageVector, val selectedIcon: ImageVector) {
    Home("Home", Icons.Outlined.Home, Icons.Filled.Home),
    Orders("Orders", Icons.AutoMirrored.Outlined.ReceiptLong, Icons.AutoMirrored.Filled.ReceiptLong),
    Add("Add", Icons.Filled.Add, Icons.Filled.Add),
    Products("Products", Icons.Outlined.Inventory2, Icons.Filled.Inventory2),
    Me("Me", Icons.Outlined.Person, Icons.Filled.Person),
}

/** A screen pushed on a Studio tab. */
sealed interface StudioRoute {
    data class Order(val id: String) : StudioRoute
    data class Product(val id: String) : StudioRoute
    data object WebsitePieces : StudioRoute
    data class Suggestions(val focusAcceptAll: Boolean = false) : StudioRoute
    data object Payouts : StudioRoute
    data object Inbox : StudioRoute
    data class Thread(val id: String) : StudioRoute
    data object Support : StudioRoute
}

/**
 * Studio navigation: the tab, one stack per tab, and Quick add. Plain state (no NavHost): Studio's
 * screens are few and shallow. [show] maps a deep link to a tab and its stack (unit-tested).
 */
class StudioNav {
    var tab: StudioTab by mutableStateOf(StudioTab.Home)
        private set
    var showsAdd: Boolean by mutableStateOf(false)
    /** Opening the Orders tab with a filter (Home's "To do"). */
    var ordersTab: StudioOrdersTab? by mutableStateOf(null)
    /** Opening the Products tab with a filter (Home's "Low stock"). */
    var productsFilter: StudioProductFilter? by mutableStateOf(null)
    private val stacks = mutableStateMapOf<StudioTab, SnapshotStateList<StudioRoute>>()
    /** Set when the last action was a pop (screens slide the other way). */
    var popping: Boolean by mutableStateOf(false)
        private set

    fun stack(t: StudioTab): SnapshotStateList<StudioRoute> = stacks.getOrPut(t) { mutableStateListOf() }
    val top: StudioRoute? get() = stack(tab).lastOrNull()
    val depth: Int get() = stack(tab).size

    fun select(t: StudioTab) {
        if (t == StudioTab.Add) {
            showsAdd = true
            return
        }
        if (t == tab) stack(t).clear() else tab = t
    }

    fun push(route: StudioRoute, on: StudioTab = tab) {
        popping = false
        if (on != tab) tab = on
        stack(on).add(route)
    }

    fun pop(): Boolean {
        val s = stack(tab)
        if (s.isEmpty()) return false
        popping = true
        s.removeAt(s.lastIndex)
        return true
    }

    /** A deep link → tab + stack. */
    fun show(link: StudioLink) {
        showsAdd = false
        popping = false
        fun open(t: StudioTab, vararg routes: StudioRoute) {
            tab = t
            val s = stack(t)
            s.clear()
            s.addAll(routes)
        }
        when (link) {
            StudioLink.Home -> open(StudioTab.Home)
            StudioLink.Orders -> open(StudioTab.Orders)
            is StudioLink.Order -> open(StudioTab.Orders, StudioRoute.Order(link.id))
            StudioLink.Inbox -> open(StudioTab.Me, StudioRoute.Inbox)
            is StudioLink.Conversation -> open(StudioTab.Me, StudioRoute.Inbox, StudioRoute.Thread(link.id))
            StudioLink.Support -> open(StudioTab.Me, StudioRoute.Support)
            StudioLink.Products -> open(StudioTab.Products)
            is StudioLink.Product -> open(StudioTab.Products, StudioRoute.Product(link.id))
            is StudioLink.Suggestions -> open(StudioTab.Products, StudioRoute.Suggestions(link.focusAcceptAll))
            StudioLink.Payouts -> open(StudioTab.Me, StudioRoute.Payouts)
        }
    }

    fun reset() {
        stacks.clear()
        tab = StudioTab.Home
        showsAdd = false
    }
}

val LocalStudioNav = staticCompositionLocalOf<StudioNav> { error("StudioNav not provided") }

/** Space a Studio tab root leaves at the bottom for the floating pill. */
val StudioPillClearance = 108.dp

/**
 * Studio mode: five tabs in a floating glass pill (Home, Orders, the big Add, Products, Me), a
 * stack per tab, Quick add over everything and the brand picker. Brand changes reload every screen
 * (keyed by [StudioStore.generation]).
 */
@Composable
fun StudioRootView(nav: StudioNav = remember { StudioNav() }) {
    val studio = LocalStudioStore.current
    val context = LocalContext.current
    val reduce = rememberReducedMotion()

    val link = studio.pendingLink
    LaunchedEffect(link) {
        if (link != null) {
            nav.show(link)
            studio.pendingLink = null
        }
    }

    BackHandler {
        when {
            nav.showsAdd -> nav.showsAdd = false
            nav.pop() -> Unit
            nav.tab != StudioTab.Home -> nav.select(StudioTab.Home)
            else -> (context as? Activity)?.moveTaskToBack(true)
        }
    }

    CompositionLocalProvider(LocalStudioNav provides nav) {
        val backdrop = rememberGlassBackdrop()
        var visited by remember { mutableStateOf(setOf(StudioTab.Home)) }
        LaunchedEffect(nav.tab) { visited = visited + nav.tab }
        Box(Modifier.fillMaxSize().background(Color.yard.bg)) {
            key(studio.generation) {
                Box(Modifier.fillMaxSize().glassBackdropSource(backdrop).background(Color.yard.bg)) {
                    for (tab in StudioTab.entries) {
                        if (tab == StudioTab.Add || tab !in visited) continue
                        val selected = nav.tab == tab
                        Box(
                            Modifier.fillMaxSize().layout { m, c ->
                                val p = m.measure(c)
                                layout(p.width, p.height) { if (selected) p.place(0, 0) }
                            },
                        ) {
                            // Tablets: a readable column, centered (phones fill the width).
                            Box(Modifier.fillMaxSize().adaptiveContentWidth()) { StudioTabStack(tab, nav) }
                        }
                    }
                }
            }
            AnimatedVisibility(
                visible = nav.depth == 0 && !nav.showsAdd,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = slideInVertically(Motion.or(reduce) { Motion.emphasized() }) { it } + fadeIn(),
                exit = slideOutVertically(Motion.or(reduce) { Motion.standard() }) { it } + fadeOut(),
            ) {
                StudioPill(nav, backdrop, Modifier.navigationBarsPadding().padding(bottom = Spacing.s))
            }
            AnimatedVisibility(
                visible = nav.showsAdd,
                enter = slideInVertically(Motion.or(reduce) { Motion.emphasized() }) { it } + fadeIn(),
                exit = slideOutVertically(Motion.or(reduce) { Motion.standard() }) { it } + fadeOut(),
            ) {
                Box(Modifier.fillMaxSize().background(Color.yard.bg)) {
                    Box(Modifier.fillMaxSize().adaptiveContentWidth()) {
                        key(studio.generation) { StudioQuickAddView(onClose = { nav.showsAdd = false }) }
                    }
                }
            }
        }
        if (studio.showsBrandPicker) StudioBrandPicker(onDismiss = { studio.showsBrandPicker = false })
    }
}

@Composable
private fun StudioTabStack(tab: StudioTab, nav: StudioNav) {
    val stack = nav.stack(tab)
    val reduce = rememberReducedMotion()
    Box(Modifier.fillMaxSize()) {
        // The root stays composed under pushed screens (scroll position, loaded data).
        Box(
            Modifier.fillMaxSize().layout { m, c ->
                val p = m.measure(c)
                layout(p.width, p.height) { if (stack.isEmpty()) p.place(0, 0) }
            },
        ) {
            when (tab) {
                StudioTab.Home -> StudioHomeView()
                StudioTab.Orders -> StudioOrdersView()
                StudioTab.Products -> StudioProductsView()
                StudioTab.Me -> StudioMeView()
                StudioTab.Add -> Unit
            }
        }
        AnimatedContent(
            targetState = stack.lastOrNull(),
            transitionSpec = {
                if (reduce) {
                    fadeIn(Motion.instant()) togetherWith fadeOut(Motion.instant())
                } else if (nav.popping) {
                    (slideInHorizontally(Motion.navigation()) { -it / 4 } + fadeIn(Motion.crossfade()))
                        .togetherWith(slideOutHorizontally(Motion.navigation()) { it } + fadeOut(Motion.crossfade()))
                } else {
                    (slideInHorizontally(Motion.navigation()) { it } + fadeIn(Motion.crossfade()))
                        .togetherWith(slideOutHorizontally(Motion.navigation()) { -it / 4 } + fadeOut(Motion.crossfade()))
                }
            },
            label = "studio-stack-${tab.name}",
        ) { route ->
            if (route != null) {
                Box(Modifier.fillMaxSize().background(Color.yard.bg)) { StudioRouteView(route) }
            }
        }
    }
}

@Composable
private fun StudioRouteView(route: StudioRoute) {
    when (route) {
        is StudioRoute.Order -> StudioOrderDetailView(route.id)
        is StudioRoute.Product -> StudioProductDetailView(route.id)
        StudioRoute.WebsitePieces -> StudioWebsitePiecesView()
        is StudioRoute.Suggestions -> StudioSuggestionsView(route.focusAcceptAll)
        StudioRoute.Payouts -> StudioPayoutsView()
        StudioRoute.Inbox -> StudioInboxView()
        is StudioRoute.Thread -> StudioThreadView(conversationId = route.id)
        StudioRoute.Support -> StudioThreadView(conversationId = null)
    }
}

/**
 * The Studio tab bar (wallet inspo): a near-black floating bar with four plain icons; the selected
 * tab sits in an acid pill that slides between them. Add is not in the bar: Home's "Add product"
 * tile and the Products header open Quick add (`nav.select(StudioTab.Add)`), as before.
 */
@Composable
private fun StudioPill(nav: StudioNav, backdrop: GlassBackdrop, modifier: Modifier = Modifier) {
    val items = StudioTab.entries.filter { it != StudioTab.Add }.map { YardTabBarItem(it, it.title, it.icon, it.selectedIcon) }
    // The shopper app's own bar (YardTabBar): same capsule, icons and active pill with its label;
    // Studio only changes the tabs (no centre button) and the pill colour (acid).
    YardTabBar(
        items = items,
        selected = nav.tab,
        activeFill = Color.yard.acid,
        activeInk = Color.yard.onAcid,
        // The bar plays the tab haptic itself.
        onSelect = { item -> nav.select(item.key as StudioTab) },
        modifier = modifier,
        backdrop = backdrop,
    )
}

/** Pick which brand Studio runs (several memberships). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun StudioBrandPicker(onDismiss: () -> Unit) {
    val studio = LocalStudioStore.current
    val haptics = rememberYardHaptics()
    YardSheet(onDismissRequest = onDismiss, skipPartiallyExpanded = true) {
        YardSheetHeader("Your brands", subtitle = "Studio runs one brand at a time.", onClose = onDismiss)
        Column(Modifier.fillMaxWidth().padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            studio.brands.forEach { b ->
                val active = b.id == studio.activeBrand?.id
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (active) Color.yard.surface2 else Color.yard.surface, YardShapes.card)
                        .pressableClick(enabled = b.canOpenStudio, onClickLabel = "Open ${b.name}") {
                            haptics.tick()
                            studio.selectBrand(b.id)
                            onDismiss()
                        }
                        .padding(Spacing.m),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                ) {
                    StudioBrandMark(b.name, b.mark, b.logoSrc, size = 44.dp)
                    Column(Modifier.weight(1f)) {
                        Text(b.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            when {
                                b.isSuspended -> "Suspended: Studio can't open"
                                b.isPendingReview -> "In review · ${b.role}"
                                b.isRestricted -> "Paused by Yard · ${b.role}"
                                else -> b.role.replaceFirstChar { it.uppercase() }
                            },
                            style = YardFonts.caption,
                            color = Color.yard.ink3,
                        )
                    }
                    if (active) Icon(Icons.Outlined.Check, contentDescription = "Open now", tint = Color.yard.ink)
                }
            }
        }
    }
}
