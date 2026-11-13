package space.yardstore.app.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.Formatters
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * A selectable pill: filters, categories, size chips, the Home top tabs. Mirrors `Chip.swift`.
 *
 *   Chip("For you", isSelected = tab == Tab.ForYou) { tab = Tab.ForYou }
 *   Chip("M", isSelected = size == "M", isEnabled = inStock) { size = "M" }      // size chip
 *   Chip("Filters", icon = Icons.Outlined.Tune) { … }
 *
 * Selected = `ink` fill with `bg` text; unselected = `surface2` with `ink`. A disabled chip
 * (sold-out size) is struck through and not tappable.
 */
@Composable
fun Chip(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    isSelected: Boolean = false,
    isEnabled: Boolean = true,
    /** Optional trailing count ("Bags 12"). */
    count: Int? = null,
    onClick: () -> Unit,
) {
    val bg by animateColorAsState(if (isSelected) Color.yard.ink else Color.yard.surface2, Motion.snappy(), label = "chip-bg")
    val fg = if (isSelected) Color.yard.bg else if (isEnabled) Color.yard.ink else Color.yard.ink3
    Row(
        modifier = modifier
            .semantics { selected = isSelected }
            .clip(YardShapes.pill)
            .background(bg, YardShapes.pill)
            .then(if (isSelected) Modifier else Modifier.border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill))
            .pressableClick(enabled = isEnabled, onClick = onClick)
            .defaultMinSize(minHeight = 36.dp)
            .padding(horizontal = Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(14.dp))
        Text(
            title,
            style = YardFonts.callout.copy(
                fontWeight = FontWeight.SemiBold,
                textDecoration = if (isEnabled) null else TextDecoration.LineThrough,
            ),
            color = fg,
            maxLines = 1,
        )
        if (count != null) {
            Text(
                Formatters.count(count),
                style = YardFonts.micro,
                color = if (isSelected) Color.yard.bg.copy(alpha = 0.7f) else Color.yard.ink3,
            )
        }
    }
}

/**
 * A horizontally scrolling row of chips with screen gutters (iOS `ChipRow`).
 *
 *   ChipRow { Chip(…); Chip(…) }
 */
@Composable
fun ChipRow(
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.s,
    contentPadding: PaddingValues = PaddingValues(horizontal = Spacing.gutter),
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier
            .horizontalScroll(rememberScrollState())
            .padding(contentPadding),
        horizontalArrangement = Arrangement.spacedBy(spacing),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun ChipsPreviewContent() {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(vertical = 16.dp)) {
        ChipRow {
            Chip("For you", isSelected = true) {}
            Chip("Following") {}
            Chip("Tops") {}
            Chip("Filters", icon = Icons.Outlined.Tune, count = 3) {}
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("S") {}
            Chip("M", isSelected = true) {}
            Chip("L", isEnabled = false) {}
        }
    }
}

@Preview(name = "Chips — dark")
@Composable
private fun ChipsDarkPreview() = YardPreview(darkTheme = true) { ChipsPreviewContent() }

@Preview(name = "Chips — light")
@Composable
private fun ChipsLightPreview() = YardPreview(darkTheme = false) { ChipsPreviewContent() }
