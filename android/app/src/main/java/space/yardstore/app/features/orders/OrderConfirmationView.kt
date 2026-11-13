package space.yardstore.app.features.orders

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

/**
 * Loads one checkout and its brand orders; while the payment is pending it re-reads every
 * 2.5 s for a minute, asking the provider directly every 4th read (the website's
 * confirmation-view.tsx behaviour). Mirrors `OrderConfirmationModel`.
 */
class OrderConfirmationModel(
    private val pollEveryMillis: Long = 2_500,
    private val pollForMillis: Long = 60_000,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : ViewModel() {
    enum class Confirming { Idle, Polling, TimedOut }

    var checkout by mutableStateOf<OrderCheckout?>(null); private set
    var orders by mutableStateOf<List<OrderSummary>>(emptyList()); private set
    var isLoading by mutableStateOf(true); private set
    var error by mutableStateOf<Throwable?>(null); private set
    var confirming by mutableStateOf(Confirming.Idle); private set

    private var job: Job? = null

    /** Preview-only: fixture values, no network. */
    constructor(previewCheckout: OrderCheckout, previewOrders: List<OrderSummary>) : this() {
        checkout = previewCheckout
        orders = previewOrders
        isLoading = false
    }

    val itemCount: Int get() = orders.sumOf { it.itemCount }

    suspend fun load(checkoutId: String) {
        if (checkout == null) isLoading = true
        try {
            val (c, o) = coroutineScope {
                val c = async { OrdersAPI.checkout(checkoutId) }
                val o = async { OrdersAPI.checkoutOrders(checkoutId) }
                c.await() to o.await()
            }
            checkout = c
            orders = o
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Keep what's shown on a failed refresh; only an empty screen shows the error.
            if (checkout == null) error = e
        } finally {
            isLoading = false
        }
    }

    /** Loads, then polls while the payment is pending (restarts any earlier run). */
    fun start(checkoutId: String): Job {
        job?.cancel()
        return viewModelScope.launch {
            load(checkoutId)
            poll(checkoutId)
        }.also { job = it }
    }

    /** Stops polling (the screen went away). */
    fun stop() {
        job?.cancel()
        job = null
    }

    suspend fun poll(checkoutId: String) {
        val current = checkout
        if (current == null || !current.isPending || current.isAbandoned) {
            confirming = Confirming.Idle
            return
        }
        confirming = Confirming.Polling
        val started = clock()
        var reads = 0
        while (clock() - started < pollForMillis) {
            delay(pollEveryMillis)
            reads += 1
            try {
                val next = if (reads % VERIFY_EVERY == 0) OrdersAPI.verifyCheckout(checkoutId) else OrdersAPI.checkout(checkoutId)
                checkout = next
                if (!next.isPending || next.isAbandoned) {
                    try {
                        orders = OrdersAPI.checkoutOrders(checkoutId)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                    }
                    confirming = Confirming.Idle
                    return
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Keep polling: a dropped read is not the answer.
            }
        }
        confirming = Confirming.TimedOut
    }

    /** How the checkout ended up, from the checkout and its brand orders. */
    fun outcome(checkout: OrderCheckout): OrderConfirmationOutcome = when {
        checkout.isFailed || orders.any { it.states.payment == "failed" } -> OrderConfirmationOutcome.Failed
        checkout.isAbandoned -> OrderConfirmationOutcome.NotPaid
        checkout.isPending || orders.any { it.status == OrderStatus.PendingPayment } -> OrderConfirmationOutcome.Placed
        else -> OrderConfirmationOutcome.Confirmed
    }

    companion object {
        const val VERIFY_EVERY = 4
    }
}

enum class OrderConfirmationOutcome { Confirmed, Placed, NotPaid, Failed }

/**
 * Reference 06: glowing success badge, "Order placed", the checkout as a ticket with a perforated
 * tear line, a details grid, one ticket section per brand, then Track order / Keep shopping.
 */
@Composable
fun OrderConfirmationView(checkoutId: String) {
    val model: OrderConfirmationModel = viewModel(key = "order-confirmation-$checkoutId") { OrderConfirmationModel() }
    OrderConfirmationScreen(checkoutId, model, isPreview = false)
}

@Composable
internal fun OrderConfirmationScreen(checkoutId: String, model: OrderConfirmationModel, isPreview: Boolean) {
    val router = LocalRouter.current
    val session = LocalSessionStore.current
    val cart = LocalCartStore.current
    val haptics = LocalHapticFeedback.current

    // Back is hidden on iOS; × (and system back) pop the tab to its root.
    BackHandler { router.popToRoot() }

    LaunchedEffect(checkoutId, session.isSignedIn) {
        if (!isPreview && session.isSignedIn) model.start(checkoutId)
    }
    androidx.compose.runtime.DisposableEffect(model) { onDispose { if (!isPreview) model.stop() } }

    val isPaid = model.checkout?.isPaid == true
    LaunchedEffect(isPaid) {
        // The cart was emptied server-side when the checkout was placed; resync the badge.
        if (isPaid && !isPreview) {
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            cart.load()
        }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(title = null, back = null) {
            Spacer(Modifier.weight(1f))
            GlassIconButton(Icons.Filled.Close, "Close", Modifier.minimumInteractiveComponentSize(), size = 36.dp) { router.popToRoot() }
        }
        val checkout = model.checkout
        val error = model.error
        when {
            !session.isSignedIn && session.hasLoaded && !isPreview ->
                EmptyState.SignedOut(message = "Sign in to see this order.", modifier = Modifier.adaptiveContentWidth()) {
                    router.present(Route.SignIn)
                }
            model.isLoading && checkout == null -> OrderConfirmationSkeleton()
            error != null && checkout == null -> EmptyState.Error(error, Modifier.adaptiveContentWidth()) { model.start(checkoutId).join() }
            checkout != null -> OrderConfirmationLoaded(checkoutId, checkout, model)
            else -> EmptyState(
                "Order unavailable",
                modifier = Modifier.adaptiveContentWidth(),
                message = "We couldn’t find this checkout.",
                icon = Icons.Outlined.Inventory2,
                actionTitle = "See your orders",
            ) { router.push(Route.Orders) }
        }
    }
}

@Composable
private fun OrderConfirmationLoaded(checkoutId: String, checkout: OrderCheckout, model: OrderConfirmationModel) {
    val outcome = model.outcome(checkout)
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    OrderRefreshBox(onRefresh = { model.load(checkoutId) }) {
        // Reading screen: the ticket and buttons stay at the window's contentMaxWidth, centred.
        OrderReadableList(horizontal = Spacing.gutter, bottom = Spacing.xxxl + bottom, spacing = Spacing.xl) {
            item(key = "header") { OrderConfirmationHeader(model.orders, outcome) }
            if (outcome == OrderConfirmationOutcome.Placed && model.confirming != OrderConfirmationModel.Confirming.Idle) {
                item(key = "confirming") { OrderConfirmingRow(model.confirming) { model.start(checkoutId) } }
            }
            item(key = "ticket") { OrderConfirmationTicket(checkout, model.orders, model.itemCount, outcome) }
            item(key = "actions") { OrderConfirmationActions(checkoutId, checkout, model, outcome) }
            item(key = "footnote") {
                Text(
                    "Quote the order ID if you contact us or a brand.",
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun OrderConfirmationHeader(orders: List<OrderSummary>, outcome: OrderConfirmationOutcome) {
    val single = orders.size == 1
    val brandName = orders.firstOrNull()?.brand?.name
    val withBrand = brandName?.let { " with $it" } ?: ""
    val brandCount = orders.size
    val (title, subtitle, tone) = when (outcome) {
        OrderConfirmationOutcome.Confirmed -> Triple(
            "Order confirmed",
            if (single) "Your payment went through and ${brandName ?: "the brand"} is preparing your order."
            else "Your payment went through and $brandCount brands are preparing their orders, each one shipping separately.",
            OrderBadgeTone.Success,
        )
        OrderConfirmationOutcome.Placed -> Triple(
            "Order placed",
            if (single) "Your order$withBrand is in. Payment confirmation is pending: the brand starts preparing your order once the payment provider confirms it."
            else "Your checkout created $brandCount orders, one per brand. Payment confirmation is pending: each brand starts preparing its order once the payment provider confirms it.",
            OrderBadgeTone.Success,
        )
        OrderConfirmationOutcome.NotPaid -> Triple(
            "Payment wasn’t completed",
            "The payment provider didn’t receive a payment: it was cancelled or the page was closed, so nothing was charged.",
            OrderBadgeTone.Pending,
        )
        OrderConfirmationOutcome.Failed -> Triple(
            "Payment wasn’t completed",
            "The payment provider couldn’t complete this payment. No payment was taken, and the order won’t be prepared. You can try placing it again.",
            OrderBadgeTone.Failed,
        )
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        // SwiftUI `.padding(.bottom, -Spacing.xl)`: the glow overlaps the title.
        OrderSuccessBadge(
            Modifier.layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                layout(placeable.width, placeable.height - Spacing.xl.roundToPx()) { placeable.place(0, 0) }
            },
            tone = tone,
        )
        YardDisplayText(title, size = 40.sp, textAlign = TextAlign.Center)
        Text(subtitle, style = YardFonts.callout, color = Color.yard.ink2, textAlign = TextAlign.Center)
    }
}

@Composable
private fun OrderConfirmingRow(confirming: OrderConfirmationModel.Confirming, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().yardCard().padding(Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        when (confirming) {
            OrderConfirmationModel.Confirming.Polling -> {
                CircularProgressIndicator(Modifier.size(18.dp), color = Color.yard.violet, strokeWidth = 2.dp)
                Text("Checking your payment…", style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.weight(1f))
            }
            OrderConfirmationModel.Confirming.TimedOut -> {
                Text(
                    "Still confirming your payment — we’ll email you when it’s confirmed.",
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                    modifier = Modifier.weight(1f),
                )
                YardButton("Retry", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, onClick = onRetry)
            }
            OrderConfirmationModel.Confirming.Idle -> Unit
        }
    }
}

@Composable
private fun OrderConfirmationTicket(checkout: OrderCheckout, orders: List<OrderSummary>, itemCount: Int, outcome: OrderConfirmationOutcome) {
    val toast = LocalToastCenter.current
    val copy = rememberOrderCopier()
    val reference = checkout.reference ?: orders.firstOrNull()?.groupReference ?: checkout.id
    val created = YardDate.parse(checkout.createdAt)
    val first = orders.firstOrNull()
    val deliveryTo = OrderText.place(first?.shipToPreview?.city, first?.shipToPreview?.country)
    val items = buildList {
        add(OrderDetailsGridItem("Order number", reference))
        add(OrderDetailsGridItem("Date", created?.let { Formatters.dateTime(it) } ?: "—"))
        add(OrderDetailsGridItem("Items", "$itemCount"))
        add(
            OrderDetailsGridItem(
                if (outcome == OrderConfirmationOutcome.Confirmed) "Total charged" else "Total",
                Formatters.price(checkout.totalMinor, checkout.currency),
            ),
        )
        if (deliveryTo != null) add(OrderDetailsGridItem("Delivery to", deliveryTo))
        val method = checkout.payment?.methodLabel
        if (method != null && outcome == OrderConfirmationOutcome.Confirmed) add(OrderDetailsGridItem("Payment", method))
    }
    OrderTicket(
        header = {
            Row(
                Modifier.padding(start = Spacing.l, end = Spacing.l, top = Spacing.l, bottom = Spacing.xs),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text("Checkout", style = YardFonts.caption, color = Color.yard.ink3)
                    SelectionContainer { Text(reference, style = YardFonts.title, color = Color.yard.ink) }
                    Text(
                        if (orders.size <= 1) (first?.brand?.name ?: "1 brand") else "${orders.size} brands shipping separately",
                        style = YardFonts.caption,
                        color = Color.yard.ink2,
                    )
                }
                GlassIconButton(Icons.Outlined.ContentCopy, "Copy order ID", Modifier.minimumInteractiveComponentSize(), size = 36.dp) {
                    copy("Order ID", reference)
                    toast.show("Order ID copied", Toast.Style.Success, Icons.Outlined.ContentCopy)
                }
            }
        },
    ) {
        OrderDetailsGrid(items, Modifier.padding(start = Spacing.l, end = Spacing.l, bottom = Spacing.l))
        orders.forEach { order ->
            OrderPerforation(Modifier.padding(horizontal = Spacing.l))
            OrderConfirmationBrandSection(order)
        }
    }
}

@Composable
private fun OrderConfirmationBrandSection(order: OrderSummary) {
    val router = LocalRouter.current
    Row(
        Modifier
            .fillMaxWidth()
            .pressableClick { router.push(Route.Order(order.id)) }
            .semantics { onClick(label = "Opens this brand's order") { router.push(Route.Order(order.id)); true } }
            .padding(Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        BrandAvatar(order.brand.name, size = 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(order.brand.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(order.itemsTitle, style = YardFonts.callout, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "Order ${order.reference} · ${Formatters.price(order.totalMinor, order.currency)}",
                style = YardFonts.caption,
                color = Color.yard.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            OrderStatusChip(order.status, Modifier.padding(top = Spacing.xxs))
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun OrderConfirmationActions(checkoutId: String, checkout: OrderCheckout, model: OrderConfirmationModel, outcome: OrderConfirmationOutcome) {
    val router = LocalRouter.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    fun trackOrder() {
        val only = model.orders.singleOrNull()
        if (only != null) router.push(Route.Order(only.id)) else router.push(Route.Orders)
    }
    fun keepShopping() {
        router.popToRoot()
        router.select(AppTab.Home)
    }
    fun returnToBag() {
        router.popToRoot(AppTab.Bag)
        router.select(AppTab.Bag)
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        when (outcome) {
            OrderConfirmationOutcome.Confirmed, OrderConfirmationOutcome.Placed -> {
                YardButton("Track order", icon = Icons.Outlined.Inventory2) { trackOrder() }
                YardButton("Keep shopping", style = YardButtonStyle.Secondary) { keepShopping() }
            }
            OrderConfirmationOutcome.NotPaid -> {
                val link = OrderText.nonEmpty(checkout.payment?.authorizationUrl)
                if (link != null) {
                    YardButton("Pay now") { WebPages.open(context, link, darkTheme = dark) }
                } else {
                    YardButton("Return to bag") { returnToBag() }
                }
                YardButton("Check again", style = YardButtonStyle.Secondary) { model.start(checkoutId) }
            }
            OrderConfirmationOutcome.Failed -> {
                YardButton("Return to bag") { returnToBag() }
                YardButton("See your orders", style = YardButtonStyle.Secondary) { router.push(Route.Orders) }
            }
        }
    }
}

@Composable
private fun OrderConfirmationSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState(), enabled = false)
            .adaptiveContentWidth()
            .padding(horizontal = Spacing.gutter),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Spacer(Modifier.height(Spacing.xxxl - Spacing.l))
        Skeleton(Modifier.size(92.dp), shape = SkeletonShape.Circle)
        Skeleton(Modifier.width(220.dp).height(34.dp), cornerRadius = 8.dp)
        Skeleton(Modifier.width(280.dp).height(14.dp), cornerRadius = 6.dp)
        Skeleton(Modifier.fillMaxWidth().padding(top = Spacing.l).height(320.dp), cornerRadius = Radius.card)
        Skeleton(Modifier.fillMaxWidth().height(52.dp), shape = SkeletonShape.Capsule)
    }
}

// region Previews (fixtures are preview-only)

internal object OrderPreviewData {
    val summaries: List<OrderSummary> = listOf(
        OrderSummary(
            id = "or_1", reference = "YRD-48213-1", groupReference = "YRD-48213", checkoutId = "co_1",
            brand = OrderBrandRef("brd_1", "Acme Studio", "acme"), shipToPreview = OrderShipToPreview("London", "GB"),
            placedAt = "2026-11-13T09:12:00.000Z", currency = "USD", subtotalMinor = 12000, shippingMinor = 1500, totalMinor = 13500,
            itemCount = 2, previewItems = listOf(OrderPreviewItem("p1", "v1", "Boxy tee", 1, 4500)),
            states = OrderStates(merchant = "shipped", payment = "paid", fulfilment = "shipped"),
        ),
        OrderSummary(
            id = "or_2", reference = "YRD-48213-2", groupReference = "YRD-48213", checkoutId = "co_1",
            brand = OrderBrandRef("brd_2", "Northside", "northside"), shipToPreview = OrderShipToPreview("London", "GB"),
            placedAt = "2026-11-13T09:12:00.000Z", currency = "USD", subtotalMinor = 3000, shippingMinor = 0, totalMinor = 3000,
            itemCount = 1, previewItems = listOf(OrderPreviewItem("p2", "v2", "Bucket hat", 1, 3000)),
            states = OrderStates(merchant = "paid", payment = "paid", fulfilment = "unfulfilled"),
        ),
    )

    val checkout = OrderCheckout(
        id = "co_1", status = "paid", reference = "YRD-48213", currency = "USD", subtotalMinor = 15000, shippingMinor = 1500,
        totalMinor = 16500, orderIds = listOf("or_1", "or_2"), createdAt = "2026-11-13T09:12:00.000Z", paidAt = "2026-11-13T09:13:00.000Z",
        payment = OrderCheckoutPayment(provider = "paystack", status = "succeeded", channel = "card"),
    )

    val detail = OrderDetail(
        summary = summaries[0],
        lines = listOf(
            OrderLine("l1", "v1", "p1", "Boxy tee", 1, 4500, variantLabel = "Size M"),
            OrderLine("l2", "v3", "p3", "Cargo pant", 1, 7500, variantLabel = "Size 32"),
        ),
        shipTo = OrderShipTo(name = "Ada Obi", line1 = "12 Example Road", city = "London", postcode = "E1 6AN", country = "GB"),
        paidAt = "2026-11-11T09:13:00.000Z",
        timeline = listOf(
            OrderEvent("e1", "order.placed", "2026-11-11T09:12:00.000Z"),
            OrderEvent("e2", "payment.captured", "2026-11-11T09:13:00.000Z"),
            OrderEvent("e3", "fulfilment.processing", "2026-11-12T10:00:00.000Z"),
            OrderEvent("e4", "fulfilment.shipped", "2026-11-13T08:30:00.000Z"),
        ),
        delivery = OrderDelivery(
            service = "standard",
            shipTo = OrderDeliveryShipTo("GB", "London"),
            estimate = OrderEstimate(arrivalFrom = "2026-11-16", arrivalTo = "2026-11-19"),
            shippedOn = "2026-11-13",
            events = listOf(ShipmentEvent("s1", "shipped", "2026-11-13T08:30:00.000Z", "DHL", "JD014600006281234567", "Lagos")),
        ),
    )
}

@Preview(name = "OrderConfirmationView — dark")
@Composable
private fun OrderConfirmationDarkPreview() = YardPreview(darkTheme = true) {
    OrderConfirmationScreen("co_1", OrderConfirmationModel(OrderPreviewData.checkout, OrderPreviewData.summaries), isPreview = true)
}

@Preview(name = "OrderConfirmationView — light")
@Composable
private fun OrderConfirmationLightPreview() = YardPreview(darkTheme = false) {
    OrderConfirmationScreen("co_1", OrderConfirmationModel(OrderPreviewData.checkout, OrderPreviewData.summaries), isPreview = true)
}

@YardTabletPreviews
@Composable
private fun OrderConfirmationTabletPreview() = YardPreview(darkTheme = true) {
    OrderConfirmationScreen("co_1", OrderConfirmationModel(OrderPreviewData.checkout, OrderPreviewData.summaries), isPreview = true)
}

// endregion
