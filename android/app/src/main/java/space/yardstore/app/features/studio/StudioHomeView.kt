package space.yardstore.app.features.studio

import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardDoubleArrowRight
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Visibility
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.ShopperBrand
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.shimmering
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/** Studio Home's data: the 7-day dashboard (its `sales` already carries today / week / month). */
class StudioHomeModel(private val store: StudioStore?, preview: StudioDashboard? = null, previewSuggestions: List<StudioProposal> = emptyList()) : ViewModel() {
    var week by mutableStateOf(preview)
        private set
    /** Suggestions from Yard still waiting (the to-do "Yard prepared N products for you"). */
    var suggestions by mutableStateOf(previewSuggestions)
        private set
    /** The hero's window. Month first, so "+₦… past week" reads like a wallet's balance and delta. */
    var range by mutableStateOf(StudioRange.Month)
    var isLoading by mutableStateOf(preview == null)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    suspend fun load(force: Boolean = false) {
        val store = store ?: return
        if (!force && week != null) return
        isLoading = week == null
        try {
            val d = store.dashboard(7)
            week = d
            store.brandCurrency = d.brand.currency
            error = null
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

/** Screenshots only: a model to show instead of loading (e.g. `StudioHomeModel(null)` = the skeleton). */
val LocalStudioHomePreview = staticCompositionLocalOf<StudioHomeModel?> { null }

@Composable
fun StudioHomeView() {
    LocalStudioHomePreview.current?.let { StudioHomeScreen(it); return }
    val studio = LocalStudioStore.current
    val model: StudioHomeModel = viewModel(key = "studio-home-${studio.generation}") { StudioHomeModel(studio) }
    LaunchedEffect(model) { model.load() }
    StudioHomeScreen(model)
}

/** Studio Home's radii: the hero's bottom corners, cards, tiles. */
private object HomeRadius {
    val hero = 32.dp
    val card = 24.dp
    val tile = 20.dp
    val small = 16.dp
}

/**
 * Studio Home, a wallet: the violet hero (greeting, sales for the picked window, the "+… past week"
 * pill and one inset action card), four action tiles, the contrast Orders tile beside Weekly
 * activity, then the to-do rows and the shop's numbers, on pure black (off-white in light).
 */
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
    // The inset card the seller closed (this visit only): closing it moves the to-do into the rows.
    var dismissed by rememberSaveable { mutableStateOf("") }

    val onSuggestions = { nav.push(StudioRoute.Suggestions(focusAcceptAll = true), StudioTab.Products) }
    val onShare = { shareShop(context, handle, brandName) }
    val card = homeCard(brand, d, model.suggestions, brandName).takeIf { it?.id != dismissed }

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
        modifier = Modifier.fillMaxSize().background(Color.yard.studioCanvas),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = StudioPillClearance + Spacing.l),
        ) {
            HomeHero(
                model = model,
                brand = brand,
                brandName = brandName,
                card = card,
                onAvatar = {
                    haptics.tick()
                    if (studio.studioBrands.size > 1) studio.showsBrandPicker = true else nav.select(StudioTab.Me)
                },
                onInbox = { nav.push(StudioRoute.Inbox, StudioTab.Me) },
                onCard = { c ->
                    when (c.action) {
                        HomeCardAction.Suggestions -> onSuggestions()
                        HomeCardAction.Add -> nav.select(StudioTab.Add)
                        HomeCardAction.Share -> onShare()
                        HomeCardAction.Support -> nav.push(StudioRoute.Support, StudioTab.Me)
                    }
                },
                onDismissCard = { c -> haptics.tick(); dismissed = c.id },
            )
            Column(
                Modifier.padding(horizontal = Spacing.gutter).padding(top = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                QuickActions(
                    onAdd = { nav.select(StudioTab.Add) },
                    onOrders = { nav.select(StudioTab.Orders) },
                    onPayouts = { nav.push(StudioRoute.Payouts, StudioTab.Me) },
                    onShare = onShare,
                )
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
                        "loading" -> HomeSkeleton()
                        "error" -> Box(Modifier.padding(top = Spacing.xl)) { EmptyState.Error(model.error.orEmpty()) { model.load(force = true) } }
                        else -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            val data = model.week ?: return@Column
                            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                                OrdersTile(data, model.range, Modifier.weight(1f).fillMaxHeight()) {
                                    nav.select(StudioTab.Orders)
                                }
                                WeeklyActivityTile(data, Modifier.weight(1f).fillMaxHeight())
                            }
                            TodoRows(
                                d = data,
                                suggestions = if (card?.action == HomeCardAction.Suggestions) emptyList() else model.suggestions,
                                onSuggestions = onSuggestions,
                                onShip = { nav.ordersTab = StudioOrdersTab.New; nav.select(StudioTab.Orders) },
                                onLowStock = { nav.productsFilter = StudioProductFilter.LowStock; nav.select(StudioTab.Products) },
                                onMessages = { nav.push(StudioRoute.Inbox, StudioTab.Me) },
                                onWebsite = { nav.push(StudioRoute.WebsitePieces, StudioTab.Products) },
                            )
                            YourShop(data) { id -> nav.push(StudioRoute.Product(id), StudioTab.Products) }
                        }
                    }
                }
            }
        }
    }
}

// region Hero

private enum class HomeCardAction { Suggestions, Add, Share, Support }

/** The hero's inset card: one thing worth doing now ("Get set up" in the wallet inspo). */
private data class HomeCard(val id: String, val lead: String, val text: String, val cta: String, val action: HomeCardAction)

private fun homeCard(brand: ShopperBrand?, d: StudioDashboard?, suggestions: List<StudioProposal>, brandName: String): HomeCard? = when {
    brand?.isRestricted == true -> HomeCard(
        "restricted", "Publishing is paused", "Yard paused publishing and replies for $brandName. Ask Yard Support what to change.",
        "Message Yard Support", HomeCardAction.Support,
    )
    suggestions.isNotEmpty() -> {
        val (title, _) = StudioBatch.preparedLine(suggestions)
        HomeCard("suggestions", title, "Nothing goes live until you accept.", if (suggestions.size == 1) "Accept it" else "Accept all", HomeCardAction.Suggestions)
    }
    brand?.isPendingReview == true -> HomeCard(
        "review", "Your shop is in review", "Add products now. They go live once Yard approves $brandName.",
        "Add a product", HomeCardAction.Add,
    )
    d != null && d.sales.month.orders == 0 -> HomeCard(
        "first-order", "Get your first order", "Share your shop link so people can find you on Yard.",
        "Share shop", HomeCardAction.Share,
    )
    else -> null
}

/** The pill beside the amount: what the latest days added ("+₦300,000 past week"). */
internal fun heroDelta(d: StudioDashboard, range: StudioRange): String {
    val currency = d.brand.currency
    fun signed(minor: Long) = (if (minor < 0) "−" else "+") + studioMoney(kotlin.math.abs(minor), currency)
    return when (range) {
        StudioRange.Month -> if (d.sales.week.orders == 0) "No orders past week" else "${signed(d.sales.week.netMinor)} past week"
        StudioRange.Week -> if (d.sales.today.orders == 0) "No orders today" else "${signed(d.sales.today.netMinor)} today"
        StudioRange.Today -> d.sales.today.orders.let { if (it == 0) "No orders yet" else "$it ${if (it == 1) "order" else "orders"}" }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HomeHero(
    model: StudioHomeModel,
    brand: ShopperBrand?,
    brandName: String,
    card: HomeCard?,
    onAvatar: () -> Unit,
    onInbox: () -> Unit,
    onCard: (HomeCard) -> Unit,
    onDismissCard: (HomeCard) -> Unit,
) {
    val d = model.week
    val on = Color.yard.onStudioAccent
    val haptics = rememberYardHaptics()
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomStart = HomeRadius.hero, bottomEnd = HomeRadius.hero))
            .background(Color.yard.studioAccent)
            .statusBarsPadding()
            // The gutter, so the hero's words and inset card line up with the tiles below.
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.m, bottom = Spacing.l),
    ) {
        // Avatar, "Hello 👋 / Shop name", inbox.
        Row(verticalAlignment = Alignment.CenterVertically) {
            HomeAvatar(brand, brandName, Modifier.pressableClick(pressedScale = 0.94f, onClickLabel = if ((brand != null) && LocalStudioStore.current.studioBrands.size > 1) "Switch brand" else "Me", onClick = onAvatar))
            Column(Modifier.weight(1f).padding(start = Spacing.m)) {
                Text("Hello 👋", style = YardFonts.caption.copy(fontSize = 13.sp), color = on.copy(alpha = 0.8f), maxLines = 1)
                Text(brandName, style = YardFonts.headline.copy(fontSize = 17.sp), color = on, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val unread = d?.unreadMessages ?: 0
            Box(
                Modifier
                    .size(44.dp)
                    .background(on.copy(alpha = 0.18f), CircleShape)
                    .semantics { contentDescription = if (unread > 0) "Inbox, $unread unread" else "Inbox" }
                    .pressableClick(pressedScale = 0.92f, onClickLabel = "Inbox") { haptics.click(); onInbox() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = on, modifier = Modifier.size(20.dp))
                if (unread > 0) {
                    Box(Modifier.align(Alignment.TopEnd).padding(top = 11.dp, end = 11.dp).size(8.dp).background(on, CircleShape))
                }
            }
        }

        Spacer(Modifier.height(Spacing.xl))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Your sales", style = YardFonts.caption.copy(fontSize = 13.sp), color = on.copy(alpha = 0.8f), modifier = Modifier.weight(1f))
            RangePicker(model)
        }
        Spacer(Modifier.height(Spacing.xs))
        if (d == null) {
            // Loading: the amount and pill as soft blocks (the hero itself never flashes).
            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.width(170.dp).height(38.dp).background(on.copy(alpha = 0.18f), RoundedCornerShape(10.dp)).shimmering())
                Box(Modifier.width(96.dp).height(26.dp).background(on.copy(alpha = 0.14f), YardShapes.pill))
            }
        } else {
            val window = d.window(model.range)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                AnimatedContent(
                    targetState = studioMoney(window.netMinor, d.brand.currency),
                    transitionSpec = { fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade()) },
                    label = "hero-amount",
                ) { amount ->
                    Text(
                        amount,
                        style = YardFonts.number(40.sp).copy(letterSpacing = (-0.5).sp, lineHeight = 46.sp),
                        color = on,
                        maxLines = 1,
                        modifier = Modifier.semantics { contentDescription = "Net sales, ${model.range.title.lowercase()}: $amount" },
                    )
                }
                Text(
                    heroDelta(d, model.range),
                    style = YardFonts.captionEmphasis.monospacedDigits(),
                    color = on,
                    maxLines = 1,
                    modifier = Modifier.background(on.copy(alpha = 0.2f), YardShapes.pill).padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }

        AnimatedVisibility(card != null, exit = fadeOut() + shrinkVertically()) {
            val c = card ?: return@AnimatedVisibility
            HeroInsetCard(c, onOpen = { onCard(c) }, onClose = { onDismissCard(c) })
        }
    }
}

/** Initials on a translucent disc, or the shop's logo. */
@Composable
private fun HomeAvatar(brand: ShopperBrand?, brandName: String, modifier: Modifier = Modifier) {
    val on = Color.yard.onStudioAccent
    Box(
        modifier.size(44.dp).clip(CircleShape).background(on.copy(alpha = 0.22f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (brand?.mark ?: brandName.take(1).uppercase()).take(2),
            style = YardFonts.captionEmphasis.copy(fontSize = 15.sp),
            color = on,
        )
        if (!brand?.logoSrc.isNullOrBlank()) {
            RemoteImage(Config.url(brand?.logoSrc), Modifier.fillMaxSize(), maxPixelSize = 200, placeholder = {})
        }
    }
}

/** Today · Week · Month, translucent on the violet; the picked one is a white pill. */
@Composable
private fun RangePicker(model: StudioHomeModel) {
    val haptics = rememberYardHaptics()
    val on = Color.yard.onStudioAccent
    Row(Modifier.background(on.copy(alpha = 0.16f), YardShapes.pill).padding(3.dp)) {
        StudioRange.entries.forEach { r ->
            val picked = r == model.range
            val ink by animateColorAsState(if (picked) Color.yard.studioAccentDeep else on.copy(alpha = 0.85f), Motion.snappy(), label = "range-ink")
            Text(
                r.title,
                style = YardFonts.captionEmphasis,
                color = ink,
                modifier = Modifier
                    .clip(YardShapes.pill)
                    .background(if (picked) on else Color.Transparent, YardShapes.pill)
                    .pressableClick(pressedScale = 0.95f, onClickLabel = r.title) {
                        if (!picked) haptics.tick()
                        model.pick(r)
                    }
                    .semantics { contentDescription = "${r.title}${if (picked) ", selected" else ""}" }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}

/** The darker inset card: the words, a close X, and the white pill CTA (● ›  Label  »). */
@Composable
private fun HeroInsetCard(c: HomeCard, onOpen: () -> Unit, onClose: () -> Unit) {
    val on = Color.yard.onStudioAccent
    val haptics = rememberYardHaptics()
    Column(
        Modifier
            .padding(top = 20.dp)
            .fillMaxWidth()
            .background(Color.yard.studioAccentDeep, RoundedCornerShape(HomeRadius.tile))
            .padding(Spacing.l),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(end = Spacing.m), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(c.lead, style = YardFonts.headline.copy(fontSize = 15.sp, lineHeight = 20.sp), color = on)
                Text(c.text, style = YardFonts.callout.copy(fontSize = 13.sp, lineHeight = 18.sp), color = on.copy(alpha = 0.85f))
            }
            Box(
                Modifier
                    .size(26.dp)
                    .background(on.copy(alpha = 0.9f), CircleShape)
                    .pressableClick(pressedScale = 0.9f, onClickLabel = "Close") { onClose() }
                    .semantics { contentDescription = "Close" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = null, tint = Color.yard.studioAccentDeep, modifier = Modifier.size(15.dp))
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clip(YardShapes.pill)
                .background(on, YardShapes.pill)
                .pressableClick(onClickLabel = c.cta) { haptics.click(); onOpen() }
                .padding(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(40.dp).background(Color.yard.onPhotoInk, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = on, modifier = Modifier.size(22.dp))
            }
            Text(
                c.cta,
                style = YardFonts.bodyEmphasis.copy(fontSize = 15.sp),
                color = Color.yard.onPhotoInk,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = Spacing.s),
            )
            Icon(
                Icons.Filled.KeyboardDoubleArrowRight,
                contentDescription = null,
                tint = Color.yard.onPhotoInk.copy(alpha = 0.35f),
                modifier = Modifier.padding(end = 10.dp).size(22.dp),
            )
        }
    }
}

// endregion

// region Tiles

@Composable
private fun QuickActions(onAdd: () -> Unit, onOrders: () -> Unit, onPayouts: () -> Unit, onShare: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
        val m = Modifier.weight(1f).fillMaxHeight()
        QuickAction("Add product", Icons.Filled.Add, m, accent = true, onClick = onAdd)
        QuickAction("Orders", Icons.AutoMirrored.Outlined.ReceiptLong, m, onClick = onOrders)
        QuickAction("Payouts", Icons.Outlined.AccountBalanceWallet, m, onClick = onPayouts)
        QuickAction("Share shop", Icons.Outlined.IosShare, m, onClick = onShare)
    }
}

/** A square-ish dark tile: icon disc over the label (the inspo's Deposit / Withdraw). */
@Composable
private fun QuickAction(title: String, icon: ImageVector, modifier: Modifier, accent: Boolean = false, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    Column(
        modifier
            .heightIn(min = 88.dp)
            .clip(RoundedCornerShape(HomeRadius.small))
            .background(Color.yard.studioTile)
            .pressableClick(pressedScale = 0.95f, onClickLabel = title) { haptics.click(); onClick() }
            .padding(horizontal = Spacing.xs, vertical = Spacing.m),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s, Alignment.CenterVertically),
    ) {
        Box(
            Modifier.size(38.dp).background(if (accent) Color.yard.studioAccent else Color.yard.studioTile2, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (accent) Color.yard.onStudioAccent else Color.yard.ink, modifier = Modifier.size(20.dp))
        }
        // Two lines at large font scales ("Add / product") rather than an ellipsis.
        Text(title, style = YardFonts.captionEmphasis.copy(fontWeight = FontWeight.Medium), color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

private fun rangeCaption(r: StudioRange) = when (r) {
    StudioRange.Today -> "Today"
    StudioRange.Week -> "Past 7 days"
    StudioRange.Month -> "Past 30 days"
}

/** The white contrast tile (black in light): orders in the picked window. */
@Composable
private fun OrdersTile(d: StudioDashboard, range: StudioRange, modifier: Modifier, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    val ink = Color.yard.onStudioContrast
    val w = d.window(range)
    Column(
        modifier
            .heightIn(min = 156.dp)
            .clip(RoundedCornerShape(HomeRadius.tile))
            .background(Color.yard.studioContrast)
            .pressableClick(onClickLabel = "Orders") { haptics.click(); onClick() }
            .padding(Spacing.l),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Icon(Icons.AutoMirrored.Outlined.ReceiptLong, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
            Text("Orders", style = YardFonts.headline.copy(fontSize = 15.sp), color = ink, maxLines = 1)
        }
        Spacer(Modifier.weight(1f).heightIn(min = Spacing.l))
        Text(Formatters.count(w.orders), style = YardFonts.number(32.sp).copy(letterSpacing = (-0.5).sp), color = ink, maxLines = 1)
        Text(rangeCaption(range), style = YardFonts.caption, color = ink.copy(alpha = 0.6f), maxLines = 1)
        if (w.refundedMinor > 0) {
            Text(
                "${studioMoney(w.refundedMinor, d.brand.currency)} refunded",
                style = YardFonts.caption.monospacedDigits(),
                color = ink.copy(alpha = 0.6f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "Weekly activity": seven thin rounded bars, today in violet. */
@Composable
private fun WeeklyActivityTile(d: StudioDashboard, modifier: Modifier) {
    val points = d.series.points.takeLast(7)
    val values = points.map { it.netMinor.coerceAtLeast(0L).toFloat() }
    Column(
        modifier
            .heightIn(min = 156.dp)
            .background(Color.yard.studioTile, RoundedCornerShape(HomeRadius.tile))
            .padding(Spacing.l),
    ) {
        Text("Weekly activity", style = YardFonts.headline.copy(fontSize = 15.sp), color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
        Text(
            d.sales.week.orders.let { if (it == 0) "No sales yet this week" else "$it ${if (it == 1) "order" else "orders"} this week" },
            style = YardFonts.caption.monospacedDigits(),
            color = Color.yard.ink2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.weight(1f).heightIn(min = Spacing.m))
        WeekBars(
            values,
            Modifier.fillMaxWidth().height(64.dp),
            description = "Net sales each day of the last 7 days, today last",
        )
    }
}

@Composable
private fun WeekBars(values: List<Float>, modifier: Modifier, description: String) {
    val reduce = rememberReducedMotion()
    val accent = Color.yard.studioAccent
    val bar = Color.yard.ink
    val track = Color.yard.ink.copy(alpha = 0.07f)
    val grow = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(values) {
        if (reduce) grow.snapTo(1f) else { grow.snapTo(0f); grow.animateTo(1f, tween(700, easing = Motion.EmphasizedDecelerate)) }
    }
    Canvas(modifier.semantics { contentDescription = description }) {
        if (values.isEmpty()) return@Canvas
        val n = 7
        val w = 8.dp.toPx()
        val gap = (size.width - w * n) / (n - 1)
        val max = values.maxOrNull()?.takeIf { it > 0f } ?: 1f
        val minH = w
        val pad = n - values.size
        val corner = CornerRadius(w / 2, w / 2)
        for (i in 0 until n) {
            val v = values.getOrNull(i - pad)
            val isToday = i == n - 1
            val x = i * (w + gap)
            // A faint full-height track for every day, so a quiet week still reads as a chart.
            drawRoundRect(color = if (isToday) accent.copy(alpha = 0.22f) else track, topLeft = Offset(x, 0f), size = Size(w, size.height), cornerRadius = corner)
            if (v == null || v <= 0f) continue
            val h = minH + (size.height - minH) * (v / max) * grow.value
            drawRoundRect(color = if (isToday) accent else bar, topLeft = Offset(x, size.height - h), size = Size(w, h), cornerRadius = corner)
        }
    }
}

// endregion

// region Rows

@Composable
private fun TodoRows(d: StudioDashboard, suggestions: List<StudioProposal>, onSuggestions: () -> Unit, onShip: () -> Unit, onLowStock: () -> Unit, onMessages: () -> Unit, onWebsite: () -> Unit) {
    data class Todo(val title: String, val detail: String, val count: Int, val icon: ImageVector, val action: () -> Unit)
    val items = buildList {
        if (suggestions.isNotEmpty()) {
            val (title, detail) = StudioBatch.preparedLine(suggestions)
            add(Todo(title, detail, suggestions.size, Icons.Outlined.AutoAwesome, onSuggestions))
        }
        if (d.toShip.total > 0) add(Todo("Orders to ship", "${d.toShip.paid} new · ${d.toShip.processing} preparing", d.toShip.total, Icons.Outlined.LocalShipping, onShip))
        if (d.lowStock.variants > 0) add(Todo("Low stock", "${d.lowStock.products} ${if (d.lowStock.products == 1) "product" else "products"} at ${d.lowStock.threshold} or fewer", d.lowStock.variants, Icons.Outlined.WarningAmber, onLowStock))
        d.unreadMessages?.takeIf { it > 0 }?.let { add(Todo("Unread messages", "Customers waiting for a reply", it, Icons.Outlined.ChatBubbleOutline, onMessages)) }
        if (d.websitePieces > 0) add(Todo("New from your website", "Ready to add to Yard", d.websitePieces, Icons.Outlined.Language, onWebsite))
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (items.isEmpty()) {
            HomeRow("All caught up", "Nothing is waiting on you right now", Icons.Outlined.CheckCircle, onClick = null)
        } else {
            items.forEach { t -> HomeRow(t.title, t.detail, t.icon, value = Formatters.count(t.count), onClick = t.action) }
        }
    }
}

/** A full-width tile row: violet-tinted icon disc, title + detail, a value, a chevron. */
@Composable
private fun HomeRow(
    title: String,
    detail: String?,
    icon: ImageVector? = null,
    value: String? = null,
    valueCaption: String? = null,
    leading: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)?,
) {
    val haptics = rememberYardHaptics()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .clip(RoundedCornerShape(HomeRadius.tile))
            .background(Color.yard.studioTile)
            .then(if (onClick != null) Modifier.pressableClick(onClickLabel = title) { haptics.click(); onClick() } else Modifier)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        if (leading != null) {
            leading()
        } else if (icon != null) {
            Box(Modifier.size(40.dp).background(Color.yard.studioAccentTint, CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = Color.yard.studioAccentInk, modifier = Modifier.size(20.dp))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = YardFonts.headline.copy(fontSize = 15.sp, lineHeight = 20.sp), color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!detail.isNullOrBlank()) Text(detail, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (value != null) {
            Column(horizontalAlignment = Alignment.End) {
                Text(value, style = YardFonts.number(17.sp), color = Color.yard.ink, maxLines = 1)
                if (valueCaption != null) Text(valueCaption, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1)
            }
        }
        if (onClick != null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(20.dp))
    }
}

/** "Your shop": store views and the best sellers, as the same rows. */
@Composable
private fun YourShop(d: StudioDashboard, onOpen: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Text(
            "Your shop",
            style = YardFonts.headline,
            color = Color.yard.ink,
            modifier = Modifier.padding(top = Spacing.m, bottom = Spacing.xs, start = Spacing.xs).semantics { heading() },
        )
        HomeRow(
            "Shop views",
            "${Formatters.count(d.storeViews.today)} today · ${Formatters.count(d.storeViews.month)} in 30 days",
            Icons.Outlined.Visibility,
            value = Formatters.count(d.storeViews.week),
            valueCaption = "7 days",
            onClick = null,
        )
        if (d.topProducts.isEmpty()) {
            HomeRow("Best sellers", "Your top products of the last ${d.series.days} days show here after your first sales", Icons.Outlined.Inventory2, onClick = null)
        } else {
            d.topProducts.forEach { p ->
                HomeRow(
                    p.title,
                    "${p.units} sold",
                    value = studioMoney(p.revenueMinor, p.currency),
                    leading = {
                        RemoteImage(
                            Config.url(p.image?.src),
                            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Color.yard.studioTile2),
                            maxPixelSize = 160,
                            contentDescription = p.image?.alt,
                        )
                    },
                    onClick = { onOpen(p.productId) },
                )
            }
        }
    }
}

// endregion

/** A list row: icon disc, title + detail, optional count badge, chevron (Studio Me and lists). */
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

/** Loading: the tiles and rows as soft blocks in the same places. */
@Composable
private fun HomeSkeleton() {
    @Composable
    fun Line(width: Dp, height: Dp = 12.dp, shape: androidx.compose.ui.graphics.Shape = YardShapes.pill) =
        Box(Modifier.width(width).height(height).background(Color.yard.studioTile2, shape))
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            repeat(2) {
                Column(
                    Modifier.weight(1f).height(156.dp).clip(RoundedCornerShape(HomeRadius.tile)).background(Color.yard.studioTile).shimmering().padding(Spacing.l),
                ) {
                    Line(84.dp, 14.dp)
                    Spacer(Modifier.weight(1f))
                    Line(64.dp, 28.dp, RoundedCornerShape(8.dp))
                    Spacer(Modifier.height(Spacing.s))
                    Line(72.dp, 10.dp)
                }
            }
        }
        repeat(3) {
            Row(
                Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(HomeRadius.tile)).background(Color.yard.studioTile).shimmering().padding(horizontal = Spacing.l),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                Box(Modifier.size(40.dp).background(Color.yard.studioTile2, CircleShape))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Line(140.dp, 13.dp)
                    Line(96.dp, 10.dp)
                }
            }
        }
    }
}
