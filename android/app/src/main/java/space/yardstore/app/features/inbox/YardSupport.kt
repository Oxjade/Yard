package space.yardstore.app.features.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.serialization.Serializable
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.networking.MultipartPart
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardLogo
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.yard

// Yard Support: the shopper's one conversation with Yard's own team (docs/APP.md › Yard Support).
// It is an inbox conversation of kind "support", answered in the inbox's own DTOs, so the inbox's
// thread screen, bubbles and composer render it; only the endpoints, the header and the intro differ.

/** Yard Support's display name (the server's `conversation.brand.name` is the same). */
const val YardSupportName = "Yard Support"

/** An order attached to the next support message ("Get help from Yard" on an order). */
@Serializable
data class InboxOrderChip(val orderId: String, val reference: String) {
    /** "Order NF-16827" (the composer chip and a pending bubble with no text). */
    val label: String get() = "Order ${reference.ifEmpty { orderId }}"
}

/** GET /api/support/conversation → `{ conversation: ConversationSummary | null }`. */
@Serializable
data class YardSupportConversationResponse(val conversation: InboxConversation? = null)

/**
 * POST /api/support/messages body (strict on the server: only these keys; nulls are not encoded).
 * `kind`: "text" | "image" | "order"; `attachmentIds` only for "image"; `orderRefId` only for "order".
 */
@Serializable
data class YardSupportSendBody(
    val clientId: String,
    val kind: String,
    val body: String? = null,
    val attachmentIds: List<String>? = null,
    val orderRefId: String? = null,
)

/** The shopper's Yard Support endpoints (src/app/api/support/…). Uses [InboxAPI]'s client (and its test hook). */
object YardSupportAPI {
    private val api: APIClient get() = InboxAPI.client ?: APIClient.shared

    /** GET /api/support/conversation: null until the first message creates the thread. */
    suspend fun conversation(): InboxConversation? =
        api.get<YardSupportConversationResponse>("/api/support/conversation").conversation

    /** GET /api/support/conversation/messages?before=&after=&limit= (404 before the first message). */
    suspend fun thread(before: Int? = null, after: Int? = null, limit: Int = 50): InboxThread {
        val items = mutableListOf<Pair<String, String?>>("limit" to limit.toString())
        if (before != null) items += "before" to before.toString()
        if (after != null) items += "after" to after.toString()
        return api.get("/api/support/conversation/messages", items)
    }

    /** POST /api/support/messages → 201 (or 200 for a retried clientId) `{ message, conversation }`. */
    suspend fun send(body: YardSupportSendBody): InboxSendResult = api.post("/api/support/messages", body)

    /** POST /api/support/conversation/read { upToSeq } → 204. */
    suspend fun markRead(upToSeq: Int) {
        api.send(HTTPMethod.POST, "/api/support/conversation/read", InboxReadBody(upToSeq = maxOf(0, upToSeq)))
    }

    /**
     * POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=<support thread>, multipart
     * `file`. Photos need the thread to exist (the first message must be text or an order).
     */
    suspend fun uploadPhoto(jpeg: ByteArray, conversationId: String): String {
        val r: InboxUploadResult = api.upload(
            "/api/uploads",
            listOf(MultipartPart.File("file", "photo.jpg", "image/jpeg", jpeg)),
            query = listOf("purpose" to "inbox_attachment", "as" to "shopper", "conversationId" to conversationId),
        )
        return r.media.id
    }

    /** The send body for one message: photos win (as on the website), then an attached order, else text. */
    fun body(clientId: String, text: String, attachmentIds: List<String>, order: InboxOrderChip?): YardSupportSendBody {
        val kind = when {
            attachmentIds.isNotEmpty() -> "image"
            order != null -> "order"
            else -> "text"
        }
        return YardSupportSendBody(
            clientId = clientId,
            kind = kind,
            body = text.ifEmpty { null },
            attachmentIds = attachmentIds.ifEmpty { null },
            orderRefId = if (kind == "order") order?.orderId else null,
        )
    }
}

/** Yard's mark (the Yard logo on black) in the shape of a brand avatar. */
@Composable
fun YardSupportMark(size: Dp = 40.dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.yard.scrim, CircleShape)
            .border(1.dp, Color.yard.line, CircleShape)
            .clearAndSetSemantics { contentDescription = YardSupportName },
        contentAlignment = Alignment.Center,
    ) {
        YardLogo(Modifier.fillMaxWidth().padding(horizontal = size * 0.18f), color = Color.yard.acid)
    }
}

/**
 * The Yard Support thread (route `Route.YardSupport`; also `/inbox?support=1[&order=&orderRef=]`
 * links and support-reply notifications). With [orderId] the order rides above the composer as a
 * removable chip and goes out with the next message (`kind: "order"`), like the website.
 */
@Composable
fun YardSupportConversationView(orderId: String?, orderRef: String?) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    if (session.isSignedIn) {
        val chip = orderId?.takeIf { it.isNotEmpty() }?.let { InboxOrderChip(it, orderRef.orEmpty()) }
        val model: InboxThreadModel = viewModel(key = "yard-support") { InboxThreadModel.forSupport(chip) }
        InboxThreadScreen(model)
    } else {
        InboxSignedOutGate(
            hasLoaded = session.hasLoaded,
            message = "Sign in to message Yard Support about an order, a payment or your account.",
            title = YardSupportName,
        ) { router.present(Route.SignIn) }
    }
}

/**
 * The attached order as a chip (website `Composer` order chip): receipt icon + "Order NF-…", and a
 * remove button when [onRemove] is set (48dp touch area).
 */
@Composable
fun InboxOrderChipView(order: InboxOrderChip, modifier: Modifier = Modifier, onRemove: (() -> Unit)? = null) {
    Row(
        modifier
            .height(32.dp)
            .clip(CircleShape)
            .background(Color.yard.surface2)
            .border(1.dp, Color.yard.line, CircleShape)
            .padding(start = Spacing.m, end = if (onRemove == null) Spacing.m else 0.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(Icons.AutoMirrored.Outlined.ReceiptLong, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(14.dp))
        Text(order.label, style = YardFonts.captionEmphasis.monospacedDigits(), color = Color.yard.ink, maxLines = 1)
        if (onRemove != null) {
            Box(
                Modifier
                    .size(32.dp)
                    .minimumInteractiveComponentSize()
                    .clip(CircleShape)
                    .clickable(onClick = onRemove)
                    .semantics { contentDescription = "Remove ${order.label}" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(14.dp))
            }
        }
    }
}

// region Previews (fixtures are preview-only)

internal object YardSupportPreviewData {
    private fun iso(offsetSeconds: Long): String = java.time.Instant.now().plusSeconds(offsetSeconds).toString()

    val brand = InboxBrandRef(id = "yard_support", handle = "support", name = YardSupportName, verified = true, mark = InboxBrandMark("Y"))

    fun model(chip: InboxOrderChip? = null): InboxThreadModel {
        val conversation = InboxConversation(
            id = "cv_support", kind = "support", brand = brand, createdAt = iso(-90_000),
            interaction = InboxInteraction(canSend = true),
        )
        val messages = listOf(
            InboxMessage("s1", 1, "customer", body = "My parcel says delivered but it isn't here.", createdAt = iso(-90_000)),
            InboxMessage("s2", 2, "support", body = "Sorry about that. We've asked the brand and the carrier — we'll update you here today.", createdAt = iso(-80_000)),
        )
        return InboxThreadModel.previewSupport(conversation, messages, chip)
    }
}

@Preview(name = "Yard Support — dark")
@Composable
private fun YardSupportDark() = YardPreview(darkTheme = true) {
    InboxThreadScreen(androidx.compose.runtime.remember { YardSupportPreviewData.model(InboxOrderChip("mo_1", "NF-16827")) }, autoLoad = false)
}

@Preview(name = "Yard Support — light")
@Composable
private fun YardSupportLight() = YardPreview(darkTheme = false) {
    InboxThreadScreen(androidx.compose.runtime.remember { YardSupportPreviewData.model() }, autoLoad = false)
}

@Preview(name = "Yard Support — signed out")
@Composable
private fun YardSupportSignedOut() = YardPreview(darkTheme = false, signedIn = false) { YardSupportConversationView(null, null) }

@YardTabletPreviews
@Composable
private fun YardSupportTablet() = YardPreview(darkTheme = true) {
    InboxThreadScreen(androidx.compose.runtime.remember { YardSupportPreviewData.model() }, autoLoad = false)
}

// endregion
