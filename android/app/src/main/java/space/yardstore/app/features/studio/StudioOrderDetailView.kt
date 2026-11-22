package space.yardstore.app.features.studio

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.YardSwitch
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.BackAction
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.auth.AuthAppHandoff
import space.yardstore.app.features.auth.AuthSocialButton
import java.math.BigDecimal
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

/**
 * Money actions need a recent re-confirmation (docs/APP.md › Re-confirm): a 403 with
 * `fields.reauth = "required"` and `fields.reauthWith` ("password", or providers such as "google",
 * "apple,google", "auth0:google-oauth2"). Pure; unit-tested.
 */
object StudioReauth {
    /** The ways this account can re-confirm, or null when [error] isn't a re-confirm request. */
    fun methods(error: Throwable): List<String>? {
        val e = error as? APIError ?: return null
        if (e.status != 403 || e.fields["reauth"] != "required") return null
        return e.fields["reauthWith"].orEmpty().split(",").map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { listOf("password") }
    }

    /** A provider method ("google", "apple", "auth0:google-oauth2") as a social sign-in button. */
    fun button(method: String): AuthSocialButton? = when {
        method == "google" -> AuthSocialButton("google", "google", null, "Google", AuthSocialButton.Mark.Google)
        method == "apple" -> AuthSocialButton("apple", "apple", null, "Apple", AuthSocialButton.Mark.Apple)
        method.startsWith("auth0:") -> {
            val connection = method.removePrefix("auth0:")
            val label = when {
                connection.contains("google") -> "Google"
                connection.contains("apple") -> "Apple"
                connection.contains("facebook") -> "Facebook"
                else -> "your sign-in"
            }
            AuthSocialButton(method, "auth0", connection, label, if (label == "Google") AuthSocialButton.Mark.Google else AuthSocialButton.Mark.Generic)
        }
        else -> null
    }

    /** Typed amount ("45", "45.50") → minor units in [currency]; null when it isn't a positive amount. */
    fun minor(text: String, currency: String): Long? {
        val cleaned = text.trim().replace(",", "")
        val value = cleaned.toBigDecimalOrNull() ?: return null
        if (value <= BigDecimal.ZERO) return null
        val digits = MoneyFormatter.info(currency).minor
        return runCatching { value.movePointRight(digits).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact() }.getOrNull()
    }
}

/** A money action waiting for a re-confirmation, then retried. */
class StudioReauthRequest(val methods: List<String>, val reason: String, val retry: suspend () -> Unit)

class StudioOrderDetailModel(private val store: StudioStore?, val id: String, preview: StudioOrderDetail? = null) : ViewModel() {
    var order by mutableStateOf(preview)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf<String?>(null)
        private set
    var reauth by mutableStateOf<StudioReauthRequest?>(null)

    suspend fun load() {
        val store = store ?: return
        try {
            order = store.order(id)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    /** Runs [work] with [label] busy; a re-confirm request opens the sheet; returns an error message or null. */
    suspend fun run(label: String, reason: String, work: suspend () -> Unit): String? {
        busy = label
        try {
            work()
            load()
            return null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val methods = StudioReauth.methods(e)
            if (methods != null) {
                reauth = StudioReauthRequest(methods, reason) {
                    work()
                    load()
                }
                return ""
            }
            return APIError.messageFor(if (e is APIError) e else APIError.network(e))
        } finally {
            busy = null
        }
    }

    suspend fun startPreparing(): String? = run("prepare", "") { store?.startProcessing(id) }

    suspend fun ship(carrier: String, tracking: String): String? {
        if (tracking.isNotBlank() && carrier.isBlank()) return "Add the carrier for this tracking number."
        return run("ship", "") { store?.markShipped(id, carrier.trim().ifEmpty { null }, tracking.trim().ifEmpty { null }) }
    }

    suspend fun cancel(reason: String, restock: Boolean): String? {
        val r = reason.trim()
        if (r.length < 3) return "Tell the customer why, in a few words."
        val key = UUID.randomUUID().toString()
        return run("cancel", "Cancelling a paid order refunds the customer in full.") { store?.cancelOrder(id, r.take(200), restock, key) }
    }

    suspend fun refund(amount: String, reason: String): String? {
        val o = order ?: return null
        val minor = StudioReauth.minor(amount, o.currency) ?: return "Enter an amount, like 20."
        if (minor > o.refundableMinor) return "You can refund up to ${studioMoney(o.refundableMinor, o.currency)}."
        val r = reason.trim()
        if (r.length < 3) return "Add a short reason."
        val key = UUID.randomUUID().toString()
        return run("refund", "Refunds send money back to the customer.") { store?.refundOrder(id, minor, r.take(200), key) }
    }
}

@Composable
fun StudioOrderDetailView(id: String) {
    val studio = LocalStudioStore.current
    val model: StudioOrderDetailModel = viewModel(key = "studio-order-$id-${studio.generation}") { StudioOrderDetailModel(studio, id) }
    LaunchedEffect(model) { model.load() }
    StudioOrderDetailScreen(model)
}

@Composable
internal fun StudioOrderDetailScreen(model: StudioOrderDetailModel) {
    val nav = LocalStudioNav.current
    val studio = LocalStudioStore.current
    val toast = LocalToastCenter.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    val order = model.order
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }

    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar(order?.reference?.ifBlank { null } ?: "Order", back = back)
        when {
            order == null && model.error != null -> EmptyState.Error(model.error.orEmpty(), Modifier.weight(1f)) { model.load() }
            order == null -> Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.fillMaxWidth().height(190.dp))
                Skeleton(Modifier.fillMaxWidth().height(140.dp))
            }
            else -> Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .navigationBarsPadding()
                    .padding(horizontal = Spacing.gutter)
                    .padding(top = Spacing.s, bottom = Spacing.xxxl),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                TrackingCard(order)
                ItemsCard(order)
                CustomerCard(order)
                val canFulfil = studio.can("orders.fulfil")
                val m = order.merchant
                if (canFulfil && m == "paid") {
                    YardButton("Start preparing", style = YardButtonStyle.Secondary, isLoading = model.busy == "prepare") {
                        haptics.click()
                        scope.launch {
                            val problem = model.startPreparing()
                            if (problem == null) { haptics.confirm(); toast.show("Marked as preparing", Toast.Style.Success) } else if (problem.isNotEmpty()) { haptics.reject(); toast.show(problem, Toast.Style.Error) }
                        }
                    }
                }
                if (canFulfil && (m == "paid" || m == "processing")) {
                    ShipComposer(model)
                }
                if (canFulfil && order.actions.canCancel) CancelComposer(model)
                val profile = studio.profile
                if ((profile?.canRefund ?: false) && order.refundableMinor > 0 && m != "cancelled" && m != "pending_payment") RefundComposer(model)
            }
        }
    }
    model.reauth?.let { request ->
        StudioReauthSheet(request, onDone = { ok ->
            model.reauth = null
            if (ok) toast.show("Done", Toast.Style.Success)
        })
    }
}

/** The tracking-style card: reference, status, total and the received → delivered line. */
@Composable
private fun TrackingCard(order: StudioOrderDetail) {
    val (status, style) = studioOrderStatus(order.merchant)
    val white = Color.yard.onPhoto
    Column(
        Modifier.fillMaxWidth().background(Color.yard.onAcid, YardShapes.card).border(1.dp, Color.yard.line, YardShapes.card).padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Order", style = YardFonts.caption, color = white.copy(alpha = 0.6f))
                Text(order.reference.ifBlank { order.id }, style = YardFonts.title.monospacedDigits(), color = white)
            }
            StudioPill(status, style)
        }
        Text(studioMoney(order.totalMinor, order.currency), style = YardFonts.number(30.sp), color = white)
        if (order.merchant == "cancelled") {
            Text("Cancelled${order.cancelReason?.let { ": $it" } ?: ""}", style = YardFonts.callout, color = white.copy(alpha = 0.75f))
        } else {
            StudioProgressLine(order)
        }
    }
}

private val timeFormat = DateTimeFormatter.ofPattern("d MMM, HH:mm")

@Composable
private fun StudioProgressLine(order: StudioOrderDetail) {
    val reached = StudioOrderStage.reached(order.merchant)
    val reduce = rememberReducedMotion()
    val fill by animateFloatAsState(
        if (reached <= 0) 0f else reached / 3f,
        Motion.or(reduce) { Motion.spring() },
        label = "order-progress",
    )
    val white = Color.yard.onPhoto
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Box(Modifier.fillMaxWidth().height(26.dp), contentAlignment = Alignment.CenterStart) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(4.dp).background(white.copy(alpha = 0.2f), YardShapes.pill))
            Box(Modifier.fillMaxWidth(fill).padding(horizontal = 12.dp).height(4.dp).background(Color.yard.acid, YardShapes.pill))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                StudioOrderStage.entries.forEachIndexed { i, _ ->
                    val done = i <= reached
                    Box(
                        Modifier
                            .size(24.dp)
                            .background(if (done) Color.yard.acid else Color.yard.onAcid, CircleShape)
                            .border(2.dp, if (done) Color.yard.acid else white.copy(alpha = 0.3f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (done) androidx.compose.material3.Icon(Icons.Filled.Check, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            StudioOrderStage.entries.forEachIndexed { i, stage ->
                val at = YardDate.parse(order.timeOf(stage))?.atZone(ZoneId.systemDefault())?.format(timeFormat)
                Column(
                    Modifier.semantics(mergeDescendants = true) {
                        contentDescription = "${stage.title}${if (i <= reached) ", done" else ""}${at?.let { ", $it" } ?: ""}"
                    },
                    horizontalAlignment = when (i) {
                        0 -> Alignment.Start
                        StudioOrderStage.entries.lastIndex -> Alignment.End
                        else -> Alignment.CenterHorizontally
                    },
                ) {
                    Text(stage.title, style = YardFonts.captionEmphasis, color = if (i <= reached) white else white.copy(alpha = 0.5f))
                    Text(if (at != null && i <= reached) at else " ", style = YardFonts.micro, color = white.copy(alpha = 0.55f))
                }
            }
        }
    }
}

@Composable
private fun ItemsCard(order: StudioOrderDetail) {
    Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Text("Items", style = YardFonts.headline, color = Color.yard.ink)
        order.lines.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                RemoteImage(Config.url(line.image?.src), Modifier.size(56.dp).clip(YardShapes.small), maxPixelSize = 240, contentDescription = line.image?.alt)
                Column(Modifier.weight(1f)) {
                    Text(line.title, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val detail = listOfNotNull(line.variantLabel.ifBlank { null }, "×${line.qty}").joinToString(" · ")
                    Text(detail, style = YardFonts.caption, color = Color.yard.ink3)
                    if (line.returnedQty > 0) Text("${line.returnedQty} returned", style = YardFonts.caption, color = Color.yard.danger)
                }
                Text(studioMoney(line.unitMinor * line.qty, order.currency), style = YardFonts.bodyEmphasis.monospacedDigits(), color = Color.yard.ink)
            }
        }
        Row {
            Text("Shipping", style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.weight(1f))
            Text(studioMoney(order.shippingMinor, order.currency), style = YardFonts.callout.monospacedDigits(), color = Color.yard.ink2)
        }
        if (order.refundedMinor > 0) {
            Row {
                Text("Refunded", style = YardFonts.callout, color = Color.yard.danger, modifier = Modifier.weight(1f))
                Text("−" + studioMoney(order.refundedMinor, order.currency), style = YardFonts.callout.monospacedDigits(), color = Color.yard.danger)
            }
        }
    }
}

@Composable
private fun CustomerCard(order: StudioOrderDetail) {
    val address = order.shipToAddress
    Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text("Customer", style = YardFonts.headline, color = Color.yard.ink)
        Text(order.customerName.ifBlank { "Customer" }, style = YardFonts.body, color = Color.yard.ink)
        // The address without the name line (the customer's name is right above).
        val text = address?.copy(name = null)?.formatted?.ifBlank { null }
            ?: listOfNotNull(order.shipToPreview.city?.ifBlank { null }, order.shipToPreview.country.ifBlank { null }).joinToString(", ")
        if (text.isNotBlank()) Text(text, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

@Composable
private fun ComposerCard(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l).animateContentSize(Motion.spring()),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Text(title, style = YardFonts.headline, color = Color.yard.ink)
        content()
    }
}

/** Carrier + tracking, then "Slide to mark shipped" (the customer is notified). */
@Composable
private fun ShipComposer(model: StudioOrderDetailModel) {
    val haptics = rememberYardHaptics()
    val toast = LocalToastCenter.current
    val scope = rememberCoroutineScope()
    var carrier by rememberSaveable { mutableStateOf("") }
    var tracking by rememberSaveable { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    ComposerCard("Ship it") {
        StudioTextField(carrier, { carrier = it.take(80); problem = null }, "Carrier (e.g. your courier)", label = "Carrier", capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next)
        StudioTextField(tracking, { tracking = it.take(80); problem = null }, "Tracking number (optional)", label = "Tracking number", capitalization = KeyboardCapitalization.Characters, error = problem)
        YardButton("Mark shipped", icon = Icons.Outlined.LocalShipping, isLoading = model.busy == "ship") {
            scope.launch {
                val p = model.ship(carrier, tracking)
                when {
                    p == null -> { haptics.success(); toast.show("Marked as shipped. The customer has been told.", Toast.Style.Success) }
                    p.isEmpty() -> Unit
                    else -> { haptics.reject(); problem = p }
                }
            }
        }
    }
}

@Composable
private fun CancelComposer(model: StudioOrderDetailModel) {
    val haptics = rememberYardHaptics()
    val toast = LocalToastCenter.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }
    var restock by rememberSaveable { mutableStateOf(true) }
    var problem by remember { mutableStateOf<String?>(null) }
    if (!open) {
        YardButton("Cancel order", style = YardButtonStyle.Destructive) { haptics.click(); open = true }
        return
    }
    ComposerCard("Cancel this order") {
        Text("Only before it ships. A paid order is refunded in full.", style = YardFonts.callout, color = Color.yard.ink2)
        StudioTextField(reason, { reason = it.take(200); problem = null }, "Reason (the customer sees it)", label = "Reason", error = problem, singleLine = false)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Put the stock back", style = YardFonts.body, color = Color.yard.ink, modifier = Modifier.weight(1f))
            YardSwitch(restock, { haptics.tick(); restock = it })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            YardButton("Keep it", style = YardButtonStyle.Secondary, modifier = Modifier.weight(1f)) { haptics.click(); open = false }
            YardButton("Cancel order", style = YardButtonStyle.Destructive, isLoading = model.busy == "cancel", modifier = Modifier.weight(1f)) {
                haptics.click()
                scope.launch {
                    val p = model.cancel(reason, restock)
                    when {
                        p == null -> { haptics.success(); open = false; toast.show("Order cancelled", Toast.Style.Success) }
                        p.isEmpty() -> Unit
                        else -> { haptics.reject(); problem = p }
                    }
                }
            }
        }
    }
}

@Composable
private fun RefundComposer(model: StudioOrderDetailModel) {
    val haptics = rememberYardHaptics()
    val toast = LocalToastCenter.current
    val scope = rememberCoroutineScope()
    val order = model.order ?: return
    var open by rememberSaveable { mutableStateOf(false) }
    var amount by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    if (!open) {
        YardButton("Refund", style = YardButtonStyle.Secondary) { haptics.click(); open = true }
        return
    }
    ComposerCard("Refund") {
        Text("Up to ${studioMoney(order.refundableMinor, order.currency)}.", style = YardFonts.callout, color = Color.yard.ink2)
        StudioTextField(amount, { amount = it.take(12); problem = null }, "Amount", label = "Refund amount", prefix = MoneyFormatter.info(order.currency).symbol, keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next)
        StudioTextField(reason, { reason = it.take(200); problem = null }, "Reason", label = "Refund reason", error = problem)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            YardButton("Not now", style = YardButtonStyle.Secondary, modifier = Modifier.weight(1f)) { haptics.click(); open = false }
            YardButton("Refund", isLoading = model.busy == "refund", modifier = Modifier.weight(1f)) {
                haptics.click()
                scope.launch {
                    val p = model.refund(amount, reason)
                    when {
                        p == null -> { haptics.success(); open = false; toast.show("Refund sent", Toast.Style.Success) }
                        p.isEmpty() -> Unit
                        else -> { haptics.reject(); problem = p }
                    }
                }
            }
        }
    }
}

/**
 * "Confirm it's you" before a money action: the password (POST /api/auth/reauth?as=brand), or the
 * account's sign-in provider in a Custom Tab with `actor=brand`. Then the action runs again.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
internal fun StudioReauthSheet(request: StudioReauthRequest, onDone: (Boolean) -> Unit) {
    val studio = LocalStudioStore.current
    val context = LocalContext.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val dark = Color.yard.isDark

    suspend fun retry() {
        try {
            request.retry()
            haptics.success()
            onDone(true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            haptics.reject()
            problem = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    // A provider re-confirmation comes back through yard://auth/complete like a sign-in.
    DisposableEffect(Unit) {
        AuthAppHandoff.screenAppeared()
        onDispose { AuthAppHandoff.screenDisappeared() }
    }
    val outcome = AuthAppHandoff.outcome
    LaunchedEffect(outcome) {
        when (val o = AuthAppHandoff.consumeOutcome() ?: return@LaunchedEffect) {
            is AuthAppHandoff.Outcome.SignedIn -> {
                busy = true
                // Keep the fresh re-confirmation on this brand (POST /api/auth/brand/switch keeps it).
                studio.activeBrandId?.let { id ->
                    runCatching { studio.api.send(HTTPMethod.POST, studio.p("/api/auth/brand/switch"), StudioSwitchBody(id)) }
                }
                retry()
                busy = false
            }
            is AuthAppHandoff.Outcome.Failed -> problem = o.message
        }
    }

    YardSheet(onDismissRequest = { onDone(false) }, skipPartiallyExpanded = true, dismissOnScrimTap = false) {
        YardSheetHeader("Confirm it's you", subtitle = request.reason.ifBlank { null }, onClose = { onDone(false) })
        Column(Modifier.fillMaxWidth().padding(Spacing.gutter).imePadding(), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            if ("password" in request.methods) {
                androidx.compose.foundation.text.BasicTextField(
                    value = password,
                    onValueChange = { password = it; problem = null },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    textStyle = YardFonts.body.copy(color = Color.yard.ink),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Password" },
                    decorationBox = { inner ->
                        Box(
                            Modifier.fillMaxWidth().height(52.dp).background(Color.yard.surface2, YardShapes.small).padding(horizontal = 16.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (password.isEmpty()) Text("Your password", style = YardFonts.body, color = Color.yard.ink3)
                            inner()
                        }
                    },
                )
                YardButton("Confirm", isLoading = busy, enabled = password.isNotEmpty()) {
                    haptics.click()
                    scope.launch {
                        busy = true
                        try {
                            studio.reauthWithPassword(password)
                            retry()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            haptics.reject()
                            problem = APIError.messageFor(if (e is APIError) e else APIError.network(e))
                        } finally {
                            busy = false
                        }
                    }
                }
            }
            request.methods.mapNotNull { StudioReauth.button(it) }.forEach { button ->
                YardButton("Continue with ${button.label}", style = YardButtonStyle.Secondary, isLoading = busy) {
                    haptics.click()
                    WebPages.open(context, AuthAppHandoff.begin(button, actor = "brand"), darkTheme = dark)
                }
            }
            AnimatedVisibility(problem != null) {
                Text(problem.orEmpty(), style = YardFonts.callout, color = Color.yard.danger)
            }
            Box(Modifier.width(1.dp).height(Spacing.s))
        }
    }
}
