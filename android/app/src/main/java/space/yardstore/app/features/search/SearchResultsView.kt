package space.yardstore.app.features.search

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.yardScreenBackground

/**
 * All results for a search: brand matches, filter chips (in stock, categories with counts),
 * a sort menu, and a two-column masonry of products that pages as you scroll.
 * Shown by `SearchView(query)` when the query isn't empty (the `Route.Search(query)` route).
 * Mirrors `SearchResultsView.swift`.
 */
@Composable
fun SearchResultsView(query: String) {
    val model: SearchResultsModel = viewModel { SearchResultsModel(query) }
    SearchResultsView(model)
}

/** Shows a prepared model (the route builds one per back-stack entry; previews pass fixtures). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchResultsView(model: SearchResultsModel) {
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val haptics = LocalHapticFeedback.current
    val currency = cart.currency

    LaunchedEffect(model.reloadKey(currency)) { model.ensureLoaded(currency) }
    LaunchedEffect(model.query) { SearchRecents.record(model.query) }

    fun selectionChanged() = haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)

    val phase = model.phase
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxl
    val refreshState = rememberPullToRefreshState()

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(model.query) {
            SearchSortMenu(model.sort) {
                selectionChanged()
                model.sort = it
            }
        }
        PullToRefreshBox(
            isRefreshing = model.isRefreshing,
            onRefresh = { model.load(currency, refreshing = true) },
            modifier = Modifier.fillMaxSize(),
            state = refreshState,
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = refreshState,
                    isRefreshing = model.isRefreshing,
                    modifier = Modifier.align(Alignment.TopCenter),
                    containerColor = Color.yard.surface,
                    color = Color.yard.ink,
                )
            },
        ) {
            MasonryGrid(
                products = if (phase == SearchResultsModel.Phase.Loaded) model.products else emptyList(),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = Spacing.gridGap, end = Spacing.gridGap, bottom = bottom),
                header = {
                    item(key = "header", span = StaggeredGridItemSpan.FullLine) {
                        SearchResultsHeader(model, Modifier.searchFullBleed(Spacing.gridGap))
                    }
                    if (model.brands.isNotEmpty()) {
                        item(key = "brands", span = StaggeredGridItemSpan.FullLine) {
                            SearchResultsBrandsRow(model.brands, Modifier.searchFullBleed(Spacing.gridGap)) { brand ->
                                router.push(Route.Brand(handle = brand.handle))
                            }
                        }
                    }
                    item(key = "filters", span = StaggeredGridItemSpan.FullLine) {
                        SearchResultsFilterChips(
                            model,
                            Modifier.searchFullBleed(Spacing.gridGap).padding(bottom = Spacing.s),
                            onChange = ::selectionChanged,
                        )
                    }
                    when (phase) {
                        SearchResultsModel.Phase.Loading -> item(key = "skeleton", span = StaggeredGridItemSpan.FullLine) {
                            MasonrySkeleton(count = 8)
                        }
                        is SearchResultsModel.Phase.Failed -> item(key = "error", span = StaggeredGridItemSpan.FullLine) {
                            EmptyState.Error(message = phase.message, modifier = Modifier.adaptiveContentWidth().padding(top = Spacing.xxl)) {
                                model.load(currency)
                            }
                        }
                        SearchResultsModel.Phase.Loaded -> if (model.products.isEmpty()) {
                            item(key = "no-results", span = StaggeredGridItemSpan.FullLine) {
                                SearchNoResults(model, Modifier.searchFullBleed(Spacing.gridGap).adaptiveContentWidth()) { router.push(it) }
                            }
                        }
                    }
                },
                footer = {
                    if (phase == SearchResultsModel.Phase.Loaded && model.products.isNotEmpty()) {
                        item(key = "footer", span = StaggeredGridItemSpan.FullLine) {
                            SearchResultsFooter(model, Modifier.padding(top = Spacing.l)) { model.loadMore(currency) }
                        }
                    }
                },
                onLoadMore = { model.loadMore(currency) },
            ) { product ->
                ProductTile(product, Modifier.pressableClick { router.push(Route.Product(slug = product.slug)) })
            }
        }
    }
}

/** Lets a full-line grid item ignore the grid's horizontal content padding (so gutters line up). */
private fun Modifier.searchFullBleed(inset: Dp): Modifier = layout { measurable, constraints ->
    val extra = (inset * 2).roundToPx()
    val width = constraints.maxWidth + extra
    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-inset.roundToPx(), 0) }
}

// region Header

@Composable
private fun SearchResultsHeader(model: SearchResultsModel, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter).padding(top = Spacing.s, bottom = Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        YardDisplayText("“${model.query}”", size = 36.sp, maxLines = 2)
        Text(searchResultsCountText(model.phase, model.total), style = YardFonts.callout, color = Color.yard.ink2)
    }
}

/** The line under the query: progress, failure or the piece count. */
fun searchResultsCountText(phase: SearchResultsModel.Phase, total: Int): String = when (phase) {
    SearchResultsModel.Phase.Loading -> "Searching the marketplace…"
    is SearchResultsModel.Phase.Failed -> "Results couldn't be loaded"
    SearchResultsModel.Phase.Loaded -> if (total == 1) "1 piece" else "${Formatters.grouped(total)} pieces"
}

// endregion

// region Brands

@Composable
private fun SearchResultsBrandsRow(brands: List<SearchBrandHit>, modifier: Modifier = Modifier, onOpen: (SearchBrandHit) -> Unit) {
    Column(modifier.fillMaxWidth().padding(bottom = Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SearchSectionLabel("Brands")
        LazyRow(
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            items(brands, key = { it.brandId }) { brand ->
                Row(
                    Modifier
                        .minimumInteractiveComponentSize()
                        .clip(YardShapes.pill)
                        .background(Color.yard.surface, YardShapes.pill)
                        .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
                        .pressableClick { onOpen(brand) }
                        .padding(start = Spacing.xs, end = Spacing.l, top = Spacing.xs, bottom = Spacing.xs),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BrandAvatar(name = brand.name, size = 32.dp)
                    Column {
                        Text(
                            brand.name,
                            style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                            color = Color.yard.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        brand.locationText?.let {
                            Text(it, style = YardFonts.micro, color = Color.yard.ink2, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

// endregion

// region Filters and sort

@Composable
private fun SearchResultsFilterChips(model: SearchResultsModel, modifier: Modifier = Modifier, onChange: () -> Unit) {
    ChipRow(modifier) {
        Chip(
            "In stock",
            icon = Icons.Outlined.CheckCircle,
            isSelected = model.inStockOnly,
            count = model.inStockCount,
        ) {
            onChange()
            model.inStockOnly = !model.inStockOnly
        }
        Chip("All", isSelected = model.category == null) {
            if (model.category != null) onChange()
            model.category = null
        }
        searchCategoryOptions(model.categoryFacets, model.category).forEach { facet ->
            Chip(facet.label, isSelected = model.category == facet.value, count = facet.count) {
                onChange()
                model.category = if (model.category == facet.value) null else facet.value
            }
        }
    }
}

/** The categories the words fall into; keeps a selected one visible even with 0 left. */
fun searchCategoryOptions(facets: List<SearchCategoryFacet>, selected: String?): List<SearchCategoryFacet> {
    if (selected == null || facets.any { it.value == selected }) return facets
    return listOf(SearchCategoryFacet(value = selected, label = searchCapitalized(selected), count = 0)) + facets
}

@Composable
private fun SearchSortMenu(sort: SearchSort, onSelect: (SearchSort) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .minimumInteractiveComponentSize()
                .height(32.dp)
                .clip(YardShapes.pill)
                .background(Color.yard.surface2, YardShapes.pill)
                .pressableClick { expanded = true }
                .semantics { contentDescription = "Sort, ${sort.title}" }
                .padding(horizontal = Spacing.m),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.SwapVert, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
            Text(sort.title, style = YardFonts.captionEmphasis, color = Color.yard.ink, maxLines = 1)
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.background(Color.yard.surface),
        ) {
            Text(
                "Sort by",
                style = YardFonts.captionEmphasis,
                color = Color.yard.ink3,
                modifier = Modifier.padding(horizontal = Spacing.l, vertical = Spacing.xs),
            )
            SearchSort.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.title, style = YardFonts.body) },
                    onClick = {
                        expanded = false
                        if (option != sort) onSelect(option)
                    },
                    leadingIcon = { Icon(option.icon, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    trailingIcon = if (option == sort) {
                        { Icon(Icons.Outlined.Check, contentDescription = "Selected", modifier = Modifier.size(18.dp)) }
                    } else {
                        null
                    },
                    colors = MenuDefaults.itemColors(
                        textColor = Color.yard.ink,
                        leadingIconColor = Color.yard.ink,
                        trailingIconColor = Color.yard.ink,
                    ),
                )
            }
        }
    }
}

// endregion

// region Footer and empty states

@Composable
private fun SearchResultsFooter(model: SearchResultsModel, modifier: Modifier = Modifier, onRetry: () -> Unit) {
    val loadMoreError = model.loadMoreError
    when {
        model.isLoadingMore -> Box(modifier.fillMaxWidth().padding(vertical = Spacing.l), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        }
        loadMoreError != null -> Column(
            modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Text(loadMoreError, style = YardFonts.callout, color = Color.yard.danger, textAlign = TextAlign.Center)
            YardButton("Try again", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, onClick = onRetry)
        }
        model.capped -> Text(
            "That's as far as this search goes. Add a filter or a word to narrow it.",
            style = YardFonts.callout,
            color = Color.yard.ink2,
            textAlign = TextAlign.Center,
            modifier = modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
        )
        model.nextCursor == null && model.products.size > 6 -> Text(
            "That's everything for “${model.query}”.",
            style = YardFonts.caption,
            color = Color.yard.ink3,
            textAlign = TextAlign.Center,
            modifier = modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun SearchNoResults(model: SearchResultsModel, modifier: Modifier = Modifier, onOpen: (Route) -> Unit) {
    if (model.hasFilters) {
        EmptyState(
            "Nothing with these filters",
            modifier = modifier.padding(top = Spacing.xl),
            message = "No pieces for “${model.query}” match your filters.",
            icon = Icons.Outlined.FilterList,
            actionTitle = "Clear filters",
        ) { model.clearFilters() }
    } else {
        Column(modifier.fillMaxWidth().padding(top = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
            EmptyState(
                "No results",
                message = "Nothing matches “${model.query}”. Try a brand name, a city or a material.",
                icon = Icons.Outlined.Search,
            )
            SearchSectionLabel("Keep looking")
            SearchFlowLayout(Modifier.padding(horizontal = Spacing.gutter)) {
                SearchSuggestion("Shop everything", Icons.Outlined.ShoppingBag) { onOpen(Route.Shop) }
                SearchSuggestion("All brands", Icons.Outlined.Storefront) { onOpen(Route.BrandsDirectory) }
                SearchSuggestion("Categories", Icons.Outlined.GridView) { onOpen(Route.Categories) }
                SearchSuggestion("Drops", Icons.Outlined.Bolt) { onOpen(Route.Drops) }
            }
        }
    }
}

@Composable
private fun SearchSuggestion(title: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier
            .minimumInteractiveComponentSize()
            .clip(YardShapes.pill)
            .background(Color.yard.surface2, YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .pressableClick(onClick = onClick)
            .heightIn(min = 36.dp)
            .padding(horizontal = Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
        Text(title, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = Color.yard.ink)
    }
}

// endregion

// region Previews

@YardTabletPreviews
@Composable
private fun SearchResultsTabletPreview() = YardPreview(darkTheme = true) {
    SearchResultsView(
        SearchResultsModel.preview(
            query = "hoodie",
            products = PreviewFixtures.products,
            brands = SearchPreviewData.brands,
            facets = listOf(SearchCategoryFacet("tops", "Tops", 8), SearchCategoryFacet("outerwear", "Outerwear", 2)),
        ),
    )
}

@YardTabletPreviews
@Composable
private fun SearchResultsEmptyTabletPreview() = YardPreview(darkTheme = false) {
    SearchResultsView(SearchResultsModel.preview(query = "zzzz", products = emptyList()))
}

@Preview(name = "Results — dark")
@Composable
private fun SearchResultsDarkPreview() = YardPreview(darkTheme = true) {
    SearchResultsView(
        SearchResultsModel.preview(
            query = "hoodie",
            products = PreviewFixtures.products,
            brands = SearchPreviewData.brands,
            facets = listOf(SearchCategoryFacet("tops", "Tops", 8), SearchCategoryFacet("outerwear", "Outerwear", 2)),
        ),
    )
}

@Preview(name = "Results — light")
@Composable
private fun SearchResultsLightPreview() = YardPreview(darkTheme = false) {
    SearchResultsView(
        SearchResultsModel.preview(
            query = "hoodie",
            products = PreviewFixtures.products,
            brands = SearchPreviewData.brands,
            facets = listOf(SearchCategoryFacet("tops", "Tops", 8)),
        ),
    )
}

@Preview(name = "Results empty — dark")
@Composable
private fun SearchResultsEmptyDarkPreview() = YardPreview(darkTheme = true) {
    SearchResultsView(SearchResultsModel.preview(query = "zzzz", products = emptyList()))
}

@Preview(name = "Results empty — light")
@Composable
private fun SearchResultsEmptyLightPreview() = YardPreview(darkTheme = false) {
    SearchResultsView(SearchResultsModel.preview(query = "zzzz", products = emptyList()))
}

// endregion
