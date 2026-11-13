package space.yardstore.app.designsystem.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.designsystem.YardCondensedFamily
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard
import androidx.compose.ui.text.TextStyle

/**
 * A round brand logo with a monogram fallback and optional verified tick. Mirrors `BrandAvatar.swift`.
 *
 *   BrandAvatar(name = brand.name, logoUrl = brand.logoUrl, size = 44.dp, verified = brand.verified)
 *   BrandAvatar(name = "Acme")                          // monogram "AC"
 */
@Composable
fun BrandAvatar(
    name: String,
    modifier: Modifier = Modifier,
    logoUrl: String? = null,
    size: Dp = 40.dp,
    verified: Boolean = false,
) {
    val density = LocalDensity.current
    val label = if (verified) "$name, verified" else name
    Box(modifier.size(size).clearAndSetSemantics { contentDescription = label }) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(Color.yard.surface2, CircleShape)
                .border(BorderStroke(1.dp, Color.yard.line), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (logoUrl != null) {
                val px = with(density) { (size * 3).roundToPx() }
                RemoteImage(logoUrl, Modifier.size(size), maxPixelSize = px) { Monogram(name, size) }
            } else {
                Monogram(name, size)
            }
        }
        if (verified) {
            val badge = maxOf(10.dp, size * 0.3f)
            Icon(
                Icons.Filled.Verified,
                contentDescription = null,
                tint = Color.yard.violet,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = size * 0.06f, y = size * 0.06f)
                    .size(badge)
                    .background(Color.yard.bg, CircleShape)
                    .padding(1.dp),
            )
        }
    }
}

@Composable
private fun Monogram(name: String, size: Dp) {
    val fontSize = with(LocalDensity.current) { (size * 0.36f).toSp() }
    Text(
        BrandCard.monogram(name),
        style = TextStyle(fontFamily = YardCondensedFamily, fontWeight = FontWeight.Black, fontSize = fontSize),
        color = Color.yard.ink,
    )
}

@Preview(name = "Avatar — dark")
@Composable
private fun AvatarDarkPreview() = YardPreview(darkTheme = true) {
    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        BrandAvatar("Acme Studio", size = 56.dp, verified = true)
        BrandAvatar("Lagos Thread")
        BrandAvatar("Ø", size = 32.dp)
    }
}

@Preview(name = "Avatar — light")
@Composable
private fun AvatarLightPreview() = YardPreview(darkTheme = false) {
    BrandAvatar("Acme Studio", Modifier.padding(16.dp), size = 72.dp, verified = true)
}
