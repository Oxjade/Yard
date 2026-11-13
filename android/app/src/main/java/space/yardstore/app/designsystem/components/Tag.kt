package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/** iOS `Tag.Style`. */
enum class TagStyle { Neutral, Acid, Violet, Danger, Success, OnPhoto }

/**
 * A small non-interactive label: "New arrival", "Sold out", "Draw", "Founding brand". Mirrors `Tag.swift`.
 *
 *   Tag("New arrival")                                // neutral
 *   Tag("Live", style = TagStyle.Acid)
 *   Tag("Sold out", style = TagStyle.Danger)
 *   Tag("Founding", style = TagStyle.Violet, icon = Icons.Filled.Verified)
 *   Tag("-20%", style = TagStyle.OnPhoto)              // over images
 */
@Composable
fun Tag(text: String, modifier: Modifier = Modifier, style: TagStyle = TagStyle.Neutral, icon: ImageVector? = null) {
    val c = Color.yard
    val (fg, bg) = when (style) {
        TagStyle.Neutral -> c.ink to c.surface2
        TagStyle.Acid -> c.onAcid to c.acid
        TagStyle.Violet -> c.violet to c.violet.copy(alpha = 0.14f)
        TagStyle.Danger -> c.danger to c.danger.copy(alpha = 0.14f)
        TagStyle.Success -> c.success to c.success.copy(alpha = 0.14f)
        TagStyle.OnPhoto -> c.onPhotoInk to c.onPhoto.copy(alpha = 0.92f)
    }
    Row(
        modifier = modifier
            .background(bg, YardShapes.pill)
            .padding(horizontal = Spacing.s, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(12.dp))
        Text(text, style = YardFonts.captionEmphasis, color = fg, maxLines = 1)
    }
}

@Composable
private fun TagsPreviewContent() {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tag("New arrival")
            Tag("Live", style = TagStyle.Acid)
            Tag("Founding", style = TagStyle.Violet, icon = Icons.Filled.Verified)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tag("Sold out", style = TagStyle.Danger)
            Tag("Delivered", style = TagStyle.Success)
            Tag("-20%", style = TagStyle.OnPhoto)
        }
    }
}

@Preview(name = "Tags — dark")
@Composable
private fun TagsDarkPreview() = YardPreview(darkTheme = true) { TagsPreviewContent() }

@Preview(name = "Tags — light")
@Composable
private fun TagsLightPreview() = YardPreview(darkTheme = false) { TagsPreviewContent() }
