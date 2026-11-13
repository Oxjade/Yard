package space.yardstore.app.features.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.AdaptiveContent
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.time.Instant

/** Photos opened in the lightbox: which message, which photo (saveable, so it survives recreation). */
private data class InboxPhotoSelection(val messageId: String, val index: Int) {
    companion object {
        val Saver = listSaver<InboxPhotoSelection?, Any>(
            save = { s -> if (s == null) emptyList() else listOf(s.messageId, s.index) },
            restore = { l -> if (l.size == 2) InboxPhotoSelection(l[0] as String, l[1] as Int) else null },
        )
    }
}

/**
 * The thread UI shared by `ConversationView(id)` and `BrandConversationView(brandId)`:
 * header (brand + menu), pinned order context, bubbles with day separators, composer.
 * Polls every 5 s while the screen is resumed; polls once on coming back (and on reopening a thread
 * whose model is cached, e.g. in the inbox's detail pane); marks read on open and as replies arrive.
 * Wide windows: header full width, bubbles + composer capped by `AdaptiveContent`.
 * Mirrors `InboxThreadScreen.swift`.
 */
@Composable
fun InboxThreadScreen(model: InboxThreadModel, autoLoad: Boolean = true) {
    val router = LocalRouter.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var photoSelection by rememberSaveable(stateSaver = InboxPhotoSelection.Saver) { mutableStateOf<InboxPhotoSelection?>(null) }
    var confirmBlock by rememberSaveable { mutableStateOf(false) }

    if (autoLoad) LaunchedEffect(Unit) { model.load() }

    // 5 s polling while resumed (iOS: while on screen and the scene is active), plus once on return.
    val conversationId = model.conversationId
    LaunchedEffect(conversationId, lifecycle, autoLoad) {
        if (conversationId == null || !autoLoad) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            // No-op while the first load runs (poll needs Ready); catches up a cached thread at once.
            model.poll().join()
            while (isActive) {
                delay(5_000)
                model.poll().join()
            }
        }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        InboxThreadHeader(model, onBlockTapped = { confirmBlock = true })
        AdaptiveContent(Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize()) {
                when (val phase = model.phase) {
                    InboxThreadModel.Phase.Loading -> InboxThreadSkeleton()
                    is InboxThreadModel.Phase.Failed -> EmptyState(
                        title = "Couldn't load this conversation.",
                        modifier = Modifier.weight(1f),
                        message = phase.message,
                        icon = Icons.Outlined.WifiOff,
                        actionTitle = "Retry",
                        action = { model.load() },
                    )
                    InboxThreadModel.Phase.Ready -> InboxThreadBody(
                        model,
                        modifier = Modifier.weight(1f),
                        onOpenOrder = { router.push(Route.Order(it)) },
                        onOpenPhotos = { messageId, i -> photoSelection = InboxPhotoSelection(messageId, i) },
                    )
                }
            }
        }
    }

    photoSelection?.let { s ->
        val attachments = model.messages.firstOrNull { it.id == s.messageId }?.attachments.orEmpty()
        if (attachments.isNotEmpty()) InboxPhotoViewer(attachments, s.index) { photoSelection = null }
    }

    if (confirmBlock) {
        val toast = LocalToastCenter.current
        val blocked = model.isBlockedByMe
        val name = model.displayName
        AlertDialog(
            onDismissRequest = { confirmBlock = false },
            containerColor = Color.yard.surface,
            titleContentColor = Color.yard.ink,
            textContentColor = Color.yard.ink2,
            title = { Text(if (blocked) "Unblock $name?" else "Block $name?", style = YardFonts.headline) },
            text = {
                Text(
                    if (blocked) "They'll be able to message you again." else "They can't message you. Find this conversation under Blocked.",
                    style = YardFonts.callout,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmBlock = false
                    val on = !blocked
                    model.run(toast, if (on) "Blocked $name" else "Unblocked $name") { model.setBlocked(on) }
                }) {
                    Text(if (blocked) "Unblock" else "Block", style = YardFonts.bodyEmphasis, color = if (blocked) Color.yard.ink else Color.yard.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmBlock = false }) {
                    Text("Cancel", style = YardFonts.body, color = Color.yard.ink2)
                }
            },
        )
    }
}

/** Back, brand (→ storefront), ⋯ menu. */
@Composable
private fun InboxThreadHeader(model: InboxThreadModel, onBlockTapped: () -> Unit) {
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val back = LocalBackAction.current
    var menuOpen by remember { mutableStateOf(false) }
    val handle = model.brandHandle?.takeIf { it.isNotEmpty() }
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.bg)
            .statusBarsPadding()
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        if (back != null) {
            GlassIconButton(
                if (back.isClose) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = if (back.isClose) "Close" else "Back",
                size = 38.dp,
                onClick = back.perform,
            )
        }
        Row(
            Modifier
                .weight(1f)
                .clickable(enabled = handle != null, onClickLabel = "Opens the storefront") { handle?.let { router.push(Route.Brand(it)) } }
                .padding(vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            BrandAvatar(name = model.displayName, logoUrl = model.brandLogoUrl, size = 32.dp)
            Column(Modifier.weight(1f, fill = false)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(
                        model.brandName.ifEmpty { " " },
                        style = YardFonts.headline,
                        color = Color.yard.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (model.brandVerified) {
                        Icon(Icons.Filled.Verified, contentDescription = "Verified brand", tint = Color.yard.violet, modifier = Modifier.size(14.dp))
                    }
                }
                val c = model.conversation
                if (c?.status == "resolved") {
                    Text("Resolved. Writing again reopens it.", style = YardFonts.micro, color = Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else if (c?.muted == true) {
                    Text("Muted", style = YardFonts.micro, color = Color.yard.ink3)
                }
            }
        }
        Box {
            GlassIconButton(Icons.Filled.MoreHoriz, contentDescription = "More", size = 38.dp) { menuOpen = true }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = Color.yard.surface) {
                val name = model.displayName
                if (handle != null) {
                    InboxMenuItem("View storefront", Icons.Outlined.Storefront) {
                        menuOpen = false
                        router.push(Route.Brand(handle))
                    }
                }
                model.conversation?.let { c ->
                    InboxMenuItem(if (c.muted) "Unmute" else "Mute", if (c.muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff) {
                        menuOpen = false
                        val mute = !c.muted
                        model.run(toast, if (mute) "Muted $name" else "Unmuted $name") { model.setMuted(mute) }
                    }
                    InboxMenuItem(if (c.archived) "Unarchive" else "Archive", if (c.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive) {
                        menuOpen = false
                        val archive = !c.archived
                        model.run(toast, if (archive) "Archived" else "Moved back to your inbox") { model.setArchived(archive) }
                    }
                }
                HorizontalDivider(color = Color.yard.line)
                val blocked = model.isBlockedByMe
                InboxMenuItem(
                    if (blocked) "Unblock $name" else "Block $name",
                    Icons.Outlined.Block,
                    tint = if (blocked) Color.yard.ink else Color.yard.danger,
                ) {
                    menuOpen = false
                    onBlockTapped()
                }
            }
        }
    }
}

@Composable
internal fun InboxMenuItem(title: String, icon: ImageVector, tint: Color = Color.yard.ink, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title, style = YardFonts.body, color = tint) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = tint) },
        onClick = onClick,
    )
}

/** Bubbles (newest at the bottom, anchored there through the keyboard), order bar and composer. */
@Composable
private fun InboxThreadBody(
    model: InboxThreadModel,
    modifier: Modifier,
    onOpenOrder: (String) -> Unit,
    /** (message id, photo index). */
    onOpenPhotos: (String, Int) -> Unit,
) {
    val items = remember(model.messages, model.pending) { model.items() }
    val listState = rememberLazyListState()
    val lastId = items.lastOrNull()?.id
    // New message (sent or received): bring the newest into view. reverseLayout = index 0 is the bottom.
    LaunchedEffect(lastId) { if (lastId != null) listState.animateScrollToItem(0) }

    Column(modifier.fillMaxWidth()) {
        model.contextOrder?.let { order ->
            InboxOrderContextBar(order, Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.s)) { onOpenOrder(order.orderId) }
        }
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.s, bottom = Spacing.m),
            verticalArrangement = Arrangement.spacedBy(Spacing.s, Alignment.Bottom),
        ) {
            items(items.asReversed(), key = { it.id }, contentType = { it::class }) { item ->
                Box(Modifier.animateItem()) {
                    when (item) {
                        is InboxThreadItem.Day -> InboxDaySeparator(item.label)
                        is InboxThreadItem.Message -> InboxMessageRow(
                            item.message,
                            item.showsTime,
                            item.message.product?.let { model.productImages[it.productId] },
                            onOpenPhotos = { _, i -> onOpenPhotos(item.message.id, i) },
                        )
                        is InboxThreadItem.Pending -> InboxPendingRow(
                            item.pending,
                            onRetry = { model.retry(item.pending) },
                            onDiscard = { model.discard(item.pending) },
                        )
                    }
                }
            }
            if (model.isEmpty) {
                item(key = "intro") { InboxThreadIntro(model) }
            }
            if (model.hasMore) {
                item(key = "older") {
                    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.s), contentAlignment = Alignment.Center) {
                        if (model.isLoadingOlder) {
                            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                        } else {
                            YardButton("Load earlier messages", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false) { model.loadOlder() }
                        }
                    }
                }
            }
        }
        InboxComposer(
            placeholder = "Message ${model.displayName}",
            disabledReason = model.disabledReason,
            allowsPhotos = model.conversationId != null || model.brandId != null,
        ) { text, photos -> model.send(text, photos) }
    }
}

@Composable
private fun InboxThreadIntro(model: InboxThreadModel) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = Spacing.xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        BrandAvatar(name = model.displayName, logoUrl = model.brandLogoUrl, size = 72.dp, verified = model.brandVerified)
        Text("Ask ${model.displayName} anything", style = YardFonts.headline, color = Color.yard.ink, textAlign = TextAlign.Center)
        Text(
            "Sizing, stock, delivery or their next drop. Replies arrive here and in your notifications. Refunds and returns have their own steps on the order page.",
            style = YardFonts.callout,
            color = Color.yard.ink2,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 300.dp),
        )
    }
}

// region Previews (fixtures are preview-only)

internal object InboxThreadPreviewData {
    private fun iso(offsetSeconds: Long): String = Instant.now().plusSeconds(offsetSeconds).toString()

    fun model(): InboxThreadModel {
        val brand = InboxBrandRef(id = "brd_preview", handle = "acme", name = "Acme Studio", verified = true)
        val conversation = InboxConversation(id = "cv_preview", brand = brand, createdAt = iso(-200_000), interaction = InboxInteraction(canSend = true))
        val order = InboxOrderCard("ord_1", "YD-4821", "shipped", iso(-300_000), InboxMoney(12000.0, "USD"), 2)
        val messages = listOf(
            InboxMessage("m1", 1, "customer", kind = "order", body = "Hi! Any update on this order?", order = order, createdAt = iso(-100_000)),
            InboxMessage("m2", 2, "brand", body = "Yes — it left our studio this morning. Tracking is on the order page.", createdAt = iso(-99_000)),
            InboxMessage("m3", 3, "customer", body = "Amazing, thank you.", createdAt = iso(-600)),
            InboxMessage("m4", 4, "brand", body = "Any time. Shout if the fit isn't right.", createdAt = iso(-300)),
        )
        return InboxThreadModel.preview(conversation, messages)
    }
}

@Preview(name = "Thread — dark")
@Composable
private fun InboxThreadDark() = YardPreview(darkTheme = true) {
    InboxThreadScreen(remember { InboxThreadPreviewData.model() }, autoLoad = false)
}

@Preview(name = "Thread — light")
@Composable
private fun InboxThreadLight() = YardPreview(darkTheme = false) {
    InboxThreadScreen(remember { InboxThreadPreviewData.model() }, autoLoad = false)
}

@YardTabletPreviews
@Composable
private fun InboxThreadTablet() = YardPreview(darkTheme = true) {
    InboxThreadScreen(remember { InboxThreadPreviewData.model() }, autoLoad = false)
}

// endregion
