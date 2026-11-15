package space.yardstore.app.features.you

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.features.drops.DropLivePhase
import space.yardstore.app.features.drops.MyDropsResponse
import space.yardstore.app.features.drops.livePhase
import space.yardstore.app.features.home.HomeInboxUnread
import space.yardstore.app.features.home.HomeNotificationsResponse
import space.yardstore.app.features.orders.OrdersPage
import java.time.Instant

// The You tab's quick links: ONE rounded panel holding a compact grid (3 × 2 on phones, 6 × 1 on
// wide windows) with hairline separators. Each link shows live state the app already has, and
// only that: never a made-up number; unknown or zero hides the badge. Mirrors YouQuickLinks.swift.

/**
 * Live counts for the quick links, from the same endpoints the rest of the app reads:
 * GET /api/inbox/unread (Home's badge), GET /api/notifications?as=shopper (Home's badge, Updates),
 * GET /api/orders (Orders), GET /api/drops/me (Your drops). Saved and Following come from the
 * stores. Each value is null until loaded, and stays null when its request fails.
 */
class YouBadgesModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    /** Conversations with unread messages. */
    var unreadConversations: Int? by mutableStateOf(null); private set
    /** Unread notifications (Updates). */
    var unreadNotifications: Int? by mutableStateOf(null); private set
    /** Orders still moving (the website's "In progress": awaiting payment → shipped, returns). */
    var ordersInProgress: Int? by mutableStateOf(null); private set
    /** Release reminders for drops that haven't ended. */
    var activeReminders: Int? by mutableStateOf(null); private set

    private var job: Job? = null
    private var loadedAt = 0L

    /** For tests: wait for the running load. */
    internal suspend fun awaitLoad() { job?.join() }

    /** Reloads (at most every [minIntervalMs] unless [force]); signed out clears everything. */
    fun refresh(signedIn: Boolean, force: Boolean = false, minIntervalMs: Long = 1500, now: Long = System.currentTimeMillis()) {
        if (!signedIn) {
            reset()
            return
        }
        if (!force && job?.isActive == true) return
        if (!force && now - loadedAt < minIntervalMs) return
        loadedAt = now
        job?.cancel()
        job = viewModelScope.launch { load() }
    }

    /** Clears every count and cancels a load in flight (so a previous account's answer can't land). */
    fun reset() {
        job?.cancel()
        job = null
        unreadConversations = null
        unreadNotifications = null
        ordersInProgress = null
        activeReminders = null
        loadedAt = 0L
    }

    private suspend fun load() = coroutineScope {
        val inbox = async { attempt { api.get<HomeInboxUnread>("/api/inbox/unread") } }
        val notes = async { attempt { api.get<HomeNotificationsResponse>("/api/notifications", listOf("as" to "shopper")) } }
        val orders = async { attempt { api.get<OrdersPage>("/api/orders", listOf("limit" to "50")) } }
        val drops = async { attempt { api.get<MyDropsResponse>("/api/drops/me") } }
        unreadConversations = inbox.await()?.conversations
        unreadNotifications = notes.await()?.items?.count { it.read == false }
        ordersInProgress = orders.await()?.items?.count { it.status.isOpen }
        val now = Instant.now()
        activeReminders = drops.await()?.reminders?.count { r -> r.drop?.let { it.livePhase(now) != DropLivePhase.Ended } == true }
    }

    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}

/** How a link's live state reads. */
internal sealed interface YouLinkBadge {
    /** Something needs a look (unread, in progress): acid count on the icon. */
    data class Attention(val count: Int, val spoken: String) : YouLinkBadge
    /** Unread, no number: a dot on the icon (Home's unread dot). */
    data class Dot(val spoken: String) : YouLinkBadge
    /** A quiet total beside the label (saved pieces, brands followed). */
    data class Total(val count: Int, val spoken: String) : YouLinkBadge
}

internal data class YouLink(val title: String, val icon: ImageVector, val route: Route, val badge: YouLinkBadge?)

/** The links and their badges from what is known. Zero or unknown → no badge. */
internal fun youLinks(
    saved: Int?,
    following: Int?,
    unreadConversations: Int?,
    unreadNotifications: Int?,
    ordersInProgress: Int?,
    activeReminders: Int?,
): List<YouLink> {
    fun positive(n: Int?): Int? = n?.takeIf { it > 0 }
    return listOf(
        YouLink("Orders", Icons.Outlined.Inventory2, Route.Orders, positive(ordersInProgress)?.let { YouLinkBadge.Attention(it, "$it in progress") }),
        YouLink("Saved", Icons.Outlined.FavoriteBorder, Route.Saved, positive(saved)?.let { YouLinkBadge.Total(it, "$it saved") }),
        YouLink("Following", Icons.Outlined.People, Route.Following, positive(following)?.let { YouLinkBadge.Total(it, "$it brands") }),
        YouLink("Inbox", Icons.Outlined.Forum, Route.Inbox, positive(unreadConversations)?.let { YouLinkBadge.Dot("$it unread") }),
        YouLink("Drop reminders", Icons.Outlined.NotificationsActive, Route.MyDrops, positive(activeReminders)?.let { YouLinkBadge.Total(it, "$it set") }),
        YouLink("Updates", Icons.Outlined.Notifications, Route.Notifications, positive(unreadNotifications)?.let { YouLinkBadge.Attention(it, "$it unread") }),
    )
}

/** Quick-link cells per row: 3 on phones (3 × 2), all 6 in one row on wide windows. */
internal fun youTileColumns(window: space.yardstore.app.designsystem.YardWindow): Int = if (window.isWide) 6 else 3

private val PanelShape = YardShapes.card
private val CellHeight = 78.dp

/** The quick-links panel (signed in). */
@Composable
internal fun YouQuickLinks(badges: YouBadgesModel) {
    val saved = LocalSavedStore.current
    val follows = LocalFollowStore.current
    val links = youLinks(
        saved = saved.items.size,
        following = follows.items.size,
        unreadConversations = badges.unreadConversations,
        unreadNotifications = badges.unreadNotifications,
        ordersInProgress = badges.ordersInProgress,
        activeReminders = badges.activeReminders,
    )
    val columns = youTileColumns(LocalYardWindow.current)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(PanelShape)
            .background(Color.yard.surface)
            .border(BorderStroke(1.dp, Color.yard.line), PanelShape),
    ) {
        links.chunked(columns).forEachIndexed { rowIndex, row ->
            if (rowIndex > 0) {
                Box(Modifier.padding(horizontal = Spacing.m).fillMaxWidth().height(1.dp).background(Color.yard.line))
            }
            Row(Modifier.fillMaxWidth().height(CellHeight)) {
                row.forEachIndexed { i, link ->
                    if (i > 0) CellSeparator()
                    YouLinkCell(link, Modifier.weight(1f).fillMaxHeight())
                }
            }
        }
    }
}

@Composable
private fun RowScope.CellSeparator() {
    Box(
        Modifier
            .padding(vertical = Spacing.m)
            .width(1.dp)
            .fillMaxHeight()
            .background(Color.yard.line),
    )
}

/** One cell: icon (with its live badge) above the label; press = 0.96 scale + highlight + tick. */
@Composable
private fun YouLinkCell(link: YouLink, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val reduce = rememberReducedMotion()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val highlight by animateFloatAsState(if (pressed) 1f else 0f, Motion.or(reduce) { Motion.press() }, label = "cell-highlight")
    val spoken = when (val b = link.badge) {
        is YouLinkBadge.Attention -> "${link.title}, ${b.spoken}"
        is YouLinkBadge.Dot -> "${link.title}, ${b.spoken}"
        is YouLinkBadge.Total -> "${link.title}, ${b.spoken}"
        null -> link.title
    }
    val highlightColor = Color.yard.ink.copy(alpha = 0.06f)
    Box(
        modifier
            .background(highlightColor.copy(alpha = highlightColor.alpha * highlight))
            .pressableClick(
                pressedScale = Motion.PRESSED_SCALE,
                pressedAlpha = 1f,
                onClickLabel = "Open ${link.title}",
                haptic = true,
                interactionSource = interaction,
            ) { router.push(link.route) }
            .semantics(mergeDescendants = true) { contentDescription = spoken },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Box {
                Icon(link.icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(22.dp))
                IconBadge(link.badge, Modifier.align(Alignment.TopEnd).offset(x = 9.dp, y = (-6).dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    link.title,
                    style = YardFonts.caption.copy(fontWeight = FontWeight.Medium),
                    color = Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                val total = (link.badge as? YouLinkBadge.Total)?.count
                AnimatedCount(total) { n ->
                    Text(Formatters.count(n), style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink3, maxLines = 1)
                }
            }
        }
    }
}

/** The acid count / dot on the icon, scaling in and out as the live state changes. */
@Composable
private fun IconBadge(badge: YouLinkBadge?, modifier: Modifier = Modifier) {
    val reduce = rememberReducedMotion()
    // Keep the last badge while it animates out.
    var shown by remember { mutableStateOf(badge) }
    if (badge is YouLinkBadge.Attention || badge is YouLinkBadge.Dot) shown = badge
    val visible = badge is YouLinkBadge.Attention || badge is YouLinkBadge.Dot
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = if (reduce) fadeIn(snap()) else scaleIn(Motion.emphasized()) + fadeIn(),
        exit = if (reduce) fadeOut(snap()) else scaleOut() + fadeOut(),
    ) {
        when (val b = shown) {
            is YouLinkBadge.Dot -> Box(
                Modifier
                    // The same unread dot as Home's header (danger, ringed in the panel colour).
                    .size(10.dp)
                    .background(Color.yard.surface, CircleShape)
                    .padding(1.5.dp)
                    .background(Color.yard.danger, CircleShape),
            )
            is YouLinkBadge.Attention -> Box(
                Modifier
                    .background(Color.yard.surface, YardShapes.pill)
                    .padding(1.5.dp)
                    .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                    .background(Color.yard.acid, YardShapes.pill)
                    // Light mode: a hairline so acid holds its edge on a white panel.
                    .border(BorderStroke(0.5.dp, if (Color.yard.isDark) Color.Transparent else Color.yard.ink.copy(alpha = 0.18f)), YardShapes.pill)
                    .padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (b.count > 99) "99+" else "${b.count}", style = YardFonts.micro.monospacedDigits(), color = Color.yard.onAcid)
            }
            else -> Unit
        }
    }
}

/** A count that rolls when it changes and fades out at null. */
@Composable
private fun AnimatedCount(count: Int?, content: @Composable (Int) -> Unit) {
    val reduce = rememberReducedMotion()
    AnimatedContent(
        targetState = count,
        transitionSpec = {
            if (reduce) fadeIn(snap()) togetherWith fadeOut(snap())
            else fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade())
        },
        label = "you-count",
    ) { n -> if (n != null) content(n) }
}
