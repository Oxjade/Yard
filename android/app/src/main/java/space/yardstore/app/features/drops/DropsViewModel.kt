package space.yardstore.app.features.drops

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.designsystem.components.Toast
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * The /drops calendar: live, upcoming and ended are read as three separate pages (each with its
 * own "Load more"), like the website's LiveDropsBoard, and grouped on the shopper's clock.
 * Mirrors DropsViewModel.swift.
 */
class DropsViewModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    enum class Source(val wire: String) { Live("live"), Upcoming("upcoming"), Ended("ended") }

    sealed interface LoadState {
        data object Loading : LoadState
        data object Loaded : LoadState
        data class Failed(val error: Throwable) : LoadState
    }

    data class Feed(
        val items: List<Drop> = emptyList(),
        val cursor: String? = null,
        val isLoadingMore: Boolean = false,
    )

    data class Day(val day: LocalDate, val drops: List<Drop>)

    data class Groups(
        val live: List<Drop> = emptyList(),
        val entriesOpen: List<Drop> = emptyList(),
        val upcoming: List<Drop> = emptyList(),
        val past: List<Drop> = emptyList(),
    ) {
        val isEmpty: Boolean get() = live.isEmpty() && entriesOpen.isEmpty() && upcoming.isEmpty() && past.isEmpty()
    }

    companion object {
        const val PAGE_SIZE = 24
    }

    var state by mutableStateOf<LoadState>(LoadState.Loading); private set
    var feeds by mutableStateOf<Map<Source, Feed>>(emptyMap()); private set
    /** Drops the signed-in shopper asked to be reminded about / entered (GET /api/drops/me). */
    var reminderIds by mutableStateOf<Set<String>>(emptySet()); private set
    var entryIds by mutableStateOf<Set<String>>(emptySet()); private set
    var busyIds by mutableStateOf<Set<String>>(emptySet()); private set
    var isRefreshing by mutableStateOf(false); private set
    private var hasLoaded = false
    /** The sign-in state the bells were last read for (null until the screen reports one). */
    private var signedIn: Boolean? = null

    /** Preview-only: a model that already holds drops. */
    constructor(previewDrops: List<Drop>) : this() {
        val now = Instant.now()
        val live = mutableListOf<Drop>()
        val upcoming = mutableListOf<Drop>()
        val ended = mutableListOf<Drop>()
        for (drop in previewDrops) {
            when (drop.livePhase(now)) {
                DropLivePhase.Ended -> ended += drop
                DropLivePhase.Upcoming -> upcoming += drop
                else -> live += drop
            }
        }
        feeds = mapOf(Source.Live to Feed(live), Source.Upcoming to Feed(upcoming), Source.Ended to Feed(ended))
        state = LoadState.Loaded
        hasLoaded = true
    }

    fun feed(source: Source): Feed = feeds[source] ?: Feed()

    fun loadIfNeeded(signedIn: Boolean) {
        if (hasLoaded) return
        viewModelScope.launch { reload(signedIn) }
    }

    /** Pull to refresh. */
    fun refresh(signedIn: Boolean) {
        if (isRefreshing) return
        viewModelScope.launch {
            isRefreshing = true
            try { reload(signedIn) } finally { isRefreshing = false }
        }
    }

    suspend fun reload(signedIn: Boolean) {
        this.signedIn = signedIn
        if (!hasLoaded) state = LoadState.Loading
        try {
            val pages = coroutineScope {
                val live = async { fetch(Source.Live, null) }
                val upcoming = async { fetch(Source.Upcoming, null) }
                val ended = async { fetch(Source.Ended, null) }
                listOf(live.await(), upcoming.await(), ended.await())
            }
            feeds = mapOf(
                Source.Live to Feed(pages[0].items, pages[0].nextCursor),
                Source.Upcoming to Feed(pages[1].items, pages[1].nextCursor),
                Source.Ended to Feed(pages[2].items, pages[2].nextCursor),
            )
            state = LoadState.Loaded
            hasLoaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A failed pull-to-refresh keeps what is on screen; only the first load shows the error.
            if (!hasLoaded) state = LoadState.Failed(e)
        }
        // The session may have resolved while the feeds were loading: read the bells for the latest state.
        loadParticipation(this.signedIn ?: signedIn)
    }

    fun loadMore(source: Source) {
        viewModelScope.launch { loadMoreNow(source) }
    }

    suspend fun loadMoreNow(source: Source) {
        val current = feed(source)
        val cursor = current.cursor ?: return
        if (current.isLoadingMore) return
        feeds = feeds + (source to current.copy(isLoadingMore = true))
        try {
            val page = fetch(source, cursor)
            val next = feed(source)
            val known = next.items.map { it.id }.toSet()
            feeds = feeds + (source to next.copy(
                items = next.items + page.items.filter { it.id !in known },
                cursor = page.nextCursor,
                isLoadingMore = false,
            ))
        } catch (e: CancellationException) {
            feeds = feeds + (source to feed(source).copy(isLoadingMore = false))
            throw e
        } catch (e: Exception) {
            feeds = feeds + (source to feed(source).copy(isLoadingMore = false))
        }
    }

    /** The shopper's reminders and entries, for the bell on each upcoming row. Signed out → empty. */
    suspend fun loadParticipation(signedIn: Boolean) {
        if (!signedIn) {
            reminderIds = emptySet()
            entryIds = emptySet()
            return
        }
        try {
            val me = api.get<MyDropsResponse>("/api/drops/me")
            reminderIds = me.reminders.map { it.dropId }.toSet()
            entryIds = me.entries.filter { it.status != "withdrawn" }.map { it.drop.id }.toSet()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Bells just show "off"; the drop page reads the real state.
        }
    }

    /**
     * `.onChange(of: session.isSignedIn)`: re-reads the bells only when the sign-in state really
     * changed since the last load (not every time the screen re-enters composition).
     */
    fun sessionChanged(signedIn: Boolean) {
        if (noteSignedIn(signedIn)) viewModelScope.launch { loadParticipation(signedIn) }
    }

    /** Records the sign-in state; true when it differs from the one the screen last loaded for. */
    internal fun noteSignedIn(signedIn: Boolean): Boolean {
        val previous = this.signedIn
        this.signedIn = signedIn
        return previous != null && previous != signedIn
    }

    /** Toggles the reminder for [drop] and returns the toast to show. */
    suspend fun toggleReminder(drop: Drop, context: Context?, permission: DropNotificationPermission?): DropToastMessage {
        if (drop.id in busyIds) return DropToastMessage("", Toast.Style.Info)
        busyIds = busyIds + drop.id
        try {
            val turnOn = drop.id !in reminderIds
            val outcome = DropActions.setReminder(turnOn, drop, context, permission)
            reminderIds = if (turnOn) reminderIds + drop.id else reminderIds - drop.id
            return DropActions.reminderMessage(turnOn, outcome)
        } finally {
            busyIds = busyIds - drop.id
        }
    }

    /** Every loaded drop, de-duplicated, placed in its group on the shopper's clock. */
    fun groups(now: Instant): Groups {
        val live = mutableListOf<Drop>()
        val entriesOpen = mutableListOf<Drop>()
        val upcoming = mutableListOf<Drop>()
        val past = mutableListOf<Drop>()
        val seen = HashSet<String>()
        for (source in Source.entries) {
            for (drop in feed(source).items) {
                if (!seen.add(drop.id)) continue
                when (drop.livePhase(now)) {
                    DropLivePhase.Ended -> past += drop
                    DropLivePhase.EntriesOpen -> entriesOpen += drop
                    DropLivePhase.Upcoming, DropLivePhase.EarlyAccess -> upcoming += drop
                    DropLivePhase.Live -> live += drop
                }
            }
        }
        val far = Instant.MAX
        return Groups(
            live = live.sortedBy { it.endDate ?: far },
            entriesOpen = entriesOpen.sortedBy { it.entriesCloseDate ?: far },
            upcoming = upcoming.sortedBy { it.startDate ?: far },
            past = past.sortedByDescending { it.endDate ?: Instant.MIN },
        )
    }

    /** Upcoming drops as a calendar: one entry per local day, in order. */
    fun days(drops: List<Drop>, now: Instant, zone: ZoneId = ZoneId.systemDefault()): List<Day> {
        val byDay = LinkedHashMap<LocalDate, MutableList<Drop>>()
        for (drop in drops) {
            val date = drop.reminderOpenDate(now) ?: drop.startDate ?: now
            byDay.getOrPut(date.atZone(zone).toLocalDate()) { mutableListOf() } += drop
        }
        return byDay.keys.sorted().map { Day(it, byDay[it].orEmpty()) }
    }

    private suspend fun fetch(source: Source, cursor: String?): DropsPage =
        api.get(
            "/api/drops",
            listOf("phase" to source.wire, "limit" to PAGE_SIZE.toString(), "cursor" to cursor),
        )
}
