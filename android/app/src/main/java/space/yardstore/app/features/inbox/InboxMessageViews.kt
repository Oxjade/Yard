package space.yardstore.app.features.inbox

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard

private val InboxBubbleShape = RoundedCornerShape(20.dp)

/** "Today" / "Yesterday" / "Wed 4 Nov" between days. */
@Composable
fun InboxDaySeparator(label: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = Spacing.s), contentAlignment = Alignment.Center) {
        Text(
            label,
            style = YardFonts.captionEmphasis,
            color = Color.yard.ink2,
            modifier = Modifier
                .clip(CircleShape)
                .background(Color.yard.surface2)
                .padding(horizontal = Spacing.m, vertical = Spacing.xs)
                .semantics { heading() },
        )
    }
}

/** The bubble shape: mine on acid (right), theirs on surface2 (left). */
@Composable
private fun InboxBubble(mine: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .clip(InboxBubbleShape)
            .background(if (mine) Color.yard.acid else Color.yard.surface2)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) { content() }
}

/** One message from the server: text, photos, shared product or order, held/removed states. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun InboxMessageRow(
    message: InboxMessage,
    showsTime: Boolean,
    productImage: String?,
    modifier: Modifier = Modifier,
    onOpenPhotos: (List<InboxAttachment>, Int) -> Unit = { _, _ -> },
) {
    if (message.isSystem) {
        Text(
            message.body ?: "",
            style = YardFonts.caption,
            color = Color.yard.ink2,
            textAlign = TextAlign.Center,
            modifier = modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.xs),
        )
        return
    }
    val router = LocalRouter.current
    val mine = message.isMine
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = if (mine) 56.dp else 0.dp, end = if (mine) 0.dp else 56.dp),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (message.safetyNotice && !mine) {
            Row(
                Modifier
                    .border(1.dp, Color.yard.line, RoundedCornerShape(Radius.small))
                    .padding(horizontal = Spacing.m, vertical = Spacing.s),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Shield, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(16.dp))
                Text(InboxFormat.safetyCopy, style = YardFonts.caption, color = Color.yard.ink2)
            }
        }
        if (message.isRemoved) {
            InboxBubble(mine = false) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Block, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(16.dp))
                    Text("Message removed by Yard.", style = YardFonts.callout.copy(fontStyle = FontStyle.Italic), color = Color.yard.ink3)
                }
            }
        } else {
            message.product?.let { product ->
                InboxProductCardView(product, productImage) { if (product.slug.isNotEmpty()) router.push(Route.Product(product.slug)) }
            }
            message.order?.let { order ->
                InboxOrderCardView(order) { router.push(Route.Order(order.orderId)) }
            }
            if (message.attachments.isNotEmpty()) {
                InboxPhotoGrid(message.attachments) { index -> onOpenPhotos(message.attachments, index) }
            }
            val text = message.body
            if (!text.isNullOrEmpty()) {
                val clipboard = LocalClipboardManager.current
                val haptics = LocalHapticFeedback.current
                var menu by remember { mutableStateOf(false) }
                Box {
                    InboxBubble(
                        mine = mine,
                        modifier = Modifier
                            .alpha(if (message.isHeld) 0.6f else 1f)
                            .combinedClickable(
                                onClick = {},
                                onLongClick = {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    menu = true
                                },
                                onLongClickLabel = "Copy",
                            ),
                    ) {
                        Text(text, style = YardFonts.body, color = if (mine) Color.yard.onAcid else Color.yard.ink)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Color.yard.surface) {
                        DropdownMenuItem(
                            text = { Text("Copy", style = YardFonts.body, color = Color.yard.ink) },
                            leadingIcon = { Icon(Icons.Outlined.ContentCopy, contentDescription = null, tint = Color.yard.ink) },
                            onClick = {
                                clipboard.setText(AnnotatedString(text))
                                menu = false
                            },
                        )
                    }
                }
            }
        }
        if (message.isHeld && mine) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
                Tag("Held for review")
                Text(InboxFormat.heldCopy, style = YardFonts.caption, color = Color.yard.ink3, textAlign = TextAlign.End)
            }
        }
        val date = message.date
        if (showsTime && date != null) {
            Text(
                InboxFormat.time(date),
                style = YardFonts.micro.monospacedDigits(),
                color = Color.yard.ink3,
                modifier = Modifier.padding(horizontal = Spacing.xs),
            )
        }
    }
}

/** A send that the server hasn't confirmed: dimmed bubble with "Sending…", or failed with retry. */
@Composable
fun InboxPendingRow(
    pending: InboxPendingMessage,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit,
    onDiscard: () -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = 56.dp)
            .alpha(if (pending.isFailed) 1f else 0.7f),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (pending.photos.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                for (photo in pending.photos) {
                    Image(
                        photo.thumbnail,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(width = 96.dp, height = 120.dp).clip(RoundedCornerShape(Radius.small)),
                    )
                }
            }
        }
        pending.order?.let { order ->
            InboxOrderChipView(order)
        }
        if (pending.text.isNotEmpty()) {
            InboxBubble(mine = true) {
                Text(pending.text, style = YardFonts.body, color = Color.yard.onAcid)
            }
        }
        val failure = pending.failedMessage
        if (failure != null) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(failure, style = YardFonts.caption, color = Color.yard.danger, textAlign = TextAlign.End)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    YardButton("Discard", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false, onClick = onDiscard)
                    YardButton("Retry", icon = Icons.Filled.Refresh, style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, onClick = onRetry)
                }
            }
        } else {
            Text("Sending…", style = YardFonts.micro, color = Color.yard.ink3)
        }
    }
}

/** Photos on a message: one tall, or a 2-column grid. */
@Composable
fun InboxPhotoGrid(attachments: List<InboxAttachment>, modifier: Modifier = Modifier, onOpen: (Int) -> Unit) {
    val shape = RoundedCornerShape(Radius.image)
    @Composable
    fun photo(a: InboxAttachment, index: Int, m: Modifier) {
        RemoteImage(
            a.url,
            m.pressableClick { onOpen(index) }
                .semantics { contentDescription = "Open photo ${index + 1} of ${attachments.size}" },
            maxPixelSize = 800,
        )
    }
    if (attachments.size == 1) {
        photo(attachments[0], 0, modifier.size(width = 220.dp, height = 275.dp).clip(shape))
    } else {
        Column(modifier.width(252.dp).clip(shape), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            attachments.withIndex().chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for ((i, a) in pair) photo(a, i, Modifier.weight(1f).height(124.dp))
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

/** A shared piece: photo (from the catalogue), name, size, price when shared. */
@Composable
fun InboxProductCardView(card: InboxProductCard, imageUrl: String?, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val shape = RoundedCornerShape(Radius.image)
    Column(
        modifier
            .width(232.dp)
            .pressableClick(onClick = onOpen)
            .clip(shape)
            .background(Color.yard.surface)
            .border(1.dp, Color.yard.line, shape)
            .padding(Spacing.s)
            .semantics { contentDescription = "${card.name}, ${card.price.formatted}. Opens the product" },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Box(
            Modifier.size(width = 216.dp, height = 270.dp).clip(RoundedCornerShape(Radius.small)).background(Color.yard.surface2),
            contentAlignment = Alignment.Center,
        ) {
            if (imageUrl != null) {
                RemoteImage(imageUrl, Modifier.fillMaxSize(), maxPixelSize = 700)
            } else {
                Icon(Icons.Outlined.LocalOffer, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(28.dp))
            }
        }
        Column(Modifier.padding(horizontal = Spacing.xxs), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(card.name, style = YardFonts.callout, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val v = card.variantLabel
            if (!v.isNullOrEmpty()) {
                Text(v, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Text(card.price.formatted, style = YardFonts.captionEmphasis.monospacedDigits(), color = Color.yard.ink)
                Text("price when shared", style = YardFonts.caption, color = Color.yard.ink3)
            }
        }
    }
}

/** An order attached to a message: reference, status, placed, items, total, Open order. */
@Composable
fun InboxOrderCardView(card: InboxOrderCard, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val shape = RoundedCornerShape(Radius.image)
    Column(
        modifier
            .width(264.dp)
            .clip(shape)
            .background(Color.yard.surface)
            .border(1.dp, Color.yard.line, shape)
            .padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(card.reference, style = YardFonts.bodyEmphasis.monospacedDigits(), color = Color.yard.ink, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(Spacing.s))
            Tag(InboxFormat.orderStatus(card.status), style = if (card.status == "delivered") TagStyle.Success else TagStyle.Neutral)
        }
        InboxOrderCardRow("Placed", InboxFormat.shortDate(card.placedAt))
        InboxOrderCardRow("Items", card.itemCount.toString())
        InboxOrderCardRow("Total", card.total.formatted, emphasis = true)
        YardButton("Open order", Modifier.padding(top = Spacing.xs), style = YardButtonStyle.Secondary, size = YardButtonSize.Small, onClick = onOpen)
    }
}

@Composable
private fun InboxOrderCardRow(title: String, value: String, emphasis: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = YardFonts.caption, color = Color.yard.ink3, modifier = Modifier.weight(1f))
        Text(
            value,
            style = (if (emphasis) YardFonts.captionEmphasis else YardFonts.caption).monospacedDigits(),
            color = if (emphasis) Color.yard.ink else Color.yard.ink2,
        )
    }
}

/** The order this thread is about, pinned under the header. */
@Composable
fun InboxOrderContextBar(card: InboxOrderCard, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val shape = RoundedCornerShape(Radius.small + 4.dp)
    Row(
        modifier
            .fillMaxWidth()
            .pressableClick(onClick = onOpen)
            .clip(shape)
            .background(Color.yard.surface)
            .border(1.dp, Color.yard.line, shape)
            .padding(horizontal = Spacing.m, vertical = Spacing.s),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(Color.yard.surface2), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Inventory2, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text("About order ${card.reference}", style = YardFonts.captionEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${InboxFormat.orderStatus(card.status)} · ${card.itemCount} ${if (card.itemCount == 1) "item" else "items"} · ${card.total.formatted}",
                style = YardFonts.caption,
                color = Color.yard.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(20.dp))
    }
}

/** Full-screen photo viewer (lightbox) for message photos. Back / × closes it. */
@Composable
fun InboxPhotoViewer(attachments: List<InboxAttachment>, index: Int, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val pager = rememberPagerState(initialPage = index.coerceIn(0, (attachments.size - 1).coerceAtLeast(0))) { attachments.size }
        Box(Modifier.fillMaxSize().background(Color.yard.scrim)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), key = { attachments[it].mediaId.ifEmpty { it.toString() } }) { page ->
                RemoteImage(
                    attachments[page].url,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                    maxPixelSize = 1600,
                    contentDescription = "Photo ${page + 1} of ${attachments.size}",
                )
            }
            if (attachments.size > 1) {
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = Spacing.xxl),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    repeat(attachments.size) { i ->
                        Box(
                            Modifier.size(7.dp).clip(CircleShape)
                                .background(if (i == pager.currentPage) Color.yard.onPhoto else Color.yard.onPhoto.copy(alpha = 0.4f)),
                        )
                    }
                }
            }
            GlassIconButton(
                Icons.Filled.Close,
                contentDescription = "Close photo",
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(Spacing.gutter),
                onClick = onDismiss,
            )
        }
    }
}

/** Bubble-shaped loading placeholders. */
@Composable
fun InboxThreadSkeleton(modifier: Modifier = Modifier) {
    val widths = listOf(180, 230, 140, 210, 160, 240)
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.l)
            .semantics { contentDescription = "Loading messages" },
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        for (i in 0 until 6) {
            val mine = i % 3 == 1
            Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                Skeleton(Modifier.size(width = widths[i].dp, height = if (i % 2 == 0) 44.dp else 64.dp), cornerRadius = 20.dp)
            }
        }
    }
}

// region Previews

@Composable
private fun InboxMessageViewsSample() {
    val order = InboxOrderCard("ord_1", "YD-4821", "shipped", "2026-11-10T10:00:00Z", InboxMoney(12000.0, "USD"), 2)
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        InboxDaySeparator("Today")
        InboxOrderContextBar(order) {}
        InboxMessageRow(InboxMessage("m1", 1, "brand", body = "Yes — it left our studio this morning.", safetyNotice = true, createdAt = "2026-11-13T10:00:00Z"), true, null)
        InboxMessageRow(InboxMessage("m2", 2, "customer", body = "Amazing, thank you.", status = "held", createdAt = "2026-11-13T10:01:00Z"), true, null)
        InboxPendingRow(InboxPendingMessage("p1", "Does the M fit true to size?", emptyList(), java.time.Instant.now(), failedMessage = "We couldn't reach Yard. Try again."), onRetry = {}, onDiscard = {})
    }
}

@Preview(name = "Message views — dark", heightDp = 700)
@Composable
private fun InboxMessageViewsDark() = YardPreview(darkTheme = true) { InboxMessageViewsSample() }

@Preview(name = "Message views — light", heightDp = 700)
@Composable
private fun InboxMessageViewsLight() = YardPreview(darkTheme = false) { InboxMessageViewsSample() }

@Preview(name = "Order card — dark")
@Composable
private fun InboxOrderCardDark() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(Spacing.gutter).widthIn(max = 320.dp)) {
        InboxOrderCardView(InboxOrderCard("ord_1", "YD-4821", "delivered", "2026-11-10T10:00:00Z", InboxMoney(12000.0, "USD"), 2)) {}
    }
}

// endregion
