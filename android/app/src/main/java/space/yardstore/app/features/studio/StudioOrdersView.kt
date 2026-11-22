package space.yardstore.app.features.studio

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/**
 * Studio's order tabs and the list query each runs (docs/APP.md › Orders): New = paid, not yet
 * started (`fulfilment=unfulfilled`); To ship = being prepared (`fulfilment=processing`); Shipped;
 * Done = delivered and cancelled (two queries, merged newest first).
 */
enum class StudioOrdersTab(val title: String, val queries: List<List<Pair<String, String?>>>) {
    New("New", listOf(listOf("fulfilment" to "unfulfilled"))),
    ToShip("To ship", listOf(listOf("fulfilment" to "processing"))),
    Shipped("Shipped", listOf(listOf("fulfilment" to "shipped"))),
    Done("Done", listOf(listOf("fulfilment" to "delivered"), listOf("fulfilment" to "cancelled"))),
}

/** One tab's merged pages (pure merge, unit-tested). */
data class StudioOrdersPageState(
    val items: List<StudioOrderSummary> = emptyList(),
    /** One cursor per query (null when that query is done). */
    val cursors: List<String?> = emptyList(),
    val loaded: Boolean = false,
) {
    val hasMore: Boolean get() = cursors.any { it != null }

    companion object {
        /** Adds [pages] (one per query) to [existing], newest first, de-duplicated by id. */
        fun merge(existing: List<StudioOrderSummary>, pages: List<StudioOrdersPage>): StudioOrdersPageState {
            val all = (existing + pages.flatMap { it.items }).distinctBy { it.id }.sortedByDescending { it.placedAt }
            return StudioOrdersPageState(all, pages.map { it.nextCursor }, loaded = true)
        }
    }
}

class StudioOrdersModel(private val store: StudioStore?, preview: Map<StudioOrdersTab, List<StudioOrderSummary>>? = null) : ViewModel() {
    var tab by mutableStateOf(StudioOrdersTab.New)
    val pages = mutableStateMapOf<StudioOrdersTab, StudioOrdersPageState>().apply {
        preview?.forEach { (t, list) -> put(t, StudioOrdersPageState(list, emptyList(), loaded = true)) }
    }
    /** Badges: New = paid, To ship = processing (from the dashboard's `toShip`). */
    var counts by mutableStateOf(preview?.let { mapOf(StudioOrdersTab.New to (it[StudioOrdersTab.New]?.size ?: 0), StudioOrdersTab.ToShip to (it[StudioOrdersTab.ToShip]?.size ?: 0)) } ?: emptyMap())
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var loadingMore by mutableStateOf(false)
        private set

    fun select(t: StudioOrdersTab) {
        tab = t
        if (pages[t]?.loaded != true) viewModelScope.launch { load(t) }
    }

    suspend fun load(t: StudioOrdersTab = tab, force: Boolean = false) {
        val store = store ?: return
        if (!force && pages[t]?.loaded == true) return
        try {
            val results = coroutineScope { t.queries.map { q -> async { store.orders(q) } }.awaitAll() }
            pages[t] = StudioOrdersPageState.merge(emptyList(), results)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
        refreshCounts()
    }

    private suspend fun refreshCounts() {
        val store = store ?: return
        try {
            val d = store.dashboard(7)
            counts = mapOf(StudioOrdersTab.New to d.toShip.paid, StudioOrdersTab.ToShip to d.toShip.processing)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    fun loadMore() {
        val store = store ?: return
        val t = tab
        val state = pages[t] ?: return
        if (!state.hasMore || loadingMore) return
        loadingMore = true
        viewModelScope.launch {
            try {
                val results = coroutineScope {
                    t.queries.mapIndexed { i, q ->
                        async {
                            val cursor = state.cursors.getOrNull(i)
                            if (cursor == null) StudioOrdersPage(emptyList(), null) else store.orders(q, before = cursor)
                        }
                    }.awaitAll()
                }
                pages[t] = StudioOrdersPageState.merge(state.items, results)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            } finally {
                loadingMore = false
            }
        }
    }
}

@Composable
fun StudioOrdersView() {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val model: StudioOrdersModel = viewModel(key = "studio-orders-${studio.generation}") { StudioOrdersModel(studio) }
    LaunchedEffect(model) { model.load() }
    // Home's "Orders to ship" opens New.
    val wanted = nav.ordersTab
    LaunchedEffect(wanted) {
        if (wanted != null) {
            model.select(wanted)
            nav.ordersTab = null
        }
    }
    // Back from an order: its tab may have changed (shipped, cancelled).
    val depth = nav.stack(StudioTab.Orders).size
    LaunchedEffect(depth) { if (depth == 0) model.load(force = true) }
    StudioOrdersScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StudioOrdersScreen(model: StudioOrdersModel) {
    val nav = LocalStudioNav.current
    val haptics = rememberYardHaptics()
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Color.yard.bg).statusBarsPadding()) {
        YardDisplayText("Orders", size = 40.sp, modifier = Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.m))
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.gutter, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            StudioOrdersTab.entries.forEach { t ->
                val on = model.tab == t
                val count = model.counts[t] ?: 0
                Row(
                    Modifier
                        .background(if (on) Color.yard.ink else Color.yard.surface2, YardShapes.pill)
                        .pressableClick(onClickLabel = t.title) {
                            if (!on) haptics.tick()
                            model.select(t)
                        }
                        .semantics {
                            selected = on
                            contentDescription = if (count > 0) "${t.title}, $count" else t.title
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(t.title, style = YardFonts.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = if (on) Color.yard.bg else Color.yard.ink)
                    if (count > 0) {
                        Text(
                            Formatters.count(count),
                            style = YardFonts.micro,
                            color = Color.yard.onAcid,
                            modifier = Modifier.background(Color.yard.acid, YardShapes.pill).padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
            }
        }
        val state = model.pages[model.tab]
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                haptics.tick()
                model.viewModelScope.launch {
                    model.load(force = true)
                    refreshing = false
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            AnimatedContent(
                targetState = model.tab to (state?.loaded == true),
                transitionSpec = { fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade()) },
                label = "orders-tab",
            ) { (tab, loaded) ->
                val items = model.pages[tab]?.items.orEmpty()
                when {
                    !loaded && model.error != null -> EmptyState.Error(model.error.orEmpty(), Modifier.fillMaxSize()) { model.load(tab, force = true) }
                    !loaded -> Column(Modifier.fillMaxSize().padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        repeat(4) { Skeleton(Modifier.fillMaxWidth().height(96.dp)) }
                    }
                    items.isEmpty() -> EmptyState(
                        title = when (tab) {
                            StudioOrdersTab.New -> "No new orders"
                            StudioOrdersTab.ToShip -> "Nothing to ship"
                            StudioOrdersTab.Shipped -> "Nothing on the way"
                            StudioOrdersTab.Done -> "No finished orders yet"
                        },
                        message = when (tab) {
                            StudioOrdersTab.New -> "Paid orders land here first. We'll notify you."
                            StudioOrdersTab.ToShip -> "Orders you start preparing wait here until they ship."
                            else -> null
                        },
                        icon = Icons.AutoMirrored.Outlined.ReceiptLong,
                        modifier = Modifier.fillMaxSize(),
                    )
                    else -> LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.m, bottom = StudioPillClearance + Spacing.xl),
                        verticalArrangement = Arrangement.spacedBy(Spacing.m),
                    ) {
                        items(items, key = { it.id }) { o ->
                            StudioOrderRow(o) { nav.push(StudioRoute.Order(o.id)) }
                        }
                        if (model.pages[tab]?.hasMore == true) {
                            item {
                                LaunchedEffect(items.size) { model.loadMore() }
                                Box(Modifier.fillMaxWidth().height(48.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun StudioOrderRow(o: StudioOrderSummary, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    val (status, style) = studioOrderStatus(o.merchant)
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface, YardShapes.card)
            .pressableClick(onClickLabel = "Order ${o.reference}") { haptics.click(); onClick() }
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(o.reference.ifBlank { o.id }, style = YardFonts.captionEmphasis.monospacedDigits(), color = Color.yard.ink3, modifier = Modifier.weight(1f))
            StudioPill(status, style)
        }
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(o.customerName.ifBlank { "Customer" }, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(o.itemsTitle, style = YardFonts.callout, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(studioMoney(o.totalMinor, o.currency), style = YardFonts.bodyEmphasis.monospacedDigits(), color = Color.yard.ink)
        }
        val place = listOfNotNull(o.shipToPreview.city?.ifBlank { null }, o.shipToPreview.country.ifBlank { null }).joinToString(", ")
        Text(
            listOfNotNull(Formatters.relative(o.placedAt).ifBlank { null }, place.ifBlank { null }).joinToString(" · "),
            style = YardFonts.caption,
            color = Color.yard.ink3,
        )
    }
}
