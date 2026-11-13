package space.yardstore.app.features.shop

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard

// Shop-private UI helpers shared by ShopView, CategoriesView and CollectionView.

/**
 * The display face with SwiftUI's `.minimumScaleFactor(minScale)`: uppercase, condensed, and
 * shrinks (down to `size × minScale`) before it ellipsizes.
 */
@Composable
internal fun ShopDisplayText(
    text: String,
    size: TextUnit,
    modifier: Modifier = Modifier,
    color: Color = Color.yard.ink,
    maxLines: Int = Int.MAX_VALUE,
    minScale: Float = 1f,
) {
    val style = YardFonts.display(size).copy(color = color)
    BasicText(
        text = text.uppercase(),
        modifier = modifier,
        style = style,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        autoSize = if (minScale < 1f) TextAutoSize.StepBased(minFontSize = size * minScale, maxFontSize = size, stepSize = 1.sp) else null,
    )
}

/**
 * Lets a full-width grid item ignore the grid's horizontal content padding ([by] each side),
 * so headers and the filter bar sit on the screen's own gutters while tiles keep the 6dp gap.
 */
internal fun Modifier.shopBleed(by: Dp): Modifier = layout { measurable, constraints ->
    val extra = by.roundToPx()
    val width = constraints.maxWidth + extra * 2
    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-extra, 0) }
}

/** Pull to refresh in Yard's colours (iOS `.refreshable`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShopRefreshBox(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier,
        state = state,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Color.yard.surface,
                color = Color.yard.ink,
            )
        },
        content = content,
    )
}

/**
 * The sort pill + menu (iOS `Menu { … } label: { arrow.up.arrow.down + title }`).
 * The current option carries a check mark; picking one gives a selection haptic.
 */
@Composable
internal fun <T> ShopSortMenu(
    selection: T,
    options: List<T>,
    title: (T) -> String,
    accessibilityPrefix: String,
    onSelect: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Box {
        Row(
            Modifier
                .semantics { contentDescription = "$accessibilityPrefix, ${title(selection)}" }
                .background(Color.yard.surface2, YardShapes.pill)
                .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
                .pressableClick { expanded = true }
                .defaultMinSize(minHeight = 36.dp)
                .padding(horizontal = Spacing.l),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.SwapVert, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
            Text(
                title(selection),
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink,
                maxLines = 1,
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = Color.yard.surface,
            shape = YardShapes.small,
            border = BorderStroke(1.dp, Color.yard.line),
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(title(option), style = YardFonts.body, color = Color.yard.ink) },
                    trailingIcon = {
                        if (option == selection) {
                            Icon(Icons.Filled.Check, contentDescription = "Selected", tint = Color.yard.ink, modifier = Modifier.size(18.dp))
                        } else {
                            Spacer(Modifier.width(18.dp))
                        }
                    },
                    onClick = {
                        expanded = false
                        if (option != selection) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onSelect(option)
                    },
                )
            }
        }
    }
}

/** Android share sheet for a web URL (iOS `ShareLink(item:)`). */
internal fun shopShare(context: Context, url: String, title: String?) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, url)
        if (!title.isNullOrEmpty()) putExtra(Intent.EXTRA_SUBJECT, title)
    }
    val chooser = Intent.createChooser(send, null).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
    runCatching { context.startActivity(chooser) }
}
