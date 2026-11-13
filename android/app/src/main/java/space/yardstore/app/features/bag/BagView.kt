package space.yardstore.app.features.bag

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.app.tabPillScrollSensor
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartLine
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.AdaptiveContent
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.core.models.CartGroup
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.QuantityStepper
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/** Keeps the bag's quote loader for this back-stack entry (iOS: `@State private var quotes`). */
class BagViewModel : ViewModel() {
    val quotes = BagQuoteLoader()
}

/**
 * The bag (website: /bag, src/components/market/checkout/bag-view.tsx + bag-contents.tsx).
 * Mirrors `BagView.swift`.
 *
 * Lines grouped by brand — each brand packs and ships its own parcel — with a per-brand subtotal,
 * shipping price and arrival estimate from the server's quote for the shopper's delivery country,
 * a stepper per line, swipe to remove, and a bottom bar with the total and Checkout.
 */
@Composable
fun BagView() {
    val model: BagViewModel = viewModel { BagViewModel() }
    BagView(quotes = model.quotes)
}

/** The bag with an explicit quote loader (previews inject one, iOS `init(previewQuotes:)`). */
@Composable
fun BagView(quotes: BagQuoteLoader) {
    val cart = LocalCartStore.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val back = LocalBackAction.current
    val scope = rememberCoroutineScope()

    var shipTo by rememberSaveable { mutableStateOf(BagMarkets.shipTo) }

    // iOS `.task { await cart.load() }` runs whenever the bag appears. Tab roots stay composed while
    // hidden on Android, so key the reload on the bag being on screen.
    val onScreen = back != null || (router.selectedTab == AppTab.Bag && router.depth == 0)
    LaunchedEffect(onScreen) {
        if (onScreen) {
            shipTo = BagMarkets.shipTo // the checkout may have changed it
            cart.load()
        }
    }

    suspend fun loadQuotes() {
        val c = cart.cart ?: return
        if (c.lines.isEmpty()) return
        quotes.load(c.currency, shipTo, BagMarkets.shipToCity)
    }

    // Changes whenever the lines, currency or destination change, re-running the quote.
    val quoteKey = run {
        val lines = (cart.cart?.lines ?: emptyList()).joinToString(",") { "${it.variantId}:${it.qty}" }
        "${cart.currency}|$shipTo|$lines"
    }
    LaunchedEffect(quoteKey) { loadQuotes() }

    fun changeShipTo(code: String) {
        shipTo = code
        BagMarkets.shipTo = code
    }

    fun goToCheckout() {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        router.push(Route.Checkout)
    }

    fun setQuantity(line: CartLine, qty: Int) {
        scope.launch {
            try {
                cart.setQuantity(line.variantId, qty)
                if (qty <= 0) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    suspend fun remove(line: CartLine): Boolean = try {
        cart.remove(line.variantId)
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        toast.show("Removed from your bag", Toast.Style.Info, Icons.Outlined.Delete)
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        toast.show(e)
        false
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        if (back != null) YardTopBarCompat() else Spacer(Modifier.statusBarsPadding())
        val c = cart.cart
        val error = cart.lastError
        when {
            c != null && c.lines.isEmpty() -> BagEmpty(onDiscover = { router.push(Route.BrandsDirectory) })
            c != null -> BagList(
                c = c,
                quotes = quotes,
                shipTo = shipTo,
                busyVariantIds = cart.busyVariantIds,
                onShipTo = ::changeShipTo,
                onRefresh = {
                    cart.load()
                    loadQuotes()
                },
                onOpen = { line -> line.productId?.let { router.push(Route.Product(slug = it)) } },
                onQuantity = ::setQuantity,
                onRemove = { remove(it) },
                onCheckout = ::goToCheckout,
            )
            error != null -> EmptyState.Error(error, Modifier.fillMaxSize()) { cart.load() }
            else -> BagSkeleton()
        }
    }
}

/** Back button row when the bag is pushed (not a tab root); the bag draws its own big title. */
@Composable
private fun YardTopBarCompat() {
    space.yardstore.app.designsystem.components.YardTopBar(title = null)
}

@Composable
private fun BagEmpty(onDiscover: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(bottom = LocalTabPillClearance.current),
    ) {
        BagHeader(itemCount = 0, brandCount = 0, modifier = Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter))
        Spacer(Modifier.weight(1f))
        EmptyState(
            title = "Your bag is empty",
            message = "Add pieces from any brand and they check out together, one order per brand.",
            icon = Icons.Outlined.ShoppingBag,
            actionTitle = "Discover brands",
            action = onDiscover,
        )
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun BagList(
    c: Cart,
    quotes: BagQuoteLoader,
    shipTo: String,
    busyVariantIds: Set<String>,
    onShipTo: (String) -> Unit,
    onRefresh: suspend () -> Unit,
    onOpen: (CartLine) -> Unit,
    onQuantity: (CartLine, Int) -> Unit,
    onRemove: suspend (CartLine) -> Boolean,
    onCheckout: () -> Unit,
) {
    val window = LocalYardWindow.current
    val shipping = bagShippingTotal(c, quotes)
    val lines: @Composable (Modifier, Dp) -> Unit = { modifier, bottom ->
        BagLinesPane(
            c = c,
            quotes = quotes,
            shipTo = shipTo,
            busyVariantIds = busyVariantIds,
            onShipTo = onShipTo,
            onRefresh = onRefresh,
            onOpen = onOpen,
            onQuantity = onQuantity,
            onRemove = onRemove,
            bottomPadding = bottom,
            modifier = modifier,
        )
    }
    if (window.isExpanded) {
        // Tablet: the lines on the left, the summary with Checkout in a side column (no bottom bar).
        val clearance = LocalTabPillClearance.current
        AdaptiveContent(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxSize()) {
                lines(Modifier.weight(1f), Spacing.l + clearance)
                BagSummaryPanel(
                    c = c,
                    shippingMinor = shipping,
                    isQuoting = quotes.isLoading,
                    onCheckout = onCheckout,
                    modifier = Modifier
                        .width(bagSummaryWidth(window.width))
                        .fillMaxHeight()
                        .verticalScroll(rememberScrollState())
                        .padding(top = Spacing.s, end = Spacing.gutter, bottom = Spacing.l + clearance),
                )
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            // Medium: one column, capped at the reading width (the bar's content is capped too).
            AdaptiveContent(Modifier.weight(1f)) { lines(Modifier.fillMaxSize(), Spacing.l) }
            BagBottomBar(c = c, shippingMinor = shipping, onCheckout = onCheckout)
        }
    }
}

/** The summary column's width on Expanded windows. */
internal fun bagSummaryWidth(width: Dp): Dp = if (width >= 1100.dp) 380.dp else 340.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BagLinesPane(
    c: Cart,
    quotes: BagQuoteLoader,
    shipTo: String,
    busyVariantIds: Set<String>,
    onShipTo: (String) -> Unit,
    onRefresh: suspend () -> Unit,
    onOpen: (CartLine) -> Unit,
    onQuantity: (CartLine, Int) -> Unit,
    onRemove: suspend (CartLine) -> Boolean,
    bottomPadding: Dp,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val refreshState = rememberPullToRefreshState()
    val grouped = remember(c) { c.groups.flatMap { it.variantIds }.toSet() }
    val loose = remember(c) { c.lines.filter { it.variantId !in grouped } }
    val countryName = BagMarkets.country(shipTo).name

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try { onRefresh() } finally { refreshing = false }
            }
        },
        state = refreshState,
        modifier = modifier,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = refreshState,
                isRefreshing = refreshing,
                containerColor = Color.yard.surface,
                color = Color.yard.ink,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        },
    ) {
        LazyColumn(
            Modifier.fillMaxSize().tabPillScrollSensor(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = Spacing.gutter,
                end = Spacing.gutter,
                bottom = bottomPadding,
            ),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            item(key = "header") {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    BagHeader(itemCount = c.itemCount, brandCount = c.groups.size)
                    BagNotice(
                        icon = Icons.Outlined.Inventory2,
                        text = "One checkout creates one order per brand. Each brand packs and ships its own parcel, with its own tracking.",
                    )
                    BagShipToMenu(shipTo = shipTo, onSelect = onShipTo)
                    if (c.issues.isNotEmpty()) {
                        BagNotice(icon = Icons.Outlined.ErrorOutline, text = c.issues.joinToString("\n"), tint = Color.yard.danger)
                    }
                }
            }

            items(c.groups, key = { "group-${it.brandId}" }) { group ->
                val lines = c.lines(group)
                val quote = quotes.quote(group.brandId)
                Column(Modifier.animateItem(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    BagGroupHeader(name = bagBrandName(lines, quote), pieces = lines.sumOf { it.qty })
                    Column(Modifier.fillMaxWidth().yardCard(radius = Radius.small)) {
                        lines.forEach { line ->
                            key(line.variantId) {
                                BagSwipeLine(
                                    line = line,
                                    currency = c.currency,
                                    isBusy = line.variantId in busyVariantIds,
                                    onOpen = { onOpen(line) },
                                    onQuantity = { onQuantity(line, it) },
                                    onRemove = { onRemove(line) },
                                )
                                YardDivider(Modifier.padding(start = Spacing.m))
                            }
                        }
                        BagGroupFooter(
                            subtotalMinor = group.subtotalMinor,
                            currency = c.currency,
                            quote = quote,
                            isLoading = quotes.isLoading,
                            countryName = countryName,
                            modifier = Modifier.padding(Spacing.m),
                        )
                    }
                }
            }

            if (loose.isNotEmpty()) {
                item(key = "loose") {
                    Column(Modifier.animateItem(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        BagGroupHeader(name = "No longer available", pieces = null)
                        Column(Modifier.fillMaxWidth().yardCard(radius = Radius.small)) {
                            loose.forEachIndexed { i, line ->
                                key(line.variantId) {
                                    if (i > 0) YardDivider(Modifier.padding(start = Spacing.m))
                                    BagSwipeLine(
                                        line = line,
                                        currency = c.currency,
                                        isBusy = line.variantId in busyVariantIds,
                                        onOpen = { onOpen(line) },
                                        onQuantity = { onQuantity(line, it) },
                                        onRemove = { onRemove(line) },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item(key = "taxes") {
                Text(
                    "Taxes aren't calculated in this build. Import duties, if any, are collected by the courier on delivery. Delivery dates are estimates, not guarantees.",
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                )
            }
        }
    }
}

/**
 * Android tablet only (Expanded): the bag's totals and Checkout beside the lines, in place of the
 * bottom bar. Same numbers and words as the bottom bar and the checkout's order summary.
 */
@Composable
private fun BagSummaryPanel(
    c: Cart,
    shippingMinor: Int?,
    isQuoting: Boolean,
    onCheckout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val blocked = c.lines.any { it.isUnavailable }
    Column(modifier) {
        Column(
            Modifier.fillMaxWidth().yardCard().padding(Spacing.l),
            verticalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            Text("Order summary", style = YardFonts.title, color = Color.yard.ink)
            CheckoutSummaryRow("Subtotal") {
                PriceText(minor = c.subtotalMinor, currency = c.currency, style = YardFonts.bodyEmphasis)
            }
            CheckoutSummaryRow(if (c.groups.size == 1) "Shipping" else "Shipping, ${c.groups.size} brands") {
                when {
                    shippingMinor == 0 -> Text("Free", style = YardFonts.bodyEmphasis, color = Color.yard.success)
                    shippingMinor != null -> PriceText(minor = shippingMinor, currency = c.currency, style = YardFonts.bodyEmphasis)
                    isQuoting -> Skeleton(Modifier.size(width = 56.dp, height = 14.dp), shape = SkeletonShape.Capsule)
                    else -> Text("—", style = YardFonts.bodyEmphasis, color = Color.yard.ink3)
                }
            }
            YardDivider()
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "${if (shippingMinor == null) "Subtotal" else "Total"}, ${bagPlural(c.itemCount, "item")}",
                    style = YardFonts.caption,
                    color = Color.yard.ink2,
                )
                BagAnimatedPrice(minor = c.subtotalMinor + (shippingMinor ?: 0), currency = c.currency)
            }
            if (shippingMinor == null && !isQuoting) {
                Text("Shipping is calculated at checkout", style = YardFonts.caption, color = Color.yard.ink3)
            }
            if (blocked) {
                Text(
                    "Remove the pieces that aren't available to check out.",
                    style = YardFonts.caption,
                    color = Color.yard.danger,
                )
            }
            YardButton(
                "Checkout",
                icon = Icons.Outlined.Lock,
                enabled = !blocked && c.itemCount > 0,
                onClick = onCheckout,
            )
        }
    }
}

/** Shipping across brands, or null until every brand has a deliverable option. */
internal fun bagShippingTotal(c: Cart, quotes: BagQuoteLoader): Int? = bagShippingTotal(c, quotes::quote)

/** [bagShippingTotal] over any quote lookup (tests). */
internal fun bagShippingTotal(c: Cart, quote: (String) -> BagGroupQuote?): Int? {
    if (c.groups.isEmpty()) return null
    var sum = 0
    for (g in c.groups) {
        val q = quote(g.brandId) ?: return null
        if (q.unavailable) return null
        val o = q.option(null) ?: return null
        sum += if (o.free) 0 else o.priceMinor
    }
    return sum
}

private fun bagBrandName(lines: List<CartLine>, quote: BagGroupQuote?): String {
    lines.firstOrNull { !it.brandName.isNullOrEmpty() }?.brandName?.let { return it }
    if (quote != null && quote.brandName.isNotEmpty()) return quote.brandName
    return "Brand"
}

internal fun bagPlural(n: Int, one: String): String = "$n ${if (n == 1) one else one + "s"}"

@Composable
private fun BagHeader(itemCount: Int, brandCount: Int, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(top = Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        YardDisplayText("Bag", size = 44.sp, color = Color.yard.ink)
        if (itemCount > 0) {
            Text(
                "${bagPlural(itemCount, "item")} from ${bagPlural(brandCount, "brand")}",
                style = YardFonts.callout.monospacedDigits(),
                color = Color.yard.ink2,
            )
        }
    }
}

@Composable
private fun BagShipToMenu(shipTo: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val name = BagMarkets.country(shipTo).name
    Box {
        Row(
            Modifier
                // 32dp pill (iOS), inside a 48dp touch target.
                .pressableClick(onClickLabel = "Change delivery country") { open = true }
                .minimumInteractiveComponentSize()
                .height(32.dp)
                .clip(RoundedCornerShape(50))
                .background(Color.yard.surface2)
                .padding(horizontal = Spacing.m)
                .semantics { contentDescription = "Delivery country, $name" },
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(15.dp))
            Text("Delivering to $name", style = YardFonts.captionEmphasis, color = Color.yard.ink)
            Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(16.dp))
        }
        BagCountryMenu(expanded = open, selected = shipTo, onDismiss = { open = false }, onSelect = {
            open = false
            onSelect(it)
        })
    }
}

/** The country list shared by the bag's "Delivering to" pill and the checkout's Country field. */
@Composable
internal fun BagCountryMenu(expanded: Boolean, selected: String, onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    BagOptionsMenu(
        expanded = expanded,
        options = BagMarkets.countries.map { it.code to it.name },
        selected = selected,
        onDismiss = onDismiss,
        onSelect = onSelect,
    )
}

/** A dropdown of (value, title) pairs in Yard's colours (iOS `Menu { Picker }`). */
@Composable
internal fun BagOptionsMenu(
    expanded: Boolean,
    options: List<Pair<String, String>>,
    selected: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        containerColor = Color.yard.surface,
        shape = RoundedCornerShape(Radius.small),
        modifier = Modifier.heightIn(max = 420.dp),
    ) {
        options.forEach { (value, title) ->
            DropdownMenuItem(
                text = {
                    Text(
                        title,
                        style = if (value == selected) YardFonts.bodyEmphasis else YardFonts.body,
                        color = Color.yard.ink,
                    )
                },
                trailingIcon = if (value == selected) {
                    { Icon(Icons.Filled.Check, contentDescription = "Selected", tint = Color.yard.ink, modifier = Modifier.size(18.dp)) }
                } else {
                    null
                },
                onClick = { onSelect(value) },
            )
        }
    }
}

@Composable
private fun BagBottomBar(c: Cart, shippingMinor: Int?, onCheckout: () -> Unit) {
    val blocked = c.lines.any { it.isUnavailable }
    val clearance = LocalTabPillClearance.current
    val line = Color.yard.line
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface.copy(alpha = 0.96f))
            .drawBehind { drawLine(line, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }
            .then(if (clearance > 0.dp) Modifier.padding(bottom = clearance) else Modifier.navigationBarsPadding())
            .adaptiveContentWidth()
            .padding(horizontal = Spacing.gutter, vertical = Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        if (blocked) {
            Text(
                "Remove the pieces that aren't available to check out.",
                style = YardFonts.caption,
                color = Color.yard.danger,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "${if (shippingMinor == null) "Subtotal" else "Total"}, ${bagPlural(c.itemCount, "item")}",
                    style = YardFonts.caption,
                    color = Color.yard.ink2,
                )
                BagAnimatedPrice(minor = c.subtotalMinor + (shippingMinor ?: 0), currency = c.currency)
            }
            YardButton(
                "Checkout",
                icon = Icons.Outlined.Lock,
                fullWidth = false,
                enabled = !blocked && c.itemCount > 0,
                onClick = onCheckout,
            )
        }
    }
}

/** A big total that cross-fades when it changes (iOS `.contentTransition(.numericText())`). */
@Composable
internal fun BagAnimatedPrice(minor: Int, currency: String) {
    AnimatedContent(
        targetState = minor to currency,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "bag-total",
    ) { (m, cur) ->
        PriceText(minor = m, currency = cur, style = YardFonts.number(22.sp))
    }
}

/** A bag line with swipe-to-remove (iOS `.swipeActions` → Remove). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BagSwipeLine(
    line: CartLine,
    currency: String,
    isBusy: Boolean,
    onOpen: () -> Unit,
    onQuantity: (Int) -> Unit,
    onRemove: suspend () -> Boolean,
) {
    val state = rememberSwipeToDismissBoxState()
    LaunchedEffect(state.currentValue) {
        if (state.currentValue == SwipeToDismissBoxValue.EndToStart) {
            if (!onRemove()) state.reset()
        }
    }
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().background(Color.yard.danger).padding(horizontal = Spacing.xl),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Delete, contentDescription = null, tint = Color.yard.onPhoto, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(Spacing.s))
                Text("Remove", style = YardFonts.bodyEmphasis, color = Color.yard.onPhoto)
            }
        },
    ) {
        BagLineRow(
            line = line,
            currency = currency,
            isBusy = isBusy,
            onOpen = onOpen,
            onQuantity = onQuantity,
            modifier = Modifier.background(Color.yard.surface).padding(Spacing.m),
        )
    }
}

/** One bag line: photo, title, variant, line price, stepper. */
@Composable
fun BagLineRow(
    line: CartLine,
    currency: String,
    isBusy: Boolean,
    onOpen: () -> Unit,
    onQuantity: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val statusNote: String? = when {
        line.isUnavailable -> when (line.unavailableReason.orEmpty()) {
            "sold_out" -> "Sold out"
            "not_for_sale" -> "Not selling yet"
            else -> "No longer available"
        }
        line.isShort -> "Only ${line.available} left"
        else -> null
    }
    // The most the stepper allows: what's left (the server caps a line at 20).
    val upperBound = maxOf(0, minOf(20, line.available))

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        RemoteImage(
            url = line.imageUrl,
            maxPixelSize = 300,
            contentDescription = line.title ?: "Piece",
            modifier = Modifier
                .size(width = 76.dp, height = 96.dp)
                .clip(RoundedCornerShape(Radius.small))
                .then(if (line.isUnavailable) Modifier.bagDesaturated() else Modifier)
                .pressableClick(onClickLabel = "Open") { onOpen() },
        )
        Column(Modifier.weight(1f).heightIn(min = 96.dp), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(
                line.title ?: "A piece from your bag",
                style = YardFonts.bodyEmphasis,
                color = Color.yard.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.pressableClick(onClickLabel = "Open") { onOpen() },
            )
            val label = line.variantLabel
            if (!label.isNullOrEmpty()) {
                Text(label, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (statusNote != null) {
                Text(statusNote, style = YardFonts.captionEmphasis, color = Color.yard.danger)
            }
            Spacer(Modifier.weight(1f, fill = false).heightIn(min = Spacing.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    PriceText(minor = line.lineMinor, currency = currency, style = YardFonts.bodyEmphasis)
                    if (line.qty > 1) {
                        Text("${Formatters.price(line.unitMinor, currency)} each", style = YardFonts.micro, color = Color.yard.ink3)
                    }
                }
                QuantityStepper(value = line.qty, range = 0..upperBound, isBusy = isBusy, onChange = onQuantity)
            }
        }
    }
}

/** Greyscale at 60% (iOS `.saturation(0).opacity(0.6)`). */
private fun Modifier.bagDesaturated(): Modifier = this
    .graphicsLayer(alpha = 0.6f, compositingStrategy = CompositingStrategy.Offscreen)
    .drawWithContent {
        drawContent()
        drawRect(Color.Gray, blendMode = BlendMode.Saturation)
    }

/** Brand section header: name + piece count. */
@Composable
fun BagGroupHeader(name: String, pieces: Int?) {
    Row(
        Modifier.fillMaxWidth().padding(top = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        BrandAvatar(name = name, size = 24.dp)
        Text(name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (pieces != null) {
            Text(if (pieces == 1) "1 piece" else "$pieces pieces", style = YardFonts.caption, color = Color.yard.ink2)
        }
    }
}

/**
 * A brand group's subtotal, shipping and arrival estimate (from the server quote only: a
 * skeleton while it loads, "calculated at checkout" when it couldn't).
 */
@Composable
fun BagGroupFooter(
    subtotalMinor: Int,
    currency: String,
    quote: BagGroupQuote?,
    isLoading: Boolean,
    countryName: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Subtotal", style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.weight(1f))
            PriceText(minor = subtotalMinor, currency = currency, style = YardFonts.bodyEmphasis)
        }
        when {
            quote != null -> {
                val option = quote.option(null)
                if (quote.unavailable || option == null) {
                    val raw = quote.reason ?: "Doesn't ship to $countryName"
                    val reason = if (raw.endsWith(".")) raw.dropLast(1) else raw
                    Text(
                        "$reason. Remove its pieces or change the delivery country at checkout.",
                        style = YardFonts.caption,
                        color = Color.yard.ink3,
                    )
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Shipping, ${option.label.lowercase()}",
                            style = YardFonts.callout,
                            color = Color.yard.ink2,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (option.free) {
                            Text("Free", style = YardFonts.bodyEmphasis, color = Color.yard.success)
                        } else {
                            PriceText(minor = option.priceMinor, currency = option.currency, style = YardFonts.bodyEmphasis)
                        }
                    }
                    option.arrivalText?.let { Tag(it, style = TagStyle.Neutral, icon = Icons.Outlined.LocalShipping) }
                }
            }
            isLoading -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Skeleton(Modifier.size(width = 110.dp, height = 12.dp), shape = SkeletonShape.Capsule)
                    Spacer(Modifier.weight(1f))
                    Skeleton(Modifier.size(width = 48.dp, height = 12.dp), shape = SkeletonShape.Capsule)
                }
                Skeleton(Modifier.size(width = 150.dp, height = 22.dp), shape = SkeletonShape.Capsule)
            }
            else -> Text("Shipping is calculated at checkout", style = YardFonts.caption, color = Color.yard.ink3)
        }
    }
}

/** A quiet bordered notice with an icon (the website's Notice). */
@Composable
fun BagNotice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    modifier: Modifier = Modifier,
    tint: Color = Color.yard.ink2,
) {
    Row(
        modifier
            .fillMaxWidth()
            .yardCard(background = Color.yard.surface, radius = Radius.small)
            .padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 1.dp).size(16.dp))
        Text(text, style = YardFonts.caption, color = Color.yard.ink2)
    }
}

/** Loading placeholder shaped like the bag. */
@Composable
fun BagSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .adaptiveContentWidth()
            .padding(horizontal = Spacing.gutter)
            .semantics { contentDescription = "Loading your bag" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.padding(top = Spacing.s).size(width = 120.dp, height = 40.dp), cornerRadius = 8.dp)
        Skeleton(Modifier.fillMaxWidth().height(56.dp), cornerRadius = Radius.small)
        repeat(2) {
            Column(Modifier.fillMaxWidth().yardCard().padding(Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.size(width = 140.dp, height = 16.dp), shape = SkeletonShape.Capsule)
                repeat(2) {
                    Row(Modifier.height(96.dp), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        Skeleton(Modifier.size(width = 76.dp, height = 96.dp), cornerRadius = Radius.small)
                        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            Skeleton(Modifier.fillMaxWidth().height(14.dp), shape = SkeletonShape.Capsule)
                            Skeleton(Modifier.size(width = 80.dp, height = 12.dp), shape = SkeletonShape.Capsule)
                            Spacer(Modifier.weight(1f))
                            Skeleton(Modifier.size(width = 60.dp, height = 16.dp), shape = SkeletonShape.Capsule)
                        }
                    }
                }
            }
        }
    }
}

// region Previews (fixtures are preview-only)

private object BagPreviewData {
    val cart = Cart(
        id = "cart_preview",
        currency = "USD",
        itemCount = 3,
        subtotalMinor = 21900,
        lines = listOf(
            CartLine(variantId = "v1", productId = "p1", brandId = "b1", title = "Boxy heavyweight tee", variantLabel = "Size M, Black", qty = 2, available = 5, unitMinor = 4500, lineMinor = 9000, brandName = "Acme Studio"),
            CartLine(variantId = "v2", productId = "p2", brandId = "b2", title = "Cargo pant", variantLabel = "Size 32", qty = 1, available = 1, unitMinor = 12900, lineMinor = 12900, status = "short", brandName = "Lagos Uniform"),
        ),
    )

    /** The same bag grouped by brand, as GET /api/cart answers (tablet previews). */
    val groupedCart = cart.copy(
        groups = listOf(
            CartGroup(brandId = "b1", variantIds = listOf("v1"), subtotalMinor = 9000),
            CartGroup(brandId = "b2", variantIds = listOf("v2"), subtotalMinor = 12900),
        ),
    )

    val quotes = listOf(
        BagGroupQuote(brandId = "b1", brandName = "Acme Studio", options = listOf(
            BagQuoteOption(service = "standard", label = "Standard", available = true, priceMinor = 600, currency = "USD", estimate = BagEstimate("2026-11-18", "2026-11-21")),
        )),
        BagGroupQuote(brandId = "b2", brandName = "Lagos Uniform", unavailable = true, reason = "Doesn't ship to Japan"),
    )
}

@Preview(name = "BagView — dark")
@Composable
private fun BagViewDark() = YardPreview(darkTheme = true) { BagView(quotes = BagQuoteLoader.preview(null, emptyList())) }

@Preview(name = "BagView — light")
@Composable
private fun BagViewLight() = YardPreview(darkTheme = false) { BagView(quotes = BagQuoteLoader.preview(null, emptyList())) }

/** The bag with lines (tablet previews: lines + summary side by side on Expanded). */
@Composable
private fun BagTabletPreviewContent() {
    val store = remember { CartStore.preview(BagPreviewData.groupedCart) }
    CompositionLocalProvider(LocalCartStore provides store) {
        BagView(quotes = remember { BagQuoteLoader.preview(BagPreviewData.groupedCart, listOf(BagPreviewData.quotes[0].copy(brandName = "Acme Studio"), BagPreviewData.quotes[1].copy(unavailable = false, reason = null, options = BagPreviewData.quotes[0].options))) })
    }
}

@YardTabletPreviews
@Composable
private fun BagViewTabletDark() = YardPreview(darkTheme = true) { BagTabletPreviewContent() }

@YardTabletPreviews
@Composable
private fun BagViewTabletLight() = YardPreview(darkTheme = false) { BagTabletPreviewContent() }

@Composable
private fun BagRowsPreviewContent(quote: BagGroupQuote, country: String, busy: String?) {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        BagGroupHeader(name = quote.brandName, pieces = 3)
        Column(Modifier.yardCard(radius = Radius.small)) {
            BagPreviewData.cart.lines.forEach { line ->
                BagLineRow(line, "USD", isBusy = line.variantId == busy, onOpen = {}, onQuantity = {}, modifier = Modifier.padding(Spacing.m))
                YardDivider()
            }
            BagGroupFooter(9000, "USD", quote, isLoading = false, countryName = country, modifier = Modifier.padding(Spacing.m))
        }
    }
}

@Preview(name = "Bag rows — dark")
@Composable
private fun BagRowsDark() = YardPreview(darkTheme = true) { BagRowsPreviewContent(BagPreviewData.quotes[0], "Nigeria", null) }

@Preview(name = "Bag rows — light")
@Composable
private fun BagRowsLight() = YardPreview(darkTheme = false) { BagRowsPreviewContent(BagPreviewData.quotes[1], "Japan", "v2") }

// endregion
