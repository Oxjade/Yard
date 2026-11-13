package space.yardstore.app.features.orders

import android.content.ClipData
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import kotlinx.coroutines.launch
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.yard

// Small Android helpers private to the orders feature (not in the foundation).

/**
 * SwiftUI `.refreshable { await … }`: pull to refresh with a Yard-coloured indicator. The spinner
 * shows while [onRefresh] runs.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OrderRefreshBox(
    onRefresh: suspend () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try { onRefresh() } finally { refreshing = false }
            }
        },
        modifier = modifier.fillMaxSize(),
        state = state,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Color.yard.surface,
                color = Color.yard.ink,
            )
        },
        content = content,
    )
}

/** Copies [text] to the clipboard (UIPasteboard.general.string). */
@Composable
internal fun rememberOrderCopier(): (label: String, text: String) -> Unit {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, scope) {
        { label, text -> scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(label, text))) } }
    }
}

/**
 * The side inset that centres content capped at [maxWidth] inside [available] (0 when it fits or
 * there is no cap). Same cap as `AdaptiveContent`, applied as list padding instead.
 */
internal fun orderReadableInset(available: Dp, maxWidth: Dp): Dp =
    if (maxWidth.isSpecified && available > maxWidth) (available - maxWidth) / 2 else 0.dp

/**
 * A full-width `LazyColumn` whose content is capped at `LocalYardWindow.current.contentMaxWidth`
 * (AdaptiveContent for reading screens), with [horizontal] padding inside the cap. Unlike wrapping
 * the list in `AdaptiveContent`, the margins outside the cap still scroll and pull to refresh.
 */
@Composable
internal fun OrderReadableList(
    modifier: Modifier = Modifier,
    horizontal: Dp = 0.dp,
    top: Dp = 0.dp,
    bottom: Dp = 0.dp,
    spacing: Dp = 0.dp,
    state: LazyListState = rememberLazyListState(),
    content: LazyListScope.() -> Unit,
) {
    val maxWidth = LocalYardWindow.current.contentMaxWidth
    BoxWithConstraints(modifier.fillMaxSize()) {
        val side = orderReadableInset(this.maxWidth, maxWidth) + horizontal
        LazyColumn(
            Modifier.fillMaxSize(),
            state = state,
            contentPadding = PaddingValues(start = side, end = side, top = top, bottom = bottom),
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    }
}
