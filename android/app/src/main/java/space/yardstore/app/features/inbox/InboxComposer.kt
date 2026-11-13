package space.yardstore.app.features.inbox

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.yard

private const val InboxComposerMaxPhotos = 4
private const val InboxComposerMaxLength = 2000

/**
 * The pill composer: photo button (Android photo picker, up to 4), growing text field, acid send.
 * When the shopper can't send, it shows why instead (blocked, paused, closed…). Mirrors `InboxComposer.swift`.
 * Sits above the navigation bar and the keyboard (`navigationBarsPadding().imePadding()`).
 */
@Composable
fun InboxComposer(
    placeholder: String,
    disabledReason: String?,
    /** Photos need a conversation or a brand to upload against; both are always known here. */
    allowsPhotos: Boolean,
    modifier: Modifier = Modifier,
    onFocusChanged: (Boolean) -> Unit = {},
    onSend: (String, List<InboxPreparedPhoto>) -> Unit,
) {
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var text by rememberSaveable { mutableStateOf("") }
    val photos = remember { mutableStateListOf<InboxPreparedPhoto>() }
    var isPreparing by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    val trimmed = text.trim()
    val canSend = (trimmed.isNotEmpty() || photos.isNotEmpty()) && !isPreparing && text.length <= InboxComposerMaxLength

    fun addPhotos(uris: List<android.net.Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            isPreparing = true
            var skipped = 0
            for (uri in uris) {
                if (photos.size >= InboxComposerMaxPhotos) break
                val prepared = InboxPhotoPrep.prepare(context, uri)
                if (prepared == null) skipped++ else photos.add(prepared)
            }
            isPreparing = false
            if (skipped > 0) {
                toast.show(if (skipped == 1) "That photo couldn't be added. Try another." else "Some photos couldn't be added.", Toast.Style.Error)
            }
        }
    }

    // PickMultipleVisualMedia needs maxItems > 1, so the last free slot uses the single picker.
    val pickMany = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(InboxComposerMaxPhotos)) { uris ->
        addPhotos(uris.take((InboxComposerMaxPhotos - photos.size).coerceAtLeast(0)))
    }
    val pickOne = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) addPhotos(listOf(uri))
    }
    val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)

    fun send() {
        if (!canSend) return
        onSend(trimmed, photos.toList())
        text = ""
        photos.clear()
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    Column(
        modifier
            .fillMaxWidth()
            .background(Color.yard.bg)
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color.yard.line))
        if (disabledReason != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.m),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
                Text(disabledReason, style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.weight(1f))
            }
        } else {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = Spacing.m - Spacing.xs, vertical = Spacing.xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                if (photos.isNotEmpty() || isPreparing) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        items(photos, key = { it.id }) { photo ->
                            Box(Modifier.padding(top = 6.dp, end = 6.dp).animateItem()) {
                                Image(
                                    photo.thumbnail,
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.size(64.dp).clip(RoundedCornerShape(Radius.small)),
                                )
                                // 48dp touch area centred on the 22dp badge at the photo's corner.
                                Box(
                                    Modifier
                                        .align(Alignment.TopEnd)
                                        .offset(x = 19.dp, y = (-19).dp)
                                        .size(48.dp)
                                        .clip(CircleShape)
                                        .clickable { photos.remove(photo) }
                                        .semantics { contentDescription = "Remove photo" },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Box(
                                        Modifier
                                            .size(22.dp)
                                            .clip(CircleShape)
                                            .background(Color.yard.surface2)
                                            .border(1.dp, Color.yard.line, CircleShape),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Filled.Close, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(12.dp))
                                    }
                                }
                            }
                        }
                        if (isPreparing) {
                            item(key = "preparing") {
                                Skeleton(Modifier.padding(top = 6.dp).size(64.dp), cornerRadius = Radius.small)
                            }
                        }
                    }
                }
                // Buttons: 40dp circles inside 48dp touch areas; the field gets 4dp vertical padding to line up.
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    if (allowsPhotos) {
                        val photoEnabled = photos.size < InboxComposerMaxPhotos && !isPreparing
                        Box(
                            Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .clickable(enabled = photoEnabled) {
                                    if (InboxComposerMaxPhotos - photos.size >= 2) pickMany.launch(request) else pickOne.launch(request)
                                }
                                .semantics { contentDescription = "Add a photo" },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.size(40.dp).clip(CircleShape).background(Color.yard.surface2), contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Outlined.AddPhotoAlternate,
                                    contentDescription = null,
                                    tint = if (photoEnabled) Color.yard.ink else Color.yard.ink3,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                    BasicTextField(
                        value = text,
                        onValueChange = { text = it },
                        textStyle = YardFonts.body.copy(color = Color.yard.ink),
                        cursorBrush = SolidColor(Color.yard.ink),
                        maxLines = 5,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        modifier = Modifier
                            .weight(1f)
                            .padding(vertical = Spacing.xs)
                            .heightIn(min = 40.dp)
                            .focusRequester(focus)
                            .onFocusChanged { onFocusChanged(it.isFocused) },
                        decorationBox = { inner ->
                            Box(
                                Modifier
                                    .heightIn(min = 40.dp)
                                    .clip(RoundedCornerShape(20.dp))
                                    .background(Color.yard.surface2)
                                    .border(1.dp, Color.yard.line, RoundedCornerShape(20.dp))
                                    .padding(horizontal = Spacing.m, vertical = 9.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                if (text.isEmpty()) {
                                    Text(placeholder, style = YardFonts.body, color = Color.yard.ink3, maxLines = 1)
                                }
                                inner()
                            }
                        },
                    )
                    val sendBg by animateColorAsState(if (canSend) Color.yard.acid else Color.yard.surface2, Motion.snappy(), label = "sendBg")
                    val sendFg by animateColorAsState(if (canSend) Color.yard.onAcid else Color.yard.ink3, Motion.snappy(), label = "sendFg")
                    Box(
                        Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .clickable(enabled = canSend) { send() }
                            .semantics { contentDescription = "Send message" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.size(40.dp).clip(CircleShape).background(sendBg), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.ArrowUpward, contentDescription = null, tint = sendFg, modifier = Modifier.size(20.dp))
                        }
                    }
                }
                if (text.length > InboxComposerMaxLength - 200) {
                    Text(
                        "${text.length}/$InboxComposerMaxLength",
                        style = YardFonts.micro,
                        color = if (text.length > InboxComposerMaxLength) Color.yard.danger else Color.yard.ink3,
                        textAlign = TextAlign.End,
                        modifier = Modifier.fillMaxWidth().padding(end = Spacing.s),
                    )
                }
            }
        }
    }
}

@Preview(name = "Composer — dark")
@Composable
private fun InboxComposerDark() = YardPreview(darkTheme = true) {
    Column {
        InboxComposer("Message Acme Studio", disabledReason = null, allowsPhotos = true) { _, _ -> }
        Spacer(Modifier.height(Spacing.l))
        InboxComposer("Message Acme Studio", disabledReason = "You blocked Acme Studio. Unblock them from the menu to send a message.", allowsPhotos = true) { _, _ -> }
    }
}

@Preview(name = "Composer — light")
@Composable
private fun InboxComposerLight() = YardPreview(darkTheme = false) {
    Column(Modifier.width(390.dp)) {
        InboxComposer("Message Acme Studio", disabledReason = null, allowsPhotos = true) { _, _ -> }
    }
}
