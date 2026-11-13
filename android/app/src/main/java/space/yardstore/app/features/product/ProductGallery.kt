package space.yardstore.app.features.product

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import space.yardstore.app.core.models.ProductImage
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTheme
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import kotlin.math.abs

/**
 * Full-width swipeable photo pager with page dots, an overlay tag (top-left) and a thumbnail
 * strip underneath. Tapping a photo opens [ProductPhotoViewer] at that photo.
 * Mirrors `ProductGallery` in ProductGallery.swift.
 */
@Composable
fun ProductGallery(
    images: List<ProductImage>,
    index: Int,
    onIndexChange: (Int) -> Unit,
    onOpen: (Int) -> Unit,
    modifier: Modifier = Modifier,
    /**
     * Tablet two-column layout: the photo's height cap (the pane's height minus the thumbnails), so
     * the whole photo stays in view; it then narrows to keep its aspect. Unspecified on phones.
     */
    pagerMaxHeight: Dp = Dp.Unspecified,
    overlay: @Composable BoxScope.() -> Unit = {},
) {
    // Pager aspect (w/h): the first image's, kept between 3:4 and 1:1; 4:5 when unknown.
    val aspect = (images.firstOrNull()?.aspectRatio ?: 0.8).coerceIn(0.75, 1.0).toFloat()
    val pagerState = rememberPagerState(initialPage = index.coerceIn(0, maxOf(0, images.size - 1))) { images.size }

    // Thumbnails / outside → pager.
    LaunchedEffect(index, images.size) {
        if (images.isNotEmpty() && pagerState.currentPage != index && index in images.indices) {
            pagerState.animateScrollToPage(index, animationSpec = Motion.spring())
        }
    }
    // Pager swipes → index.
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }.distinctUntilChanged().collect { onIndexChange(it) }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Box(Modifier.padding(horizontal = Spacing.s).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(
            Modifier
                .then(if (pagerMaxHeight != Dp.Unspecified) Modifier.heightIn(max = pagerMaxHeight) else Modifier.fillMaxWidth())
                .aspectRatio(aspect)
                .clip(YardShapes.image)
                .background(Color.yard.surface2),
        ) {
            if (images.isEmpty()) {
                Icon(
                    Icons.Outlined.Image,
                    contentDescription = null,
                    tint = Color.yard.ink3,
                    modifier = Modifier.size(36.dp).align(Alignment.Center),
                )
            } else {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                    key = { i -> images[i].id.ifEmpty { "img-$i" } },
                ) { page ->
                    val image = images[page]
                    val label = image.alt.ifEmpty { "Photo ${page + 1} of ${images.size}" }
                    RemoteImage(
                        image.url,
                        Modifier
                            .fillMaxSize()
                            .semantics {
                                contentDescription = label
                                onClick(label = "Open the photo full screen") { onOpen(page); true }
                            }
                            .pointerInput(page) { detectTapGestures(onTap = { onOpen(page) }) },
                        maxPixelSize = 1400,
                    )
                }
            }

            if (images.size > 1) {
                ProductPageDots(count = images.size, index = pagerState.currentPage, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = Spacing.m))
            }
            Box(Modifier.align(Alignment.TopStart).padding(Spacing.m), content = overlay)
        }
        }

        if (images.size > 1) {
            ProductThumbnails(images, selected = pagerState.currentPage) { i -> onIndexChange(i) }
        }
    }
}

@Composable
private fun ProductPageDots(count: Int, index: Int, modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(Color.yard.scrim.copy(alpha = 0.28f), YardShapes.pill)
            .padding(horizontal = Spacing.s, vertical = 6.dp)
            .clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            val width by animateDpAsState(if (i == index) 18.dp else 6.dp, Motion.snappy(), label = "dot-w")
            val alpha by animateFloatAsState(if (i == index) 1f else 0.45f, Motion.snappy(), label = "dot-a")
            Box(Modifier.width(width).height(6.dp).background(Color.yard.onPhoto.copy(alpha = alpha), YardShapes.pill))
        }
    }
}

@Composable
private fun ProductThumbnails(images: List<ProductImage>, selected: Int, onSelect: (Int) -> Unit) {
    val listState = rememberLazyListState()
    LaunchedEffect(selected) {
        val visible = listState.layoutInfo.visibleItemsInfo
        val item = visible.firstOrNull { it.index == selected }
        val viewport = listState.layoutInfo.viewportEndOffset - listState.layoutInfo.viewportStartOffset
        if (item == null) {
            listState.animateScrollToItem(selected)
        } else {
            // Centre the selected thumbnail (iOS scrollTo anchor: .center).
            val delta = item.offset + item.size / 2 - viewport / 2
            listState.animateScrollBy(delta.toFloat())
        }
    }
    LazyRow(
        state = listState,
        contentPadding = PaddingValues(horizontal = Spacing.gutter),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        itemsIndexed(images, key = { i, img -> img.id.ifEmpty { "thumb-$i" } }) { i, image ->
            val isSelected = i == selected
            RemoteImage(
                image.url,
                Modifier
                    .size(width = 56.dp, height = 68.dp)
                    .alpha(if (isSelected) 1f else 0.7f)
                    .clip(YardShapes.small)
                    .border(BorderStroke(if (isSelected) 2.dp else 1.dp, if (isSelected) Color.yard.ink else Color.yard.line), YardShapes.small)
                    .semantics { this.selected = isSelected }
                    .pressableClick(onClickLabel = "Show photo ${i + 1}") { onSelect(i) },
                maxPixelSize = 200,
                contentDescription = "Show photo ${i + 1}",
            )
        }
    }
}

/**
 * Full-screen photo viewer: swipe between photos, pinch or double-tap to zoom, drag to pan when
 * zoomed, swipe down to close (system back / predictive back closes too).
 * Mirrors `ProductPhotoViewer` (iOS `.fullScreenCover`; here a full-screen [Dialog]).
 */
@Composable
fun ProductPhotoViewer(images: List<ProductImage>, startIndex: Int, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // Always dark, like iOS `.environment(\.colorScheme, .dark)`.
        YardTheme(darkTheme = true) {
            ProductPhotoViewerContent(images, startIndex, onDismiss)
        }
    }
}

@Composable
private fun ProductPhotoViewerContent(images: List<ProductImage>, startIndex: Int, onDismiss: () -> Unit) {
    val pagerState = rememberPagerState(initialPage = startIndex.coerceIn(0, maxOf(0, images.size - 1))) { images.size }
    var dismissOffset by remember { mutableFloatStateOf(0f) }
    var isZoomed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.currentPage }.distinctUntilChanged().collect { isZoomed = false }
    }

    val progress = (abs(dismissOffset) / 900f).coerceIn(0f, 1f)
    val backgroundAlpha = 1f - progress * 0.7f

    Box(Modifier.fillMaxSize().background(Color.yard.scrim.copy(alpha = backgroundAlpha))) {
        HorizontalPager(
            state = pagerState,
            userScrollEnabled = !isZoomed,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { translationY = dismissOffset }
                .draggable(
                    orientation = Orientation.Vertical,
                    enabled = !isZoomed,
                    state = rememberDraggableState { delta -> dismissOffset = maxOf(0f, dismissOffset + delta) },
                    onDragStopped = { velocity ->
                        if (dismissOffset > 360f || velocity > 2400f) {
                            onDismiss()
                        } else {
                            scope.launch { animate(dismissOffset, 0f, animationSpec = Motion.spring()) { v, _ -> dismissOffset = v } }
                        }
                    },
                ),
            key = { i -> images[i].id.ifEmpty { "full-$i" } },
        ) { page ->
            ProductZoomableImage(
                url = images[page].url,
                contentDescription = images[page].alt.ifEmpty { "Photo ${page + 1} of ${images.size}" },
                isCurrent = page == pagerState.currentPage,
                onZoomChange = { if (page == pagerState.currentPage) isZoomed = it },
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = Spacing.gutter, vertical = Spacing.s)
                .alpha(if (dismissOffset > 0f) 0f else 1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (images.size > 1) {
                Text(
                    "${pagerState.currentPage + 1} / ${images.size}",
                    style = YardFonts.captionEmphasis.monospacedDigits(),
                    color = Color.yard.onPhoto,
                    modifier = Modifier
                        .background(Color.yard.surface.copy(alpha = 0.6f), YardShapes.pill)
                        .padding(horizontal = Spacing.m, vertical = 6.dp),
                )
            }
            Box(Modifier.weight(1f))
            GlassIconButton(Icons.Filled.Close, contentDescription = "Close", modifier = Modifier.minimumInteractiveComponentSize(), onClick = onDismiss)
        }
    }
}

/** One photo that zooms (pinch / double-tap) and pans while zoomed. */
@Composable
private fun ProductZoomableImage(url: String?, contentDescription: String, isCurrent: Boolean, onZoomChange: (Boolean) -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val scope = rememberCoroutineScope()

    fun clamp(o: Offset, s: Float): Offset {
        val maxX = size.width * (s - 1f) / 2f
        val maxY = size.height * (s - 1f) / 2f
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    // Leaving the page resets its zoom.
    LaunchedEffect(isCurrent) {
        if (!isCurrent) {
            scale = 1f
            offset = Offset.Zero
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { size = it }
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = { tap ->
                    val from = scale
                    val zoomIn = from <= 1f
                    val to = if (zoomIn) 2.5f else 1f
                    val fromOffset = offset
                    // Zoom towards the tapped point.
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val targetOffset = if (zoomIn) clamp((center - tap) * (to - 1f), to) else Offset.Zero
                    onZoomChange(zoomIn)
                    scope.launch {
                        animate(0f, 1f, animationSpec = Motion.spring()) { t, _ ->
                            scale = from + (to - from) * t
                            offset = fromOffset + (targetOffset - fromOffset) * t
                        }
                    }
                })
            }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.count { it.pressed }
                        if (pressed > 1 || scale > 1f) {
                            val zoom = event.calculateZoom()
                            val pan = event.calculatePan()
                            val newScale = (scale * zoom).coerceIn(1f, 5f)
                            scale = newScale
                            offset = if (newScale > 1f) clamp(offset + pan, newScale) else Offset.Zero
                            onZoomChange(newScale > 1f)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                    if (scale <= 1.01f) {
                        scale = 1f
                        offset = Offset.Zero
                        onZoomChange(false)
                    }
                }
            }
            .semantics { this.contentDescription = "$contentDescription. Double-tap to zoom" },
        contentAlignment = Alignment.Center,
    ) {
        RemoteImage(
            url,
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
            contentScale = ContentScale.Fit,
            maxPixelSize = 2000,
            placeholder = {},
        )
    }
}

// region Previews (fixtures are preview-only)

@Composable
private fun ProductGalleryPreviewBody() {
    var index by remember { mutableIntStateOf(0) }
    Column(Modifier.background(Color.yard.bg).padding(vertical = Spacing.s)) {
        ProductGallery(
            images = PreviewFixtures.products.take(4).mapNotNull { it.images.firstOrNull() },
            index = index,
            onIndexChange = { index = it },
            onOpen = {},
        ) { Tag("New Arrival", style = TagStyle.Acid) }
    }
}

@Preview(name = "Gallery — dark")
@Composable
private fun ProductGalleryDarkPreview() = YardPreview(darkTheme = true) { ProductGalleryPreviewBody() }

@Preview(name = "Gallery — light")
@Composable
private fun ProductGalleryLightPreview() = YardPreview(darkTheme = false) { ProductGalleryPreviewBody() }

// endregion
