package space.yardstore.app.features.you

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.crossfade
import space.yardstore.app.core.Config
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.yard

/**
 * The signed-in person's avatar: their profile photo, round and aspect-filled, over the acid disc
 * with their initials. The initials stay underneath, so a missing, loading or failed photo (a
 * removed photo answers 404) shows them; the photo fades in when it arrives (instantly under
 * reduced motion). Used in the You header, Settings and Your details.
 *
 * [preview] (a just-cropped photo, still uploading) wins over [photoSrc]; [underlay] is drawn
 * while [photoSrc] loads (the last upload, so a replace never flashes the initials).
 */
@Composable
fun YouAvatar(
    photoSrc: String?,
    initials: String,
    size: Dp,
    modifier: Modifier = Modifier,
    preview: ImageBitmap? = null,
    underlay: ImageBitmap? = null,
    initialsSize: TextUnit = (size.value * 0.4f).sp,
) {
    val reduce = rememberReducedMotion()
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.yard.acid, CircleShape)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = YardFonts.display(initialsSize), color = Color.yard.onAcid)
        when {
            preview != null -> Image(preview, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else -> {
                if (underlay != null) Image(underlay, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                val resolved = remember(photoSrc) { Config.url(photoSrc) }
                if (resolved != null) {
                    val context = LocalContext.current
                    val px = with(LocalDensity.current) { size.roundToPx() }.coerceIn(48, 512)
                    val request = remember(resolved, px) {
                        ImageRequest.Builder(context).data(resolved).size(px * 2).crossfade(false).build()
                    }
                    var loaded by remember(resolved) { mutableStateOf(false) }
                    val alpha by animateFloatAsState(if (loaded) 1f else 0f, Motion.or(reduce) { Motion.fade() }, label = "avatar-fade")
                    AsyncImage(
                        model = request,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha },
                        onState = { loaded = it is AsyncImagePainter.State.Success },
                    )
                }
            }
        }
        // A hairline ring lifts the disc (or the photo) off the page.
        Box(Modifier.fillMaxSize().border(BorderStroke(1.dp, Color.yard.ink.copy(alpha = 0.08f)), CircleShape))
    }
}
