package space.yardstore.app.features.bag

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartGroup
import space.yardstore.app.core.models.CartLine
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/** Work that must outlive the checkout screen (reloading the cart after it pops). */
private val bagAppScope = MainScope()

/**
 * Checkout (website: /checkout, src/components/market/checkout/checkout-flow.tsx + steps.tsx +
 * order-summary.tsx). Mirrors `CheckoutView.swift`. One scrolling page: contact, delivery address,
 * shipping per brand (from the server's quote), payment method, order summary, and a bottom "Pay"
 * pill. Payment happens on the provider's hosted page (Paystack / Bachs) opened in a Custom Tab;
 * see [CheckoutModel].
 */
@Composable
fun CheckoutView() {
    val model: CheckoutModel = viewModel { CheckoutModel() }
    CheckoutView(model)
}

/** The checkout for a given model (previews inject one, iOS `init(previewModel:)`). */
@Composable
fun CheckoutView(model: CheckoutModel) {
    val cartStore = LocalCartStore.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        model.displayCurrency = cartStore.currency
        if (model.name.isEmpty()) session.shopper?.let { model.name = it.name }
        if (session.hasLoaded && !session.isSignedIn) router.present(Route.SignIn)
        model.loadOptions()
    }

    // Re-quotes when the destination, charge currency or the bag's lines change. The delay debounces
    // typing in the city field; a new key cancels the previous run (iOS `.task(id:)`).
    val quoteKey = run {
        val lines = (cartStore.cart?.lines ?: emptyList()).joinToString(",") { "${it.variantId}:${it.qty}" }
        "${model.chargeCurrency}|${model.country}|${model.quoteCity.orEmpty()}|$lines"
    }
    LaunchedEffect(quoteKey) {
        delay(400)
        model.loadQuotes()
    }

    DisposableEffect(Unit) { onDispose { model.cancelPolling() } }

    LaunchedEffect(model.completedCheckoutId) {
        val id = model.completedCheckoutId ?: return@LaunchedEffect
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        model.notice?.let { toast.show(it, Toast.Style.Info) }
        CheckoutDraft(model.name, model.phone, model.line1, model.line2, model.city, model.region, model.postcode, model.country).save()
        cartStore.reset()
        bagAppScope.launch { cartStore.load() }
        if (model.launchedPageId != null) BagPaymentTab.closeIfCovered(context)
        router.pop()
        router.push(Route.OrderConfirmation(checkoutId = id))
    }

    LaunchedEffect(model.needsSignIn) {
        if (model.needsSignIn) {
            model.needsSignIn = false
            router.present(Route.SignIn)
        }
    }

    LaunchedEffect(cartStore.currency) { model.displayCurrency = cartStore.currency }

    BagPaymentTabEffect(
        page = model.paymentPage,
        launchedPageId = model.launchedPageId,
        onLaunched = model::paymentPageLaunched,
        onFinish = model::paymentPageClosed,
    )

    Column(Modifier.fillMaxSize().yardScreenBackground().imePadding()) {
        YardTopBar(title = null)
        val cart = model.cart
        val quoteError = model.quotes.error
        when {
            !session.isSignedIn -> if (!session.hasLoaded) {
                CheckoutSkeleton()
            } else {
                EmptyState.SignedOut(
                    title = "Sign in to check out",
                    message = "One account keeps the orders from every brand in this bag, and their tracking, in one place. Your bag stays as it is.",
                    modifier = Modifier.fillMaxSize(),
                ) { router.present(Route.SignIn) }
            }
            cart != null -> if (cart.lines.isEmpty() && model.phase != CheckoutModel.Phase.Done) {
                EmptyState(
                    title = "Your bag is empty",
                    message = "Add pieces from any brand and they check out together, one order per brand.",
                    icon = Icons.Outlined.ShoppingBag,
                    actionTitle = "Back to bag",
                    modifier = Modifier.fillMaxSize(),
                ) { router.pop() }
            } else {
                CheckoutForm(model, cart, onPay = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    model.pay()
                }, onViewStatus = { pending ->
                    cartStore.reset()
                    bagAppScope.launch { cartStore.load() }
                    router.pop()
                    router.push(Route.OrderConfirmation(checkoutId = pending))
                }, onRemoveBrand = { group ->
                    val ids = cart.lines(group).map { it.variantId }
                    val brand = model.brandName(group)
                    bagAppScope.launch {
                        try {
                            for (id in ids) cartStore.remove(id)
                            toast.show("Removed $brand's pieces", Toast.Style.Info, Icons.Outlined.Delete)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            toast.show(e)
                        }
                    }
                })
            }
            quoteError != null -> EmptyState.Error(quoteError, Modifier.fillMaxSize()) { model.loadQuotes() }
            else -> CheckoutSkeleton()
        }
    }
    // A poll that settles (or fails) while the Custom Tab is still in front closes it, like iOS
    // dismissing the Safari sheet.
    LaunchedEffect(model.paymentPage == null, model.phase) {
        if (model.paymentPage == null && model.launchedPageId != null && model.phase != CheckoutModel.Phase.Paying) {
            BagPaymentTab.closeIfCovered(context)
        }
    }
}

@Composable
private fun CheckoutForm(
    model: CheckoutModel,
    cart: Cart,
    onPay: () -> Unit,
    onViewStatus: (String) -> Unit,
    onRemoveBrand: (CartGroup) -> Unit,
) {
    val focus = LocalFocusManager.current
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.gutter)
                .padding(bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            YardDisplayText("Checkout", size = 44.sp, color = Color.yard.ink, modifier = Modifier.padding(top = Spacing.s))

            if (model.paymentsClosed) {
                BagNotice(icon = Icons.Outlined.Schedule, text = BagCheckoutOptions.OFF_MESSAGE, tint = Color.yard.violet)
            } else if (model.isStub) {
                BagNotice(icon = Icons.Outlined.Info, text = "Payments aren't connected in this environment. Nothing will be charged.", tint = Color.yard.violet)
            }
            model.currencyNotice?.let { BagNotice(icon = Icons.Outlined.AttachMoney, text = it) }

            CheckoutContactSection(model)
            CheckoutAddressSection(model)
            CheckoutShippingSection(model, cart, onRemoveBrand)
            CheckoutPaymentSection(model)
            CheckoutSummarySection(model, cart)

            Text(
                "Delivery dates are estimates, not guarantees. They skip weekends and public holidays. Taxes aren't calculated in this build; import duties, if any, are collected by the courier on delivery.",
                style = YardFonts.caption,
                color = Color.yard.ink3,
            )
        }
        CheckoutPayBar(model, cart, onPay = {
            focus.clearFocus()
            onPay()
        }, onViewStatus = onViewStatus)
    }
}

@Composable
private fun CheckoutContactSection(model: CheckoutModel) {
    val session = LocalSessionStore.current
    val focus = LocalFocusManager.current
    val info = model.countryInfo
    CheckoutSection(title = "Contact", subtitle = session.shopper?.let { "Order updates go to ${it.email}." }) {
        CheckoutTextField(
            label = "Full name",
            value = model.name,
            onValueChange = { model.name = it },
            error = model.error("name"),
            capitalization = KeyboardCapitalization.Words,
            onNext = { focus.moveFocus(FocusDirection.Down) },
        )
        CheckoutTextField(
            label = "Phone",
            value = model.phone,
            onValueChange = { model.phone = it },
            error = model.error("phone"),
            hint = "${info.dial} · for example ${info.phoneExample}",
            placeholder = info.phoneExample,
            keyboardType = KeyboardType.Phone,
            onNext = { focus.moveFocus(FocusDirection.Down) },
        )
    }
}

@Composable
private fun CheckoutAddressSection(model: CheckoutModel) {
    val rules = model.countryInfo
    val focus = LocalFocusManager.current
    val next = { focus.moveFocus(FocusDirection.Down); Unit }
    CheckoutSection(title = "Delivery address", subtitle = "Changing the country updates shipping prices and payment options.") {
        CheckoutMenuField(
            label = "Country",
            value = rules.name,
            error = null,
            options = BagMarkets.countries.map { it.code to it.name },
            selected = model.country,
            onSelect = model::changeCountry,
        )
        CheckoutTextField("Street address", model.line1, { model.line1 = it }, model.error("line1"), capitalization = KeyboardCapitalization.Words, onNext = next)
        CheckoutTextField("Apartment, suite or floor", model.line2, { model.line2 = it }, null, optional = true, capitalization = KeyboardCapitalization.Words, onNext = next)
        CheckoutTextField("City or town", model.city, { model.city = it }, model.error("city"), capitalization = KeyboardCapitalization.Words, onNext = next)
        val regionOptions = rules.regionOptions
        if (regionOptions != null) {
            val placeholder = "Choose a ${rules.regionLabel.lowercase()}"
            CheckoutMenuField(
                label = rules.regionLabel,
                value = model.region.ifEmpty { placeholder },
                isPlaceholder = model.region.isEmpty(),
                optional = !rules.regionRequired,
                error = model.error("region"),
                options = listOf("" to placeholder) + regionOptions.map { it to it },
                selected = model.region,
                onSelect = { model.region = it },
            )
        } else {
            CheckoutTextField(rules.regionLabel, model.region, { model.region = it }, model.error("region"), optional = !rules.regionRequired, capitalization = KeyboardCapitalization.Words, onNext = next)
        }
        CheckoutTextField(
            label = rules.postcodeLabel,
            value = model.postcode,
            onValueChange = { model.postcode = it },
            error = model.error("postcode"),
            hint = "For example ${rules.postcodeExample}",
            optional = !rules.postcodeRequired,
            capitalization = KeyboardCapitalization.Characters,
            imeAction = ImeAction.Done,
            onNext = { focus.clearFocus() },
        )
    }
}

@Composable
private fun CheckoutShippingSection(model: CheckoutModel, cart: Cart, onRemoveBrand: (CartGroup) -> Unit) {
    val scope = rememberCoroutineScope()
    CheckoutSection(
        title = "Shipping",
        subtitle = if (cart.groups.size > 1) "Your order comes from ${cart.groups.size} brands. Each ships separately from its own studio, so parcels can arrive on different days." else null,
    ) {
        if (model.quotes.cart == null && model.quotes.error != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Couldn't calculate shipping.", style = YardFonts.callout, color = Color.yard.ink, modifier = Modifier.weight(1f))
                YardButton("Retry", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false) {
                    scope.launch { model.loadQuotes() }
                }
            }
        }
        cart.groups.forEach { group ->
            androidx.compose.runtime.key(group.brandId) {
                CheckoutBrandShipping(
                    brandName = model.brandName(group),
                    lines = cart.lines(group),
                    quote = model.quotes.quote(group.brandId),
                    selected = model.option(group.brandId)?.service,
                    isLoading = model.quotes.isLoading,
                    countryName = model.countryInfo.name,
                    onSelect = { model.choose(group.brandId, it) },
                    onRemove = { onRemoveBrand(group) },
                )
            }
        }
    }
}

@Composable
private fun CheckoutPaymentSection(model: CheckoutModel) {
    val selected = model.effectiveMethod
    CheckoutSection(title = "Payment", subtitle = "You pay on ${model.providerName}'s secure page. Card details are typed there, never in Yard.") {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            model.methods.forEach { m ->
                CheckoutOptionRow(
                    title = m.title(model.country),
                    detail = m.detail(model.country),
                    icon = m.icon,
                    isSelected = m == selected,
                ) { model.method = m }
            }
        }
        Text(selected.next(model.country, model.providerName), style = YardFonts.caption, color = Color.yard.ink2)
    }
}

@Composable
private fun CheckoutSummarySection(model: CheckoutModel, cart: Cart) {
    CheckoutSection(title = "Order summary", subtitle = null) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            cart.lines.forEach { line ->
                androidx.compose.runtime.key(line.variantId) { CheckoutSummaryLine(line, cart.currency) }
            }
        }
        YardDivider()
        CheckoutSummaryRow("Subtotal") { PriceText(minor = cart.subtotalMinor, currency = cart.currency, style = YardFonts.bodyEmphasis) }
        CheckoutSummaryRow(if (cart.groups.size == 1) "Shipping" else "Shipping, ${cart.groups.size} brands") {
            val s = model.shippingMinor
            when {
                s == 0 -> Text("Free", style = YardFonts.bodyEmphasis, color = Color.yard.success)
                s != null -> PriceText(minor = s, currency = cart.currency, style = YardFonts.bodyEmphasis)
                model.quotes.isLoading -> Skeleton(Modifier.size(width = 56.dp, height = 14.dp), shape = SkeletonShape.Capsule)
                else -> Text("—", style = YardFonts.bodyEmphasis, color = Color.yard.ink3)
            }
        }
        YardDivider()
        CheckoutSummaryRow("Total", emphasized = true) {
            PriceText(minor = model.totalMinor ?: cart.subtotalMinor, currency = cart.currency, style = YardFonts.number(22.sp))
        }
    }
}

@Composable
private fun CheckoutSummaryLine(line: CartLine, currency: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        RemoteImage(
            url = line.imageUrl,
            maxPixelSize = 200,
            modifier = Modifier.size(width = 48.dp, height = 60.dp).clip(RoundedCornerShape(10.dp)),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                line.title ?: "A piece from your bag",
                style = YardFonts.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(line.brandName, line.variantLabel).filter { it.isNotEmpty() }.joinToString(" · "),
                style = YardFonts.caption,
                color = Color.yard.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            PriceText(minor = line.lineMinor, currency = currency, style = YardFonts.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold))
            Text("× ${line.qty}", style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink3)
        }
    }
}

@Composable
private fun CheckoutPayBar(model: CheckoutModel, cart: Cart, onPay: () -> Unit, onViewStatus: (String) -> Unit) {
    val line = Color.yard.line
    val phase = model.phase
    val working = phase == CheckoutModel.Phase.Starting || phase == CheckoutModel.Phase.Confirming || phase == CheckoutModel.Phase.Paying
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface.copy(alpha = 0.96f))
            .drawBehind { drawLine(line, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }
            .navigationBarsPadding()
            .padding(horizontal = Spacing.gutter, vertical = Spacing.m)
            .animateContentSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        AnimatedVisibility(phase == CheckoutModel.Phase.Confirming || phase == CheckoutModel.Phase.Paying) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                CircularProgressIndicator(color = Color.yard.violet, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                Text(
                    if (phase == CheckoutModel.Phase.Paying) "Taking you to secure payment…" else "Confirming your payment…",
                    style = YardFonts.caption,
                    color = Color.yard.ink2,
                )
            }
        }
        val error = model.placeError
        val note = model.notice
        if (error != null) {
            Text(error, style = YardFonts.caption, color = Color.yard.danger)
        } else if (note != null && phase == CheckoutModel.Phase.Idle) {
            Text(note, style = YardFonts.caption, color = Color.yard.ink2)
        }
        model.pendingCheckoutId?.let { pending ->
            YardButton("View order status", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false) {
                onViewStatus(pending)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (model.totalMinor == null) "Subtotal" else "Total", style = YardFonts.caption, color = Color.yard.ink2)
                BagAnimatedPrice(minor = model.totalMinor ?: cart.subtotalMinor, currency = cart.currency)
            }
            YardButton(
                "Pay",
                icon = Icons.Filled.Lock,
                isLoading = working,
                fullWidth = false,
                enabled = !model.paymentsClosed && phase != CheckoutModel.Phase.Done && model.optionsReady,
                modifier = Modifier.widthIn(min = 150.dp),
                onClick = onPay,
            )
        }
    }
}

// region Pieces

/** A titled card section. */
@Composable
fun CheckoutSection(title: String, subtitle: String?, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(title, style = YardFonts.title, color = Color.yard.ink)
            if (subtitle != null) Text(subtitle, style = YardFonts.caption, color = Color.yard.ink2)
        }
        Card {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m), content = content)
        }
    }
}

/** Label + text field + hint/error, on `surface2`. */
@Composable
fun CheckoutTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    error: String?,
    hint: String? = null,
    placeholder: String? = null,
    optional: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    imeAction: ImeAction = ImeAction.Next,
    onNext: () -> Unit = {},
) {
    val shape = RoundedCornerShape(Radius.small)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        CheckoutFieldLabel(label, optional)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = YardFonts.body.copy(color = Color.yard.ink),
            cursorBrush = SolidColor(Color.yard.ink),
            keyboardOptions = KeyboardOptions(capitalization = capitalization, autoCorrectEnabled = false, keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onNext = { onNext() }, onDone = { onNext() }),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .background(Color.yard.surface2, shape)
                        .border(1.dp, if (error == null) Color.Transparent else Color.yard.danger, shape)
                        .padding(horizontal = Spacing.m),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty() && !placeholder.isNullOrEmpty()) {
                        Text(placeholder, style = YardFonts.body, color = Color.yard.ink3)
                    }
                    inner()
                }
            },
        )
        CheckoutFieldMessage(error, hint)
    }
}

/** Label + a dropdown that looks like a field (iOS `Menu { Picker }`). */
@Composable
fun CheckoutMenuField(
    label: String,
    value: String,
    error: String?,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    isPlaceholder: Boolean = false,
    optional: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Radius.small)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        CheckoutFieldLabel(label, optional)
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(shape)
                    .background(Color.yard.surface2)
                    .border(1.dp, if (error == null) Color.Transparent else Color.yard.danger, shape)
                    .pressableClick(pressedScale = 0.99f, onClickLabel = "Choose $label") { open = true }
                    .padding(horizontal = Spacing.m)
                    .semantics { contentDescription = "$label, $value" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    value,
                    style = YardFonts.body,
                    color = if (isPlaceholder) Color.yard.ink3 else Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(18.dp))
            }
            BagOptionsMenu(expanded = open, options = options, selected = selected, onDismiss = { open = false }, onSelect = {
                open = false
                onSelect(it)
            })
        }
        CheckoutFieldMessage(error, null)
    }
}

@Composable
fun CheckoutFieldLabel(label: String, optional: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        if (optional) Text("Optional", style = YardFonts.caption, color = Color.yard.ink3)
    }
}

@Composable
fun CheckoutFieldMessage(error: String?, hint: String?) {
    if (error != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = Color.yard.danger, modifier = Modifier.size(14.dp).offset(y = 1.dp))
            Text(error, style = YardFonts.caption, color = Color.yard.danger)
        }
    } else if (hint != null) {
        Text(hint, style = YardFonts.caption, color = Color.yard.ink3)
    }
}

/** A selectable row (shipping option, payment method): radio, title, detail, trailing value. */
@Composable
fun CheckoutOptionRow(
    title: String,
    detail: String?,
    isSelected: Boolean,
    icon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(Radius.small)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Color.yard.surface2)
            .border(1.dp, if (isSelected) Color.yard.ink else Color.Transparent, shape)
            .pressableClick { onClick() }
            .semantics { selected = isSelected }
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (isSelected) Color.yard.acid else Color.Transparent)
                .border(if (isSelected) 0.dp else 1.5.dp, if (isSelected) Color.Transparent else Color.yard.ink3, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (isSelected) Icon(Icons.Filled.Check, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(14.dp))
        }
        if (icon != null) Icon(icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
            if (detail != null) Text(detail, style = YardFonts.caption, color = Color.yard.ink2)
        }
        trailing?.invoke()
    }
}

/** One brand's delivery block in the checkout. */
@Composable
fun CheckoutBrandShipping(
    brandName: String,
    lines: List<CartLine>,
    quote: BagGroupQuote?,
    selected: String?,
    isLoading: Boolean,
    countryName: String,
    onSelect: (String) -> Unit,
    onRemove: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            BrandAvatar(name = brandName, size = 28.dp)
            Column(Modifier.weight(1f)) {
                Text(brandName, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val pieces = lines.sumOf { it.qty }
                Text(if (pieces == 1) "1 piece" else "$pieces pieces", style = YardFonts.caption, color = Color.yard.ink2)
            }
            Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
                lines.take(4).forEach { line ->
                    RemoteImage(
                        url = line.imageUrl,
                        maxPixelSize = 120,
                        modifier = Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .border(2.dp, Color.yard.surface, RoundedCornerShape(8.dp)),
                    )
                }
            }
        }

        when {
            quote != null -> {
                val current = quote.option(selected)
                if (quote.unavailable || current == null) {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.small)).background(Color.yard.surface2).padding(Spacing.m),
                        verticalArrangement = Arrangement.spacedBy(Spacing.s),
                    ) {
                        Text("$brandName doesn't ship to $countryName. Remove its pieces or change the delivery country.", style = YardFonts.callout, color = Color.yard.ink)
                        val reason = quote.reason
                        if (!reason.isNullOrEmpty()) Text(reason, style = YardFonts.caption, color = Color.yard.ink3)
                        YardButton("Remove $brandName's pieces", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, onClick = onRemove)
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        quote.options.filter { it.available }.forEach { option ->
                            CheckoutOptionRow(
                                title = option.label,
                                detail = option.arrivalText ?: "Estimated arrival unavailable",
                                isSelected = option.service == current.service,
                                trailing = {
                                    if (option.free) {
                                        Text("Free", style = YardFonts.bodyEmphasis, color = Color.yard.success)
                                    } else {
                                        PriceText(minor = option.priceMinor, currency = option.currency, style = YardFonts.bodyEmphasis)
                                    }
                                },
                            ) { onSelect(option.service) }
                        }
                    }
                }
            }
            isLoading -> Column(
                Modifier.semantics { contentDescription = "Loading shipping options for $brandName" },
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Skeleton(Modifier.fillMaxWidth().height(60.dp), cornerRadius = Radius.small)
                Skeleton(Modifier.fillMaxWidth().height(60.dp), cornerRadius = Radius.small)
            }
            else -> Text("Shipping for $brandName couldn't be calculated.", style = YardFonts.callout, color = Color.yard.ink2)
        }
    }
}

@Composable
fun CheckoutSummaryRow(title: String, emphasized: Boolean = false, value: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            title,
            style = if (emphasized) YardFonts.headline else YardFonts.callout,
            color = if (emphasized) Color.yard.ink else Color.yard.ink2,
            modifier = Modifier.weight(1f),
        )
        value()
    }
}

/** Loading placeholder shaped like the checkout. */
@Composable
fun CheckoutSkeleton() {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = Spacing.gutter)
            .semantics { contentDescription = "Loading checkout" },
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        Skeleton(Modifier.padding(top = Spacing.s).size(width = 200.dp, height = 40.dp), cornerRadius = 8.dp)
        repeat(3) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.size(width = 140.dp, height = 18.dp), shape = SkeletonShape.Capsule)
                Column(Modifier.fillMaxWidth().yardCard().padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    Skeleton(Modifier.fillMaxWidth().height(48.dp), cornerRadius = Radius.small)
                    Skeleton(Modifier.fillMaxWidth().height(48.dp), cornerRadius = Radius.small)
                }
            }
        }
        Spacer(Modifier.weight(1f))
    }
}

// endregion

// region Previews (fixtures are preview-only)

private fun checkoutPreviewModel(): CheckoutModel {
    val cart = Cart(
        id = "cart_preview",
        currency = "NGN",
        itemCount = 2,
        subtotalMinor = 6_840_000,
        lines = listOf(
            CartLine(variantId = "v1", productId = "p1", brandId = "b1", title = "Boxy heavyweight tee", variantLabel = "Size M", qty = 1, available = 4, unitMinor = 2_280_000, lineMinor = 2_280_000, brandName = "Acme Studio"),
            CartLine(variantId = "v2", productId = "p2", brandId = "b1", title = "Cargo pant", variantLabel = "Size 32", qty = 1, available = 2, unitMinor = 4_560_000, lineMinor = 4_560_000, brandName = "Acme Studio"),
        ),
        groups = listOf(CartGroup(brandId = "b1", variantIds = listOf("v1", "v2"), subtotalMinor = 6_840_000)),
        destination = Cart.Destination(country = "NG", city = "Lagos"),
    )
    val quotes = BagQuoteLoader.preview(cart, listOf(
        BagGroupQuote(brandId = "b1", brandName = "Acme Studio", options = listOf(
            BagQuoteOption(service = "standard", label = "Standard", available = true, priceMinor = 450_000, currency = "NGN", estimate = BagEstimate("2026-11-18", "2026-11-20")),
            BagQuoteOption(service = "express", label = "Express", available = true, priceMinor = 900_000, currency = "NGN", estimate = BagEstimate("2026-11-16", "2026-11-17")),
        )),
    ))
    return CheckoutModel(quotes = quotes).also { it.name = "Ada Obi" }
}

@Preview(name = "CheckoutView — dark", heightDp = 1800)
@Composable
private fun CheckoutDark() = YardPreview(darkTheme = true) { CheckoutView(remember { checkoutPreviewModel() }) }

@Preview(name = "CheckoutView — light", heightDp = 1800)
@Composable
private fun CheckoutLight() = YardPreview(darkTheme = false) { CheckoutView(remember { checkoutPreviewModel() }) }

// endregion
