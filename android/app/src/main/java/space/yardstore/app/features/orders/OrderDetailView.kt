// Lint: view models are built inline only in @Preview / isPreview paths (design-time sample data).
@file:Suppress("ViewModelConstructorInComposable")

package space.yardstore.app.features.orders

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallMade
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.LegalPage
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.QuantityStepper
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.SegmentedPill
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard

class OrderDetailModel() : ViewModel() {
    var order by mutableStateOf<OrderDetail?>(null)
    var isLoading by mutableStateOf(true); private set
    var error by mutableStateOf<Throwable?>(null); private set
    var brandCity by mutableStateOf<String?>(null); private set
    var isCancelling by mutableStateOf(false); private set

    /** Preview-only: a fixture order, no network. */
    constructor(previewOrder: OrderDetail, brandCity: String? = null) : this() {
        order = previewOrder
        this.brandCity = brandCity
        isLoading = false
    }

    suspend fun load(id: String) {
        if (order == null) isLoading = true
        try {
            val fresh = OrdersAPI.detail(id)
            order = fresh
            error = null
            if (brandCity == null) brandCity = OrdersAPI.brandCity(fresh.summary.brand.handle)
        } catch (e: CancellationException) {
            isLoading = false
            throw e
        } catch (e: Exception) {
            val cancelled = e is APIError && e.isCancelled
            if (!cancelled && order == null) error = e
        }
        isLoading = false
    }

    suspend fun cancel(id: String) {
        isCancelling = true
        try {
            order = OrdersAPI.cancel(id)
        } finally {
            isCancelling = false
        }
    }
}

private enum class OrderDetailTab(val title: String) { Status("Status"), Details("Details") }

/**
 * Reference 07: big status heading + subtitle, the tracking card once shipped, then a card with
 * Status / Details. Status is the vertical timeline; Details has items, address, payment,
 * tracking (copy), help (message the brand), returns and cancel.
 */
@Composable
fun OrderDetailView(id: String) {
    val model: OrderDetailModel = viewModel(key = "order-detail-$id") { OrderDetailModel() }
    OrderDetailScreen(id, model, isPreview = false)
}

/**
 * Loads the order. On iOS this then keeps the Live Activity in step with it (starts once shipped,
 * ends when delivered or cancelled).
 */
private suspend fun orderDetailReload(id: String, model: OrderDetailModel) {
    model.load(id)
    // Keep the ongoing order notification (features/liveactivity) in step, as iOS does with its Live Activity.
    val order = model.order ?: return
    val relevant = order.status == OrderStatus.Shipped || order.status == OrderStatus.Delivered ||
        order.status == OrderStatus.Cancelled
    if (relevant || space.yardstore.app.features.liveactivity.LiveTrackingManager.isTracking(id)) {
        space.yardstore.app.features.liveactivity.LiveTrackingManager.sync(id)
    }
}

/**
 * The order in the detail pane of Orders on Expanded windows (`OrdersListView`'s
 * `ListDetailLayout`): no back button, "Back to orders" clears the selection via [onClose], and
 * [onOrderChanged] lets the list beside it refresh after a cancel or a return request.
 */
@Composable
internal fun OrderDetailPane(id: String, onClose: () -> Unit, onOrderChanged: () -> Unit) {
    val model: OrderDetailModel = viewModel(key = "order-detail-$id") { OrderDetailModel() }
    CompositionLocalProvider(LocalBackAction provides null) {
        OrderDetailScreen(id, model, isPreview = false, onClose = onClose, onOrderChanged = onOrderChanged)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OrderDetailScreen(
    id: String,
    model: OrderDetailModel,
    isPreview: Boolean,
    /** Replaces `router.pop()` for "Back to orders" (the detail pane clears its selection). */
    onClose: (() -> Unit)? = null,
    /** Called after the order changed here (cancelled, return requested). */
    onOrderChanged: (() -> Unit)? = null,
) {
    val router = LocalRouter.current
    val session = LocalSessionStore.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var showsCancelConfirm by remember { mutableStateOf(false) }
    var showsReturnSheet by remember { mutableStateOf(false) }

    LaunchedEffect(id, session.isSignedIn) {
        if (!isPreview && session.isSignedIn) orderDetailReload(id, model)
    }

    fun cancelOrder() {
        scope.launch {
            try {
                model.cancel(id)
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                toast.show("Order cancelled", Toast.Style.Success)
                onOrderChanged?.invoke()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Your order")
        val order = model.order
        val error = model.error
        when {
            !isPreview && !session.isSignedIn -> {
                if (session.hasLoaded) {
                    EmptyState.SignedOut(message = "Sign in to see your orders.", modifier = Modifier.adaptiveContentWidth()) {
                        router.present(Route.SignIn)
                    }
                } else {
                    OrderDetailSkeleton()
                }
            }
            model.isLoading && order == null -> OrderDetailSkeleton()
            order != null -> OrderDetailLoaded(
                order = order,
                model = model,
                onRefresh = { orderDetailReload(id, model) },
                onCancel = { showsCancelConfirm = true },
                onRequestReturn = { showsReturnSheet = true },
            )
            error != null -> {
                if (error is APIError && error.isNotFound) {
                    EmptyState(
                        "Order unavailable",
                        modifier = Modifier.adaptiveContentWidth(),
                        message = "We couldn’t find this order.",
                        icon = Icons.Outlined.Inventory2,
                        actionTitle = "Back to orders",
                    ) { onClose?.invoke() ?: router.pop() }
                } else {
                    EmptyState.Error(error, Modifier.adaptiveContentWidth()) { orderDetailReload(id, model) }
                }
            }
            else -> OrderDetailSkeleton()
        }
    }

    val order = model.order
    if (showsReturnSheet && order != null) {
        // A tall, screen-like form: a centered dialog on wide windows.
        YardSheet(onDismissRequest = { showsReturnSheet = false }, skipPartiallyExpanded = true, presentAsDialogOnWide = true) {
            OrderReturnSheet(order, onClose = { showsReturnSheet = false }) { updated ->
                model.order = updated
                showsReturnSheet = false
                toast.show("Return requested. The brand will review it.", Toast.Style.Success)
                onOrderChanged?.invoke()
            }
        }
    }

    if (showsCancelConfirm) {
        // iOS confirmationDialog → a Yard action sheet.
        YardSheet(onDismissRequest = { showsCancelConfirm = false }, skipPartiallyExpanded = true) {
            Column(
                Modifier
                    .adaptiveContentWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Cancel this order?", style = YardFonts.title, color = Color.yard.ink, textAlign = TextAlign.Center)
                Text(
                    "This can’t be undone. A paid order is refunded in full.",
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(Spacing.s))
                YardButton("Cancel order", style = YardButtonStyle.Destructive) {
                    showsCancelConfirm = false
                    cancelOrder()
                }
                YardButton("Keep order", style = YardButtonStyle.Secondary) { showsCancelConfirm = false }
            }
        }
    }
}

@Composable
private fun OrderDetailLoaded(
    order: OrderDetail,
    model: OrderDetailModel,
    onRefresh: suspend () -> Unit,
    onCancel: () -> Unit,
    onRequestReturn: () -> Unit,
) {
    val context = LocalContext.current
    val dark = Color.yard.isDark
    var tabName by rememberSaveable { mutableStateOf(OrderDetailTab.Status.name) }
    val tab = OrderDetailTab.valueOf(tabName)
    val snapshot = OrderTrackingSnapshot.from(order, model.brandCity)
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    OrderRefreshBox(onRefresh = onRefresh) {
        // Reading screen: content capped at the window's contentMaxWidth (720 / 960dp), centred.
        OrderReadableList(
            horizontal = Spacing.gutter,
            top = Spacing.s,
            bottom = Spacing.xxxl + bottom,
            spacing = Spacing.xl,
        ) {
            item(key = "header") { OrderDetailHeader(order) }
            if (snapshot != null) {
                item(key = "tracking") {
                    TrackingCard(
                        snapshot,
                        onDetails = { tabName = OrderDetailTab.Details.name },
                        onTrack = { snapshot.trackingUrl?.let { WebPages.open(context, it, darkTheme = dark) } },
                    )
                }
                if (order.status == OrderStatus.Shipped) {
                    item(key = "live-tracking") {
                        space.yardstore.app.features.liveactivity.LiveTrackingButton(orderId = order.id)
                    }
                }
            }
            item(key = "card") {
                Column(
                    Modifier.fillMaxWidth().yardCard().padding(Spacing.l),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                ) {
                    SegmentedPill(
                        selection = tab,
                        options = OrderDetailTab.entries.toList(),
                        onSelect = { tabName = it.name },
                    ) { it.title }
                    when (tab) {
                        OrderDetailTab.Status -> OrderStatusTab(order)
                        OrderDetailTab.Details -> OrderDetailsTab(order, model.isCancelling, onCancel, onRequestReturn)
                    }
                }
            }
            item(key = "footnote") {
                Text(
                    "Each brand ships its own order, with its own tracking and returns.",
                    style = YardFonts.callout,
                    color = Color.yard.ink3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.l),
                )
            }
        }
    }
}

@Composable
private fun OrderDetailHeader(order: OrderDetail) {
    val router = LocalRouter.current
    val status = order.status
    Column(
        Modifier.fillMaxWidth().padding(top = Spacing.l),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Box(
            Modifier
                .padding(bottom = Spacing.s)
                .size(76.dp)
                .background(if (status == OrderStatus.Cancelled) Color.yard.danger else Color.yard.ink, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(status.icon, contentDescription = null, tint = Color.yard.bg, modifier = Modifier.size(32.dp))
        }
        YardDisplayText(status.label, size = 40.sp, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
        Text(
            OrderStatusText.note(status, order.summary.states.payment),
            style = YardFonts.callout,
            color = Color.yard.ink2,
            textAlign = TextAlign.Center,
        )
        Row(
            Modifier
                .padding(top = Spacing.xs)
                .clip(YardShapes.pill)
                .background(Color.yard.surface2, YardShapes.pill)
                .pressableClick {
                    if (order.summary.brand.handle.isNotEmpty()) router.push(Route.Brand(order.summary.brand.handle))
                }
                .padding(horizontal = Spacing.m, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(order.summary.brand.name, style = YardFonts.captionEmphasis, color = Color.yard.ink)
            Text("· Order ${order.summary.reference}", style = YardFonts.caption, color = Color.yard.ink3)
        }
    }
}

// region Status tab

@Composable
private fun OrderStatusTab(order: OrderDetail) {
    val steps = remember(order) { OrderTimelineBuilder.steps(order) }
    val events = (order.delivery?.events ?: emptyList()).asReversed()
    val history = order.timeline.filter { it.label != null }
    var historyOpen by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        OrderTimelineView(steps)

        val estimate = order.delivery?.estimate
        val range = OrderText.range(estimate?.arrivalFrom, estimate?.arrivalTo)
        if (estimate != null && order.status.isOpen && order.status != OrderStatus.PendingPayment && range != null &&
            order.summary.states.fulfilment != "delivered"
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color.yard.surface2, YardShapes.small)
                    .padding(Spacing.m),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(18.dp))
                Text(
                    if (estimate.late) "Running late, est. $range" else "Estimated arrival $range",
                    style = YardFonts.callout,
                    color = if (estimate.late) Color.yard.violet else Color.yard.ink,
                )
            }
        }

        if (events.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Text("Carrier updates", style = YardFonts.headline, color = Color.yard.ink)
                events.forEach { event ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        Box(
                            Modifier
                                .padding(top = 8.dp)
                                .size(6.dp)
                                .background(if (event.status == "exception") Color.yard.danger else Color.yard.ink3, CircleShape),
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(event.label, style = YardFonts.body, color = Color.yard.ink)
                            val meta = listOfNotNull(event.date?.let { OrderText.stamp(it) }, OrderText.nonEmpty(event.locationText))
                            if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = YardFonts.caption, color = Color.yard.ink3)
                            val note = OrderText.nonEmpty(event.note)
                            if (note != null && event.status == "exception") Text(note, style = YardFonts.caption, color = Color.yard.ink2)
                        }
                    }
                }
            }
        }

        if (history.isNotEmpty()) {
            // SwiftUI DisclosureGroup.
            Column {
                val rotation by animateFloatAsState(if (historyOpen) 180f else 0f, label = "history-chevron")
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { historyOpen = !historyOpen }
                        .padding(vertical = Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Order history", style = YardFonts.headline, color = Color.yard.ink, modifier = Modifier.weight(1f))
                    Icon(
                        Icons.Filled.KeyboardArrowDown,
                        contentDescription = if (historyOpen) "Collapse" else "Expand",
                        tint = Color.yard.ink2,
                        modifier = Modifier.rotate(rotation),
                    )
                }
                AnimatedVisibility(historyOpen, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Column(Modifier.padding(top = Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        history.forEach { event ->
                            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(event.label ?: "", style = YardFonts.callout, color = Color.yard.ink)
                                event.date?.let { Text(OrderText.stamp(it), style = YardFonts.caption, color = Color.yard.ink3) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// endregion

// region Details tab

@Composable
private fun OrderDetailSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Text(title, style = YardFonts.headline, color = Color.yard.ink)
        content()
    }
}

@Composable
private fun OrderSummaryLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.weight(1f))
        Text(value, style = YardFonts.callout.monospacedDigits(), color = Color.yard.ink)
    }
}

@Composable
private fun OrderDetailsTab(order: OrderDetail, isCancelling: Boolean, onCancel: () -> Unit, onRequestReturn: () -> Unit) {
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val copy = rememberOrderCopier()
    val currency = order.summary.currency
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        // Items
        OrderDetailSection("Items (${order.summary.itemCount})") {
            order.lines.forEach { line ->
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    RemoteImage(
                        line.imageUrl,
                        Modifier.size(width = 64.dp, height = 80.dp).clip(YardShapes.small),
                        maxPixelSize = 300,
                        contentDescription = line.image?.alt?.takeIf { it.isNotBlank() } ?: line.title,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(line.title, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (line.variantLabel.isNotEmpty()) Text(line.variantLabel, style = YardFonts.caption, color = Color.yard.ink2)
                        Text(
                            "Qty ${line.qty}${if (line.returnedQty > 0) ", ${line.returnedQty} returned" else ""}",
                            style = YardFonts.caption,
                            color = Color.yard.ink3,
                        )
                    }
                    PriceText(line.unitMinor * line.qty, currency, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold))
                }
            }
        }

        // Summary + payment
        OrderDetailSection("Summary") {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                OrderSummaryLine("Subtotal", Formatters.price(order.summary.subtotalMinor, currency))
                OrderSummaryLine(
                    "Shipping",
                    if (order.summary.shippingMinor > 0) Formatters.price(order.summary.shippingMinor, currency) else "Free",
                )
                if (order.summary.refundedMinor > 0) {
                    OrderSummaryLine("Refunded", "−" + Formatters.price(order.summary.refundedMinor, currency))
                }
                YardDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Total", style = YardFonts.bodyEmphasis, color = Color.yard.ink, modifier = Modifier.weight(1f))
                    PriceText(order.summary.totalMinor, currency)
                }
                Text(OrderStatusText.payment(order.summary.states.payment), style = YardFonts.caption, color = Color.yard.ink3)
            }
        }

        // Ship to
        OrderDetailSection("Ship to") {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                val formatted = order.shipTo?.formatted.orEmpty()
                SelectionContainer {
                    Text(formatted.ifEmpty { "Address unavailable" }, style = YardFonts.callout, color = Color.yard.ink2)
                }
                Text("Shipping service: ${OrderText.serviceLabel(order.summary.service)}", style = YardFonts.caption, color = Color.yard.ink3)
            }
        }

        // Tracking
        OrderDetailSection("Tracking") {
            val tracking = order.tracking
            if (tracking != null) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            tracking.carrier?.let { Text(it, style = YardFonts.caption, color = Color.yard.ink3) }
                            SelectionContainer {
                                Text(
                                    tracking.number,
                                    style = YardFonts.body.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold),
                                    color = Color.yard.ink,
                                )
                            }
                        }
                        Row(
                            Modifier
                                .height(34.dp)
                                .clip(YardShapes.pill)
                                .background(Color.yard.surface2, YardShapes.pill)
                                .semantics(mergeDescendants = true) { contentDescription = "Copy tracking number" }
                                .pressableClick {
                                    copy("Tracking number", tracking.number)
                                    toast.show("Tracking number copied", Toast.Style.Success, Icons.Outlined.ContentCopy)
                                }
                                .padding(horizontal = Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                        ) {
                            Icon(Icons.Outlined.ContentCopy, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
                            Text("Copy", style = YardFonts.captionEmphasis, color = Color.yard.ink)
                        }
                    }
                    val url = OrderText.trackingUrl(tracking.number, tracking.carrier)
                    Row(
                        Modifier.clickable { WebPages.open(context, url, darkTheme = dark) }.padding(vertical = Spacing.xs),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        Text("Track with ${tracking.carrier ?: "the carrier"}", style = YardFonts.captionEmphasis, color = Color.yard.violet)
                        Icon(Icons.AutoMirrored.Filled.CallMade, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(12.dp))
                    }
                }
            } else {
                Text(
                    if (order.status.isOpen) "Tracking appears when it ships." else "No tracking for this order.",
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                )
            }
        }

        // Returns
        OrderDetailSection("Returns") { OrderReturnsContent(order, onRequestReturn) }

        // Help
        OrderDetailSection("Help") {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(YardShapes.small)
                    .background(Color.yard.surface2.copy(alpha = 0.5f), YardShapes.small),
            ) {
                val brandId = order.summary.brand.id
                SettingsRow(
                    "Message ${order.summary.brand.name} about this order",
                    Icons.Outlined.Forum,
                    modifier = Modifier.clickable(enabled = brandId.isNotEmpty()) { router.push(Route.MessageBrand(brandId)) },
                )
                YardDivider()
                // Yard Support with this order attached to the first message (docs/APP.md › Order help).
                SettingsRow(
                    "Get help from Yard",
                    Icons.Outlined.SupportAgent,
                    modifier = Modifier.clickable {
                        router.push(Route.YardSupport(orderId = order.id, orderRef = order.summary.reference.ifEmpty { null }))
                    },
                )
                YardDivider()
                SettingsRow(
                    "Refunds and returns policy",
                    Icons.Outlined.Description,
                    modifier = Modifier.clickable { router.push(Route.Legal(LegalPage.Refunds)) },
                )
            }
        }

        if (order.actions.canCancel) {
            YardButton("Cancel order", style = YardButtonStyle.Destructive, size = YardButtonSize.Medium, isLoading = isCancelling, onClick = onCancel)
        }

        order.summary.placedDate?.let {
            Text("Placed ${OrderText.longDate(it)}", style = YardFonts.caption, color = Color.yard.ink3)
        }
    }
}

@Composable
private fun OrderReturnsContent(order: OrderDetail, onRequestReturn: () -> Unit) {
    val open = order.openReturn
    val last = order.returns.lastOrNull()
    when {
        open != null -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Tag(
                if (open.status == "approved") "Return approved" else "Return requested",
                style = TagStyle.Violet,
                icon = Icons.AutoMirrored.Outlined.Undo,
            )
            Text(
                "${open.reasonLabel}. ${open.itemCount} ${if (open.itemCount == 1) "item" else "items"} requested.",
                style = YardFonts.callout,
                color = Color.yard.ink2,
            )
        }
        order.actions.canRequestReturn -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Text(OrderReturnText.window(order), style = YardFonts.callout, color = Color.yard.ink2)
            YardButton(
                "Request a return",
                icon = Icons.AutoMirrored.Outlined.Undo,
                style = YardButtonStyle.Secondary,
                size = YardButtonSize.Medium,
                onClick = onRequestReturn,
            )
        }
        last != null -> Text(OrderReturnText.outcome(last), style = YardFonts.callout, color = Color.yard.ink2)
        else -> Text("Returns are available after delivery while the return window is open.", style = YardFonts.callout, color = Color.yard.ink2)
    }
}

/** Returns copy (OrderDetailView.swift returnWindowText / returnOutcome). */
object OrderReturnText {
    fun window(order: OrderDetail): String {
        val ends = YardDate.parse(order.actions.returnWindowEndsAt) ?: return "This order is within its return window."
        return "This order is within its return window, until ${OrderText.longDate(ends)}."
    }

    fun outcome(r: OrderReturn): String = when (r.status) {
        "rejected" -> r.decisionReason?.let { "Your return was declined: $it." } ?: "Your return was declined."
        "received" -> "The brand received your return."
        "cancelled" -> "You withdrew your return request."
        "expired" -> "Your return request expired."
        else -> "Return ${r.status}: ${r.reasonLabel}."
    }

    /** The request lines for the chosen quantities (zero quantities left out). */
    fun lines(order: OrderDetail, quantities: Map<String, Int>): List<OrderReturnLineBody> =
        order.lines.filter { it.returnableQty > 0 }.mapNotNull { line ->
            val qty = quantities[line.variantId] ?: 0
            if (qty > 0) OrderReturnLineBody(line.variantId, qty) else null
        }
}

// endregion

// region Return request sheet

/** Request a return: which pieces (up to what's not yet returned), a reason, an optional note. */
@Composable
fun OrderReturnSheet(order: OrderDetail, onClose: () -> Unit, onDone: (OrderDetail) -> Unit) {
    val scope = rememberCoroutineScope()
    val quantities = remember { mutableStateMapOf<String, Int>() }
    var reasonName by rememberSaveable { mutableStateOf(OrderReturnReason.Unwanted.name) }
    val reason = OrderReturnReason.valueOf(reasonName)
    var note by rememberSaveable { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val returnable = order.lines.filter { it.returnableQty > 0 }

    fun send() {
        val lines = OrderReturnText.lines(order, quantities)
        if (lines.isEmpty()) {
            errorMessage = "Choose at least one item to return."
            return
        }
        isSending = true
        errorMessage = null
        scope.launch {
            try {
                val updated = OrdersAPI.requestReturn(order.id, lines, reason, note.trim())
                isSending = false
                onDone(updated)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                isSending = false
                errorMessage = APIError.messageFor(e)
            }
        }
    }

    Column(Modifier.fillMaxWidth().imePadding()) {
        YardSheetHeader("Request a return", subtitle = "${order.summary.brand.name} · Order ${order.summary.reference}", onClose = onClose)
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(Spacing.gutter)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Text("Items to return", style = YardFonts.headline, color = Color.yard.ink)
                returnable.forEach { line ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        RemoteImage(
                            line.imageUrl,
                            Modifier.size(width = 44.dp, height = 56.dp).clip(RoundedCornerShape(10.dp)),
                            maxPixelSize = 200,
                        )
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                line.title,
                                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                                color = Color.yard.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                "${if (line.variantLabel.isEmpty()) "" else line.variantLabel + ", "}up to ${line.returnableQty}",
                                style = YardFonts.caption,
                                color = Color.yard.ink3,
                            )
                        }
                        QuantityStepper(quantities[line.variantId] ?: 0, range = 0..line.returnableQty) { quantities[line.variantId] = it }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Text("Reason", style = YardFonts.headline, color = Color.yard.ink)
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    OrderReturnReason.entries.forEach { option ->
                        val isSelected = reason == option
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .height(44.dp)
                                .clip(YardShapes.small)
                                .background(Color.yard.surface2, YardShapes.small)
                                .semantics { selected = isSelected }
                                .clickable { reasonName = option.name }
                                .padding(horizontal = Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(option.label, style = YardFonts.callout, color = Color.yard.ink, modifier = Modifier.weight(1f))
                            Icon(
                                if (isSelected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                                contentDescription = null,
                                tint = if (isSelected) Color.yard.ink else Color.yard.ink3,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Text("Note (optional)", style = YardFonts.headline, color = Color.yard.ink)
                BasicTextField(
                    value = note,
                    onValueChange = { note = it.take(1000) },
                    textStyle = YardFonts.body.copy(color = Color.yard.ink),
                    cursorBrush = SolidColor(Color.yard.ink),
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.yard.surface2, YardShapes.small)
                        .padding(Spacing.m),
                    decorationBox = { inner ->
                        Box {
                            if (note.isEmpty()) Text("Anything the brand should know", style = YardFonts.body, color = Color.yard.ink3)
                            inner()
                        }
                    },
                )
            }

            errorMessage?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }

            YardButton("Send request", isLoading = isSending) { send() }
            Text("Returns are handled by ${order.summary.brand.name}, within its own return window.", style = YardFonts.caption, color = Color.yard.ink3)
        }
    }
}

// endregion

@Composable
private fun OrderDetailSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState(), enabled = false)
            .adaptiveContentWidth()
            .padding(horizontal = Spacing.gutter),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Spacer(Modifier.height(Spacing.xl - Spacing.l))
        Skeleton(Modifier.size(76.dp), shape = SkeletonShape.Circle)
        Skeleton(Modifier.width(200.dp).height(34.dp), cornerRadius = 8.dp)
        Skeleton(Modifier.width(260.dp).height(14.dp), cornerRadius = 6.dp)
        Skeleton(Modifier.fillMaxWidth().padding(top = Spacing.m).height(230.dp), cornerRadius = Radius.card)
        Skeleton(Modifier.fillMaxWidth().heightIn(min = 320.dp), cornerRadius = Radius.card)
    }
}

@Preview(name = "OrderDetailView — dark")
@Composable
private fun OrderDetailDarkPreview() = YardPreview(darkTheme = true) {
    OrderDetailScreen("or_1", OrderDetailModel(OrderPreviewData.detail, brandCity = "Lagos"), isPreview = true)
}

@Preview(name = "OrderDetailView — light")
@Composable
private fun OrderDetailLightPreview() = YardPreview(darkTheme = false) {
    OrderDetailScreen("or_1", OrderDetailModel(OrderPreviewData.detail, brandCity = "Lagos"), isPreview = true)
}

@YardTabletPreviews
@Composable
private fun OrderDetailTabletPreview() = YardPreview(darkTheme = true) {
    OrderDetailScreen("or_1", OrderDetailModel(OrderPreviewData.detail, brandCity = "Lagos"), isPreview = true)
}
