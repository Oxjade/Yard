package space.yardstore.app.features.home

import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.YardDisplayText
import java.time.Duration
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException

// Mirrors ios/Yard/Features/Home/HomeTiles.swift.

/**
 * Press-scale tap + long press (iOS `PressableButtonStyle` + `.contextMenu`). The foundation's
 * `pressableClick` has no long press, so Home keeps its own.
 */
@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.homePressable(onLongClick: (() -> Unit)? = null, onClick: () -> Unit): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, Motion.snappy(), label = "home-press-scale")
    val alpha by animateFloatAsState(if (pressed) 0.92f else 1f, Motion.snappy(), label = "home-press-alpha")
    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
            this.alpha = alpha
        }
        .combinedClickable(
            interactionSource = interaction,
            indication = null,
            role = Role.Button,
            onLongClickLabel = if (onLongClick != null) "More actions" else null,
            onLongClick = onLongClick,
            onClick = onClick,
        )
}

// region Product tile with long-press menu

/** A product tile that pushes the product; long-press offers Save, Share and Open brand. */
@Composable
fun HomeProductTile(product: Product, modifier: Modifier = Modifier) {
    val saved = LocalSavedStore.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }

    fun toggleSave() {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        val productId = product.id
        scope.launch {
            try {
                val nowSaved = saved.toggle(productId)
                toast.show(
                    if (nowSaved) "Saved" else "Removed from saved",
                    Toast.Style.Success,
                    if (nowSaved) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    fun share() {
        val link = Config.webUrl("/products/${Config.encodePath(product.slug)}")
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, product.title)
            putExtra(Intent.EXTRA_TEXT, link)
        }
        context.startActivity(Intent.createChooser(send, null))
    }

    Box(modifier) {
        ProductTile(
            product,
            Modifier.homePressable(
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    menuOpen = true
                },
            ) { router.push(Route.Product(product.slug)) },
        )
        HomeMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
            val isSaved = saved.isSaved(product.id)
            HomeMenuItem(
                if (isSaved) "Remove from saved" else "Save",
                if (isSaved) Icons.Outlined.HeartBroken else Icons.Outlined.FavoriteBorder,
            ) {
                menuOpen = false
                toggleSave()
            }
            HomeMenuItem("Share", Icons.Outlined.Share) {
                menuOpen = false
                share()
            }
            val brand = product.brand
            if (brand != null) {
                HomeMenuItem("Open ${brand.name}", Icons.Outlined.Storefront) {
                    menuOpen = false
                    router.push(Route.Brand(brand.handle))
                }
            }
        }
    }
}

@Composable
private fun HomeMenu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = DpOffset(Spacing.s, 0.dp),
        shape = YardShapes.small,
        containerColor = Color.yard.surface,
        border = BorderStroke(1.dp, Color.yard.line),
    ) { content() }
}

@Composable
private fun HomeMenuItem(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title, style = YardFonts.callout, color = Color.yard.ink) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(20.dp)) },
        onClick = onClick,
    )
}

// endregion

// region Brand tile

/** A brand as a cover photo with its name and a Follow chip; tap opens the brand. */
@Composable
fun HomeBrandTile(brand: BrandCard, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    Box(modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f / HomeShape.brandRatio(brand.id))
                .clip(YardShapes.image)
                .background(Color.yard.surface2)
                .pressableClick(onClickLabel = "Open ${brand.name}") { router.push(Route.Brand(brand.handle)) },
        ) {
            RemoteImage(brand.coverUrl, Modifier.matchParentSize(), maxPixelSize = 700, contentDescription = brand.name)
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            0.5f to Color.yard.scrim.copy(alpha = 0f),
                            1f to Color.yard.scrim.copy(alpha = 0.7f),
                        ),
                    ),
            )
            Row(
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(Spacing.s)
                    .padding(end = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandAvatar(brand.name, logoUrl = brand.logoUrl, size = 28.dp, verified = brand.verified)
                Column {
                    Text(
                        brand.name,
                        style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                        color = Color.yard.onPhoto,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (brand.locationText.isNotEmpty()) {
                        Text(
                            brand.locationText,
                            style = YardFonts.micro,
                            color = Color.yard.onPhoto.copy(alpha = 0.8f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            Tag("Brand", Modifier.align(Alignment.TopStart).padding(Spacing.s), style = TagStyle.OnPhoto)
        }
        HomeFollowChip(brand, Modifier.align(Alignment.TopEnd))
    }
}

@Composable
private fun HomeFollowChip(brand: BrandCard, modifier: Modifier = Modifier) {
    val follows = LocalFollowStore.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val isFollowing = follows.isFollowing(brand.id)
    val fill by animateColorAsState(
        if (isFollowing) Color.yard.scrim.copy(alpha = 0.42f) else Color.yard.onPhoto,
        Motion.snappy(),
        label = "home-follow-fill",
    )
    val ink by animateColorAsState(
        if (isFollowing) Color.yard.onPhoto else Color.yard.onPhotoInk,
        Motion.snappy(),
        label = "home-follow-ink",
    )
    // The tap target (≥ 48dp, transparent) wraps the 30dp pill and its 6dp inset from the corner.
    Box(
        modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .semantics { contentDescription = if (isFollowing) "Unfollow ${brand.name}" else "Follow ${brand.name}" }
            .pressableClick {
                if (!session.isSignedIn) {
                    router.present(Route.SignIn)
                    return@pressableClick
                }
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                val id = brand.id
                scope.launch {
                    try {
                        follows.toggle(id)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        toast.show(e)
                    }
                }
            }
            .padding(6.dp),
        contentAlignment = Alignment.TopEnd,
    ) {
        Box(
            Modifier
                .height(30.dp)
                .clip(YardShapes.pill)
                .background(fill, YardShapes.pill)
                .border(BorderStroke(1.dp, if (isFollowing) Color.yard.onPhoto.copy(alpha = 0.25f) else Color.Transparent), YardShapes.pill)
                .padding(horizontal = Spacing.m),
            contentAlignment = Alignment.Center,
        ) {
            AnimatedContent(
                targetState = isFollowing,
                transitionSpec = { fadeIn(Motion.fade()) togetherWith fadeOut(Motion.fade()) },
                label = "home-follow-label",
            ) { following ->
                Text(if (following) "Following" else "Follow", style = YardFonts.captionEmphasis, color = ink)
            }
        }
    }
}

// endregion

// region Drop tile

/** A live or upcoming drop with a ticking countdown badge; tap opens the drop. */
@Composable
fun HomeDropTile(drop: Drop, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    Column(
        modifier
            .fillMaxWidth()
            .pressableClick(onClickLabel = "Open ${drop.name}") {
                router.push(Route.Drop(if (drop.slug.isEmpty()) drop.id else drop.slug))
            },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f / HomeShape.DROP_RATIO)
                .clip(YardShapes.image)
                .background(Color.yard.surface2),
            contentAlignment = Alignment.Center,
        ) {
            val imageUrl = drop.imageUrl
            if (imageUrl != null) {
                RemoteImage(imageUrl, Modifier.matchParentSize(), maxPixelSize = 700, contentDescription = drop.name)
            } else {
                YardDisplayText(
                    drop.name,
                    modifier = Modifier.padding(Spacing.m),
                    size = 28.sp,
                    color = Color.yard.ink3,
                    textAlign = TextAlign.Center,
                )
            }
            Row(
                Modifier.align(Alignment.TopStart).padding(Spacing.s),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Tag(
                    if (drop.isLive) "Live" else "Drop",
                    style = if (drop.isLive) TagStyle.Acid else TagStyle.OnPhoto,
                    icon = if (drop.isLive) Icons.Filled.Sensors else Icons.Filled.Bolt,
                )
                if (drop.sponsored) Tag("Sponsored", style = TagStyle.OnPhoto)
            }
            HomeDropCountdown(drop, Modifier.align(Alignment.BottomStart).padding(Spacing.s))
        }
        Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                drop.name,
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(drop.brand.name ?: "", drop.accessLabel).filter { it.isNotEmpty() }.joinToString(" · "),
                style = YardFonts.caption,
                color = Color.yard.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "Starts in 2d 04:12:09" / "Entries open in …" / "Ends in …", ticking every second. */
@Composable
fun HomeDropCountdown(drop: Drop, modifier: Modifier = Modifier) {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(drop.id) {
        while (true) {
            now = Instant.now()
            delay(1000L - (System.currentTimeMillis() % 1000L))
        }
    }
    val label = HomeDropCountdown.label(drop, now)
    Box(
        modifier
            .height(26.dp)
            .background(Color.yard.scrim.copy(alpha = 0.5f), YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.onPhoto.copy(alpha = 0.18f)), YardShapes.pill)
            .padding(horizontal = Spacing.s)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = YardFonts.number(12.sp), color = Color.yard.onPhoto, maxLines = 1)
    }
}

object HomeDropCountdown {
    /**
     * Same next-moment rule as the site's upcoming-drops band: a draw that isn't open yet counts
     * to entries opening, otherwise to the release; a live drop counts to its end.
     */
    fun label(drop: Drop, now: Instant): String {
        if (drop.isLive) {
            val end = drop.endDate ?: return "Live now"
            return if (end.isAfter(now)) "Ends in ${Formatters.countdown(Duration.between(now, end))}" else "Ending"
        }
        if (drop.isDraw) {
            val opens = drop.entryOpensAt?.let { YardDate.parse(it) }
            if (opens != null && opens.isAfter(now)) return "Entries open in ${Formatters.countdown(Duration.between(now, opens))}"
            val closes = drop.entryClosesAt?.let { YardDate.parse(it) }
            if (closes != null && closes.isAfter(now)) return "Entries close in ${Formatters.countdown(Duration.between(now, closes))}"
        }
        val start = drop.startDate ?: return "Coming soon"
        return if (start.isAfter(now)) "Starts in ${Formatters.countdown(Duration.between(now, start))}" else "Live now"
    }
}

// endregion

// region Founding brands row

/** "Founding brands" spotlight rail at the top of For you (GET /api/catalog/brands?founding=1). */
@Composable
fun HomeFoundingRow(brands: List<BrandCard>, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val listState = rememberLazyListState()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        SectionHeader("Founding brands", subtitle = "The first independent studios on Yard, set up with us from day one.")
        LazyRow(
            state = listState,
            flingBehavior = rememberSnapFlingBehavior(listState),
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            items(brands, key = { it.id }) { brand ->
                HomeFoundingCard(brand, Modifier.pressableClick(onClickLabel = "Open ${brand.name}") { router.push(Route.Brand(brand.handle)) })
            }
        }
    }
}

@Composable
fun HomeFoundingCard(brand: BrandCard, modifier: Modifier = Modifier) {
    Column(
        modifier
            .width(260.dp)
            .clip(YardShapes.card)
            .background(Color.yard.surface)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.card),
    ) {
        Box(Modifier.width(260.dp).height(195.dp).background(Color.yard.surface2)) {
            if (brand.coverUrl != null) {
                RemoteImage(brand.coverUrl, Modifier.matchParentSize(), maxPixelSize = 900, contentDescription = brand.name)
            }
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            0.5f to Color.yard.scrim.copy(alpha = 0f),
                            1f to Color.yard.scrim.copy(alpha = 0.55f),
                        ),
                    ),
            )
            BrandAvatar(
                brand.name,
                Modifier.align(Alignment.BottomStart).padding(Spacing.m),
                logoUrl = brand.logoUrl,
                size = 48.dp,
                verified = brand.verified,
            )
            if (!brand.forSale) {
                Tag("Opening soon", Modifier.align(Alignment.TopStart).padding(Spacing.m), style = TagStyle.OnPhoto)
            }
        }
        Column(Modifier.width(260.dp).padding(Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(brand.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                if (brand.foundingBadge) {
                    Tag("Founding brand", style = TagStyle.Violet, icon = Icons.Filled.Verified)
                }
                if (brand.locationText.isNotEmpty()) {
                    Text(brand.locationText, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

// endregion

// region Previews (fixtures are preview-only)

private val previewDrop = Drop(
    id = "drp_preview",
    slug = "drop-preview",
    brand = Drop.BrandRef(id = "brd_preview", handle = "acme", name = "Acme Studio"),
    name = "Third Mainland",
    phase = "scheduled",
    startsAt = Instant.now().plusSeconds(90_000).toString(),
    endsAt = Instant.now().plusSeconds(200_000).toString(),
)

@Composable
private fun HomeTilesPreviewContent() {
    val items: List<HomeFeedItem> = listOf(
        HomeFeedItem.ProductItem(PreviewFixtures.products[0]),
        HomeFeedItem.DropItem(previewDrop),
        HomeFeedItem.BrandItem(PreviewFixtures.brandCard),
        HomeFeedItem.ProductItem(PreviewFixtures.products[1]),
    )
    LazyVerticalStaggeredGrid(
        columns = StaggeredGridCells.Fixed(2),
        contentPadding = PaddingValues(horizontal = Spacing.gridGap),
        verticalItemSpacing = Spacing.gridGap,
        horizontalArrangement = Arrangement.spacedBy(Spacing.gridGap),
    ) {
        item(span = StaggeredGridItemSpan.FullLine) { HomeFoundingRow(listOf(PreviewFixtures.brandCard)) }
        items(items, key = { it.id }) { item ->
            when (item) {
                is HomeFeedItem.ProductItem -> HomeProductTile(item.product)
                is HomeFeedItem.BrandItem -> HomeBrandTile(item.brand)
                is HomeFeedItem.DropItem -> HomeDropTile(item.drop)
            }
        }
    }
}

@Preview(name = "Home tiles — dark")
@Composable
private fun HomeTilesDarkPreview() = YardPreview(darkTheme = true) { HomeTilesPreviewContent() }

@Preview(name = "Home tiles — light")
@Composable
private fun HomeTilesLightPreview() = YardPreview(darkTheme = false) { HomeTilesPreviewContent() }

// endregion
