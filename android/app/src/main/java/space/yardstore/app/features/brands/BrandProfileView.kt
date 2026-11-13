package space.yardstore.app.features.brands

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridState
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.models.StorefrontBrand
import space.yardstore.app.core.models.StorefrontCollection
import space.yardstore.app.core.models.StorefrontConfig
import space.yardstore.app.core.models.StorefrontVersion
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.SegmentedPill
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground

// A brand's profile (reference 02-brand-profile.jpg; website /brands/{handle}).
// Mirrors BrandProfileView.swift.
//
// Full-bleed hero from the storefront cover (else the first product photo) that parallaxes on
// scroll and fades into a blurred copy of itself; huge name, @handle, founding badge and place;
// a wide white Follow pill, a round Message button and a "…" menu (Share, Copy link, Report); real
// stats only (followers from /api/follows/counts, products from ProductsPage.total, drops when the
// drops list is complete); the story card; then Products / Collections / Drops.
// Data: BrandProfileModel.

/** The phone's tall hero. */
private val HeroHeight: Dp = 470.dp
/** Medium+ windows (tablets, landscape, unfolded): a shorter hero so the grid shows sooner. */
private val WideHeroHeight: Dp = 300.dp

/** Hero height for the current window. */
@Composable
private fun brandHeroHeight(): Dp = if (LocalYardWindow.current.isWide) WideHeroHeight else HeroHeight
/** Grid tiles sit 6dp from the screen edge; full-width rows add this to reach the 16dp gutter. */
private val InnerGutter: Dp = Spacing.gutter - Spacing.gridGap

@Composable
fun BrandProfileView(handle: String) {
    val model: BrandProfileModel = viewModel(key = "brand-profile-$handle") { BrandProfileModel(handle) }
    BrandProfileContent(model)
}

@Composable
private fun BrandProfileContent(model: BrandProfileModel) {
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    LaunchedEffect(model) { model.start(follows) }

    Box(Modifier.fillMaxSize().yardScreenBackground()) {
        when (val phase = model.phase) {
            BrandProfileModel.Phase.Loading -> BrandProfileLoading()
            is BrandProfileModel.Phase.NotFound -> EmptyState(
                title = "Brand not found",
                modifier = Modifier.statusBarsPadding().padding(top = 112.dp),
                message = phase.message.ifEmpty { "That brand isn't on Yard." },
                icon = Icons.Outlined.Storefront,
                actionTitle = "Browse brands",
            ) { router.push(Route.BrandsDirectory) }
            is BrandProfileModel.Phase.Failed -> EmptyState.Error(
                message = phase.message,
                modifier = Modifier.statusBarsPadding().padding(top = 112.dp),
            ) { model.load(follows) }
            BrandProfileModel.Phase.Loaded -> {
                val brand = model.brand
                if (brand != null) BrandProfileLoaded(model, brand) else BrandProfileLoading()
            }
        }
        BrandProfileTopBar(model)
    }
}

// region Top bar (back and …)

@Composable
private fun BrandProfileTopBar(model: BrandProfileModel) {
    val back = LocalBackAction.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val isDark = Color.yard.isDark
    var menuOpen by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val isClose = back?.isClose == true
        GlassIconButton(
            if (isClose) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = if (isClose) "Close" else "Back",
        ) { back?.perform?.invoke() ?: router.pop() }
        Spacer(Modifier.weight(1f))
        val brand = model.brand
        if (brand != null) {
            Box {
                GlassIconButton(Icons.Filled.MoreHoriz, contentDescription = "More") { menuOpen = true }
                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    modifier = Modifier.background(Color.yard.surface),
                ) {
                    val link = Config.webUrl("/brands/${brand.handle}")
                    BrandsMenuItem("Share", Icons.Outlined.Share) {
                        menuOpen = false
                        brandsShare(context, brand.name, link)
                    }
                    BrandsMenuItem("Copy link", Icons.Outlined.Link) {
                        menuOpen = false
                        context.getSystemService(ClipboardManager::class.java)
                            ?.setPrimaryClip(ClipData.newPlainText(brand.name, link))
                        toast.show("Link copied", Toast.Style.Success, Icons.Outlined.Link)
                    }
                    HorizontalDivider(color = Color.yard.line)
                    // POST /api/reports only accepts messages, conversations, posts and places
                    // (no brand subject), so brand reports go to Yard support.
                    BrandsMenuItem("Report brand", Icons.Outlined.Flag, tint = Color.yard.danger) {
                        menuOpen = false
                        WebPages.open(context, Config.webUrl("/support"), darkTheme = isDark)
                    }
                }
            }
        }
    }
}

@Composable
private fun BrandsMenuItem(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color = Color.yard.ink, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title, style = YardFonts.body, color = tint) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = tint) },
        onClick = onClick,
    )
}

private fun brandsShare(context: Context, name: String, link: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, name)
        putExtra(Intent.EXTRA_TEXT, "$name on Yard\n$link")
    }
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

// endregion

// region Loaded

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandProfileLoaded(model: BrandProfileModel, brand: StorefrontBrand) {
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    val scope = rememberCoroutineScope()
    val gridState = rememberLazyStaggeredGridState()
    var tab by rememberSaveable { mutableStateOf(BrandProfileTab.Products) }
    var refreshing by remember { mutableStateOf(false) }
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxxl
    val isWide = LocalYardWindow.current.isWide

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try { model.load(follows) } finally { refreshing = false }
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        MasonryGrid(
            items = if (tab == BrandProfileTab.Products) model.products else emptyList(),
            key = { it.id },
            modifier = Modifier.fillMaxSize(),
            state = gridState,
            contentPadding = PaddingValues(start = Spacing.gridGap, end = Spacing.gridGap, bottom = bottom),
            header = {
                item(key = "identity", span = StaggeredGridItemSpan.FullLine) {
                    BrandProfileIdentity(model, brand, gridState, Modifier.brandsBleed(Spacing.gridGap))
                }
                item(key = "sections", span = StaggeredGridItemSpan.FullLine) {
                    Column(
                        Modifier.adaptiveContentWidth().padding(horizontal = InnerGutter).padding(top = Spacing.xs, bottom = Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(Spacing.l),
                    ) {
                        val announcement = model.storefront?.storefront?.config?.announcement
                        if (announcement != null && announcement.text.isNotEmpty()) {
                            BrandAnnouncementRow(announcement)
                        }
                        SegmentedPill(
                            selection = tab,
                            options = BrandProfileTab.entries,
                            onSelect = { tab = it },
                        ) { it.title }
                    }
                }
                if (tab == BrandProfileTab.Products && model.products.isEmpty()) {
                    item(key = "products-state", span = StaggeredGridItemSpan.FullLine) {
                        BrandProductsState(model, brand)
                    }
                }
            },
            footer = {
                when (tab) {
                    BrandProfileTab.Products -> if (model.productsLoadingMore) {
                        item(key = "more", span = StaggeredGridItemSpan.FullLine) {
                            Box(Modifier.fillMaxWidth().padding(vertical = Spacing.l), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                            }
                        }
                    }
                    BrandProfileTab.Collections -> collectionsSection(model, brand, isWide, onOpen = { router.push(it) })
                    BrandProfileTab.Drops -> dropsSection(model, brand, onOpen = { router.push(it) })
                }
            },
            onLoadMore = if (tab == BrandProfileTab.Products) ({ model.loadMoreProducts() }) else null,
        ) { product ->
            ProductTile(
                product,
                Modifier.pressableClick { router.push(Route.Product(product.slug)) },
                showsBrand = false,
            )
        }
    }
}

@Composable
private fun BrandProductsState(model: BrandProfileModel, brand: StorefrontBrand) {
    val error = model.productsError
    when {
        model.productsLoading -> MasonrySkeleton(count = 6)
        error != null -> EmptyState.Error(message = error, modifier = Modifier.heightIn(min = 240.dp)) {
            model.loadProducts(brand.id)
        }
        else -> EmptyState(
            title = if (brand.forSale) "No pieces yet" else "Opening soon",
            modifier = Modifier.heightIn(min = 240.dp),
            message = if (brand.forSale) "${brand.name} hasn't listed anything yet. Follow to hear when they do."
            else "${brand.name} is setting up. Follow to hear the day they open.",
            icon = Icons.Outlined.Checkroom,
        )
    }
}

private fun androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope.collectionsSection(
    model: BrandProfileModel,
    brand: StorefrontBrand,
    isWide: Boolean,
    onOpen: (Route) -> Unit,
) {
    val collections = model.collections
    if (collections.isEmpty()) {
        item(key = "collections-empty", span = StaggeredGridItemSpan.FullLine) {
            EmptyState(
                title = "No collections yet",
                modifier = Modifier.heightIn(min = 240.dp),
                message = "${brand.name} hasn't published a collection.",
                icon = Icons.Outlined.ViewAgenda,
            )
        }
        return
    }
    val fallback = model.heroUrl
    // Phones: one full-width card per row. Medium+: one card per grid lane (3–4 across) instead of
    // 16:10 cards stretched to the window width.
    collections.forEach { collection ->
        item(
            key = "collection-${collection.id}",
            span = if (isWide) StaggeredGridItemSpan.SingleLane else StaggeredGridItemSpan.FullLine,
        ) {
            BrandCollectionCard(
                collection,
                fallbackUrl = fallback,
                modifier = Modifier
                    .padding(horizontal = if (isWide) 0.dp else InnerGutter)
                    .padding(bottom = Spacing.l)
                    .pressableClick { onOpen(Route.Collection(brand = brand.handle, handle = collection.handle)) },
            )
        }
    }
}

private fun androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope.dropsSection(
    model: BrandProfileModel,
    brand: StorefrontBrand,
    onOpen: (Route) -> Unit,
) {
    val drops = model.visibleDrops
    val error = model.dropsError
    when {
        model.dropsLoading && drops.isEmpty() -> item(key = "drops-loading", span = StaggeredGridItemSpan.FullLine) {
            Column(Modifier.adaptiveContentWidth().padding(horizontal = InnerGutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                repeat(3) { Skeleton(Modifier.fillMaxWidth().height(96.dp), cornerRadius = Radius.card) }
            }
        }
        error != null && drops.isEmpty() -> item(key = "drops-error", span = StaggeredGridItemSpan.FullLine) {
            EmptyState.Error(message = error, modifier = Modifier.heightIn(min = 240.dp)) { model.loadDrops(brand.id) }
        }
        drops.isEmpty() -> item(key = "drops-empty", span = StaggeredGridItemSpan.FullLine) {
            EmptyState(
                title = "No drops yet",
                modifier = Modifier.heightIn(min = 240.dp),
                message = "Follow ${brand.name} to hear about their next drop.",
                icon = Icons.Outlined.LocalFireDepartment,
            )
        }
        else -> drops.forEach { drop ->
            item(key = "drop-${drop.id}", span = StaggeredGridItemSpan.FullLine) {
                BrandDropRow(
                    drop,
                    Modifier
                        .adaptiveContentWidth()
                        .padding(horizontal = InnerGutter)
                        .padding(bottom = Spacing.m)
                        .pressableClick { onOpen(Route.Drop(id = drop.slug.ifEmpty { drop.id })) },
                )
            }
        }
    }
}

// endregion

// region Identity block (on the photo)

@Composable
private fun BrandProfileIdentity(
    model: BrandProfileModel,
    brand: StorefrontBrand,
    gridState: LazyStaggeredGridState,
    modifier: Modifier = Modifier,
) {
    val c = Color.yard
    val heroHeight = brandHeroHeight()
    Box(modifier.fillMaxWidth()) {
        BrandHeroBackdrop(
            url = model.heroUrl,
            heroHeight = heroHeight,
            scrollOffset = { if (gridState.firstVisibleItemIndex == 0) gridState.firstVisibleItemScrollOffset.toFloat() else 0f },
            modifier = Modifier.matchParentSize(),
        )
        // The photo stays full-bleed; the brand info is capped to the reading width on Medium+.
        Column(
            Modifier
                .align(Alignment.TopCenter)
                .adaptiveContentWidth()
                .padding(top = heroHeight - 150.dp, bottom = 64.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            Column(
                Modifier.padding(horizontal = Spacing.gutter),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val size = when {
                        brand.name.length > 18 -> 40.sp
                        brand.name.length > 11 -> 48.sp
                        else -> 58.sp
                    }
                    Text(
                        brand.name.uppercase(),
                        style = YardFonts.display(size).copy(
                            shadow = Shadow(c.scrim.copy(alpha = 0.35f), Offset(0f, 4f), blurRadius = 24f),
                        ),
                        color = c.onPhoto,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (brand.verified) {
                        Icon(
                            Icons.Filled.Verified,
                            contentDescription = "Verified brand",
                            tint = c.onPhoto,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
                Text("@${brand.handle}", style = YardFonts.callout, color = c.onPhoto.copy(alpha = 0.72f))
                BrandMetaLine(brand, Modifier.padding(top = Spacing.xxs))
            }

            BrandProfileActions(model, brand, Modifier.padding(horizontal = Spacing.gutter))
            BrandProfileStats(model, Modifier.padding(horizontal = Spacing.gutter))
            if (!brand.forSale) {
                BrandOpeningSoon(model, brand, Modifier.padding(horizontal = Spacing.gutter))
            }
            model.story?.let { BrandStoryCard(it, Modifier.padding(horizontal = Spacing.gutter)) }
        }
    }
}

@Composable
private fun BrandMetaLine(brand: StorefrontBrand, modifier: Modifier = Modifier) {
    val place = BrandsPlace.text(brand.city, brand.country)
    val category = BrandsCategory.firstName(brand.categories)
    val tint = Color.yard.onPhoto.copy(alpha = 0.8f)
    if (!brand.foundingBadge && place.isEmpty() && category == null) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        if (brand.foundingBadge) BrandsFoundingBadge(onPhoto = true)
        if (place.isNotEmpty()) BrandsCompactLabel(place, Icons.Outlined.Place, tint, Modifier.weight(1f, fill = false))
        if (category != null) BrandsCompactLabel(category, Icons.Outlined.LocalOffer, tint)
    }
}

/** Icon + text tight together (meta line on the photo). */
@Composable
private fun BrandsCompactLabel(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(13.dp))
        Text(text, style = YardFonts.caption, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Follow with the sign-in gate; applies the server's new follower count; haptic on success. */
@Composable
private fun rememberBrandFollowAction(model: BrandProfileModel, brand: StorefrontBrand, busy: Boolean, setBusy: (Boolean) -> Unit): () -> Unit {
    val session = LocalSessionStore.current
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    return {
        if (!busy) {
            setBusy(true)
            scope.launch {
                try {
                    val result = BrandsFollow.toggle(brand.id, brand.name, session, follows, router, toast)
                    if (result != null) {
                        model.apply(result)
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    }
                } finally {
                    setBusy(false)
                }
            }
        }
    }
}

@Composable
private fun BrandProfileActions(model: BrandProfileModel, brand: StorefrontBrand, modifier: Modifier = Modifier) {
    val c = Color.yard
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val following = LocalFollowStore.current.isFollowing(brand.id)
    var busy by remember { mutableStateOf(false) }
    val toggle = rememberBrandFollowAction(model, brand, busy) { busy = it }
    val fill by animateColorAsState(if (following) c.onPhoto.copy(alpha = 0.16f) else c.onPhoto, Motion.spring(), label = "follow-fill")
    val stroke by animateFloatAsState(if (following) 0.4f else 0f, Motion.spring(), label = "follow-stroke")
    val fg = if (following) c.onPhoto else c.onPhotoInk

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .weight(1f)
                .height(54.dp)
                .clip(YardShapes.pill)
                .background(fill, YardShapes.pill)
                .border(BorderStroke(1.dp, c.onPhoto.copy(alpha = stroke)), YardShapes.pill)
                .semantics {
                    contentDescription = if (following) "Following ${brand.name}. Double-tap to unfollow." else "Follow ${brand.name}"
                }
                .pressableClick(enabled = !busy, onClick = toggle),
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                if (busy) {
                    CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else if (following) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
                }
                Text(if (following) "Following" else "Follow", style = YardFonts.bodyEmphasis, color = fg)
            }
        }

        Box(
            Modifier
                .size(54.dp)
                .clip(CircleShape)
                .background(c.onPhoto.copy(alpha = 0.12f), CircleShape)
                .border(BorderStroke(1.dp, c.onPhoto.copy(alpha = 0.35f)), CircleShape)
                .semantics { contentDescription = "Message ${brand.name}" }
                .pressableClick {
                    if (!session.isSignedIn) router.present(Route.SignIn) else router.push(Route.MessageBrand(brandId = brand.id))
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null, tint = c.onPhoto, modifier = Modifier.size(22.dp))
        }
    }
}

private data class BrandStat(val id: String, val value: Int, val label: String)

@Composable
private fun BrandProfileStats(model: BrandProfileModel, modifier: Modifier = Modifier) {
    val items = buildList {
        model.followers?.let { add(BrandStat("followers", it, if (it == 1) "Follower" else "Followers")) }
        model.productsTotal?.let { add(BrandStat("products", it, if (it == 1) "Product" else "Products")) }
        model.dropsCount?.let { if (it > 0) add(BrandStat("drops", it, if (it == 1) "Drop" else "Drops")) }
    }
    if (items.isEmpty()) return
    val c = Color.yard
    Row(modifier.fillMaxWidth().padding(vertical = Spacing.xs).animateContentSize(Motion.spring())) {
        items.forEach { item ->
            Column(
                Modifier
                    .weight(1f)
                    .clearAndSetSemantics { contentDescription = "${item.label}, ${Formatters.grouped(item.value)}" },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                AnimatedContent(
                    targetState = item.value,
                    transitionSpec = { fadeIn(Motion.fade()) togetherWith fadeOut(Motion.fade()) },
                    label = "stat-${item.id}",
                ) { value ->
                    Text(Formatters.count(value), style = YardFonts.number(28.sp), color = c.onPhoto)
                }
                Text(item.label, style = YardFonts.caption, color = c.onPhoto.copy(alpha = 0.68f))
            }
        }
    }
}

@Composable
private fun BrandOpeningSoon(model: BrandProfileModel, brand: StorefrontBrand, modifier: Modifier = Modifier) {
    val c = Color.yard
    val following = LocalFollowStore.current.isFollowing(brand.id)
    var busy by remember { mutableStateOf(false) }
    val toggle = rememberBrandFollowAction(model, brand, busy) { busy = it }
    Row(
        modifier
            .fillMaxWidth()
            .background(c.onPhoto.copy(alpha = 0.1f), YardShapes.card)
            .border(BorderStroke(1.dp, c.onPhoto.copy(alpha = 0.18f)), YardShapes.card)
            .padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).background(c.acid, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.NotificationsActive, contentDescription = null, tint = c.onAcid, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Opening soon on Yard", style = YardFonts.bodyEmphasis, color = c.onPhoto)
            Text(
                if (following) "You'll hear the day they open." else "Pieces aren't for sale yet. Get notified the day they open.",
                style = YardFonts.caption,
                color = c.onPhoto.copy(alpha = 0.72f),
            )
        }
        if (!following) {
            Box(
                Modifier
                    .minimumInteractiveComponentSize()
                    .height(34.dp)
                    .clip(YardShapes.pill)
                    .background(c.acid, YardShapes.pill)
                    .pressableClick(enabled = !busy, onClick = toggle)
                    .padding(horizontal = Spacing.m),
                contentAlignment = Alignment.Center,
            ) {
                Text("Notify me", style = YardFonts.captionEmphasis, color = c.onAcid)
            }
        }
    }
}

// endregion

// region Hero backdrop

/**
 * The sharp cover on top (parallax when scrolled), fading into a blurred copy of itself that
 * fills the identity block, then into the page background.
 */
@Composable
fun BrandHeroBackdrop(url: String?, heroHeight: Dp, scrollOffset: () -> Float, modifier: Modifier = Modifier) {
    val c = Color.yard
    Box(modifier.clipToBounds().clearAndSetSemantics { }) {
        // Blurred fill behind the whole identity block. A tiny decode keeps it soft on API < 31,
        // where Modifier.blur does nothing.
        if (url != null) {
            Box(Modifier.matchParentSize().background(c.scrim)) {
                RemoteImage(
                    url,
                    Modifier
                        .matchParentSize()
                        .graphicsLayer { scaleX = 1.4f; scaleY = 1.4f }
                        .blur(48.dp),
                    maxPixelSize = 48,
                    placeholder = {},
                )
                Box(Modifier.matchParentSize().background(c.scrim.copy(alpha = 0.38f)))
            }
        } else {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(c.purple, c.scrim.copy(alpha = 0.92f)))))
        }

        // Sharp hero with parallax, masked to fade out at the bottom.
        if (url != null) {
            RemoteImage(
                url,
                Modifier
                    .fillMaxWidth()
                    .height(heroHeight)
                    .graphicsLayer {
                        translationY = scrollOffset() * 0.35f
                        compositingStrategy = CompositingStrategy.Offscreen
                    }
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            Brush.verticalGradient(0f to c.scrim, 0.55f to c.scrim, 1f to c.scrim.copy(alpha = 0f)),
                            blendMode = BlendMode.DstIn,
                        )
                    },
                maxPixelSize = 1600,
                placeholder = {},
            )
        }

        // Top scrim so the glass buttons and status bar read on bright photos.
        Box(
            Modifier
                .fillMaxWidth()
                .height(140.dp)
                .background(Brush.verticalGradient(listOf(c.scrim.copy(alpha = 0.35f), c.scrim.copy(alpha = 0f)))),
        )

        // Fade into the page background (light or dark).
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(56.dp)
                .background(Brush.verticalGradient(listOf(c.bg.copy(alpha = 0f), c.bg))),
        )
    }
}

// endregion

// region Story / announcement / collection / drop

/** The brand's story in a frosted card on the photo; long stories expand on tap. */
@Composable
fun BrandStoryCard(text: String, modifier: Modifier = Modifier) {
    val c = Color.yard
    var expanded by rememberSaveable { mutableStateOf(false) }
    val isLong = text.length > 180
    Column(
        modifier
            .fillMaxWidth()
            .background(c.onPhoto.copy(alpha = 0.1f), YardShapes.card)
            .border(BorderStroke(1.dp, c.onPhoto.copy(alpha = 0.18f)), YardShapes.card)
            .padding(Spacing.l)
            .animateContentSize(Motion.spring()),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text,
            style = YardFonts.callout,
            color = c.onPhoto,
            maxLines = if (expanded) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
        )
        if (isLong) {
            Text(
                if (expanded) "Show less" else "Read more",
                style = YardFonts.captionEmphasis,
                color = c.onPhoto.copy(alpha = 0.75f),
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .clickable { expanded = !expanded },
            )
        }
    }
}

@Composable
private fun BrandAnnouncementRow(announcement: StorefrontConfig.Announcement) {
    val router = LocalRouter.current
    val context = LocalContext.current
    val isDark = Color.yard.isDark
    val href = announcement.href?.takeIf { it.isNotEmpty() }
    Row(
        Modifier
            .fillMaxWidth()
            .yardCard(background = Color.yard.surface)
            .pressableClick(enabled = href != null) {
                if (href == null) return@pressableClick
                val route = Route.fromPath(href)
                if (route != null) {
                    router.push(route)
                } else {
                    val url = Config.url(href) ?: return@pressableClick
                    if (!router.open(url)) WebPages.open(context, url, darkTheme = isDark)
                }
            }
            .padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Campaign, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(20.dp))
        Text(announcement.text, style = YardFonts.callout, color = Color.yard.ink, modifier = Modifier.weight(1f))
        if (href != null) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
fun BrandCollectionCard(collection: StorefrontCollection, fallbackUrl: String?, modifier: Modifier = Modifier) {
    val c = Color.yard
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 10f)
                .clip(YardShapes.image)
                .background(c.surface2),
        ) {
            val url = collection.imageUrl ?: fallbackUrl
            if (url != null) RemoteImage(url, Modifier.matchParentSize(), maxPixelSize = 1000)
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(c.scrim.copy(alpha = 0f), c.scrim.copy(alpha = 0.6f))))
                    .padding(Spacing.l),
            ) {
                Text(
                    collection.name.uppercase(),
                    style = YardFonts.display(30.sp),
                    color = c.onPhoto,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Row(Modifier.padding(horizontal = Spacing.xxs), verticalAlignment = Alignment.Top) {
            if (collection.description.isNotEmpty()) {
                Text(
                    collection.description,
                    style = YardFonts.caption,
                    color = c.ink2,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.width(Spacing.s))
            val count = collection.productIds.size
            Text("$count ${if (count == 1) "piece" else "pieces"}", style = YardFonts.captionEmphasis, color = c.ink3)
        }
    }
}

@Composable
fun BrandDropRow(drop: Drop, modifier: Modifier = Modifier) {
    val c = Color.yard
    val statusText = when {
        drop.isLive -> drop.endDate?.let { "Live now · ends ${Formatters.future(it)}" } ?: "Live now"
        drop.isEnded -> if (drop.phase == "cancelled") "Cancelled" else "Ended"
        else -> drop.startDate?.let { "Starts ${Formatters.future(it)}" } ?: "Upcoming"
    }
    Row(
        modifier
            .fillMaxWidth()
            .alpha(if (drop.isEnded) 0.7f else 1f)
            .yardCard(background = c.surface)
            .padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(Radius.small)).background(c.surface2),
            contentAlignment = Alignment.Center,
        ) {
            val image = drop.imageUrl
            if (image != null) {
                RemoteImage(image, Modifier.matchParentSize(), maxPixelSize = 300)
            } else {
                Icon(Icons.Filled.LocalFireDepartment, contentDescription = null, tint = c.ink3)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (drop.isLive) Tag("Live", style = TagStyle.Acid)
                Tag(drop.accessLabel, style = TagStyle.Neutral)
            }
            Text(drop.name, style = YardFonts.bodyEmphasis, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(statusText, style = YardFonts.caption, color = if (drop.isLive) c.success else c.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = c.ink3, modifier = Modifier.size(18.dp))
    }
}

// endregion

// region Loading

@Composable
private fun BrandProfileLoading() {
    Column(
        Modifier.fillMaxSize().semantics { contentDescription = "Loading brand" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Skeleton(Modifier.fillMaxWidth().height(brandHeroHeight()), cornerRadius = 0.dp)
        Skeleton(Modifier.width(220.dp).height(40.dp), cornerRadius = 8.dp)
        Skeleton(Modifier.width(120.dp).height(16.dp), cornerRadius = 6.dp)
        Skeleton(Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter).height(54.dp), shape = SkeletonShape.Capsule)
        Skeleton(Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter).height(80.dp), cornerRadius = Radius.card)
    }
}

// endregion

// region Previews

private fun brandProfilePreviewModel(): BrandProfileModel {
    val brand = StorefrontBrand(
        id = "brd_preview", handle = "acme", name = "Acme Studio", city = "Lagos", country = "NG",
        categories = listOf("streetwear"), verified = true, foundingBadge = true, forSale = true,
    )
    val version = StorefrontVersion(version = 1, publishedAt = "2026-01-01T00:00:00Z", config = StorefrontConfig(intro = "Heavyweight basics cut in Lagos."))
    val storefront = PublicStorefront(
        brand = brand,
        storefront = version,
        collections = listOf(StorefrontCollection(id = "c1", handle = "core", name = "Core", description = "The pieces we always make.", productIds = listOf("p1", "p2"))),
    )
    return BrandProfileModel.preview(storefront, story = "Heavyweight basics cut and sewn in Lagos, in small runs.", products = PreviewFixtures.products, followers = 1240)
}

@Preview(name = "BrandProfileView — dark", heightDp = 1100)
@Composable
private fun BrandProfileDark() = YardPreview(darkTheme = true) { BrandProfileContent(remember { brandProfilePreviewModel() }) }

@Preview(name = "BrandProfileView — light", heightDp = 1100)
@Composable
private fun BrandProfileLight() = YardPreview(darkTheme = false) { BrandProfileContent(remember { brandProfilePreviewModel() }) }

@YardTabletPreviews
@Composable
private fun BrandProfileTablet() = YardPreview(darkTheme = true) { BrandProfileContent(remember { brandProfilePreviewModel() }) }

@YardTabletPreviews
@Composable
private fun BrandProfileTabletLight() = YardPreview(darkTheme = false) { BrandProfileContent(remember { brandProfilePreviewModel() }) }

@Preview(name = "BrandDropRow + collection — dark")
@Composable
private fun BrandCardsDark() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        BrandDropRow(Drop(id = "d1", name = "Summer capsule", phase = "live", access = "draw"))
        BrandCollectionCard(StorefrontCollection(id = "c1", name = "Core", description = "The pieces we always make.", productIds = listOf("p1")), fallbackUrl = null)
    }
}

// endregion
