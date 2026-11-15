package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.designsystem.YardArtwork
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.yard

/**
 * A designed placeholder for a brand's photo-less surfaces (drop cards, heroes, thumbnails): the
 * brand's tone as a lit gradient with its initials set large in the display face. Never a grey
 * box with a photo glyph. Decorative (no semantics). Mirrors `BrandArtwork.swift`.
 *
 *   RemoteImage(drop.imageUrl, Modifier.fillMaxSize(), placeholder = { BrandArtwork(drop.brandName, key = drop.brand.id) })
 */
@Composable
fun BrandArtwork(name: String, modifier: Modifier = Modifier, key: String? = null) {
    val (light, dark) = remember(key, name) { YardArtwork.tone(key ?: name) }
    val initials = remember(name) { BrandCard.monogram(name) }
    BoxWithConstraints(
        modifier
            .fillMaxSize()
            .clipToBounds()
            .clearAndSetSemantics { }
            .background(Brush.linearGradient(listOf(light, dark), start = Offset.Zero, end = Offset.Infinite)),
    ) {
        // A soft light source at the top left, as if the fabric were lit from a window.
        Box(
            Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    0f to Color.yard.onPhoto.copy(alpha = 0.16f),
                    1f to Color.yard.onPhoto.copy(alpha = 0f),
                    center = Offset.Zero,
                    radius = constraints.maxWidth.toFloat().coerceAtLeast(1f) * 1.1f,
                ),
            ),
        )
        val compact = maxWidth < 140.dp
        val density = LocalDensity.current
        if (compact) {
            // Thumbnails: the initials, centred and quiet.
            val size = with(density) { (maxWidth * 0.42f).toSp() }
            Text(
                initials,
                style = YardFonts.display(size),
                color = Color.yard.onPhoto.copy(alpha = 0.72f),
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier = Modifier.align(Alignment.Center),
            )
        } else {
            // Cards and heroes: an oversized wordmark bleeding off the top right, editorial and subtle.
            val size = with(density) { (maxWidth * 0.78f).toSp() }
            Text(
                initials,
                style = YardFonts.display(size).copy(letterSpacing = (-0.04).em, lineHeight = size),
                color = Color.yard.onPhoto.copy(alpha = 0.13f),
                maxLines = 1,
                softWrap = false,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .wrapContentSize(unbounded = true, align = Alignment.TopEnd)
                    .offset(x = maxWidth * 0.06f, y = -(maxWidth * 0.08f)),
            )
        }
    }
}
