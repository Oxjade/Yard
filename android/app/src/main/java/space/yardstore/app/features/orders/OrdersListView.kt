package space.yardstore.app.features.orders

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * One checkout: the brand orders it created (grouped the way the website does: checkout id,
 * else the group's reference). Mirrors `OrderCheckoutGroup`.
 */
data class OrderCheckoutGroup(
    val id: String,
    val reference: String,
    val placedAt: String,
    val currency: String,
    val totalMinor: Int,
    val orders: List<OrderSummary>,
) {
    val placedDate: Instant? get() = YardDate.parse(placedAt)
    val isOpen: Boolean get() = orders.any { it.status.isOpen }

    companion object {
        fun groups(items: List<OrderSummary>): List<OrderCheckoutGroup> {
            val byId = LinkedHashMap<String, OrderCheckoutGroup>()
            for (summary in items) {
                val key = summary.groupKey
                val group = byId[key]
                byId[key] = if (group != null) {
                    group.copy(orders = group.orders + summary, totalMinor = group.totalMinor + summary.totalMinor)
                } else {
                    OrderCheckoutGroup(key, summary.groupReference, summary.placedAt, summary.currency, summary.totalMinor, listOf(summary))
                }
            }
            return byId.values.sortedByDescending { it.placedAt }
        }
    }
}

/** The list's filter chips: All / In progress / Completed. */
enum class OrdersListFilter(val title: String) {
    All("All"),
    Open("In progress"),
    Closed("Completed"),
}

class OrdersListModel() : ViewModel() {
    var items by mutableStateOf<List<OrderSummary>>(emptyList()); private set
    var nextCursor by mutableStateOf<String?>(null); private set
    var isLoading by mutableStateOf(false); private set
    var isLoadingMore by mutableStateOf(false); private set
    var hasLoaded by mutableStateOf(false); private set
    var error by mutableStateOf<Throwable?>(null); private set

    /** Preview-only: fixture orders, no network. */
    constructor(previewItems: List<OrderSummary>) : this() {
        items = previewItems
        hasLoaded = true
    }

    val groups: List<OrderCheckoutGroup> get() = OrderCheckoutGroup.groups(items)

    suspend fun load() {
        isLoading = true
        try {
            val page = OrdersAPI.list()
            items = page.items
            nextCursor = page.nextCursor
            error = null
        } catch (e: CancellationException) {
            // The screen went away; keep what's shown and try again next time.
            isLoading = false
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) {
                isLoading = false
                return
            }
            error = e
        }
        isLoading = false
        hasLoaded = true
    }

    suspend fun loadMore() {
        val cursor = nextCursor ?: return
        if (isLoadingMore || isLoading) return
        isLoadingMore = true
        try {
            val page = OrdersAPI.list(before = cursor)
            val known = items.mapTo(HashSet()) { it.id }
            items = items + page.items.filter { it.id !in known }
            nextCursor = page.nextCursor
        } catch (e: CancellationException) {
            isLoadingMore = false
            throw e
        } catch (_: Exception) {
            // Keep what's shown; the "Load older orders" button stays to try again.
        }
        isLoadingMore = false
    }

    fun reset() {
        items = emptyList()
        nextCursor = null
        hasLoaded = false
        error = null
    }

    companion object {
        fun filter(groups: List<OrderCheckoutGroup>, filter: OrdersListFilter): List<OrderCheckoutGroup> = when (filter) {
            OrdersListFilter.All -> groups
            OrdersListFilter.Open -> groups.filter { it.isOpen }
            OrdersListFilter.Closed -> groups.filter { !it.isOpen }
        }
    }
}

/** The shopper's orders, one card per checkout, one row per brand order with its status chip. */
@Composable
fun OrdersListView() {
    val model: OrdersListModel = viewModel { OrdersListModel() }
    OrdersListScreen(model, isPreview = false)
}

@Composable
internal fun OrdersListScreen(model: OrdersListModel, isPreview: Boolean) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current

    LaunchedEffect(session.shopper?.id) {
        if (isPreview) return@LaunchedEffect
        if (!session.isSignedIn) {
            model.reset()
            return@LaunchedEffect
        }
        model.load()
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Orders")
        val error = model.error
        when {
            !isPreview && !session.isSignedIn -> {
                if (session.hasLoaded) {
                    EmptyState.SignedOut(
                        title = "Orders",
                        message = "Sign in to see every order you've placed. Each brand's part of a checkout has its own status, tracking and returns.",
                    ) { router.present(Route.SignIn) }
                } else {
                    OrdersListSkeleton()
                }
            }
            !model.hasLoaded || (model.isLoading && model.items.isEmpty() && error == null) -> OrdersListSkeleton()
            error != null && model.items.isEmpty() -> EmptyState.Error(error) { model.load() }
            model.items.isEmpty() -> OrderRefreshBox(onRefresh = { model.load() }) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Spacer(Modifier.height(Spacing.xxxl))
                    EmptyState(
                        "No orders yet",
                        message = "When you check out, every brand order and its tracking appears here.",
                        icon = Icons.Outlined.Inventory2,
                        actionTitle = "Start shopping",
                    ) { router.select(AppTab.Home) }
                }
            }
            else -> OrdersList(model)
        }
    }
}

@Composable
private fun OrdersList(model: OrdersListModel) {
    var filterName by rememberSaveable { mutableStateOf(OrdersListFilter.All.name) }
    val filter = OrdersListFilter.valueOf(filterName)
    val groups = model.groups
    val openCount = groups.count { it.isOpen }
    val visible = OrdersListModel.filter(groups, filter)
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val scope = rememberCoroutineScope()
    fun select(next: OrdersListFilter) { filterName = next.name }

    OrderRefreshBox(onRefresh = { model.load() }) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = Spacing.s, bottom = Spacing.xxxl + bottom),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            item(key = "intro") {
                Text(
                    "Orders from every brand you’ve checked out with. Each brand ships its own order, with its own tracking and returns.",
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                    modifier = Modifier.padding(horizontal = Spacing.gutter),
                )
            }
            item(key = "filters") {
                ChipRow {
                    Chip(OrdersListFilter.All.title, isSelected = filter == OrdersListFilter.All, count = groups.size) { select(OrdersListFilter.All) }
                    Chip(OrdersListFilter.Open.title, isSelected = filter == OrdersListFilter.Open, count = openCount) { select(OrdersListFilter.Open) }
                    Chip(OrdersListFilter.Closed.title, isSelected = filter == OrdersListFilter.Closed, count = groups.size - openCount) { select(OrdersListFilter.Closed) }
                }
            }
            if (visible.isEmpty()) {
                item(key = "filtered-empty") {
                    EmptyState(
                        if (filter == OrdersListFilter.Open) "Nothing in progress" else "No completed orders yet",
                        modifier = Modifier.padding(top = Spacing.xl),
                        message = if (filter == OrdersListFilter.Open) "Every order you've placed has arrived or been closed."
                        else "Orders move here once they're delivered, refunded or cancelled.",
                        icon = Icons.Outlined.FilterList,
                        actionTitle = "Show all orders",
                    ) { select(OrdersListFilter.All) }
                }
            } else {
                items(visible, key = { "group-${it.id}" }) { group ->
                    OrderCheckoutGroupCard(group, Modifier.padding(horizontal = Spacing.gutter).animateItem())
                }
            }
            if (model.nextCursor != null) {
                item(key = "more") {
                    LaunchedEffect(model.nextCursor) { model.loadMore() }
                    YardButton(
                        "Load older orders",
                        modifier = Modifier.padding(horizontal = Spacing.gutter),
                        style = YardButtonStyle.Secondary,
                        isLoading = model.isLoadingMore,
                    ) { scope.launch { model.loadMore() } }
                }
            }
            item(key = "footnote") {
                Text(
                    "Checkout totals are in the currency you checked out in. Returns are handled by each brand, within its own return window.",
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                    modifier = Modifier.padding(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.s),
                )
            }
        }
    }
}

/** One checkout card: reference, date, brand count, payment line, total; one row per brand order. */
@Composable
fun OrderCheckoutGroupCard(group: OrderCheckoutGroup, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val placed = group.placedDate?.let { "Placed ${OrderText.longDate(it)}" } ?: "Placed"
    val brands = if (group.orders.size == 1) "1 brand" else "${group.orders.size} brands shipping separately"
    Column(modifier.fillMaxWidth().yardCard().animateContentSize()) {
        Row(Modifier.padding(Spacing.l), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
                Text("Checkout ${group.reference}", style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("$placed, $brands", style = YardFonts.caption, color = Color.yard.ink2)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
                Text(OrderStatusText.groupPayment(group.orders), style = YardFonts.micro, color = Color.yard.ink3)
                Text(Formatters.price(group.totalMinor, group.currency), style = YardFonts.bodyEmphasis.monospacedDigits(), color = Color.yard.ink)
            }
        }
        group.orders.forEach { order ->
            YardDivider()
            OrderSummaryRow(order, Modifier.pressableClick { router.push(Route.Order(order.id)) })
        }
    }
}

/** One brand's part of a checkout. */
@Composable
fun OrderSummaryRow(order: OrderSummary, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { }
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        BrandAvatar(order.brand.name, size = 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(order.brand.name, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(order.itemsTitle, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "Order ${order.reference}, ${order.itemsCountText}, ${Formatters.price(order.totalMinor, order.currency)}",
                style = YardFonts.caption,
                color = Color.yard.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                Modifier.padding(top = Spacing.xxs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                OrderStatusChip(order.status)
                if (order.status == OrderStatus.Paid || order.status == OrderStatus.Processing) {
                    Text("Tracking appears when it ships", style = YardFonts.micro, color = Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun OrdersListSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState(), enabled = false)
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.fillMaxWidth().padding(end = 60.dp).height(14.dp), cornerRadius = 6.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            repeat(3) { Skeleton(Modifier.width(90.dp).height(34.dp), shape = SkeletonShape.Capsule) }
        }
        repeat(3) { Skeleton(Modifier.fillMaxWidth().height(190.dp), cornerRadius = Radius.card) }
    }
}

@Preview(name = "OrdersListView — dark")
@Composable
private fun OrdersListDarkPreview() = YardPreview(darkTheme = true) {
    OrdersListScreen(OrdersListModel(OrderPreviewData.summaries), isPreview = true)
}

@Preview(name = "OrdersListView — light")
@Composable
private fun OrdersListLightPreview() = YardPreview(darkTheme = false) {
    OrdersListScreen(OrdersListModel(OrderPreviewData.summaries), isPreview = true)
}
