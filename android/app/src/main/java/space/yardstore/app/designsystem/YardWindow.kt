package space.yardstore.app.designsystem

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Window width class (Material window size class breakpoints, no extra dependency):
 * [Compact] < 600dp (phones), [Medium] 600–839dp (small tablets portrait, unfolded foldables),
 * [Expanded] ≥ 840dp (tablets landscape / large tablets).
 */
enum class YardWidthClass {
    Compact, Medium, Expanded;

    companion object {
        fun of(width: Dp): YardWidthClass = when {
            width < 600.dp -> Compact
            width < 840.dp -> Medium
            else -> Expanded
        }
    }
}

/** Window height class: [Compact] < 480dp (phone landscape), [Medium] 480–899dp, [Expanded] ≥ 900dp. */
enum class YardHeightClass {
    Compact, Medium, Expanded;

    companion object {
        fun of(height: Dp): YardHeightClass = when {
            height < 480.dp -> Compact
            height < 900.dp -> Medium
            else -> Expanded
        }
    }
}

/**
 * The size of the space a screen lays out in, with the layout decisions every screen shares.
 * Read it with `LocalYardWindow.current` (provided at the root, recomputed on rotation / resize /
 * fold; `ListDetailLayout` re-provides it per pane with the pane's width).
 *
 *   val window = LocalYardWindow.current
 *   if (window.isWide) TwoColumns() else OneColumn()
 *   MasonryGrid(products) { … }                      // already uses window.gridColumns
 *   AdaptiveContent { Form() }                       // already uses window.contentMaxWidth
 *
 * [width]/[height] are the layout area in dp; [windowWidth] is the whole app window's width
 * (differs from [width] only inside a pane).
 */
@Immutable
data class YardWindow(
    val width: Dp,
    val height: Dp,
    val windowWidth: Dp = width,
) {
    val widthClass: YardWidthClass get() = YardWidthClass.of(width)
    val heightClass: YardHeightClass get() = YardHeightClass.of(height)

    /** Phone width. */
    val isCompact: Boolean get() = widthClass == YardWidthClass.Compact
    /** Medium or Expanded: tablets, unfolded foldables, large windows. */
    val isWide: Boolean get() = widthClass != YardWidthClass.Compact
    /** ≥ 840dp: room for two panes (list + detail). */
    val isExpanded: Boolean get() = widthClass == YardWidthClass.Expanded
    val isLandscape: Boolean get() = width > height

    /** Masonry / product grid columns: 2 compact, 3 medium, 4 expanded. */
    val gridColumns: Int get() = gridColumns(widthClass)

    /**
     * Max width for reading / form / detail content ([AdaptiveContent]): unconstrained on
     * compact, 720dp on medium, 960dp on expanded.
     */
    val contentMaxWidth: Dp get() = contentMaxWidth(widthClass)

    /** Route sheets render as a centered dialog surface (max ~560dp) instead of a bottom sheet. */
    val sheetIsDialog: Boolean get() = YardWidthClass.of(windowWidth) != YardWidthClass.Compact

    companion object {
        /** A typical phone (the default outside the app root, e.g. in tests). */
        val Phone = YardWindow(width = 411.dp, height = 891.dp)

        fun gridColumns(widthClass: YardWidthClass): Int = when (widthClass) {
            YardWidthClass.Compact -> 2
            YardWidthClass.Medium -> 3
            YardWidthClass.Expanded -> 4
        }

        fun contentMaxWidth(widthClass: YardWidthClass): Dp = when (widthClass) {
            YardWidthClass.Compact -> Dp.Unspecified
            YardWidthClass.Medium -> 720.dp
            YardWidthClass.Expanded -> 960.dp
        }

        /** Max width of a route sheet shown as a dialog on wide windows. */
        val dialogSheetMaxWidth: Dp = 560.dp
    }
}

/** The current [YardWindow]. Defaults to [YardWindow.Phone] when nothing provides it. */
val LocalYardWindow = compositionLocalOf { YardWindow.Phone }

/**
 * Measures the space it is given and provides [LocalYardWindow] to [content] (the root does this
 * once; it recomputes on rotation, resize and fold/unfold). Falls back to the configuration's
 * screen size when a dimension is unbounded.
 */
@Composable
fun ProvideYardWindow(modifier: Modifier = Modifier.fillMaxSize(), content: @Composable () -> Unit) {
    val configuration = LocalConfiguration.current
    BoxWithConstraints(modifier) {
        val w = if (constraints.hasBoundedWidth) maxWidth else configuration.screenWidthDp.dp
        val h = if (constraints.hasBoundedHeight) maxHeight else configuration.screenHeightDp.dp
        val window = remember(w, h) { YardWindow(width = w, height = h) }
        CompositionLocalProvider(LocalYardWindow provides window, content = content)
    }
}

/** A [YardWindow] from the configuration's screen size (previews; `@Preview(widthDp, heightDp)` sets it). */
@Composable
fun configurationYardWindow(): YardWindow {
    val configuration = LocalConfiguration.current
    return remember(configuration.screenWidthDp, configuration.screenHeightDp) {
        YardWindow(width = configuration.screenWidthDp.dp, height = configuration.screenHeightDp.dp)
    }
}
