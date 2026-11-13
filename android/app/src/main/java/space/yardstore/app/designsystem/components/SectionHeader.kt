package space.yardstore.app.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard

/**
 * A section title row with an optional subtitle and trailing action ("See all"). Has gutter padding.
 * Mirrors `SectionHeader.swift`.
 *
 *   SectionHeader("New drops", subtitle = "This week", actionTitle = "See all") { router.push(Route.Drops) }
 *   SectionHeader("Brands like this", display = true)   // heavy condensed capitals
 */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    /** Use the display face (uppercase, condensed) instead of the title face. */
    display: Boolean = false,
    actionTitle: String? = null,
    action: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) { heading() }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (display) {
                YardDisplayText(title, size = 26.sp)
            } else {
                Text(title, style = YardFonts.title, color = Color.yard.ink)
            }
            if (subtitle != null) Text(subtitle, style = YardFonts.caption, color = Color.yard.ink2)
        }
        Spacer(Modifier.width(Spacing.s))
        if (actionTitle != null && action != null) {
            Row(
                Modifier.pressableClick(onClick = action).padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(actionTitle, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = Color.yard.ink2)
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Preview(name = "SectionHeader — dark")
@Composable
private fun SectionHeaderDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        SectionHeader("New drops", subtitle = "This week", actionTitle = "See all") {}
        SectionHeader("Brands like this", display = true)
    }
}

@Preview(name = "SectionHeader — light")
@Composable
private fun SectionHeaderLightPreview() = YardPreview(darkTheme = false) {
    SectionHeader("Following", Modifier.padding(vertical = 16.dp), actionTitle = "Manage") {}
}
