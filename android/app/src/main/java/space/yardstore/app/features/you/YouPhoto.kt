package space.yardstore.app.features.you

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.createBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.ForwardingSink
import okio.Sink
import okio.buffer
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.networking.MultipartPart
import space.yardstore.app.core.networking.await
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// You › Settings › Your details › Photo (docs/APP.md › Profile photo; website
// src/components/market/account/account-photo.tsx and src/lib/media/photo-crop.ts).
//   POST   /api/account/photo?as=shopper  multipart, one part `file` → { account } with `photo` set
//   DELETE /api/account/photo?as=shopper                          → { account } with `photo: null`
// Pick (system photo picker or the camera app) → square crop → JPEG ≤ 1024 px, quality 0.9 (the
// re-encode drops EXIF / GPS) → upload. The new photo shows at once while it uploads; on failure
// the old one comes back with the reason and, when sending again could work, Try again.

// MARK: - API model

/** `AccountDto.photo`: one size only, the uploaded file. `src` is cookie-scoped (`?as=shopper`). */
@Serializable
data class YouAccountPhoto(
    val mediaId: String = "",
    val src: String = "",
    val width: Int = 0,
    val height: Int = 0,
)

// MARK: - Crop geometry (a port of photo-crop.ts: plain math, unit tested)

data class YouCropSize(val width: Float, val height: Float)

/** The photo's centre relative to the frame's centre, in frame pixels. */
data class YouCropOffset(val x: Float, val y: Float) {
    companion object {
        val Zero = YouCropOffset(0f, 0f)
    }
}

/** The square of the source image the frame shows, in image pixels. */
data class YouCropSquare(val sx: Float, val sy: Float, val size: Float)

/** A crop position: zoom (1 = the photo just covers the frame) and offset. */
data class YouCropState(val zoom: Float = YouPhotoCrop.MIN_ZOOM, val offset: YouCropOffset = YouCropOffset.Zero)

/**
 * The crop frame is a square of `frame` pixels. At zoom 1 the photo just covers it (its short side
 * fills it); the person drags it by an offset and zooms up to 4×. Same numbers as the website.
 */
object YouPhotoCrop {
    const val MIN_ZOOM = 1f
    const val MAX_ZOOM = 4f
    /** The longest side Yard uploads, and the shortest the server takes. */
    const val OUTPUT_MAX = 1024
    const val MIN_SIDE = 64
    /** The upload cap (10 MB), checked on the original file before it is opened. */
    const val MAX_BYTES = 10L * 1024 * 1024
    const val JPEG_QUALITY = 90
    /** Longest side the picked photo is decoded at (enough for a 1024 px crop at 4× on most photos). */
    const val DECODE_MAX = 4096

    fun clampZoom(z: Float): Float = if (z.isFinite()) z.coerceIn(MIN_ZOOM, MAX_ZOOM) else MIN_ZOOM

    /** Image pixels → frame pixels at this zoom. */
    fun displayScale(img: YouCropSize, frame: Float, zoom: Float): Float =
        frame / min(img.width, img.height) * clampZoom(zoom)

    /** Keeps the frame covered: the photo's edge never moves inside the frame. */
    fun clampOffset(img: YouCropSize, frame: Float, zoom: Float, offset: YouCropOffset): YouCropOffset {
        val s = displayScale(img, frame, zoom)
        val maxX = max(0f, (img.width * s - frame) / 2f)
        val maxY = max(0f, (img.height * s - frame) / 2f)
        fun c(v: Float, m: Float): Float = if (v.isFinite()) v.coerceIn(-m, m) + 0f else 0f
        return YouCropOffset(c(offset.x, maxX), c(offset.y, maxY))
    }

    /** The square of the original image the frame shows (for the bitmap copy). */
    fun sourceSquare(img: YouCropSize, frame: Float, zoom: Float, offset: YouCropOffset): YouCropSquare {
        val s = displayScale(img, frame, zoom)
        val o = clampOffset(img, frame, zoom, offset)
        val size = minOf(frame / s, img.width, img.height)
        val cx = img.width / 2f - o.x / s
        val cy = img.height / 2f - o.y / s
        val sx = (cx - size / 2f).coerceIn(0f, img.width - size)
        val sy = (cy - size / 2f).coerceIn(0f, img.height - size)
        return YouCropSquare(sx, sy, size)
    }

    /** The uploaded square's side: the cropped area, never scaled up, at most [OUTPUT_MAX]. */
    fun outputSide(sourceSize: Float): Int = max(1, min(OUTPUT_MAX, sourceSize.roundToInt()))

    /** Zooming (slider, buttons) keeps the point under the frame's centre where it is. */
    fun zoomTo(img: YouCropSize, frame: Float, from: YouCropState, nextZoom: Float): YouCropState {
        val zoom = clampZoom(nextZoom)
        val k = zoom / clampZoom(from.zoom)
        return YouCropState(zoom, clampOffset(img, frame, zoom, YouCropOffset(from.offset.x * k, from.offset.y * k)))
    }

    /**
     * A pinch: zooms by [factor] around [focus] (relative to the frame's centre, frame pixels) so
     * the point under the fingers stays under them, then moves by [pan]. Clamped like a drag.
     */
    fun gesture(img: YouCropSize, frame: Float, from: YouCropState, factor: Float, focus: YouCropOffset, pan: YouCropOffset): YouCropState {
        val zoom = clampZoom(from.zoom * (if (factor.isFinite() && factor > 0f) factor else 1f))
        val k = zoom / clampZoom(from.zoom)
        val x = focus.x - (focus.x - from.offset.x) * k + pan.x
        val y = focus.y - (focus.y - from.offset.y) * k + pan.y
        return YouCropState(zoom, clampOffset(img, frame, zoom, YouCropOffset(x, y)))
    }

    /** Whether a picked file can be offered to the cropper, before it is decoded. HEIC is tried. */
    fun fileProblem(type: String?, size: Long?, name: String? = null): String? {
        val t = type.orEmpty().lowercase()
        val heic = t == "image/heic" || t == "image/heif" || Regex("\\.(heic|heif)$", RegexOption.IGNORE_CASE).containsMatchIn(name.orEmpty())
        val known = t == "image/jpeg" || t == "image/jpg" || t == "image/png" || t == "image/webp"
        return when {
            !heic && !known -> "Use a JPEG, PNG or WebP photo."
            size != null && size > MAX_BYTES -> "Photos can be up to 10 MB."
            size == 0L -> "This file is empty."
            else -> null
        }
    }

    /** The power-of-two decode step that keeps the longest side at most [maxSide]. */
    fun sampleSize(width: Int, height: Int, maxSide: Int = DECODE_MAX): Int {
        var sample = 1
        while (max(width, height) / sample > maxSide) sample *= 2
        return sample
    }
}

// MARK: - Errors (the website's copy)

/** "40 s", "3 min", "2 h" (website formatWait). */
internal fun youFormatWait(seconds: Long): String = when {
    seconds < 90 -> "${max(1L, seconds)} s"
    seconds < 5400 -> "${(seconds / 60.0).roundToInt()} min"
    else -> "${(seconds / 3600.0).roundToInt()} h"
}

/** What went wrong with a photo, and whether sending again could work. */
data class YouPhotoProblem(val text: String, val retry: Boolean = false, val signIn: Boolean = false)

/** An upload's non-2xx answer, with the `Retry-After` seconds of a 429. */
class YouPhotoHttpError(val error: APIError, val retryAfter: Long?) : Exception(error.message)

/** Upload failure → copy (website `uploadError` + `retryable`). */
internal fun youPhotoUploadProblem(e: Throwable): YouPhotoProblem {
    val retryAfter = (e as? YouPhotoHttpError)?.retryAfter
    val api = (e as? YouPhotoHttpError)?.error ?: e as? APIError
        ?: return YouPhotoProblem("Your photo wasn't saved. Try again.", retry = true)
    val text = when {
        api.code == "too_large" || api.status == 413 -> "Photos can be up to 10 MB."
        api.code == "unsupported_type" || api.status == 415 -> "Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one."
        api.code == "rate_limited" || api.status == 429 -> "You've changed your photo a lot. Try again in ${youFormatWait(retryAfter ?: 600)}."
        else -> api.message.ifEmpty { "Your photo wasn't saved. Try again." }
    }
    val retry = api.status == 0 || api.status == 429 || api.status >= 500
    return YouPhotoProblem(text, retry = retry, signIn = api.status == 401)
}

/** Removal failure → copy (website `errorMessage(e, "Your photo wasn't removed. Try again.")`). */
internal fun youPhotoRemoveProblem(e: Throwable): YouPhotoProblem {
    val api = e as? APIError ?: return YouPhotoProblem("Your photo wasn't removed. Try again.")
    return YouPhotoProblem(api.message.ifEmpty { "Your photo wasn't removed. Try again." }, signIn = api.status == 401)
}

// MARK: - Request

/**
 * POST /api/account/photo?as=shopper with exactly one part, `file` (photo.jpg, image/jpeg). The
 * body's length is known, so OkHttp sends `Content-Length` (the server answers 411 to chunked
 * uploads); `Origin` and `X-Yard-Client` come from [APIClient.makeMultipartRequest].
 */
internal fun youPhotoUploadRequest(api: APIClient, root: String, jpeg: ByteArray, onProgress: ((Float) -> Unit)? = null): Request {
    val base = api.makeMultipartRequest(
        HTTPMethod.POST,
        "$root/api/account/photo",
        listOf(MultipartPart.File(name = "file", filename = "photo.jpg", contentType = "image/jpeg", bytes = jpeg)),
        youAsShopper,
    )
    val body = base.body ?: return base
    return if (onProgress == null) base else base.newBuilder().method(base.method, YouProgressBody(body, onProgress)).build()
}

/** Reports the share of the body written (0…1); same length and type as the body it wraps. */
private class YouProgressBody(private val delegate: RequestBody, private val onProgress: (Float) -> Unit) : RequestBody() {
    override fun contentType(): MediaType? = delegate.contentType()
    override fun contentLength(): Long = delegate.contentLength()
    override fun writeTo(sink: BufferedSink) {
        val total = contentLength().coerceAtLeast(1L)
        var written = 0L
        var lastStep = -1
        val counting = object : ForwardingSink(sink as Sink) {
            override fun write(source: okio.Buffer, byteCount: Long) {
                super.write(source, byteCount)
                written += byteCount
                val step = (written * 50 / total).toInt() // at most 50 updates
                if (step != lastStep) {
                    lastStep = step
                    onProgress((written.toFloat() / total).coerceIn(0f, 1f))
                }
            }
        }.buffer()
        delegate.writeTo(counting)
        counting.flush()
    }
}

/** Sends the JPEG; returns the account with its new `photo`. Throws [YouPhotoHttpError] / [APIError]. */
internal suspend fun youUploadAccountPhoto(api: APIClient, root: String, jpeg: ByteArray, onProgress: (Float) -> Unit): YouAccount {
    val request = youPhotoUploadRequest(api, root, jpeg, onProgress)
    val response = try {
        api.http.newCall(request).await()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        throw APIError.network(e)
    }
    val (code, retryAfter, text) = withContext(Dispatchers.IO) {
        response.use { r ->
            val body = try {
                r.body?.string().orEmpty()
            } catch (e: java.io.IOException) {
                throw APIError.network(e)
            }
            Triple(r.code, r.header("Retry-After")?.trim()?.toLongOrNull(), body)
        }
    }
    if (code !in 200..299) throw YouPhotoHttpError(APIError.fromResponse(code, text), retryAfter)
    return api.decode(YouAccountResponse.serializer(), text).account
}

// MARK: - Picking and encoding (Android)

/** A picked photo, decoded upright (EXIF orientation applied), at most [YouPhotoCrop.DECODE_MAX] px. */
class YouPickedPhoto(val bitmap: Bitmap) {
    val size: YouCropSize get() = YouCropSize(bitmap.width.toFloat(), bitmap.height.toFloat())
    val image: ImageBitmap by lazy { bitmap.asImageBitmap() }
}

sealed interface YouPhotoPick {
    data class Ready(val photo: YouPickedPhoto) : YouPhotoPick
    data class Problem(val message: String) : YouPhotoPick
}

/** Opens a picked image (photo picker or camera file) off the main thread, with the website's checks. */
internal suspend fun youLoadPickedPhoto(context: Context, uri: Uri): YouPhotoPick = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val name = youDisplayName(resolver, uri)
    val type = resolver.getType(uri) ?: youTypeFromName(name)
    YouPhotoCrop.fileProblem(type, youSize(resolver, uri), name)?.let { return@withContext YouPhotoPick.Problem(it) }
    val heic = type == "image/heic" || type == "image/heif"
    try {
        val decoded = youDecodeUpright(resolver, uri)
            ?: return@withContext YouPhotoPick.Problem(youUnreadable(heic))
        if (decoded.second.first < YouPhotoCrop.MIN_SIDE || decoded.second.second < YouPhotoCrop.MIN_SIDE) {
            decoded.first.recycle()
            return@withContext YouPhotoPick.Problem("This photo is smaller than 64 px on a side. Use a larger one.")
        }
        YouPhotoPick.Ready(YouPickedPhoto(decoded.first))
    } catch (e: CancellationException) {
        throw e
    } catch (_: OutOfMemoryError) {
        YouPhotoPick.Problem("This photo is too big to open on this phone. Try a smaller one.")
    } catch (_: Exception) {
        YouPhotoPick.Problem(youUnreadable(heic))
    }
}

private fun youUnreadable(heic: Boolean) =
    if (heic && Build.VERSION.SDK_INT < Build.VERSION_CODES.P) "This phone can't open HEIC photos. Export it as JPEG and try again."
    else "This photo couldn't be read. Try exporting it again as JPEG."

private fun youDisplayName(resolver: ContentResolver, uri: Uri): String? = runCatching {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
}.getOrNull() ?: uri.lastPathSegment

private fun youSize(resolver: ContentResolver, uri: Uri): Long? = runCatching {
    resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
    }
}.getOrNull() ?: runCatching { resolver.openAssetFileDescriptor(uri, "r")?.use { it.length.takeIf { l -> l >= 0 } } }.getOrNull()

private fun youTypeFromName(name: String?): String? = when (name?.substringAfterLast('.', "")?.lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "webp" -> "image/webp"
    "heic" -> "image/heic"
    "heif" -> "image/heif"
    else -> null
}

/** Decoded bitmap (software, upright) + the ORIGINAL pixel size (for the 64 px rule). */
private fun youDecodeUpright(resolver: ContentResolver, uri: Uri): Pair<Bitmap, Pair<Int, Int>>? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        var original = 0 to 0
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            original = info.size.width to info.size.height
            decoder.setTargetSampleSize(YouPhotoCrop.sampleSize(info.size.width, info.size.height))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE // drawn into a Canvas for the crop
        }
        return bitmap to original
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply { inSampleSize = YouPhotoCrop.sampleSize(bounds.outWidth, bounds.outHeight) }
    val raw = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val orientation = runCatching {
        resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
    val m = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
        else -> return raw to (bounds.outWidth to bounds.outHeight)
    }
    val upright = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
    if (upright != raw) raw.recycle()
    return upright to (bounds.outWidth to bounds.outHeight)
}

/** The cropped square, drawn at its upload size over Yard black (no metadata survives a re-encode). */
internal fun youRenderCrop(photo: YouPickedPhoto, frame: Float, crop: YouCropState): Bitmap {
    val sq = YouPhotoCrop.sourceSquare(photo.size, frame, crop.zoom, crop.offset)
    val side = YouPhotoCrop.outputSide(sq.size)
    val out = createBitmap(side, side)
    val canvas = Canvas(out)
    canvas.drawColor(0xFF080808.toInt())
    val src = Rect(sq.sx.roundToInt(), sq.sy.roundToInt(), (sq.sx + sq.size).roundToInt(), (sq.sy + sq.size).roundToInt())
    canvas.drawBitmap(photo.bitmap, src, RectF(0f, 0f, side.toFloat(), side.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
    return out
}

/** JPEG at quality 0.9. */
internal fun youJpeg(bitmap: Bitmap): ByteArray =
    ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, YouPhotoCrop.JPEG_QUALITY, it) }.toByteArray()

// MARK: - Model

/**
 * The photo section's state. [pending] is the cropped photo while it uploads (and after a failure,
 * until it is sent again or discarded); the avatar shows it instead of the saved one.
 */
class YouPhotoModel(
    private val api: APIClient = APIClient.shared,
    /** URL prefix for the API paths ("" = the configured base URL; tests point it at a mock server). */
    private val root: String = "",
) : ViewModel() {
    enum class Busy { Upload, Remove }

    /** A cropped photo waiting to be (or being) saved. */
    class Pending(val jpeg: ByteArray, val preview: ImageBitmap?)

    /** The photo being positioned in the crop step. */
    var picked by mutableStateOf<YouPickedPhoto?>(null); private set
    var pending by mutableStateOf<Pending?>(null); private set
    var busy by mutableStateOf<Busy?>(null); private set
    /** Share of the upload sent (0…1) while [busy] is [Busy.Upload]. */
    var progress by mutableFloatStateOf(0f); private set
    var problem by mutableStateOf<YouPhotoProblem?>(null); private set
    /** True while a picked file is being opened. */
    var isOpening by mutableStateOf(false); private set

    private var job: Job? = null

    /** Opening a picked file started (the picker or camera came back). */
    fun opening() {
        isOpening = true
        problem = null
    }

    /** A picked file was opened: crop it, or say why not. */
    fun choose(pick: YouPhotoPick) {
        isOpening = false
        when (pick) {
            is YouPhotoPick.Ready -> {
                problem = null
                picked = pick.photo
            }
            is YouPhotoPick.Problem -> problem = YouPhotoProblem(pick.message)
        }
    }

    fun cancelCrop() {
        picked = null
        isOpening = false
    }

    /** A failure outside the model (no camera app, the picker failed). */
    fun fail(text: String) {
        isOpening = false
        problem = YouPhotoProblem(text)
    }

    /** Optimistic: the cropped photo shows straight away and uploads; it reverts if the upload fails. */
    fun save(jpeg: ByteArray, preview: ImageBitmap?, onSaved: (YouAccount) -> Unit) {
        pending = Pending(jpeg, preview)
        picked = null
        retry(onSaved)
    }

    /** Sends [pending] again. */
    fun retry(onSaved: (YouAccount) -> Unit) {
        if (busy != null) return
        job = viewModelScope.launch { upload()?.let(onSaved) }
    }

    /** Uploads [pending]; returns the saved account, or null with [problem] set. */
    suspend fun upload(): YouAccount? {
        val p = pending ?: return null
        busy = Busy.Upload
        progress = 0f
        problem = null
        try {
            val account = youUploadAccountPhoto(api, root, p.jpeg) { progress = it }
            pending = null
            return account
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return null
            problem = youPhotoUploadProblem(e)
            return null
        } finally {
            busy = null
        }
    }

    /** Drops a failed upload: the saved photo (or the initials) shows again. */
    fun discard() {
        if (busy == Busy.Upload) return
        pending = null
        problem = null
    }

    fun remove(onRemoved: (YouAccount) -> Unit) {
        if (busy != null) return
        job = viewModelScope.launch { removeNow()?.let(onRemoved) }
    }

    /** DELETE /api/account/photo?as=shopper. Returns the account (photo null), or null with [problem] set. */
    suspend fun removeNow(): YouAccount? {
        busy = Busy.Remove
        problem = null
        try {
            return api.delete<YouAccountResponse>("$root/api/account/photo", youAsShopper).account
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return null
            problem = youPhotoRemoveProblem(e)
            return null
        } finally {
            busy = null
        }
    }

    fun clearProblem() {
        if (pending == null) problem = null
    }

    /** Previews and screenshots only: show an upload in progress, or failed, without the network. */
    internal fun previewState(preview: ImageBitmap?, uploading: Float? = null, failed: YouPhotoProblem? = null) {
        pending = Pending(ByteArray(0), preview)
        busy = if (uploading != null) Busy.Upload else null
        progress = uploading ?: 0f
        problem = failed
    }

    private var bound = false
    private var boundTo: String? = null

    /**
     * Ties the model to a shopper. Called on every fresh composition of Your details (including
     * after an activity recreation, which this ViewModel survives), so it resets only when the
     * shopper really changed: another account, or signed out. An upload in flight, a failed one
     * and an open crop step survive a dark-mode or locale switch.
     */
    fun bind(shopperId: String?) {
        if (bound && boundTo == shopperId) return
        if (bound) reset()
        bound = true
        boundTo = shopperId
    }

    /** Signed out / another account: forget everything. */
    fun reset() {
        job?.cancel()
        picked = null
        pending = null
        busy = null
        problem = null
        isOpening = false
    }
}
