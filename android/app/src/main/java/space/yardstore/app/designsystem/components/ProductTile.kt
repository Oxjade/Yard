package space.yardstore.app.designsystem.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/** Shared ProductTile constants (iOS `ProductTile.captionHeight` / `clampedAspect`). */
object ProductTileDefaults {
    /** Caption height used by `MasonryColumns` for balancing. */
    val captionHeight = 56.dp

    /** Tile aspects are kept between 9:16 and 5:4 so no tile is absurdly tall or flat. */
    fun clampedAspect(ratio: Double): Float = ratio.coerceIn(0.5625, 1.25).toFloat()
}

/**
 * A product tile for masonry grids: image (natural aspect, 16dp corners), title, brand, price,
 * a "Sold out"/"New" tag and an optional save heart (Saved store; signed-out taps open Sign in).
 * Mirrors `ProductTile.swift`.
 *
 * The tile does not navigate by itself; make it tappable from outside:
 *   ProductTile(product, Modifier.pressableClick { router.push(Route.Product(product.slug)) })
 *
 * Needs the stores, router and toasts in composition (the root provides them; previews use `YardPreview`).
 */
@Composable
fun ProductTile(
    product: Product,
    modifier: Modifier = Modifier,
    showsBrand: Boolean = true,
    showsPrice: Boolean = true,
    showsSaveButton: Boolean = true,
    /** Decoded image size cap (pixels). */
    maxPixelSize: Int = 700,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box {
            RemoteImage(
                product.coverUrl,
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ProductTileDefaults.clampedAspect(product.tileAspectRatio))
                    .clip(YardShapes.image),
                maxPixelSize = maxPixelSize,
                contentDescription = product.title,
            )
            Box(Modifier.align(Alignment.TopStart).padding(Spacing.s)) { ProductTileBadge(product) }
            if (showsSaveButton) {
                Box(Modifier.align(Alignment.TopEnd).padding(6.dp)) { SaveHeart(product) }
            }
        }
        Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                product.title,
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val brand = product.brand
            if (showsBrand && brand != null) {
                Text(brand.name, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (showsPrice) PriceText(product, style = YardFonts.captionEmphasis)
        }
    }
}

@Composable
private fun ProductTileBadge(product: Product) {
    when {
        product.isNotForSale -> Tag("Opening soon", style = TagStyle.OnPhoto)
        product.isSoldOut -> Tag("Sold out", style = TagStyle.OnPhoto)
        product.compareAt != null -> Tag("Sale", style = TagStyle.Acid)
        product.isNew -> Tag("New", style = TagStyle.Acid)
    }
}

@Composable
private fun SaveHeart(product: Product) {
    val saved = LocalSavedStore.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val isSaved = saved.isSaved(product.id)
    Box(
        modifier = Modifier
            .size(30.dp)
            .background(Color.yard.surface.copy(alpha = 0.78f), CircleShape)
            .border(BorderStroke(1.dp, Color.yard.line), CircleShape)
            .semantics { contentDescription = if (isSaved) "Remove from saved" else "Save" }
            .pressableClick {
                if (!session.isSignedIn) {
                    router.present(Route.SignIn)
                    return@pressableClick
                }
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                scope.launch {
                    try {
                        saved.toggle(product.id)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        toast.show(e)
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (isSaved) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            contentDescription = null,
            tint = if (isSaved) Color.yard.danger else Color.yard.ink,
            modifier = Modifier.size(15.dp),
        )
    }
}

@Composable
private fun ProductTilePreviewContent() {
    MasonryGrid(PreviewFixtures.products, contentPadding = PaddingValues(horizontal = Spacing.gridGap)) { product ->
        ProductTile(product)
    }
}

@Preview(name = "ProductTile — dark")
@Composable
private fun ProductTileDarkPreview() = YardPreview(darkTheme = true) { ProductTilePreviewContent() }

@Preview(name = "ProductTile — light")
@Composable
private fun ProductTileLightPreview() = YardPreview(darkTheme = false) { ProductTilePreviewContent() }

/** 3 columns at 840dp, 4 at 1280dp (`LocalYardWindow.gridColumns`). */
@YardTabletPreviews
@Composable
private fun ProductTileTabletPreview() = YardPreview(darkTheme = false) { ProductTilePreviewContent() }
