package space.yardstore.app.features.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridState
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.app.tabPillScrollSensor
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardLogo
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import kotlin.math.roundToInt

/**
 * Home: Pinterest-style discovery. Yard logo + notifications/inbox at the top, tabs
 * ("For you", "Following" when signed in, then every category with pieces), and an infinite
 * two-column masonry of products mixed with brand and drop tiles. Mirrors `HomeView.swift`.
 *
 * Endpoints: GET /api/catalog/categories, /api/catalog/products, /api/catalog/brands
 * (sort=new; founding=1), /api/drops?phase=live|upcoming, /api/follows (via FollowStore),
 * /api/notifications?as=shopper and /api/inbox/unread (badges, signed in only).
 */
@Composable
fun HomeView() {
    val model: HomeViewModel = viewModel { HomeViewModel() }
    val session = LocalSessionStore.current

    var selectedTabId by rememberSaveable { mutableStateOf(HomeTab.ForYou.id) }
    var lastSignedIn by remember { mutableStateOf(session.isSignedIn) }
    // Per-tab scroll positions (iOS resets a tab's scroll on switch; Android keeps it, like the feed).
    val gridStates = remember { HashMap<String, LazyStaggeredGridState>() }

    val tabs: List<HomeTab> = buildList {
        add(HomeTab.ForYou)
        if (session.isSignedIn) add(HomeTab.Following)
        model.categories.filter { it.productCount > 0 }.forEach { add(HomeTab.Category(it)) }
    }
    val selectedTab = tabs.firstOrNull { it.id == selectedTabId } ?: HomeTab.ForYou

    LaunchedEffect(Unit) { model.loadCategories() }
    LaunchedEffect(session.shopper?.id ?: "signed-out") { model.loadBadges(session.isSignedIn) }
    LaunchedEffect(session.isSignedIn) {
        if (lastSignedIn == session.isSignedIn) return@LaunchedEffect
        lastSignedIn = session.isSignedIn
        if (!session.isSignedIn && selectedTabId == HomeTab.Following.id) selectedTabId = HomeTab.ForYou.id
        model.cache.drop(HomeTab.Following.id)
        gridStates.remove(HomeTab.Following.id)
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        HomeHeader(unreadNotifications = model.unreadNotifications, unreadConversations = model.unreadConversations)
        HomeTabStrip(tabs = tabs, selectedId = selectedTab.id, onSelect = { selectedTabId = it })
        AnimatedContent(
            targetState = selectedTab,
            contentKey = { it.id },
            transitionSpec = { fadeIn(Motion.fade()) togetherWith fadeOut(Motion.fade()) },
            label = "home-tab",
            modifier = Modifier.fillMaxSize(),
        ) { tab ->
            HomeFeedView(
                model = model.cache.model(tab),
                gridState = gridStates.getOrPut(tab.id) { LazyStaggeredGridState() },
            )
        }
    }
}

// region Header

@Composable
private fun HomeHeader(unreadNotifications: Int, unreadConversations: Int) {
    val router = LocalRouter.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.bg)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.xs, bottom = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        YardLogo(Modifier.height(26.dp), color = Color.yard.ink)
        Spacer(Modifier.weight(1f))
        HomeHeaderButton(Icons.Outlined.Notifications, "Notifications", unreadNotifications) { router.push(Route.Notifications) }
        HomeHeaderButton(Icons.Outlined.Forum, "Inbox", unreadConversations) { router.push(Route.Inbox) }
    }
}

@Composable
private fun HomeHeaderButton(icon: ImageVector, label: String, badge: Int, onClick: () -> Unit) {
    val description = if (badge > 0) "$label, $badge unread" else label
    Box(
        Modifier
            .size(40.dp)
            .semantics { contentDescription = description }
            .pressableClick(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(24.dp))
        if (badge > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-7).dp, y = 7.dp)
                    .size(9.dp)
                    .background(Color.yard.danger, CircleShape)
                    .border(BorderStroke(1.5.dp, Color.yard.bg), CircleShape),
            )
        }
    }
}

// endregion

// region Tab strip

/** "For you · Following · Tops · …": text tabs with a sliding underline. */
@Composable
fun HomeTabStrip(tabs: List<HomeTab>, selectedId: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val scroll = rememberScrollState()
    /** Each tab's x and width (px) inside the row. */
    val frames = remember { mutableStateMapOf<String, Pair<Float, Int>>() }
    var viewportWidth by remember { mutableStateOf(0) }
    val gutterPx = with(density) { Spacing.gutter.toPx() }

    val selectedFrame = frames[selectedId]
    val underlineX by animateFloatAsState(selectedFrame?.first ?: 0f, Motion.spring(), label = "home-underline-x")
    val underlineW by animateFloatAsState((selectedFrame?.second ?: 0).toFloat(), Motion.spring(), label = "home-underline-w")

    // Keep the selected tab in view, centred.
    LaunchedEffect(selectedId, selectedFrame, viewportWidth) {
        val frame = selectedFrame ?: return@LaunchedEffect
        if (viewportWidth == 0) return@LaunchedEffect
        val target = gutterPx + frame.first + frame.second / 2f - viewportWidth / 2f
        scroll.animateScrollTo(target.roundToInt().coerceIn(0, scroll.maxValue), Motion.spring())
    }

    Box(
        modifier
            .fillMaxWidth()
            .background(Color.yard.bg)
            .padding(bottom = Spacing.s)
            .onSizeChanged { viewportWidth = it.width }
            .horizontalScroll(scroll),
    ) {
        Box(Modifier.padding(horizontal = Spacing.gutter)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                for (tab in tabs) {
                    val isSelected = tab.id == selectedId
                    val color by animateColorAsState(
                        if (isSelected) Color.yard.ink else Color.yard.ink2,
                        Motion.snappy(),
                        label = "home-tab-color",
                    )
                    Text(
                        tab.title,
                        style = YardFonts.headline,
                        color = color,
                        maxLines = 1,
                        modifier = Modifier
                            .onPlaced { frames[tab.id] = it.positionInParent().x to it.size.width }
                            .selectable(
                                selected = isSelected,
                                interactionSource = null,
                                indication = null,
                                role = Role.Tab,
                            ) {
                                if (!isSelected) {
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    onSelect(tab.id)
                                }
                            }
                            .padding(bottom = 9.dp),
                    )
                }
            }
            if (selectedFrame != null) {
                Box(
                    Modifier
                        .align(Alignment.BottomStart)
                        .offset { IntOffset(underlineX.roundToInt(), 0) }
                        .width(with(density) { underlineW.toDp() })
                        .height(3.dp)
                        .background(Color.yard.ink, YardShapes.pill),
                )
            }
        }
    }
}

// endregion

// region Feed

/** One tab's feed: skeleton, error, empty, or the masonry with infinite scroll and pull to refresh. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeFeedView(model: HomeFeedModel, gridState: LazyStaggeredGridState, modifier: Modifier = Modifier) {
    val follows = LocalFollowStore.current
    val followIds = follows.items.map { it.brandId }
    val isFollowingTab = model.tab == HomeTab.Following
    val bottomClearance = LocalTabPillClearance.current

    // Only the Following tab reloads when follows change.
    val followKey = if (!isFollowingTab) "static" else (if (follows.hasLoaded) "loaded:" else "loading:") + followIds.sorted().joinToString(",")
    LaunchedEffect(model, followKey) {
        if (isFollowingTab) {
            if (!follows.hasLoaded) return@LaunchedEffect
            if (model.phase == HomeFeedPhase.Idle) {
                model.loadIfNeeded(followIds)
            } else if (model.builtForFollowIds != followIds.toSet()) {
                model.refresh(followIds)
            }
        } else {
            model.loadIfNeeded(followIds)
        }
    }

    val pullState = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = model.isRefreshing,
        onRefresh = { model.refresh(followIds, pulled = true) },
        modifier = modifier.fillMaxSize(),
        state = pullState,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pullState,
                isRefreshing = model.isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Color.yard.surface,
                color = Color.yard.ink,
            )
        },
    ) {
        when (val phase = model.phase) {
            HomeFeedPhase.Idle, HomeFeedPhase.Loading -> HomeScrollColumn(bottomClearance) {
                MasonrySkeleton(
                    Modifier.padding(horizontal = Spacing.gridGap).padding(top = Spacing.xs),
                    count = 10,
                )
            }
            is HomeFeedPhase.Failed -> HomeScrollColumn(bottomClearance) {
                EmptyState.Error(message = phase.message, modifier = Modifier.padding(top = Spacing.xxl)) {
                    model.refresh(followIds).join()
                }
            }
            HomeFeedPhase.Loaded -> {
                if (model.items.isEmpty() && model.founding.isEmpty()) {
                    HomeScrollColumn(bottomClearance) {
                        HomeFeedEmptyState(model.tab, hasFollows = followIds.isNotEmpty(), modifier = Modifier.padding(top = Spacing.xxl))
                    }
                } else {
                    HomeFeedGrid(model, gridState, bottomClearance)
                }
            }
        }
    }
}

@Composable
private fun HomeScrollColumn(bottomClearance: androidx.compose.ui.unit.Dp, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .tabPillScrollSensor()
            .verticalScroll(rememberScrollState())
            .padding(bottom = bottomClearance),
    ) { content() }
}

@Composable
private fun HomeFeedGrid(model: HomeFeedModel, gridState: LazyStaggeredGridState, bottomClearance: androidx.compose.ui.unit.Dp) {
    val showFounding = model.tab == HomeTab.ForYou && model.founding.isNotEmpty()
    MasonryGrid(
        items = model.items,
        key = { it.id },
        modifier = Modifier.fillMaxSize().tabPillScrollSensor(),
        spacing = Spacing.gridGap,
        state = gridState,
        contentPadding = PaddingValues(
            start = Spacing.gridGap,
            end = Spacing.gridGap,
            top = Spacing.xs,
            bottom = bottomClearance + Spacing.l,
        ),
        header = if (!showFounding) null else {
            {
                item(key = "home-founding", span = StaggeredGridItemSpan.FullLine) {
                    // Cancel the grid's side padding so the rail runs edge to edge with gutters.
                    HomeFoundingRow(
                        model.founding,
                        Modifier
                            .padding(bottom = Spacing.l)
                            .layoutBleed(Spacing.gridGap),
                    )
                }
            }
        },
        footer = {
            item(key = "home-footer", span = StaggeredGridItemSpan.FullLine) { HomeFeedFooter(model) }
        },
        onLoadMore = { model.loadMore() },
    ) { item ->
        when (item) {
            is HomeFeedItem.ProductItem -> HomeProductTile(item.product)
            is HomeFeedItem.BrandItem -> HomeBrandTile(item.brand)
            is HomeFeedItem.DropItem -> HomeDropTile(item.drop)
        }
    }
}

/** Widens a full-line item by [bleed] on each side (undoes the grid's horizontal content padding). */
private fun Modifier.layoutBleed(bleed: androidx.compose.ui.unit.Dp): Modifier = this.then(
    Modifier.layout { measurable, constraints ->
        val extra = (bleed * 2).roundToPx()
        val wide = constraints.copy(
            minWidth = constraints.minWidth + extra,
            maxWidth = if (constraints.hasBoundedWidth) constraints.maxWidth + extra else constraints.maxWidth,
        )
        val placeable = measurable.measure(wide)
        layout(placeable.width - extra, placeable.height) { placeable.place(-extra / 2, 0) }
    },
)

@Composable
private fun HomeFeedFooter(model: HomeFeedModel) {
    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.l), contentAlignment = Alignment.Center) {
        when {
            model.isLoadingMore -> CircularProgressIndicator(
                color = Color.yard.ink2,
                strokeWidth = 2.dp,
                modifier = Modifier.size(22.dp),
            )
            model.loadMoreFailed -> YardButton(
                "Couldn't load more. Try again",
                icon = Icons.Outlined.Refresh,
                style = YardButtonStyle.Secondary,
                size = YardButtonSize.Small,
                fullWidth = false,
            ) { model.loadMore() }
            !model.hasMore && model.items.isNotEmpty() -> Text(
                "You're all caught up",
                style = YardFonts.caption,
                color = Color.yard.ink3,
            )
        }
    }
}

@Composable
private fun HomeFeedEmptyState(tab: HomeTab, hasFollows: Boolean, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    when (tab) {
        HomeTab.Following -> if (!hasFollows) {
            EmptyState(
                title = "Follow brands you like",
                modifier = modifier,
                message = "New pieces from the brands you follow arrive here, newest first.",
                icon = Icons.Outlined.FavoriteBorder,
                actionTitle = "Browse brands",
            ) { router.push(Route.BrandsDirectory) }
        } else {
            EmptyState(
                title = "Nothing new yet",
                modifier = modifier,
                message = "The brands you follow haven't published pieces yet. They'll show up here as soon as they do.",
                icon = Icons.Outlined.Schedule,
                actionTitle = "Find more brands",
            ) { router.push(Route.BrandsDirectory) }
        }
        HomeTab.ForYou -> EmptyState(
            title = "Nothing here yet",
            modifier = modifier,
            message = "Pieces from independent brands show up here as soon as they're published.",
            icon = Icons.Outlined.GridView,
        )
        is HomeTab.Category -> EmptyState(
            title = "No ${tab.category.name.lowercase()} yet",
            modifier = modifier,
            message = "Nothing has been published in this category yet.",
            icon = Icons.Outlined.GridView,
            actionTitle = "Shop everything",
        ) { router.push(Route.Shop) }
    }
}

// endregion

// region Previews (network screens preview their loading state)

@Preview(name = "HomeView — dark")
@Composable
private fun HomeViewDarkPreview() = YardPreview(darkTheme = true) { HomeView() }

@Preview(name = "HomeView — light")
@Composable
private fun HomeViewLightPreview() = YardPreview(darkTheme = false, signedIn = false) { HomeView() }

@Preview(name = "Home tab strip — dark")
@Composable
private fun HomeTabStripDarkPreview() = YardPreview(darkTheme = true) {
    HomeTabStrip(
        tabs = listOf(HomeTab.ForYou, HomeTab.Following, HomeTab.Category(HomeCategory("tops", "Tops", 12))),
        selectedId = HomeTab.ForYou.id,
        onSelect = {},
    )
}

@Preview(name = "Home tab strip — light")
@Composable
private fun HomeTabStripLightPreview() = YardPreview(darkTheme = false) {
    HomeTabStrip(
        tabs = listOf(HomeTab.ForYou, HomeTab.Following, HomeTab.Category(HomeCategory("tops", "Tops", 12))),
        selectedId = HomeTab.Following.id,
        onSelect = {},
    )
}

// endregion
