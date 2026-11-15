package space.yardstore.app.features.you

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material.icons.outlined.ZoomOut
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import coil3.SingletonImageLoader
import coil3.memory.MemoryCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardTheme
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardCrossfade
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.pressableClick
import java.io.File

// Settings › Your details › Photo: the avatar, its action sheet (library / camera / remove, with
// the removal confirmed in the sheet like the app's other destructive steps) and the full-screen
// square crop. Logic and copy: YouPhoto.kt.

/** The FileProvider authority for camera captures (AndroidManifest `…photos`, res/xml/yard_photo_paths.xml). */
internal fun youPhotoAuthority(context: Context) = "${context.packageName}.photos"

/** A fresh file in the app cache for the camera app to write into. */
private fun youCameraFile(context: Context): File {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() } // one capture at a time; nothing lingers
    return File(dir, "camera-${System.currentTimeMillis()}.jpg")
}

/** Forgets a replaced or removed photo's image so no cache shows it again. */
private fun youEvictPhoto(context: Context, src: String?) {
    val url = Config.url(src) ?: return
    runCatching {
        val loader = SingletonImageLoader.get(context)
        loader.memoryCache?.let { cache -> cache.keys.filter { it.key == url }.forEach { key: MemoryCache.Key -> cache.remove(key) } }
        loader.diskCache?.remove(url)
    }
}

@Composable
internal fun YouPhotoSection(account: YouAccount, accountModel: YouAccountModel, model: YouPhotoModel) {
    val context = LocalContext.current
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var showsSheet by rememberSaveable { mutableStateOf(false) }
    /** The sheet opens straight on "Remove your photo?" (the Remove button), not on its options. */
    var sheetConfirmsRemoval by rememberSaveable { mutableStateOf(false) }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    /**
     * The last photo saved from here (set only once its upload succeeded): drawn under the saved
     * one while it loads, so a replace never flashes the initials. Never drawn while a save failed.
     */
    var lastSaved by remember { mutableStateOf<ImageBitmap?>(null) }
    val demo = account.demo
    val hasPhoto = account.photo != null
    val canTakePhoto = remember(context) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }

    fun open(uri: Uri) {
        model.opening()
        scope.launch { model.choose(youLoadPickedPhoto(context, uri)) }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) open(uri) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri?.let(Uri::parse)
        if (ok && uri != null) open(uri)
    }

    fun saved(next: YouAccount) {
        val before = account.photo?.src
        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        if (before != next.photo?.src) youEvictPhoto(context, before)
        accountModel.apply(next)
        toast.show("Photo saved", Toast.Style.Success)
        scope.launch { session.refresh() } // the You header shows it too
    }
    val onSaved by rememberUpdatedState<(YouAccount) -> Unit>(::saved)

    YouSettingsGroup(
        "Photo",
        footer = if (model.problem == null) {
            if (demo) "Demo accounts can't change their photo." else "Shows to brands you message or buy from. JPEG, PNG or WebP, up to 10 MB."
        } else {
            null
        },
    ) {
        Row(
            Modifier.padding(Spacing.m),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            val pending = model.pending
            val failed = model.problem != null && pending != null
            val busy = model.busy
            Box(
                Modifier
                    .size(80.dp)
                    .pressableClick(
                        enabled = !demo && busy == null,
                        pressedScale = Motion.PRESSED_SCALE,
                        onClickLabel = if (hasPhoto || pending != null) "Change photo" else "Add photo",
                        haptic = true,
                    ) {
                        sheetConfirmsRemoval = false
                        showsSheet = true
                    }
                    .semantics { contentDescription = if (hasPhoto || pending != null) "Your photo" else "No photo. Your initials show instead." },
                contentAlignment = Alignment.Center,
            ) {
                YouAvatar(
                    photoSrc = account.photo?.src,
                    initials = youInitials(account.name),
                    size = 80.dp,
                    preview = if (failed) null else pending?.preview,
                    underlay = if (failed) null else lastSaved,
                    modifier = Modifier.graphicsLayer { alpha = if (failed) 0.6f else 1f },
                )
                if (busy == Busy.Upload) YouUploadRing(model.progress)
                if (busy == Busy.Remove) CircularProgressIndicator(color = Color.yard.onPhoto, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                if (!demo && busy == null) {
                    // The camera badge says the disc is tappable.
                    Box(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .size(26.dp)
                            .background(Color.yard.surface, CircleShape)
                            .padding(2.dp)
                            .background(Color.yard.ink, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, tint = Color.yard.bg, modifier = Modifier.size(13.dp))
                    }
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                YardButton(
                    if (hasPhoto || pending != null) "Change photo" else "Add photo",
                    icon = Icons.Outlined.PhotoCamera,
                    style = YardButtonStyle.Secondary,
                    size = YardButtonSize.Small,
                    fullWidth = false,
                    isLoading = model.isOpening,
                    enabled = !demo && busy == null,
                ) {
                    sheetConfirmsRemoval = false
                    showsSheet = true
                }
                if (hasPhoto && pending == null) {
                    YardButton(
                        "Remove",
                        icon = Icons.Outlined.Delete,
                        style = YardButtonStyle.Ghost,
                        size = YardButtonSize.Small,
                        fullWidth = false,
                        isLoading = busy == Busy.Remove,
                        enabled = !demo && busy == null,
                    ) {
                        sheetConfirmsRemoval = true
                        showsSheet = true
                    }
                }
                if (busy == Busy.Upload) {
                    Text("Uploading… ${(model.progress * 100).toInt()}%", style = YardFonts.caption.copy(fontFeatureSettings = "tnum"), color = Color.yard.ink3)
                }
            }
        }
        model.problem?.let { problem ->
            Column(
                Modifier.padding(start = Spacing.m, end = Spacing.m, bottom = Spacing.m),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Text(problem.text, style = YardFonts.callout, color = Color.yard.danger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    if (problem.retry && model.pending != null) {
                        YardButton("Try again", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, enabled = model.busy == null) {
                            val preview = model.pending?.preview
                            model.retry { next ->
                                lastSaved = preview
                                onSaved(next)
                            }
                        }
                    }
                    if (problem.signIn) {
                        YardButton("Sign in", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false) { router.present(Route.SignIn) }
                    }
                    if (model.pending != null && model.busy == null) {
                        YardButton("Discard", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false) { model.discard() }
                    } else if (model.pending == null) {
                        YardButton("OK", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false) { model.clearProblem() }
                    }
                }
            }
        }
    }

    if (showsSheet) {
        YouPhotoSheet(
            hasPhoto = hasPhoto && model.pending == null,
            canTakePhoto = canTakePhoto,
            confirmsRemoval = sheetConfirmsRemoval && hasPhoto && model.pending == null,
            onDismiss = { showsSheet = false },
            onLibrary = {
                showsSheet = false
                try {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                } catch (_: ActivityNotFoundException) {
                    model.fail("This phone has no photo picker. Update Android or try the camera.")
                }
            },
            onCamera = {
                showsSheet = false
                try {
                    val uri = FileProvider.getUriForFile(context, youPhotoAuthority(context), youCameraFile(context))
                    cameraUri = uri.toString()
                    camera.launch(uri)
                } catch (_: ActivityNotFoundException) {
                    model.fail("No camera app is available on this phone.")
                } catch (_: Exception) {
                    model.fail("The camera couldn't be opened. Try choosing a photo instead.")
                }
            },
            onRemove = {
                showsSheet = false
                val before = account.photo?.src
                model.remove { next ->
                    youEvictPhoto(context, before)
                    lastSaved = null
                    accountModel.apply(next)
                    toast.show("Photo removed", Toast.Style.Info)
                    scope.launch { session.refresh() }
                }
            },
        )
    }

    model.picked?.let { photo ->
        YouPhotoCropDialog(
            photo,
            onCancel = { model.cancelCrop() },
            onSave = { jpeg, preview ->
                model.save(jpeg, preview) { next ->
                    lastSaved = preview // only now: a failed or discarded crop never stands in for the saved photo
                    onSaved(next)
                }
            },
        )
    }
}

private typealias Busy = YouPhotoModel.Busy


/** Initials as the website draws them (first letters of the first two words). */
internal fun youInitials(name: String): String {
    val letters = name.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).map { it.first().uppercaseChar() }.joinToString("")
    return letters.ifEmpty { "Y" }
}

/** A thin progress ring over a dimmed avatar while the photo uploads. */
@Composable
private fun YouUploadRing(progress: Float) {
    val reduce = rememberReducedMotion()
    val shown by animateFloatAsState(progress, Motion.or(reduce) { Motion.snappy() }, label = "upload-progress")
    val ring = Color.yard.acid
    val track = Color.yard.onPhoto.copy(alpha = 0.3f)
    val dim = Color.yard.scrim.copy(alpha = 0.35f)
    Canvas(Modifier.size(80.dp).semantics { contentDescription = "Uploading, ${(progress * 100).toInt()} percent" }) {
        drawCircle(dim)
        val stroke = 3.dp.toPx()
        val inset = stroke / 2f + 2.dp.toPx()
        val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
        drawArc(track, 0f, 360f, false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke))
        drawArc(ring, -90f, 360f * shown.coerceIn(0.02f, 1f), false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round))
    }
}

/**
 * Library / camera / remove. Remove asks first, inside the sheet (like cancelling an order).
 * [confirmsRemoval] opens it straight on that question (the Remove button); "Keep photo" then
 * closes the sheet instead of stepping back to the options.
 */
@Composable
internal fun YouPhotoSheet(
    hasPhoto: Boolean,
    canTakePhoto: Boolean,
    confirmsRemoval: Boolean = false,
    onDismiss: () -> Unit,
    onLibrary: () -> Unit,
    onCamera: () -> Unit,
    onRemove: () -> Unit,
) {
    var confirming by rememberSaveable { mutableStateOf(confirmsRemoval) }
    YouSheet(onDismiss = onDismiss) { close ->
        YardCrossfade(confirming, label = "photo-sheet") { asking ->
            if (!asking) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = Spacing.l)) {
                    YardSheetHeader("Profile photo", subtitle = "Shows to brands you message or buy from.", onClose = close)
                    Column(Modifier.padding(horizontal = Spacing.s)) {
                        SettingsRow("Choose from library", Icons.Outlined.PhotoLibrary, Modifier.youRowClick(onClick = onLibrary), showsChevron = false)
                        if (canTakePhoto) {
                            SettingsRow("Take photo", Icons.Outlined.PhotoCamera, Modifier.youRowClick(onClick = onCamera), showsChevron = false)
                        }
                        if (hasPhoto) {
                            SettingsRow(
                                "Remove photo", Icons.Outlined.Delete,
                                Modifier.youRowClick { confirming = true },
                                tint = Color.yard.danger,
                                showsChevron = false,
                            )
                        }
                    }
                }
            } else {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = Spacing.gutter, vertical = Spacing.l),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Remove your photo?", style = YardFonts.title, color = Color.yard.ink, textAlign = TextAlign.Center)
                    Text(
                        "Brands see your initials instead. You can add a new photo any time.",
                        style = YardFonts.callout,
                        color = Color.yard.ink2,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(Spacing.s))
                    YardButton("Remove photo", style = YardButtonStyle.Destructive, onClick = onRemove)
                    YardButton("Keep photo", style = YardButtonStyle.Secondary) { if (confirmsRemoval) close() else confirming = false }
                }
            }
        }
    }
}

// MARK: - Crop

/** The square crop step, full screen and always dark (like the product photo viewer). */
@Composable
internal fun YouPhotoCropDialog(photo: YouPickedPhoto, onCancel: () -> Unit, onSave: (ByteArray, ImageBitmap) -> Unit) {
    // Full screen: only Cancel / Save or system back leave it (an outside tap must never drop the crop).
    Dialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        YardTheme(darkTheme = true) { YouPhotoCropScreen(photo, onCancel, onSave) }
    }
}

/**
 * Drag to move, pinch (or the slider / buttons) to zoom, double-tap to zoom in or back out. The
 * photo always covers the square; outside the circle is dimmed, which is what a round avatar shows.
 * TalkBack: custom actions move and zoom it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun YouPhotoCropScreen(photo: YouPickedPhoto, onCancel: () -> Unit, onSave: (ByteArray, ImageBitmap) -> Unit) {
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var crop by remember(photo) { mutableStateOf(YouCropState()) }
    var framePx by remember { mutableFloatStateOf(0f) }
    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val img = photo.size

    fun zoomTo(z: Float, animated: Boolean = false) {
        if (framePx <= 0f) return
        val from = crop
        val to = YouPhotoCrop.zoomTo(img, framePx, from, z)
        if (!animated || reduce) {
            crop = to
            return
        }
        scope.launch {
            animate(0f, 1f, animationSpec = Motion.spring()) { t, _ ->
                crop = YouPhotoCrop.zoomTo(img, framePx, from, from.zoom + (to.zoom - from.zoom) * t)
            }
        }
    }
    fun move(dx: Float, dy: Float) {
        crop = crop.copy(offset = YouPhotoCrop.clampOffset(img, framePx, crop.zoom, YouCropOffset(crop.offset.x + dx, crop.offset.y + dy)))
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color.yard.bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = Spacing.gutter),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.fillMaxWidth().padding(top = Spacing.l, bottom = Spacing.xl), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Position your photo", style = YardFonts.title, color = Color.yard.ink, modifier = Modifier.semantics { heading() })
            Text(
                "Drag to move it. Pinch to fit your face in the circle.",
                style = YardFonts.callout,
                color = Color.yard.ink2,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = Spacing.xs),
            )
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val side = minOf(maxWidth, maxHeight, 420.dp)
            val sidePx = with(LocalDensity.current) { side.toPx() }
            LaunchedEffect(sidePx) {
                if (framePx > 0f && framePx != sidePx) {
                    // Keep the same framing on a resize (rotation, split screen).
                    val k = sidePx / framePx
                    crop = crop.copy(offset = YouPhotoCrop.clampOffset(img, sidePx, crop.zoom, YouCropOffset(crop.offset.x * k, crop.offset.y * k)))
                }
                framePx = sidePx
            }
            val dim = Color.yard.scrim.copy(alpha = 0.6f)
            val ring = Color.yard.onPhoto.copy(alpha = 0.55f)
            Canvas(
                Modifier
                    .size(side)
                    .pointerInput(photo) {
                        detectTransformGestures { centroid, pan, zoom, _ ->
                            val f = size.toSize()
                            val focus = YouCropOffset(centroid.x - f.width / 2f, centroid.y - f.height / 2f)
                            crop = YouPhotoCrop.gesture(img, f.width, crop, zoom, focus, YouCropOffset(pan.x, pan.y))
                        }
                    }
                    .pointerInput(photo) {
                        detectTapGestures(onDoubleTap = {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            zoomTo(if (crop.zoom < 1.75f) 2f else 1f, animated = true)
                        })
                    }
                    .semantics {
                        contentDescription = "Photo crop area. Zoom ${"%.1f".format(crop.zoom)} times."
                        customActions = listOf(
                            CustomAccessibilityAction("Move left") { move(sidePx / 12f, 0f); true },
                            CustomAccessibilityAction("Move right") { move(-sidePx / 12f, 0f); true },
                            CustomAccessibilityAction("Move up") { move(0f, sidePx / 12f); true },
                            CustomAccessibilityAction("Move down") { move(0f, -sidePx / 12f); true },
                            CustomAccessibilityAction("Zoom in") { zoomTo(crop.zoom + 0.25f); true },
                            CustomAccessibilityAction("Zoom out") { zoomTo(crop.zoom - 0.25f); true },
                        )
                    },
            ) {
                val frame = size.width
                val s = YouPhotoCrop.displayScale(img, frame, crop.zoom)
                val o = YouPhotoCrop.clampOffset(img, frame, crop.zoom, crop.offset)
                val w = img.width * s
                val h = img.height * s
                clipRect {
                    drawImage(
                        photo.image,
                        dstOffset = androidx.compose.ui.unit.IntOffset(((frame - w) / 2f + o.x).toInt(), ((frame - h) / 2f + o.y).toInt()),
                        dstSize = IntSize(w.toInt(), h.toInt()),
                        filterQuality = androidx.compose.ui.graphics.FilterQuality.High,
                    )
                    // Dim everything outside the circle a round avatar shows.
                    val hole = Path().apply {
                        fillType = PathFillType.EvenOdd
                        addRect(androidx.compose.ui.geometry.Rect(0f, 0f, frame, frame))
                        addOval(androidx.compose.ui.geometry.Rect(0f, 0f, frame, frame))
                    }
                    drawPath(hole, dim)
                    drawCircle(ring, radius = frame / 2f - 0.5.dp.toPx(), style = Stroke(1.dp.toPx()))
                }
            }
        }
        Row(
            Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = Spacing.l),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            IconButton(onClick = { zoomTo(crop.zoom - 0.25f, animated = true) }) {
                Icon(Icons.Outlined.ZoomOut, contentDescription = "Zoom out", tint = Color.yard.ink2)
            }
            val sliderColors = SliderDefaults.colors(
                thumbColor = Color.yard.ink,
                activeTrackColor = Color.yard.acid,
                inactiveTrackColor = Color.yard.ink.copy(alpha = 0.18f),
            )
            Slider(
                value = crop.zoom,
                onValueChange = { zoomTo(it) },
                valueRange = YouPhotoCrop.MIN_ZOOM..YouPhotoCrop.MAX_ZOOM,
                modifier = Modifier.weight(1f).semantics { contentDescription = "Zoom" },
                colors = sliderColors,
                // A round thumb on a thin track (Yard's look, not the stock bar thumb).
                thumb = { Box(Modifier.size(22.dp).background(Color.yard.ink, CircleShape)) },
                track = { state ->
                    SliderDefaults.Track(
                        sliderState = state,
                        modifier = Modifier.height(4.dp),
                        colors = sliderColors,
                        drawStopIndicator = null,
                        thumbTrackGapSize = 0.dp,
                    )
                },
            )
            IconButton(onClick = { zoomTo(crop.zoom + 0.25f, animated = true) }) {
                Icon(Icons.Outlined.ZoomIn, contentDescription = "Zoom in", tint = Color.yard.ink2)
            }
        }
        problem?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger, textAlign = TextAlign.Center) }
        Column(
            Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(top = Spacing.m, bottom = Spacing.l),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            YardButton("Save photo", isLoading = saving, enabled = framePx > 0f) {
                if (saving) return@YardButton
                saving = true
                problem = null
                scope.launch {
                    val frame = framePx
                    val state = crop
                    val result = withContext(Dispatchers.Default) {
                        runCatching {
                            val square = youRenderCrop(photo, frame, state)
                            youJpeg(square) to square.asImageBitmap()
                        }
                    }
                    result.onSuccess { (jpeg, preview) -> onSave(jpeg, preview) }
                        .onFailure {
                            saving = false
                            problem = "This photo couldn't be prepared. Try another one."
                        }
                }
            }
            YardButton("Cancel", style = YardButtonStyle.Secondary, enabled = !saving, onClick = onCancel)
        }
    }
}
