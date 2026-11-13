package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridState
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged
import space.yardstore.app.core.models.Product
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * A masonry grid (Home, brand grids, saved, shop). Mirrors `MasonryGrid.swift`. Two columns on
 * phones, 3 on medium and 4 on expanded windows ([columns] defaults to
 * `LocalYardWindow.current.gridColumns`; pass a number to override).
 *
 * Android: this IS the scroll container (a lazy staggered grid; each tile goes to the shorter
 * column by its measured height, in order, so new pages append without reshuffling). Put
 * anything above or below the tiles in [header] / [footer] (full-width items) instead of
 * wrapping the grid in a scrolling Column. [onLoadMore] fires when the last rows come into view.
 * Edge to edge by default (Pinterest look); pass `contentPadding` for a gutter.
 *
 *   MasonryGrid(
 *       products,
 *       contentPadding = PaddingValues(horizontal = Spacing.gridGap, bottom = LocalTabPillClearance.current),
 *       header = { item(span = StaggeredGridItemSpan.FullLine) { SectionHeader("New in") } },
 *       onLoadMore = { viewModel.loadMore() },
 *   ) { product ->
 *       ProductTile(product, Modifier.pressableClick { router.push(Route.Product(product.slug)) })
 *   }
 *
 * For a short grid inside a scrolling Column (e.g. under a brand hero), use [MasonryColumns].
 */
@Composable
fun <T> MasonryGrid(
    items: List<T>,
    key: (T) -> Any,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.gridGap,
    state: LazyStaggeredGridState = rememberLazyStaggeredGridState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    header: (LazyStaggeredGridScope.() -> Unit)? = null,
    footer: (LazyStaggeredGridScope.() -> Unit)? = null,
    onLoadMore: (() -> Unit)? = null,
    columns: Int = LocalYardWindow.current.gridColumns,
    content: @Composable (T) -> Unit,
) {
    LazyVerticalStaggeredGrid(
        columns = StaggeredGridCells.Fixed(columns.coerceAtLeast(1)),
        modifier = modifier,
        state = state,
        contentPadding = contentPadding,
        verticalItemSpacing = spacing,
        horizontalArrangement = Arrangement.spacedBy(spacing),
    ) {
        header?.invoke(this)
        items(items, key = key) { item -> content(item) }
        footer?.invoke(this)
    }
    if (onLoadMore != null) {
        val latest by rememberUpdatedState(onLoadMore)
        LaunchedEffect(state, items.size) {
            snapshotFlow {
                val info = state.layoutInfo
                val last = info.visibleItemsInfo.lastOrNull()?.index ?: -1
                info.totalItemsCount > 0 && last >= info.totalItemsCount - 5
            }.distinctUntilChanged().collect { nearEnd -> if (nearEnd) latest() }
        }
    }
}

/** Products with `ProductTile`s, keyed by id (iOS `MasonryGrid(products) { … }`). */
@Composable
fun MasonryGrid(
    products: List<Product>,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.gridGap,
    state: LazyStaggeredGridState = rememberLazyStaggeredGridState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    header: (LazyStaggeredGridScope.() -> Unit)? = null,
    footer: (LazyStaggeredGridScope.() -> Unit)? = null,
    onLoadMore: (() -> Unit)? = null,
    columns: Int = LocalYardWindow.current.gridColumns,
    content: @Composable (Product) -> Unit,
) = MasonryGrid(
    items = products,
    key = { it.id },
    modifier = modifier,
    spacing = spacing,
    state = state,
    contentPadding = contentPadding,
    header = header,
    footer = footer,
    onLoadMore = onLoadMore,
    columns = columns,
    content = content,
)

/**
 * A NON-lazy masonry with the iOS greedy placement (each item goes to the column that is
 * shorter by estimated height: `heightRatio` × width + `extraHeight`). For short grids inside
 * a scrolling Column. For long lists use [MasonryGrid]. [columns] defaults to
 * `LocalYardWindow.current.gridColumns` (2 / 3 / 4).
 */
@Composable
fun <T> MasonryColumns(
    items: List<T>,
    key: (T) -> Any,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.gridGap,
    /** Fixed height per tile beyond the image (caption), in dp, for balancing. */
    extraHeight: Dp = 0.dp,
    /** Tile image height ÷ width for an item (e.g. 1.25 for a 4:5 photo). */
    heightRatio: (T) -> Float,
    columns: Int = LocalYardWindow.current.gridColumns,
    content: @Composable (T) -> Unit,
) {
    val distributed = distributeMasonryColumns(items, columns, extraHeight.value, spacing.value, heightRatio)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = Alignment.Top) {
        for (column in distributed) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing)) {
                for (item in column) {
                    androidx.compose.runtime.key(key(item)) { content(item) }
                }
            }
        }
    }
}

/** [MasonryColumns] for products with `ProductTile` captions. */
@Composable
fun MasonryColumns(
    products: List<Product>,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.gridGap,
    extraHeight: Dp = ProductTileDefaults.captionHeight,
    columns: Int = LocalYardWindow.current.gridColumns,
    content: @Composable (Product) -> Unit,
) = MasonryColumns(
    items = products,
    key = { it.id },
    modifier = modifier,
    spacing = spacing,
    extraHeight = extraHeight,
    heightRatio = { 1f / ProductTileDefaults.clampedAspect(it.tileAspectRatio) },
    columns = columns,
    content = content,
)

/** Greedy shortest-column placement into two columns, in order (the iOS `distribute()`), exposed for tests. */
fun <T> distributeMasonry(items: List<T>, extraHeight: Float, spacing: Float, heightRatio: (T) -> Float): Pair<List<T>, List<T>> {
    val (left, right) = distributeMasonryColumns(items, 2, extraHeight, spacing, heightRatio)
    return left to right
}

/**
 * Greedy shortest-column placement into [columns] columns, in order: each item goes to the
 * shortest column (leftmost on ties). Always returns exactly `max(columns, 1)` lists.
 */
fun <T> distributeMasonryColumns(
    items: List<T>,
    columns: Int,
    extraHeight: Float,
    spacing: Float,
    heightRatio: (T) -> Float,
): List<List<T>> {
    val n = columns.coerceAtLeast(1)
    val nominalWidth = 180f
    val lists = List(n) { ArrayList<T>(items.size / n + 1) }
    val heights = FloatArray(n)
    for (item in items) {
        val ratio = heightRatio(item)
        val safe = if (ratio.isFinite() && ratio > 0f) ratio else 1f
        val h = nominalWidth * safe + extraHeight + spacing
        var target = 0
        for (c in 1 until n) if (heights[c] < heights[target]) target = c
        lists[target] += item
        heights[target] += h
    }
    return lists
}

private data class PreviewBlock(val id: Int, val ratio: Float)

@Composable
private fun MasonryPreviewContent() {
    val blocks = (0 until 24).map { PreviewBlock(it, listOf(1.3f, 0.9f, 1.6f, 1.1f, 1.45f)[it % 5]) }
    MasonryGrid(blocks, key = { it.id }, contentPadding = PaddingValues(horizontal = Spacing.gridGap)) { block ->
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f / block.ratio)
                .background(if (block.id % 3 == 0) Color.yard.acid else Color.yard.surface2, YardShapes.image),
            contentAlignment = Alignment.Center,
        ) {
            Text("${block.id}", style = YardFonts.display(28.sp), color = Color.yard.ink3)
        }
    }
}

@Preview(name = "Masonry — dark")
@Composable
private fun MasonryDarkPreview() = YardPreview(darkTheme = true) { MasonryPreviewContent() }

@Preview(name = "Masonry — light")
@Composable
private fun MasonryLightPreview() = YardPreview(darkTheme = false) { MasonryPreviewContent() }

@YardTabletPreviews
@Composable
private fun MasonryTabletPreview() = YardPreview(darkTheme = true) { MasonryPreviewContent() }
