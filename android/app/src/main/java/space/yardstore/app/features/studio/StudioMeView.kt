package space.yardstore.app.features.studio

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.BackAction
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardSwitch
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.inbox.InboxMessage
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

class StudioMeModel(private val store: StudioStore?, previewPayouts: StudioPayouts? = null, previewUnread: Int = 0, previewSettings: StudioPushChoices? = null) : ViewModel() {
    var payouts by mutableStateOf(previewPayouts)
        private set
    var payoutsHidden by mutableStateOf(false)
        private set
    var unread by mutableStateOf(previewUnread)
        private set
    var push by mutableStateOf(previewSettings)
        private set
    var testing by mutableStateOf(false)
        private set

    suspend fun load() {
        val store = store ?: return
        // Profile first (permissions decide what to show).
        runCatching { store.call { } }
        val profile = store.profile
        if (profile == null || profile.seesPayouts) {
            try {
                payouts = store.payouts()
            } catch (e: CancellationException) {
                throw e
            } catch (e: APIError) {
                if (e.status == 403) payoutsHidden = true
            } catch (_: Exception) {
            }
        } else {
            payoutsHidden = true
        }
        if (store.can("inbox.read")) runCatching { unread = store.inboxUnread() }
        runCatching { push = store.notificationSettings().push }
    }

    suspend fun set(choices: StudioPushChoices): String? {
        val store = store ?: return null
        val before = push
        push = choices
        return try {
            push = store.saveNotificationSettings(choices).push
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            push = before
            APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    suspend fun testPush(): String {
        val store = store ?: return ""
        testing = true
        return try {
            val r = store.testPush()
            when {
                r.devices == 0 -> "This phone isn't registered for Studio notifications yet. Allow notifications for Yard, then try again."
                !r.delivered -> "Your phone is registered, but Yard couldn't send right now."
                else -> "Sent. It should arrive in a moment."
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            APIError.messageFor(if (e is APIError) e else APIError.network(e))
        } finally {
            testing = false
        }
    }
}

@Composable
fun StudioMeView() {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val model: StudioMeModel = viewModel(key = "studio-me-${studio.generation}") { StudioMeModel(studio) }
    val depth = nav.stack(StudioTab.Me).size
    LaunchedEffect(model, depth) { if (depth == 0) model.load() }
    StudioMeScreen(model)
}

/** A grouped list (settings inspo): a title and rows on one surface. */
@Composable
internal fun StudioGroup(title: String?, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (title != null) Text(title, style = YardFonts.title, color = Color.yard.ink)
        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs), content = content)
    }
}

@Composable
internal fun StudioMeScreen(model: StudioMeModel) {
    val studio = LocalStudioStore.current
    val session = LocalSessionStore.current
    val nav = LocalStudioNav.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    val brand = studio.activeBrand
    val dark = Color.yard.isDark
    var signingOut by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color.yard.bg)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.m, bottom = StudioPillClearance + Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            if (brand != null) StudioBrandMark(brand.name, brand.mark, brand.logoSrc, size = 56.dp)
            Column(Modifier.weight(1f)) {
                YardDisplayText(brand?.name ?: "Studio", size = 30.sp, maxLines = 2)
                Text(
                    listOfNotNull(studio.profile?.role ?: brand?.role, if (brand?.isPendingReview == true) "in review" else null)
                        .joinToString(" · ") { it.replaceFirstChar { c -> c.uppercase() } },
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                )
            }
        }

        if (!model.payoutsHidden) BalanceCard(model.payouts) { nav.push(StudioRoute.Payouts) }

        StudioGroup("Messages") {
            if (studio.can("inbox.read")) StudioRow("Inbox", if (model.unread > 0) "${model.unread} unread" else "Customer messages", Icons.Outlined.ChatBubbleOutline, count = model.unread) { nav.push(StudioRoute.Inbox) }
            StudioRow("Yard Support", "Questions about Studio, payouts or your shop", Icons.Outlined.SupportAgent) { nav.push(StudioRoute.Support) }
        }

        StudioGroup("Your shop") {
            val handle = brand?.handle.orEmpty()
            StudioRow("View shop", "yardstore.space/brands/$handle", Icons.Outlined.OpenInNew) { WebPages.open(context, Config.webUrl("/brands/$handle"), darkTheme = dark) }
            StudioRow("Share shop", null, Icons.Outlined.IosShare) { shareShop(context, handle, brand?.name.orEmpty()) }
            if (studio.studioBrands.size > 1) StudioRow("Switch brand", "${studio.studioBrands.size} brands", Icons.Outlined.SwapHoriz) { studio.showsBrandPicker = true }
        }

        StudioGroup("Notifications") {
            val p = model.push
            if (p == null) {
                Box(Modifier.fillMaxWidth().padding(Spacing.l)) { Skeleton(Modifier.fillMaxWidth().height(20.dp)) }
            } else {
                fun toggle(next: StudioPushChoices) {
                    haptics.tick()
                    scope.launch { model.set(next)?.let { haptics.reject(); toast.show(it, Toast.Style.Error) } }
                }
                PushRow("New orders", p.orders) { toggle(p.copy(orders = it)) }
                PushRow("Messages", p.messages) { toggle(p.copy(messages = it)) }
                PushRow("Low stock", p.lowStock) { toggle(p.copy(lowStock = it)) }
                PushRow("Payouts", p.payouts) { toggle(p.copy(payouts = it)) }
            }
            StudioRow(
                "Send a test notification",
                null,
                Icons.Outlined.NotificationsActive,
                trailing = if (model.testing) ({ CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp)) }) else null,
            ) {
                scope.launch {
                    val msg = model.testPush()
                    if (msg.startsWith("Sent")) haptics.success() else haptics.reject()
                    toast.show(msg, if (msg.startsWith("Sent")) Toast.Style.Success else Toast.Style.Info)
                }
            }
        }

        StudioGroup(null) {
            StudioRow("Switch to shopping", "Studio stays a tap away on You", Icons.Outlined.ShoppingBag) {
                haptics.confirm()
                studio.leave()
            }
            StudioRow(
                "Sign out",
                null,
                Icons.AutoMirrored.Filled.Logout,
                tint = Color.yard.danger,
                trailing = if (signingOut) ({ CircularProgressIndicator(color = Color.yard.danger, strokeWidth = 2.dp, modifier = Modifier.size(18.dp)) }) else null,
            ) {
                if (signingOut) return@StudioRow
                signingOut = true
                scope.launch {
                    session.signOut()
                    signingOut = false
                    toast.show("Signed out", Toast.Style.Info)
                }
            }
        }
    }
}

@Composable
private fun PushRow(title: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.l, vertical = Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = YardFonts.body, color = Color.yard.ink, modifier = Modifier.weight(1f))
        YardSwitch(on, onChange)
    }
}

/** Available to pay out (big) and still pending (small), on the balance card. */
@Composable
private fun BalanceCard(payouts: StudioPayouts?, onOpen: () -> Unit) {
    val haptics = rememberYardHaptics()
    val white = Color.yard.onPhoto
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.onAcid, YardShapes.card)
            .background(Brush.linearGradient(listOf(Color.yard.violetFill.copy(alpha = 0.6f), Color.Transparent)), YardShapes.card)
            .border(1.dp, Color.yard.line, YardShapes.card)
            .pressableClick(onClickLabel = "Payouts") { haptics.click(); onOpen() }
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Text("Available balance", style = YardFonts.callout, color = white.copy(alpha = 0.75f))
        if (payouts == null) {
            Skeleton(Modifier.widthIn(max = 180.dp).fillMaxWidth().height(36.dp))
        } else {
            val b = payouts.balance
            Text(studioMoney(b.availableMinor, b.currency), style = YardFonts.number(36.sp), color = white)
            Text(
                buildString {
                    append("${studioMoney(b.pendingMinor, b.currency)} pending")
                    if (b.inPayoutMinor > 0) append(" · ${studioMoney(b.inPayoutMinor, b.currency)} on its way")
                },
                style = YardFonts.caption.monospacedDigits(),
                color = white.copy(alpha = 0.7f),
            )
            if (payouts.rules.onHold) Text(payouts.rules.holdReason ?: "Payouts are on hold.", style = YardFonts.caption, color = Color.yard.acid)
        }
    }
}

// region Payouts

@Composable
fun StudioPayoutsView() {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    var data by remember { mutableStateOf<StudioPayouts?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    suspend fun load() {
        try {
            data = studio.payouts()
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            error = if (e.status == 403) "Payouts are visible to owners, admins and finance." else e.message
        } catch (e: Exception) {
            error = APIError.network(e).message
        }
    }
    LaunchedEffect(Unit) { load() }
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar("Payouts", back = back)
        val d = data
        when {
            d == null && error != null -> EmptyState.Error(error.orEmpty(), Modifier.weight(1f)) { load() }
            d == null -> Column(Modifier.padding(Spacing.gutter)) { Skeleton(Modifier.fillMaxWidth().height(160.dp)) }
            else -> LazyColumn(
                Modifier.weight(1f).navigationBarsPadding(),
                contentPadding = PaddingValues(Spacing.gutter),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                item { BalanceCard(d) {} }
                item {
                    StudioGroup("Payout account") {
                        val a = d.account
                        if (a == null) {
                            StudioRow("Add a payout account", "On the Yard website, where your bank details stay safe", Icons.Outlined.AccountBalance) {
                                WebPages.open(context, Config.webUrl("/studio/payouts"), darkTheme = dark)
                            }
                        } else {
                            StudioRow(
                                a.bankName ?: "Bank account",
                                listOfNotNull(a.accountName, a.accountLast4?.let { "•••• $it" }, if (a.verified) "Verified" else "Not verified yet").joinToString(" · "),
                                Icons.Outlined.AccountBalance,
                            ) { WebPages.open(context, Config.webUrl("/studio/payouts"), darkTheme = dark) }
                        }
                    }
                }
                item { Text("History", style = YardFonts.title, color = Color.yard.ink) }
                if (d.payouts.isEmpty()) {
                    item { Text("No payouts yet. Your available balance is paid out to your payout account.", style = YardFonts.callout, color = Color.yard.ink3) }
                }
                items(d.payouts, key = { it.id }) { p ->
                    Row(
                        Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(studioMoney(p.amountMinor, p.currency), style = YardFonts.headline.monospacedDigits(), color = Color.yard.ink)
                            Text(Formatters.relative(p.paidAt ?: p.requestedAt), style = YardFonts.caption, color = Color.yard.ink3)
                            (p.lastError ?: p.rejectReason)?.let { Text(it, style = YardFonts.caption, color = Color.yard.danger) }
                        }
                        StudioPill(
                            p.statusTitle,
                            when (p.status) {
                                "paid" -> StudioPillStyle.Success
                                "failed", "rejected" -> StudioPillStyle.Danger
                                "sending", "processing" -> StudioPillStyle.Acid
                                else -> StudioPillStyle.Neutral
                            },
                        )
                    }
                }
            }
        }
    }
}

// endregion

// region Inbox

@Composable
fun StudioInboxView() {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    var page by remember { mutableStateOf<StudioConversationsPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    suspend fun load() {
        try {
            page = studio.conversations()
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }
    val depth = nav.stack(StudioTab.Me).size
    LaunchedEffect(depth) { load() }
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar("Inbox", back = back)
        val p = page
        when {
            p == null && error != null -> EmptyState.Error(error.orEmpty(), Modifier.weight(1f)) { load() }
            p == null -> Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) { repeat(4) { Skeleton(Modifier.fillMaxWidth().height(64.dp)) } }
            p.items.isEmpty() -> EmptyState("No messages yet", Modifier.weight(1f), message = "When a customer writes to your shop, it lands here.", icon = Icons.Outlined.ChatBubbleOutline)
            else -> LazyColumn(Modifier.weight(1f).navigationBarsPadding(), contentPadding = PaddingValues(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                items(p.items, key = { it.id }) { c -> ConversationRow(c) { nav.push(StudioRoute.Thread(c.id)) } }
            }
        }
    }
}

@Composable
private fun ConversationRow(c: StudioConversation, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface, YardShapes.card)
            .pressableClick(onClickLabel = c.title) { haptics.click(); onClick() }
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(Modifier.size(44.dp).background(Color.yard.surface2, CircleShape), contentAlignment = Alignment.Center) {
            Text(c.title.take(1).uppercase(), style = YardFonts.headline, color = Color.yard.ink)
            c.customer?.photoSrc?.let { RemoteImage(Config.url(it), Modifier.size(44.dp).background(Color.Transparent, CircleShape).then(Modifier), maxPixelSize = 160, placeholder = {}) }
        }
        Column(Modifier.weight(1f)) {
            Text(c.title, style = if (c.isUnread) YardFonts.headline else YardFonts.body, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(c.previewText, style = YardFonts.caption, color = if (c.isUnread) Color.yard.ink else Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Formatters.relative(c.lastMessage?.at ?: c.createdAt), style = YardFonts.micro, color = Color.yard.ink3)
            if (c.isUnread) Box(Modifier.padding(top = 4.dp).size(10.dp).background(Color.yard.acid, CircleShape).border(1.dp, Color.yard.line, CircleShape))
        }
    }
}

/** A conversation with a customer ([conversationId]), or with Yard Support (null). Text replies. */
@Composable
fun StudioThreadView(conversationId: String?) {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    var thread by remember { mutableStateOf<StudioThread?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    suspend fun load() {
        try {
            thread = if (conversationId != null) {
                studio.thread(conversationId)
            } else {
                if (studio.supportConversation() == null) null else studio.supportThread()
            }
            error = null
            val last = thread?.messages?.maxOfOrNull { it.seq } ?: 0
            if (last > 0) runCatching { if (conversationId != null) studio.markThreadRead(conversationId, last) else studio.markSupportRead(last) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        } finally {
            loaded = true
        }
    }
    LaunchedEffect(conversationId) {
        load()
        // Light polling while the thread is open.
        while (true) {
            delay(15_000)
            load()
        }
    }
    val messages = thread?.messages.orEmpty().sortedBy { it.seq }
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }
    val canReply = conversationId == null || studio.can("inbox.reply")

    Column(Modifier.fillMaxSize().background(Color.yard.bg).imePadding()) {
        YardTopBar(if (conversationId == null) "Yard Support" else thread?.conversation?.title ?: "Conversation", back = back)
        Box(Modifier.weight(1f)) {
            when {
                !loaded -> Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) { repeat(3) { Skeleton(Modifier.fillMaxWidth(0.7f).height(44.dp)) } }
                thread == null && error != null -> EmptyState.Error(error.orEmpty(), Modifier.fillMaxSize()) { load() }
                messages.isEmpty() -> EmptyState(
                    if (conversationId == null) "Write to Yard Support" else "No messages",
                    Modifier.fillMaxSize(),
                    message = if (conversationId == null) "Questions about Studio, payouts or your shop. Yard's team replies here." else null,
                    icon = Icons.Outlined.SupportAgent,
                )
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    state = listState,
                    contentPadding = PaddingValues(Spacing.gutter),
                    verticalArrangement = Arrangement.spacedBy(Spacing.s),
                ) {
                    items(messages, key = { it.id }) { m -> Bubble(m) }
                }
            }
        }
        if (canReply) {
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(Spacing.s),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Box(Modifier.weight(1f).background(Color.yard.surface2, YardShapes.card).padding(horizontal = 16.dp, vertical = 12.dp)) {
                    if (draft.isEmpty()) Text("Reply…", style = YardFonts.body, color = Color.yard.ink3)
                    BasicTextField(
                        draft,
                        { draft = it.take(4000) },
                        textStyle = YardFonts.body.copy(color = Color.yard.ink),
                        cursorBrush = SolidColor(Color.yard.ink),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Default),
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Reply" },
                    )
                }
                Box(
                    Modifier.size(48.dp).background(if (draft.isBlank()) Color.yard.surface2 else Color.yard.acid, CircleShape)
                        .pressableClick(enabled = draft.isNotBlank() && !sending, onClickLabel = "Send") {
                            val text = draft.trim()
                            haptics.click()
                            sending = true
                            scope.launch {
                                try {
                                    val clientId = UUID.randomUUID().toString()
                                    if (conversationId != null) studio.reply(conversationId, text, clientId) else studio.supportReply(text, clientId)
                                    draft = ""
                                    haptics.confirm()
                                    load()
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    haptics.reject()
                                    error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
                                } finally {
                                    sending = false
                                }
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    if (sending) {
                        CircularProgressIndicator(color = Color.yard.onAcid, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, tint = if (draft.isBlank()) Color.yard.ink3 else Color.yard.onAcid)
                    }
                }
            }
        }
    }
}

@Composable
private fun Bubble(m: InboxMessage) {
    // Studio's own messages are side "brand"; the shopper is "customer"; Yard is "support".
    val mine = m.side == "brand"
    if (m.isSystem) {
        Text(m.body.orEmpty(), style = YardFonts.caption, color = Color.yard.ink3, modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs))
        return
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .background(if (mine) Color.yard.acid else Color.yard.surface2, YardShapes.card)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            m.photos.forEach { a -> RemoteImage(Config.url(a.src), Modifier.size(180.dp).background(Color.Transparent, YardShapes.small), maxPixelSize = 600) }
            val body = if (m.isRemoved) "This message was removed." else m.body ?: m.product?.name ?: m.order?.reference?.let { "Order $it" }
            if (!body.isNullOrBlank()) Text(body, style = YardFonts.body, color = if (mine) Color.yard.onAcid else Color.yard.ink)
            Text(Formatters.relative(m.createdAt), style = YardFonts.micro, color = if (mine) Color.yard.onAcid.copy(alpha = 0.6f) else Color.yard.ink3)
        }
    }
}

// endregion
