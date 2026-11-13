package space.yardstore.app.features.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.semantics.selected
import kotlinx.coroutines.flow.filterNotNull
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.AdaptiveContent
import space.yardstore.app.designsystem.components.ListDetailLayout
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.DoNotDisturbOff
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

// region Model

/** The shopper's conversation list (GET /api/inbox/conversations), newest activity first. Mirrors `InboxListModel`. */
class InboxListModel : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    var items by mutableStateOf<List<InboxConversation>>(emptyList()); private set
    var nextCursor by mutableStateOf<String?>(null); private set
    var phase by mutableStateOf<Phase>(Phase.Idle); private set
    var isLoadingMore by mutableStateOf(false); private set
    var filter by mutableStateOf(InboxAPI.Filter.Inbox); private set
    var query by mutableStateOf(""); private set
    /** Ids with an action in flight (row dims). */
    var busyIds by mutableStateOf<Set<String>>(emptySet()); private set

    private var generation = 0

    val hasLoaded: Boolean get() = phase == Phase.Loaded

    /** First load (skeleton) or a reload after the filter/query changed. */
    fun load(): Job {
        generation += 1
        val gen = generation
        if (!hasLoaded || items.isEmpty()) phase = Phase.Loading
        return viewModelScope.launch {
            try {
                val page = InboxAPI.conversations(filter, query, cursor = null)
                if (gen != generation) return@launch
                items = sorted(page.items)
                nextCursor = page.nextCursor
                phase = Phase.Loaded
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gen != generation) return@launch
                if ((e as? APIError)?.isCancelled == true) return@launch
                if (hasLoaded && items.isNotEmpty()) return@launch // keep showing what we have
                phase = Phase.Failed(APIError.messageFor(e))
            }
        }
    }

    /** Silent refresh (coming back from a thread, pull to refresh): never shows the skeleton. */
    fun refresh(): Job {
        generation += 1
        val gen = generation
        return viewModelScope.launch {
            try {
                val page = InboxAPI.conversations(filter, query, cursor = null)
                if (gen != generation) return@launch
                items = sorted(page.items)
                nextCursor = page.nextCursor
                phase = Phase.Loaded
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gen != generation) return@launch
                if (!hasLoaded && (e as? APIError)?.isCancelled != true) phase = Phase.Failed(APIError.messageFor(e))
            }
        }
    }

    fun loadMore(): Job? {
        val cursor = nextCursor ?: return null
        if (isLoadingMore || !hasLoaded) return null
        isLoadingMore = true
        val gen = generation
        return viewModelScope.launch {
            try {
                val page = InboxAPI.conversations(filter, query, cursor)
                if (gen != generation) return@launch
                val known = items.map { it.id }.toSet()
                items = items + page.items.filter { it.id !in known }
                nextCursor = page.nextCursor
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Leave the cursor; the next time the end of the list shows, it retries.
            } finally {
                isLoadingMore = false
            }
        }
    }

    /** Debounced search term (the view waits 250 ms). */
    fun search(term: String): Job? {
        if (term == query) return null
        query = term
        return load()
    }

    fun setFilter(f: InboxAPI.Filter): Job? {
        if (f == filter) return null
        filter = f
        items = emptyList()
        nextCursor = null
        phase = Phase.Loading
        return load()
    }

    /** Whether a conversation belongs in the current list (website `belongs`). */
    private fun belongs(c: InboxConversation): Boolean = when (filter) {
        InboxAPI.Filter.Inbox -> !c.archived && !c.blockedByMe
        InboxAPI.Filter.Archived -> c.archived && !c.blockedByMe
        InboxAPI.Filter.Blocked -> c.blockedByMe
    }

    private fun replace(c: InboxConversation) {
        items = if (belongs(c)) items.map { if (it.id == c.id) c else it } else items.filterNot { it.id == c.id }
    }

    private suspend fun busy(id: String, work: suspend () -> Unit) {
        busyIds = busyIds + id
        try { work() } finally { busyIds = busyIds - id }
    }

    /** Runs a row action in the model's scope; toasts [success] (if any) or the error. */
    fun run(toast: ToastCenter, success: String? = null, work: suspend () -> Unit): Job = viewModelScope.launch {
        try {
            work()
            if (success != null) toast.show(success, Toast.Style.Success)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toast.show(e)
        }
    }

    suspend fun setArchived(archived: Boolean, c: InboxConversation) = busy(c.id) {
        replace(InboxAPI.patch(c.id, archived = archived))
    }

    suspend fun setMuted(muted: Boolean, c: InboxConversation) = busy(c.id) {
        replace(InboxAPI.patch(c.id, muted = muted))
    }

    suspend fun markRead(c: InboxConversation) = busy(c.id) {
        InboxAPI.markReadLatest(c.id)
        items = items.map { if (it.id == c.id) it.markingRead() else it }
    }

    /**
     * Two-pane inbox (Expanded): the thread open beside the list reports its conversation here, so
     * the row's unread dot, preview, mute/archive/block state and position follow without a refresh.
     * A row that no longer belongs in the current filter leaves the list; rows not in the list are
     * not added (they may not match the search). The list read's `lastMessage` is kept when the
     * thread's copy has none.
     */
    fun applyThreadUpdate(c: InboxConversation) {
        val i = items.indexOfFirst { it.id == c.id }
        if (i < 0) return
        val old = items[i]
        val merged = c.copy(lastMessage = c.lastMessage ?: old.lastMessage, interaction = null)
        if (merged == old) return
        items = if (belongs(merged)) sorted(items.map { if (it.id == c.id) merged else it }) else items.filterNot { it.id == c.id }
    }

    suspend fun unblock(c: InboxConversation) = busy(c.id) {
        InboxAPI.setBlocked(false, c.brand.id)
        items = items.filterNot { it.id == c.id }
    }

    companion object {
        fun sorted(list: List<InboxConversation>): List<InboxConversation> =
            list.sortedWith(compareByDescending<InboxConversation> { it.sortAt }.thenByDescending { it.id })
    }
}

// endregion

// region View

/**
 * Inbox: the shopper's conversations with brands. Swipe to mark read or archive; long-press for every action.
 *
 * Expanded windows (≥ 840dp): list + thread side by side (`ListDetailLayout`). The open thread is kept
 * in `rememberSaveable`; the detail pane shows "Pick a conversation" until one is chosen, and back
 * closes the open thread first. When the window shrinks below Expanded with a thread open, that
 * thread is pushed as on phones. Narrower windows: list only, rows push `Route.Conversation`.
 */
@Composable
fun InboxView() {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val model: InboxListModel = viewModel { InboxListModel() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var searchText by rememberSaveable { mutableStateOf("") }
    val expanded = LocalYardWindow.current.isExpanded
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(session.shopper?.id) {
        if (session.isSignedIn) model.load()
    }
    LaunchedEffect(searchText, session.isSignedIn) {
        val term = searchText.trim()
        if (term == model.query || !session.isSignedIn) return@LaunchedEffect
        delay(250)
        model.search(term)
    }
    // Back from a thread: unread dots and previews settle without a skeleton.
    LaunchedEffect(lifecycle) {
        var first = true
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (!first && session.isSignedIn && model.hasLoaded) model.refresh()
            first = false
        }
    }
    // Signed out: nothing stays open.
    LaunchedEffect(session.hasLoaded, session.isSignedIn) {
        if (session.hasLoaded && !session.isSignedIn) selectedId = null
    }
    // Window shrank below Expanded with a thread open: carry on in the pushed thread, as on phones.
    LaunchedEffect(expanded) {
        val id = selectedId
        if (!expanded && id != null) {
            selectedId = null
            router.push(Route.Conversation(id))
        }
    }
    BackHandler(enabled = expanded && selectedId != null) { selectedId = null }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        if (!session.isSignedIn) {
            YardTopBar("Inbox")
            if (session.hasLoaded) {
                EmptyState.SignedOut(
                    message = "Sign in to message brands about sizing, stock and delivery.",
                    modifier = Modifier.weight(1f).adaptiveContentWidth(),
                    title = "Your inbox",
                ) { router.present(Route.SignIn) }
            } else {
                AdaptiveContent { InboxListSkeleton() }
            }
            return@Column
        }
        ListDetailLayout(
            twoPane = expanded,
            modifier = Modifier.weight(1f),
            list = {
                InboxListPane(
                    model,
                    searchText = searchText,
                    onSearchChange = { searchText = it },
                    selectedId = if (expanded) selectedId else null,
                    onOpen = { id -> if (expanded) selectedId = id else router.push(Route.Conversation(id)) },
                )
            },
            detail = { InboxDetailPane(selectedId, model) },
        )
    }
}

/** Top bar with the filter menu, search, then the list (or its skeleton / error). */
@Composable
private fun InboxListPane(
    model: InboxListModel,
    searchText: String,
    onSearchChange: (String) -> Unit,
    selectedId: String?,
    onOpen: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        YardTopBar("Inbox") {
            InboxFilterMenu(model.filter) { model.setFilter(it) }
        }
        AdaptiveContent(Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize()) {
                InboxSearchField(searchText, onChange = onSearchChange)
                when (val phase = model.phase) {
                    InboxListModel.Phase.Idle, InboxListModel.Phase.Loading -> InboxListSkeleton()
                    is InboxListModel.Phase.Failed -> EmptyState(
                        title = "Couldn't load your messages.",
                        modifier = Modifier.weight(1f),
                        message = phase.message,
                        icon = Icons.Outlined.WifiOff,
                        actionTitle = "Retry",
                        action = { model.load() },
                    )
                    InboxListModel.Phase.Loaded -> InboxList(model, selectedId, onOpen, Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * The thread beside the list (Expanded only). No back button (the list is right there); the
 * thread's conversation flows back into the list row as it changes (read, mute, archive, new message).
 */
@Composable
private fun InboxDetailPane(selectedId: String?, list: InboxListModel) {
    if (selectedId == null) {
        Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.Center) {
            EmptyState(
                "Pick a conversation",
                modifier = Modifier.adaptiveContentWidth(),
                message = "Choose a brand on the left to read and reply to your messages.",
                icon = Icons.Outlined.Forum,
            )
        }
        return
    }
    key(selectedId) {
        val thread: InboxThreadModel = viewModel(key = "inbox-thread-$selectedId") { InboxThreadModel.forConversation(selectedId) }
        LaunchedEffect(thread) {
            snapshotFlow { thread.conversation }.filterNotNull().collect { list.applyThreadUpdate(it) }
        }
        CompositionLocalProvider(LocalBackAction provides null) {
            InboxThreadScreen(thread)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InboxList(model: InboxListModel, selectedId: String?, onOpen: (String) -> Unit, modifier: Modifier) {
    val router = LocalRouter.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    // Cursor paging: when the last row shows, fetch the next page.
    LaunchedEffect(listState, model) {
        snapshotFlow {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            last >= listState.layoutInfo.totalItemsCount - 1 && listState.layoutInfo.totalItemsCount > 0
        }.distinctUntilChanged().filter { it }.collect { model.loadMore() }
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                model.refresh().join()
                refreshing = false
            }
        },
        modifier = modifier.fillMaxWidth(),
    ) {
        if (model.items.isEmpty()) {
            InboxEmptyState(model, Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                router.push(Route.BrandsDirectory)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = bottom + Spacing.l),
            ) {
                if (model.filter != InboxAPI.Filter.Inbox) {
                    item(key = "banner") {
                        Row(
                            Modifier.fillMaxWidth().padding(start = Spacing.gutter, end = Spacing.gutter - Spacing.s),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                if (model.filter == InboxAPI.Filter.Blocked) "Brands you've blocked" else "Archived conversations",
                                style = YardFonts.caption,
                                color = Color.yard.ink2,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "Back to inbox",
                                style = YardFonts.captionEmphasis,
                                color = Color.yard.ink,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .combinedClickableCompat { model.setFilter(InboxAPI.Filter.Inbox) }
                                    .minimumInteractiveComponentSize()
                                    .padding(horizontal = Spacing.s),
                            )
                        }
                    }
                }
                items(model.items, key = { it.id }) { c ->
                    Column(Modifier.animateItem()) {
                        InboxSwipeRow(model, c, selected = c.id == selectedId) { onOpen(c.id) }
                        YardDivider(Modifier.padding(start = 64.dp + Spacing.gutter))
                    }
                }
                if (model.isLoadingMore) {
                    item(key = "more") {
                        Box(Modifier.fillMaxWidth().padding(Spacing.l), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

/** Swipe → (start to end) Mark read; swipe ← (end to start) Archive / Unarchive, or Unblock on Blocked.
 *  Long-press opens every action (incl. Mute / Unmute, which iOS keeps as a second trailing swipe button). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun InboxSwipeRow(model: InboxListModel, c: InboxConversation, selected: Boolean, onOpen: () -> Unit) {
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    var menuOpen by remember { mutableStateOf(false) }
    val canMarkRead = c.isUnread && model.filter != InboxAPI.Filter.Blocked
    val blockedList = model.filter == InboxAPI.Filter.Blocked

    fun markRead() = model.run(toast) { model.markRead(c) }
    fun archiveOrUnblock() {
        if (blockedList) {
            model.run(toast, "Unblocked ${c.brand.name}") { model.unblock(c) }
        } else {
            val archive = !c.archived
            model.run(toast, if (archive) "Archived" else "Moved back to your inbox") { model.setArchived(archive, c) }
        }
    }
    fun toggleMute() {
        val mute = !c.muted
        model.run(toast, if (mute) "Muted ${c.brand.name}" else "Unmuted ${c.brand.name}") { model.setMuted(mute, c) }
    }

    @Suppress("DEPRECATION")
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> if (canMarkRead) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); markRead() }
                SwipeToDismissBoxValue.EndToStart -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); archiveOrUnblock() }
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false // the row snaps back; the list updates when the server answers
        },
    )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = canMarkRead,
        backgroundContent = {
            val direction = state.dismissDirection
            val (label, icon, bg) = when (direction) {
                SwipeToDismissBoxValue.StartToEnd -> Triple("Mark read", Icons.Outlined.Drafts, Color.yard.purple)
                SwipeToDismissBoxValue.EndToStart -> when {
                    blockedList -> Triple("Unblock", Icons.Outlined.DoNotDisturbOff, Color.yard.purple)
                    c.archived -> Triple("Unarchive", Icons.Outlined.Unarchive, Color.yard.ink3)
                    else -> Triple("Archive", Icons.Outlined.Archive, Color.yard.ink3)
                }
                SwipeToDismissBoxValue.Settled -> Triple("", null, Color.Transparent)
            }
            val animated by animateColorAsState(bg, label = "swipeBg")
            Row(
                Modifier.fillMaxSize().background(animated).padding(horizontal = Spacing.xl),
                horizontalArrangement = if (direction == SwipeToDismissBoxValue.StartToEnd) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (icon != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(icon, contentDescription = null, tint = Color.yard.onPhoto)
                        Text(label, style = YardFonts.captionEmphasis, color = Color.yard.onPhoto)
                    }
                }
            }
        },
    ) {
        Box(
            Modifier
                .background(if (selected) Color.yard.surface2 else Color.yard.bg)
                .semantics { this.selected = selected }
                .combinedClickable(
                    onClick = onOpen,
                    onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menuOpen = true
                    },
                    onLongClickLabel = "More actions",
                ),
        ) {
            InboxConversationRow(
                c,
                Modifier
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.m)
                    .alpha(if (c.id in model.busyIds) 0.5f else 1f),
            )
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = Color.yard.surface) {
                if (canMarkRead) InboxMenuItem("Mark read", Icons.Outlined.Drafts) { menuOpen = false; markRead() }
                if (blockedList) {
                    InboxMenuItem("Unblock", Icons.Outlined.DoNotDisturbOff) { menuOpen = false; archiveOrUnblock() }
                } else {
                    InboxMenuItem(if (c.archived) "Unarchive" else "Archive", if (c.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive) {
                        menuOpen = false; archiveOrUnblock()
                    }
                    InboxMenuItem(if (c.muted) "Unmute" else "Mute", if (c.muted) Icons.Outlined.Notifications else Icons.Outlined.NotificationsOff) {
                        menuOpen = false; toggleMute()
                    }
                }
            }
        }
    }
}

@Composable
private fun InboxEmptyState(model: InboxListModel, modifier: Modifier, browseBrands: () -> Unit) {
    Box(modifier.padding(top = Spacing.xxxl)) {
        when {
            model.query.isNotEmpty() -> EmptyState(
                "No conversations match “${model.query}”",
                message = "Search looks at brand names and the messages you can see.",
                icon = Icons.Outlined.Search,
            )
            model.filter == InboxAPI.Filter.Blocked -> EmptyState(
                "No blocked brands",
                message = "Brands you block can't message you. They'd show here.",
                icon = Icons.Outlined.Block,
            )
            model.filter == InboxAPI.Filter.Archived -> EmptyState(
                "No archived conversations",
                message = "Archive a conversation to tidy your inbox. It comes back when someone writes.",
                icon = Icons.Outlined.Archive,
            )
            else -> EmptyState(
                "No messages yet",
                message = "Ask a brand about sizing, stock or delivery — start from any storefront or product.",
                icon = Icons.Outlined.Forum,
                actionTitle = "Browse brands",
                action = browseBrands,
            )
        }
    }
}

/** The filter button (Inbox / Archived / Blocked), violet when a filter is on. */
@Composable
private fun InboxFilterMenu(filter: InboxAPI.Filter, onSelect: (InboxAPI.Filter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        GlassIconButton(
            Icons.Filled.FilterList,
            contentDescription = if (filter == InboxAPI.Filter.Inbox) "Filter conversations" else "Filter: ${filter.title}",
            size = 38.dp,
            tint = if (filter == InboxAPI.Filter.Inbox) Color.yard.ink else Color.yard.violet,
        ) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Color.yard.surface) {
            for (f in InboxAPI.Filter.entries) {
                DropdownMenuItem(
                    text = { Text(f.title, style = YardFonts.body, color = Color.yard.ink) },
                    leadingIcon = { Icon(f.icon, contentDescription = null, tint = Color.yard.ink) },
                    trailingIcon = { if (f == filter) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = Color.yard.violet) },
                    onClick = {
                        open = false
                        onSelect(f)
                    },
                )
            }
        }
    }
}

/** iOS `.searchable(prompt: "Search brands and messages")`. */
@Composable
private fun InboxSearchField(text: String, onChange: (String) -> Unit) {
    val focus = LocalFocusManager.current
    BasicTextField(
        value = text,
        onValueChange = onChange,
        singleLine = true,
        textStyle = YardFonts.body.copy(color = Color.yard.ink),
        cursorBrush = SolidColor(Color.yard.ink),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.s),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .clip(CircleShape)
                    .background(Color.yard.surface2)
                    .padding(horizontal = Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Icon(Icons.Outlined.Search, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) Text("Search brands and messages", style = YardFonts.body, color = Color.yard.ink3, maxLines = 1)
                    inner()
                }
                if (text.isNotEmpty()) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Clear search",
                        tint = Color.yard.ink3,
                        modifier = Modifier.size(18.dp).clip(CircleShape).combinedClickableCompat { onChange("") },
                    )
                }
            }
        },
    )
}

// endregion

// region Row

/** One conversation: brand avatar, name, time, preview, state tags, unread dot. */
@Composable
fun InboxConversationRow(conversation: InboxConversation, modifier: Modifier = Modifier) {
    val c = conversation
    Row(
        modifier.fillMaxWidth().semantics(mergeDescendants = true) { if (c.isUnread) stateDescription = "Unread" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.Top,
    ) {
        BrandAvatar(name = c.brand.name, size = 52.dp, verified = c.brand.verified)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Text(
                    c.brand.name,
                    style = if (c.isUnread) YardFonts.bodyEmphasis else YardFonts.body,
                    color = Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (c.muted) {
                    Icon(Icons.Filled.NotificationsOff, contentDescription = "Muted", tint = Color.yard.ink3, modifier = Modifier.size(14.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(
                    c.lastMessage?.let { InboxFormat.rowTime(it.at) } ?: "",
                    style = YardFonts.caption.monospacedDigits(),
                    color = if (c.isUnread) Color.yard.ink else Color.yard.ink3,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.Top) {
                Text(
                    c.previewText,
                    style = YardFonts.callout.copy(fontWeight = if (c.isUnread) FontWeight.Medium else FontWeight.Normal),
                    color = if (c.isUnread) Color.yard.ink else Color.yard.ink2,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .padding(top = 5.dp)
                        .size(10.dp)
                        .alpha(if (c.isUnread) 1f else 0f)
                        .clip(CircleShape)
                        .background(Color.yard.violet),
                )
            }
            if (c.status == "resolved" || c.blockedByMe || c.archived) {
                Row(Modifier.padding(top = Spacing.xxs), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    if (c.status == "resolved") Tag("Resolved")
                    if (c.blockedByMe) Tag("Blocked", style = TagStyle.Danger)
                    if (c.archived) Tag("Archived")
                }
            }
        }
    }
}

/** Loading shape: rows of avatar + two text lines. */
@Composable
fun InboxListSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.l)
            .semantics { contentDescription = "Loading your inbox" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        for (i in 0 until 7) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
                Skeleton(Modifier.size(52.dp), shape = SkeletonShape.Circle)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    Skeleton(Modifier.width((110 + (i % 3) * 30).dp).height(14.dp), cornerRadius = 6.dp)
                    Skeleton(Modifier.fillMaxWidth().height(12.dp), cornerRadius = 6.dp)
                    Skeleton(Modifier.width(160.dp).height(12.dp), cornerRadius = 6.dp)
                }
            }
        }
    }
}

// endregion

// region Previews (fixtures are preview-only)

private object InboxPreviewData {
    private fun ago(seconds: Long) = java.time.Instant.now().minusSeconds(seconds).toString()
    val rows = listOf(
        InboxConversation("cv_1", InboxBrandRef("b1", "acme", "Acme Studio", verified = true), lastMessage = InboxLastMessage("Yes — the M fits true to size. Restock lands Friday.", ago(600), "brand"), unread = 2, createdAt = "2026-11-01T10:00:00Z"),
        InboxConversation("cv_2", InboxBrandRef("b2", "lagos", "Lagos Thread"), lastMessage = InboxLastMessage("How long does delivery to London usually take?", ago(90_000), "customer"), muted = true, createdAt = "2026-11-01T10:00:00Z"),
        InboxConversation("cv_3", InboxBrandRef("b3", "kumasi", "Kumasi Thread Co."), status = "resolved", lastMessage = InboxLastMessage("Thanks!", "2026-10-02T10:00:00Z", "customer"), createdAt = "2026-10-01T10:00:00Z"),
    )
}

@Composable
private fun InboxRowsSample() {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        InboxPreviewData.rows.forEach { InboxConversationRow(it) }
    }
}

@Preview(name = "Inbox rows — dark")
@Composable
private fun InboxRowsDark() = YardPreview(darkTheme = true) { InboxRowsSample() }

@Preview(name = "Inbox rows — light")
@Composable
private fun InboxRowsLight() = YardPreview(darkTheme = false) { InboxRowsSample() }

@Preview(name = "InboxView — dark")
@Composable
private fun InboxViewDark() = YardPreview(darkTheme = true) { InboxView() }

@Preview(name = "InboxView — light")
@Composable
private fun InboxViewLight() = YardPreview(darkTheme = false, signedIn = false) { InboxView() }

@YardTabletPreviews
@Composable
private fun InboxViewTablet() = YardPreview(darkTheme = true) { InboxView() }

/** The Expanded two-pane look with fixtures: list (first row selected) beside its thread. */
@YardTabletPreviews
@Composable
private fun InboxTwoPaneTablet() = YardPreview(darkTheme = false) {
    val thread = remember { InboxThreadPreviewData.model() }
    ListDetailLayout(
        list = {
            Column(Modifier.fillMaxSize().yardScreenBackground()) {
                YardTopBar("Inbox", back = null)
                InboxPreviewData.rows.forEachIndexed { i, c ->
                    InboxConversationRow(
                        c,
                        Modifier
                            .background(if (i == 0) Color.yard.surface2 else Color.yard.bg)
                            .padding(horizontal = Spacing.gutter, vertical = Spacing.m),
                    )
                }
            }
        },
        detail = {
            CompositionLocalProvider(LocalBackAction provides null) { InboxThreadScreen(thread, autoLoad = false) }
        },
    )
}

// endregion
