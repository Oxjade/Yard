package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * Centers [content] horizontally and caps its width at [maxWidth] (forms, detail, reading
 * screens). On compact windows `contentMaxWidth` is unspecified, so it simply fills the width.
 * The outer box takes [modifier] (give it the screen's size, e.g. `Modifier.fillMaxSize()`), so
 * the screen background still spans the whole window:
 *
 *   Column(Modifier.fillMaxSize().yardScreenBackground()) {
 *       YardTopBar("Addresses")
 *       AdaptiveContent(Modifier.weight(1f)) {
 *           LazyColumn(Modifier.fillMaxSize()) { … }
 *       }
 *   }
 *
 * For a single child that should just be centered, `Modifier.adaptiveContentWidth()` does the same.
 */
@Composable
fun AdaptiveContent(
    modifier: Modifier = Modifier,
    maxWidth: Dp = LocalYardWindow.current.contentMaxWidth,
    content: @Composable BoxScope.() -> Unit,
) {
    // propagateMinConstraints: the inner box gets the outer box's min height (full height when the
    // caller sized it with fillMaxSize/weight) while widthIn caps its width.
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter, propagateMinConstraints = true) {
        Box(
            Modifier
                .then(if (maxWidth.isSpecified) Modifier.widthIn(max = maxWidth) else Modifier)
                .fillMaxWidth(),
            content = content,
        )
    }
}

/**
 * Fills the available width, centers itself and caps its width at [maxWidth]
 * (defaults to `LocalYardWindow.current.contentMaxWidth`; no cap on compact).
 *
 *   Column(Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter)) { … }
 */
@Composable
fun Modifier.adaptiveContentWidth(maxWidth: Dp = LocalYardWindow.current.contentMaxWidth): Modifier =
    if (!maxWidth.isSpecified) this.fillMaxWidth()
    else this.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = maxWidth).fillMaxWidth()

/** Defaults for [ListDetailLayout]. */
object ListDetailDefaults {
    /** List pane: 38% of the width, between 320dp and 420dp. */
    fun listWidth(totalWidth: Dp): Dp = (totalWidth * 0.38f).coerceIn(320.dp, 420.dp)
}

/**
 * List + detail panes (inbox → thread, orders → order detail, settings). On Expanded windows
 * (≥ 840dp) both panes show side by side, divided by a hairline; otherwise only [list] shows and the
 * screen pushes the detail route as usual. The screen decides what the detail pane shows (keep
 * the selection in `rememberSaveable` so it survives rotation; show an `EmptyState` when nothing is
 * selected). Each pane gets its own `LocalYardWindow` with the pane's width, so grids and
 * `AdaptiveContent` inside a pane size to the pane.
 *
 *   var selected by rememberSaveable { mutableStateOf<String?>(null) }
 *   val twoPane = LocalYardWindow.current.isExpanded
 *   ListDetailLayout(
 *       list = { ConversationList(onOpen = { id -> if (twoPane) selected = id else router.push(Route.Conversation(id)) }) },
 *       detail = { selected?.let { ConversationView(it) } ?: EmptyState("Pick a conversation") },
 *   )
 *
 * [twoPane] overrides the decision (default: `LocalYardWindow.current.isExpanded`).
 */
@Composable
fun ListDetailLayout(
    list: @Composable () -> Unit,
    detail: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    twoPane: Boolean = LocalYardWindow.current.isExpanded,
    listWidth: Dp = Dp.Unspecified,
    showsDivider: Boolean = true,
) {
    val window = LocalYardWindow.current
    if (!twoPane) {
        Box(modifier.fillMaxSize()) { list() }
        return
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val total = maxWidth
        val left = if (listWidth.isSpecified) listWidth.coerceIn(0.dp, total) else ListDetailDefaults.listWidth(total)
        val right = (total - left - if (showsDivider) 1.dp else 0.dp).coerceIn(0.dp, total)
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.width(left).fillMaxHeight()) {
                CompositionLocalProvider(LocalYardWindow provides window.copy(width = left)) { list() }
            }
            if (showsDivider) Box(Modifier.width(1.dp).fillMaxHeight().background(Color.yard.line))
            Box(Modifier.width(right).fillMaxHeight()) {
                CompositionLocalProvider(LocalYardWindow provides window.copy(width = right)) { detail() }
            }
        }
    }
}

@Composable
private fun AdaptivePreviewContent() {
    ListDetailLayout(
        list = {
            Column(Modifier.fillMaxSize().padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                repeat(6) { i ->
                    Box(
                        Modifier.fillMaxWidth().height(56.dp).background(if (i == 1) Color.yard.surface2 else Color.yard.surface, YardShapes.small),
                        contentAlignment = Alignment.CenterStart,
                    ) { Text("Conversation ${i + 1}", Modifier.padding(horizontal = Spacing.m), style = YardFonts.bodyEmphasis, color = Color.yard.ink) }
                }
            }
        },
        detail = {
            AdaptiveContent(Modifier.fillMaxSize()) {
                EmptyState("Pick a conversation", icon = Icons.Outlined.Inbox, message = "Messages with brands show here.")
            }
        },
    )
}

@Preview(name = "ListDetail — tablet landscape dark", widthDp = 1280, heightDp = 800)
@Composable
private fun ListDetailTabletDarkPreview() = YardPreview(darkTheme = true) { AdaptivePreviewContent() }

@Preview(name = "ListDetail — tablet portrait light", widthDp = 840, heightDp = 1200)
@Composable
private fun ListDetailTabletLightPreview() = YardPreview(darkTheme = false) { AdaptivePreviewContent() }
