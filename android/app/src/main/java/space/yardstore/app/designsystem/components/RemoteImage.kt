package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.crossfade
import space.yardstore.app.core.Config
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * An async remote image: shimmer while loading, fade-in on arrival, [placeholder] on failure.
 * Mirrors `RemoteImage.swift`. It FILLS the size you give it, so size it from outside:
 *
 *   RemoteImage(product.coverUrl, Modifier.fillMaxWidth().aspectRatio(0.8f).clip(YardShapes.image))   // tile
 *   RemoteImage(brand.logoSrc, Modifier.size(80.dp), contentScale = ContentScale.Fit)                  // relative path OK
 *   RemoteImage(url, Modifier.size(60.dp)) { Icon(Icons.Outlined.Image, null) }                        // custom failure
 *
 * [url] may be absolute or an API path (`/api/media/…`): it is resolved with [Config.url].
 * [maxPixelSize] caps the decoded size (pixels, longest side): ~700 for grid tiles, 1600 for
 * full-screen photos. Images go through the app's Coil loader (OkHttp with Yard's cookies +
 * `X-Yard-Client`, memory and disk caches).
 */
@Composable
fun RemoteImage(
    url: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    maxPixelSize: Int = 1200,
    contentDescription: String? = null,
    placeholder: @Composable () -> Unit = { RemoteImageFallback() },
) {
    val resolved = remember(url) { Config.url(url) }
    Box(modifier.clipToBounds(), contentAlignment = Alignment.Center) {
        if (resolved == null) {
            Box(Modifier.matchParentSize().background(Color.yard.surface2), contentAlignment = Alignment.Center) { placeholder() }
            return@Box
        }
        val context = LocalContext.current
        val request = remember(resolved, maxPixelSize) {
            ImageRequest.Builder(context)
                .data(resolved)
                .size(maxPixelSize)
                .crossfade(250)
                .build()
        }
        var state: AsyncImagePainter.State by remember(resolved) { mutableStateOf(AsyncImagePainter.State.Empty) }
        AsyncImage(
            model = request,
            contentDescription = contentDescription,
            modifier = Modifier.matchParentSize(),
            contentScale = contentScale,
            onState = { state = it },
        )
        when (state) {
            is AsyncImagePainter.State.Error ->
                Box(Modifier.matchParentSize().background(Color.yard.surface2), contentAlignment = Alignment.Center) { placeholder() }
            is AsyncImagePainter.State.Success -> Unit
            else -> Skeleton(Modifier.matchParentSize(), cornerRadius = 0.dp)
        }
    }
}

/** The default failure placeholder: a muted photo glyph. */
@Composable
fun RemoteImageFallback() {
    Icon(Icons.Outlined.Image, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(22.dp))
}

@Preview(name = "RemoteImage — dark")
@Composable
private fun RemoteImageDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RemoteImage(null, Modifier.fillMaxWidth().aspectRatio(0.8f).clip(YardShapes.image))
        RemoteImage("https://yardstore.space/does-not-exist.jpg", Modifier.fillMaxWidth().height(120.dp).clip(YardShapes.image))
    }
}

@Preview(name = "RemoteImage — light")
@Composable
private fun RemoteImageLightPreview() = YardPreview(darkTheme = false) {
    RemoteImage(null, Modifier.padding(16.dp).fillMaxWidth().aspectRatio(1f).clip(YardShapes.image))
}
