package space.yardstore.app.designsystem.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.GlassStyle
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yardGlass
import space.yardstore.app.designsystem.yard

/**
 * A round frosted icon button for use over photos and headers (close ×, "…", share, heart).
 * Mirrors `GlassIconButton.swift`. The glass is [yardGlass] (clear style): a translucent disc with
 * a top-lit sheen and rim. It sits inside page content, so it never blurs (no backdrop of its own).
 *
 *   GlassIconButton(Icons.Filled.Close, contentDescription = "Close") { router.pop() }
 *   GlassIconButton(if (saved) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder, "Save",
 *                   tint = if (saved) Color.yard.danger else null) { … }
 */
@Composable
fun GlassIconButton(
    icon: ImageVector,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    /** Icon colour; defaults to `ink` (readable on the glass in both modes). */
    tint: Color? = null,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .size(size)
            .semantics { this.contentDescription = contentDescription }
            .pressableClick(pressedScale = 0.92f, onClick = onClick)
            .yardGlass(CircleShape, style = GlassStyle.Clear, elevation = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint ?: Color.yard.ink, modifier = Modifier.size(size * 0.45f))
    }
}

@Preview(name = "Glass — dark")
@Composable
private fun GlassDarkPreview() = YardPreview(darkTheme = true) {
    Row(
        Modifier.background(Brush.verticalGradient(listOf(Color.yard.purple, Color.yard.bg))).padding(24.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        GlassIconButton(Icons.Filled.Close, "Close") {}
        GlassIconButton(Icons.Filled.MoreHoriz, "More") {}
        GlassIconButton(Icons.Filled.Favorite, "Saved", tint = Color.yard.danger) {}
    }
}

@Preview(name = "Glass — light")
@Composable
private fun GlassLightPreview() = YardPreview(darkTheme = false) {
    Row(Modifier.background(Color.yard.surface2).padding(24.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        GlassIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back") {}
        GlassIconButton(Icons.Outlined.Share, "Share") {}
    }
}
