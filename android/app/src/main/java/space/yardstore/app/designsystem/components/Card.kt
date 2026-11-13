package space.yardstore.app.designsystem.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard

/**
 * A rounded (20dp) `surface` card with a hairline border. Mirrors `Card.swift`.
 *
 *   Card { Text(…) }
 *   Card(padding = 0.dp) { settingsRows }          // rows that draw their own padding
 *   Modifier.yardCard()                            // the same look as a modifier
 */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    padding: Dp = Spacing.l,
    background: Color = Color.yard.surface,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .yardCard(background)
            .padding(padding),
        content = content,
    )
}

/** Card chrome: fill, 20dp corners (clipped), hairline border. */
@Composable
fun Modifier.yardCard(background: Color = Color.yard.surface, radius: Dp = Radius.card): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(background, shape)
        .border(BorderStroke(1.dp, Color.yard.line), shape)
}

/** The app background, full-bleed (use on every screen's root). */
@Composable
fun Modifier.yardScreenBackground(): Modifier = this.background(Color.yard.bg)

/** A hairline divider in `line` (for rows inside cards). */
@Composable
fun YardDivider(modifier: Modifier = Modifier) = HorizontalDivider(modifier, thickness = 1.dp, color = Color.yard.line)

/**
 * A settings-style row: icon tile, title, optional value, chevron (reference 08-settings).
 * Mirrors `SettingsRow` in `Card.swift`. Make it tappable from outside (`Modifier.clickable`);
 * the row shows a chevron unless an [accessory] is given.
 *
 *   Card(padding = 0.dp) {
 *       SettingsRow("Appearance", Icons.Outlined.Contrast, value = "System", modifier = Modifier.clickable { … })
 *       YardDivider()
 *       SettingsRow("Notifications", Icons.Outlined.Notifications) { Switch(…) }
 *   }
 */
@Composable
fun SettingsRow(
    title: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    value: String? = null,
    tint: Color = Color.yard.ink,
    showsChevron: Boolean = true,
    accessory: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.m, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(
            Modifier.size(36.dp).background(Color.yard.surface2, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        }
        Text(title, style = YardFonts.body, color = tint, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (value != null) Text(value, style = YardFonts.callout, color = Color.yard.ink2, maxLines = 1)
        if (accessory != null) {
            accessory()
        } else if (showsChevron) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
        }
    }
}

/** A Switch in Yard colours (acid track when on), for [SettingsRow] accessories. */
@Composable
fun YardSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.yard.onAcid,
            checkedTrackColor = Color.yard.acid,
            checkedBorderColor = Color.yard.acid,
            uncheckedThumbColor = Color.yard.ink3,
            uncheckedTrackColor = Color.yard.surface2,
            uncheckedBorderColor = Color.yard.line,
        ),
    )
}

@Composable
private fun CardPreviewContent() {
    var on by remember { mutableStateOf(true) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Card { Text("Designers focused on impactful, considered streetwear.", style = YardFonts.body, color = Color.yard.ink) }
        Card(padding = 0.dp) {
            SettingsRow("Appearance", Icons.Outlined.Contrast, value = "System")
            YardDivider()
            SettingsRow("Drop alerts", Icons.Outlined.Notifications) { YardSwitch(on, { on = it }) }
            YardDivider()
            SettingsRow("Sign out", Icons.AutoMirrored.Outlined.Logout, tint = Color.yard.danger, showsChevron = false)
        }
        Spacer(Modifier.width(1.dp))
    }
}

@Preview(name = "Card — dark")
@Composable
private fun CardDarkPreview() = YardPreview(darkTheme = true) { CardPreviewContent() }

@Preview(name = "Card — light")
@Composable
private fun CardLightPreview() = YardPreview(darkTheme = false) { CardPreviewContent() }
