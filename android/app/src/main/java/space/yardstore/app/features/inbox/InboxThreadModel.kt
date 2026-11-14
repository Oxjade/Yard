package space.yardstore.app.features.inbox

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.max
import kotlin.math.roundToInt

/** A photo ready to upload: the JPEG (kept for retry) and a small thumbnail to draw. */
class InboxPreparedPhoto(val jpeg: ByteArray, val thumbnail: ImageBitmap) {
    val id: String = UUID.randomUUID().toString()
}

/** A message the shopper sent that the server hasn't confirmed yet (or that failed). */
data class InboxPendingMessage(
    /** The `clientId` (idempotency key): retrying with it never double-sends. */
    val id: String,
    val text: String,
    /** Photos still to upload (kept for retry). */
    val photos: List<InboxPreparedPhoto>,
    val createdAt: Instant,
    val failedMessage: String? = null,
    /** Yard Support only: the order attached to this message ("Get help from Yard"). */
    val order: InboxOrderChip? = null,
) {
    val isFailed: Boolean get() = failedMessage != null
}

/** One row of the thread as drawn: a day separator, a message, or a pending send. */
sealed interface InboxThreadItem {
    val id: String

    data class Day(val dayId: String, val label: String) : InboxThreadItem {
        override val id: String get() = "day:$dayId"
    }

    data class Message(val message: InboxMessage, val showsTime: Boolean) : InboxThreadItem {
        override val id: String get() = message.id
    }

    data class Pending(val pending: InboxPendingMessage) : InboxThreadItem {
        override val id: String get() = "pending:" + pending.id
    }
}

/**
 * The shopper's thread with one brand: load, 5 s polling, older pages, sending, read receipts.
 * Works for an existing conversation (`conversationId`) and for a new one by brand (`brandId`),
 * whose first send creates the conversation. Mirrors `InboxThreadModel.swift`.
 *
 * [isSupport]: the shopper's thread with Yard Support (`forSupport`), same behaviour through
 * /api/support/… (one thread per shopper, created by the first message; photos only once it
 * exists; an attached order goes out as `kind: "order"`; no archive/mute/block).
 */
class InboxThreadModel private constructor(
    conversationId: String?,
    brandId: String?,
    val isSupport: Boolean = false,
    orderChip: InboxOrderChip? = null,
) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Ready : Phase
        data class Failed(val message: String) : Phase
    }

    var conversationId by mutableStateOf(conversationId); private set
    var brandId by mutableStateOf(brandId); private set
    var conversation by mutableStateOf<InboxConversation?>(null); private set
    /** The composer state for a brand-new thread (from by-brand). */
    var newThreadInteraction by mutableStateOf<InboxInteraction?>(null); private set

    // Brand details for the header (from the conversation, then the public storefront for the logo).
    var brandName by mutableStateOf(""); private set
    var brandHandle by mutableStateOf<String?>(null); private set
    var brandVerified by mutableStateOf(false); private set
    var brandLogoUrl by mutableStateOf<String?>(null); private set

    var messages by mutableStateOf<List<InboxMessage>>(emptyList()); private set
    var pending by mutableStateOf<List<InboxPendingMessage>>(emptyList()); private set
    var hasMore by mutableStateOf(false); private set
    var isLoadingOlder by mutableStateOf(false); private set
    var phase by mutableStateOf<Phase>(Phase.Loading); private set
    /** Product photos for shared product cards (productId → cover URL). */
    var productImages by mutableStateOf<Map<String, String>>(emptyMap()); private set

    /** Yard Support: the order riding above the composer, sent with the next message. */
    var orderChip by mutableStateOf(orderChip); private set

    /** Called once when the first send creates the conversation. */
    var onCreated: ((String) -> Unit)? = null

    private var lastMarkedSeq = 0
    private val requestedProductIds = mutableSetOf<String>()
    private var loadedBrandInfo = false
    private var isPolling = false

    companion object {
        fun forConversation(id: String) = InboxThreadModel(conversationId = id, brandId = null)
        fun forBrand(brandId: String) = InboxThreadModel(conversationId = null, brandId = brandId)
        fun forSupport(order: InboxOrderChip? = null) =
            InboxThreadModel(conversationId = null, brandId = null, isSupport = true, orderChip = order)

        /** Preview-only: a Yard Support thread already loaded. */
        fun previewSupport(conversation: InboxConversation, messages: List<InboxMessage>, order: InboxOrderChip?) =
            InboxThreadModel(conversation.id, null, isSupport = true, orderChip = order).apply {
                this.conversation = conversation
                this.messages = messages
                brandName = YardSupportName
                brandVerified = true
                phase = Phase.Ready
                loadedBrandInfo = true
            }

        /** Preview-only: a thread already loaded. */
        fun preview(conversation: InboxConversation, messages: List<InboxMessage>) =
            InboxThreadModel(conversation.id, conversation.brand.id).apply {
                this.conversation = conversation
                this.messages = messages
                brandName = conversation.brand.name
                brandHandle = conversation.brand.handle
                brandVerified = conversation.brand.verified
                phase = Phase.Ready
                loadedBrandInfo = true
            }

        /** Union by id, oldest first (by seq, then time). */
        fun merged(a: List<InboxMessage>, b: List<InboxMessage>): List<InboxMessage> {
            val byId = LinkedHashMap<String, InboxMessage>()
            for (m in a) byId[m.id] = m
            for (m in b) byId[m.id] = m
            return byId.values.sortedWith(compareBy<InboxMessage> { it.seq }.thenBy { it.createdAt })
        }
    }

    // region Derived

    val displayName: String get() = if (isSupport) YardSupportName else brandName.ifEmpty { "This brand" }

    val interaction: InboxInteraction?
        get() = if (conversationId != null) conversation?.interaction else newThreadInteraction

    val disabledReason: String? get() = InboxFormat.disabledReason(interaction, displayName)

    val isBlockedByMe: Boolean
        get() = conversation?.blockedByMe ?: (interaction?.reason == "blocked_by_me")

    /** The newest order attached in the thread: the order this conversation is about. */
    val contextOrder: InboxOrderCard?
        get() = messages.lastOrNull { it.order != null && !it.isRemoved }?.order

    val isEmpty: Boolean get() = messages.isEmpty() && pending.isEmpty()

    /** Messages with day separators, then pending sends at the bottom. */
    fun items(zone: ZoneId = ZoneId.systemDefault()): List<InboxThreadItem> {
        val out = mutableListOf<InboxThreadItem>()
        val now = Instant.now()
        var lastDay: LocalDate? = null
        for ((i, m) in messages.withIndex()) {
            val date = m.date ?: now
            val day = date.atZone(zone).toLocalDate()
            if (lastDay != day) {
                out += InboxThreadItem.Day(day.toString(), InboxFormat.dayLabel(date, now, zone))
                lastDay = day
            }
            // Time under the last bubble of a run (same side, within 5 minutes).
            var showsTime = true
            if (i + 1 < messages.size) {
                val next = messages[i + 1]
                val nextDate = next.date ?: date
                if (next.side == m.side && nextDate.epochSecond - date.epochSecond < 300 &&
                    nextDate.atZone(zone).toLocalDate() == day
                ) {
                    showsTime = false
                }
            } else if (pending.isNotEmpty() && m.isMine) {
                showsTime = false
            }
            out += InboxThreadItem.Message(m, showsTime)
        }
        if (pending.isNotEmpty()) {
            val today = now.atZone(zone).toLocalDate()
            if (lastDay != today) out += InboxThreadItem.Day(today.toString(), InboxFormat.dayLabel(now, now, zone))
            for (p in pending) out += InboxThreadItem.Pending(p)
        }
        return out
    }

    // endregion

    // region Loading

    fun load(): Job = viewModelScope.launch {
        if (phase == Phase.Ready && messages.isNotEmpty()) return@launch
        phase = Phase.Loading
        try {
            if (isSupport) {
                loadSupport()
                phase = Phase.Ready
                launch { markReadIfNeeded() }
                return@launch
            }
            val brand = brandId
            if (conversationId == null && brand != null) {
                val r = InboxAPI.byBrand(brand)
                val c = r.conversation
                if (c != null) {
                    conversationId = c.id
                    apply(c)
                } else {
                    newThreadInteraction = r.interaction
                }
            }
            conversationId?.let { id ->
                val t = InboxAPI.thread(id)
                apply(t.conversation)
                messages = merged(emptyList(), t.messages)
                hasMore = t.hasMore
            }
            phase = Phase.Ready
            launch { markReadIfNeeded() }
            launch { loadBrandInfo() }
            launch { loadProductImages() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if ((e as? APIError)?.isCancelled == true) return@launch
            phase = Phase.Failed(APIError.messageFor(e))
        }
    }

    /** Yard Support: the thread if it exists (it is created by the first message), else a fresh composer. */
    private suspend fun loadSupport() {
        brandName = YardSupportName
        brandVerified = true
        loadedBrandInfo = true
        val c = YardSupportAPI.conversation()
        if (c != null) {
            conversationId = c.id
            apply(c)
        }
        if (conversationId == null) {
            newThreadInteraction = InboxInteraction(canSend = true)
            return
        }
        try {
            val t = YardSupportAPI.thread()
            apply(t.conversation)
            messages = merged(emptyList(), t.messages)
            hasMore = t.hasMore
        } catch (e: APIError) {
            // No message yet (the thread read is 404 until the first one): start fresh.
            if (!e.isNotFound) throw e
            newThreadInteraction = InboxInteraction(canSend = true)
        }
    }

    private suspend fun threadPage(id: String, before: Int? = null, after: Int? = null, limit: Int = 50): InboxThread =
        if (isSupport) YardSupportAPI.thread(before = before, after = after, limit = limit)
        else InboxAPI.thread(id, before = before, after = after, limit = limit)

    /** Fetches what's new since the newest message we hold (5 s while the thread is open). */
    fun poll(): Job = viewModelScope.launch {
        val id = conversationId ?: return@launch
        if (phase != Phase.Ready || isPolling) return@launch
        isPolling = true
        try {
            val after = messages.maxOfOrNull { it.seq } ?: 0
            val t = threadPage(id, after = after, limit = 100)
            apply(t.conversation)
            if (t.messages.isNotEmpty()) {
                messages = merged(messages, t.messages)
                // A confirmed send that the poll returned first: drop its pending copy.
                val confirmed = t.messages.map { it.clientId }.toSet()
                pending = pending.filterNot { it.id in confirmed && !it.isFailed }
                markReadIfNeeded()
                loadProductImages()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Polling is best-effort; the next tick tries again.
        } finally {
            isPolling = false
        }
    }

    fun loadOlder(): Job = viewModelScope.launch {
        val id = conversationId ?: return@launch
        val first = messages.minOfOrNull { it.seq } ?: return@launch
        if (!hasMore || isLoadingOlder) return@launch
        isLoadingOlder = true
        try {
            val t = threadPage(id, before = first)
            messages = merged(messages, t.messages)
            hasMore = t.hasMore
            loadProductImages()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Keep hasMore; the button stays to retry.
        } finally {
            isLoadingOlder = false
        }
    }

    private fun apply(c: InboxConversation) {
        // List reads don't carry `interaction`; keep the one we have.
        val old = conversation?.interaction
        conversation = if (c.interaction == null && old != null) c.copy(interaction = old) else c
        if (isSupport) {
            // Yard Support: Yard's mark and name, never a storefront.
            brandName = YardSupportName
            brandHandle = null
            brandVerified = true
            return
        }
        brandId = c.brand.id
        if (brandName.isEmpty() || !loadedBrandInfo) brandName = c.brand.name
        if (c.brand.handle.isNotEmpty()) brandHandle = c.brand.handle
        brandVerified = c.brand.verified
    }

    /** The brand's name, handle and logo from its public storefront (one cached GET). */
    private suspend fun loadBrandInfo() {
        if (isSupport) return
        val id = brandId ?: return
        if (loadedBrandInfo) return
        loadedBrandInfo = true
        try {
            val b = InboxAPI.brand(id)
            if (brandName.isEmpty()) brandName = b.name
            if (brandHandle.isNullOrEmpty()) brandHandle = b.handle
            brandLogoUrl = b.logoUrl
            if (conversation == null) brandVerified = b.verified
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            loadedBrandInfo = false
        }
    }

    /** One batched catalogue read for shared product cards we have no photo for yet. */
    private suspend fun loadProductImages() {
        val ids = messages.mapNotNull { it.product?.productId?.takeIf(String::isNotEmpty) }.toSet() - requestedProductIds
        if (ids.isEmpty()) return
        requestedProductIds += ids
        try {
            val products = InboxAPI.products(ids.toList())
            val next = productImages.toMutableMap()
            for (p in products) p.coverUrl?.let { next[p.id] = it }
            productImages = next
        } catch (e: CancellationException) {
            requestedProductIds -= ids
            throw e
        } catch (_: Exception) {
            requestedProductIds -= ids
        }
    }

    // endregion

    // region Read receipts

    /** POST read up to the newest message when something from the brand is unread. */
    private suspend fun markReadIfNeeded() {
        val id = conversationId ?: return
        val maxSeq = messages.maxOfOrNull { it.seq } ?: return
        if (maxSeq <= lastMarkedSeq) return
        val incoming = messages.any { !it.isMine && it.seq > lastMarkedSeq }
        if (!incoming && conversation?.isUnread != true) {
            lastMarkedSeq = maxSeq
            return
        }
        val previous = lastMarkedSeq
        lastMarkedSeq = maxSeq
        try {
            if (isSupport) YardSupportAPI.markRead(maxSeq) else InboxAPI.markRead(id, maxSeq)
            conversation?.let { conversation = it.markingRead() }
        } catch (e: CancellationException) {
            lastMarkedSeq = previous
            throw e
        } catch (_: Exception) {
            lastMarkedSeq = previous
        }
    }

    // endregion

    // region Sending

    /** Sends text and/or photos. Optimistic: the bubble shows at once and settles when confirmed. */
    fun send(text: String, photos: List<InboxPreparedPhoto>) {
        val body = text.trim()
        // Yard Support: an attached order goes with this message (photos win, as on the website).
        val order = if (isSupport && photos.isEmpty()) orderChip else null
        if (body.isEmpty() && photos.isEmpty() && order == null) return
        val p = InboxPendingMessage(
            id = UUID.randomUUID().toString().lowercase(), text = body, photos = photos, createdAt = Instant.now(), order = order,
        )
        if (isSupport) orderChip = null
        pending = pending + p
        viewModelScope.launch { deliver(p) }
    }

    fun retry(p: InboxPendingMessage) {
        val i = pending.indexOfFirst { it.id == p.id }
        if (i < 0) return
        val item = pending[i].copy(failedMessage = null)
        pending = pending.toMutableList().also { it[i] = item }
        viewModelScope.launch { deliver(item) }
    }

    fun discard(p: InboxPendingMessage) {
        pending = pending.filterNot { it.id == p.id }
    }

    /** Yard Support: drops the attached order (the chip's ×). */
    fun clearOrderChip() {
        orderChip = null
    }

    /** Whether the composer can send with no text (an attached order is enough). */
    val canSendWithoutText: Boolean get() = isSupport && orderChip != null

    private suspend fun deliverSupport(p: InboxPendingMessage) {
        val attachmentIds = mutableListOf<String>()
        if (p.photos.isNotEmpty()) {
            val id = conversationId ?: throw APIError(0, "client", "Send a message first, then add photos.")
            for (photo in p.photos) attachmentIds += YardSupportAPI.uploadPhoto(photo.jpeg, id)
        }
        val r = YardSupportAPI.send(YardSupportAPI.body(p.id, p.text, attachmentIds, p.order))
        val created = conversationId == null
        conversationId = r.conversation.id
        apply(r.conversation)
        if (conversation?.interaction == null) conversation = r.conversation.copy(interaction = InboxInteraction(canSend = true))
        pending = pending.filterNot { it.id == p.id }
        messages = merged(messages, listOf(r.message))
        lastMarkedSeq = max(lastMarkedSeq, r.message.seq)
        if (created) onCreated?.invoke(r.conversation.id)
    }

    private suspend fun deliver(p: InboxPendingMessage) {
        try {
            if (isSupport) {
                deliverSupport(p)
                return
            }
            val brand = brandId ?: conversation?.brand?.id
                ?: throw APIError(0, "client", "Something went wrong. Try again.")
            val attachmentIds = mutableListOf<String>()
            for (photo in p.photos) {
                attachmentIds += InboxAPI.uploadPhoto(photo.jpeg, conversationId, brand)
            }
            val id = conversationId
            val body = InboxSendBody(
                conversationId = id,
                brandId = if (id == null) brand else null,
                origin = if (id == null) "inbox" else null,
                clientId = p.id,
                kind = if (attachmentIds.isEmpty()) "text" else "image",
                body = p.text.ifEmpty { null },
                attachmentIds = attachmentIds.ifEmpty { null },
            )
            val r = InboxAPI.send(body)
            val created = conversationId == null
            conversationId = r.conversation.id
            apply(r.conversation)
            val fresh = newThreadInteraction
            if (conversation?.interaction == null && fresh != null) {
                // A new conversation keeps the composer state by-brand gave us.
                conversation = r.conversation.copy(interaction = fresh)
            }
            pending = pending.filterNot { it.id == p.id }
            messages = merged(messages, listOf(r.message))
            lastMarkedSeq = max(lastMarkedSeq, r.message.seq)
            if (created) onCreated?.invoke(r.conversation.id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if ((e as? APIError)?.isCancelled == true) return
            val i = pending.indexOfFirst { it.id == p.id }
            if (i >= 0) pending = pending.toMutableList().also { it[i] = it[i].copy(failedMessage = APIError.messageFor(e)) }
        }
    }

    // endregion

    // region Conversation actions

    /** Runs a menu action in the model's scope; toasts [success] or the error. */
    fun run(toast: ToastCenter, success: String, work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                work()
                toast.show(success, Toast.Style.Success)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    suspend fun setArchived(archived: Boolean) {
        val id = conversationId ?: return
        apply(InboxAPI.patch(id, archived = archived))
    }

    suspend fun setMuted(muted: Boolean) {
        val id = conversationId ?: return
        apply(InboxAPI.patch(id, muted = muted))
    }

    suspend fun setBlocked(on: Boolean) {
        val brand = brandId ?: conversation?.brand?.id ?: return
        InboxAPI.setBlocked(on, brand)
        // The composer state changes with the block: re-read the thread (or by-brand).
        val id = conversationId
        if (id != null) {
            conversation = InboxAPI.thread(id, limit = 1).conversation
        } else {
            newThreadInteraction = InboxAPI.byBrand(brand).interaction
        }
    }

    // endregion
}

/** Photo preparation for uploads: JPEG, longest side ≤ 2048 px, under the 8 MB inbox cap. */
object InboxPhotoPrep {
    const val maxBytes = 8 * 1024 * 1024
    private const val maxSide = 2048
    private const val thumbSide = 256

    /** Reads, downsizes and encodes one picked photo off the main thread. Null when it can't be used. */
    suspend fun prepare(context: Context, uri: Uri): InboxPreparedPhoto? = withContext(Dispatchers.IO) {
        try {
            val bitmap = decode(context, uri) ?: return@withContext null
            val jpeg = jpeg(bitmap) ?: return@withContext null
            val thumb = scaled(bitmap, thumbSide)
            if (thumb !== bitmap) bitmap.recycle()
            InboxPreparedPhoto(jpeg, thumb.asImageBitmap())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        } catch (_: OutOfMemoryError) {
            null
        }
    }

    /** Decodes at most ~2048 px on the longest side (EXIF rotation applied on API 28+). */
    private fun decode(context: Context, uri: Uri): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val w = info.size.width
                val h = info.size.height
                val longest = max(w, h)
                if (longest > maxSide) {
                    val scale = maxSide.toDouble() / longest
                    decoder.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                }
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) return null
        var sample = 1
        while (longest / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
        return scaled(decoded, maxSide).also { if (it !== decoded) decoded.recycle() }
    }

    private fun scaled(bitmap: Bitmap, side: Int): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= side) return bitmap
        val scale = side.toDouble() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).roundToInt().coerceAtLeast(1),
            (bitmap.height * scale).roundToInt().coerceAtLeast(1),
            true,
        )
    }

    private fun jpeg(bitmap: Bitmap): ByteArray? {
        var quality = 82
        var out = compress(bitmap, quality)
        while (out.size > maxBytes && quality > 30) {
            quality -= 15
            out = compress(bitmap, quality)
        }
        return out.takeIf { it.size <= maxBytes }
    }

    private fun compress(bitmap: Bitmap, quality: Int): ByteArray =
        ByteArrayOutputStream().use { s ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, s)
            s.toByteArray()
        }
}
