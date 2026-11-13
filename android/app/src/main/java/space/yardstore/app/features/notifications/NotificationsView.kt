package space.yardstore.app.features.notifications

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SegmentedPill
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * In-app notifications: orders, drops, messages and news from followed brands.
 * Grouped Today / Earlier, unread dots, tap → the page it is about, Mark all read.
 * Mirrors `NotificationsView.swift` (wording from the website's /notifications page).
 */
@Composable
fun NotificationsView() {
    val model: NotificationsViewModel = viewModel { NotificationsViewModel() }
    NotificationsScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationsScreen(model: NotificationsViewModel) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(session.shopper?.id ?: "signed-out") {
        if (session.isSignedIn) model.load() else model.reset()
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Notifications") {
            if (session.isSignedIn && model.items.isNotEmpty()) {
                val enabled = model.unreadCount > 0 && !model.isMarkingAll
                GlassIconButton(
                    Icons.Outlined.CheckCircle,
                    contentDescription = "Mark all as read",
                    modifier = Modifier.alpha(if (enabled) 1f else 0.4f),
                ) {
                    if (!enabled) return@GlassIconButton
                    model.markAllRead(
                        onSuccess = { haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
                        onError = { toast.show(it) },
                    )
                }
            }
        }

        Box(Modifier.fillMaxWidth().weight(1f)) {
            when {
                !session.isSignedIn -> if (session.hasLoaded) {
                    EmptyState(
                        title = "Sign in to see your notifications",
                        message = "Order updates and drop alerts are tied to your account.",
                        icon = Icons.Outlined.NotificationsNone,
                        actionTitle = "Sign in",
                    ) { router.present(Route.SignIn) }
                } else {
                    NotificationsSkeleton()
                }
                else -> when (val phase = model.phase) {
                    NotificationsViewModel.Phase.Idle, NotificationsViewModel.Phase.Loading -> NotificationsSkeleton()
                    is NotificationsViewModel.Phase.Failed -> EmptyState.Error(message = phase.message) { model.load().join() }
                    NotificationsViewModel.Phase.Loaded -> NotificationsList(model)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationsList(model: NotificationsViewModel) {
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val darkTheme = Color.yard.isDark
    val scope = rememberCoroutineScope()
    var isRefreshing by remember { mutableStateOf(false) }
    val refreshState = rememberPullToRefreshState()
    val bottomInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    fun open(item: ShopperNotification) {
        // A failed mark-read shouldn't block navigation; the dot comes back on failure.
        if (!item.read) model.setRead(true, item)
        val route = item.route
        val href = item.href
        if (route != null) {
            if (route == Route.Notifications) return
            router.push(route)
        } else if (href != null && href.startsWith("/") && !href.startsWith("//")) {
            // A Yard page the app doesn't have: open it on the website.
            WebPages.open(context, Config.webUrl(href), darkTheme = darkTheme)
        }
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            scope.launch {
                isRefreshing = true
                model.load().join()
                isRefreshing = false
            }
        },
        state = refreshState,
        modifier = Modifier.fillMaxSize(),
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = refreshState,
                isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Color.yard.surface,
                color = Color.yard.ink,
            )
        },
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = Spacing.gutter,
                end = Spacing.gutter,
                top = Spacing.s,
                bottom = Spacing.xxl + bottomInset,
            ),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            item(key = "header", contentType = "header") { NotificationsHeader() }

            if (model.items.isNotEmpty()) {
                item(key = "filter", contentType = "filter") {
                    SegmentedPill(
                        selection = model.filter,
                        options = NotificationsViewModel.Filter.entries,
                        onSelect = { model.filter = it },
                    ) { filter ->
                        when (filter) {
                            NotificationsViewModel.Filter.All -> "All ${model.items.size}"
                            NotificationsViewModel.Filter.Unread -> "Unread ${model.unreadCount}"
                        }
                    }
                }
            }

            val sections = model.sections
            if (sections.isEmpty()) {
                item(key = "empty", contentType = "empty") {
                    Box(Modifier.padding(top = Spacing.xl).animateItem()) {
                        if (model.filter == NotificationsViewModel.Filter.Unread && model.items.isNotEmpty()) {
                            EmptyState(
                                title = "Nothing unread",
                                message = "You're all caught up.",
                                icon = Icons.Outlined.CheckCircle,
                                actionTitle = "Show all",
                            ) { model.filter = NotificationsViewModel.Filter.All }
                        } else {
                            EmptyState(
                                title = "No notifications here yet",
                                message = "When something happens that needs you, it shows up here: orders, drops and news from the brands you follow.",
                                icon = Icons.Outlined.NotificationsOff,
                            )
                        }
                    }
                }
            } else {
                items(sections, key = { "section-${it.id}" }, contentType = { "section" }) { section ->
                    Column(
                        Modifier.animateItem(fadeInSpec = Motion.fade(), placementSpec = Motion.spring(), fadeOutSpec = Motion.fade()),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s),
                    ) {
                        Text(
                            section.title,
                            style = YardFonts.headline,
                            color = Color.yard.ink2,
                            modifier = Modifier.padding(start = Spacing.xs).semantics { heading() },
                        )
                        Card(Modifier.animateContentSize(Motion.spring()), padding = 0.dp) {
                            section.items.forEachIndexed { index, item ->
                                if (index > 0) YardDivider(Modifier.padding(start = 64.dp))
                                NotificationsRowButton(
                                    item = item,
                                    onOpen = { open(item) },
                                    onToggleRead = { model.setRead(!item.read, item) { toast.show(it) } },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationsHeader() {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        YardDisplayText("Notifications", size = 40.sp, color = Color.yard.ink)
        Text("Orders, drops and news from the brands you follow.", style = YardFonts.callout, color = Color.yard.ink2)
    }
}

/** The row as a button: tap opens, long-press shows Mark as read / unread (iOS context menu). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NotificationsRowButton(item: ShopperNotification, onOpen: () -> Unit, onToggleRead: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    var menuOpen by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, Motion.snappy(), label = "row-press")
    val toggleLabel = if (item.read) "Mark as unread" else "Mark as read"

    Box {
        NotificationsListRow(
            notification = item,
            modifier = Modifier
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .combinedClickable(
                    interactionSource = interaction,
                    indication = null,
                    onClickLabel = "Open",
                    onLongClickLabel = toggleLabel,
                    onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menuOpen = true
                    },
                    onClick = onOpen,
                ),
        )
        DropdownMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false },
            shape = YardShapes.small,
            containerColor = Color.yard.surface2,
        ) {
            DropdownMenuItem(
                text = { Text(toggleLabel, style = YardFonts.body) },
                leadingIcon = { Icon(if (item.read) Icons.Outlined.MarkEmailUnread else Icons.Outlined.Drafts, contentDescription = null) },
                colors = MenuDefaults.itemColors(textColor = Color.yard.ink, leadingIconColor = Color.yard.ink),
                onClick = {
                    menuOpen = false
                    onToggleRead()
                },
            )
        }
    }
}

/** Icon tile (per kind), title, body, time and an unread dot. Mirrors `NotificationsListRow`. */
@Composable
fun NotificationsListRow(notification: ShopperNotification, modifier: Modifier = Modifier) {
    val date = notification.date
    val meta = buildString {
        append(notification.kind.label)
        if (date != null) append(" · ").append(Formatters.relative(date))
    }
    Row(
        modifier
            .fillMaxWidth()
            .padding(Spacing.m)
            .semantics(mergeDescendants = true) {
                if (!notification.read) stateDescription = "Unread"
            },
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(40.dp).background(Color.yard.surface2, YardShapes.small).clearAndSetSemantics { },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                notification.kind.icon,
                contentDescription = null,
                tint = if (notification.read) Color.yard.ink2 else Color.yard.ink,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(
                notification.title,
                style = if (notification.read) YardFonts.body else YardFonts.bodyEmphasis,
                color = Color.yard.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (notification.body.isNotEmpty()) {
                Text(
                    notification.body,
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(meta, style = YardFonts.caption, color = Color.yard.ink3, modifier = Modifier.padding(top = Spacing.xxs))
        }
        Box(
            Modifier
                .padding(top = Spacing.s)
                .size(8.dp)
                .alpha(if (notification.read) 0f else 1f)
                .background(Color.yard.violet, CircleShape)
                .clearAndSetSemantics { },
        )
    }
}

// region Skeleton

@Composable
private fun NotificationsSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.s)
            .semantics { contentDescription = "Loading notifications" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.size(width = 220.dp, height = 36.dp), cornerRadius = Radius.small)
        Skeleton(Modifier.fillMaxWidth().height(44.dp), shape = SkeletonShape.Capsule)
        Card(padding = 0.dp) {
            repeat(6) {
                Row(Modifier.fillMaxWidth().padding(Spacing.m), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    Skeleton(Modifier.size(40.dp), cornerRadius = Radius.small)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        Skeleton(Modifier.fillMaxWidth().height(14.dp), cornerRadius = 6.dp)
                        Skeleton(Modifier.width(180.dp).height(12.dp), cornerRadius = 6.dp)
                        Skeleton(Modifier.width(80.dp).height(10.dp), cornerRadius = 6.dp)
                    }
                }
            }
        }
        Spacer(Modifier.height(Spacing.l))
    }
}

// endregion

// region Previews

private object NotificationsPreviewData {
    val items: List<ShopperNotification>
        get() {
            val now = Instant.now()
            fun at(offsetSeconds: Long): String = now.plusSeconds(offsetSeconds).toString()
            return listOf(
                ShopperNotification("nt_1", "drop.live:drp_1", "drop_update", "Night Shift is live", "Acme Studio just released it.", "/drops/night-shift", at(-600), false),
                ShopperNotification("nt_2", "msg:cv_1", "new_message", "Acme Studio replied", "Open your inbox to read it.", "/inbox?thread=cv_1", at(-3_600), false),
                ShopperNotification("nt_3", "shipped:ord_1", "delivery_update", "Acme Studio shipped your order", "Estimated arrival 14–18 Nov.", "/you/orders/ord_1", at(-90_000), true),
                ShopperNotification("nt_4", "price_drop:prd_1", "price_drop", "Price drop: Boxy tee", "Now $35, was $45.", "/products/boxy-tee", at(-300_000), true),
            )
        }
}

@Preview(name = "NotificationsView — dark")
@Composable
private fun NotificationsDarkPreview() = YardPreview(darkTheme = true) {
    NotificationsScreen(remember { NotificationsViewModel(items = NotificationsPreviewData.items) })
}

@Preview(name = "NotificationsView — light")
@Composable
private fun NotificationsLightPreview() = YardPreview(darkTheme = false) {
    NotificationsScreen(remember { NotificationsViewModel(items = NotificationsPreviewData.items) })
}

@Preview(name = "NotificationsView — signed out")
@Composable
private fun NotificationsSignedOutPreview() = YardPreview(darkTheme = true, signedIn = false) {
    NotificationsScreen(remember { NotificationsViewModel() })
}

@Preview(name = "NotificationsView — loading, light")
@Composable
private fun NotificationsLoadingPreview() = YardPreview(darkTheme = false) {
    NotificationsSkeleton()
}

// endregion
