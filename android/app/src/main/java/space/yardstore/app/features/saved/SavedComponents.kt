package space.yardstore.app.features.saved

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.yard

// Pieces shared by SavedView and FollowingView (saved feature only). Mirrors SavedComponents.swift.

/** Big condensed screen header with the website's "Your World" kicker. */
@Composable
fun SavedScreenHeader(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Text("Your World", style = YardFonts.captionEmphasis, color = Color.yard.violet)
        YardDisplayText(title, size = 44.sp, color = Color.yard.ink)
        Text(subtitle, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

/** Signed-out invite (the website's AccountGate invite copy). */
@Composable
fun SavedSignInInvite(
    title: String,
    message: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    bottomPadding: Dp = 0.dp,
    signIn: () -> Unit,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(top = Spacing.l, bottom = Spacing.xxl + bottomPadding),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        // A short reading block: capped and centred on tablets.
        SavedScreenHeader(title = title, subtitle = message, modifier = Modifier.adaptiveContentWidth())
        Card(Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter)) {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                Box(
                    Modifier
                        .size(56.dp)
                        .border(BorderStroke(1.dp, Color.yard.line), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(26.dp))
                }
                Text("Sign in to Yard", style = YardFonts.title, color = Color.yard.ink)
                YardButton("Sign in", icon = Icons.Outlined.AccountCircle, onClick = signIn)
            }
        }
    }
}

/**
 * Bottom sheet to pick a size/variant before moving a saved piece to the bag.
 * The caller shows it while it has a product and clears that in [onDismiss].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SavedVariantSheet(
    product: Product,
    onDismiss: () -> Unit,
    onConfirm: (ProductVariant) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var selectedId by rememberSaveable(product.id) {
        // Pre-select when exactly one size is in stock.
        val inStock = product.variants.filter { it.inStock && it.available > 0 }
        mutableStateOf(if (inStock.size == 1) inStock[0].id else null)
    }
    val selected = selectedId?.let { id -> product.variants.firstOrNull { it.id == id } }

    fun close(then: () -> Unit = {}) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            then()
        }
    }

    YardSheet(onDismissRequest = onDismiss, sheetState = sheetState, skipPartiallyExpanded = true) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = Spacing.l),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            YardSheetHeader("Choose a size", subtitle = product.title) { close() }
            SavedFlowChips(
                variants = product.variants,
                selectedId = selectedId,
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.gutter),
            ) { variant -> selectedId = variant.id }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.gutter),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                if (selected != null) {
                    PriceText(minor = selected.priceMinor, currency = product.currency, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
                }
                YardButton(
                    if (selected == null) "Pick a size" else "Move to bag",
                    modifier = Modifier.alpha(if (selected == null) 0.6f else 1f),
                    icon = Icons.Outlined.ShoppingBag,
                    style = YardButtonStyle.Primary,
                    enabled = selected != null,
                ) {
                    val variant = selected ?: return@YardButton
                    close { onConfirm(variant) }
                }
            }
        }
    }
}

/** Variant chips laid out in wrapping rows (iOS adaptive grid, min 96). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SavedFlowChips(
    variants: List<ProductVariant>,
    selectedId: String?,
    modifier: Modifier = Modifier,
    onSelect: (ProductVariant) -> Unit,
) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        variants.forEach { variant ->
            val available = variant.inStock && variant.available > 0
            Chip(
                if (variant.label.isEmpty()) variant.sku else variant.label,
                modifier = Modifier.widthIn(min = 96.dp),
                isSelected = selectedId == variant.id,
                isEnabled = available,
            ) { if (available) onSelect(variant) }
        }
    }
}

/** A drop card for the Following feed rail. */
@Composable
fun FollowingDropCard(drop: Drop, brandName: String, modifier: Modifier = Modifier) {
    val statusText = when {
        drop.isLive -> "Live now"
        drop.startDate != null -> "Starts ${Formatters.future(drop.startDate!!)}"
        else -> "Upcoming"
    }
    val subtitle = "$brandName · ${drop.accessLabel}"
    Column(
        modifier
            .width(220.dp)
            .clearAndSetSemantics { contentDescription = "${drop.name}, $statusText, $subtitle" },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Box {
            RemoteImage(
                drop.imageUrl,
                Modifier
                    .size(width = 220.dp, height = 150.dp)
                    .clip(YardShapes.image),
                maxPixelSize = 700,
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.LocalFireDepartment, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(28.dp))
                }
            }
            Tag(
                statusText,
                modifier = Modifier.padding(Spacing.s),
                style = if (drop.isLive) TagStyle.Acid else TagStyle.OnPhoto,
                icon = if (drop.isLive) Icons.Outlined.Sensors else Icons.Outlined.Schedule,
            )
        }
        Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                drop.name,
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(subtitle, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Loading placeholder for the brand avatar row. */
@Composable
fun FollowingAvatarSkeleton(modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter),
        horizontalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        repeat(5) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Skeleton(Modifier.size(64.dp), shape = SkeletonShape.Circle)
                Skeleton(Modifier.size(width = 56.dp, height = 10.dp), cornerRadius = 6.dp)
            }
        }
    }
}

/**
 * Lets a full-width item in a grid with horizontal content padding [inset] span the whole screen
 * (edge-to-edge rails, gutters measured from the screen edge like iOS).
 */
internal fun Modifier.savedFullBleed(inset: Dp): Modifier = layout { measurable, constraints ->
    val px = inset.roundToPx()
    if (!constraints.hasBoundedWidth) {
        val p = measurable.measure(constraints)
        return@layout layout(p.width, p.height) { p.place(0, 0) }
    }
    val wide = constraints.maxWidth + px * 2
    val placeable = measurable.measure(constraints.copy(minWidth = wide, maxWidth = wide))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-px, 0) }
}

// MARK: Previews

@Preview(name = "Saved components — dark")
@Composable
private fun SavedComponentsDark() = YardPreview(darkTheme = true) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl), modifier = Modifier.padding(vertical = Spacing.l)) {
        SavedScreenHeader("Wishlist", "3 saved pieces from 2 brands. Add one to your bag and it moves out of your wishlist.")
        FollowingAvatarSkeleton()
        Row(Modifier.padding(horizontal = Spacing.gutter)) {
            FollowingDropCard(
                Drop(id = "drp_preview", name = "Summer capsule", phase = "live", brand = Drop.BrandRef(id = "brd_preview", name = "Acme Studio")),
                brandName = "Acme Studio",
            )
        }
    }
}

@Preview(name = "Saved components — light")
@Composable
private fun SavedComponentsLight() = YardPreview(darkTheme = false) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        SavedSignInInvite(
            title = "Wishlist",
            message = "Sign in to save pieces from any brand and keep them in one place until you're ready.",
            icon = Icons.Outlined.FavoriteBorder,
        ) {}
    }
}

@Preview(name = "Variant chips — light")
@Composable
private fun SavedChipsLight() = YardPreview(darkTheme = false) {
    val product = PreviewFixtures.products[0].copy(
        variants = listOf(
            ProductVariant(id = "s", label = "S", available = 2),
            ProductVariant(id = "m", label = "M", available = 0, inStock = false),
            ProductVariant(id = "l", label = "L", available = 4),
        ),
    )
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Text(product.title, style = YardFonts.title, color = Color.yard.ink)
        SavedFlowChips(product.variants, selectedId = "s") {}
        Spacer(Modifier.height(Spacing.s))
    }
}
