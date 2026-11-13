package space.yardstore.app.designsystem.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/** iOS `YardButton.Style`. */
enum class YardButtonStyle {
    /** Acid fill, black text — the one main action on a screen. */
    Primary,
    /** `surface2` fill, `ink` text. */
    Secondary,
    /** White fill, black text — on top of photos (brand hero Follow). */
    OnPhoto,
    /** `danger` text on `surface2`. */
    Destructive,
    /** Text only, `ink`. */
    Ghost,
    /** `ink` fill, `bg` text — strong neutral (e.g. selected state, "Following"). */
    Inverted;

    val foreground: Color
        @Composable get() = when (this) {
            Primary -> Color.yard.onAcid
            Secondary -> Color.yard.ink
            OnPhoto -> Color.yard.onPhotoInk
            Destructive -> Color.yard.danger
            Ghost -> Color.yard.ink
            Inverted -> Color.yard.bg
        }

    val background: Color
        @Composable get() = when (this) {
            Primary -> Color.yard.acid
            Secondary -> Color.yard.surface2
            OnPhoto -> Color.yard.onPhoto
            Destructive -> Color.yard.surface2
            Ghost -> Color.Transparent
            Inverted -> Color.yard.ink
        }
}

/** iOS `YardButton.Size`: large 52, medium 44, small 34 (caption text). */
enum class YardButtonSize(val height: Dp) {
    Large(52.dp),
    Medium(44.dp),
    Small(34.dp),
}

/**
 * Yard's pill button. Mirrors `YardButton.swift`.
 *
 *   YardButton("Add to bag", icon = Icons.Outlined.ShoppingBag, isLoading = adding) { … }   // primary (acid)
 *   YardButton("Choose size", style = YardButtonStyle.Secondary, fullWidth = false) { … }
 *   YardButton("Follow", style = YardButtonStyle.OnPhoto) { … }
 *   YardButton("Delete address", style = YardButtonStyle.Destructive) { … }
 *   YardButton("Clear", style = YardButtonStyle.Ghost, size = YardButtonSize.Small) { … }
 *
 * Disable with `enabled = false`. While [isLoading] the label is replaced by a spinner and taps
 * are ignored. Add haptics at the call site when the tap changes state.
 */
@Composable
fun YardButton(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    style: YardButtonStyle = YardButtonStyle.Primary,
    size: YardButtonSize = YardButtonSize.Large,
    isLoading: Boolean = false,
    fullWidth: Boolean = true,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val fg = style.foreground
    val textStyle = if (size == YardButtonSize.Small) YardFonts.captionEmphasis else YardFonts.bodyEmphasis
    YardPillSurface(
        style = style,
        enabled = enabled,
        modifier = modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .semantics {
                contentDescription = title
                if (isLoading) stateDescription = "Loading"
            },
        onClick = { if (!isLoading) onClick() },
    ) {
        Box(
            modifier = Modifier
                .height(size.height)
                .padding(horizontal = if (size == YardButtonSize.Small) Spacing.m else Spacing.xl),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.alpha(if (isLoading) 0f else 1f),
            ) {
                if (icon != null) {
                    Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(if (size == YardButtonSize.Small) 16.dp else 20.dp))
                }
                Text(title, style = textStyle, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (isLoading) {
                CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/**
 * The pill chrome behind [YardButton] (iOS `YardPillButtonStyle`): style colours, press scale,
 * 40% opacity when disabled. Use it for custom pill labels.
 */
@Composable
fun YardPillSurface(
    style: YardButtonStyle,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, Motion.snappy(), label = "pill-press")
    Box(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                alpha = if (enabled) 1f else 0.4f
            }
            .clip(YardShapes.pill)
            .background(style.background, YardShapes.pill)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

@Composable
private fun ButtonsPreviewContent() {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        YardButton("Add to bag", icon = Icons.Outlined.ShoppingBag) {}
        YardButton("Paying…", isLoading = true) {}
        YardButton("Choose size", style = YardButtonStyle.Secondary) {}
        YardButton("Follow", style = YardButtonStyle.OnPhoto) {}
        YardButton("Remove", style = YardButtonStyle.Destructive, size = YardButtonSize.Medium) {}
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            YardButton("Following", style = YardButtonStyle.Inverted, size = YardButtonSize.Small, fullWidth = false) {}
            YardButton("Clear", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false) {}
            YardButton("Disabled", size = YardButtonSize.Small, fullWidth = false, enabled = false) {}
        }
    }
}

@Preview(name = "Buttons — dark")
@Composable
private fun ButtonsDarkPreview() = YardPreview(darkTheme = true) { ButtonsPreviewContent() }

@Preview(name = "Buttons — light")
@Composable
private fun ButtonsLightPreview() = YardPreview(darkTheme = false) { ButtonsPreviewContent() }
