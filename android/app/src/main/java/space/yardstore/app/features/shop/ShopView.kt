package space.yardstore.app.features.shop

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.FilterListOff
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Product
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.yardScreenBackground

// The shop listing (website: /shop, and /categories/{slug} when `category` is set).
// A product masonry under a sticky filter bar: category chips (whole shop only), subcategory
// chips, an "In stock" toggle and a sort menu (Newest / Price low–high / Price high–low).
// Infinite paging through GET /api/catalog/products (limit 24 + offset).
// Mirrors ios/Yard/Features/Shop/ShopView.swift.

@Composable
fun ShopView(category: String?) {
    val model: ShopListingModel = viewModel { ShopListingModel(category) }
    ShopScreen(model)
}

/** The screen for a given model (previews pass a fixed one). */
@Composable
internal fun ShopScreen(model: ShopListingModel) {
    val router = LocalRouter.current
    LaunchedEffect(model) { model.start() }

    val gridState = rememberLazyStaggeredGridState()
    // The filter bar is grid item 1 (after the header): once it reaches the top it pins.
    val pinned by remember { derivedStateOf { gridState.firstVisibleItemIndex >= 1 } }
    val dim by animateFloatAsState(if (model.isRefreshing) 0.45f else 1f, Motion.fade(), label = "shop-dim")
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxl

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(model.categoryName ?: "Shop")
        ShopRefreshBox(
            isRefreshing = model.isPullRefreshing,
            onRefresh = { model.refresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            MasonryGrid(
                products = if (model.isLoaded) model.products else emptyList(),
                modifier = Modifier.fillMaxSize(),
                state = gridState,
                contentPadding = PaddingValues(start = Spacing.gridGap, end = Spacing.gridGap, bottom = bottom),
                header = {
                    fullLine("shop-header") {
                        ShopHeader(model, Modifier.padding(bottom = Spacing.l))
                    }
                    fullLine("shop-filters") { ShopFilterBar(model) }
                    shopResultsState(model)
                },
                footer = {
                    if (model.isLoaded && model.products.isNotEmpty()) {
                        fullLine("shop-footer") { ShopFooter(model, Modifier.padding(top = Spacing.l)) }
                    }
                },
                onLoadMore = { model.loadMore() },
            ) { product ->
                ProductTile(
                    product,
                    Modifier
                        .graphicsLayer { alpha = dim }
                        .pressableClick { router.push(Route.Product(product.slug)) },
                )
            }
            if (pinned) {
                ShopFilterBar(model, Modifier.align(Alignment.TopCenter))
            }
        }
    }
}

/** A full-width grid item on the screen gutters (it bleeds over the grid's 6dp padding). */
private fun LazyStaggeredGridScope.fullLine(key: String, content: @Composable () -> Unit) {
    item(key = key, span = StaggeredGridItemSpan.FullLine) {
        Box(Modifier.shopBleed(Spacing.gridGap)) { content() }
    }
}

/** Loading / error / empty, below the filter bar (the tiles themselves are the grid's items). */
private fun LazyStaggeredGridScope.shopResultsState(model: ShopListingModel) {
    when (val phase = model.phase) {
        ShopListingModel.Phase.Loading -> item(key = "shop-loading", span = StaggeredGridItemSpan.FullLine) {
            MasonrySkeleton(Modifier.padding(top = Spacing.m), count = 8)
        }
        is ShopListingModel.Phase.Failed -> fullLine("shop-error") {
            EmptyState.Error(phase.error, Modifier.padding(top = Spacing.m).heightIn(min = 360.dp)) { model.reload() }
        }
        ShopListingModel.Phase.Loaded -> if (model.products.isEmpty()) {
            fullLine("shop-empty") { ShopEmptyState(model, Modifier.padding(top = Spacing.m).heightIn(min = 360.dp)) }
        } else {
            item(key = "shop-gap", span = StaggeredGridItemSpan.FullLine) { Spacer(Modifier.height(Spacing.m - Spacing.gridGap)) }
        }
    }
}

// MARK: Header

@Composable
private fun ShopHeader(model: ShopListingModel, modifier: Modifier = Modifier) {
    if (model.fixedCategory != null) {
        ShopCategoryBanner(model, modifier)
    } else {
        Column(
            modifier.fillMaxWidth().padding(horizontal = Spacing.gutter).padding(top = Spacing.s),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            ShopDisplayText("Shop", 52.sp)
            Text(
                "Explore published pieces from independent brands across Yard.",
                style = YardFonts.callout,
                color = Color.yard.ink2,
                modifier = Modifier.widthIn(max = LocalYardWindow.current.contentMaxWidth),
            )
        }
    }
}

/** The category photograph with its name and description over it (website category banner). */
@Composable
private fun ShopCategoryBanner(model: ShopListingModel, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val cat = model.selectedCategory
    Box(
        modifier
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.s)
            .fillMaxWidth()
            .height(280.dp)
            .clip(YardShapes.card)
            .background(Color.yard.surface2),
        contentAlignment = Alignment.BottomStart,
    ) {
        if (cat?.imageUrl != null) {
            RemoteImage(cat.imageUrl, Modifier.fillMaxSize(), maxPixelSize = 1200)
        }
        val scrim = Color.yard.scrim
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(scrim.copy(alpha = 0f), scrim.copy(alpha = 0.2f), scrim.copy(alpha = 0.75f))),
            ),
        )
        // The text stays at reading width on wide windows; the photo keeps the full width.
        Column(
            Modifier.padding(Spacing.l).widthIn(max = LocalYardWindow.current.contentMaxWidth),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .pressableClick { router.push(Route.Categories) },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = null,
                    tint = Color.yard.onPhoto.copy(alpha = 0.85f),
                    modifier = Modifier.size(16.dp),
                )
                Text("All categories", style = YardFonts.captionEmphasis, color = Color.yard.onPhoto.copy(alpha = 0.85f))
            }
            ShopDisplayText(model.categoryName ?: "", 48.sp, color = Color.yard.onPhoto, maxLines = 2, minScale = 0.7f)
            val description = cat?.description
            if (!description.isNullOrEmpty()) {
                Text(description, style = YardFonts.callout, color = Color.yard.onPhoto.copy(alpha = 0.85f), maxLines = 3)
            }
        }
    }
}

// MARK: Results

@Composable
private fun ShopFooter(model: ShopListingModel, modifier: Modifier = Modifier) {
    val loadMoreError = model.loadMoreError
    when {
        loadMoreError != null -> Column(
            modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Text(loadMoreError, style = YardFonts.caption, color = Color.yard.ink2, textAlign = TextAlign.Center)
            YardButton("Try again", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false) { model.loadMore() }
        }
        model.hasMore -> Box(modifier.fillMaxWidth().padding(vertical = Spacing.m), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            // Same as the iOS spinner's onAppear: reaching the footer asks for the next page.
            LaunchedEffect(model.products.size) { model.loadMore() }
        }
        else -> Text(
            if (model.total > 1) "That's all ${Formatters.grouped(model.total)} pieces" else "That's the only piece",
            style = YardFonts.caption.monospacedDigits(),
            color = Color.yard.ink3,
            textAlign = TextAlign.Center,
            modifier = modifier.fillMaxWidth().padding(vertical = Spacing.m),
        )
    }
}

/** Website `emptyAdvice`: an empty shelf (nothing filtered) vs. filters that hide everything. */
@Composable
private fun ShopEmptyState(model: ShopListingModel, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    if (model.panelFilterCount > 0) {
        EmptyState(
            title = "Nothing matches those filters",
            modifier = modifier,
            message = "Try removing one filter.",
            icon = Icons.Outlined.FilterListOff,
            actionTitle = "Clear filters",
        ) { model.clearFilters() }
    } else {
        val shelf = model.subcategory ?: model.categoryName
        Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            EmptyState(
                title = shelf?.let { "No ${it.lowercase()} pieces yet" } ?: "No pieces yet",
                message = "Brands are joining Yard. Their pieces appear here the day they open; follow along with upcoming drops.",
                icon = Icons.Outlined.Storefront,
                actionTitle = "See upcoming drops",
            ) { router.push(Route.Drops) }
            YardButton("Browse brands", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false) {
                router.push(Route.BrandsDirectory)
            }
        }
    }
}

// MARK: - Sticky filter bar

/**
 * Pinned under the top bar: category chips (whole shop), subcategory chips,
 * then the piece count, the "In stock" toggle and the sort menu.
 */
@Composable
internal fun ShopFilterBar(model: ShopListingModel, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val line = Color.yard.line
    Column(
        modifier
            .fillMaxWidth()
            .background(Color.yard.bg)
            .drawBehind {
                val stroke = 1.dp.toPx()
                drawLine(line, Offset(0f, size.height - stroke / 2), Offset(size.width, size.height - stroke / 2), stroke)
            }
            .padding(vertical = Spacing.s)
            .animateContentSize(Motion.snappy()),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        if (model.fixedCategory == null && model.categories.isNotEmpty()) {
            ChipRow {
                Chip("All", isSelected = model.category == null) { model.selectCategory(null) }
                model.categories.forEach { cat ->
                    Chip(cat.name, isSelected = model.category == cat.slug) { model.selectCategory(cat.slug) }
                }
            }
        }
        val subcategories = model.subcategories
        if (subcategories.isNotEmpty()) {
            ChipRow {
                val allTitle = if (model.fixedCategory == null) "All" else "All ${(model.categoryName ?: "").lowercase()}"
                Chip(allTitle, isSelected = model.subcategory == null) { model.selectSubcategory(null) }
                subcategories.forEach { sub ->
                    Chip(sub, isSelected = model.subcategory == sub) { model.selectSubcategory(sub) }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            if (model.isLoaded) {
                Text(
                    ShopText.pieces(model.total),
                    style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold).monospacedDigits(),
                    color = Color.yard.ink,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Text("Loading…", style = YardFonts.callout, color = Color.yard.ink3, maxLines = 1, modifier = Modifier.weight(1f))
            }
            Chip("In stock", icon = if (model.inStock) Icons.Filled.Check else null, isSelected = model.inStock) {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                model.setInStock(!model.inStock)
            }
            ShopSortMenu(
                selection = model.sort,
                options = ShopSort.entries,
                title = { it.title },
                accessibilityPrefix = "Sort",
                onSelect = { model.setSort(it) },
            )
        }
    }
}

// MARK: - Previews

private val shopPreviewCategories = listOf(
    ShopCategory(slug = "fashion", name = "Fashion", description = "Tailoring, dresses and knitwear from independent designers.", subcategories = listOf("Outerwear", "Shirts", "Knitwear"), productCount = 42, brandCount = 9),
    ShopCategory(slug = "streetwear", name = "Streetwear", subcategories = listOf("Hoodies", "T-shirts"), productCount = 18, brandCount = 4),
    ShopCategory(slug = "sneakers", name = "Sneakers", productCount = 0, brandCount = 0),
)

@Composable
private fun ShopPreviewScreen(category: String?, products: List<Product> = PreviewFixtures.products) {
    val model = remember { ShopListingModel.preview(category, shopPreviewCategories, products) }
    ShopScreen(model)
}

@Preview(name = "ShopView — dark", heightDp = 900)
@Composable
private fun ShopViewDarkPreview() = YardPreview(darkTheme = true) { ShopPreviewScreen(null) }

@Preview(name = "ShopView — light", heightDp = 900)
@Composable
private fun ShopViewLightPreview() = YardPreview(darkTheme = false) { ShopPreviewScreen(null) }

@Preview(name = "ShopView category — dark", heightDp = 900)
@Composable
private fun ShopViewCategoryDarkPreview() = YardPreview(darkTheme = true) { ShopPreviewScreen("fashion") }

@Preview(name = "ShopView empty — light", heightDp = 900)
@Composable
private fun ShopViewEmptyLightPreview() = YardPreview(darkTheme = false) { ShopPreviewScreen("sneakers", emptyList()) }

@YardTabletPreviews
@Composable
private fun ShopViewTabletPreview() = YardPreview(darkTheme = true) { ShopPreviewScreen(null) }

@YardTabletPreviews
@Composable
private fun ShopViewCategoryTabletPreview() = YardPreview(darkTheme = false) { ShopPreviewScreen("fashion") }
