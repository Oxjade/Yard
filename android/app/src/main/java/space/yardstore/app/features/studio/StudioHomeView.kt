package space.yardstore.app.features.studio

import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException

/** Studio Home's data: the dashboard for 7 days, and for 30 once Month is picked. */
class StudioHomeModel(private val store: StudioStore?, preview: StudioDashboard? = null, previewSuggestions: List<StudioProposal> = emptyList()) : ViewModel() {
    var week by mutableStateOf(preview)
        private set
    /** Suggestions from Yard still waiting (the to-do "Yard prepared N products for you"). */
    var suggestions by mutableStateOf(previewSuggestions)
        private set
    var month by mutableStateOf<StudioDashboard?>(null)
        private set
    var range by mutableStateOf(StudioRange.Week)
    var isLoading by mutableStateOf(preview == null)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** The dashboard for the picked range's chart (month needs `days=30`). */
    val current: StudioDashboard? get() = if (range == StudioRange.Month) month ?: week else week

    suspend fun load(force: Boolean = false) {
        val store = store ?: return
        if (!force && week != null) return
        isLoading = week == null
        try {
            val d = store.dashboard(7)
            week = d
            store.brandCurrency = d.brand.currency
            error = null
            if (range == StudioRange.Month || month != null) month = store.dashboard(30)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        } finally {
            isLoading = false
        }
        // Not on the dashboard: a failure only hides the to-do row.
        try {
            suggestions = store.proposals("pending").items.filter { it.isPending }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    fun pick(r: StudioRange) {
        range = r
        val store = store ?: return
        if (r == StudioRange.Month && month == null) {
            viewModelScope.launch {
                try {
                    month = store.dashboard(30)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // The 7-day chart stays; the toggle's numbers come from `sales.month` anyway.
                }
            }
        }
    }
}

/** Opens the system share sheet for a brand's shop page. */
internal fun shareShop(context: Context, handle: String, name: String) {
    val url = Config.webUrl("/brands/$handle")
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, name)
        putExtra(Intent.EXTRA_TEXT, "$name on Yard: $url")
    }
    runCatching { context.startActivity(Intent.createChooser(send, "Share $name").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
fun StudioHomeView() {
    val studio = LocalStudioStore.current
    val model: StudioHomeModel = viewModel(key = "studio-home-${studio.generation}") { StudioHomeModel(studio) }
    LaunchedEffect(model) { model.load() }
    StudioHomeScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StudioHomeScreen(model: StudioHomeModel) {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val context = LocalContext.current
    val haptics = rememberYardHaptics()
    var refreshing by remember { mutableStateOf(false) }
    val brand = studio.activeBrand
    val d = model.week
    val brandName = d?.brand?.name?.ifBlank { null } ?: brand?.name ?: "your shop"
    val handle = d?.brand?.handle?.ifBlank { null } ?: brand?.handle.orEmpty()

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
        modifier = Modifier.fillMaxSize().background(Color.yard.bg),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.m, bottom = StudioPillClearance + Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            // Header: "Hello {brand}", today's date, the brand mark (picker with several brands).
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Hello", style = YardFonts.callout, color = Color.yard.ink2)
                    YardDisplayText(brandName, size = if (brandName.length > 16) 30.sp else 38.sp, maxLines = 2)
                    val today = LocalDate.now()
                    Text(
                        "${today.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())}, ${today.format(DateTimeFormatter.ofPattern("d MMMM"))}",
                        style = YardFonts.caption,
                        color = Color.yard.ink3,
                    )
                }
                if (brand != null) {
                    StudioBrandMark(
                        brand.name,
                        brand.mark,
                        brand.logoSrc,
                        size = 48.dp,
                        modifier = Modifier.pressableClick(onClickLabel = if (studio.studioBrands.size > 1) "Switch brand" else "Me") {
                            haptics.tick()
                            if (studio.studioBrands.size > 1) studio.showsBrandPicker = true else nav.select(StudioTab.Me)
                        },
                    )
                }
            }

            StudioStatusBanner(brand)

            AnimatedContent(
                targetState = when {
                    d != null -> "data"
                    model.error != null -> "error"
                    else -> "loading"
                },
                transitionSpec = { fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade()) },
                label = "studio-home",
            ) { state ->
                when (state) {
                    "loading" -> StudioHomeSkeleton()
                    "error" -> EmptyState.Error(model.error.orEmpty()) { model.load(force = true) }
                    else -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                        val data = model.week ?: return@Column
                        SalesCard(model, data)
                        QuickActions(
                            onAdd = { nav.select(StudioTab.Add) },
                            onOrders = { nav.select(StudioTab.Orders) },
                            onPayouts = { nav.push(StudioRoute.Payouts, StudioTab.Me) },
                            onShare = { shareShop(context, handle, brandName) },
                        )
                        TodoList(data, model.suggestions, onSuggestions = { nav.push(StudioRoute.Suggestions(focusAcceptAll = true), StudioTab.Products) }, onShip = { nav.ordersTab = StudioOrdersTab.New; nav.select(StudioTab.Orders) }, onLowStock = { nav.productsFilter = StudioProductFilter.LowStock; nav.select(StudioTab.Products) }, onMessages = { nav.push(StudioRoute.Inbox, StudioTab.Me) }, onWebsite = { nav.push(StudioRoute.WebsitePieces, StudioTab.Products) })
                        TopProducts(data) { id -> nav.push(StudioRoute.Product(id), StudioTab.Products) }
                        StoreViews(data)
                    }
                }
            }
        }
    }
}

/** In review / paused / restricted: what the brand can and can't do right now. */
@Composable
internal fun StudioStatusBanner(brand: space.yardstore.app.core.models.ShopperBrand?) {
    val b = brand ?: return
    val text = when {
        b.isPendingReview -> "${b.name} is in review. Set up your shop now; nothing goes live until Yard approves it."
        b.isRestricted -> "Yard paused publishing and replies for ${b.name}. Check your email for what to change."
        else -> return
    }
    Row(
        Modifier.fillMaxWidth().background(Color.yard.violetFill, YardShapes.card).padding(Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (b.isPendingReview) Icons.Outlined.CheckCircle else Icons.Outlined.WarningAmber, contentDescription = null, tint = Color.yard.onVioletFill)
        Text(text, style = YardFonts.callout, color = Color.yard.onVioletFill)
    }
}

/** The big balance-style card: net sales for today / week / month and the animated line chart. */
@Composable
private fun SalesCard(model: StudioHomeModel, data: StudioDashboard) {
    val haptics = rememberYardHaptics()
    val window = data.window(model.range)
    val currency = data.brand.currency
    val chart = model.current ?: data
    val white = Color.yard.onPhoto
    Column(
        Modifier
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.onAcid)
            .background(Brush.radialGradient(listOf(Color.yard.violetFill.copy(alpha = 0.55f), Color.Transparent), center = Offset(900f, -60f), radius = 760f))
            .border(1.dp, Color.yard.line, YardShapes.card)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Sales", style = YardFonts.callout, color = white.copy(alpha = 0.7f), modifier = Modifier.weight(1f))
            // Today · Week · Month
            Row(Modifier.background(white.copy(alpha = 0.1f), YardShapes.pill).padding(3.dp)) {
                StudioRange.entries.forEach { r ->
                    val on = r == model.range
                    Text(
                        r.title,
                        style = YardFonts.captionEmphasis,
                        color = if (on) Color.yard.onAcid else white.copy(alpha = 0.8f),
                        modifier = Modifier
                            .clip(YardShapes.pill)
                            .background(if (on) Color.yard.acid else Color.Transparent, YardShapes.pill)
                            .pressableClick(onClickLabel = r.title) {
                                if (!on) haptics.tick()
                                model.pick(r)
                            }
                            .semantics { contentDescription = "${r.title}${if (on) ", selected" else ""}" }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }
        AnimatedContent(
            targetState = studioMoney(window.netMinor, currency),
            transitionSpec = { fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade()) },
            label = "sales-total",
        ) { total ->
            Text(total, style = YardFonts.number(40.sp), color = white, maxLines = 1)
        }
        Text(
            buildString {
                append("${window.orders} ${if (window.orders == 1) "order" else "orders"}")
                if (window.refundedMinor > 0) append(" · ${studioMoney(window.refundedMinor, currency)} refunded")
            },
            style = YardFonts.caption.monospacedDigits(),
            color = white.copy(alpha = 0.7f),
        )
        StudioLineChart(
            values = chart.series.points.map { it.netMinor.toFloat() },
            modifier = Modifier.fillMaxWidth().height(110.dp),
            description = "Net sales over the last ${chart.series.days} days",
        )
        val first = chart.series.points.firstOrNull()?.date?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        if (first != null) {
            Row {
                Text(first.format(DateTimeFormatter.ofPattern("d MMM")), style = YardFonts.micro, color = white.copy(alpha = 0.5f), modifier = Modifier.weight(1f))
                Text("Today", style = YardFonts.micro, color = white.copy(alpha = 0.5f))
            }
        }
    }
}

/** An animated line chart (draws in from the left; instant under reduced motion). */
@Composable
fun StudioLineChart(values: List<Float>, modifier: Modifier = Modifier, description: String) {
    val reduce = rememberReducedMotion()
    val acid = Color.yard.acid
    val progress = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(values) {
        if (reduce) {
            progress.snapTo(1f)
        } else {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(900, easing = Motion.EmphasizedDecelerate))
        }
    }
    Canvas(modifier.semantics { contentDescription = description }) {
        if (values.isEmpty()) return@Canvas
        val max = values.maxOrNull()?.takeIf { it > 0f } ?: 1f
        val stepX = if (values.size > 1) size.width / (values.size - 1) else size.width
        val pad = 8.dp.toPx()
        fun y(v: Float) = size.height - pad - (v / max) * (size.height - pad * 2)
        val line = Path()
        values.forEachIndexed { i, v ->
            val x = i * stepX
            if (i == 0) {
                line.moveTo(x, y(v))
            } else {
                // Smooth curve between points.
                val px = (i - 1) * stepX
                val pv = y(values[i - 1])
                val mid = (px + x) / 2f
                line.cubicTo(mid, pv, mid, y(v), x, y(v))
            }
        }
        val fill = Path().apply {
            addPath(line)
            lineTo((values.size - 1) * stepX, size.height)
            lineTo(0f, size.height)
            close()
        }
        val shown = size.width * progress.value
        clipRect(right = shown) {
            drawPath(fill, Brush.verticalGradient(listOf(acid.copy(alpha = 0.28f), acid.copy(alpha = 0f))))
        }
        val measure = PathMeasure()
        measure.setPath(line, false)
        val partial = Path()
        measure.getSegment(0f, measure.length * progress.value, partial, true)
        drawPath(partial, acid, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
        if (progress.value >= 0.999f) {
            val last = Offset((values.size - 1) * stepX, y(values.last()))
            drawCircle(acid.copy(alpha = 0.25f), radius = 9.dp.toPx(), center = last)
            drawCircle(acid, radius = 4.dp.toPx(), center = last)
        }
    }
}

@Composable
private fun QuickActions(onAdd: () -> Unit, onOrders: () -> Unit, onPayouts: () -> Unit, onShare: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        QuickAction("Add product", Icons.Outlined.AddCircleOutline, primary = true, onClick = onAdd)
        QuickAction("Orders", Icons.AutoMirrored.Outlined.ReceiptLong, onClick = onOrders)
        QuickAction("Payouts", Icons.Outlined.AccountBalanceWallet, onClick = onPayouts)
        QuickAction("Share shop", Icons.Outlined.IosShare, onClick = onShare)
    }
}

@Composable
private fun QuickAction(title: String, icon: ImageVector, primary: Boolean = false, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    Column(
        Modifier.width(76.dp).pressableClick(pressedScale = 0.92f, onClickLabel = title) { haptics.click(); onClick() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Box(
            Modifier
                .size(60.dp)
                .background(if (primary) Color.yard.acid else Color.yard.surface, CircleShape)
                .border(1.dp, Color.yard.line, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (primary) Color.yard.onAcid else Color.yard.ink, modifier = Modifier.size(24.dp))
        }
        Text(title, style = YardFonts.caption, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TodoList(d: StudioDashboard, suggestions: List<StudioProposal>, onSuggestions: () -> Unit, onShip: () -> Unit, onLowStock: () -> Unit, onMessages: () -> Unit, onWebsite: () -> Unit) {
    data class Todo(val title: String, val detail: String, val count: Int, val icon: ImageVector, val action: () -> Unit, val lines: Int = 1)
    val items = buildList {
        if (suggestions.isNotEmpty()) {
            val (title, detail) = StudioBatch.preparedLine(suggestions)
            add(Todo(title, "$detail. Nothing goes live until you accept.", suggestions.size, Icons.Outlined.AutoAwesome, onSuggestions, lines = 2))
        }
        if (d.toShip.total > 0) add(Todo("Orders to ship", "${d.toShip.paid} new · ${d.toShip.processing} preparing", d.toShip.total, Icons.Outlined.LocalShipping, onShip))
        if (d.lowStock.variants > 0) add(Todo("Low stock", "${d.lowStock.products} ${if (d.lowStock.products == 1) "product" else "products"} at ${d.lowStock.threshold} or fewer", d.lowStock.variants, Icons.Outlined.WarningAmber, onLowStock))
        d.unreadMessages?.takeIf { it > 0 }?.let { add(Todo("Unread messages", "Customers waiting for a reply", it, Icons.Outlined.ChatBubbleOutline, onMessages)) }
        if (d.websitePieces > 0) add(Todo("New from your website", "Ready to add to Yard", d.websitePieces, Icons.Outlined.Language, onWebsite))
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        StudioSectionTitle("To do")
        if (items.isEmpty()) {
            Row(
                Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = Color.yard.success)
                Text("All caught up. Nothing waiting on you.", style = YardFonts.callout, color = Color.yard.ink2)
            }
        } else {
            Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs)) {
                items.forEach { t -> StudioRow(t.title, t.detail, t.icon, count = t.count, titleLines = t.lines, onClick = t.action) }
            }
        }
    }
}

/** A list row: icon disc, title + detail, optional count badge, chevron. */
@Composable
fun StudioRow(
    title: String,
    detail: String?,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    count: Int? = null,
    tint: Color = Color.yard.ink,
    titleLines: Int = 1,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)?,
) {
    val haptics = rememberYardHaptics()
    Row(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.pressableClick(onClickLabel = title) { haptics.click(); onClick() } else Modifier)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(Modifier.size(40.dp).background(Color.yard.surface2, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = YardFonts.headline, color = tint, maxLines = titleLines, overflow = TextOverflow.Ellipsis)
            if (!detail.isNullOrBlank()) Text(detail, style = YardFonts.caption, color = Color.yard.ink3, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (count != null && count > 0) {
            Text(
                Formatters.count(count),
                style = YardFonts.captionEmphasis.monospacedDigits(),
                color = Color.yard.onAcid,
                modifier = Modifier.background(Color.yard.acid, YardShapes.pill).padding(horizontal = 9.dp, vertical = 3.dp),
            )
        }
        if (trailing != null) trailing()
        if (onClick != null && trailing == null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3)
    }
}

@Composable
private fun TopProducts(d: StudioDashboard, onOpen: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        StudioSectionTitle("Top products")
        if (d.topProducts.isEmpty()) {
            Text("Your best sellers of the last ${d.series.days} days show here once orders come in.", style = YardFonts.callout, color = Color.yard.ink3)
            return@Column
        }
        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs)) {
            d.topProducts.forEachIndexed { i, p ->
                val haptics = rememberYardHaptics()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .pressableClick(onClickLabel = p.title) { haptics.click(); onOpen(p.productId) }
                        .padding(horizontal = Spacing.l, vertical = Spacing.s),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                ) {
                    Text("${i + 1}", style = YardFonts.display(20.sp), color = Color.yard.ink3, modifier = Modifier.width(18.dp))
                    RemoteImage(Config.url(p.image?.src), Modifier.size(48.dp).clip(YardShapes.small), maxPixelSize = 200, contentDescription = p.image?.alt)
                    Column(Modifier.weight(1f)) {
                        Text(p.title, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${p.units} sold", style = YardFonts.caption, color = Color.yard.ink3)
                    }
                    Text(studioMoney(p.revenueMinor, p.currency), style = YardFonts.bodyEmphasis.monospacedDigits(), color = Color.yard.ink)
                }
            }
        }
    }
}

@Composable
private fun StoreViews(d: StudioDashboard) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        StudioSectionTitle("Store views")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            listOf("Today" to d.storeViews.today, "7 days" to d.storeViews.week, "30 days" to d.storeViews.month).forEach { (label, n) ->
                Column(
                    Modifier.weight(1f).background(Color.yard.surface, YardShapes.card).padding(Spacing.l),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Text(Formatters.count(n), style = YardFonts.number(24.sp), color = Color.yard.ink)
                    Text(label, style = YardFonts.caption, color = Color.yard.ink3)
                }
            }
        }
    }
}

@Composable
private fun StudioHomeSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        Skeleton(Modifier.fillMaxWidth().height(260.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            repeat(4) { Skeleton(Modifier.size(60.dp), shape = space.yardstore.app.designsystem.components.SkeletonShape.Circle) }
        }
        Skeleton(Modifier.fillMaxWidth().height(150.dp))
        Spacer(Modifier.height(Spacing.s))
    }
}
