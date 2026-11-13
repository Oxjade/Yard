package space.yardstore.app.features.product

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.minimumInteractiveComponentSize
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.YardWindow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ContentCut
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.LegalPage
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.BrandSummary
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductOption
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.QuantityStepper
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardToastHost
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * Product detail (`Route.Product(slug)`), mirroring ios/Yard/Features/Product/ProductDetailView.swift
 * and the website's product page (src/components/market/product/product-view.tsx):
 * photo pager + thumbnails, brand row with Follow, title and price, option chips, quantity,
 * stock line, a sticky bar with Save + Choose size + Add to bag (Notify me while the brand is
 * opening or a size is sold out), description, details, delivery estimate, returns, and the
 * "More from <brand>" / "You might also like" rails.
 */
@Composable
fun ProductDetailView(slug: String) {
    val model: ProductDetailModel = viewModel(key = "product:$slug") { ProductDetailModel(slug) }
    ProductDetailScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProductDetailScreen(model: ProductDetailModel) {
    val session = LocalSessionStore.current
    val cart = LocalCartStore.current
    val follows = LocalFollowStore.current
    val saved = LocalSavedStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var galleryIndex by rememberSaveable { mutableIntStateOf(0) }
    var viewerStart by rememberSaveable { mutableStateOf<Int?>(null) }
    var showsSizeSheet by rememberSaveable { mutableStateOf(false) }
    var showsSizePrompt by remember { mutableStateOf(false) }
    var isAdding by remember { mutableStateOf(false) }
    var descriptionExpanded by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(model.slug) { model.start(cart.destinationCountry, cart.currency) }

    // Back-in-stock state for the chosen variant (also for the initial selection and after sign-in).
    val variantId = model.variant?.id
    LaunchedEffect(variantId, session.isSignedIn) {
        if (variantId != null && session.isSignedIn) model.loadWatch(variantId)
    }

    // region Actions

    fun toggleWatch() {
        val variant = model.variant
        if (variant == null) {
            showsSizeSheet = true
            return
        }
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        scope.launch {
            try {
                val now = model.toggleWatch(variant.id)
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                toast.show(
                    if (now) "We'll let you know when it's available" else "Stopped watching this size",
                    if (now) Toast.Style.Success else Toast.Style.Info,
                    if (now) Icons.Filled.Notifications else Icons.Outlined.NotificationsOff,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    fun addToBag() {
        when (model.action(cart)) {
            ProductBuyAction.ChooseSize -> {
                if (showsSizeSheet) showsSizePrompt = true else showsSizeSheet = true
                return
            }
            ProductBuyAction.Limit -> {
                router.push(Route.Bag)
                return
            }
            ProductBuyAction.Opening, ProductBuyAction.SoldOut -> {
                toggleWatch()
                return
            }
            ProductBuyAction.Ready -> Unit
        }
        val variant = model.variant
        if (isAdding || variant == null) return
        val qty = minOf(maxOf(1, model.quantity), maxOf(1, model.maxQuantity(cart)))
        isAdding = true
        scope.launch {
            try {
                cart.add(variant.id, qty)
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                model.quantity = 1
                showsSizeSheet = false
                toast.show(if (qty > 1) "$qty added to your bag" else "Added to your bag", Toast.Style.Success, Icons.Filled.ShoppingBag)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            } finally {
                isAdding = false
            }
        }
    }

    fun toggleSave(product: Product) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        scope.launch {
            try {
                if (saved.toggle(product.id)) toast.show("Saved", Toast.Style.Success, Icons.Filled.Favorite)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    fun toggleFollow(brand: BrandSummary) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch {
            try {
                follows.toggle(brand.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    fun messageBrand(brand: BrandSummary) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        router.push(Route.MessageBrand(brand.id))
    }

    // endregion

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(title = null) {
            model.product?.let { ProductShareButton(it) }
            ProductBagButton(count = cart.count) { router.push(Route.Bag) }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val phase = model.phase) {
                ProductDetailModel.Phase.Loading -> ProductDetailSkeleton()
                ProductDetailModel.Phase.NotFound -> EmptyState(
                    "Product not found",
                    message = "This piece may have been removed, or the link is wrong.",
                    icon = Icons.Outlined.SearchOff,
                    actionTitle = "Go back",
                ) { router.pop() }
                is ProductDetailModel.Phase.Failed -> EmptyState.Error(message = phase.message) {
                    model.load(cart.destinationCountry, cart.currency)
                }
                ProductDetailModel.Phase.Loaded -> {
                    val product = model.product
                    if (product == null) {
                        ProductDetailSkeleton()
                    } else {
                        // The scrolling page + its sticky bar. On phones it holds the gallery too; on
                        // Medium+ it is the buy box in the right-hand column.
                        @Composable
                        fun BuyColumn(modifier: Modifier, showsGallery: Boolean) {
                            BoxWithConstraints(modifier) {
                                // A narrow buy box (Medium) drops the size pill; the size chips sit right above.
                                val showsSizePill = maxWidth >= ProductBuyBoxPillMinWidth
                                Column(Modifier.fillMaxSize()) {
                                    PullToRefreshBox(
                                        isRefreshing = model.isRefreshing,
                                        onRefresh = {
                                            model.refresh(cart.destinationCountry, cart.currency) { message ->
                                                toast.show(message, Toast.Style.Error)
                                            }
                                        },
                                        modifier = Modifier.weight(1f).fillMaxWidth(),
                                    ) {
                                        ProductDetailList(
                                            product = product,
                                            model = model,
                                            showsGallery = showsGallery,
                                            galleryIndex = galleryIndex,
                                            onGalleryIndex = { galleryIndex = it },
                                            onOpenViewer = { viewerStart = it },
                                            showsSizePrompt = showsSizePrompt,
                                            onSizeChosen = { showsSizePrompt = false },
                                            descriptionExpanded = descriptionExpanded,
                                            onToggleDescription = { descriptionExpanded = !descriptionExpanded },
                                            onToggleFollow = ::toggleFollow,
                                            onMessageBrand = ::messageBrand,
                                        )
                                    }
                                    ProductBottomBar(
                                        product = product,
                                        model = model,
                                        isAdding = isAdding,
                                        showsSizePill = showsSizePill,
                                        onSave = { toggleSave(product) },
                                        onChooseSize = { showsSizeSheet = true },
                                        onAdd = ::addToBag,
                                        onNotify = ::toggleWatch,
                                        onShowSizes = { showsSizeSheet = true },
                                    )
                                }
                            }
                        }

                        val window = LocalYardWindow.current
                        if (window.isWide) {
                            // Tablet rule 4: gallery on the left in its own scroll, buy box on the right.
                            val galleryWeight = productGalleryWeight(window)
                            Row(Modifier.fillMaxSize()) {
                                ProductWideGalleryPane(
                                    product = product,
                                    galleryIndex = galleryIndex,
                                    onGalleryIndex = { galleryIndex = it },
                                    onOpenViewer = { viewerStart = it },
                                    modifier = Modifier.weight(galleryWeight).fillMaxHeight(),
                                )
                                BuyColumn(Modifier.weight(1f - galleryWeight).fillMaxHeight(), showsGallery = false)
                            }
                        } else {
                            BuyColumn(Modifier.fillMaxSize(), showsGallery = true)
                        }
                    }
                }
            }
        }
    }

    if (showsSizeSheet && model.product != null) {
        YardSheet(onDismissRequest = { showsSizeSheet = false }) {
            YardToastHost(toast) {
                ProductSizeSheet(
                    model = model,
                    isAdding = isAdding,
                    onAdd = ::addToBag,
                    onNotify = ::toggleWatch,
                    onClose = { showsSizeSheet = false },
                )
            }
        }
    }

    viewerStart?.let { start ->
        ProductPhotoViewer(images = model.product?.images ?: emptyList(), startIndex = start) { viewerStart = null }
    }
}

// region List

@Composable
private fun ProductDetailList(
    product: Product,
    model: ProductDetailModel,
    showsGallery: Boolean,
    galleryIndex: Int,
    onGalleryIndex: (Int) -> Unit,
    onOpenViewer: (Int) -> Unit,
    showsSizePrompt: Boolean,
    onSizeChosen: () -> Unit,
    descriptionExpanded: Boolean,
    onToggleDescription: () -> Unit,
    onToggleFollow: (BrandSummary) -> Unit,
    onMessageBrand: (BrandSummary) -> Unit,
) {
    val router = LocalRouter.current
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = Spacing.s, bottom = Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        if (showsGallery) {
            item(key = "gallery") {
                ProductGallery(product.images, index = galleryIndex, onIndexChange = onGalleryIndex, onOpen = onOpenViewer) {
                    ProductGalleryTag(product)
                }
            }
        }
        item(key = "head") {
            Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                product.brand?.let { ProductBrandRow(it, onToggleFollow, onMessageBrand) }
                ProductTitleBlock(product, model)
            }
        }
        item(key = "options") {
            ProductOptionsBlock(product, model, showsSizePrompt, onSizeChosen)
        }
        product.dropId?.let { dropId ->
            item(key = "drop") {
                ProductDropCard(Modifier.padding(horizontal = Spacing.gutter)) { router.push(Route.Drop(dropId)) }
            }
        }
        if (product.description.isNotEmpty()) {
            item(key = "description") {
                ProductDescriptionBlock(product.description, descriptionExpanded, onToggleDescription, Modifier.padding(horizontal = Spacing.gutter))
            }
        }
        if (product.details.isNotEmpty() || model.variant != null) {
            item(key = "details") {
                ProductDetailsCard(product, model.variant, Modifier.padding(horizontal = Spacing.gutter))
            }
        }
        item(key = "delivery") {
            ProductDeliveryCard(product, model, onMessageBrand, Modifier.padding(horizontal = Spacing.gutter))
        }
        val brand = product.brand
        if (brand != null && model.moreFromBrand.isNotEmpty()) {
            item(key = "rail-brand") {
                ProductRail(
                    title = "More from ${brand.name}",
                    subtitle = "Independent pieces from ${brand.name}.",
                    actionTitle = "Visit storefront",
                    products = model.moreFromBrand,
                    showsBrand = false,
                ) { router.push(Route.Brand(brand.handle)) }
            }
        }
        if (model.similar.isNotEmpty()) {
            item(key = "rail-similar") {
                ProductRail(
                    title = "You might also like",
                    subtitle = "Pieces from other independent brands, close to this one.",
                    actionTitle = if (product.category.isEmpty()) null else "See all",
                    products = model.similar,
                    showsBrand = true,
                ) { router.push(Route.Category(product.category)) }
            }
        }
        if (!model.railsLoaded) {
            item(key = "rails-skeleton") { ProductRailSkeleton() }
        }
    }
}

/** Share of the width the gallery takes on Medium+ (tablet rule 4: ≈ 55–60%). */
internal fun productGalleryWeight(window: YardWindow): Float = if (window.isExpanded) 0.58f else 0.55f

/** Below this width the buy box's sticky bar leaves out the "Choose size" pill. */
private val ProductBuyBoxPillMinWidth = 360.dp

/**
 * The left-hand column on Medium+: the gallery in its own scroll, the photo capped to the pane's
 * height so it is seen whole next to the buy box.
 */
@Composable
private fun ProductWideGalleryPane(
    product: Product,
    galleryIndex: Int,
    onGalleryIndex: (Int) -> Unit,
    onOpenViewer: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val navBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BoxWithConstraints(modifier) {
        val thumbnails = if (product.images.size > 1) 68.dp + Spacing.m else 0.dp
        val pagerMax = (maxHeight - thumbnails - Spacing.s - Spacing.l - navBar).coerceAtLeast(240.dp)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(top = Spacing.s, bottom = Spacing.l + navBar),
        ) {
            ProductGallery(
                product.images,
                index = galleryIndex,
                onIndexChange = onGalleryIndex,
                onOpen = onOpenViewer,
                pagerMaxHeight = pagerMax,
            ) {
                ProductGalleryTag(product)
            }
        }
    }
}

@Composable
private fun ProductGalleryTag(product: Product) {
    when {
        product.isNotForSale -> Tag("Opening soon", style = TagStyle.OnPhoto)
        product.isSoldOut -> Tag("Sold out", style = TagStyle.OnPhoto)
        product.isNew -> Tag("New Arrival", style = TagStyle.Acid)
        product.badges.any { it.lowercase() == "limited" } -> Tag("Limited", style = TagStyle.OnPhoto)
    }
}

@Composable
private fun ProductBrandRow(brand: BrandSummary, onToggleFollow: (BrandSummary) -> Unit, onMessageBrand: (BrandSummary) -> Unit) {
    val router = LocalRouter.current
    val following = LocalFollowStore.current.isFollowing(brand.id)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Row(
            Modifier
                .weight(1f)
                .pressableClick(onClickLabel = "Open the brand") { router.push(Route.Brand(brand.handle)) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            BrandAvatar(brand.name, size = 44.dp, verified = brand.verified)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(
                        brand.name,
                        style = YardFonts.headline,
                        color = Color.yard.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (brand.verified) {
                        Icon(Icons.Filled.Verified, contentDescription = "Verified brand", tint = Color.yard.violet, modifier = Modifier.size(15.dp))
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    productPlaceText(brand)?.let {
                        Text(it, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                    if (brand.foundingBadge) Tag("Founding", style = TagStyle.Violet)
                }
            }
        }

        // 40dp circle (as iOS) in a 48dp touch target.
        Box(
            Modifier
                .size(48.dp)
                .semantics { contentDescription = "Message ${brand.name}" }
                .pressableClick { onMessageBrand(brand) },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(40.dp).background(Color.yard.surface2, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(18.dp))
            }
        }

        YardButton(
            if (following) "Following" else "Follow",
            style = if (following) YardButtonStyle.Secondary else YardButtonStyle.Inverted,
            size = YardButtonSize.Small,
            fullWidth = false,
        ) { onToggleFollow(brand) }
    }
}

private fun productPlaceText(brand: BrandSummary): String? {
    val country = brand.country?.let { ProductDetailModel.countryName(it) }
    val parts = listOfNotNull(brand.city, country).filter { it.isNotEmpty() }
    return if (parts.isEmpty()) null else parts.joinToString(", ")
}

@Composable
private fun ProductTitleBlock(product: Product, model: ProductDetailModel) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        YardDisplayText(product.title, size = 36.sp, modifier = Modifier.semantics { heading() })
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            PriceText(
                minor = model.priceMinor,
                currency = product.currency,
                compareAtMinor = product.compareAtMinor,
                style = YardFonts.number(22.sp),
            )
            if (product.compareAt != null && model.priceMinor < (product.compareAtMinor ?: 0)) {
                Tag("Sale", style = TagStyle.Acid)
            }
            if (product.isNew && !product.isNotForSale && !product.isSoldOut) {
                Tag("New Arrival", style = TagStyle.Neutral)
            }
        }
        Text("Duties and taxes are confirmed at checkout.", style = YardFonts.caption, color = Color.yard.ink3)
    }
}

@Composable
private fun ProductOptionsBlock(product: Product, model: ProductDetailModel, showsSizePrompt: Boolean, onSizeChosen: () -> Unit) {
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val action = model.action(cart)
    val maxQty = model.maxQuantity(cart)
    Column(Modifier.animateContentSize(Motion.snappy()), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        model.otherOptions.forEach { option -> ProductOptionPicker(option, model) }
        model.sizeOption?.let { size ->
            ProductOptionPicker(size, model, showsInvalid = showsSizePrompt) { onSizeChosen() }
        }

        Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter), verticalAlignment = Alignment.CenterVertically) {
            if (!model.isOpening && (action == ProductBuyAction.Ready || action == ProductBuyAction.ChooseSize)) {
                val effective = minOf(maxOf(1, model.quantity), maxOf(1, maxQty))
                QuantityStepper(effective, range = 1..maxOf(1, maxQty)) { model.quantity = maxOf(1, it) }
            }
            Spacer(Modifier.weight(1f))
            ProductStockLineView(model)
        }

        val helper = productHelperText(product, model, action, model.inBag(cart))
        AnimatedVisibility(visible = helper != null, enter = fadeIn(Motion.snappy()), exit = fadeOut(Motion.snappy())) {
            Row(
                Modifier.padding(horizontal = Spacing.gutter),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(helper.orEmpty(), style = YardFonts.caption, color = Color.yard.ink2, modifier = Modifier.weight(1f, fill = false))
                if (model.inBag(cart) > 0) {
                    Text(
                        "View bag",
                        style = YardFonts.captionEmphasis,
                        color = Color.yard.violet,
                        modifier = Modifier.minimumInteractiveComponentSize().pressableClick { router.push(Route.Bag) },
                    )
                }
            }
        }
    }
}

/** The website's helper line under the buttons. */
private fun productHelperText(product: Product, model: ProductDetailModel, action: ProductBuyAction, inBag: Int): String? {
    val brandName = product.brand?.name ?: "this brand"
    return when (action) {
        ProductBuyAction.Opening -> {
            val pick = model.sizeOption != null && model.variant == null
            "$brandName is opening soon on Yard. ${if (pick) "Choose your size and tap Notify me" else "Tap Notify me"} to hear when it opens, or follow $brandName."
        }
        ProductBuyAction.Limit -> {
            val s = model.variantStock
            if (s != null && s <= ProductDetailModel.MAX_PER_LINE) {
                "All $s available are already in your bag."
            } else {
                "Your bag already holds the most you can buy at once (${ProductDetailModel.MAX_PER_LINE})."
            }
        }
        ProductBuyAction.Ready -> if (inBag > 0) "$inBag already in your bag." else null
        ProductBuyAction.SoldOut ->
            if (model.variant == null) "Sold out for now. Save it to keep it in your wishlist, or see more from $brandName below." else null
        ProductBuyAction.ChooseSize -> null
    }
}

@Composable
private fun ProductDropCard(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .yardCard()
            .pressableClick(onClick = onClick)
            .padding(Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(Modifier.size(36.dp).background(Color.yard.acid, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Bolt, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Part of a drop", style = YardFonts.headline, color = Color.yard.ink)
            Text("See the release time, access and limits.", style = YardFonts.caption, color = Color.yard.ink2)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun ProductDescriptionBlock(text: String, expanded: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val long = text.length > 220
    Column(modifier.animateContentSize(Motion.spring()), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Text("Description", style = YardFonts.headline, color = Color.yard.ink)
        Text(
            text,
            style = YardFonts.body,
            color = Color.yard.ink2,
            maxLines = if (expanded || !long) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
        )
        if (long) {
            Text(
                if (expanded) "Show less" else "Read more",
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.violet,
                modifier = Modifier.minimumInteractiveComponentSize().pressableClick(onClick = onToggle),
            )
        }
    }
}

@Composable
private fun ProductDetailsCard(product: Product, variant: ProductVariant?, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Text("Details", style = YardFonts.headline, color = Color.yard.ink)
            product.details.forEach { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    Box(Modifier.padding(top = 9.dp).size(4.dp).background(Color.yard.ink3, CircleShape))
                    Text(line, style = YardFonts.callout, color = Color.yard.ink2)
                }
            }
            product.processingText?.let { ProductDetailRow(Icons.Outlined.ContentCut, it) }
            if (variant != null && variant.sku.isNotEmpty()) {
                Text("Reference ${variant.sku}", style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink3)
            }
        }
    }
}

@Composable
private fun ProductDetailRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Icon(icon, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Text(text, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

// endregion

// region Delivery + returns

@Composable
private fun ProductDeliveryCard(product: Product, model: ProductDetailModel, onMessageBrand: (BrandSummary) -> Unit, modifier: Modifier = Modifier) {
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val action = model.action(cart)
    val brandName = product.brand?.name ?: "The brand"
    Card(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Text("Delivery & returns", style = YardFonts.headline, color = Color.yard.ink)

            ProductDeliveryEstimateRows(product, model, action, brandName)

            val origin = productOriginText(product, model)
            ProductDetailRow(
                Icons.Outlined.Inventory2,
                if (origin != null) "Sold and shipped by $brandName from $origin." else "Sold and shipped by $brandName.",
            )
            ProductDetailRow(
                Icons.AutoMirrored.Outlined.Undo,
                "Start a return from your orders. Once $brandName receives the piece, the refund goes back to the way you paid.",
            )

            Row(Modifier.padding(top = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                YardButton(
                    "Returns policy",
                    icon = Icons.Outlined.Description,
                    style = YardButtonStyle.Secondary,
                    size = YardButtonSize.Small,
                    fullWidth = false,
                ) { router.push(Route.Legal(LegalPage.Refunds)) }
                product.brand?.let { brand ->
                    YardButton(
                        "Ask ${brand.name}",
                        modifier = Modifier.weight(1f, fill = false),
                        icon = Icons.Outlined.ChatBubbleOutline,
                        style = YardButtonStyle.Secondary,
                        size = YardButtonSize.Small,
                        fullWidth = false,
                    ) { onMessageBrand(brand) }
                }
            }

            val e = model.estimate
            if (e != null && !e.unavailable) {
                Text("Estimates, not guarantees. They skip weekends and public holidays.", style = YardFonts.caption, color = Color.yard.ink3)
            }
        }
    }
}

@Composable
private fun ColumnScope.ProductDeliveryEstimateRows(product: Product, model: ProductDetailModel, action: ProductBuyAction, brandName: String) {
    val cart = LocalCartStore.current
    val country = ProductDetailModel.countryName(model.estimateCountry)
    val e = model.estimate
    when {
        model.estimateLoading && e == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Icon(Icons.Outlined.LocalShipping, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
            Skeleton(Modifier.size(width = 200.dp, height = 14.dp), cornerRadius = 6.dp)
        }
        model.estimateFailed -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            ProductDetailRow(Icons.Outlined.LocalShipping, "Couldn't load a delivery estimate.", Modifier.weight(1f, fill = false))
            Text(
                "Retry",
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.violet,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .pressableClick { model.retryEstimate(cart.destinationCountry, cart.currency) }
                    .padding(horizontal = Spacing.xs),
            )
        }
        e != null -> {
            val std = e.standard
            if (e.unavailable || std == null) {
                ProductDetailRow(Icons.Outlined.LocalShipping, e.reason ?: "Doesn't ship to $country yet.")
            } else if (action == ProductBuyAction.SoldOut || action == ProductBuyAction.Opening) {
                productCombinedDays(e.handling, std.transit)?.let { total ->
                    ProductDetailRow(Icons.Outlined.LocalShipping, "Not available right now. When it is, $brandName usually delivers to $country in $total.")
                }
            } else {
                val from = std.estimate?.arrivalFrom
                val to = std.estimate?.arrivalTo
                val range = if (from != null && to != null) ProductShippingFormat.range(from, to) else null
                if (range != null) ProductDetailRow(Icons.Outlined.LocalShipping, "Estimated delivery to $country: $range")
                ProductShippingFormat.businessDays(e.handling)?.let { days ->
                    ProductDetailRow(Icons.Outlined.Schedule, productDispatchText(days, e))
                }
                val ex = e.express
                val exFrom = ex?.estimate?.arrivalFrom
                val exTo = ex?.estimate?.arrivalTo
                val exRange = if (exFrom != null && exTo != null) ProductShippingFormat.range(exFrom, exTo) else null
                if (ex != null && exRange != null) {
                    val price = if (ex.free) "free" else (ex.price?.formatted ?: "")
                    ProductDetailRow(Icons.Outlined.Bolt, if (price.isEmpty()) "Express: est. $exRange" else "Express: est. $exRange, $price")
                }
            }
        }
    }
}

private fun productDispatchText(days: String, e: ProductEstimate): String {
    var text = "Usually dispatches in $days."
    val cutoff = YardDate.parse(e.cutoffAt)
    val local = e.brand?.cutoffLocal
    if (cutoff != null && cutoff.isAfter(Instant.now()) && !local.isNullOrEmpty()) {
        val city = e.brand.originCity
        text += if (city.isEmpty()) " Order by $local to count from today." else " Order by $local $city time to count from today."
    }
    return text
}

private fun productCombinedDays(handling: List<Int>, transit: List<Int>): String? {
    if (handling.size != 2 || transit.size != 2) return null
    return ProductShippingFormat.businessDays(listOf(handling[0] + transit[0], handling[1] + transit[1]))
}

private fun productOriginText(product: Product, model: ProductDetailModel): String? {
    val b = model.estimate?.brand
    if (b != null && b.originCity.isNotEmpty()) return "${b.originCity}, ${ProductDetailModel.countryName(b.originCountry)}"
    val brand = product.brand ?: return null
    return productPlaceText(brand)
}

// endregion

// region Rails

@Composable
private fun ProductRail(
    title: String,
    subtitle: String?,
    actionTitle: String?,
    products: List<Product>,
    showsBrand: Boolean,
    action: () -> Unit,
) {
    val router = LocalRouter.current
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        SectionHeader(title, subtitle = subtitle, actionTitle = actionTitle, action = if (actionTitle == null) null else action)
        LazyRow(
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            verticalAlignment = Alignment.Top,
        ) {
            items(products, key = { it.id }) { p ->
                ProductTile(
                    p,
                    Modifier.width(150.dp).pressableClick { router.push(Route.Product(p.slug)) },
                    showsBrand = showsBrand,
                )
            }
        }
    }
}

@Composable
private fun ProductRailSkeleton() {
    Column(Modifier.clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Skeleton(Modifier.padding(horizontal = Spacing.gutter).size(width = 180.dp, height = 18.dp), cornerRadius = 6.dp)
        Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            repeat(3) { Skeleton(Modifier.size(width = 150.dp, height = 190.dp)) }
        }
    }
}

// endregion

// region Bottom bar + top bar buttons

@Composable
private fun ProductBottomBar(
    product: Product,
    model: ProductDetailModel,
    isAdding: Boolean,
    showsSizePill: Boolean,
    onSave: () -> Unit,
    onChooseSize: () -> Unit,
    onAdd: () -> Unit,
    onNotify: () -> Unit,
    onShowSizes: () -> Unit,
) {
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val action = model.action(cart)
    val isSaved = LocalSavedStore.current.isSaved(product.id)
    Column(Modifier.fillMaxWidth().background(Color.yard.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color.yard.line))
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.m, bottom = Spacing.s),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Box(
                Modifier
                    .size(52.dp)
                    .background(Color.yard.surface2, CircleShape)
                    .semantics { contentDescription = if (isSaved) "Remove from saved" else "Save" }
                    .pressableClick(onClick = onSave),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (isSaved) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    contentDescription = null,
                    tint = if (isSaved) Color.yard.danger else Color.yard.ink,
                    modifier = Modifier.size(22.dp),
                )
            }

            val size = model.sizeOption
            if (size != null && showsSizePill) {
                val chosen = model.selection[size.name]
                YardButton(
                    if (chosen != null) "Size $chosen" else "Choose size",
                    modifier = Modifier.widthIn(max = 150.dp),
                    icon = Icons.Filled.KeyboardArrowDown,
                    style = YardButtonStyle.Secondary,
                    fullWidth = false,
                    onClick = onChooseSize,
                )
            }

            Box(Modifier.weight(1f)) {
                when (action) {
                    ProductBuyAction.Ready, ProductBuyAction.ChooseSize ->
                        YardButton("Add to bag", icon = Icons.Outlined.ShoppingBag, isLoading = isAdding, onClick = onAdd)
                    ProductBuyAction.Opening -> ProductNotifyButton(model, onNotify = onNotify, onPrompt = onShowSizes)
                    ProductBuyAction.SoldOut ->
                        if (model.variant != null) {
                            ProductNotifyButton(model, onNotify = onNotify, onPrompt = {})
                        } else {
                            YardButton("Sold out", style = YardButtonStyle.Secondary, enabled = false) {}
                        }
                    ProductBuyAction.Limit ->
                        YardButton("View bag", icon = Icons.Outlined.ShoppingBag, style = YardButtonStyle.Secondary) { router.push(Route.Bag) }
                }
            }
        }
    }
}

@Composable
private fun ProductNotifyButton(model: ProductDetailModel, onNotify: () -> Unit, onPrompt: () -> Unit) {
    val v = model.variant
    if (v != null) {
        val active = model.isWatching(v.id)
        YardButton(
            if (active) "Stop watching" else "Notify me",
            icon = Icons.Outlined.NotificationsNone,
            style = if (active) YardButtonStyle.Secondary else YardButtonStyle.Primary,
            isLoading = model.watchBusy,
            onClick = onNotify,
        )
    } else {
        YardButton("Notify me", icon = Icons.Outlined.NotificationsNone, onClick = onPrompt)
    }
}

/** iOS `ShareLink`: the web URL `/products/{slug}` through the system share sheet. */
@Composable
private fun ProductShareButton(product: Product) {
    val context = LocalContext.current
    GlassIconButton(Icons.Outlined.Share, contentDescription = "Share", modifier = Modifier.minimumInteractiveComponentSize(), size = 38.dp) {
        val url = Config.webUrl("/products/${Config.encodePath(product.slug)}")
        val message = product.brand?.let { "${product.title} by ${it.name} on Yard" } ?: product.title
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, product.title)
            putExtra(Intent.EXTRA_TEXT, "$message\n$url")
        }
        try {
            context.startActivity(Intent.createChooser(send, null))
        } catch (_: ActivityNotFoundException) {
        }
    }
}

/** The bag button with its count badge; bounces when the count changes. */
@Composable
private fun ProductBagButton(count: Int, onClick: () -> Unit) {
    val bounce = remember { Animatable(1f) }
    var lastCount by remember { mutableIntStateOf(count) }
    LaunchedEffect(count) {
        if (count != lastCount) {
            lastCount = count
            bounce.animateTo(1.18f, Motion.snappy())
            bounce.animateTo(1f, Motion.spring())
        }
    }
    Box(Modifier.scale(bounce.value)) {
        GlassIconButton(
            Icons.Outlined.ShoppingBag,
            contentDescription = if (count > 0) "Bag, $count items" else "Bag",
            modifier = Modifier.minimumInteractiveComponentSize(),
            size = 38.dp,
            onClick = onClick,
        )
        if (count > 0) {
            Text(
                "${minOf(count, 99)}",
                style = YardFonts.micro.monospacedDigits(),
                color = Color.yard.onAcid,
                maxLines = 1,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-1).dp, y = 3.dp)
                    .heightIn(min = 16.dp)
                    .widthIn(min = 16.dp)
                    .background(Color.yard.acid, YardShapes.pill)
                    .padding(horizontal = 4.dp, vertical = 1.dp)
                    .clearAndSetSemantics { },
            )
        }
    }
}

// endregion

/** Loading placeholder shaped like the page (two columns on Medium+, as the loaded page). */
@Composable
fun ProductDetailSkeleton() {
    val window = LocalYardWindow.current
    if (window.isWide) {
        val galleryWeight = productGalleryWeight(window)
        Row(Modifier.fillMaxSize().semantics { contentDescription = "Loading product" }) {
            Column(
                Modifier.weight(galleryWeight).fillMaxHeight().padding(top = Spacing.s, bottom = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                Skeleton(Modifier.padding(horizontal = Spacing.s).fillMaxWidth().weight(1f))
                ProductSkeletonThumbnails()
            }
            Column(
                Modifier.weight(1f - galleryWeight).fillMaxHeight().padding(top = Spacing.s),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) { ProductSkeletonBuyBox() }
        }
    } else {
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = Spacing.s)
                .semantics { contentDescription = "Loading product" },
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            Skeleton(Modifier.padding(horizontal = Spacing.s).fillMaxWidth().aspectRatio(0.8f))
            ProductSkeletonThumbnails()
            ProductSkeletonBuyBox()
        }
    }
}

@Composable
private fun ProductSkeletonThumbnails() {
    Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
        repeat(4) { Skeleton(Modifier.size(width = 56.dp, height = 68.dp), cornerRadius = Radius.small) }
    }
}

@Composable
private fun ProductSkeletonBuyBox() {
    Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Skeleton(Modifier.size(44.dp), shape = SkeletonShape.Circle)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Skeleton(Modifier.size(width = 140.dp, height = 14.dp), cornerRadius = 6.dp)
            Skeleton(Modifier.size(width = 90.dp, height = 12.dp), cornerRadius = 6.dp)
        }
        Skeleton(Modifier.size(width = 84.dp, height = 34.dp), shape = SkeletonShape.Capsule)
    }
    Skeleton(Modifier.padding(horizontal = Spacing.gutter).fillMaxWidth().height(34.dp), cornerRadius = 8.dp)
    Skeleton(Modifier.padding(horizontal = Spacing.gutter).size(width = 110.dp, height = 22.dp), cornerRadius = 6.dp)
    Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
        repeat(5) { Skeleton(Modifier.size(width = 52.dp, height = 36.dp), shape = SkeletonShape.Capsule) }
    }
}

// region Previews (fixtures are preview-only)

internal object ProductDetailPreviewData {
    val product = Product(
        id = "prd_preview",
        slug = "boxy-tee",
        brandId = PreviewFixtures.brand.id,
        title = "Boxy heavyweight tee",
        description = "Soft heavyweight jersey with a relaxed, boxy cut. Garment-dyed so every piece settles into its own shade. Designed for everyday wear and cut to layer.",
        details = listOf("100% cotton, 280 gsm", "Boxy fit, true to size", "Made in Lagos"),
        category = "tops",
        badges = listOf("new"),
        priceMinor = 4500,
        compareAtMinor = 6000,
        currency = "USD",
        images = PreviewFixtures.products.take(4).mapNotNull { it.images.firstOrNull() },
        options = listOf(
            ProductOption("Colour", listOf(ProductOption.Value("Black", "#111111"), ProductOption.Value("Bone", "#E8E2D4"))),
            ProductOption("Size", listOf("S", "M", "L", "XL").map { ProductOption.Value(it) }),
        ),
        variants = listOf(
            ProductVariant("v1", "BT-BLK-S", mapOf("Colour" to "Black", "Size" to "S"), "Black, S", 4500, 4),
            ProductVariant("v2", "BT-BLK-M", mapOf("Colour" to "Black", "Size" to "M"), "Black, M", 4500, 2),
            ProductVariant("v3", "BT-BLK-L", mapOf("Colour" to "Black", "Size" to "L"), "Black, L", 4500, 0),
            ProductVariant("v4", "BT-BLK-XL", mapOf("Colour" to "Black", "Size" to "XL"), "Black, XL", 4500, 6),
            ProductVariant("v5", "BT-BON-M", mapOf("Colour" to "Bone", "Size" to "M"), "Bone, M", 4500, 3),
        ),
        available = 15,
        processingDays = listOf(2, 4),
        brand = PreviewFixtures.brand,
    )
}

@Preview(name = "ProductDetailView — dark", heightDp = 1400)
@Composable
private fun ProductDetailDarkPreview() = YardPreview(darkTheme = true) {
    ProductDetailScreen(remember { ProductDetailModel(ProductDetailPreviewData.product) })
}

@Preview(name = "ProductDetailView — light", heightDp = 1400)
@Composable
private fun ProductDetailLightPreview() = YardPreview(darkTheme = false) {
    ProductDetailScreen(remember { ProductDetailModel(ProductDetailPreviewData.product) })
}

@YardTabletPreviews
@Composable
private fun ProductDetailTabletPreview() = YardPreview(darkTheme = true) {
    ProductDetailScreen(remember { ProductDetailModel(ProductDetailPreviewData.product) })
}

@YardTabletPreviews
@Composable
private fun ProductDetailTabletLightPreview() = YardPreview(darkTheme = false) {
    ProductDetailScreen(remember { ProductDetailModel(ProductDetailPreviewData.product) })
}

@YardTabletPreviews
@Composable
private fun ProductDetailTabletLoadingPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.fillMaxSize()) { ProductDetailSkeleton() }
}

@Preview(name = "ProductDetailView — loading")
@Composable
private fun ProductDetailLoadingPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.fillMaxSize()) { ProductDetailSkeleton() }
}

// endregion
